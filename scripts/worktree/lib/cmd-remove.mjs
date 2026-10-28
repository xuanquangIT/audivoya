// Destructive commands: `wt rm` and `wt prune`. Never touch the main checkout, the current
// worktree, protected branches or uncommitted work (unless --force).
import fs from 'node:fs';
import { parseCommandArgs } from './cli.mjs';
import {
  collectWorktrees,
  findWorktree,
  loadContext,
  worktreeLabel,
} from './context.mjs';
import { runTool } from './exec.mjs';
import { dirtyCount, firstLine, git, runGit } from './git.mjs';
import { isProtectedBranch } from './names.mjs';
import { isInside, samePath } from './paths.mjs';

const BUSY =
  /EBUSY|busy|Permission denied|being used by another process|Invalid argument|Directory not empty|failed to delete|unable to (?:remove|unlink)/i;

/**
 * Explains a failed `git worktree remove`; Windows file locks are the usual cause.
 * @param {string} worktreePath
 * @param {string} stderr
 * @returns {string}
 */
export function removalFailureMessage(worktreePath, stderr) {
  const detail = firstLine(stderr) ?? 'git worktree remove failed';
  return BUSY.test(stderr)
    ? `${detail}\n    Files in ${worktreePath} are in use (a shell, dev server or IDE open inside it): close them, then retry.\n    If git already unregistered the worktree, delete the directory by hand and run git worktree prune.`
    : detail;
}

function guardRemovable(ctx, worktree) {
  if (worktree.isMain) return 'is the main checkout';
  if (worktree.isCurrent || isInside(ctx.cwd, worktree.path))
    return 'contains the current directory (cd elsewhere first)';
  return null;
}

// On Windows `git worktree remove` can delete most files, then fail with
// "Directory not empty" on a deep node_modules tree. Finish the job with
// fs.rm (retries cover transient locks) so the worktree is never half-removed.
function finishRemoval(worktreePath, stderr) {
  if (!BUSY.test(stderr) || !fs.existsSync(worktreePath)) return false;
  try {
    fs.rmSync(worktreePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 250,
    });
    return !fs.existsSync(worktreePath);
  } catch {
    return false;
  }
}

function removeWorktree(ctx, worktree, { force, deleteBranch }) {
  if (worktree.prunable) {
    // The directory is already gone; drop the stale entry so git releases the branch.
    git(['worktree', 'prune'], { cwd: ctx.mainRoot });
    console.log(`pruned stale worktree entry ${worktree.path}`);
  } else {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    if (force && worktree.locked) args.push('--force');
    args.push(worktree.path);
    const result = runGit(args, { cwd: ctx.mainRoot });
    if (!result.ok) {
      const finished = finishRemoval(worktree.path, result.stderr);
      git(['worktree', 'prune'], { cwd: ctx.mainRoot });
      const registered = collectWorktrees(ctx).some((w) =>
        samePath(w.path, worktree.path),
      );
      if (registered)
        throw new Error(removalFailureMessage(worktree.path, result.stderr));
      // Git already dropped the worktree; only an empty folder is locked (an editor or file
      // watcher holds it). Keep going so --delete-branch still runs.
      if (!finished)
        console.log(
          `warning: ${worktree.path} could not be deleted (in use); git no longer tracks it, delete the folder once the lock is gone`,
        );
    }
    console.log(`removed worktree ${worktree.path}`);
  }
  if (!deleteBranch || !worktree.branch) return;
  if (isProtectedBranch(worktree.branch, ctx.config.protectedBranches)) {
    console.log(`kept protected branch ${worktree.branch}`);
    return;
  }
  git(['branch', '-D', worktree.branch], { cwd: ctx.mainRoot });
  console.log(`deleted local branch ${worktree.branch}`);
}

/**
 * `wt rm <slug|path|branch> [--force] [--delete-branch]`
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdRemove(args, io = {}) {
  const { values, positionals } = parseCommandArgs(
    args,
    { force: { type: 'boolean' }, 'delete-branch': { type: 'boolean' } },
    { min: 1, max: 1 },
  );
  const ctx = loadContext(io);
  const worktree = findWorktree(collectWorktrees(ctx), positionals[0], ctx.cwd);
  const refusal = guardRemovable(ctx, worktree);
  if (refusal)
    throw new Error(`refusing to remove ${worktree.path}: it ${refusal}`);
  if (!worktree.prunable && !values.force) {
    const dirty = dirtyCount(worktree.path);
    if (dirty === null || dirty > 0)
      throw new Error(
        `${worktree.path} has ${dirty ?? 'unknown'} uncommitted change(s); commit or stash them, or pass --force`,
      );
    if (worktree.locked)
      throw new Error(
        `${worktree.path} is locked (git worktree unlock it or pass --force)`,
      );
  }
  removeWorktree(ctx, worktree, {
    force: Boolean(values.force),
    deleteBranch: Boolean(values['delete-branch']),
  });
  git(['worktree', 'prune'], { cwd: ctx.mainRoot });
  return 0;
}

/**
 * Reads merged pull requests via gh (squash merges defeat ancestry checks). Returns null, after
 * printing why, when gh is missing, unauthenticated or fails.
 * @param {string} cwd
 * @param {{ run?: typeof runTool, log?: (message: string) => void }} [deps]
 * @returns {Map<string, string[]> | null} headRefName -> head commit SHAs
 */
