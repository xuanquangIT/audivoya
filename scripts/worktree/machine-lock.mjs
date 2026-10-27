#!/usr/bin/env node
// Machine-wide mutual exclusion for commands that share a host resource (installed-extension
// audio capture, port-slot allocation). Usage:
//   node scripts/worktree/machine-lock.mjs <name> [--timeout-min 30] -- <command...>
// The lock is an atomic mkdir in os.tmpdir(); a holder whose pid is dead or who is older than
// the timeout is stale and replaced. The command runs through a shell with inherited stdio and
// its exit code is propagated. Nested invocations for a lock already held by an ancestor run
// directly instead of deadlocking.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { UsageError, isMainModule, parseCommandArgs } from './lib/cli.mjs';

/** Prefix of lock directories under the lock root. */
export const LOCK_PREFIX = 'audivoya-lock-';
/** Env var listing `name:pid` locks held by ancestor processes (re-entrancy). */
export const HELD_LOCKS_ENV = 'AUDIVOYA_LOCKS_HELD';
/** Default stale timeout in minutes. */
export const DEFAULT_TIMEOUT_MIN = 30;

const LOCK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER_FILE = 'owner.json';
const DEFAULT_POLL_MS = 2000;
// A lock directory without a readable owner.json is still being created during this window.
const CREATION_GRACE_MS = 10_000;

/**
 * Absolute directory used for the named lock.
 * @param {string} name
 * @param {string} [lockRoot]
 * @returns {string}
 */
export function lockDirectory(name, lockRoot = os.tmpdir()) {
  if (!LOCK_NAME.test(name))
    throw new UsageError(
      `invalid lock name "${name}" (lowercase a-z, 0-9, single hyphens)`,
    );
  return path.join(lockRoot, `${LOCK_PREFIX}${name}`);
}

/**
 * Reads the lock owner record, or null when missing or unreadable.
 * @param {string} dir
 * @returns {LockOwner | null}
 */
export function readOwner(dir) {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'),
    );
    return typeof owner === 'object' && owner !== null ? owner : null;
  } catch {
    return null;
  }
}

