// Parity check for the shared scripts that sibling repositories vendor byte-for-byte.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, readWorkspaceConfig } from './config.mjs';
import { samePath } from './paths.mjs';

/** Directories every configured repository vendors from the upstream (ext) repository. */
export const SHARED_DIRS = Object.freeze([
  'scripts/worktree',
  'scripts/agents',
]);

function walk(dir, relative, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    const rel = `${relative}/${entry.name}`;
    if (entry.isDirectory()) walk(full, rel, out);
    else if (entry.isFile()) out.push([rel, full]);
  }
}

/**
 * SHA-256 of every shared file, keyed by repo-relative path. CRLF is normalized to LF so a
 * checkout converted by `core.autocrlf` still compares equal to its LF twin.
 * @param {string} root
 * @param {readonly string[]} [dirs]
 * @returns {Map<string, string>}
 */
export function hashSharedFiles(root, dirs = SHARED_DIRS) {
  /** @type {Array<[string, string]>} */
  const files = [];
  for (const dir of dirs) walk(path.join(root, dir), dir, files);
  const hashes = new Map();
  for (const [rel, full] of files.sort(([a], [b]) => a.localeCompare(b))) {
    const text = fs
      .readFileSync(full)
      .toString('latin1')
      .replaceAll('\r\n', '\n');
    hashes.set(rel, createHash('sha256').update(text, 'latin1').digest('hex'));
  }
  return hashes;
}

/**
 * Compares two hash maps from `hashSharedFiles`.
 * @param {Map<string, string>} ours
 * @param {Map<string, string>} theirs
 * @returns {{ onlyOurs: string[], onlyTheirs: string[], different: string[] }}
 */
export function compareSharedFiles(ours, theirs) {
  const onlyOurs = [...ours.keys()].filter((file) => !theirs.has(file));
  const onlyTheirs = [...theirs.keys()].filter((file) => !ours.has(file));
  const different = [...ours.keys()].filter(
    (file) => theirs.has(file) && theirs.get(file) !== ours.get(file),
  );
  return { onlyOurs, onlyTheirs, different };
}

/**
 * Finds sibling checkouts (same parent directory) of other configured repositories that carry
 * the shared worktree scripts.
 * @param {string} mainRoot
 * @param {string} repo This repository's id; siblings with the same id are skipped.
 * @returns {Array<{ root: string, repo: string }>}
 */
export function findSiblingCheckouts(mainRoot, repo) {
  const parent = path.dirname(mainRoot);
  const siblings = [];
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return siblings;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(parent, entry.name);
    if (samePath(root, mainRoot)) continue;
    const configFile = path.join(root, CONFIG_PATH);
    if (!fs.existsSync(path.join(root, 'scripts', 'worktree', 'wt.mjs')))
      continue;
    if (!fs.existsSync(configFile)) continue;
    try {
      const sibling = readWorkspaceConfig(configFile).repo;
      if (sibling !== repo) siblings.push({ root, repo: sibling });
    } catch {
      // An invalid sibling configuration is that repository's doctor's problem.
    }
  }
  return siblings;
}
