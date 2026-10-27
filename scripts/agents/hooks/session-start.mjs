// SessionStart hook: print a short orientation (at most 15 lines) for the
// checkout the agent is working in: repo, worktree, branch, slot and ports,
// claims and overlapping claims, bootstrap gaps, and a reminder that the main
// checkout is for integration only.
//
// It reads .worktree.json and .agents/workspace.json directly and never
// imports scripts/worktree, so it keeps working while those scripts change.
import fs from 'node:fs';
import path from 'node:path';
import { gitDirs, listWorktrees, readBranch } from './lib/git-layout.mjs';
import {
  displayPath,
  findRepoRoot,
  hookCwd,
  isEntryPoint,
  readJson,
  runHook,
  samePath,
} from './lib/hook-io.mjs';

const MAX_LINES = 15;
const MAX_OVERLAPS = 3;
const MAX_CLAIMS_SHOWN = 6;
const SETUP_COMMAND = 'node scripts/worktree/setup.mjs';
const NEW_COMMAND = 'node scripts/worktree/wt.mjs new <type>/<slug>';

/**
 * True when two repo-relative claims overlap: equal, or one is a directory
 * prefix of the other. Comparison ignores case and slash direction.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function claimsOverlap(a, b) {
  const left = normalizeClaim(a).toLowerCase();
  const right = normalizeClaim(b).toLowerCase();
  if (!left || !right) return false;
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

/**
 * Gather the session status for the checkout that contains `cwd`.
 * Reads only git metadata, `.agents/workspace.json` and `.worktree.json`
 * files, and checks (never reads) the presence of copied secret files.
 * @param {{ cwd: string, env?: Record<string, string | undefined> }} options
 * @returns {null | {
 *   repo: string, root: string, mainRoot?: string, linked: boolean, branch: string,
 *   slot: number | null, ports: { name: string, port: number, fromEnv: boolean }[],
 *   task: string, claims: string[],
 *   overlaps: { claim: string, branch: string, root: string }[], gaps: string[]
 * }}
 */
export function collectStatus({ cwd, env = process.env }) {
  const root = findRepoRoot(cwd);
  const dirs = root ? gitDirs(root) : null;
  if (!root || !dirs) return null;

  const worktrees = listWorktrees(dirs.commonDir);
  const self = worktrees.find((worktree) => samePath(worktree.root, root));
  const mainRoot = dirs.linked
    ? worktrees.find((worktree) => worktree.main)?.root
    : root;
  const config =
    readJson(path.join(root, '.agents', 'workspace.json')) ??
    (mainRoot
      ? readJson(path.join(mainRoot, '.agents', 'workspace.json'))
      : null) ??
    {};
  const state = dirs.linked
    ? readJson(path.join(root, '.worktree.json'))
    : null;
  const slot = dirs.linked
    ? Number.isInteger(state?.slot)
      ? state.slot
      : null
    : 0;
  const claims = claimList(state?.claims);

  return {
    repo: typeof config.repo === 'string' ? config.repo : path.basename(root),
    root,
    mainRoot,
    linked: dirs.linked,
    branch: self?.branch || readBranch(dirs.gitDir),
    slot,
    ports: resolvePorts(config.ports, slot, state?.ports, env),
    task: typeof state?.task === 'string' ? state.task.trim() : '',
    claims,
    overlaps: findOverlaps(root, claims, worktrees),
    gaps: bootstrapGaps(root, mainRoot, config, dirs.linked),
  };
}

/**
 * Render the status as plain text, at most 15 lines.
 * @param {NonNullable<ReturnType<typeof collectStatus>>} status
 * @returns {string}
 */
export function renderStatus(status) {
  const lines = [
    `[audivoya] repo ${status.repo} · ${status.linked ? 'linked worktree' : 'main checkout'} · branch ${status.branch || 'unknown'}`,
    `Path: ${displayPath(status.root)}`,
  ];
  if (status.linked && status.mainRoot)
    lines.push(`Main checkout: ${displayPath(status.mainRoot)}`);
  if (status.ports.length > 0) {
    const slot =
      status.slot === null
        ? 'Slot: none, so ports collide with the main checkout'
        : `Slot ${status.slot}`;
    const ports = status.ports
      .map(
        ({ name, port, fromEnv }) =>
          `${name}=${port}${fromEnv ? ' (env)' : ''}`,
      )
      .join(' ');
    lines.push(`${slot} · ${ports}`);
  }
  if (status.task) lines.push(`Task: ${truncate(status.task, 120)}`);
  if (status.linked) lines.push(claimsLine(status.claims));
  for (const overlap of status.overlaps.slice(0, MAX_OVERLAPS))
    lines.push(
      `Overlap: ${overlap.claim} is also claimed by ${overlap.branch || 'another worktree'} (${displayPath(overlap.root)})`,
    );
  if (status.overlaps.length > MAX_OVERLAPS)
    lines.push(
      `Overlap: ${status.overlaps.length - MAX_OVERLAPS} more; run node scripts/worktree/wt.mjs claims`,
    );
  // setup.mjs only validates in the main checkout, so there the fix is npm ci.
  const fix = status.linked ? SETUP_COMMAND : 'npm ci';
  lines.push(
    status.gaps.length > 0
      ? `Bootstrap: missing ${status.gaps.join(', ')}. Run \`${fix}\` before building or testing.`
      : 'Bootstrap: OK',
  );
  if (!status.linked)
    lines.push(
      `Main checkout is for integration. Start task work with \`${NEW_COMMAND}\`.`,
    );
  return `${lines.slice(0, MAX_LINES).join('\n')}\n`;
}

