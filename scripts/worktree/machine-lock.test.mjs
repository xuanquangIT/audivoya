import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HELD_LOCKS_ENV,
  acquireLock,
  isProcessAlive,
  isStale,
  lockDirectory,
  parseHeldLocks,
  readOwner,
  releaseLock,
  shellLine,
  tryAcquire,
  withLock,
} from './machine-lock.mjs';

const lockScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'machine-lock.mjs',
);

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function deadPid() {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  return child.pid;
}

function plantOwner(lockRoot, name, owner) {
  const dir = lockDirectory(name, lockRoot);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner));
  return dir;
}

test('lock names are validated', () => {
  assert.throws(() => lockDirectory('Capture'), /invalid lock name/);
  assert.throws(() => lockDirectory('../x'), /invalid lock name/);
  assert.match(lockDirectory('capture', '/tmp'), /audivoya-lock-capture$/);
});

test('tryAcquire writes owner.json and a second attempt sees the live owner', (t) => {
  const lockRoot = tempRoot(t);
  const first = tryAcquire('demo', { lockRoot, cwd: '/work/a' });
  assert.equal(first.acquired, true);
  const owner = readOwner(lockDirectory('demo', lockRoot));
  assert.equal(owner?.pid, process.pid);
  assert.equal(owner?.cwd, '/work/a');
  const second = tryAcquire('demo', { lockRoot });
  assert.equal(second.acquired, false);
  assert.equal(second.acquired === false && second.owner?.cwd, '/work/a');
  assert.equal(first.acquired && releaseLock(first.lock), true);
  assert.equal(fs.existsSync(lockDirectory('demo', lockRoot)), false);
});

test('a lock whose owner process is dead is replaced', (t) => {
  const lockRoot = tempRoot(t);
  const pid = deadPid();
  assert.equal(isProcessAlive(pid), false);
  plantOwner(lockRoot, 'demo', {
    pid,
    cwd: '/old',
    startedAt: new Date().toISOString(),
  });
  const attempt = tryAcquire('demo', { lockRoot });
  assert.equal(attempt.acquired, true);
  assert.equal(readOwner(lockDirectory('demo', lockRoot))?.pid, process.pid);
});

test('a lock older than the timeout is replaced even if its pid is alive', (t) => {
  const lockRoot = tempRoot(t);
  const startedAt = new Date(Date.now() - 31 * 60_000).toISOString();
  plantOwner(lockRoot, 'demo', { pid: process.pid, cwd: '/old', startedAt });
  assert.equal(
    tryAcquire('demo', { lockRoot, timeoutMin: 60 }).acquired,
    false,
  );
  assert.equal(tryAcquire('demo', { lockRoot, timeoutMin: 30 }).acquired, true);
});

test('isStale treats a missing owner.json as in-creation until the grace period passes', () => {
  const now = Date.now();
  assert.equal(
    isStale(null, { now, timeoutMs: 60_000, dirAgeMs: 1_000 }),
    false,
  );
  assert.equal(
    isStale(null, { now, timeoutMs: 60_000, dirAgeMs: 60_000 }),
    true,
  );
  const owner = { pid: 1, cwd: '/', startedAt: new Date(now).toISOString() };
  assert.equal(
    isStale(owner, {
      now,
      timeoutMs: 60_000,
      dirAgeMs: 0,
      isAlive: () => true,
    }),
    false,
  );
  assert.equal(
    isStale(owner, {
      now,
      timeoutMs: 60_000,
      dirAgeMs: 0,
      isAlive: () => false,
    }),
    true,
  );
  assert.equal(
    isStale(
      { ...owner, startedAt: 'garbage' },
      { now, timeoutMs: 60_000, dirAgeMs: 0, isAlive: () => true },
    ),
    true,
  );
});

