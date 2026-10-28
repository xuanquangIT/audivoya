// Minimal YAML-frontmatter reader for the canonical agent sources in .agents/.
// It supports exactly the subset the formats in .agents/README.md need and
// rejects everything else with a line-numbered error instead of guessing:
//   - scalars: plain, 'single quoted', "double quoted"; true/false; null/~
//   - block lists ("- item") at the key's indentation or indented below it
//   - single-line flow lists ("[a, 'b', "c"]")
//   - one level of nested map (e.g. `metadata:` followed by indented pairs)
//   - full-line and trailing comments
// Numbers stay strings. Comma-separated strings are split by `toList`.

/** Malformed frontmatter; `line` is 1-based within the parsed document. */
export class FrontmatterError extends Error {
  /**
   * @param {string} message
   * @param {number} [line]
   */
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

/**
 * Normalize text read from disk: drop a leading UTF-8 BOM, convert CRLF/CR to LF.
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * Split `---`-delimited frontmatter from a Markdown document.
 * @param {string} text LF-normalized document.
 * @returns {{ yaml: string, head: string, body: string } | null} `head` is the
 *   exact frontmatter block (both delimiter lines plus the newline after the
 *   closing one) so `head + body === text`; null when there is no frontmatter.
 * @throws {FrontmatterError} when the opening `---` has no closing line.
 */
export function splitFrontmatter(text) {
  if (!/^---[ \t]*(?:\n|$)/.test(text)) return null;
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!/^---[ \t]*$/.test(lines[i])) continue;
    const hasMore = i + 1 < lines.length;
    return {
      yaml: lines.slice(1, i).join('\n'),
      head: lines.slice(0, i + 1).join('\n') + (hasMore ? '\n' : ''),
      body: hasMore ? lines.slice(i + 1).join('\n') : '',
    };
  }
  throw new FrontmatterError(
    'frontmatter is missing its closing "---" line',
    1,
  );
}

/**
 * Parse a Markdown document with optional YAML frontmatter.
 * @param {string} text LF-normalized document.
 * @returns {{ data: Record<string, unknown> | null, head: string, body: string }}
 * @throws {FrontmatterError}
 */
export function parseFrontmatter(text) {
  const split = splitFrontmatter(text);
  if (!split) return { data: null, head: '', body: text };
  return {
    data: parseYamlSubset(split.yaml, 2),
    head: split.head,
    body: split.body,
  };
}

const BLANK_OR_COMMENT = /^[ \t]*(?:#.*)?$/;
const KEY_LINE = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const LIST_ITEM = /^-(?:[ \t]+(.*)|[ \t]*)$/;

/**
 * Parse the supported YAML subset into a plain object.
 * @param {string} yaml Frontmatter text without the `---` delimiters.
 * @param {number} [firstLine=1] File line number of the first YAML line.
 * @returns {Record<string, unknown>}
 * @throws {FrontmatterError}
 */
export function parseYamlSubset(yaml, firstLine = 1) {
  const lines = yaml.split('\n');
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = firstLine + i;
    i++;
    if (BLANK_OR_COMMENT.test(line)) continue;
    assertNoTabIndent(line, lineNo);
    if (/^ /.test(line))
      throw new FrontmatterError(
        'unexpected indentation (multi-line values are not supported; keep each value on one line)',
        lineNo,
      );
    const { key, rest } = parseKeyLine(line, lineNo);
    if (Object.hasOwn(data, key))
      throw new FrontmatterError(`duplicate key "${key}"`, lineNo);
    if (rest !== '' && !rest.startsWith('#')) {
      data[key] = parseInlineValue(rest, lineNo);
      continue;
    }
    const start = i;
    while (
      i < lines.length &&
      (BLANK_OR_COMMENT.test(lines[i]) ||
        /^[ \t]/.test(lines[i]) ||
        /^-(?:[ \t]|$)/.test(lines[i]))
    )
      i++;
    data[key] = parseChildren(lines.slice(start, i), firstLine + start);
  }
  return data;
}

function assertNoTabIndent(line, lineNo) {
  if (/^ *\t/.test(line))
    throw new FrontmatterError('tabs are not allowed for indentation', lineNo);
}

