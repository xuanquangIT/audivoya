#!/usr/bin/env node
// Bootstraps the CURRENT worktree. Idempotent; safe in `wt new` worktrees and in harness-made
// ones (Claude .claude/worktrees, Codex, Cursor with $ROOT_WORKTREE_PATH):
//   1. copy each `copyFromMain` file from the main checkout when missing (never read or logged),
//   2. keep or allocate a port slot (lowest free N >= 1 with all ports bindable on 127.0.0.1),
//   3. write/merge `.worktree.json`,
//   4. install dependencies when node_modules is missing or older than package-lock.json.
// node_modules is never copied: npm workspace links are absolute junctions into one checkout.
// In the main checkout it only validates the configuration.
// CLI: node scripts/worktree/setup.mjs [--install|--no-install] [--json]
import fs from 'node:fs';
import path from 'node:path';
import {
  UsageError,
  formatPorts,
  isMainModule,
  parseCommandArgs,
} from './lib/cli.mjs';
import { STATE_FILE, portsForSlot, slotFromState } from './lib/config.mjs';
import { collectWorktrees, loadContext } from './lib/context.mjs';
import { runCommand } from './lib/exec.mjs';
import { currentBranch, isIgnored } from './lib/git.mjs';
import { allocateSlot, isPortFree } from './lib/slots.mjs';
import { mergeState, readState, writeState } from './lib/state.mjs';
import { withLock } from './machine-lock.mjs';

/** Owners recorded in `.worktree.json`. */
export const OWNERS = Object.freeze([
  'claude',
  'codex',
  'cursor',
  'copilot',
  'human',
]);

/**
 * Infers which harness created a worktree from its path or environment.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function detectOwner(root, env) {
  // Both separators: harness paths may be reported in Windows form on any platform.
  const normalized = `${root.replaceAll('\\', '/').toLowerCase()}/`;
  if (normalized.includes('/.claude/worktrees/')) return 'claude';
  if (normalized.includes('/.codex/worktrees/')) return 'codex';
  if (normalized.includes('/.cursor/worktrees/')) return 'cursor';
  if (env.CLAUDECODE === '1') return 'claude';
  return undefined;
}

/**
 * Reads `packages` from a lockfile as `name@version` entries, or null when the
 * file is missing or unparseable. The root entry ("") is skipped because the
 * hidden lockfile that npm writes into node_modules does not carry it.
 * @param {string} file
 * @returns {Set<string> | null}
 */
