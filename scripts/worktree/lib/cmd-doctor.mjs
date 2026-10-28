// `wt doctor` (read-only health report) and `wt init` (idempotent repo-local git setup).
import fs from 'node:fs';
import path from 'node:path';
import { resolvePorts } from '../ports.mjs';
import { findClaimOverlaps, formatClaimPairs } from './claims.mjs';
import { parseCommandArgs } from './cli.mjs';
import { STATE_FILE } from './config.mjs';
import { collectWorktrees, loadContext, worktreeLabel } from './context.mjs';
import { runTool } from './exec.mjs';
import {
  git,
  isIgnored,
  localBranchExists,
  refExists,
  runGit,
} from './git.mjs';
import { PATH_BUDGET } from './names.mjs';
import { toPosix } from './paths.mjs';
import { isPortFree } from './slots.mjs';
import {
  compareSharedFiles,
  findSiblingCheckouts,
  hashSharedFiles,
} from './vendor.mjs';

/** Repo-local git settings applied by `wt init` and verified by `wt doctor`. */
export const INIT_CONFIG = Object.freeze([
  ['rerere.enabled', 'true'],
  ['fetch.prune', 'true'],
  ['core.longpaths', 'true'],
  ['push.autoSetupRemote', 'true'],
]);

/** Oldest git with `worktree list --porcelain -z` and `rev-parse --path-format`. */
export const MIN_GIT = [2, 36];

/**
 * Compares the running Node version with an `.nvmrc` value (`24`, `v24.11`, `24.11.1`).
 * @param {string} nvmrc
 * @param {string} actual `process.versions.node`
 * @returns {boolean | null} null when `.nvmrc` holds an alias such as `lts/*`.
 */
export function nodeMatchesNvmrc(nvmrc, actual) {
  const wanted = nvmrc.trim().replace(/^v/, '');
  if (!/^\d+(?:\.\d+){0,2}$/.test(wanted)) return null;
  const want = wanted.split('.');
  const have = actual.split('.');
  return want.every((part, index) => part === have[index]);
}

/**
 * Parses `git version 2.51.2.windows.1` into [major, minor].
 * @param {string} text
 * @returns {[number, number] | null}
 */