/**
 * Hook entry. Prints plain text (Claude Code and Copilot add it to context);
 * Cursor, recognised by `workspace_roots`, gets `{ additional_context }` JSON.
 * @param {Record<string, any>} input Parsed hook payload.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ code: number, stdout?: string }}
 */
export function sessionStart(input, env = process.env) {
  const status = collectStatus({ cwd: hookCwd(input), env });
  if (!status) return { code: 0 };
  const text = renderStatus(status);
  const stdout = Array.isArray(input.workspace_roots)
    ? `${JSON.stringify({ additional_context: text })}\n`
    : text;
  return { code: 0, stdout };
}

function resolvePorts(spec, slot, recorded, env) {
  const names =
    spec && typeof spec.names === 'object' && spec.names ? spec.names : {};
  const ports = [];
  for (const [name, definition] of Object.entries(names)) {
    const raw = env[name]?.trim();
    const fromEnv = raw ? Number(raw) : Number.NaN;
    let port;
    if (Number.isInteger(fromEnv) && fromEnv > 0) port = fromEnv;
    else if (Number.isInteger(recorded?.[name])) port = recorded[name];
    else if (slot === null || slot === 0) port = definition?.legacy;
    else port = spec.slotBase + slot * 100 + definition?.offset;
    if (Number.isInteger(port))
      ports.push({ name, port, fromEnv: port === fromEnv });
  }
  return ports;
}

function findOverlaps(root, claims, worktrees) {
  if (claims.length === 0) return [];
  const overlaps = [];
  for (const other of worktrees) {
    if (samePath(other.root, root)) continue;
    const theirs = claimList(
      readJson(path.join(other.root, '.worktree.json'))?.claims,
    );
    for (const mine of claims) {
      const hit = theirs.find((claim) => claimsOverlap(mine, claim));
      if (hit === undefined) continue;
      overlaps.push({
        claim: hit === mine ? mine : `${mine} ↔ ${hit}`,
        branch: other.branch,
        root: other.root,
      });
    }
  }
  return overlaps;
}

function bootstrapGaps(root, mainRoot, config, linked) {
  const gaps = [];
  if (linked && !fs.existsSync(path.join(root, '.worktree.json')))
    gaps.push('.worktree.json (slot and ports)');
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules)) gaps.push('node_modules');
  else if (
    lockfileDiffers(
      path.join(root, 'package-lock.json'),
      path.join(modules, '.package-lock.json'),
    )
  )
    gaps.push('up-to-date node_modules (package-lock.json changed)');
  if (linked && mainRoot) {
    const copied = Array.isArray(config.copyFromMain)
      ? config.copyFromMain.filter((file) => typeof file === 'string')
      : ['.env'];
    for (const file of copied) {
      // Presence checks only: copied files are secrets and are never read.
      if (
        fs.existsSync(path.join(mainRoot, file)) &&
        !fs.existsSync(path.join(root, file))
      )
        gaps.push(file);
    }
  }
  return gaps;
}

function claimsLine(claims) {
  if (claims.length === 0)
    return 'Claims: none recorded (list the paths you will edit under "claims" in .worktree.json)';
  const shown = claims.slice(0, MAX_CLAIMS_SHOWN).join(', ');
  const more = claims.length - MAX_CLAIMS_SHOWN;
  return `Claims: ${shown}${more > 0 ? ` (+${more} more)` : ''}`;
}

function claimList(value) {
  return Array.isArray(value)
    ? value
        .filter((claim) => typeof claim === 'string')
        .map(normalizeClaim)
        .filter(Boolean)
    : [];
}

function normalizeClaim(claim) {
  return claim
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

// Content comparison of package-lock.json against npm's hidden lockfile in
// node_modules (same rule as scripts/worktree/setup.mjs; kept standalone so the
// hook works while the worktree scripts are mid-edit). mtime is unreliable:
// a checkout or rebase touches the lockfile without changing it.
// Optional (platform-specific) packages may be absent; a lockfile without
// `packages` has nothing to compare and is treated as up to date.
function lockfileDiffers(lockFile, installedFile) {
  if (!fs.existsSync(lockFile)) return false;
  const wanted = lockfileEntries(lockFile);
  if (!wanted) return false;
  const installed = lockfileEntries(installedFile);
  if (!installed) return true;
  for (const [name, meta] of wanted) {
    const have = installed.get(name);
    if (!have) {
      if (meta.optional) continue;
      return true;
    }
    if (have.version !== meta.version) return true;
  }
  for (const name of installed.keys()) if (!wanted.has(name)) return true;
  return false;
}

function lockfileEntries(file) {
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

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

if (isEntryPoint(import.meta.url))
  await runHook('session-start', (input) => sessionStart(input));
