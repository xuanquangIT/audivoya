// Shell-free git wrappers and porcelain parsers shared by wt.mjs and setup.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalPath } from './paths.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * First non-empty line of tool output, with any `user:secret@` URL credentials masked.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function firstLine(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ? line.replace(/\/\/[^/@\s]+@/g, '//***@') : null;
}

/**
 * Runs git with an argument array (never through a shell).
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: boolean, status: number | null, stdout: string, stderr: string }}
 */
export function runGit(args, { cwd, env } = {}) {
  if (cwd && !fs.existsSync(cwd))
    throw new Error(`directory does not exist: ${cwd}`);
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT')
      throw new Error('git was not found on PATH');
    throw result.error;
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Runs git and returns trimmed stdout.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string}
 * @throws {Error} When git exits non-zero.
 */
export function git(args, options) {
  const result = runGit(args, options);
  if (!result.ok)
    throw new Error(
      `git ${args.join(' ')} failed: ${firstLine(result.stderr) ?? `exit ${result.status}`}`,
    );
  return result.stdout.trim();
}

/**
 * Parses `git worktree list --porcelain [-z]` output.
 * @param {string} text
 * @returns {WorktreeEntry[]}
 */
export function parseWorktreeList(text) {
  /** @type {WorktreeEntry[]} */
  const entries = [];
  /** @type {WorktreeEntry | null} */
  let current = null;
  for (const field of text.split(/\0|\r?\n/)) {
    if (field === '') {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      if (current) entries.push(current);
      current = {
        path: value,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch')
      current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Lists the worktrees of the repository containing `cwd`, with canonical native paths.
 * The main worktree is always first.
 * @param {string} cwd
 * @returns {WorktreeEntry[]}
 */
export function listWorktrees(cwd) {
  const result = runGit(['worktree', 'list', '--porcelain', '-z'], { cwd });
  if (!result.ok)
    throw new Error(
      `git worktree list failed: ${firstLine(result.stderr) ?? `exit ${result.status}`}`,
    );
  return parseWorktreeList(result.stdout).map((entry) => ({
    ...entry,
    path: canonicalPath(entry.path),
  }));
}

/**
 * Resolves the current worktree root and the main checkout root (parent of the common git dir).
 * @param {string} cwd
 * @returns {{ root: string, mainRoot: string, commonDir: string }}
 */
export function resolveRoots(cwd) {
  const result = runGit(
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ],
    { cwd },
  );
  const [toplevel, commonDir] = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!result.ok || !toplevel || !commonDir)
    throw new Error(
      `${cwd} is not inside a git worktree (${firstLine(result.stderr) ?? 'git rev-parse failed'})`,
    );
  const root = canonicalPath(toplevel);
  let mainRoot;
  if (path.basename(commonDir) === '.git')
    mainRoot = canonicalPath(path.dirname(commonDir));
  else
    mainRoot = listWorktrees(root).find((entry) => !entry.bare)?.path ?? root;
  return { root, mainRoot, commonDir: canonicalPath(commonDir) };
}

/**
 * Short name of the checked-out branch, or null when HEAD is detached.
 * @param {string} cwd
 * @returns {string | null}
 */
export function currentBranch(cwd) {
  const result = runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd });
  return result.ok ? result.stdout.trim() || null : null;
}

/**
 * True when `ref` resolves to a commit.
 * @param {string} cwd
 * @param {string} ref
 * @returns {boolean}
 */
export function refExists(cwd, ref) {
  return runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
  }).ok;
}

/**
 * True when a local branch exists.
 * @param {string} cwd
 * @param {string} branch
 * @returns {boolean}
 */
export function localBranchExists(cwd, branch) {
  return runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd,
  }).ok;
}

/**
 * True when git would ignore `relativePath` in the worktree at `root` (tracked files are not ignored).
 * @param {string} root
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isIgnored(root, relativePath) {
  return (
    runGit(['check-ignore', '-q', relativePath], { cwd: root }).status === 0
  );
}

/**
 * Number of changed or untracked entries in `git status --porcelain`, or null on failure.
 * @param {string} root
 * @returns {number | null}
 */
export function dirtyCount(root) {
  const result = runGit(['status', '--porcelain'], { cwd: root });
  if (!result.ok) return null;
  return result.stdout.split(/\r?\n/).filter(Boolean).length;
}

/**
 * Commits on HEAD not on `base` (ahead) and on `base` not on HEAD (behind).
 * @param {string} root
 * @param {string} base
 * @returns {{ ahead: number, behind: number } | null}
 */
export function aheadBehind(root, base) {
  const result = runGit(
    ['rev-list', '--left-right', '--count', `${base}...HEAD`],
    {
      cwd: root,
    },
  );
  if (!result.ok) return null;
  const [behind, ahead] = result.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null;
  return { ahead, behind };
}

/**
 * @typedef {object} WorktreeEntry
 * @property {string} path
 * @property {string | null} head
 * @property {string | null} branch Short branch name, or null when detached/bare.
 * @property {boolean} bare
 * @property {boolean} detached
 * @property {boolean} locked
 * @property {boolean} prunable
 */
