// Read git worktree layout straight from the file system.
//
// Hooks must finish well under 1.5 s on Windows, where every `git` process
// costs tens of milliseconds. The on-disk layout used here is stable git
// behaviour: a main checkout has a `.git` directory; a linked worktree has a
// `.git` file (`gitdir: <common>/worktrees/<id>`) whose admin directory holds
// `HEAD`, `commondir` and a `gitdir` back-pointer to `<worktree>/.git`.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Git directories of the checkout rooted at `root`.
 * @param {string} root Worktree root (the directory containing `.git`).
 * @returns {{ gitDir: string, commonDir: string, linked: boolean } | null}
 */
export function gitDirs(root) {
  const dotGit = path.join(root, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory())
    return { gitDir: dotGit, commonDir: dotGit, linked: false };
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit));
  if (!pointer) return null;
  const gitDir = path.resolve(root, pointer[1]);
  const common = readText(path.join(gitDir, 'commondir')).trim();
  return {
    gitDir,
    commonDir: common ? path.resolve(gitDir, common) : gitDir,
    linked: true,
  };
}

/**
 * Branch checked out in a git admin directory: `feat/x`, `(detached abc1234)`,
 * or '' when HEAD is unreadable.
 * @param {string} gitDir
 * @returns {string}
 */
export function readBranch(gitDir) {
  const head = readText(path.join(gitDir, 'HEAD')).trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (ref) return ref[1];
  return /^[0-9a-f]{7,}$/i.test(head) ? `(detached ${head.slice(0, 7)})` : '';
}

/**
 * All worktrees sharing `commonDir`: the main checkout first, then linked
 * worktrees sorted by admin id. Worktrees whose directory no longer exists
 * (prunable) are skipped.
 * @param {string} commonDir
 * @returns {{ root: string, branch: string, main: boolean }[]}
 */
export function listWorktrees(commonDir) {
  const worktrees = [];
  if (path.basename(commonDir) === '.git')
    worktrees.push({
      root: path.dirname(commonDir),
      branch: readBranch(commonDir),
      main: true,
    });
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(commonDir, 'worktrees')).sort();
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const adminDir = path.join(commonDir, 'worktrees', id);
    const pointer = readText(path.join(adminDir, 'gitdir')).trim();
    if (!pointer) continue;
    const root = path.dirname(path.resolve(adminDir, pointer));
    if (!fs.existsSync(root)) continue;
    worktrees.push({ root, branch: readBranch(adminDir), main: false });
  }
  return worktrees;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
