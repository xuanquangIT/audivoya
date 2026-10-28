// Load and validate the canonical agent sources under .agents/.
// Every problem is collected (not thrown) so one run reports all of them.
import { isUtf8 } from 'node:buffer';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  FrontmatterError,
  normalizeNewlines,
  parseFrontmatter,
  toList,
} from './frontmatter.mjs';
import { tomlLiteralProblem } from './serialize.mjs';

/** Lowercase letters/digits separated by single hyphens (Agent Skills spec). */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
/** Neutral tool vocabulary, in canonical output order. */
export const AGENT_TOOLS = [
  'read',
  'search',
  'edit',
  'execute',
  'web',
  'agent',
];
export const MODEL_TIERS = ['inherit', 'fast', 'balanced', 'strong'];

const AGENT_KEYS = [
  'name',
  'description',
  'tools',
  'model-tier',
  'readonly',
  'skills',
];
const RULE_KEYS = ['description', 'paths', 'alwaysApply'];
/** Canonical-only file inside a skill (Codex UI metadata); never copied. */
export const SKILL_EXCLUDED_FILES = new Set(['agents/openai.yaml']);

/**
 * @typedef {{ rel: string, content: string | Buffer }} SkillFile
 * @typedef {{ name: string, source: string, description: string, text: string, files: SkillFile[] }} Skill
 * @typedef {{ name: string, source: string, description: string, tools: string[], tier: string, readonly: boolean, skills: string[], body: string }} Agent
 * @typedef {{ name: string, source: string, description: string, paths: string[], alwaysApply: boolean, body: string }} Rule
 * @typedef {{ skills: Skill[], agents: Agent[], rules: Rule[], errors: string[] }} Sources
 */

/**
 * Join a POSIX repo-relative path onto the root as a native absolute path.
 * @param {string} root
 * @param {string} rel
 */
export function toAbsolute(root, rel) {
  return path.join(root, ...rel.split('/'));
}

