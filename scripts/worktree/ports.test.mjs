import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  locateWorktreeFiles,
  parsePortOverride,
  port,
  resolvePorts,
} from './ports.mjs';

const portsScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'ports.mjs',
);

const config = {
  repo: 'demo',
  baseBranch: 'develop',
  protectedBranches: ['main', 'develop'],
  worktreeRoot: '../wt',
  ports: {
    slotBase: 24000,
    maxSlots: 49,
    names: {
      DEMO_DEV_PORT: { legacy: 4173, offset: 73 },
      DEMO_AUX_PORT: { legacy: 4180, offset: 80 },
    },
  },
};

function makeCheckout(t, { state, withConfig = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ports-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'checkout');
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'extension', 'src'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n');
  if (withConfig)
    fs.writeFileSync(
      path.join(root, '.agents', 'workspace.json'),
      JSON.stringify(config),
    );
  if (state)
    fs.writeFileSync(path.join(root, '.worktree.json'), JSON.stringify(state));
  return { base, root, nested: path.join(root, 'apps', 'extension', 'src') };
}

test('checkout without .worktree.json resolves to slot 0 legacy ports', (t) => {
  const { nested } = makeCheckout(t);
  assert.deepEqual(resolvePorts({ cwd: nested, env: {} }), {
    slot: 0,
    ports: { DEMO_DEV_PORT: 4173, DEMO_AUX_PORT: 4180 },
  });
});

test('.worktree.json slot uses the formula from any subdirectory', (t) => {
  const { nested } = makeCheckout(t, { state: { version: 1, slot: 3 } });
  assert.deepEqual(resolvePorts({ cwd: nested, env: {} }), {
    slot: 3,
    ports: { DEMO_DEV_PORT: 24373, DEMO_AUX_PORT: 24380 },
  });
  assert.equal(port('DEMO_AUX_PORT', { cwd: nested, env: {} }), 24380);
});

test('explicit env var wins over the slot; blank values are ignored', (t) => {
  const { root } = makeCheckout(t, { state: { slot: 3 } });
  const env = { DEMO_DEV_PORT: '5001', DEMO_AUX_PORT: '  ' };
  assert.deepEqual(resolvePorts({ cwd: root, env }).ports, {
    DEMO_DEV_PORT: 5001,
    DEMO_AUX_PORT: 24380,
  });
});

test('invalid overrides, slots and names fail loudly', (t) => {
  const { root } = makeCheckout(t, { state: { slot: 3 } });
  assert.throws(
    () => resolvePorts({ cwd: root, env: { DEMO_DEV_PORT: 'abc' } }),
    /not a valid port/,
  );
  assert.throws(() => parsePortOverride('X', '70000'), /not a valid port/);
  assert.throws(() => parsePortOverride('X', '0'), /not a valid port/);
  assert.equal(parsePortOverride('X', ' 4173 '), 4173);
  assert.throws(
    () => port('NOPE', { cwd: root, env: {} }),
    /Unknown port "NOPE"/,
  );
  const bad = makeCheckout(t, { state: { slot: 99 } });
  assert.throws(() => resolvePorts({ cwd: bad.root, env: {} }), /outside 0-49/);
});

test('search stops at the directory containing .git', (t) => {
  const { base, nested } = makeCheckout(t);
  // A stray state file above the checkout must not leak into it.
  fs.writeFileSync(
    path.join(base, '.worktree.json'),
    JSON.stringify({ slot: 7 }),
  );
  const files = locateWorktreeFiles(nested);
  assert.equal(files.statePath, null);
  assert.equal(path.basename(files.root ?? ''), 'checkout');
  assert.equal(resolvePorts({ cwd: nested, env: {} }).slot, 0);
});

test('without workspace config the stored ports in .worktree.json are used', (t) => {
  const { root } = makeCheckout(t, {
    withConfig: false,
    state: { slot: 2, ports: { DEMO_DEV_PORT: 24273, BAD: 'x' } },
  });
  assert.deepEqual(
    resolvePorts({ cwd: root, env: { DEMO_DEV_PORT: '6000' } }),
    {
      slot: 2,
      ports: { DEMO_DEV_PORT: 6000 },
    },
  );
});

test('CLI prints --json and --env output for the current directory', (t) => {
  const { root } = makeCheckout(t, { state: { slot: 1 } });
  const env = { ...process.env, DEMO_DEV_PORT: '' };
  const json = JSON.parse(
    execFileSync(process.execPath, [portsScript, '--json'], {
      cwd: root,
      env,
      encoding: 'utf8',
    }),
  );
  assert.deepEqual(json, {
    slot: 1,
    ports: { DEMO_DEV_PORT: 24173, DEMO_AUX_PORT: 24180 },
  });
  const lines = execFileSync(process.execPath, [portsScript, '--env'], {
    cwd: root,
    env,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/);
  assert.deepEqual(lines, ['DEMO_DEV_PORT=24173', 'DEMO_AUX_PORT=24180']);
});
