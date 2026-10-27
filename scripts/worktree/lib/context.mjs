// Resolves "where am I": current worktree, main checkout, workspace config, sibling worktrees.
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIG_PATH,
  findConfigFile,
  readWorkspaceConfig,
  slotFromState,
} from './config.mjs';
import { listWorktrees, resolveRoots } from './git.mjs';
import { canonicalPath, samePath } from './paths.mjs';
import { readState } from './state.mjs';

/** Cursor exports the primary checkout path to worktree setup commands under this name. */
export const MAIN_CHECKOUT_HINT_ENV = 'ROOT_WORKTREE_PATH';

/**
 * Uses `$ROOT_WORKTREE_PATH` as the main checkout when it is another checkout of the same repo
 * (harnesses that clone instead of `git worktree add`). Ignored when it points elsewhere.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} repo
 * @param {string} root Current worktree root.
 * @returns {string | null}
 */
export function mainCheckoutHint(env, repo, root) {
  const hint = env[MAIN_CHECKOUT_HINT_ENV]?.trim();
  if (!hint || !fs.existsSync(path.join(hint, '.git'))) return null;
  if (samePath(hint, root)) return null;
  const configFile = path.join(hint, CONFIG_PATH);
  if (!fs.existsSync(configFile)) return null;
  try {
    return readWorkspaceConfig(configFile).repo === repo
      ? canonicalPath(hint)
      : null;
  } catch {
    return null;
  }
}

/**
 * Loads the repository context for a directory inside any checkout of the repo.
 * Config is read from the current worktree first, then from the main checkout (so worktrees
 * cut from a base that predates `.agents/workspace.json` still work).
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {WorktreeContext}
 */
export function loadContext({ cwd = process.cwd(), env = process.env } = {}) {
  const { root, mainRoot: gitMainRoot } = resolveRoots(cwd);
  const configPath = findConfigFile([root, gitMainRoot]);
  if (!configPath)
    throw new Error(
      `No ${CONFIG_PATH} in ${root} or ${gitMainRoot}; this repository is not configured for worktree tooling`,
    );
  const config = readWorkspaceConfig(configPath);
  const hint = mainCheckoutHint(env, config.repo, root);
  const mainRoot = hint ?? gitMainRoot;
  return {
    cwd: path.resolve(cwd),
    root,
    mainRoot,
    separateMainRepo: hint !== null,
    isMain: samePath(root, mainRoot),
    config,
    configPath,
    worktreeBase: path.resolve(mainRoot, config.worktreeRoot),
  };
}

/**
 * Lists every worktree of the repository with its `.worktree.json` state.
 * @param {WorktreeContext} ctx
 * @returns {WorktreeInfo[]}
 */
export function collectWorktrees(ctx) {
  const sources = ctx.separateMainRepo ? [ctx.mainRoot, ctx.root] : [ctx.root];
  const keyOf = (/** @type {string} */ value) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  /** @type {Map<string, import('./git.mjs').WorktreeEntry>} */
  const seen = new Map();
  for (const source of sources)
    for (const entry of listWorktrees(source))
      if (!entry.bare && !seen.has(keyOf(entry.path)))
        seen.set(keyOf(entry.path), entry);
  if (ctx.separateMainRepo && !seen.has(keyOf(ctx.mainRoot)))
    seen.set(keyOf(ctx.mainRoot), {
      path: ctx.mainRoot,
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    });
  return [...seen.values()].map((entry) => {
    let state = null;
    let stateError = null;
    if (!entry.prunable && fs.existsSync(entry.path))
      try {
        state = readState(entry.path);
      } catch (error) {
        stateError = error.message;
      }
    return {
      ...entry,
      isMain: samePath(entry.path, ctx.mainRoot),
      isCurrent: samePath(entry.path, ctx.root),
      state,
      stateError,
      slot: slotFromState(state, ctx.config.ports.maxSlots),
    };
  });
}

/**
 * Finds one worktree by branch (`feat/x`), path, directory name (`feat-x`) or slug (`x`).
 * @template {{ path: string, branch: string | null }} T
 * @param {readonly T[]} worktrees
 * @param {string} query
 * @param {string} [cwd] Base for relative paths.
 * @returns {T}
 * @throws {Error} When nothing or more than one worktree matches.
 */
export function findWorktree(worktrees, query, cwd = process.cwd()) {
  const wanted = query.trim().replace(/[\\/]+$/, '');
  const target = path.resolve(cwd, wanted);
  const matchers = [
    (/** @type {T} */ w) => w.branch === wanted,
    (/** @type {T} */ w) => samePath(w.path, target),
    (/** @type {T} */ w) =>
      path.basename(w.path).toLowerCase() === wanted.toLowerCase(),
    (/** @type {T} */ w) =>
      w.branch !== null && w.branch.slice(w.branch.indexOf('/') + 1) === wanted,
  ];
  for (const matches of matchers) {
    const found = worktrees.filter(matches);
    if (found.length === 1) return found[0];
    if (found.length > 1)
      throw new Error(
        `"${query}" matches several worktrees (${found.map((w) => w.branch ?? w.path).join(', ')}); pass the full branch or path`,
      );
  }
  throw new Error(`no worktree matches "${query}" (see wt list)`);
}

/**
 * Short human label for a worktree: its branch, or its directory name when detached.
 * @param {{ branch: string | null, path: string }} worktree
 * @returns {string}
 */
export function worktreeLabel(worktree) {
  return worktree.branch ?? `${path.basename(worktree.path)} (detached)`;
}

/**
 * @typedef {object} WorktreeContext
 * @property {string} cwd
 * @property {string} root Current worktree root.
 * @property {string} mainRoot Main checkout root.
 * @property {boolean} separateMainRepo True when the main checkout came from $ROOT_WORKTREE_PATH.
 * @property {boolean} isMain
 * @property {import('./config.mjs').WorkspaceConfig} config
 * @property {string} configPath
 * @property {string} worktreeBase Absolute directory that holds `wt new` worktrees.
 */

/**
 * @typedef {import('./git.mjs').WorktreeEntry & {
 *   isMain: boolean,
 *   isCurrent: boolean,
 *   state: Record<string, unknown> | null,
 *   stateError: string | null,
 *   slot: number | null,
 * }} WorktreeInfo
 */
