// File-ownership claims: repo-relative paths a task expects to edit, compared by path prefix.

/**
 * Normalizes a claim to forward-slash, repo-relative form without `./` or trailing slashes.
 * @param {unknown} claim
 * @returns {string | null} Normalized claim, or null when it is empty, absolute or escapes the repo.
 */
export function normalizeClaim(claim) {
  if (typeof claim !== 'string') return null;
  let value = claim
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  value = value.replace(/\/+$/, '');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return null;
  if (value.split('/').some((segment) => segment === '..' || segment === '.'))
    return null;
  return value;
}

/**
 * Parses a comma-separated claim list (or an array) into unique normalized claims.
 * @param {string | readonly unknown[] | undefined} input
 * @returns {{ claims: string[], invalid: string[] }}
 */
export function parseClaims(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',');
  const claims = [];
  const invalid = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() === '') continue;
    const claim = normalizeClaim(item);
    if (!claim) {
      invalid.push(String(item));
      continue;
    }
    const key = claim.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
  }
  return { claims, invalid };
}

/**
 * True when two claims touch the same file or one contains the other. Comparison is on whole
 * path segments and case-insensitive (Windows checkouts are case-insensitive).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function claimsOverlap(a, b) {
  const x = normalizeClaim(a)?.toLowerCase();
  const y = normalizeClaim(b)?.toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * Finds every pair of entries whose claims overlap.
 * @param {ReadonlyArray<{ id: string, claims?: readonly unknown[] | null }>} entries
 * @returns {Array<{ a: string, b: string, pairs: Array<{ a: string, b: string }> }>}
 */
export function findClaimOverlaps(entries) {
  const normalized = entries.map((entry) => ({
    id: entry.id,
    claims: parseClaims(Array.isArray(entry.claims) ? entry.claims : []).claims,
  }));
  const overlaps = [];
  for (let i = 0; i < normalized.length; i += 1)
    for (let j = i + 1; j < normalized.length; j += 1) {
      const pairs = [];
      for (const a of normalized[i].claims)
        for (const b of normalized[j].claims)
          if (claimsOverlap(a, b)) pairs.push({ a, b });
      if (pairs.length)
        overlaps.push({ a: normalized[i].id, b: normalized[j].id, pairs });
    }
  return overlaps;
}

/**
 * Formats one overlap pair list as `x` (same path) or `x ~ y` (prefix overlap).
 * @param {ReadonlyArray<{ a: string, b: string }>} pairs
 * @returns {string}
 */
export function formatClaimPairs(pairs) {
  return pairs
    .map(({ a, b }) =>
      a.toLowerCase() === b.toLowerCase() ? a : `${a} ~ ${b}`,
    )
    .join(', ');
}
