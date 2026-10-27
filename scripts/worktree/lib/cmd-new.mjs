// `wt new <type>/<slug>`: fetch, create the worktree + branch, bootstrap it, report claim overlaps.
import fs from 'node:fs';
import path from 'node:path';
import { OWNERS, describeSetup, setupWorktree } from '../setup.mjs';
import { findClaimOverlaps, formatClaimPairs, parseClaims } from './claims.mjs';
import { UsageError, parseCommandArgs } from './cli.mjs';
import { collectWorktrees, loadContext, worktreeLabel } from './context.mjs';
import {
  firstLine,
  git,
  localBranchExists,
  refExists,
  runGit,
} from './git.mjs';
import { PATH_BUDGET, isProtectedBranch, parseBranchSpec } from './names.mjs';

function fetchOrigin(ctx, env) {
  if (!runGit(['remote', 'get-url', 'origin'], { cwd: ctx.mainRoot }).ok) {
    console.error('wt: no "origin" remote; skipping fetch');
    return;
  }
  const result = runGit(['fetch', '--quiet', 'origin'], {
    cwd: ctx.mainRoot,
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (!result.ok)
    console.error(
      `wt: warning: git fetch origin failed (${firstLine(result.stderr) ?? `exit ${result.status}`}); using local refs`,
    );
}

function hasCheckScript(root) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    );
    return typeof pkg.scripts?.check === 'string';
  } catch {
    return false;
  }
}

/**
 * Creates a task worktree on a new `<type>/<slug>` branch and bootstraps it.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>} Exit code.
 */
export async function cmdNew(
  args,
  { cwd = process.cwd(), env = process.env } = {},
) {
  const { values, positionals } = parseCommandArgs(
    args,
    {
      base: { type: 'string' },
      claims: { type: 'string' },
      task: { type: 'string' },
      owner: { type: 'string' },
      'no-setup': { type: 'boolean' },
      'no-fetch': { type: 'boolean' },
    },
    { min: 1, max: 1 },
  );
  const spec = parseBranchSpec(positionals[0]);
  if ('error' in spec) throw new UsageError(spec.error);
  const { claims, invalid } = parseClaims(values.claims);
  if (invalid.length)
    throw new UsageError(
      `invalid claim path(s): ${invalid.join(', ')} (use repo-relative paths without "..")`,
    );
  if (values.owner !== undefined && !OWNERS.includes(values.owner))
    throw new UsageError(`--owner must be one of: ${OWNERS.join(', ')}`);

  const ctx = loadContext({ cwd, env });
  const { config } = ctx;
  const target = path.join(ctx.worktreeBase, spec.dirName);
  if (isProtectedBranch(spec.branch, config.protectedBranches))
    throw new Error(`${spec.branch} is a protected branch`);
  if (fs.existsSync(target))
    throw new Error(
      `${target} already exists; pick another slug or remove it with wt rm`,
    );
  if (localBranchExists(ctx.mainRoot, spec.branch))
    throw new Error(
      `branch ${spec.branch} already exists; pick another slug or resume it with: git worktree add "${target}" ${spec.branch}`,
    );
  if (!values['no-fetch']) fetchOrigin(ctx, env);
  if (refExists(ctx.mainRoot, `refs/remotes/origin/${spec.branch}`))
    throw new Error(
      `origin/${spec.branch} already exists; pick another slug or resume it with: git worktree add "${target}" ${spec.branch}`,
    );
  const base = values.base ?? `origin/${config.baseBranch}`;
  if (!refExists(ctx.mainRoot, base))
    throw new Error(
      `base ${base} not found; run git fetch origin or pass --base <ref>`,
    );
  if (target.length > PATH_BUDGET)
    console.error(
      `wt: warning: ${target} is ${target.length} characters; keep worktree paths under ${PATH_BUDGET} (shorter slug)`,
    );

  fs.mkdirSync(ctx.worktreeBase, { recursive: true });
  // --no-track: the branch gets its own upstream on first push instead of tracking the base.
  git(
    [
      'worktree',
      'add',
      '--quiet',
      '--no-track',
      '-b',
      spec.branch,
      target,
      base,
    ],
    {
      cwd: ctx.mainRoot,
    },
  );

  let result;
  try {
    // The slot is always allocated so a fresh worktree never falls back to colliding legacy ports.
    result = await setupWorktree({
      cwd: target,
      env,
      copy: !values['no-setup'],
      install: values['no-setup'] ? 'never' : 'auto',
      seed: {
        branch: spec.branch,
        base,
        claims,
        task: values.task,
        owner: values.owner,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(
      `wt: worktree created at ${target}, but setup failed: ${error.message}\n` +
        `    retry: cd "${target}" && node scripts/worktree/setup.mjs   (or remove: wt rm ${spec.branch} --force --delete-branch)`,
    );
    return 1;
  }

  const lines = describeSetup(result).filter(
    (line) =>
      !line.startsWith('Worktree ready') &&
      !(values['no-setup'] && line.startsWith('  install')),
  );
  console.log(`Created ${spec.branch} from ${base}`);
  console.log(`  path     ${target}`);
  for (const line of lines) console.log(line);
  if (claims.length) console.log(`  claims   ${claims.join(', ')}`);
  if (values['no-setup'])
    console.log(
      '  setup    skipped (--no-setup): run node scripts/worktree/setup.mjs inside the worktree to copy local files and install',
    );

  const worktrees = collectWorktrees({ ...ctx, root: target });
  const overlaps = findClaimOverlaps(
    worktrees.map((w) => ({
      id: w.path,
      claims: /** @type {unknown[]} */ (w.state?.claims),
    })),
  ).filter((o) => o.a === result.worktree || o.b === result.worktree);
  for (const overlap of overlaps) {
    const other = worktrees.find(
      (w) => w.path === (overlap.a === result.worktree ? overlap.b : overlap.a),
    );
    console.log(
      `warning: claims overlap with ${other ? worktreeLabel(other) : 'another worktree'}: ${formatClaimPairs(overlap.pairs)}`,
    );
  }

  console.log('Next steps:');
  console.log(`  cd "${target}"`);
  if (hasCheckScript(target)) console.log('  npm run check');
  console.log(`  git push -u origin ${spec.branch}`);
  console.log(`  gh pr create --base ${config.baseBranch} --fill`);
  return 0;
}
