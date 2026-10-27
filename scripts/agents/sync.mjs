// Generate harness-specific agent config (Claude Code, Codex, Cursor, GitHub
// Copilot) from the canonical sources in .agents/. See .agents/README.md.
//
//   node scripts/agents/sync.mjs [--check] [--root <dir>]
//
// Exit codes: 0 ok, 1 validation error / drift / failure, 2 usage.
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  agentsTable,
  ESSENTIALS_REGION,
  locateRegions,
  regionContent,
  renderCopilotRepoInstructions,
  replaceRegions,
  rulesTable,
  skillsTable,
  TABLE_REGIONS,
} from './lib/agents-md.mjs';
import { normalizeNewlines } from './lib/frontmatter.mjs';
import { createPrettierFormatter } from './lib/prettier.mjs';
import {
  hasGeneratedMarker,
  insertMarkdownMarker,
  renderClaudeAgent,
  renderClaudeRule,
  renderCodexAgent,
  renderCopilotAgent,
  renderCopilotInstructions,
  renderCursorRule,
} from './lib/render.mjs';
import {
  compareStrings,
  listFilesRecursive,
  loadSources,
  toAbsolute,
} from './lib/sources.mjs';

/** Output directories scanned for stale generated files. */
export const MANAGED_DIRS = [
  '.claude/skills',
  '.claude/agents',
  '.claude/rules',
  '.cursor/rules',
  '.github/agents',
  '.github/instructions',
  '.codex/agents',
];
const SKILLS_OUTPUT_DIR = '.claude/skills';

const USAGE = 'Usage: node scripts/agents/sync.mjs [--check] [--root <dir>]';

/** Invalid canonical sources; `errors` holds one "<path>: <problem>" per entry. */
export class SyncValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`Invalid agent sources:\n${errors.join('\n')}`);
    this.name = 'SyncValidationError';
    this.errors = errors;
  }
}

/**
 * @typedef {import('./lib/prettier.mjs').Formatter} Formatter
 * @typedef {Map<string, string | Buffer>} OutputPlan Repo-relative POSIX path → content.
 */

/**
 * Compute every generated file in memory. Reads sources only; writes nothing.
 * @param {string} root Repository root.
 * @param {{ formatter?: Formatter }} [options] `formatter` defaults to the
 *   repository's Prettier; tests inject a stub.
 * @returns {Promise<OutputPlan>} Sorted by path.
 * @throws {SyncValidationError} when sources or AGENTS.md markers are invalid.
 */
