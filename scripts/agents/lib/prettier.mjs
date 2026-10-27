// Load the repository's own Prettier and wrap it as a formatter function so
// generated files match `prettier --check .` byte for byte.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Extensions Prettier does not infer but whose content is Markdown. */
const EXTRA_PARSERS = { '.mdc': 'markdown' };

/**
 * @callback Formatter
 * @param {string} text
 * @param {string} filePath Absolute output path (selects parser and config).
 * @returns {Promise<string> | string}
 */

async function importPrettierFrom(fromFile) {
  const require = createRequire(fromFile);
  const manifestPath = require.resolve('prettier/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.exports?.['.']?.default ?? 'index.mjs';
  const prettier = await import(
    pathToFileURL(path.join(path.dirname(manifestPath), entry)).href
  );
  if (typeof prettier.format !== 'function')
    throw new Error(`${manifestPath} does not export format()`);
  return prettier;
}

/**
 * Import Prettier as resolved from `root` (falling back to the repository that
 * contains this script, for `--root` pointing at a directory without
 * node_modules).
 * @param {string} root
 * @returns {Promise<typeof import('prettier')>}
 * @throws {Error} with an actionable message when Prettier is not installed.
 */
export async function loadPrettier(root) {
  const candidates = [
    path.join(root, 'package.json'),
    fileURLToPath(import.meta.url),
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      return await importPrettierFrom(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `Cannot load prettier, which formats the generated files. Run "npm ci" in the repository first.\n  ${failures.join('\n  ')}`,
  );
}

/**
 * Create a formatter that applies the repository's Prettier configuration
 * (including overrides and .editorconfig) for each output path. Files Prettier
 * has no parser for (e.g. TOML) are returned unchanged.
 * @param {string} root
 * @returns {Promise<Formatter>}
 */
export async function createPrettierFormatter(root) {
  const prettier = await loadPrettier(root);
  return async (text, filePath) => {
    const { inferredParser } = await prettier.getFileInfo(filePath);
    const parser =
      inferredParser ?? EXTRA_PARSERS[path.extname(filePath).toLowerCase()];
    if (!parser) return text;
    const config =
      (await prettier.resolveConfig(filePath, { editorconfig: true })) ?? {};
    try {
      return await prettier.format(text, {
        ...config,
        filepath: filePath,
        parser,
      });
    } catch (error) {
      throw new Error(
        `prettier failed on generated ${filePath}: ${error.message}`,
      );
    }
  };
}
