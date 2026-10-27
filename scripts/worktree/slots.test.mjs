import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nodeMatchesNvmrc, parseGitVersion } from './lib/cmd-doctor.mjs';
import {
  mergedPullRequestHeads,
  removalFailureMessage,
} from './lib/cmd-remove.mjs';
import { findWorktree } from './lib/context.mjs';
import { firstLine, parseWorktreeList } from './lib/git.mjs';
import { shellCommandLine } from './lib/exec.mjs';
import { allocateSlot, isPortFree } from './lib/slots.mjs';
import { compareSharedFiles, hashSharedFiles } from './lib/vendor.mjs';
import { detectOwner, installDecision } from './setup.mjs';

const ports = {
  slotBase: 24000,
  maxSlots: 5,
  names: {
    A_PORT: { legacy: 4173, offset: 73 },
    B_PORT: { legacy: 4180, offset: 80 },
  },
};

test('allocateSlot picks the lowest slot not taken and with every port free', async () => {
  assert.equal(await allocateSlot({ ports, taken: [], isFree: () => true }), 1);
  assert.equal(
    await allocateSlot({ ports, taken: [1, 2], isFree: () => true }),
    3,
  );
  // Slot 3's second port is held by some other process.
  const busy = new Set([24380]);
  assert.equal(
    await allocateSlot({
      ports,
      taken: [1, 2],
      isFree: (port) => !busy.has(port),
    }),
    4,
  );
  assert.equal(
    await allocateSlot({ ports, taken: [1, 2, 3, 4, 5], isFree: () => true }),
    null,
  );
  assert.equal(await allocateSlot({ ports, isFree: async () => false }), null);
});

test('isPortFree detects a bound loopback port', async (t) => {
  const server = net.createServer();
  await new Promise((resolve) =>
    server.listen({ port: 0, host: '127.0.0.1' }, resolve),
  );
  t.after(() => server.close());
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  assert.equal(await isPortFree(port), false);
});

test('installDecision installs only when node_modules is missing or stale', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const command = ['npm', 'ci'];
  assert.deepEqual(installDecision({ root, command }), {
    run: false,
    reason: 'no package.json',
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  assert.equal(installDecision({ root, command, mode: 'never' }).run, false);
  assert.equal(installDecision({ root, command: null }).run, false);
  assert.deepEqual(installDecision({ root, command }), {
    run: true,
    reason: 'node_modules missing',
  });
  fs.mkdirSync(path.join(root, 'node_modules'));
  assert.match(
    installDecision({ root, command }).reason,
    /\.package-lock\.json missing/,
  );
  const hidden = path.join(root, 'node_modules', '.package-lock.json');
  const lock = path.join(root, 'package-lock.json');
  const tree = { 'node_modules/a': { version: '1.0.0' } };
  // Optional platform packages are absent on other platforms; workspace links
  // (keys outside node_modules/) are not part of the installed tree.
  fs.writeFileSync(
    lock,
    JSON.stringify({
      packages: {
        '': {},
        ...tree,
        'node_modules/win-only': { version: '2.0.0', optional: true },
        'packages/core': { name: 'core' },
      },
    }),
  );
  fs.writeFileSync(hidden, JSON.stringify({ packages: tree }));
  // Touching the lockfile (checkout, rebase) must not trigger a reinstall.
  fs.utimesSync(lock, new Date('2026-01-03'), new Date('2026-01-03'));
  fs.utimesSync(hidden, new Date('2026-01-02'), new Date('2026-01-02'));
  assert.deepEqual(installDecision({ root, command }), {
    run: false,
    reason: 'node_modules up to date',
  });
  assert.equal(installDecision({ root, command, mode: 'always' }).run, true);
  fs.writeFileSync(
    lock,
    JSON.stringify({
      packages: { '': {}, 'node_modules/a': { version: '1.1.0' } },
    }),
  );
  assert.match(
    installDecision({ root, command }).reason,
    /package-lock.json differs/,
  );
  fs.writeFileSync(hidden, 'not json');
  assert.equal(installDecision({ root, command }).run, true);
});

test('detectOwner recognizes harness worktree folders on either separator', () => {
  assert.equal(detectOwner('D:\\repo\\.claude\\worktrees\\x', {}), 'claude');
  assert.equal(detectOwner('/home/u/.codex/worktrees/abc/repo', {}), 'codex');
  assert.equal(detectOwner('/home/u/.cursor/worktrees/repo/abc', {}), 'cursor');
  assert.equal(
    detectOwner('/work/worktrees/ext/feat-x', { CLAUDECODE: '1' }),
    'claude',
  );
  assert.equal(detectOwner('/work/worktrees/ext/feat-x', {}), undefined);
});

test('parseWorktreeList reads -z and newline porcelain including flags', () => {
  const z = [
    'worktree D:/repo',
    'HEAD aaa',
    'branch refs/heads/develop',
    '',
    'worktree D:/worktrees/ext/feat-x',
    'HEAD bbb',
    'branch refs/heads/feat/x',
    'locked',
    '',
    'worktree D:/worktrees/ext/gone',
    'HEAD ccc',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    '',
  ].join('\0');
  const entries = parseWorktreeList(z);
  assert.deepEqual(
    entries.map((e) => [e.path, e.branch, e.locked, e.detached, e.prunable]),
    [
      ['D:/repo', 'develop', false, false, false],
      ['D:/worktrees/ext/feat-x', 'feat/x', true, false, false],
      ['D:/worktrees/ext/gone', null, false, true, true],
    ],
  );
  const lines =
    'worktree /r\nbare\n\nworktree /r/w\nHEAD d\nbranch refs/heads/fix/y\n';
  assert.deepEqual(
    parseWorktreeList(lines).map((e) => [e.path, e.bare, e.branch]),
    [
      ['/r', true, null],
      ['/r/w', false, 'fix/y'],
    ],
  );
});

test('findWorktree matches branch, directory, slug and path; ambiguity is an error', () => {
  const base = path.resolve(os.tmpdir(), 'wt-find');
  const worktrees = [
    { path: path.join(base, 'main'), branch: 'develop' },
    { path: path.join(base, 'feat-alpha'), branch: 'feat/alpha' },
    { path: path.join(base, 'fix-alpha'), branch: 'fix/alpha' },
    { path: path.join(base, 'docs-beta'), branch: 'docs/beta' },
  ];
  assert.equal(
    findWorktree(worktrees, 'feat/alpha', base).branch,
    'feat/alpha',
  );
  assert.equal(findWorktree(worktrees, 'docs-beta', base).branch, 'docs/beta');
  assert.equal(findWorktree(worktrees, 'beta', base).branch, 'docs/beta');
  assert.equal(
    findWorktree(worktrees, path.join(base, 'fix-alpha') + path.sep, '/')
      .branch,
    'fix/alpha',
  );
  assert.throws(
    () => findWorktree(worktrees, 'alpha', base),
    /several worktrees/,
  );
  assert.throws(
    () => findWorktree(worktrees, 'nope', base),
    /no worktree matches/,
  );
});

test('mergedPullRequestHeads groups heads and skips gracefully without gh', () => {
  const ok = (stdout) => () => ({
    ok: true,
    missing: false,
    status: 0,
    stdout,
    stderr: '',
  });
  const heads = mergedPullRequestHeads('.', {
    run: ok(
      JSON.stringify([
        { headRefName: 'feat/a', headRefOid: '111' },
        { headRefName: 'feat/a', headRefOid: '222' },
        { headRefName: 'fix/b', headRefOid: '333' },
      ]),
    ),
  });
  assert.deepEqual(
    [...(heads ?? [])],
    [
      ['feat/a', ['111', '222']],
      ['fix/b', ['333']],
    ],
  );
  const messages = [];
  const log = (message) => messages.push(message);
  const missing = () => ({
    ok: false,
    missing: true,
    status: null,
    stdout: '',
    stderr: '',
  });
  assert.equal(mergedPullRequestHeads('.', { run: missing, log }), null);
  const denied = () => ({
    ok: false,
    missing: false,
    status: 4,
    stdout: '',
    stderr: 'gh auth login required\n',
  });
  assert.equal(mergedPullRequestHeads('.', { run: denied, log }), null);
  assert.match(messages[0], /not installed; skipping --merged/);
  assert.match(messages[1], /gh auth login required\); skipping --merged/);
});