function parseKeyLine(text, lineNo) {
  const match = KEY_LINE.exec(text);
  if (!match)
    throw new FrontmatterError(
      `expected "key: value", got ${JSON.stringify(text.trim())}`,
      lineNo,
    );
  return { key: match[1], rest: (match[2] ?? '').trim() };
}

function leadingSpaces(text) {
  return /^ */.exec(text)[0].length;
}

function parseChildren(childLines, firstLineNo) {
  const items = childLines
    .map((text, index) => ({ text, line: firstLineNo + index }))
    .filter((child) => !BLANK_OR_COMMENT.test(child.text));
  if (!items.length) return null;
  for (const child of items) assertNoTabIndent(child.text, child.line);
  const indent = leadingSpaces(items[0].text);
  const isList = LIST_ITEM.test(items[0].text.slice(indent));

  if (isList) {
    return items.map((child) => {
      if (leadingSpaces(child.text) !== indent)
        throw new FrontmatterError(
          'inconsistent list indentation (nested structures are not supported)',
          child.line,
        );
      const match = LIST_ITEM.exec(child.text.slice(indent));
      if (!match)
        throw new FrontmatterError(
          'expected "- item" (nested structures are not supported)',
          child.line,
        );
      const raw = (match[1] ?? '').trim();
      if (raw === '' || raw.startsWith('#'))
        throw new FrontmatterError('empty list item', child.line);
      const value = parseInlineValue(raw, child.line);
      if (Array.isArray(value))
        throw new FrontmatterError(
          'nested lists are not supported',
          child.line,
        );
      if (value === null)
        throw new FrontmatterError('empty list item', child.line);
      return value;
    });
  }

  const map = {};
  for (const child of items) {
    if (leadingSpaces(child.text) !== indent)
      throw new FrontmatterError(
        'inconsistent indentation (only one level of nesting is supported)',
        child.line,
      );
    const { key, rest } = parseKeyLine(child.text.slice(indent), child.line);
    if (rest === '' || rest.startsWith('#'))
      throw new FrontmatterError(
        `"${key}" has no value (only one level of nesting is supported)`,
        child.line,
      );
    if (Object.hasOwn(map, key))
      throw new FrontmatterError(`duplicate key "${key}"`, child.line);
    map[key] = parseInlineValue(rest, child.line);
  }
  return map;
}

/**
 * Parse a value that sits on the same line as its key or list dash.
 * @param {string} text Trimmed, non-empty value text.
 * @param {number} lineNo
 * @returns {string | boolean | null | Array<string | boolean | null>}
 */
function parseInlineValue(text, lineNo) {
  const first = text[0];
  if (first === '"' || first === "'") {
    const { value, end } = parseQuoted(text, 0, lineNo);
    assertOnlyComment(text.slice(end), lineNo);
    return value;
  }
  if (first === '[') return parseFlowList(text, lineNo);
  if (first === '{')
    throw new FrontmatterError(
      'flow mappings ("{...}") are not supported',
      lineNo,
    );
  if (first === '|' || first === '>')
    throw new FrontmatterError(
      'block scalars ("|" and ">") are not supported; keep the value on one line',
      lineNo,
    );
  return resolveScalar(parsePlain(text, lineNo, false), lineNo);
}

