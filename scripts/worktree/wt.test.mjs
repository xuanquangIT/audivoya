// End-to-end check of wt new/list/claims/path/rm/init and setup against throwaway local repos.
// No network: "origin" is a sibling directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { samePath } from './lib/paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const wtScript = path.join(here, 'wt.mjs');
const setupScript = path.join(here, 'setup.mjs');
const hasGit = spawnSync('git', ['--version']).status === 0;

const config = {
  repo: 'wttest',
  baseBranch: 'develop',
  protectedBranches: ['main', 'develop'],
  worktreeRoot: '../wt',
  copyFromMain: ['.env.local'],
  install: ['node', '--version'],
  ports: {
    slotBase: 41000,
    maxSlots: 20,
    names: { WT_TEST_PORT: { legacy: 4999, offset: 7 } },
  },
};

function createFixture(t) {
  const base = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'wt-int-')),
  );
  t.after(() =>
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }),
  );
  const globalConfig = path.join(base, 'gitconfig');
  fs.writeFileSync(globalConfig, '');
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: 'wt test',
    GIT_AUTHOR_EMAIL: 'wt@example.invalid',
    GIT_COMMITTER_NAME: 'wt test',
    GIT_COMMITTER_EMAIL: 'wt@example.invalid',
    CLAUDECODE: '',
    ROOT_WORKTREE_PATH: '',
    WT_TEST_PORT: '',
  };
  const git = (args, cwd) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const upstream = path.join(base, 'upstream');
  fs.mkdirSync(path.join(upstream, '.agents'), { recursive: true });
  git(['init', '-q', '-b', 'develop'], upstream);
  fs.writeFileSync(
    path.join(upstream, '.agents', 'workspace.json'),
    JSON.stringify(config, null, 2),
  );
  fs.writeFileSync(
    path.join(upstream, '.gitignore'),
    '.worktree.json\n.env.local\n.claude/worktrees/\n.worktrees/\n',
  );
  fs.writeFileSync(path.join(upstream, 'README.md'), '# fixture\n');
  git(['add', '-A'], upstream);
  git(['commit', '-q', '-m', 'init'], upstream);
  const main = path.join(base, 'main');
  git(['clone', '-q', upstream, main], base);
  // Local-only file that setup must copy without reading.
  fs.writeFileSync(path.join(main, '.env.local'), 'FIXTURE=1\n');
  const run = (script, args, cwd) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      env,
      encoding: 'utf8',
    });
  return {
    base,
    main,
    env,
    git,
    wt: (args, cwd = main) => run(wtScript, args, cwd),
    run,
  };
}

