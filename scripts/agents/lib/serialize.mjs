// Tiny YAML-frontmatter and TOML writers for generated harness files.
// Output is deterministic; Prettier may restyle YAML quotes afterwards.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const YAML_RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;

function isPlainYamlSafe(text, inFlow) {
  if (text === '' || text.trim() !== text || CONTROL_CHARS.test(text))
    return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return false;
  if (/: |:$| #/.test(text)) return false;
  if (inFlow && /[,[\]{}]/.test(text)) return false;
  if (YAML_RESERVED.test(text)) return false;
  if (/^[-+.]?\d/.test(text) || /^[-+]?\.(?:inf|nan)$/i.test(text))
    return false;
  return true;
}

/**
 * Render a YAML scalar: plain when unambiguous, otherwise quoted.
 * @param {string | boolean} value
 * @param {{ inFlow?: boolean, forceQuotes?: boolean }} [options]
 * @returns {string}
 */
export function yamlScalar(
  value,
  { inFlow = false, forceQuotes = false } = {},
) {
  if (typeof value === 'boolean') return String(value);
  const text = String(value);
  if (!forceQuotes && isPlainYamlSafe(text, inFlow)) return text;
  if (!CONTROL_CHARS.test(text)) return `'${text.replace(/'/g, "''")}'`;
  return JSON.stringify(text);
}

/**
 * Mark a list to be written as a single-line flow sequence (`[a, b]`).
 * @param {string[]} items
 */
export function flowList(items) {
  return { kind: 'flow', items };
}

/**
 * Mark a string to be written double-quoted (Prettier may switch the quote style).
 * @param {string} text
 */
export function quoted(text) {
  return { kind: 'quoted', text };
}

/**
 * Mark a string to be written verbatim, e.g. Cursor `globs`, which Cursor
 * expects unquoted even when a glob starts with `*`.
 * @param {string} text
 */
export function raw(text) {
  return { kind: 'raw', text };
}

/**
 * Render a `---` frontmatter block. Fields whose value is undefined/null are
 * skipped; arrays become block lists.
 * @param {Array<[string, unknown]>} fields
 * @returns {string} Block ending with the closing `---` and a newline.
 */
export function yamlFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of fields) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else if (typeof value === 'object' && value.kind === 'flow') {
      const items = value.items.map((item) =>
        yamlScalar(item, { inFlow: true }),
      );
      lines.push(`${key}: [${items.join(', ')}]`);
    } else if (typeof value === 'object' && value.kind === 'quoted') {
      lines.push(`${key}: ${yamlScalar(value.text, { forceQuotes: true })}`);
    } else if (typeof value === 'object' && value.kind === 'raw') {
      lines.push(`${key}: ${value.text}`);
    } else {
      lines.push(
        `${key}: ${yamlScalar(/** @type {string|boolean} */ (value))}`,
      );
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

const TOML_SHORT_ESCAPES = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

/**
 * Render a TOML basic (double-quoted) string.
 * @param {string} text
 * @returns {string}
 */
export function tomlString(text) {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (Object.hasOwn(TOML_SHORT_ESCAPES, ch)) out += TOML_SHORT_ESCAPES[ch];
    else if (code < 0x20 || code === 0x7f)
      out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/**
 * Explain why `text` cannot be a TOML multi-line literal string, or null.
 * @param {string} text
 * @returns {string | null}
 */
export function tomlLiteralProblem(text) {
  if (text.includes("'''"))
    return `contains "'''", which a TOML multi-line literal string cannot hold`;
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text))
    return 'contains control characters that a TOML literal string cannot hold';
  return null;
}

/**
 * Render a TOML multi-line literal string (`'''...'''`, no escaping). The
 * newline after the opening delimiter is not part of the value.
 * @param {string} text
 * @returns {string}
 * @throws {Error} when the text contains `'''` or forbidden control characters.
 */
export function tomlMultilineLiteral(text) {
  const problem = tomlLiteralProblem(text);
  if (problem) throw new Error(`Cannot write TOML literal string: ${problem}`);
  return `'''\n${text.endsWith('\n') ? text : `${text}\n`}'''`;
}
