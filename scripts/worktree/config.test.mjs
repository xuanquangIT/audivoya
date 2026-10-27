import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_PATH,
  parseWorkspaceConfig,
  portsForSlot,
  slotFromState,
  validateWorkspaceConfig,
} from './lib/config.mjs';
import { mergeState } from './lib/state.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function sampleConfig(overrides = {}) {
  return {
    repo: 'ext',
    baseBranch: 'develop',
    protectedBranches: ['main', 'develop'],
    worktreeRoot: '../worktrees/ext',
    copyFromMain: ['.env'],
    install: ['npm', 'ci', '--ignore-scripts'],
    ports: {
      slotBase: 24000,
      maxSlots: 49,
      names: {
        AUDIVOYA_DEV_PORT: { legacy: 4173, offset: 73 },
        AUDIVOYA_LOOKAHEAD_PORT: { legacy: 4180, offset: 80 },
        AUDIVOYA_SHOWCASE_PORT: { legacy: 5188, offset: 88 },
      },
    },
    locks: { capture: 'audio capture' },
    ...overrides,
  };
}

test('this repository ships a valid .agents/workspace.json', () => {
  const text = fs.readFileSync(path.join(repoRoot, CONFIG_PATH), 'utf8');
  const config = parseWorkspaceConfig(text);
  assert.ok(config.protectedBranches.includes(config.baseBranch));
  assert.deepEqual(validateWorkspaceConfig(JSON.parse(text)), []);
});

test('validateWorkspaceConfig accepts the documented ext and site shapes', () => {
  assert.deepEqual(validateWorkspaceConfig(sampleConfig()), []);
  const site = sampleConfig({
    repo: 'site',
    baseBranch: 'main',
    protectedBranches: ['main'],
    worktreeRoot: '../worktrees/site',
    ports: {
      slotBase: 26000,
      maxSlots: 49,
      names: {
        SITE_PORT: { legacy: 4180, offset: 80 },
        SITE_CAPTURE_PORT: { legacy: 4181, offset: 81 },
      },
    },
  });
  assert.deepEqual(validateWorkspaceConfig(site), []);
});

test('validateWorkspaceConfig reports each invalid field', () => {
  const cases = [
    [{ repo: 'Ext' }, /"repo"/],
    [{ baseBranch: 'bad..name' }, /"baseBranch"/],
    [{ worktreeRoot: 'D:/abs' }, /"worktreeRoot"/],
    [{ worktreeRoot: '/abs' }, /"worktreeRoot"/],
    [{ copyFromMain: ['../.env'] }, /"copyFromMain"/],
    [{ install: ['npm', 'ci', '&&', 'calc'] }, /"install"/],
    [{ install: [] }, /"install"/],
    [{ extra: true }, /unknown key "extra"/],
    [{ locks: { Capture: 'x' } }, /lock names/],
  ];
  for (const [override, pattern] of cases) {
    const errors = validateWorkspaceConfig(sampleConfig(override));
    assert.ok(
      errors.some((error) => pattern.test(error)),
      `${JSON.stringify(override)} -> ${errors.join('; ')}`,
    );
  }
});

test('validateWorkspaceConfig rejects bad port tables', () => {
  const ports = (names, extra = {}) =>
    sampleConfig({ ports: { slotBase: 24000, maxSlots: 49, names, ...extra } });
  const duplicate = validateWorkspaceConfig(
    ports({
      A_PORT: { legacy: 1, offset: 5 },
      B_PORT: { legacy: 2, offset: 5 },
    }),
  );
  assert.match(duplicate.join(), /duplicates A_PORT/);
  assert.match(
    validateWorkspaceConfig(
      ports({ A_PORT: { legacy: 1, offset: 100 } }),
    ).join(),
    /offset/,
  );
  assert.match(
    validateWorkspaceConfig(ports({ lower: { legacy: 1, offset: 1 } })).join(),
    /UPPER_SNAKE_CASE/,
  );
  assert.match(
    validateWorkspaceConfig(
      ports(
        { A_PORT: { legacy: 1, offset: 99 } },
        { slotBase: 60000, maxSlots: 60 },
      ),
    ).join(),
    /would use port/,
  );
  assert.match(validateWorkspaceConfig(ports({})).join(), /non-empty/);
});

test('parseWorkspaceConfig applies defaults and names the source on errors', () => {
  const minimal = sampleConfig();
  delete minimal.copyFromMain;
  delete minimal.install;
  delete minimal.locks;
  const parsed = parseWorkspaceConfig(`\uFEFF${JSON.stringify(minimal)}`);
  assert.deepEqual(parsed.copyFromMain, []);
  assert.equal(parsed.install, null);
  assert.deepEqual(parsed.locks, {});
  assert.throws(
    () => parseWorkspaceConfig('{', 'x.json'),
    /x\.json: invalid JSON/,
  );
  assert.throws(
    () => parseWorkspaceConfig(JSON.stringify({ repo: 'ext' }), 'x.json'),
    /x\.json is invalid/,
  );
});

test('portsForSlot keeps legacy ports for slot 0 and applies slotBase + N*100 + offset', () => {
  const { ports } = sampleConfig();
  assert.deepEqual(portsForSlot(ports, 0), {
    AUDIVOYA_DEV_PORT: 4173,
    AUDIVOYA_LOOKAHEAD_PORT: 4180,
    AUDIVOYA_SHOWCASE_PORT: 5188,
  });
  assert.deepEqual(portsForSlot(ports, 3), {
    AUDIVOYA_DEV_PORT: 24373,
    AUDIVOYA_LOOKAHEAD_PORT: 24380,
    AUDIVOYA_SHOWCASE_PORT: 24388,
  });
  assert.equal(portsForSlot(ports, 49).AUDIVOYA_SHOWCASE_PORT, 28988);
  assert.throws(() => portsForSlot(ports, 50), RangeError);
  assert.throws(() => portsForSlot(ports, -1), RangeError);
  assert.throws(() => portsForSlot(ports, 1.5), RangeError);
});

test('slotFromState only returns in-range integer slots', () => {
  assert.equal(slotFromState({ slot: 4 }, 49), 4);
  assert.equal(slotFromState({ slot: 0 }, 49), 0);
  assert.equal(slotFromState({ slot: 50 }, 49), null);
  assert.equal(slotFromState({ slot: '4' }, 49), null);
  assert.equal(slotFromState(null, 49), null);
});

test('mergeState keeps unknown keys, ignores undefined and orders keys stably', () => {
  const merged = mergeState(
    { owner: 'human', custom: 1, slot: 2, claims: ['a'] },
    { slot: 3, task: undefined, repo: 'ext', branch: 'feat/x' },
  );
  assert.deepEqual(Object.keys(merged), [
    'version',
    'repo',
    'slot',
    'branch',
    'claims',
    'owner',
    'custom',
  ]);
  assert.equal(merged.version, 1);
  assert.equal(merged.slot, 3);
  assert.deepEqual(merged.claims, ['a']);
});
