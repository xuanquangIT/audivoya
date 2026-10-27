// Shared CLI plumbing: usage errors, strict argument parsing, main-module detection, tables.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { samePath } from './paths.mjs';

/** Error for bad invocations; CLIs map it to exit code 2. */
export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Strict `parseArgs` wrapper that turns parse problems and wrong positional counts into UsageError.
 * @template {import('node:util').ParseArgsOptionsConfig} T
 * @param {string[]} args
 * @param {T} options
 * @param {{ min?: number, max?: number }} [positionals]
 */
export function parseCommandArgs(args, options, { min = 0, max = 0 } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const count = parsed.positionals.length;
  if (count < min) throw new UsageError('missing required argument');
  if (count > max)
    throw new UsageError(`unexpected argument "${parsed.positionals[max]}"`);
  return parsed;
}

/**
 * True when the module at `moduleUrl` is the script Node was started with.
 * Robust to Windows drive-letter casing and symlinked paths.
 * @param {string} moduleUrl `import.meta.url`
 * @returns {boolean}
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return samePath(fs.realpathSync(entry), fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Renders rows as left-aligned columns separated by two spaces.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
export function formatTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const render = (/** @type {string[]} */ cells) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column]),
      )
      .join('  ')
      .trimEnd();
  return [render(headers), ...rows.map(render)].join('\n');
}

/**
 * Compact age: `<1h`, `5h`, `3d`.
 * @param {number | null} milliseconds
 * @returns {string}
 */
export function formatAge(milliseconds) {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '-';
  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Formats a port map as `NAME=port` pairs.
 * @param {Record<string, number> | null | undefined} ports
 * @returns {string}
 */
export function formatPorts(ports) {
  return Object.entries(ports ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
}