export function mergedPullRequestHeads(
  cwd,
  { run = runTool, log = (message) => console.log(message) } = {},
) {
  const result = run(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      '500',
      '--json',
      'headRefName,headRefOid',
    ],
    { cwd },
  );
  if (result.missing) {
    log(
      'gh is not installed; skipping --merged (install GitHub CLI and run gh auth login).',
    );
    return null;
  }
  if (!result.ok) {
    log(
      `gh pr list failed (${firstLine(result.stderr) ?? `exit ${result.status}`}); skipping --merged. Check gh auth status.`,
    );
    return null;
  }
  /** @type {Map<string, string[]>} */
  const heads = new Map();
  for (const pr of JSON.parse(result.stdout)) {
    const list = heads.get(pr.headRefName) ?? [];
    list.push(pr.headRefOid);
    heads.set(pr.headRefName, list);
  }
  return heads;
}

// Deletes only when the local tip is part of a merged PR head, so a reused branch name with
// new commits is never lost.
function tipMerged(cwd, branch, heads) {
  const tip = runGit(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    { cwd },
  ).stdout.trim();
  if (!tip) return false;
  return heads.some(
    (head) =>
      head === tip ||
      runGit(['merge-base', '--is-ancestor', tip, head], { cwd }).ok,
  );
}

/**
 * `wt prune [--merged] [--dry-run]`
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function cmdPrune(args, io = {}) {
  const { values } = parseCommandArgs(args, {
    merged: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  });
  const dryRun = Boolean(values['dry-run']);
  const ctx = loadContext(io);
  const pruned = git(
    ['worktree', 'prune', '--verbose', ...(dryRun ? ['--dry-run'] : [])],
    { cwd: ctx.mainRoot },
  );
  if (pruned) console.log(pruned);
  if (!values.merged) return 0;

  const heads = mergedPullRequestHeads(ctx.mainRoot);
  if (!heads) return 0;
  const verb = dryRun ? 'would remove' : 'removing';
  const worktrees = collectWorktrees(ctx);
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter(Boolean));
  for (const worktree of worktrees) {
    const branch = worktree.branch;
    if (!branch || !heads.has(branch)) continue;
    const label = `${worktreeLabel(worktree)} (${worktree.path})`;
    if (
      isProtectedBranch(branch, ctx.config.protectedBranches) ||
      guardRemovable(ctx, worktree)
    ) {
      console.log(`skip ${label}: main, current or protected`);
      continue;
    }
    const dirty = worktree.prunable ? 0 : dirtyCount(worktree.path);
    if (dirty !== 0) {
      console.log(`skip ${label}: ${dirty ?? 'unknown'} uncommitted change(s)`);
      continue;
    }
    if (!tipMerged(ctx.mainRoot, branch, heads.get(branch) ?? [])) {
      console.log(`skip ${label}: has commits that are not in the merged PR`);
      continue;
    }
    console.log(`${verb} ${label}`);
    if (!dryRun)
      try {
        removeWorktree(ctx, worktree, { force: false, deleteBranch: true });
      } catch (error) {
        console.log(`  failed: ${error.message}`);
      }
  }

  const branches = git(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    {
      cwd: ctx.mainRoot,
    },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  for (const branch of branches) {
    if (!heads.has(branch) || checkedOut.has(branch)) continue;
    if (isProtectedBranch(branch, ctx.config.protectedBranches)) continue;
    if (!tipMerged(ctx.mainRoot, branch, heads.get(branch) ?? [])) {
      console.log(
        `skip branch ${branch}: has commits that are not in the merged PR`,
      );
      continue;
    }
    console.log(`${dryRun ? 'would delete' : 'deleting'} branch ${branch}`);
    if (!dryRun) git(['branch', '-D', branch], { cwd: ctx.mainRoot });
  }
  if (!dryRun) git(['worktree', 'prune'], { cwd: ctx.mainRoot });
  return 0;
}
