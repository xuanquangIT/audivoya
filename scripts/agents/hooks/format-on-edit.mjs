// PostToolUse hook: format the file an agent just edited or wrote with the
// repository's own Prettier, so `npm run format:check` stays green without a
// separate formatting pass. Silent on success; never fails the tool call
// (always exit 0, problems go to stderr).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  findRepoRoot,
  hookCwd,
  isEntryPoint,
  runHook,
  samePath,
  toolFilePath,
} from './lib/hook-io.mjs';

const MAX_BYTES = 1024 * 1024;
/** Edit-tool names across harnesses; VS Code ignores matchers, so filter here. */
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'create']);
const IGNORE_FILES = ['.gitignore', '.prettierignore'];

/**
 * Load Prettier from the repository root (not from this script's location),
 * so each worktree formats with its own pinned version.
 * @param {string} root
 * @returns {Promise<typeof import('prettier')>}
 */
export async function loadRepoPrettier(root) {
  return createRequire(path.join(root, 'package.json'))('prettier');
}

/**
 * Format `filePath` in place when it is a regular file inside the repository
 * that contains `cwd`, is not ignored by `.gitignore`/`.prettierignore`
 * (Prettier CLI semantics), and has a Prettier parser. Never throws.
 * @param {{ filePath: string, cwd: string, loadPrettier?: (root: string) => Promise<any> }} options
 * @returns {Promise<{ status: 'formatted' | 'unchanged' | 'skipped' | 'error', reason?: string }>}
 */
export async function formatOnEdit({
  filePath,
  cwd,
  loadPrettier = loadRepoPrettier,
}) {
  if (!filePath) return skipped('no file path in the hook input');
  const root = findRepoRoot(cwd);
  if (!root) return skipped('cwd is not inside a repository');
  const file = path.resolve(cwd, filePath);
  const relative = path.relative(root, file);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return skipped('outside the repository');
  const owner = findRepoRoot(path.dirname(file));
  if (!owner || !samePath(owner, root))
    return skipped('inside a nested worktree');
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return skipped('file does not exist');
  }
  if (!stat.isFile() || stat.size > MAX_BYTES)
    return skipped('not a regular file or larger than 1 MiB');

  let prettier;
  try {
    prettier = await loadPrettier(root);
  } catch {
    return skipped(
      `prettier is not installed; run node scripts/worktree/setup.mjs`,
    );
  }
  try {
    const ignorePath = IGNORE_FILES.map((name) => path.join(root, name)).filter(
      (candidate) => fs.existsSync(candidate),
    );
    const info = await prettier.getFileInfo(file, {
      ignorePath,
      resolveConfig: true,
    });
    if (info.ignored)
      return skipped('ignored by .gitignore or .prettierignore');
    if (!info.inferredParser)
      return skipped('no Prettier parser for this file');
    const source = fs.readFileSync(file, 'utf8');
    const options =
      (await prettier.resolveConfig(file, { editorconfig: true })) ?? {};
    const formatted = await prettier.format(source, {
      ...options,
      filepath: file,
    });
    if (formatted === source) return { status: 'unchanged' };
    fs.writeFileSync(file, formatted);
    return { status: 'formatted' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      reason: `${relative.replaceAll('\\', '/')}: ${message.split(/\r?\n/, 1)[0]}`,
    };
  }
}

/**
 * Hook entry: format the edited file and always exit 0.
 * @param {Record<string, any>} input Parsed hook payload.
 * @returns {Promise<{ code: number, stderr?: string }>}
 */
export async function formatOnEditHook(input) {
  const tool = input.tool_name ?? input.toolName;
  if (typeof tool === 'string' && !EDIT_TOOLS.has(tool.toLowerCase()))
    return { code: 0 };
  const result = await formatOnEdit({
    filePath: toolFilePath(input),
    cwd: hookCwd(input),
  });
  return result.status === 'error'
    ? { code: 0, stderr: `format-on-edit: ${result.reason}\n` }
    : { code: 0 };
}

function skipped(reason) {
  return { status: 'skipped', reason };
}

if (isEntryPoint(import.meta.url))
  await runHook('format-on-edit', formatOnEditHook);