/**
 * True when a process with this pid exists (EPERM means it exists but belongs to someone else).
 * @param {unknown} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || /** @type {number} */ (pid) <= 0) return false;
  try {
    process.kill(/** @type {number} */ (pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function ageOf(dir, now) {
  try {
    return now - fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Decides whether an existing lock may be replaced.
 * @param {LockOwner | null} owner
 * @param {{ now: number, timeoutMs: number, dirAgeMs: number, isAlive?: (pid: unknown) => boolean }} options
 * @returns {boolean}
 */
export function isStale(
  owner,
  { now, timeoutMs, dirAgeMs, isAlive = isProcessAlive },
) {
  if (!owner) return dirAgeMs > CREATION_GRACE_MS;
  if (!isAlive(owner.pid)) return true;
  const started = Date.parse(String(owner.startedAt));
  return !Number.isFinite(started) || now - started > timeoutMs;
}

function sameOwner(a, b) {
  if (!a || !b) return a === b;
  return a.pid === b.pid && a.startedAt === b.startedAt;
}

// Only the holder of `<dir>.steal` may delete a stale lock, and it re-checks the owner first,
// so two waiters can never both delete-and-recreate the lock.
function removeStaleLock(dir, judgedOwner, now) {
  const guard = `${dir}.steal`;
  try {
    fs.mkdirSync(guard);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (ageOf(guard, now) > CREATION_GRACE_MS)
      fs.rmSync(guard, { recursive: true, force: true });
    return false;
  }
  try {
    if (!sameOwner(readOwner(dir), judgedOwner)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * Makes one attempt to take the lock, replacing it when stale.
 * @param {string} name
 * @param {LockOptions} [options]
 * @returns {{ acquired: true, lock: Lock } | { acquired: false, owner: LockOwner | null }}
 */
export function tryAcquire(name, options = {}) {
  const {
    lockRoot = os.tmpdir(),
    timeoutMin = DEFAULT_TIMEOUT_MIN,
    cwd = process.cwd(),
    now = Date.now,
  } = options;
  const dir = lockDirectory(name, lockRoot);
  const create = () => {
    try {
      fs.mkdirSync(dir);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  };
  if (!create()) {
    const owner = readOwner(dir);
    const time = now();
    const stale = isStale(owner, {
      now: time,
      timeoutMs: timeoutMin * 60_000,
      dirAgeMs: ageOf(dir, time),
    });
    if (!stale || !removeStaleLock(dir, owner, time) || !create())
      return { acquired: false, owner: readOwner(dir) ?? owner };
  }
  const owner = {
    pid: process.pid,
    cwd,
    startedAt: new Date(now()).toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, OWNER_FILE),
    `${JSON.stringify(owner, null, 2)}\n`,
  );
  return { acquired: true, lock: { name, dir, owner, reentrant: false } };
}

/**
 * Parses `name:pid` entries from the re-entrancy env var.
 * @param {string | undefined} value
 * @returns {Map<string, number>}
 */
export function parseHeldLocks(value) {
  const held = new Map();
  for (const item of String(value ?? '').split(',')) {
    const [name, pid] = item.split(':');
    if (name && Number.isInteger(Number(pid))) held.set(name, Number(pid));
  }
  return held;
}

function heldByAncestor(name, dir, env) {
  const pid = parseHeldLocks(env[HELD_LOCKS_ENV]).get(name);
  const owner = readOwner(dir);
  return pid !== undefined && owner?.pid === pid && isProcessAlive(pid)
    ? owner
    : null;
}

/**
 * Waits until the lock is acquired, polling and printing a single "waiting" message.
 * @param {string} name
 * @param {LockOptions} [options]
 * @returns {Promise<Lock>}
 */
export async function acquireLock(name, options = {}) {
  const {
    lockRoot = os.tmpdir(),
    pollMs = DEFAULT_POLL_MS,
    env = process.env,
    log = (/** @type {string} */ message) => console.error(message),
  } = options;
  const dir = lockDirectory(name, lockRoot);
  const ancestor = heldByAncestor(name, dir, env);
  if (ancestor) return { name, dir, owner: ancestor, reentrant: true };
  let announced = false;
  for (;;) {
    const attempt = tryAcquire(name, options);
    if (attempt.acquired) return attempt.lock;
    if (!announced) {
      const owner = attempt.owner;
      log(
        owner
          ? `machine-lock: waiting for "${name}" held by pid ${owner.pid} in ${owner.cwd} since ${owner.startedAt}`
          : `machine-lock: waiting for "${name}" (${dir})`,
      );
      announced = true;
    }
    await delay(pollMs);
  }
}

/**
 * Releases a lock if this process still owns it. Safe to call repeatedly.
 * @param {Lock} lock
 * @returns {boolean} True when the lock directory was removed.
 */
export function releaseLock(lock) {
  if (lock.reentrant) return false;
  if (!sameOwner(readOwner(lock.dir), lock.owner)) return false;
  fs.rmSync(lock.dir, { recursive: true, force: true });
  return true;
}

/**
 * Runs `fn` while holding the named lock; always releases, even when `fn` throws.
 * @template T
 * @param {string} name
 * @param {(lock: Lock) => T | Promise<T>} fn
 * @param {LockOptions} [options]
 * @returns {Promise<T>}
 */
export async function withLock(name, fn, options = {}) {
  const lock = await acquireLock(name, options);
  try {
    return await fn(lock);
  } finally {
    releaseLock(lock);
  }
}

function signalExitCode(signal) {
  return 128 + (os.constants.signals[signal] ?? 0);
}

/**
 * Runs a shell command while holding `lock`; resolves with the command's exit code.
 * The lock is released on child exit, on SIGINT/SIGTERM/SIGHUP and on process exit.
 * @param {Lock} lock
 * @param {string} commandLine
 * @returns {Promise<number>}
 */
export function runLocked(lock, commandLine) {
  return new Promise((resolve) => {
    const held = parseHeldLocks(process.env[HELD_LOCKS_ENV]);
    held.set(lock.name, lock.owner.pid);
    const env = {
      ...process.env,
      [HELD_LOCKS_ENV]: [...held].map(([n, pid]) => `${n}:${pid}`).join(','),
    };
    const release = () => releaseLock(lock);
    process.once('exit', release);
    const child = spawn(commandLine, { shell: true, stdio: 'inherit', env });
    let signals = 0;
    const onSignal = (/** @type {NodeJS.Signals} */ signal) => {
      signals += 1;
      if (signals > 1) {
        child.kill('SIGKILL');
        release();
        process.exit(signalExitCode(signal));
      }
      const forward = () => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill(signal);
      };
      // Ctrl+C already reaches the child's process group; give it time to stop cleanly.
      if (signal === 'SIGINT') setTimeout(forward, 2000).unref();
      else forward();
    };
    const handled = /** @type {NodeJS.Signals[]} */ ([
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
    ]);
    for (const signal of handled) process.on(signal, onSignal);
    const finish = (/** @type {number} */ code) => {
      for (const signal of handled) process.off(signal, onSignal);
      release();
      process.off('exit', release);
      resolve(code);
    };
    child.once('error', (error) => {
      console.error(`machine-lock: could not start command: ${error.message}`);
      finish(1);
    });
    child.once('exit', (code, signal) =>
      finish(code ?? (signal ? signalExitCode(signal) : 1)),
    );
  });
}

const USAGE =
  'Usage: node scripts/worktree/machine-lock.mjs <name> [--timeout-min 30] -- <command...>';

/**
 * CLI entry point.
 * @param {string[]} [argv]
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const separator = argv.indexOf('--');
  if (separator === -1)
    throw new UsageError('missing "--" before the command to run');
  const { values, positionals } = parseCommandArgs(
    argv.slice(0, separator),
    { 'timeout-min': { type: 'string' } },
    { min: 1, max: 1 },
  );
  const timeoutMin = Number(values['timeout-min'] ?? DEFAULT_TIMEOUT_MIN);
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0)
    throw new UsageError('--timeout-min must be a positive number');
  const command = argv.slice(separator + 1);
  if (command.length === 0) throw new UsageError('missing command after "--"');
  const lock = await acquireLock(positionals[0], { timeoutMin });
  return runLocked(lock, command.join(' '));
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const usage = error instanceof UsageError;
    console.error(`machine-lock: ${error.message}${usage ? `\n${USAGE}` : ''}`);
    process.exitCode = usage ? 2 : 1;
  }
}

/**
 * @typedef {{ pid: number, cwd: string, startedAt: string }} LockOwner
 * @typedef {{ name: string, dir: string, owner: LockOwner, reentrant: boolean }} Lock
 * @typedef {object} LockOptions
 * @property {string} [lockRoot] Directory holding lock directories (default os.tmpdir()).
 * @property {number} [timeoutMin] Holders older than this are stale (default 30).
 * @property {number} [pollMs] Wait between attempts (default 2000).
 * @property {string} [cwd] Recorded in owner.json (default process.cwd()).
 * @property {() => number} [now] Clock for tests.
 * @property {NodeJS.ProcessEnv} [env] Environment consulted for re-entrancy.
 * @property {(message: string) => void} [log] Receives the single waiting message.
 */
