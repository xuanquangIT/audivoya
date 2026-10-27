// Loads and validates `.agents/workspace.json`, the per-repository worktree contract, and owns
// the port-slot formula. Synchronous and free of git/network calls so config files can import it.
import fs from 'node:fs';
import path from 'node:path';
import { isBranchName } from './names.mjs';

/** Repository-relative location of the worktree configuration. */
export const CONFIG_PATH = '.agents/workspace.json';
/** File name of the gitignored per-worktree state written at each linked worktree root. */
export const STATE_FILE = '.worktree.json';
/** Port distance between consecutive slots; every offset must stay below it. */
export const SLOT_STRIDE = 100;
/** Command tokens that need no quoting in POSIX shells or cmd.exe. */
export const SAFE_COMMAND_TOKEN = /^[\w@+=:,./-]+$/;

const REPO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PORT_NAME = /^[A-Z][A-Z0-9_]*$/;
const LOCK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOP_LEVEL_KEYS = [
  '$schema',
  'repo',
  'baseBranch',
  'protectedBranches',
  'worktreeRoot',
  'copyFromMain',
  'install',
  'ports',
  'locks',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * True for a non-empty relative path. `..` segments are rejected unless `allowParent` is set.
 * @param {unknown} value
 * @param {{ allowParent?: boolean }} [options]
 * @returns {boolean}
 */
export function isRelativePath(value, { allowParent = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))
    return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return allowParent || !segments.includes('..');
}

function validatePorts(ports) {
  if (!isPlainObject(ports)) return ['"ports" must be an object'];
  const errors = [];
  for (const key of Object.keys(ports))
    if (!['slotBase', 'maxSlots', 'names'].includes(key))
      errors.push(`unknown key "ports.${key}"`);
  if (!isInteger(ports.slotBase, 1024, 65535))
    errors.push('"ports.slotBase" must be an integer between 1024 and 65535');
  if (!isInteger(ports.maxSlots, 1, 500))
    errors.push('"ports.maxSlots" must be an integer between 1 and 500');
  if (!isPlainObject(ports.names) || Object.keys(ports.names).length === 0)
    return [...errors, '"ports.names" must be a non-empty object'];

  const offsets = new Map();
  let maxOffset = 0;
  for (const [name, entry] of Object.entries(ports.names)) {
    const where = `"ports.names.${name}"`;
    if (!PORT_NAME.test(name))
      errors.push(`${where}: name must be UPPER_SNAKE_CASE`);
    if (!isPlainObject(entry)) {
      errors.push(`${where} must be an object { legacy, offset }`);
      continue;
    }
    for (const key of Object.keys(entry))
      if (!['legacy', 'offset'].includes(key))
        errors.push(`${where}: unknown key "${key}"`);
    if (!isInteger(entry.legacy, 1, 65535))
      errors.push(`${where}.legacy must be a port number (1-65535)`);
    if (!isInteger(entry.offset, 0, SLOT_STRIDE - 1)) {
      errors.push(
        `${where}.offset must be an integer between 0 and ${SLOT_STRIDE - 1}`,
      );
      continue;
    }
    if (offsets.has(entry.offset))
      errors.push(
        `${where}.offset ${entry.offset} duplicates ${offsets.get(entry.offset)}`,
      );
    offsets.set(entry.offset, name);
    maxOffset = Math.max(maxOffset, entry.offset);
  }
  if (errors.length === 0) {
    const highest = ports.slotBase + ports.maxSlots * SLOT_STRIDE + maxOffset;
    if (highest > 65535)
      errors.push(
        `slot ${ports.maxSlots} would use port ${highest}; lower "ports.slotBase" or "ports.maxSlots"`,
      );
  }
  return errors;
}

/**
 * Validates a parsed workspace configuration.
 * @param {unknown} config
 * @returns {string[]} Problems found; empty when valid.
 */
