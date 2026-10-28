// AGENTS.md marker regions: generated catalog tables and the essentials
// excerpt mirrored into .github/copilot-instructions.md.
import { markdownMarker } from './render.mjs';

/** Regions the generator rewrites. */
export const TABLE_REGIONS = ['skills', 'agents', 'rules'];
/** Region copied verbatim into .github/copilot-instructions.md. */
export const ESSENTIALS_REGION = 'essentials';

/**
 * Literal marker comment for a region edge.
 * @param {string} name
 * @param {'start' | 'end'} edge
 */
export function regionMarker(name, edge) {
  return `<!-- agents:${name}:${edge} -->`;
}

function markerPattern(name, edge) {
  return new RegExp(`<!--\\s*agents:${name}:${edge}\\s*-->`, 'g');
}

/**
 * @typedef {{ name: string, outerStart: number, innerStart: number, innerEnd: number, outerEnd: number }} Region
 */

/**
 * Locate the named marker regions; every region must appear exactly once,
 * start before end, and not overlap another.
 * @param {string} text AGENTS.md content.
 * @param {string[]} names
 * @returns {{ regions: Map<string, Region>, errors: string[] }}
 */
export function locateRegions(text, names) {
  const regions = new Map();
  const errors = [];
  for (const name of names) {
    const starts = [...text.matchAll(markerPattern(name, 'start'))];
    const ends = [...text.matchAll(markerPattern(name, 'end'))];
    let valid = true;
    for (const [edge, matches] of [
      ['start', starts],
      ['end', ends],
    ]) {
      if (matches.length === 1) continue;
      valid = false;
      errors.push(
        matches.length === 0
          ? `AGENTS.md: missing ${regionMarker(name, edge)} marker`
          : `AGENTS.md: ${regionMarker(name, edge)} appears ${matches.length} times (expected once)`,
      );
    }
    if (!valid) continue;
    const [start] = starts;
    const [end] = ends;
    if (end.index < start.index) {
      errors.push(
        `AGENTS.md: ${regionMarker(name, 'end')} must come after ${regionMarker(name, 'start')}`,
      );
      continue;
    }
    regions.set(name, {
      name,
      outerStart: start.index,
      innerStart: start.index + start[0].length,
      innerEnd: end.index,
      outerEnd: end.index + end[0].length,
    });
  }
  const sorted = [...regions.values()].sort(
    (a, b) => a.outerStart - b.outerStart,
  );
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].outerStart < sorted[i - 1].outerEnd)
      errors.push(
        `AGENTS.md: regions "${sorted[i - 1].name}" and "${sorted[i].name}" overlap`,
      );
  return { regions, errors };
}

/**
 * Replace region contents, leaving all text outside the markers untouched.
 * @param {string} text
 * @param {Map<string, Region>} regions From `locateRegions` on the same text.
 * @param {Record<string, string>} contents Region name → Markdown content.
 * @returns {string}
 */
export function replaceRegions(text, regions, contents) {
  const targets = Object.keys(contents)
    .map((name) => regions.get(name))
    .sort((a, b) => b.innerStart - a.innerStart);
  let result = text;
  for (const region of targets)
    result =
      result.slice(0, region.innerStart) +
      `\n\n${contents[region.name].trim()}\n\n` +
      result.slice(region.innerEnd);
  return result;
}

/**
 * Text between a region's markers, without surrounding blank lines.
 * @param {string} text
 * @param {Region} region
 */
export function regionContent(text, region) {
  return text.slice(region.innerStart, region.innerEnd).trim();
}

/**
 * First sentence of a description (ignores "e.g.", "i.e.", "vs.", "cf.").
 * @param {string} text
 * @returns {string}
 */
export function firstSentence(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = /[.!?](?=\s|$)/g;
  for (let match = end.exec(flat); match; match = end.exec(flat)) {
    const sentence = flat.slice(0, match.index + 1);
    if (!/(?:^|[\s(])(?:e\.g|i\.e|vs|cf)\.$/i.test(sentence)) return sentence;
  }
  return flat;
}

function cell(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '&#124;')
    .replace(/</g, '&lt;');
}

function code(text) {
  return `\`${text}\``;
}

function link(target) {
  return `[${target}](${target})`;
}

function table(headers, rows) {
  if (!rows.length) return '_None._';
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

/**
 * @param {import('./sources.mjs').Skill[]} skills
 * @returns {string} Markdown table (unformatted).
 */
export function skillsTable(skills) {
  return table(
    ['Skill', 'Purpose', 'Source'],
    skills.map((skill) => [
      code(skill.name),
      cell(firstSentence(skill.description)),
      link(skill.source),
    ]),
  );
}

/**
 * Agents table. Like skills it shows only the first sentence: full agent
 * descriptions run to ~1 KB each and Prettier pads every row to the widest
 * cell, which would bloat AGENTS.md (Codex reads it under a size budget).
 * @param {import('./sources.mjs').Agent[]} agents
 * @returns {string} Markdown table (unformatted).
 */
export function agentsTable(agents) {
  return table(
    ['Agent', 'Purpose', 'Source'],
    agents.map((agent) => [
      code(agent.name),
      cell(firstSentence(agent.description)),
      link(agent.source),
    ]),
  );
}

/**
 * @param {import('./sources.mjs').Rule[]} rules
 * @returns {string} Markdown table (unformatted).
 */
export function rulesTable(rules) {
  return table(
    ['Rule', 'Applies to', 'Source'],
    rules.map((rule) => [
      code(rule.name),
      rule.alwaysApply ? 'always' : rule.paths.map(code).join(', '),
      link(rule.source),
    ]),
  );
}

/**
 * `.github/copilot-instructions.md`: GitHub.com chat does not read AGENTS.md,
 * so it gets the essentials region verbatim.
 * @param {string} essentials Region content.
 */
export function renderCopilotRepoInstructions(essentials) {
  return `${markdownMarker('AGENTS.md')}\n\nFull instructions: [AGENTS.md](../AGENTS.md). This file repeats only its essentials.\n\n${essentials.trim()}\n`;
}
