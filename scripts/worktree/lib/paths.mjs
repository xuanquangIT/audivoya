// Path identity helpers that tolerate Windows casing, separators and 8.3 short names.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns the canonical absolute form of a path. The longest existing prefix is resolved with
 * `realpath` (junctions, symlinks and Windows short names expanded); the rest is appended as-is.
 * @param {string} target
 * @returns {string}
 */
export function canonicalPath(target) {
  const resolved = path.resolve(target);
  let current = resolved;
  const missing = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function comparable(target) {
  const canonical = canonicalPath(target);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/**
 * True when both paths name the same location (case-insensitive on Windows).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  return comparable(a) === comparable(b);
}

/**
 * True when `child` equals `parent` or lies below it.
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
export function isInside(child, parent) {
  const relative = path.relative(comparable(parent), comparable(child));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * Converts a relative path to forward-slash form for display and comparison.
 * @param {string} relative
 * @returns {string}
 */
export function toPosix(relative) {
  return relative.split(path.sep).join('/');
}