async function isDirectory(absPath) {
  try {
    return (await stat(absPath)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Sorted directory entries, or [] when the directory does not exist. */
async function listDir(root, rel) {
  try {
    const entries = await readdir(toAbsolute(root, rel), {
      withFileTypes: true,
    });
    return entries.sort((a, b) => compareStrings(a.name, b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Code-unit string comparison (locale independent, deterministic).
 * @param {string} a
 * @param {string} b
 */
export function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * List regular files below `rel` recursively as sorted POSIX paths relative to
 * the root. Entries that are neither files nor directories (symlinks, etc.)
 * are returned in `others` and never followed.
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<{ files: string[], others: string[] }>}
 */
export async function listFilesRecursive(root, rel) {
  const files = [];
  const others = [];
  for (const entry of await listDir(root, rel)) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(root, child);
      files.push(...nested.files);
      others.push(...nested.others);
    } else if (entry.isFile()) files.push(child);
    else others.push(child);
  }
  return { files, others };
}

async function readText(root, rel) {
  return normalizeNewlines(await readFile(toAbsolute(root, rel), 'utf8'));
}

/**
 * Read a file for copying: UTF-8 text gets LF line endings, anything else is
 * returned as the original bytes.
 * @param {string} absPath
 * @returns {Promise<string | Buffer>}
 */
export async function readCopyContent(absPath) {
  const bytes = await readFile(absPath);
  if (bytes.includes(0) || !isUtf8(bytes)) return bytes;
  return bytes.toString('utf8').replace(/\r\n?/g, '\n');
}

function parseSource(text, source, errors) {
  try {
    const parsed = parseFrontmatter(text);
    if (!parsed.data) {
      errors.push(`${source}: missing YAML frontmatter ("---" block)`);
      return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof FrontmatterError) {
      errors.push(`${source}: ${error.message}`);
      return null;
    }
    throw error;
  }
}

function checkName(value, expected, expectedLabel, problems) {
  if (typeof value !== 'string' || value === '') {
    problems.push('name is missing');
    return;
  }
  if (value.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(value)) {
    problems.push(
      `name "${value}" must be 1-${MAX_NAME_LENGTH} chars of a-z, 0-9 and single hyphens, with no leading or trailing hyphen`,
    );
    return;
  }
  if (value !== expected)
    problems.push(
      `name "${value}" must equal the ${expectedLabel} "${expected}"`,
    );
}

function checkDescription(value, problems) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push('description is missing');
    return '';
  }
  const description = value.trim();
  const length = [...description].length;
  if (length > MAX_DESCRIPTION_LENGTH)
    problems.push(
      `description is ${length} characters (max ${MAX_DESCRIPTION_LENGTH})`,
    );
  if (description.includes('\n'))
    problems.push('description must be a single line');
  return description;
}

function checkBoolean(data, key, problems) {
  const value = data[key];
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    problems.push(`${key} must be true or false`);
    return false;
  }
  return value;
}

function checkKeys(data, allowed, problems) {
  for (const key of Object.keys(data))
    if (!allowed.includes(key))
      problems.push(
        `unknown frontmatter key "${key}" (allowed: ${allowed.join(', ')})`,
      );
}

function checkStringList(data, key, problems) {
  const value = data[key];
  if (
    typeof value === 'boolean' ||
    (value !== null && typeof value === 'object' && !Array.isArray(value))
  ) {
    problems.push(`${key} must be a comma-separated string or a list`);
    return [];
  }
  return [...new Set(toList(value))];
}

function trimBody(body) {
  return body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

function report(errors, source, problems) {
  for (const problem of problems) errors.push(`${source}: ${problem}`);
  return problems.length === 0;
}

async function loadSkills(root, errors, declared) {
  const base = '.agents/skills';
  const skills = [];
  for (const entry of await listDir(root, base)) {
    if (!entry.isDirectory()) continue;
    const dir = `${base}/${entry.name}`;
    const source = `${dir}/SKILL.md`;
    let text;
    try {
      text = await readText(root, source);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      errors.push(`${dir}/: missing SKILL.md`);
      continue;
    }
    const parsed = parseSource(text, source, errors);
    if (!parsed) continue;
    const { data } = parsed;
    if (typeof data.name === 'string')
      declared.push({ name: data.name, source });
    const problems = [];
    checkName(data.name, entry.name, 'folder name', problems);
    const description = checkDescription(data.description, problems);
    checkBoolean(data, 'disable-model-invocation', problems);
    if (
      data.metadata !== undefined &&
      (data.metadata === null ||
        typeof data.metadata !== 'object' ||
        Array.isArray(data.metadata))
    )
      problems.push('metadata must be a map of key: value pairs');

    const files = [];
    const listing = await listFilesRecursive(root, dir);
    for (const other of listing.others)
      problems.push(
        `${other.slice(dir.length + 1)} is not a regular file (symlinks are not copied)`,
      );
    for (const fileRel of listing.files) {
      const rel = fileRel.slice(dir.length + 1);
      if (rel === 'SKILL.md' || SKILL_EXCLUDED_FILES.has(rel)) continue;
      files.push({
        rel,
        content: await readCopyContent(toAbsolute(root, fileRel)),
      });
    }
    if (report(errors, source, problems))
      skills.push({ name: data.name, source, description, text, files });
  }
  return skills;
}

/** Markdown sources in a flat directory, skipping README.md. */
async function listMarkdownSources(root, base) {
  return (await listDir(root, base)).filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      entry.name.toLowerCase() !== 'readme.md',
  );
}

async function loadAgents(root, errors, skillNames, declared) {
  const base = '.agents/agents';
  const agents = [];
  for (const entry of await listMarkdownSources(root, base)) {
    const source = `${base}/${entry.name}`;
    const parsed = parseSource(await readText(root, source), source, errors);
    if (!parsed) continue;
    const { data } = parsed;
    if (typeof data.name === 'string')
      declared.push({ name: data.name, source });
    const problems = [];
    checkKeys(data, AGENT_KEYS, problems);
    checkName(data.name, entry.name.slice(0, -3), 'file name', problems);
    const description = checkDescription(data.description, problems);

    const declaredTools = checkStringList(data, 'tools', problems);
    if (!declaredTools.length)
      problems.push(`tools is missing (subset of: ${AGENT_TOOLS.join(', ')})`);
    for (const tool of declaredTools)
      if (!AGENT_TOOLS.includes(tool))
        problems.push(
          `unknown tool "${tool}" (allowed: ${AGENT_TOOLS.join(', ')})`,
        );

    const tier = data['model-tier'] ?? 'inherit';
    if (typeof tier !== 'string' || !MODEL_TIERS.includes(tier))
      problems.push(
        `unknown model-tier "${tier}" (allowed: ${MODEL_TIERS.join(', ')})`,
      );

    const readonly = checkBoolean(data, 'readonly', problems);
    const tools = AGENT_TOOLS.filter(
      (tool) => declaredTools.includes(tool) && !(readonly && tool === 'edit'),
    );
    if (declaredTools.length && !tools.length)
      problems.push('readonly agent has no tools left after dropping edit');

    const skills = checkStringList(data, 'skills', problems);
    for (const skill of skills)
      if (!skillNames.has(skill))
        problems.push(
          `unknown skill "${skill}" in skills (no valid .agents/skills/${skill}/SKILL.md)`,
        );

    const body = trimBody(parsed.body);
    if (!body) problems.push('body (the system prompt) is empty');
    const literalProblem = tomlLiteralProblem(body);
    if (literalProblem)
      problems.push(
        `body ${literalProblem} (needed for .codex/agents developer_instructions)`,
      );

    if (report(errors, source, problems))
      agents.push({
        name: data.name,
        source,
        description,
        tools,
        tier,
        readonly,
        skills,
        body,
      });
  }
  return agents;
}

async function loadRules(root, errors) {
  const base = '.agents/rules';
  const rules = [];
  for (const entry of await listMarkdownSources(root, base)) {
    const source = `${base}/${entry.name}`;
    const name = entry.name.slice(0, -3);
    const parsed = parseSource(await readText(root, source), source, errors);
    if (!parsed) continue;
    const { data } = parsed;
    const problems = [];
    if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name))
      problems.push(
        `file name "${name}" must be 1-${MAX_NAME_LENGTH} chars of a-z, 0-9 and single hyphens`,
      );
    checkKeys(data, RULE_KEYS, problems);
    const description = checkDescription(data.description, problems);
    const alwaysApply = checkBoolean(data, 'alwaysApply', problems);
    const paths = checkStringList(data, 'paths', problems);
    if (!paths.length && !alwaysApply)
      problems.push('paths is required unless alwaysApply is true');
    const body = trimBody(parsed.body);
    if (!body) problems.push('body is empty');
    if (report(errors, source, problems))
      rules.push({ name, source, description, paths, alwaysApply, body });
  }
  return rules;
}