function parsePlain(text, lineNo, inFlow) {
  const first = text[0];
  if ('&*!'.includes(first))
    throw new FrontmatterError(
      `a value starting with "${first}" must be quoted (YAML anchor, alias or tag syntax)`,
      lineNo,
    );
  if ('@`%,]}'.includes(first) || (inFlow && '[{'.includes(first)))
    throw new FrontmatterError(
      `a value starting with "${first}" must be quoted`,
      lineNo,
    );
  if ('-?:'.includes(first) && (text.length === 1 || /\s/.test(text[1])))
    throw new FrontmatterError(
      `a value starting with "${first} " must be quoted`,
      lineNo,
    );
  const commentAt = text.search(/[ \t]#/);
  const value = (commentAt === -1 ? text : text.slice(0, commentAt)).trim();
  if (/:(?:[ \t]|$)/.test(value))
    throw new FrontmatterError(
      `a value containing ": " or ending with ":" must be quoted: ${value}`,
      lineNo,
    );
  return value;
}

function resolveScalar(value, lineNo) {
  if (value === '') throw new FrontmatterError('empty value', lineNo);
  if (/^(?:true|True|TRUE)$/.test(value)) return true;
  if (/^(?:false|False|FALSE)$/.test(value)) return false;
  if (/^(?:null|Null|NULL|~)$/.test(value)) return null;
  return value;
}

function assertOnlyComment(rest, lineNo) {
  if (rest.trim() !== '' && !/^[ \t]+#/.test(rest))
    throw new FrontmatterError(
      `unexpected text after quoted value: ${JSON.stringify(rest.trim())}`,
      lineNo,
    );
}

const DOUBLE_QUOTE_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
  L: ' ',
  P: ' ',
};
const HEX_ESCAPE_LENGTH = { x: 2, u: 4, U: 8 };

/**
 * Parse a quoted scalar starting at `start`.
 * @returns {{ value: string, end: number }} `end` is the index after the closing quote.
 */
function parseQuoted(text, start, lineNo) {
  const quote = text[start];
  let value = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        return { value, end: i + 1 };
      }
      value += ch;
      i++;
      continue;
    }
    if (ch === '"') return { value, end: i + 1 };
    if (ch !== '\\') {
      value += ch;
      i++;
      continue;
    }
    const escape = text[i + 1];
    if (Object.hasOwn(HEX_ESCAPE_LENGTH, escape)) {
      const length = HEX_ESCAPE_LENGTH[escape];
      const hex = text.slice(i + 2, i + 2 + length);
      const codePoint = Number.parseInt(hex, 16);
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== length)
        throw new FrontmatterError(`invalid \\${escape} escape`, lineNo);
      if (codePoint > 0x10ffff)
        throw new FrontmatterError(`invalid \\${escape} escape`, lineNo);
      value += String.fromCodePoint(codePoint);
      i += 2 + length;
      continue;
    }
    if (!Object.hasOwn(DOUBLE_QUOTE_ESCAPES, escape))
      throw new FrontmatterError(
        `unsupported escape "\\${escape ?? ''}" in double-quoted value`,
        lineNo,
      );
    value += DOUBLE_QUOTE_ESCAPES[escape];
    i += 2;
  }
  throw new FrontmatterError(
    `unterminated ${quote === '"' ? 'double' : 'single'}-quoted value (quoted values must fit on one line)`,
    lineNo,
  );
}

function parseFlowList(text, lineNo) {
  const items = [];
  let i = 1;
  const skipSpaces = () => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  skipSpaces();
  if (text[i] === ']') return finishFlowList(text, i + 1, items, lineNo);
  while (i < text.length) {
    skipSpaces();
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const { value, end } = parseQuoted(text, i, lineNo);
      items.push(value);
      i = end;
    } else {
      let end = i;
      while (end < text.length && text[end] !== ',' && text[end] !== ']') end++;
      const raw = text.slice(i, end).trim();
      if (raw === '')
        throw new FrontmatterError('empty item in flow list', lineNo);
      if (/^[[{]/.test(raw))
        throw new FrontmatterError(
          'nested flow collections are not supported',
          lineNo,
        );
      items.push(resolveScalar(parsePlain(raw, lineNo, true), lineNo));
      i = end;
    }
    skipSpaces();
    if (text[i] === ',') {
      i++;
      skipSpaces();
      if (text[i] === ']') return finishFlowList(text, i + 1, items, lineNo);
      continue;
    }
    if (text[i] === ']') return finishFlowList(text, i + 1, items, lineNo);
    break;
  }
  throw new FrontmatterError(
    'unterminated flow list (expected "," or "]" on the same line)',
    lineNo,
  );
}

function finishFlowList(text, end, items, lineNo) {
  assertOnlyComment(text.slice(end), lineNo);
  return items;
}

/**
 * Split a comma-separated list, keeping commas inside `{...}` / `[...]` globs.
 * @param {string} text
 * @returns {string[]} Trimmed, non-empty items.
 */
export function splitCommaList(text) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && depth > 0) depth--;
    if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else current += ch;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

/**
 * Coerce a frontmatter value written as a comma string or a YAML list to a list.
 * @param {unknown} value
 * @returns {string[]}
 */
export function toList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value))
    return value.map((item) => String(item).trim()).filter(Boolean);
  return splitCommaList(String(value));
}
