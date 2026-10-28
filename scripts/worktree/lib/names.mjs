// Branch and slug naming rules: one task = one `<type>/<slug>` branch = one `<type>-<slug>` directory.

/** Conventional-commit types accepted as branch prefixes. */
export const BRANCH_TYPES = Object.freeze([
  'feat',
  'fix',
  'docs',
  'chore',
  'ci',
  'test',
  'refactor',
  'perf',
  'release',
  'deps',
]);

/** Longest accepted slug; keeps worktree paths inside the Windows path budget. */
export const MAX_SLUG_LENGTH = 40;

/** Worktree paths longer than this risk MAX_PATH failures (Chromium profiles, npm) on Windows. */
export const PATH_BUDGET = 100;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Release branches carry a version (`release/0.3.0`), the only place dots are allowed.
// Release slugs may carry a version: `0.2.18`, `site-0.2.18`, `site-0.2.18-live`.
const RELEASE_VERSION = /^(?:[a-z0-9]+-)?\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/;
const BRANCH_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * Validates a slug for the given branch type.
 * @param {string} slug
 * @param {string} [type]
 * @returns {string | null} Human-readable problem, or null when valid.
 */
export function slugError(slug, type) {
  if (typeof slug !== 'string' || slug === '') return 'slug is empty';
  if (slug.length > MAX_SLUG_LENGTH)
    return `slug "${slug}" is ${slug.length} characters; the limit is ${MAX_SLUG_LENGTH}`;
  if (SLUG.test(slug)) return null;
  if (type === 'release' && RELEASE_VERSION.test(slug)) return null;
  return `slug "${slug}" must be lowercase a-z, 0-9 and single hyphens (no leading/trailing hyphen)`;
}

/**
 * Parses `<type>/<slug>` into branch and directory names.
 * @param {string} spec
 * @returns {{ type: string, slug: string, branch: string, dirName: string } | { error: string }}
 */
export function parseBranchSpec(spec) {
  if (typeof spec !== 'string' || !spec.includes('/'))
    return {
      error: `expected <type>/<slug>, e.g. feat/e-08-transcript (types: ${BRANCH_TYPES.join(', ')})`,
    };
  const [type, ...rest] = spec.split('/');
  if (!BRANCH_TYPES.includes(type))
    return {
      error: `unknown branch type "${type}" (use one of: ${BRANCH_TYPES.join(', ')})`,
    };
  const slug = rest.join('/');
  const problem = slugError(slug, type);
  if (problem) return { error: problem };
  return { type, slug, branch: `${type}/${slug}`, dirName: `${type}-${slug}` };
}

/**
 * Conservative check for a git branch name (subset of `git check-ref-format --branch`).
 * @param {unknown} name
 * @returns {boolean}
 */
export function isBranchName(name) {
  return (
    typeof name === 'string' &&
    BRANCH_CHARS.test(name) &&
    !name.startsWith('/') &&
    !name.startsWith('-') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//')
  );
}

/**
 * True when the branch must never be deleted or force-updated by these tools.
 * @param {string | null | undefined} branch
 * @param {readonly string[]} protectedBranches
 * @returns {boolean}
 */
export function isProtectedBranch(branch, protectedBranches) {
  return typeof branch === 'string' && protectedBranches.includes(branch);
}