test('removal failures explain Windows file locks', () => {
  assert.match(
    removalFailureMessage(
      'D:/w/x',
      "error: failed to delete 'D:/w/x': Permission denied",
    ),
    /dev server or IDE open inside it/,
  );
  assert.equal(
    removalFailureMessage('D:/w/x', 'fatal: not a worktree\n'),
    'fatal: not a worktree',
  );
});

test('firstLine masks credentials embedded in URLs', () => {
  assert.equal(
    firstLine(
      "\nfatal: unable to access 'https://user:tok3n@github.com/o/r.git/'\n",
    ),
    "fatal: unable to access 'https://***@github.com/o/r.git/'",
  );
  assert.equal(firstLine(''), null);
});

test('shellCommandLine only accepts plain tokens', () => {
  assert.equal(
    shellCommandLine(['npm', 'ci', '--no-audit']),
    'npm ci --no-audit',
  );
  for (const bad of [
    'a&b',
    'a|b',
    'a b',
    '%PATH%',
    '$(x)',
    '"q"',
    'a;b',
    '>out',
  ])
    assert.throws(() => shellCommandLine(['npm', bad]), /unsafe/, bad);
  assert.throws(() => shellCommandLine([]), /empty/);
});

test('doctor version helpers', () => {
  assert.equal(nodeMatchesNvmrc('24\n', '24.11.1'), true);
  assert.equal(nodeMatchesNvmrc('v24.11', '24.11.1'), true);
  assert.equal(nodeMatchesNvmrc('22', '24.11.1'), false);
  assert.equal(nodeMatchesNvmrc('lts/*', '24.11.1'), null);
  assert.deepEqual(parseGitVersion('git version 2.51.2.windows.1'), [2, 51]);
  assert.equal(parseGitVersion('nope'), null);
});

test('shared-script parity ignores CRLF conversion and reports real drift', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vendor-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const a = path.join(base, 'a');
  const b = path.join(base, 'b');
  write(a, 'scripts/worktree/wt.mjs', 'one\ntwo\n');
  write(b, 'scripts/worktree/wt.mjs', 'one\r\ntwo\r\n');
  write(a, 'scripts/worktree/lib/x.mjs', 'x\n');
  write(b, 'scripts/worktree/lib/x.mjs', 'y\n');
  write(a, 'scripts/agents/sync.mjs', 's\n');
  write(b, 'scripts/agents/extra.mjs', 'e\n');
  assert.deepEqual(compareSharedFiles(hashSharedFiles(a), hashSharedFiles(b)), {
    onlyOurs: ['scripts/agents/sync.mjs'],
    onlyTheirs: ['scripts/agents/extra.mjs'],
    different: ['scripts/worktree/lib/x.mjs'],
  });
});