export function parseGitVersion(text) {
  const match = /(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function checkNode(ctx, report) {
  const file = path.join(ctx.root, '.nvmrc');
  if (!fs.existsSync(file))
    return report('ok', `node ${process.versions.node} (no .nvmrc)`);
  const nvmrc = fs.readFileSync(file, 'utf8').trim();
  const matches = nodeMatchesNvmrc(nvmrc, process.versions.node);
  if (matches === null)
    report(
      'warn',
      `node ${process.versions.node}; .nvmrc "${nvmrc}" not checked`,
    );
  else if (matches)
    report('ok', `node ${process.versions.node} matches .nvmrc (${nvmrc})`);
  else
    report(
      'fail',
      `node ${process.versions.node} does not match .nvmrc (${nvmrc})`,
    );
}

function checkGit(report) {
  const version = parseGitVersion(runTool('git', ['--version']).stdout);
  if (!version) return report('fail', 'git --version failed');
  const [major, minor] = version;
  const ok =
    major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
  report(
    ok ? 'ok' : 'fail',
    `git ${major}.${minor}${ok ? '' : ` (need >= ${MIN_GIT.join('.')})`}`,
  );
}

function checkGh(ctx, report) {
  let result = runTool('gh', ['auth', 'status', '--active'], { cwd: ctx.root });
  if (result.missing)
    return report(
      'warn',
      'gh not installed (needed for PRs and wt prune --merged)',
    );
  if (!result.ok && /unknown flag/i.test(result.stderr))
    result = runTool('gh', ['auth', 'status'], { cwd: ctx.root });
  // Only yes/no: gh's own output names accounts and token scopes.
  if (result.ok) report('ok', 'gh authenticated: yes');
  else report('warn', 'gh authenticated: no (run gh auth login)');
}

function checkGitConfig(ctx, report) {
  for (const [key, wanted] of INIT_CONFIG) {
    const value = runGit(['config', '--get', key], {
      cwd: ctx.root,
    }).stdout.trim();
    if (value === wanted) report('ok', `${key}=${value}`);
    else
      report('warn', `${key} is ${value || 'unset'} (wt init sets ${wanted})`);
  }
}

/**
 * Upstream of the local base branch as `remote/branch`, or null when it has none.
 * @param {string} cwd
 * @param {string} branch
 * @returns {string | null}
 */
export function branchUpstream(cwd, branch) {
  const remote = runGit(['config', '--get', `branch.${branch}.remote`], {
    cwd,
  }).stdout.trim();
  const merge = runGit(['config', '--get', `branch.${branch}.merge`], {
    cwd,
  }).stdout.trim();
  return remote && merge
    ? `${remote}/${merge.replace(/^refs\/heads\//, '')}`
    : null;
}

function checkBaseTracking(ctx, report) {
  const base = ctx.config.baseBranch;
  if (!localBranchExists(ctx.root, base)) return;
  const upstream = branchUpstream(ctx.root, base);
  if (upstream === `origin/${base}`) report('ok', `${base} tracks ${upstream}`);
  else
    report(
      'warn',
      `${base} tracks ${upstream ?? 'nothing'}; expected origin/${base} (wt init)`,
    );
}

function checkOriginHead(ctx, report) {
  const expected = `origin/${ctx.config.baseBranch}`;
  const head = runGit(
    ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'],
    {
      cwd: ctx.root,
    },
  ).stdout.trim();
  if (head === expected) report('ok', `origin/HEAD -> ${head}`);
  else
    report(
      'warn',
      `origin/HEAD -> ${head || 'unset'}; expected ${expected} (wt init)`,
    );
}

async function checkPorts(ctx, report) {
  let resolved;
  try {
    resolved = resolvePorts({ cwd: ctx.root });
  } catch (error) {
    return report('fail', `ports: ${error.message}`);
  }
  const { slot, ports } = resolved;
  const busy = [];
  for (const [name, value] of Object.entries(ports))
    if (!(await isPortFree(value))) busy.push(`${name}=${value}`);
  if (busy.length)
    report(
      'warn',
      `slot ${slot}: in use ${busy.join(' ')} (fine if it is this worktree's own server)`,
    );
  else
    report(
      'ok',
      `slot ${slot} ports free: ${Object.entries(ports)
        .map(([n, v]) => `${n}=${v}`)
        .join(' ')}`,
    );
}

function checkIgnores(ctx, report) {
  const required = [
    STATE_FILE,
    '.claude/worktrees/',
    '.worktrees/',
    ...ctx.config.copyFromMain,
  ];
  const probe = (/** @type {string} */ entry) =>
    entry.endsWith('/') ? `${entry}probe` : entry;
  const missing = required.filter(
    (entry) => !isIgnored(ctx.root, probe(entry)),
  );
  if (missing.length)
    report('warn', `.gitignore does not cover: ${missing.join(', ')}`);
  else report('ok', `.gitignore covers ${required.join(', ')}`);
}

function checkWorktrees(ctx, report) {
  const worktrees = collectWorktrees(ctx).filter((w) => !w.prunable);
  const linked = worktrees.filter((w) => !w.isMain);
  const bySlot = new Map();
  for (const w of linked)
    if (w.slot)
      bySlot.set(w.slot, [...(bySlot.get(w.slot) ?? []), worktreeLabel(w)]);
  const problems = [];
  for (const [slot, labels] of bySlot)
    if (labels.length > 1)
      problems.push(`slot ${slot} shared by ${labels.join(', ')}`);
  for (const w of linked) {
    if (!w.slot)
      problems.push(`${worktreeLabel(w)} has no slot (run setup.mjs there)`);
    if (w.path.length > PATH_BUDGET)
      problems.push(
        `${worktreeLabel(w)} path is ${w.path.length} chars (> ${PATH_BUDGET})`,
      );
  }
  if (!ctx.isMain && !fs.existsSync(path.join(ctx.root, 'node_modules')))
    problems.push('this worktree has no node_modules (run setup.mjs)');
  const overlaps = findClaimOverlaps(
    worktrees.map((w) => ({
      id: worktreeLabel(w),
      claims: /** @type {unknown[]} */ (w.state?.claims),
    })),
  );
  for (const o of overlaps)
    problems.push(
      `claims overlap ${o.a} <-> ${o.b}: ${formatClaimPairs(o.pairs)}`,
    );
  if (problems.length) for (const problem of problems) report('warn', problem);
  else
    report(
      'ok',
      `${linked.length} linked worktree(s); slots unique, no claim overlaps`,
    );
}

function checkVendored(ctx, report) {
  const siblings = findSiblingCheckouts(ctx.mainRoot, ctx.config.repo);
  if (siblings.length === 0)
    return report('ok', 'shared scripts: no sibling checkout to compare');
  const ours = hashSharedFiles(ctx.root);
  for (const sibling of siblings) {
    const diff = compareSharedFiles(ours, hashSharedFiles(sibling.root));
    const issues = [
      ...diff.different.map((f) => `${f} differs`),
      ...diff.onlyOurs.map((f) => `${f} missing in ${sibling.repo}`),
      ...diff.onlyTheirs.map((f) => `${f} only in ${sibling.repo}`),
    ];
    if (issues.length === 0)
      report(
        'ok',
        `shared scripts identical to ${sibling.repo} (${ours.size} files)`,
      );
    else
      report(
        'warn',
        `shared scripts differ from ${sibling.repo} (${sibling.root}): ${issues.slice(0, 8).join('; ')}${issues.length > 8 ? `; +${issues.length - 8} more` : ''}`,
      );
  }
}

/**
 * `wt doctor`: environment and repository health. Exit 1 only on failures, not warnings.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdDoctor(args, io = {}) {
  parseCommandArgs(args, {});
  const counts = { ok: 0, warn: 0, fail: 0 };
  const report = (
    /** @type {'ok' | 'warn' | 'fail'} */ level,
    /** @type {string} */ message,
  ) => {
    counts[level] += 1;
    console.log(`${level.padEnd(4)}  ${message}`);
  };
  let ctx;
  try {
    ctx = loadContext(io);
  } catch (error) {
    report('fail', error.message);
    return 1;
  }
  report(
    'ok',
    `${toPosix(path.relative(ctx.root, ctx.configPath))}: repo ${ctx.config.repo}, base ${ctx.config.baseBranch}, ${ctx.isMain ? 'main checkout' : `worktree of ${ctx.mainRoot}`}`,
  );
  checkNode(ctx, report);
  checkGit(report);
  checkGh(ctx, report);
  checkGitConfig(ctx, report);
  checkOriginHead(ctx, report);
  checkBaseTracking(ctx, report);
  await checkPorts(ctx, report);
  checkIgnores(ctx, report);
  checkWorktrees(ctx, report);
  checkVendored(ctx, report);
  console.log(`doctor: ${counts.fail} failure(s), ${counts.warn} warning(s)`);
  return counts.fail ? 1 : 0;
}

