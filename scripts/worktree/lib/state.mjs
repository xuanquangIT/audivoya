// Reads and writes `.worktree.json`, the gitignored per-worktree state (slot, ports, claims, task).
import fs from 'node:fs';
import path from 'node:path';
import { STATE_FILE } from './config.mjs';

/** Current `.worktree.json` schema version. */
export const STATE_VERSION = 1;

const KEY_ORDER = [
  'version',
  'repo',
  'slot',
  'branch',
  'base',
  'ports',
  'claims',
  'task',
  'createdAt',
  'owner',
];

/**
 * Reads `<root>/.worktree.json`.
 * @param {string} root Worktree root directory.
 * @returns {Record<string, unknown> | null} Parsed state, or null when the file does not exist.
 * @throws {Error} When the file exists but is not a JSON object.
 */
export function readState(root) {
  const file = path.join(root, STATE_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(
      `${file}: invalid JSON (${error.message}); run node scripts/worktree/setup.mjs to rewrite it`,
    );
  }
  if (typeof state !== 'object' || state === null || Array.isArray(state))
    throw new Error(`${file}: expected a JSON object`);
  return state;
}

/**
 * Merges updates into existing state. Undefined updates are ignored, unknown keys are kept,
 * and keys are emitted in a stable order so rewrites produce minimal diffs.
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown>} updates
 * @returns {Record<string, unknown>}
 */
export function mergeState(existing, updates) {
  /** @type {Record<string, unknown>} */
  const merged = { ...existing };
  for (const [key, value] of Object.entries(updates))
    if (value !== undefined) merged[key] = value;
  merged.version = STATE_VERSION;
  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const key of KEY_ORDER)
    if (merged[key] !== undefined) ordered[key] = merged[key];
  for (const [key, value] of Object.entries(merged))
    if (!(key in ordered)) ordered[key] = value;
  return ordered;
}

/**
 * Atomically writes `<root>/.worktree.json` (temp file + rename).
 * @param {string} root
 * @param {Record<string, unknown>} state
 * @returns {string} Path of the written file.
 */
export function writeState(root, state) {
  const file = path.join(root, STATE_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, file);
  return file;
}