export function lockfileEntries(file) {
  try {
    const packages = JSON.parse(fs.readFileSync(file, 'utf8')).packages;
    if (!packages || typeof packages !== 'object') return null;
    const entries = new Map();
    for (const [name, meta] of Object.entries(packages)) {
      if (
        !name.startsWith('node_modules/') ||
        !meta ||
        typeof meta !== 'object'
      )
        continue;
      entries.set(name, {
        version: String(meta.version ?? meta.resolved ?? ''),
        optional: meta.optional === true,
      });
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * True when the installed tree (`node_modules/.package-lock.json`) matches
 * `package-lock.json`: every required package is installed at the locked
 * version, nothing extra is installed, and optional (platform-specific)
 * packages may be absent. Content comparison, not mtime: a checkout or rebase
 * touches the lockfile without changing it. A lockfile without `packages`
 * (lockfileVersion 1, or a stub) counts as matching: there is nothing to
 * compare, and `npm ci` would not know better either.
 * @param {string} lockFile
 * @param {string} installedFile
 */
export function lockfilesMatch(lockFile, installedFile) {
  const wanted = lockfileEntries(lockFile);
  if (!wanted) return true;
  const installed = lockfileEntries(installedFile);
  if (!installed) return false;
  for (const [name, meta] of wanted) {
    const have = installed.get(name);
    if (!have) {
      if (meta.optional) continue;
      return false;
    }
    if (have.version !== meta.version) return false;
  }
  for (const name of installed.keys()) if (!wanted.has(name)) return false;
  return true;
}

/**
 * Decides whether dependencies must be installed in `root`.
 * @param {{ root: string, mode?: 'auto' | 'always' | 'never', command?: readonly string[] | null }} options
 * @returns {{ run: boolean, reason: string }}
 */
export function installDecision({ root, mode = 'auto', command = null }) {
  if (mode === 'never') return { run: false, reason: 'disabled' };
  if (!command) return { run: false, reason: 'no install command configured' };
  if (!fs.existsSync(path.join(root, 'package.json')))
    return { run: false, reason: 'no package.json' };
  if (mode === 'always') return { run: true, reason: 'requested (--install)' };
  if (!fs.existsSync(path.join(root, 'node_modules')))
    return { run: true, reason: 'node_modules missing' };
  const lock = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lock))
    return { run: false, reason: 'node_modules present' };
  const installed = path.join(root, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(installed))
    return { run: true, reason: 'node_modules/.package-lock.json missing' };
  if (!lockfilesMatch(lock, installed))
    return {
      run: true,
      reason: 'package-lock.json differs from the installed tree',
    };
  return { run: false, reason: 'node_modules up to date' };
}

function copyLocalFiles(ctx, result, log) {
  for (const relative of ctx.config.copyFromMain) {
    const target = path.join(ctx.root, relative);
    if (fs.existsSync(target)) {
      result.present.push(relative);
      continue;
    }
    const source = path.join(ctx.mainRoot, relative);
    if (!fs.existsSync(source)) {
      result.missing.push(relative);
      continue;
    }
    if (!isIgnored(ctx.root, relative)) {
      result.warnings.push(
        `${relative} is not gitignored in this worktree; not copied (it could be committed)`,
      );
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    result.copied.push(relative);
    log(`setup: copied ${relative} from the main checkout`);
  }
}

function readStateOrWarn(root, warnings) {
  try {
    return readState(root);
  } catch (error) {
    warnings.push(`${error.message}; rewriting it`);
    return null;
  }
}

async function assignSlot(ctx, options, result) {
  const { config } = ctx;
  const { maxSlots } = config.ports;
  const existing = readStateOrWarn(ctx.root, result.warnings);
  const others = collectWorktrees(ctx).filter(
    (worktree) => !worktree.isCurrent,
  );
  const taken = others
    .map((worktree) => worktree.slot)
    .filter((slot) => slot !== null && slot > 0);
  let slot = slotFromState(existing, maxSlots);
  if (slot === 0) slot = null;
  if (slot !== null && taken.includes(slot)) {
    result.warnings.push(
      `slot ${slot} is also recorded by another worktree; allocating a new one`,
    );
    slot = null;
  }
  if (slot === null) {
    slot = await allocateSlot({
      ports: config.ports,
      taken,
      isFree: options.isFree ?? isPortFree,
    });
    if (slot === null)
      throw new Error(
        `no free port slot (1-${maxSlots}): remove finished worktrees with wt rm/prune or stop processes holding the ports`,
      );
  }
  const seed = options.seed ?? {};
  const state = mergeState(existing, {
    ...seed,
    repo: config.repo,
    slot,
    branch: seed.branch ?? currentBranch(ctx.root) ?? existing?.branch,
    base: seed.base ?? existing?.base ?? `origin/${config.baseBranch}`,
    ports: portsForSlot(config.ports, slot),
    claims: seed.claims ?? existing?.claims ?? [],
    createdAt:
      existing?.createdAt ?? seed.createdAt ?? new Date().toISOString(),
    owner: seed.owner ?? existing?.owner ?? detectOwner(ctx.root, options.env),
  });
  writeState(ctx.root, state);
  return state;
}

/**
 * Bootstraps the worktree containing `cwd`.
 * @param {SetupOptions} [options]
 * @returns {Promise<SetupResult>}
 */
export async function setupWorktree(options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    install = 'auto',
    copy = true,
    log = (/** @type {string} */ message) => console.error(message),
    installStdio = 'inherit',
    lockRoot,
  } = options;
  const ctx = loadContext({ cwd, env });
  const { config } = ctx;
  /** @type {SetupResult} */
  const result = {
    ok: true,
    main: ctx.isMain,
    worktree: ctx.root,
    mainCheckout: ctx.mainRoot,
    repo: config.repo,
    slot: 0,
    ports: portsForSlot(config.ports, 0),
    copied: [],
    present: [],
    missing: [],
    install: { ran: false, reason: 'main checkout' },
    warnings: [],
  };
  if (ctx.isMain) {
    if (fs.existsSync(path.join(ctx.root, STATE_FILE)))
      result.warnings.push(
        `${STATE_FILE} exists in the main checkout and overrides legacy ports; delete it`,
      );
    return result;
  }

  if (copy) copyLocalFiles(ctx, result, log);

  const state = await withLock(
    `wt-slots-${config.repo}`,
    () => assignSlot(ctx, { ...options, env }, result),
    { timeoutMin: 2, pollMs: 250, log, ...(lockRoot ? { lockRoot } : {}) },
  );
  result.slot = /** @type {number} */ (state.slot);
  result.ports = portsForSlot(config.ports, result.slot);
  if (!isIgnored(ctx.root, STATE_FILE))
    result.warnings.push(
      `${STATE_FILE} is not gitignored; add it to .gitignore so it is never committed`,
    );

  const decision = installDecision({
    root: ctx.root,
    mode: install,
    command: config.install,
  });
  result.install = { ran: false, reason: decision.reason };
  if (decision.run && config.install) {
    log(`setup: ${decision.reason}; running ${config.install.join(' ')}`);
    const started = Date.now();
    const status = runCommand(config.install, {
      cwd: ctx.root,
      env,
      stdio: installStdio,
    });
    if (status !== 0)
      throw new Error(
        `${config.install.join(' ')} failed with exit code ${status} in ${ctx.root}`,
      );
    result.install = {
      ran: true,
      reason: `${decision.reason} (${Math.round((Date.now() - started) / 1000)}s)`,
    };
  }
  return result;
}

/**
 * Human-readable summary lines for a setup result.
 * @param {SetupResult} result
 * @returns {string[]}
 */
export function describeSetup(result) {
  if (result.main)
    return [
      `Main checkout ${result.worktree}: configuration valid; slot 0 (legacy ports).`,
      'Start task work in a worktree: node scripts/worktree/wt.mjs new <type>/<slug>',
      ...result.warnings.map((warning) => `warning: ${warning}`),
    ];
  const files = [
    result.copied.length ? `copied ${result.copied.join(', ')}` : '',
    result.present.length ? `present ${result.present.join(', ')}` : '',
    result.missing.length
      ? `not in main checkout ${result.missing.join(', ')}`
      : '',
  ].filter(Boolean);
  return [
    `Worktree ready: ${result.worktree}`,
    `  slot     ${result.slot}  ${formatPorts(result.ports)}`,
    ...(files.length ? [`  files    ${files.join('; ')}`] : []),
    `  install  ${result.install.ran ? 'ran' : 'skipped'}: ${result.install.reason}`,
    ...result.warnings.map((warning) => `warning: ${warning}`),
  ];
}

/**
 * CLI entry point.
 * @param {string[]} [argv]
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseCommandArgs(argv, {
    install: { type: 'boolean' },
    'no-install': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (values.install && values['no-install'])
    throw new UsageError('use either --install or --no-install');
  const result = await setupWorktree({
    install: values.install
      ? 'always'
      : values['no-install']
        ? 'never'
        : 'auto',
    // Keep stdout clean for --json: npm output goes to stderr.
    installStdio: values.json ? ['ignore', 2, 2] : 'inherit',
  });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else for (const line of describeSetup(result)) console.log(line);
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`setup: ${error.message}`);
    if (error instanceof UsageError)
      console.error(
        'Usage: node scripts/worktree/setup.mjs [--install|--no-install] [--json]',
      );
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

/**
 * @typedef {object} SetupOptions
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {'auto' | 'always' | 'never'} [install]
 * @property {boolean} [copy] Copy `copyFromMain` files (default true).
 * @property {Record<string, unknown>} [seed] Fields merged into `.worktree.json` (wt new).
 * @property {(message: string) => void} [log] Progress messages (default stderr).
 * @property {import('node:child_process').StdioOptions} [installStdio]
 * @property {(port: number) => boolean | Promise<boolean>} [isFree] Port probe (tests).
 * @property {string} [lockRoot] Lock directory root (tests).
 */

/**
 * @typedef {object} SetupResult
 * @property {boolean} ok
 * @property {boolean} main True in the main checkout (nothing is changed there).
 * @property {string} worktree
 * @property {string} mainCheckout
 * @property {string} repo
 * @property {number} slot
 * @property {Record<string, number>} ports
 * @property {string[]} copied
 * @property {string[]} present
 * @property {string[]} missing
 * @property {{ ran: boolean, reason: string }} install
 * @property {string[]} warnings
 */