/** Report names declared by more than one source file. */
function checkDuplicates(declared, kind, errors) {
  const byName = new Map();
  for (const record of declared)
    byName.set(record.name, [...(byName.get(record.name) ?? []), record]);
  for (const [name, group] of byName)
    if (group.length > 1)
      errors.push(
        `duplicate ${kind} name "${name}": ${group.map((r) => r.source).join(', ')}`,
      );
}

/**
 * Load and validate `.agents/skills`, `.agents/agents` and `.agents/rules`.
 * Records with problems are left out and their problems added to `errors`.
 * @param {string} root Repository root.
 * @returns {Promise<Sources>}
 */
export async function loadSources(root) {
  const errors = [];
  if (!(await isDirectory(path.join(root, '.agents'))))
    return {
      skills: [],
      agents: [],
      rules: [],
      errors: [
        `.agents/: directory not found in ${root} (run from the repository root or pass --root <dir>)`,
      ],
    };
  const declaredSkills = [];
  const declaredAgents = [];
  const skills = await loadSkills(root, errors, declaredSkills);
  const agents = await loadAgents(
    root,
    errors,
    new Set(skills.map((skill) => skill.name)),
    declaredAgents,
  );
  // Rule names are file names, which the file system already keeps unique.
  const rules = await loadRules(root, errors);
  checkDuplicates(declaredSkills, 'skill', errors);
  checkDuplicates(declaredAgents, 'agent', errors);
  return { skills, agents, rules, errors };
}
