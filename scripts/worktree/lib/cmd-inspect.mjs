// Read-only commands: `wt list`, `wt claims`, `wt path`.
import fs from 'node:fs';
import path from 'node:path';
import { findClaimOverlaps, formatClaimPairs } from './claims.mjs';
import { formatAge, formatTable, parseCommandArgs } from './cli.mjs';
import { portsForSlot } from './config.mjs';
import {
  collectWorktrees,
  findWorktree,
  loadContext,
  worktreeLabel,
} from './context.mjs';
import { aheadBehind, dirtyCount } from './git.mjs';

function createdAtMs(worktree) {
  const iso = worktree.state?.createdAt;
  const parsed = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  if (worktree.isMain) return null;
  // Linked worktrees have a `.git` file written once at creation.
  try {
    return fs.statSync(path.join(worktree.path, '.git')).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Describes every worktree of the repository (the data behind `wt list --json`).
 * @param {import('./context.mjs').WorktreeContext} ctx
 * @param {number} [now]
 * @returns {WorktreeRow[]}
 */
export function describeWorktrees(ctx, now = Date.now()) {
  const { config } = ctx;
  const devName = Object.keys(config.ports.names)[0];
  return collectWorktrees(ctx).map((worktree) => {
    const present = !worktree.prunable && fs.existsSync(worktree.path);
    // Without a slot, ports.mjs falls back to legacy ports (slot 0).
    const effectiveSlot = worktree.slot ?? 0;
    const ports = portsForSlot(config.ports, effectiveSlot);
    const base =
      typeof worktree.state?.base === 'string'
        ? worktree.state.base
        : `origin/${config.baseBranch}`;
    const divergence =
      present && worktree.head ? aheadBehind(worktree.path, base) : null;
    const created = createdAtMs(worktree);
    const claims = Array.isArray(worktree.state?.claims)
      ? worktree.state.claims
      : [];
    return {
      repo: config.repo,
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
      main: worktree.isMain,
      current: worktree.isCurrent,
      detached: worktree.detached,
      locked: worktree.locked,
      prunable: worktree.prunable || !present,
      slot: worktree.isMain ? (worktree.slot ?? 0) : worktree.slot,
      ports,
      devPort: devName ? (ports[devName] ?? null) : null,
      dirty: present ? dirtyCount(worktree.path) : null,
      base,
      ahead: divergence?.ahead ?? null,
      behind: divergence?.behind ?? null,
      claims: /** @type {string[]} */ (claims),
      task:
        typeof worktree.state?.task === 'string' ? worktree.state.task : null,
      owner:
        typeof worktree.state?.owner === 'string' ? worktree.state.owner : null,
      createdAt: created === null ? null : new Date(created).toISOString(),
      ageHours:
        created === null ? null : Math.max(0, (now - created) / 3_600_000),
      stateError: worktree.stateError,
    };
  });
}

function truncate(text, width) {
  return text.length <= width ? text : `${text.slice(0, width - 3)}...`;
}

/**
 * `wt list [--json]`
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdList(args, io = {}) {
  const { values } = parseCommandArgs(args, { json: { type: 'boolean' } });
  const rows = describeWorktrees(loadContext(io));
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  const table = rows.map((row) => [
    `${row.current ? '*' : ' '}${row.main ? 'M' : ' '}`,
    row.branch ?? '(detached)',
    row.slot === null ? 'none' : String(row.slot),
    row.devPort === null ? '-' : String(row.devPort),
    row.dirty === null ? '-' : String(row.dirty),
    row.ahead === null ? '-' : `+${row.ahead}/-${row.behind}`,
    formatAge(row.ageHours === null ? null : row.ageHours * 3_600_000),
    truncate(row.claims.join(','), 40) || '-',
    row.prunable ? `${row.path} (missing: wt prune)` : row.path,
  ]);
  console.log(
    formatTable(
      [
        '',
        'BRANCH',
        'SLOT',
        'DEV',
        'DIRTY',
        'AHEAD/BEHIND',
        'AGE',
        'CLAIMS',
        'PATH',
      ],
      table,
    ),
  );
  console.log('* current  M main checkout (integration only)');
  if (rows.some((row) => !row.main && row.slot === null && !row.prunable))
    console.log(
      'Worktrees with slot "none" use legacy ports and collide: run node scripts/worktree/setup.mjs inside them.',
    );
  for (const row of rows)
    if (row.stateError) console.log(`warning: ${row.stateError}`);
  return 0;
}

/**
 * `wt claims`: prints overlapping claims across worktrees; exit 1 when any overlap.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdClaims(args, io = {}) {
  parseCommandArgs(args, {});
  const worktrees = collectWorktrees(loadContext(io));
  const withClaims = worktrees.filter(
    (w) => Array.isArray(w.state?.claims) && w.state.claims.length > 0,
  );
  const overlaps = findClaimOverlaps(
    withClaims.map((w) => ({
      id: worktreeLabel(w),
      claims: /** @type {unknown[]} */ (w.state?.claims),
    })),
  );
  if (overlaps.length === 0) {
    console.log(
      `No overlapping claims (${withClaims.length} of ${worktrees.length} worktrees declare claims).`,
    );
    return 0;
  }
  for (const overlap of overlaps)
    console.log(
      `${overlap.a} <-> ${overlap.b}: ${formatClaimPairs(overlap.pairs)}`,
    );
  console.log(
    'Coordinate before editing: split the files, sequence the tasks, or merge one PR first.',
  );
  return 1;
}

/**
 * `wt path <slug|branch|path>`: prints the absolute worktree path.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdPath(args, io = {}) {
  const { positionals } = parseCommandArgs(args, {}, { min: 1, max: 1 });
  const ctx = loadContext(io);
  console.log(
    findWorktree(collectWorktrees(ctx), positionals[0], ctx.cwd).path,
  );
  return 0;
}

/**
 * @typedef {object} WorktreeRow
 * @property {string} repo
 * @property {string} path
 * @property {string | null} branch
 * @property {string | null} head
 * @property {boolean} main
 * @property {boolean} current
 * @property {boolean} detached
 * @property {boolean} locked
 * @property {boolean} prunable
 * @property {number | null} slot Null for a linked worktree that was never set up.
 * @property {Record<string, number>} ports Effective ports (legacy when slot is null).
 * @property {number | null} devPort First configured port.
 * @property {number | null} dirty
 * @property {string} base
 * @property {number | null} ahead
 * @property {number | null} behind
 * @property {string[]} claims
 * @property {string | null} task
 * @property {string | null} owner
 * @property {string | null} createdAt
 * @property {number | null} ageHours
 * @property {string | null} stateError
 */