/**
 * `wt init`: applies INIT_CONFIG, makes the local base branch track origin/<base>, points
 * origin/HEAD at it and creates the worktree root. Idempotent; prints every change.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdInit(args, io = {}) {
  parseCommandArgs(args, {});
  const ctx = loadContext(io);
  let changes = 0;
  const changed = (/** @type {string} */ message) => {
    changes += 1;
    console.log(`changed  ${message}`);
  };
  for (const [key, value] of INIT_CONFIG) {
    // Effective value: a machine already configured globally needs no repo-local override.
    const current = runGit(['config', '--get', key], {
      cwd: ctx.root,
    }).stdout.trim();
    if (current === value) {
      console.log(`ok       ${key}=${value}`);
      continue;
    }
    git(['config', '--local', key, value], { cwd: ctx.root });
    changed(`${key}=${value}${current ? ` (was ${current})` : ''}`);
  }

  const base = ctx.config.baseBranch;
  if (!runGit(['remote', 'get-url', 'origin'], { cwd: ctx.root }).ok)
    console.log('skipped  origin/HEAD and base tracking: no origin remote');
  else {
    const hasRemoteBase = refExists(ctx.root, `refs/remotes/origin/${base}`);
    const upstream = localBranchExists(ctx.root, base)
      ? branchUpstream(ctx.root, base)
      : undefined;
    if (upstream === undefined)
      console.log(`ok       no local ${base} branch to track`);
    else if (upstream === `origin/${base}`)
      console.log(`ok       ${base} tracks origin/${base}`);
    else if (!hasRemoteBase)
      console.log(
        `skipped  ${base} tracking: origin/${base} not fetched yet (git fetch origin, then rerun)`,
      );
    else {
      git(['branch', `--set-upstream-to=origin/${base}`, base], {
        cwd: ctx.root,
      });
      changed(
        `${base} tracks origin/${base}${upstream ? ` (was ${upstream})` : ''}`,
      );
    }

    const head = runGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], {
      cwd: ctx.root,
    }).stdout.trim();
    if (head === `refs/remotes/origin/${base}`)
      console.log(`ok       origin/HEAD -> origin/${base}`);
    else if (!hasRemoteBase)
      console.log(
        `skipped  origin/HEAD: origin/${base} not fetched yet (git fetch origin, then rerun)`,
      );
    else {
      git(['remote', 'set-head', 'origin', base], { cwd: ctx.root });
      changed(
        `origin/HEAD -> origin/${base}${head ? ` (was ${head.replace('refs/remotes/', '')})` : ''}`,
      );
    }
  }

  if (fs.existsSync(ctx.worktreeBase))
    console.log(`ok       worktree root ${ctx.worktreeBase}`);
  else {
    fs.mkdirSync(ctx.worktreeBase, { recursive: true });
    changed(`created worktree root ${ctx.worktreeBase}`);
  }
  console.log(
    changes
      ? `init: ${changes} change(s) applied`
      : 'init: already configured, nothing changed',
  );
  return 0;
}