export async function planOutputs(root, { formatter } = {}) {
  const { skills, agents, rules, errors } = await loadSources(root);

  let agentsMd = null;
  try {
    agentsMd = normalizeNewlines(
      await readFile(path.join(root, 'AGENTS.md'), 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    errors.push('AGENTS.md: file not found');
  }
  const located =
    agentsMd === null
      ? null
      : locateRegions(agentsMd, [...TABLE_REGIONS, ESSENTIALS_REGION]);
  if (located) errors.push(...located.errors);
  const essentials =
    located && !located.errors.length
      ? regionContent(agentsMd, located.regions.get(ESSENTIALS_REGION))
      : null;
  if (essentials === '')
    errors.push(`AGENTS.md: the ${ESSENTIALS_REGION} region is empty`);
  if (errors.length) throw new SyncValidationError(errors);

  const format = formatter ?? (await createPrettierFormatter(root));
  const formatAs = async (rel, text) => format(text, toAbsolute(root, rel));
  /** @type {OutputPlan} */
  const outputs = new Map();
  const addFormatted = async (rel, text) =>
    outputs.set(rel, await formatAs(rel, text));

  // Skills are copied verbatim (LF) so both copies stay identical; the
  // canonical files are already Prettier-clean.
  for (const skill of skills) {
    const dir = `${SKILLS_OUTPUT_DIR}/${skill.name}`;
    outputs.set(
      `${dir}/SKILL.md`,
      insertMarkdownMarker(skill.text, skill.source),
    );
    for (const file of skill.files)
      outputs.set(`${dir}/${file.rel}`, file.content);
  }
  for (const agent of agents) {
    await addFormatted(
      `.claude/agents/${agent.name}.md`,
      renderClaudeAgent(agent),
    );
    await addFormatted(
      `.github/agents/${agent.name}.agent.md`,
      renderCopilotAgent(agent),
    );
    outputs.set(`.codex/agents/${agent.name}.toml`, renderCodexAgent(agent));
  }
  for (const rule of rules) {
    await addFormatted(`.claude/rules/${rule.name}.md`, renderClaudeRule(rule));
    await addFormatted(
      `.cursor/rules/${rule.name}.mdc`,
      renderCursorRule(rule),
    );
    await addFormatted(
      `.github/instructions/${rule.name}.instructions.md`,
      renderCopilotInstructions(rule),
    );
  }

  const tables = {
    skills: skillsTable(skills),
    agents: agentsTable(agents),
    rules: rulesTable(rules),
  };
  for (const [name, text] of Object.entries(tables))
    tables[name] = await formatAs('AGENTS.md', text);
  outputs.set('AGENTS.md', replaceRegions(agentsMd, located.regions, tables));
  await addFormatted(
    '.github/copilot-instructions.md',
    renderCopilotRepoInstructions(essentials),
  );

  return new Map([...outputs].sort(([a], [b]) => compareStrings(a, b)));
}

async function readExisting(root, rel) {
  try {
    return await readFile(toAbsolute(root, rel));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function toBuffer(content) {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

/**
 * Compare planned outputs with the files on disk.
 * @param {string} root
 * @param {OutputPlan} outputs
 * @returns {Promise<{ created: string[], updated: string[], unchanged: string[] }>}
 */
export async function diffOutputs(root, outputs) {
  const result = { created: [], updated: [], unchanged: [] };
  for (const [rel, content] of outputs) {
    const existing = await readExisting(root, rel);
    if (!existing) result.created.push(rel);
    else if (existing.equals(toBuffer(content))) result.unchanged.push(rel);
    else result.updated.push(rel);
  }
  return result;
}

/**
 * Find generated files that no longer have a source. A file is generated when
 * it carries the marker; a `.claude/skills/<name>/` directory is generated as
 * a whole when its skill exists in .agents/skills or its SKILL.md carries the
 * marker. Unmarked files elsewhere are hand-written and never reported.
 * @param {string} root
 * @param {OutputPlan} outputs
 * @returns {Promise<string[]>} Sorted repo-relative paths.
 */
export async function findStaleOutputs(root, outputs) {
  const planned = new Set(outputs.keys());
  const ownedSkillDirs = new Map();
  for (const rel of planned)
    if (rel.startsWith(`${SKILLS_OUTPUT_DIR}/`))
      ownedSkillDirs.set(rel.split('/').slice(0, 3).join('/'), true);

  const isMarked = async (rel) => {
    const bytes = await readExisting(root, rel);
    return bytes !== null && hasGeneratedMarker(bytes.toString('utf8'));
  };
  const isOwnedSkillDir = async (dir) => {
    if (!ownedSkillDirs.has(dir))
      ownedSkillDirs.set(dir, await isMarked(`${dir}/SKILL.md`));
    return ownedSkillDirs.get(dir);
  };

  const stale = [];
  for (const dir of MANAGED_DIRS) {
    const { files } = await listFilesRecursive(root, dir);
    for (const rel of files) {
      if (planned.has(rel)) continue;
      const parts = rel.split('/');
      const inSkillDir = dir === SKILLS_OUTPUT_DIR && parts.length > 3;
      if (inSkillDir && (await isOwnedSkillDir(parts.slice(0, 3).join('/'))))
        stale.push(rel);
      else if (await isMarked(rel)) stale.push(rel);
    }
  }
  return stale.sort(compareStrings);
}

/** Remove directories emptied by deletions, stopping at the managed root. */
async function pruneEmptyParents(root, rel) {
  const managedRoot = MANAGED_DIRS.find((dir) => rel.startsWith(`${dir}/`));
  let dir = path.posix.dirname(rel);
  while (managedRoot && dir !== managedRoot && dir.startsWith(managedRoot)) {
    try {
      await rmdir(toAbsolute(root, dir));
    } catch {
      return;
    }
    dir = path.posix.dirname(dir);
  }
}

/**
 * Regenerate all outputs (or, with `check`, only compare them).
 * @param {{ root?: string, check?: boolean, formatter?: Formatter }} [options]
 * @returns {Promise<{ outputs: OutputPlan, created: string[], updated: string[], unchanged: string[], stale: string[] }>}
 *   In sync mode `stale` lists the files that were deleted.
 */
export async function syncAgents({
  root = process.cwd(),
  check = false,
  formatter,
} = {}) {
  const outputs = await planOutputs(root, { formatter });
  const diff = await diffOutputs(root, outputs);
  const stale = await findStaleOutputs(root, outputs);
  if (!check) {
    for (const rel of [...diff.created, ...diff.updated]) {
      const target = toAbsolute(root, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, outputs.get(rel));
    }
    for (const rel of stale) {
      await rm(toAbsolute(root, rel), { force: true });
      await pruneEmptyParents(root, rel);
    }
  }
  return { outputs, ...diff, stale };
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * CLI entry point.
 * @param {string[]} [argv]
 * @param {{ log?: (line: string) => void, error?: (line: string) => void, formatter?: Formatter }} [io]
 * @returns {Promise<number>} Process exit code.
 */
export async function main(
  argv = process.argv.slice(2),
  { log = console.log, error = console.error, formatter } = {},
) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        check: { type: 'boolean', default: false },
        root: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (parseError) {
    error(`agents:sync: ${parseError.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const label = values.check ? 'agents:check' : 'agents:sync';
  const root = path.resolve(values.root ?? process.cwd());

  let result;
  try {
    result = await syncAgents({ root, check: values.check, formatter });
  } catch (failure) {
    if (failure instanceof SyncValidationError)
      error(
        `${label}: ${plural(failure.errors.length, 'problem')} in agent sources:\n${failure.errors.map((line) => `  ${line}`).join('\n')}`,
      );
    else error(`${label}: ${failure.message}`);
    return 1;
  }

  const { created, updated, unchanged, stale } = result;
  if (values.check) {
    const drift = [
      ...created.map((rel) => `  missing  ${rel}`),
      ...updated.map((rel) => `  drifted  ${rel}`),
      ...stale.map((rel) => `  stale    ${rel}`),
    ];
    if (!drift.length) {
      log(
        `${label}: ${plural(unchanged.length, 'generated file')} up to date.`,
      );
      return 0;
    }
    error(
      `${label}: ${plural(drift.length, 'generated file')} out of date:\n${drift.join('\n')}\nRun "npm run agents:sync" and commit the result.`,
    );
    return 1;
  }

  for (const rel of created) log(`  created  ${rel}`);
  for (const rel of updated) log(`  updated  ${rel}`);
  for (const rel of stale) log(`  deleted  ${rel}`);
  log(
    `${label}: ${created.length} created, ${updated.length} updated, ${stale.length} deleted, ${unchanged.length} unchanged.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
