import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimsOverlap,
  findClaimOverlaps,
  formatClaimPairs,
  normalizeClaim,
  parseClaims,
} from './lib/claims.mjs';
import {
  MAX_SLUG_LENGTH,
  isBranchName,
  isProtectedBranch,
  parseBranchSpec,
} from './lib/names.mjs';

test('parseBranchSpec derives branch and directory names', () => {
  assert.deepEqual(parseBranchSpec('feat/e-08-transcript'), {
    type: 'feat',
    slug: 'e-08-transcript',
    branch: 'feat/e-08-transcript',
    dirName: 'feat-e-08-transcript',
  });
  assert.equal(parseBranchSpec('release/0.3.0').dirName, 'release-0.3.0');
  assert.equal(
    parseBranchSpec('release/site-0.2.18').dirName,
    'release-site-0.2.18',
  );
  assert.equal(
    parseBranchSpec('release/site-0.2.18-live').branch,
    'release/site-0.2.18-live',
  );
  assert.ok(parseBranchSpec('feat/site-0.2.18').error, 'dots only in release');
  assert.equal(
    parseBranchSpec('deps/playwright-1-65').branch,
    'deps/playwright-1-65',
  );
});

test('parseBranchSpec rejects bad types and slugs', () => {
  const invalid = [
    'e-08',
    'feature/x',
    'Feat/x',
    'feat/',
    'feat/X',
    'feat/a_b',
    'feat/-a',
    'feat/a-',
    'feat/a--b',
    'feat/a/b',
    'feat/a.b',
    'fix/0.3.0',
    `feat/${'a'.repeat(MAX_SLUG_LENGTH + 1)}`,
  ];
  for (const spec of invalid) assert.ok('error' in parseBranchSpec(spec), spec);
  assert.ok(
    !('error' in parseBranchSpec(`feat/${'a'.repeat(MAX_SLUG_LENGTH)}`)),
  );
});

test('isBranchName and isProtectedBranch', () => {
  for (const name of ['main', 'develop', 'release/0.2.17', 'feat/x'])
    assert.equal(isBranchName(name), true, name);
  for (const name of [
    '',
    '/x',
    'x/',
    'a..b',
    'a//b',
    'x.lock',
    '-x',
    'a b',
    'a~1',
  ])
    assert.equal(isBranchName(name), false, name);
  assert.equal(isProtectedBranch('develop', ['main', 'develop']), true);
  assert.equal(isProtectedBranch('feat/develop', ['main', 'develop']), false);
  assert.equal(isProtectedBranch(null, ['main']), false);
});

test('normalizeClaim converts Windows separators and rejects escaping paths', () => {
  assert.equal(
    normalizeClaim('.\\apps\\extension\\src\\'),
    'apps/extension/src',
  );
  assert.equal(normalizeClaim('./docs//VALIDATION.md'), 'docs/VALIDATION.md');
  assert.equal(normalizeClaim('  package.json '), 'package.json');
  for (const bad of [
    '',
    '.',
    '/etc/passwd',
    'C:\\x',
    'D:/x',
    '../x',
    'a/../b',
    'a/./b',
    42,
  ])
    assert.equal(normalizeClaim(bad), null, String(bad));
});

test('parseClaims splits, normalizes, dedupes case-insensitively and reports invalid entries', () => {
  assert.deepEqual(
    parseClaims('apps/extension/src, Apps/Extension/src/,package.json,'),
    {
      claims: ['apps/extension/src', 'package.json'],
      invalid: [],
    },
  );
  assert.deepEqual(parseClaims(['../x', 'ok.md']), {
    claims: ['ok.md'],
    invalid: ['../x'],
  });
  assert.deepEqual(parseClaims(undefined), { claims: [], invalid: [] });
});

test('claimsOverlap matches whole path segments, either direction, any separator or case', () => {
  assert.equal(
    claimsOverlap('apps/extension', 'apps/extension/src/main.ts'),
    true,
  );
  assert.equal(
    claimsOverlap('apps\\extension\\src\\main.ts', 'apps/extension'),
    true,
  );
  assert.equal(claimsOverlap('docs/VALIDATION.md', 'docs/validation.md'), true);
  assert.equal(claimsOverlap('apps/ext', 'apps/extension'), false);
  assert.equal(claimsOverlap('package.json', 'package-lock.json'), false);
  assert.equal(claimsOverlap('../x', '../x'), false);
});

test('findClaimOverlaps reports each overlapping pair once with the matching claims', () => {
  const overlaps = findClaimOverlaps([
    {
      id: 'feat/a',
      claims: ['apps/extension/src/main.ts', 'docs/VALIDATION.md'],
    },
    { id: 'feat/b', claims: ['apps/extension/src'] },
    { id: 'feat/c', claims: ['docs\\VALIDATION.md'] },
    { id: 'feat/d', claims: null },
  ]);
  assert.deepEqual(overlaps, [
    {
      a: 'feat/a',
      b: 'feat/b',
      pairs: [{ a: 'apps/extension/src/main.ts', b: 'apps/extension/src' }],
    },
    {
      a: 'feat/a',
      b: 'feat/c',
      pairs: [{ a: 'docs/VALIDATION.md', b: 'docs/VALIDATION.md' }],
    },
  ]);
  assert.equal(
    formatClaimPairs(overlaps[0].pairs),
    'apps/extension/src/main.ts ~ apps/extension/src',
  );
  assert.equal(formatClaimPairs(overlaps[1].pairs), 'docs/VALIDATION.md');
});