export function validateWorkspaceConfig(config) {
  if (!isPlainObject(config)) return ['configuration must be a JSON object'];
  const errors = [];
  for (const key of Object.keys(config))
    if (!TOP_LEVEL_KEYS.includes(key)) errors.push(`unknown key "${key}"`);
  if (config.$schema !== undefined && typeof config.$schema !== 'string')
    errors.push('"$schema" must be a string');
  if (typeof config.repo !== 'string' || !REPO_ID.test(config.repo))
    errors.push('"repo" must be a lowercase id (a-z, 0-9, single hyphens)');
  if (!isBranchName(config.baseBranch))
    errors.push('"baseBranch" must be a branch name');
  if (
    !Array.isArray(config.protectedBranches) ||
    !config.protectedBranches.every(isBranchName)
  )
    errors.push('"protectedBranches" must be an array of branch names');
  if (!isRelativePath(config.worktreeRoot, { allowParent: true }))
    errors.push(
      '"worktreeRoot" must be a path relative to the main checkout root',
    );
  if (
    config.copyFromMain !== undefined &&
    (!Array.isArray(config.copyFromMain) ||
      !config.copyFromMain.every((entry) => isRelativePath(entry)))
  )
    errors.push(
      '"copyFromMain" must be an array of repo-relative file paths without ".."',
    );
  if (
    config.install !== undefined &&
    (!Array.isArray(config.install) ||
      config.install.length === 0 ||
      !config.install.every(
        (token) => typeof token === 'string' && SAFE_COMMAND_TOKEN.test(token),
      ))
  )
    errors.push(
      '"install" must be a non-empty argv array of plain tokens (letters, digits, @+=:,./_-)',
    );
  errors.push(...validatePorts(config.ports));
  if (config.locks !== undefined) {
    if (!isPlainObject(config.locks)) errors.push('"locks" must be an object');
    else
      for (const [name, description] of Object.entries(config.locks)) {
        if (!LOCK_NAME.test(name))
          errors.push(`"locks.${name}": lock names are lowercase ids`);
        if (typeof description !== 'string')
          errors.push(`"locks.${name}" must be a description string`);
      }
  }
  return errors;
}

/**
 * Parses and validates workspace configuration text; applies defaults for optional keys.
 * @param {string} text
 * @param {string} [source] Label used in error messages.
 * @returns {WorkspaceConfig}
 */
export function parseWorkspaceConfig(text, source = CONFIG_PATH) {
  let config;
  try {
    config = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`${source}: invalid JSON (${error.message})`);
  }
  const errors = validateWorkspaceConfig(config);
  if (errors.length)
    throw new Error(`${source} is invalid:\n  - ${errors.join('\n  - ')}`);
  return {
    ...config,
    copyFromMain: config.copyFromMain ?? [],
    install: config.install ?? null,
    locks: config.locks ?? {},
  };
}

/**
 * Reads and validates a workspace configuration file.
 * @param {string} file Absolute path to `.agents/workspace.json`.
 * @returns {WorkspaceConfig}
 */
export function readWorkspaceConfig(file) {
  return parseWorkspaceConfig(fs.readFileSync(file, 'utf8'), file);
}

/**
 * Returns the first existing `.agents/workspace.json` among the given roots.
 * @param {readonly string[]} roots
 * @returns {string | null}
 */
export function findConfigFile(roots) {
  for (const root of roots) {
    const candidate = path.join(root, CONFIG_PATH);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Port numbers for a slot: slot 0 keeps the legacy defaults, slot N uses
 * `slotBase + N * 100 + offset`.
 * @param {WorkspaceConfig['ports']} ports
 * @param {number} slot
 * @returns {Record<string, number>}
 */
export function portsForSlot(ports, slot) {
  if (!isInteger(slot, 0, ports.maxSlots))
    throw new RangeError(
      `slot ${slot} is outside 0-${ports.maxSlots}; rerun scripts/worktree/setup.mjs`,
    );
  /** @type {Record<string, number>} */
  const result = {};
  for (const [name, { legacy, offset }] of Object.entries(ports.names))
    result[name] =
      slot === 0 ? legacy : ports.slotBase + slot * SLOT_STRIDE + offset;
  return result;
}

/**
 * Reads a valid slot from worktree state.
 * @param {Record<string, unknown> | null | undefined} state
 * @param {number} maxSlots
 * @returns {number | null} The slot, or null when absent or out of range.
 */
export function slotFromState(state, maxSlots) {
  const slot = state?.slot;
  return isInteger(slot, 0, maxSlots) ? /** @type {number} */ (slot) : null;
}

/**
 * @typedef {object} WorkspaceConfig
 * @property {string} repo
 * @property {string} baseBranch
 * @property {string[]} protectedBranches
 * @property {string} worktreeRoot
 * @property {string[]} copyFromMain
 * @property {string[] | null} install
 * @property {{ slotBase: number, maxSlots: number, names: Record<string, { legacy: number, offset: number }> }} ports
 * @property {Record<string, string>} locks
 */