test('releaseLock never removes a lock that another process took over', (t) => {
  const lockRoot = tempRoot(t);
  const attempt = tryAcquire('demo', { lockRoot });
  assert.ok(attempt.acquired);
  fs.writeFileSync(
    path.join(attempt.lock.dir, 'owner.json'),
    JSON.stringify({
      pid: process.pid,
      cwd: '/x',
      startedAt: '2000-01-01T00:00:00.000Z',
    }),
  );
  assert.equal(releaseLock(attempt.lock), false);
  assert.equal(fs.existsSync(attempt.lock.dir), true);
});

test('withLock waits for the holder, logs once, returns the result and releases on throw', async (t) => {
  const lockRoot = tempRoot(t);
  const holder = tryAcquire('demo', { lockRoot });
  assert.ok(holder.acquired);
  const messages = [];
  const waiting = withLock('demo', () => 'done', {
    lockRoot,
    pollMs: 10,
    env: {},
    log: (message) => messages.push(message),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  releaseLock(holder.lock);
  assert.equal(await waiting, 'done');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /waiting for "demo" held by pid \d+/);
  await assert.rejects(
    withLock(
      'demo',
      () => {
        throw new Error('boom');
      },
      { lockRoot, env: {} },
    ),
    /boom/,
  );
  assert.equal(fs.existsSync(lockDirectory('demo', lockRoot)), false);
});

test('a lock held by an ancestor (env marker + live owner) is re-entrant', async (t) => {
  const lockRoot = tempRoot(t);
  const holder = tryAcquire('demo', { lockRoot });
  assert.ok(holder.acquired);
  const env = { [HELD_LOCKS_ENV]: `other:1,demo:${process.pid}` };
  const nested = await acquireLock('demo', { lockRoot, env, pollMs: 10 });
  assert.equal(nested.reentrant, true);
  assert.equal(releaseLock(nested), false);
  assert.equal(fs.existsSync(holder.lock.dir), true);
  assert.deepEqual(
    [...parseHeldLocks('a:1,bad,b:x,c:3')],
    [
      ['a', 1],
      ['c', 3],
    ],
  );
});

test('CLI runs the command under the lock and propagates its exit code', (t) => {
  const name = `test-${process.pid}-${Date.now()}`;
  t.after(() =>
    fs.rmSync(lockDirectory(name), { recursive: true, force: true }),
  );
  const command = `"${process.execPath}" -e "process.exit(fs.existsSync(process.argv[1]) ? 7 : 1)" "${path.join(lockDirectory(name), 'owner.json')}"`;
  const run = spawnSync(process.execPath, [lockScript, name, '--', command], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 7, run.stderr);
  assert.equal(
    fs.existsSync(lockDirectory(name)),
    false,
    'lock released after exit',
  );
  const usage = spawnSync(process.execPath, [lockScript, name, 'echo'], {
    encoding: 'utf8',
  });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /missing "--"/);
});

test('shellLine keeps a single shell line verbatim and quotes split tokens', () => {
  const line = 'npm run build && playwright test';
  assert.equal(shellLine([line], 'win32'), line);
  assert.equal(shellLine([line], 'linux'), line);
  const tokens = ['node', '-e', 'console.log( 1 )', 'a b', '--grep=x'];
  assert.equal(
    shellLine(tokens, 'win32'),
    'node -e "console.log( 1 )" "a b" --grep=x',
  );
  assert.equal(
    shellLine(tokens, 'linux'),
    "node -e 'console.log( 1 )' 'a b' --grep=x",
  );
  assert.equal(shellLine(['echo', "it's"], 'linux'), "echo 'it'\\''s'");
});

test('CLI keeps arguments that contain spaces intact', (t) => {
  const name = `test-args-${process.pid}-${Date.now()}`;
  t.after(() =>
    fs.rmSync(lockDirectory(name), { recursive: true, force: true }),
  );
  const run = spawnSync(
    process.execPath,
    [
      lockScript,
      name,
      '--',
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      'a b',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\["a b"\]/);
});
