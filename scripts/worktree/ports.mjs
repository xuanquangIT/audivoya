#!/usr/bin/env node
// Resolves this checkout's port numbers. Precedence: explicit env var > `.worktree.json` slot
// formula > legacy defaults (slot 0, used by the main checkout and CI).
// Synchronous, no git, no network: safe to import from Playwright/Vite configs and plain scripts.
// CLI: node scripts/worktree/ports.mjs [--json|--env]
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, isMainModule, parseCommandArgs } from './lib/cli.mjs';
import {
  CONFIG_PATH,
  STATE_FILE,
  portsForSlot,
  readWorkspaceConfig,
} from './lib/config.mjs';
import { readState } from './lib/state.mjs';

/**
 * Walks up from `cwd` to the nearest `.worktree.json` and `.agents/workspace.json`, stopping at
 * the first directory that contains `.git` (the worktree root).
 * @param {string} cwd
 * @returns {{ root: string | null, configPath: string | null, statePath: string | null }}
 */
export function locateWorktreeFiles(cwd) {
  let dir = path.resolve(cwd);
  let configPath = null;
  let statePath = null;
  for (;;) {
    const config = path.join(dir, CONFIG_PATH);
    const state = path.join(dir, STATE_FILE);
    if (!configPath && fs.existsSync(config)) configPath = config;
    if (!statePath && fs.existsSync(state)) statePath = state;
    if (fs.existsSync(path.join(dir, '.git')))
      return { root: dir, configPath, statePath };
    const parent = path.dirname(dir);
    if (parent === dir) return { root: null, configPath, statePath };
    dir = parent;
  }
}

/**
 * Parses an explicit port override.
 * @param {string} name
 * @param {string} raw
 * @returns {number}
 */
export function parsePortOverride(name, raw) {
  const value = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || value < 1 || value > 65535)
    throw new Error(`${name}=${raw} is not a valid port (1-65535)`);
  return value;
}

function storedPorts(state) {
  const ports = state?.ports;
  /** @type {Record<string, number>} */
  const result = {};
  if (typeof ports !== 'object' || ports === null) return result;
  for (const [name, value] of Object.entries(ports))
    if (Number.isInteger(value) && value > 0 && value <= 65535)
      result[name] = value;
  return result;
}

/**
 * Resolves the slot and port numbers for the checkout containing `cwd`.
 * @param {{ cwd?: string, env?: Readonly<Record<string, string | undefined>> }} [options]
 * @returns {{ slot: number, ports: Record<string, number> }}
 * @throws {Error} On invalid config, invalid `.worktree.json` or an invalid env override.
 */
export function resolvePorts({ cwd = process.cwd(), env = process.env } = {}) {
  const files = locateWorktreeFiles(cwd);
  const config = files.configPath
    ? readWorkspaceConfig(files.configPath)
    : null;
  const state = files.statePath
    ? readState(path.dirname(files.statePath))
    : null;
  const slot = state?.slot ?? 0;
  if (!Number.isInteger(slot) || /** @type {number} */ (slot) < 0)
    throw new Error(
      `${files.statePath}: "slot" must be a non-negative integer; rerun scripts/worktree/setup.mjs`,
    );
  const ports = config
    ? portsForSlot(config.ports, /** @type {number} */ (slot))
    : storedPorts(state);
  for (const name of Object.keys(ports)) {
    const raw = env[name];
    if (raw !== undefined && raw.trim() !== '')
      ports[name] = parsePortOverride(name, raw);
  }
  return { slot: /** @type {number} */ (slot), ports };
}

/**
 * Resolves one named port, e.g. `port('AUDIVOYA_DEV_PORT')`.
 * @param {string} name
 * @param {{ cwd?: string, env?: Readonly<Record<string, string | undefined>> }} [options]
 * @returns {number}
 * @throws {Error} When the name is not configured.
 */
export function port(name, options) {
  const { ports } = resolvePorts(options);
  const value = ports[name];
  if (value === undefined)
    throw new Error(
      `Unknown port "${name}" (configured: ${Object.keys(ports).join(', ') || 'none'}); see ${CONFIG_PATH}`,
    );
  return value;
}

/**
 * CLI entry point.
 * @param {string[]} [argv]
 * @returns {number} Exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const { values } = parseCommandArgs(argv, {
    json: { type: 'boolean' },
    env: { type: 'boolean' },
  });
  if (values.json && values.env)
    throw new UsageError('use either --json or --env');
  const { slot, ports } = resolvePorts();
  if (values.json) console.log(JSON.stringify({ slot, ports }, null, 2));
  else if (values.env)
    for (const [name, value] of Object.entries(ports))
      console.log(`${name}=${value}`);
  else {
    console.log(`slot ${slot}${slot === 0 ? ' (legacy defaults)' : ''}`);
    for (const [name, value] of Object.entries(ports))
      console.log(`${name.padEnd(28)} ${value}`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`ports: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
