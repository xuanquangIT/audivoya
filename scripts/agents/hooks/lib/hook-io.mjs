// Shared input/output helpers for the portable agent hooks.
//
// The hooks are registered in .claude/settings.json, which Claude Code, Cursor
// and the Copilot CLI/VS Code all load, each with a slightly different JSON
// payload. Every accessor here tolerates missing or unexpected fields, and
// runHook() guarantees a hook never crashes: Copilot treats a crashing
// preToolUse hook as a denial of every shell call.
//
// Keep this module dependency-free and independent of scripts/worktree so the
// hooks keep working while those scripts are being changed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Parse hook input text. Empty, invalid or non-object JSON yields `{}`.
 * @param {unknown} text
 * @returns {Record<string, any>}
 */
export function parseHookInput(text) {
  if (typeof text !== 'string' || !text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * Read the hook payload from `stream` (stdin by default) and parse it.
 * Resolves `{}` for a TTY, an empty stream or invalid JSON. Resolves early once
 * a complete JSON object has arrived and gives up after `timeoutMs`, so a
 * harness that keeps stdin open can never hang the hook.
 * @param {{ stream?: NodeJS.ReadableStream & { isTTY?: boolean, destroy?: () => void }, timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, any>>}
 */
export function readHookInput({
  stream = process.stdin,
  timeoutMs = 1000,
} = {}) {
  if (stream.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    let text = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      stream.destroy?.();
      resolve(value ?? parseHookInput(text));
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => {
      text += chunk;
      if (!text.trimEnd().endsWith('}')) return;
      const value = parseHookInput(text);
      if (Object.keys(value).length > 0) finish(value);
    });
    stream.on('end', () => finish());
    stream.on('error', () => finish({}));
  });
}

/**
 * Directory the agent is working in: `input.cwd` (Claude Code, Copilot), then
 * Cursor's first `workspace_roots` entry, then the process directory. Never
 * uses CLAUDE_PROJECT_DIR, which stays at the main checkout when a session
 * works in a worktree.
 * @param {Record<string, any>} input
 * @param {string} [fallback]
 * @returns {string}
 */
export function hookCwd(input, fallback = process.cwd()) {
  const roots = Array.isArray(input?.workspace_roots)
    ? input.workspace_roots
    : [];
  for (const candidate of [input?.cwd, roots[0]]) {
    if (typeof candidate === 'string' && candidate && isDirectory(candidate))
      return path.resolve(candidate);
  }
  return path.resolve(fallback);
}

/**
 * Tool arguments object: Claude/Cursor `tool_input`, or Copilot `toolArgs`
 * (an object or a JSON string).
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function toolInput(input) {
  if (isRecord(input?.tool_input)) return input.tool_input;
  if (isRecord(input?.toolArgs)) return input.toolArgs;
  if (typeof input?.toolArgs === 'string')
    return parseHookInput(input.toolArgs);
  return {};
}

/**
 * Shell command of a Bash/PowerShell tool call, or '' when the event carries none.
 * @param {Record<string, any>} input
 * @returns {string}
 */
export function toolCommand(input) {
  const args = toolInput(input);
  for (const value of [args.command, input?.command]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/**
 * File path of an edit/write tool call, or '' when the event carries none.
 * @param {Record<string, any>} input
 * @returns {string}
 */
export function toolFilePath(input) {
  const args = toolInput(input);
  const response = isRecord(input?.tool_response) ? input.tool_response : {};
  for (const value of [
    args.file_path,
    args.filePath,
    args.path,
    response.filePath,
    input?.file_path,
  ]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/**
 * Nearest ancestor of `start` (inclusive) that contains a `.git` entry: a main
 * checkout (`.git` directory) or a linked worktree (`.git` file).
 * @param {string} start
 * @returns {string | null}
 */
export function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read and parse a JSON file; `null` when missing or invalid. Only use this for
 * repository config such as `.agents/workspace.json` and `.worktree.json`.
 * @param {string} file
 * @returns {any}
 */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare two paths the way the host file system does (case-insensitive on Windows).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Render a path with forward slashes for stable, copy-pasteable output.
 * @param {string} value
 * @returns {string}
 */
export function displayPath(value) {
  return value.replaceAll('\\', '/');
}

/**
 * True when `metaUrl` is the script Node was started with.
 * @param {string} metaUrl
 * @returns {boolean}
 */
export function isEntryPoint(metaUrl) {
  const script = process.argv[1];
  return (
    Boolean(script) && pathToFileURL(path.resolve(script)).href === metaUrl
  );
}

/**
 * Run a hook handler with the standard contract: parse stdin, call
 * `handler(input)`, write its `stdout`/`stderr`, exit with its `code` (default
 * 0). Any thrown error is reported on stderr and exits 0, so a hook bug never
 * blocks the agent.
 * @param {string} name
 * @param {(input: Record<string, any>) => Promise<{ code?: number, stdout?: string, stderr?: string } | void> | { code?: number, stdout?: string, stderr?: string } | void} handler
 * @returns {Promise<void>}
 */
export async function runHook(name, handler) {
  let result;
  try {
    result = (await handler(await readHookInput())) ?? {};
  } catch (error) {
    result = { code: 0, stderr: `${name}: ${firstLine(error)}\n` };
  }
  await write(process.stdout, result.stdout);
  await write(process.stderr, result.stderr);
  process.exit(result.code ?? 0);
}

function write(stream, text) {
  return new Promise((resolve) => {
    if (!text) resolve();
    else stream.write(text, () => resolve());
  });
}

function firstLine(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}