test(
  'wt manages task worktrees end to end',
  { skip: !hasGit && 'git not installed' },
  (t) => {
    const { base, main, git, wt, run } = createFixture(t);
    const demo = path.join(base, 'wt', 'feat-demo');
    const other = path.join(base, 'wt', 'feat-other');

    const created = wt([
      'new',
      'feat/demo',
      '--claims',
      'src/app.ts,docs',
      '--task',
      'demo task',
      '--owner',
      'human',
    ]);
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /Created feat\/demo from origin\/develop/);
    assert.match(created.stdout, /git push -u origin feat\/demo/);
    assert.equal(
      fs.readFileSync(path.join(demo, '.env.local'), 'utf8'),
      'FIXTURE=1\n',
    );
    const demoState = JSON.parse(
      fs.readFileSync(path.join(demo, '.worktree.json'), 'utf8'),
    );
    assert.equal(demoState.repo, 'wttest');
    assert.equal(demoState.branch, 'feat/demo');
    assert.equal(demoState.base, 'origin/develop');
    assert.deepEqual(demoState.claims, ['src/app.ts', 'docs']);
    assert.equal(demoState.task, 'demo task');
    assert.equal(demoState.owner, 'human');
    assert.ok(demoState.slot >= 1);
    assert.equal(
      demoState.ports.WT_TEST_PORT,
      41000 + demoState.slot * 100 + 7,
    );
    const upstreamCheck = spawnSync(
      'git',
      ['rev-parse', '--abbrev-ref', 'feat/demo@{upstream}'],
      {
        cwd: demo,
        encoding: 'utf8',
      },
    );
    assert.notEqual(
      upstreamCheck.status,
      0,
      'new branch must not track the base',
    );

    const second = wt([
      'new',
      'feat/other',
      '--claims',
      'docs/guide.md',
      '--no-setup',
      '--no-fetch',
    ]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(
      second.stdout,
      /warning: claims overlap with feat\/demo: docs ~ docs\/guide\.md|docs\/guide\.md ~ docs/,
    );
    assert.equal(
      fs.existsSync(path.join(other, '.env.local')),
      false,
      '--no-setup skips copies',
    );
    const otherState = JSON.parse(
      fs.readFileSync(path.join(other, '.worktree.json'), 'utf8'),
    );
    assert.notEqual(otherState.slot, demoState.slot);

    const claims = wt(['claims']);
    assert.equal(claims.status, 1);
    assert.match(claims.stdout, /feat\/demo <-> feat\/other/);

    const list = wt(['list', '--json']);
    assert.equal(list.status, 0, list.stderr);
    const rows = JSON.parse(list.stdout);
    assert.equal(rows.length, 3);
    const mainRow = rows.find((row) => row.main);
    assert.equal(mainRow.slot, 0);
    assert.equal(mainRow.devPort, 4999);
    assert.equal(mainRow.current, true);
    const demoRow = rows.find((row) => row.branch === 'feat/demo');
    assert.equal(demoRow.slot, demoState.slot);
    assert.equal(demoRow.dirty, 0);
    assert.equal(demoRow.ahead, 0);
    assert.deepEqual(demoRow.claims, ['src/app.ts', 'docs']);
    assert.match(wt(['list']).stdout, /feat\/other/);

    const located = wt(['path', 'demo'], other);
    assert.equal(located.status, 0, located.stderr);
    assert.ok(samePath(located.stdout.trim(), demo));

    assert.equal(wt(['new', 'feat/demo', '--no-fetch']).status, 1);
    assert.equal(wt(['new', 'feature/x']).status, 2);
    assert.equal(wt(['new', 'feat/Bad_Slug']).status, 2);
    assert.equal(wt(['bogus']).status, 2);

    const rerun = run(setupScript, ['--json'], demo);
    assert.equal(rerun.status, 0, rerun.stderr);
    const result = JSON.parse(rerun.stdout);
    assert.equal(result.slot, demoState.slot, 'setup keeps the existing slot');
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.present, ['.env.local']);
    assert.deepEqual(result.install, { ran: false, reason: 'no package.json' });
    assert.deepEqual(result.warnings, []);

    const mainSetup = run(setupScript, ['--json'], main);
    assert.equal(mainSetup.status, 0, mainSetup.stderr);
    assert.equal(JSON.parse(mainSetup.stdout).main, true);
    assert.equal(fs.existsSync(path.join(main, '.worktree.json')), false);

    fs.writeFileSync(path.join(demo, 'scratch.txt'), 'wip\n');
    const dirty = wt(['rm', 'demo']);
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /uncommitted/);
    assert.equal(
      wt(['rm', 'develop']).status,
      1,
      'main checkout is never removed',
    );
    const inside = wt(['rm', 'feat/other'], other);
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /current directory/);

    const removed = wt(['rm', 'demo', '--force', '--delete-branch']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(fs.existsSync(demo), false);
    assert.equal(git(['branch', '--list', 'feat/demo'], main), '');
    assert.equal(wt(['rm', 'feat/other']).status, 0);
    assert.notEqual(
      git(['branch', '--list', 'feat/other'], main),
      '',
      'branch kept without --delete-branch',
    );

    // Reproduce the drift seen in the real checkout: develop tracking a release branch.
    git(['config', 'branch.develop.merge', 'refs/heads/release/0.0.1'], main);
    const init = wt(['init']);
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /changed {2}rerere\.enabled=true/);
    assert.match(
      init.stdout,
      /changed {2}develop tracks origin\/develop \(was origin\/release\/0\.0\.1\)/,
    );
    assert.equal(
      git(['config', '--get', 'push.autoSetupRemote'], main),
      'true',
    );
    assert.equal(
      git(['config', '--get', 'branch.develop.merge'], main),
      'refs/heads/develop',
    );
    const again = wt(['init']);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /nothing changed/);
  },
);

test(
  'setup bootstraps harness-made worktrees idempotently',
  { skip: !hasGit && 'git not installed' },
  (t) => {
    const { base, main, env, git, run } = createFixture(t);
    const portsScript = path.join(here, 'ports.mjs');

    // Claude Code style: a plain `git worktree add` nested under .claude/worktrees.
    const nested = path.join(main, '.claude', 'worktrees', 'agent-1');
    git(
      [
        'worktree',
        'add',
        '-q',
        '-b',
        'claude/agent-1',
        nested,
        'origin/develop',
      ],
      main,
    );
    const first = run(setupScript, ['--json'], nested);
    assert.equal(first.status, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.main, false);
    assert.ok(result.slot >= 1);
    assert.deepEqual(result.copied, ['.env.local']);
    const saved = JSON.parse(
      fs.readFileSync(path.join(nested, '.worktree.json'), 'utf8'),
    );
    assert.equal(saved.owner, 'claude');
    assert.equal(saved.branch, 'claude/agent-1');
    assert.equal(saved.base, 'origin/develop');

    const again = JSON.parse(run(setupScript, ['--json'], nested).stdout);
    assert.equal(again.slot, result.slot);
    assert.deepEqual(again.copied, []);
    assert.equal(
      JSON.parse(run(portsScript, ['--json'], nested).stdout).slot,
      result.slot,
    );
    assert.equal(JSON.parse(run(portsScript, ['--json'], main).stdout).slot, 0);

    // Cursor style: a separate checkout that only knows the main checkout via ROOT_WORKTREE_PATH.
    const clone = path.join(base, 'cursor-clone');
    git(['clone', '-q', path.join(base, 'upstream'), clone], base);
    const hinted = spawnSync(process.execPath, [setupScript, '--json'], {
      cwd: clone,
      env: { ...env, ROOT_WORKTREE_PATH: main },
      encoding: 'utf8',
    });
    assert.equal(hinted.status, 0, hinted.stderr);
    const cursor = JSON.parse(hinted.stdout);
    assert.equal(cursor.main, false);
    assert.deepEqual(cursor.copied, ['.env.local']);
    assert.notEqual(
      cursor.slot,
      result.slot,
      'slots are unique across both checkouts',
    );
  },
);
