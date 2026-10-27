import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { firstSentence } from './lib/agents-md.mjs';
import {
  normalizeNewlines,
  parseFrontmatter,
  splitCommaList,
  splitFrontmatter,
  toList,
} from './lib/frontmatter.mjs';
import { createPrettierFormatter } from './lib/prettier.mjs';
import {
  CLAUDE_MODELS,
  CLAUDE_TOOLS,
  CODEX_REASONING_EFFORT,
  hasGeneratedMarker,
  insertMarkdownMarker,
  markdownMarker,
  tomlMarker,
} from './lib/render.mjs';
import {
  tomlMultilineLiteral,
  tomlString,
  yamlFrontmatter,
  yamlScalar,
} from './lib/serialize.mjs';
import { AGENT_TOOLS, MODEL_TIERS } from './lib/sources.mjs';
import {
  findStaleOutputs,
  main,
  planOutputs,
  syncAgents,
  SyncValidationError,
} from './sync.mjs';

const identity = async (text) => text;

const SKILL_MD = `---
name: demo-skill
description: Ship a demo change end to end. Use when testing the generator.
paths: apps/**,tests/**
argument-hint: "<task id>"
metadata:
  owner: audivoya
  version: "2"
---

# Demo skill

Run \`npm run check\`.
`;

const REVIEWER_MD = `---
name: demo-reviewer
description: 'Review a diff: correctness, tests and format.'
tools: read, search, edit, execute
model-tier: balanced
readonly: true
skills: demo-skill
---

You review diffs.

Report findings as file:line.
`;

const BUILDER_MD = `---
name: demo-builder
description: Implement one task brief end to end. Use for claimed work.
tools: [read, search, edit, execute, web, agent]
---

You implement tasks.
`;

const CORE_RULE = `---
description: Core package invariants
paths: packages/core/**, apps/extension/src/runtime/{protocol,offscreen}.ts
alwaysApply: false
---

Keep core deterministic.
`;

const ALWAYS_RULE = `---
description: Applies everywhere
alwaysApply: true
---

Use English.
`;

const AGENTS_MD = `# Agent guide

Intro text stays.

<!-- agents:essentials:start -->

## Essentials

- Run \`npm run check\`.

<!-- agents:essentials:end -->

## Skills

<!-- agents:skills:start -->
stale skills table
<!-- agents:skills:end -->

## Agents

<!-- agents:agents:start -->
<!-- agents:agents:end -->

## Rules

<!-- agents:rules:start -->

<!-- agents:rules:end -->

Footer stays.
`;

const LOGO_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x0d, 0x0a,
]);

function fixtureFiles() {
  return {
    'AGENTS.md': AGENTS_MD,
    '.agents/skills/demo-skill/SKILL.md': SKILL_MD,
    '.agents/skills/demo-skill/references/guide.md':
      '# Guide\r\n\r\nWindows line endings.\r\n',
    '.agents/skills/demo-skill/agents/openai.yaml':
      "interface:\n  display_name: 'Demo'\n",
    '.agents/skills/demo-skill/assets/logo.bin': LOGO_BYTES,
    '.agents/agents/demo-reviewer.md': REVIEWER_MD,
    '.agents/agents/demo-builder.md': BUILDER_MD,
    '.agents/agents/README.md': 'Not an agent definition.\n',
    '.agents/rules/core.md': CORE_RULE,
    '.agents/rules/always.md': ALWAYS_RULE,
  };
}

/** Temp repo from the fixture; `null` in overrides removes a fixture file. */
async function makeRepo(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audivoya-agents-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries({
    ...fixtureFiles(),
    ...overrides,
  })) {
    if (content === null) continue;
    await writeRel(root, rel, content);
  }
  return root;
}

async function writeRel(root, rel, content) {
  const target = path.join(root, ...rel.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

const readRel = (root, rel) =>
  readFile(path.join(root, ...rel.split('/')), 'utf8');

async function exists(root, rel) {
  try {
    await access(path.join(root, ...rel.split('/')));
    return true;
  } catch {
    return false;
  }
}

function capture() {
  const lines = { log: [], error: [] };
  return {
    lines,
    io: {
      log: (line) => lines.log.push(line),
      error: (line) => lines.error.push(line),
      formatter: identity,
    },
  };
}

const marker = (source) => markdownMarker(source);

// ---------------------------------------------------------------- parser

test('parseFrontmatter reads the supported YAML subset', () => {
  const { data, body } = parseFrontmatter(`---
# full-line comment
name: demo  # trailing comment
plain: Use C# and a:b here
single: 'it''s # not a comment'
double: "tab\\tquote\\" \\u00e9"
enabled: true
disabled: False
nothing: ~
empty:
num: 2
quoted-bool: 'true'
comma: read, search,execute
flow: [a, 'b, c', "d", ]
emptyflow: []
block:
  - one
  - 'two: 2'  # comment
same-indent:
- x
- y
metadata:
  owner: audivoya
  version: "2"
---
Body
`);
  assert.deepEqual(data, {
    name: 'demo',
    plain: 'Use C# and a:b here',
    single: "it's # not a comment",
    double: 'tab\tquote" \u00e9',
    enabled: true,
    disabled: false,
    nothing: null,
    empty: null,
    num: '2',
    'quoted-bool': 'true',
    comma: 'read, search,execute',
    flow: ['a', 'b, c', 'd'],
    emptyflow: [],
    block: ['one', 'two: 2'],
    'same-indent': ['x', 'y'],
    metadata: { owner: 'audivoya', version: '2' },
  });
  assert.equal(body, 'Body\n');
  assert.deepEqual(parseFrontmatter('# No frontmatter\n'), {
    data: null,
    head: '',
    body: '# No frontmatter\n',
  });
});

test('parseFrontmatter rejects unsupported or ambiguous YAML with line numbers', () => {
  const cases = [
    ['name: a\nname: b', /line 3: duplicate key "name"/],
    ['\tname: a', /line 2: tabs are not allowed/],
    ['description: first\n  continued', /line 3: unexpected indentation/],
    ['description: |\n  text', /block scalars/],
    ['key: {a: 1}', /flow mappings/],
    ['tools: [a, [b]]', /nested flow collections/],
    ['tools: [a, b', /unterminated flow list/],
    ['paths: *.md', /must be quoted \(YAML anchor, alias or tag syntax\)/],
    ['description: Review: things', /must be quoted: Review: things/],
    ["description: 'unterminated", /unterminated single-quoted value/],
    ['description: "bad \\q"', /unsupported escape "\\q"/],
    ['name: "a" trailing', /unexpected text after quoted value/],
    ['key:value', /line 2: expected "key: value"/],
    ['"quoted": x', /expected "key: value"/],
    ['metadata:\n  nested:\n    deep: x', /line 3: "nested" has no value/],
    ['list:\n  - a\n   - b', /line 4: inconsistent list indentation/],
    ['list:\n  -\n', /line 3: empty list item/],
    ['list:\n  - [a]', /nested lists are not supported/],
  ];
  for (const [yaml, expected] of cases)
    assert.throws(
      () => parseFrontmatter(`---\n${yaml}\n---\nbody\n`),
      expected,
      yaml,
    );
  assert.throws(
    () => parseFrontmatter('---\nname: a\n'),
    /missing its closing "---"/,
  );
});

test('splitFrontmatter keeps head + body byte-identical after LF normalization', () => {
  const text = normalizeNewlines('\uFEFF---\r\nname: a\r\n---\r\n\r\nBody\r');
  assert.equal(text, '---\nname: a\n---\n\nBody\n');
  const split = splitFrontmatter(text);
  assert.equal(split.yaml, 'name: a');
  assert.equal(split.head + split.body, text);
  assert.deepEqual(splitFrontmatter('---\nname: a\n---'), {
    yaml: 'name: a',
    head: '---\nname: a\n---',
    body: '',
  });
});

test('toList splits comma strings but keeps brace globs intact', () => {
  assert.deepEqual(splitCommaList(' a/**, b/{x,y}.ts ,, [c,d]e '), [
    'a/**',
    'b/{x,y}.ts',
    '[c,d]e',
  ]);
  assert.deepEqual(toList('read, search'), ['read', 'search']);
  assert.deepEqual(toList(['a,b', ' c ']), ['a,b', 'c']);
  assert.deepEqual(toList(undefined), []);
  assert.deepEqual(toList(null), []);
});

test('YAML and TOML writers quote only when needed and escape correctly', () => {
  assert.equal(yamlScalar('packages/core/**'), 'packages/core/**');
  assert.equal(yamlScalar('*.md'), "'*.md'");
  assert.equal(yamlScalar('a: b'), "'a: b'");
  assert.equal(yamlScalar("it's: x"), "'it''s: x'");
  assert.equal(yamlScalar('true'), "'true'");
  assert.equal(yamlScalar('2'), "'2'");
  assert.equal(yamlScalar('a,b', { inFlow: true }), "'a,b'");
  assert.equal(yamlScalar('line\nbreak'), '"line\\nbreak"');
  assert.equal(yamlScalar(false), 'false');
  assert.equal(
    yamlFrontmatter([
      ['a', 'x'],
      ['skip', undefined],
      ['list', ['p', '*.md']],
    ]),
    "---\na: x\nlist:\n  - p\n  - '*.md'\n---\n",
  );
  assert.equal(
    tomlString('say "hi"\\\n\u0001'),
    '"say \\"hi\\"\\\\\\n\\u0001"',
  );
  assert.equal(tomlMultilineLiteral('a \\n ok'), "'''\na \\n ok\n'''");
  assert.throws(() => tomlMultilineLiteral("x ''' y"), /'''/);
  assert.throws(() => tomlMultilineLiteral('bell \u0007'), /control/);
});

test('firstSentence stops at the first sentence end, not at abbreviations or file names', () => {
  assert.equal(
    firstSentence('Run e.g. check.mjs first. Then more.'),
    'Run e.g. check.mjs first.',
  );
  assert.equal(
    firstSentence('No terminal punctuation'),
    'No terminal punctuation',
  );
  assert.equal(firstSentence('Ship it!  Later.'), 'Ship it!');
});

test('mapping tables cover the whole neutral vocabulary', () => {
  assert.deepEqual(Object.keys(CLAUDE_TOOLS), AGENT_TOOLS);
  assert.deepEqual(Object.keys(CLAUDE_MODELS), MODEL_TIERS);
  assert.deepEqual(Object.keys(CODEX_REASONING_EFFORT), MODEL_TIERS);
});

test('markers are inserted after frontmatter and detected in both forms', () => {
  const source = '.agents/skills/x/SKILL.md';
  assert.equal(
    insertMarkdownMarker('---\nname: x\n---\n\n# T\n', source),
    `---\nname: x\n---\n\n${marker(source)}\n\n# T\n`,
  );
  assert.equal(
    insertMarkdownMarker('---\nname: x\n---\n# T\n', source),
    `---\nname: x\n---\n\n${marker(source)}\n\n# T\n`,
  );
  assert.equal(
    insertMarkdownMarker('---\nname: x\n---', source),
    `---\nname: x\n---\n\n${marker(source)}\n`,
  );
  assert.equal(
    hasGeneratedMarker(`---\na: b\n---\n\n${marker(source)}\n`),
    true,
  );
  assert.equal(hasGeneratedMarker(`${tomlMarker(source)}\nname = "x"\n`), true);
  assert.equal(
    hasGeneratedMarker('Mentions Generated by scripts/agents/sync.mjs inline.'),
    false,
  );
});

// ---------------------------------------------------------------- outputs

test('planOutputs maps every canonical source to each harness, sorted by path', async (t) => {
  const root = await makeRepo(t);
  const outputs = await planOutputs(root, { formatter: identity });
  assert.deepEqual(
    [...outputs.keys()],
    [
      '.claude/agents/demo-builder.md',
      '.claude/agents/demo-reviewer.md',
      '.claude/rules/always.md',
      '.claude/rules/core.md',
      '.claude/skills/demo-skill/SKILL.md',
      '.claude/skills/demo-skill/assets/logo.bin',
      '.claude/skills/demo-skill/references/guide.md',
      '.codex/agents/demo-builder.toml',
      '.codex/agents/demo-reviewer.toml',
      '.cursor/rules/always.mdc',
      '.cursor/rules/core.mdc',
      '.github/agents/demo-builder.agent.md',
      '.github/agents/demo-reviewer.agent.md',
      '.github/copilot-instructions.md',
      '.github/instructions/always.instructions.md',
      '.github/instructions/core.instructions.md',
      'AGENTS.md',
    ],
  );
});

test('skills are copied verbatim with LF endings, the marker, and no openai.yaml', async (t) => {
  const root = await makeRepo(t, {
    '.agents/skills/demo-skill/SKILL.md': SKILL_MD.replace(/\n/g, '\r\n'),
  });
  const outputs = await planOutputs(root, { formatter: identity });
  const source = '.agents/skills/demo-skill/SKILL.md';
  assert.equal(
    outputs.get('.claude/skills/demo-skill/SKILL.md'),
    SKILL_MD.replace('---\n\n# Demo', `---\n\n${marker(source)}\n\n# Demo`),
  );
  assert.equal(
    outputs.get('.claude/skills/demo-skill/references/guide.md'),
    '# Guide\n\nWindows line endings.\n',
  );
  const logo = outputs.get('.claude/skills/demo-skill/assets/logo.bin');
  assert.ok(Buffer.isBuffer(logo));
  assert.ok(logo.equals(LOGO_BYTES), 'binary files keep their exact bytes');
  assert.equal(
    outputs.has('.claude/skills/demo-skill/agents/openai.yaml'),
    false,
  );
});

test('agents map to Claude, Copilot and Codex formats', async (t) => {
  const root = await makeRepo(t);
  const outputs = await planOutputs(root, { formatter: identity });
  const reviewer = '.agents/agents/demo-reviewer.md';
  const builder = '.agents/agents/demo-builder.md';

  assert.equal(
    outputs.get('.claude/agents/demo-reviewer.md'),
    `---
name: demo-reviewer
description: 'Review a diff: correctness, tests and format.'
tools: Read, Grep, Glob, Bash
model: sonnet
readonly: true
skills:
  - demo-skill
---

${marker(reviewer)}

You review diffs.

Report findings as file:line.
`,
  );
  assert.equal(
    outputs.get('.claude/agents/demo-builder.md'),
    `---
name: demo-builder
description: Implement one task brief end to end. Use for claimed work.
tools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch, Agent
model: inherit
---

${marker(builder)}

You implement tasks.
`,
  );
  assert.equal(
    outputs.get('.github/agents/demo-reviewer.agent.md'),
    `---
name: demo-reviewer
description: 'Review a diff: correctness, tests and format.'
tools: [read, search, execute]
---

${marker(reviewer)}

Read these skills before starting: .agents/skills/demo-skill/SKILL.md.

You review diffs.

Report findings as file:line.
`,
  );
  assert.equal(
    outputs.get('.github/agents/demo-builder.agent.md'),
    `---
name: demo-builder
description: Implement one task brief end to end. Use for claimed work.
tools: [read, search, edit, execute, web, agent]
---

${marker(builder)}

You implement tasks.
`,
  );
  assert.equal(
    outputs.get('.codex/agents/demo-reviewer.toml'),
    `${tomlMarker(reviewer)}
name = "demo-reviewer"
description = "Review a diff: correctness, tests and format."
model_reasoning_effort = "medium"
developer_instructions = '''
You are read-only: never edit files.
Read these skills before starting: .agents/skills/demo-skill/SKILL.md.

You review diffs.

Report findings as file:line.
'''
`,
  );
  assert.equal(
    outputs.get('.codex/agents/demo-builder.toml'),
    `${tomlMarker(builder)}
name = "demo-builder"
description = "Implement one task brief end to end. Use for claimed work."
developer_instructions = '''
You implement tasks.
'''
`,
  );
});

test('model tiers map to Claude models and Codex reasoning effort', async (t) => {
  for (const [tier, model, effort] of [
    ['fast', 'haiku', 'low'],
    ['strong', 'opus', 'high'],
  ]) {
    const root = await makeRepo(t, {
      '.agents/agents/demo-builder.md': BUILDER_MD.replace(
        'tools:',
        `model-tier: ${tier}\ntools:`,
      ),
    });
    const outputs = await planOutputs(root, { formatter: identity });
    assert.match(
      outputs.get('.claude/agents/demo-builder.md'),
      new RegExp(`\nmodel: ${model}\n`),
    );
    assert.match(
      outputs.get('.codex/agents/demo-builder.toml'),
      new RegExp(`\nmodel_reasoning_effort = "${effort}"\n`),
    );
  }
});

test('rules map to Claude, Cursor and Copilot formats', async (t) => {
  const root = await makeRepo(t);
  const outputs = await planOutputs(root, { formatter: identity });
  const core = '.agents/rules/core.md';
  const always = '.agents/rules/always.md';
  const globs =
    'packages/core/**,apps/extension/src/runtime/{protocol,offscreen}.ts';

  assert.equal(
    outputs.get('.claude/rules/core.md'),
    `---
paths:
  - packages/core/**
  - apps/extension/src/runtime/{protocol,offscreen}.ts
---

${marker(core)}

Keep core deterministic.
`,
  );
  assert.equal(
    outputs.get('.claude/rules/always.md'),
    `${marker(always)}\n\nUse English.\n`,
  );
  assert.equal(
    outputs.get('.cursor/rules/core.mdc'),
    `---
description: Core package invariants
globs: ${globs}
alwaysApply: false
---

${marker(core)}

Keep core deterministic.
`,
  );
  assert.equal(
    outputs.get('.cursor/rules/always.mdc'),
    `---
description: Applies everywhere
alwaysApply: true
---

${marker(always)}

Use English.
`,
  );
  assert.equal(
    outputs.get('.github/instructions/core.instructions.md'),
    `---
applyTo: '${globs}'
description: Core package invariants
---

${marker(core)}

Keep core deterministic.
`,
  );
  assert.match(
    outputs.get('.github/instructions/always.instructions.md'),
    /^---\napplyTo: '\*\*'\ndescription: Applies everywhere\n---\n/,
  );
});

test('AGENTS.md tables are regenerated between markers and outside text is untouched', async (t) => {
  const root = await makeRepo(t);
  const outputs = await planOutputs(root, { formatter: identity });
  const skillSource = '.agents/skills/demo-skill/SKILL.md';
  assert.equal(
    outputs.get('AGENTS.md'),
    `# Agent guide

Intro text stays.

<!-- agents:essentials:start -->

## Essentials

- Run \`npm run check\`.

<!-- agents:essentials:end -->

## Skills

<!-- agents:skills:start -->

| Skill | Purpose | Source |
| --- | --- | --- |
| \`demo-skill\` | Ship a demo change end to end. | [${skillSource}](${skillSource}) |

<!-- agents:skills:end -->

## Agents

<!-- agents:agents:start -->

| Agent | Purpose | Source |
| --- | --- | --- |
| \`demo-builder\` | Implement one task brief end to end. | [.agents/agents/demo-builder.md](.agents/agents/demo-builder.md) |
| \`demo-reviewer\` | Review a diff: correctness, tests and format. | [.agents/agents/demo-reviewer.md](.agents/agents/demo-reviewer.md) |

<!-- agents:agents:end -->

## Rules

<!-- agents:rules:start -->

| Rule | Applies to | Source |
| --- | --- | --- |
| \`always\` | always | [.agents/rules/always.md](.agents/rules/always.md) |
| \`core\` | \`packages/core/**\`, \`apps/extension/src/runtime/{protocol,offscreen}.ts\` | [.agents/rules/core.md](.agents/rules/core.md) |

<!-- agents:rules:end -->

Footer stays.
`,
  );
  assert.equal(
    outputs.get('.github/copilot-instructions.md'),
    `${marker('AGENTS.md')}

Full instructions: [AGENTS.md](../AGENTS.md). This file repeats only its essentials.

## Essentials

- Run \`npm run check\`.
`,
  );
});

test('AGENTS.md marker problems are validation errors', async (t) => {
  const cases = [
    [
      AGENTS_MD.replace('<!-- agents:rules:end -->\n', ''),
      /AGENTS\.md: missing <!-- agents:rules:end --> marker/,
    ],
    [
      `${AGENTS_MD}\n<!-- agents:skills:start -->\n`,
      /<!-- agents:skills:start --> appears 2 times/,
    ],
    [
      AGENTS_MD.replace('<!-- agents:agents:start -->', '<!-- tmp -->')
        .replace('<!-- agents:agents:end -->', '<!-- agents:agents:start -->')
        .replace('<!-- tmp -->', '<!-- agents:agents:end -->'),
      /<!-- agents:agents:end --> must come after/,
    ],
    [
      AGENTS_MD.replace(
        /<!-- agents:essentials:start -->[\s\S]*<!-- agents:essentials:end -->/,
        '<!-- agents:essentials:start -->\n<!-- agents:essentials:end -->',
      ),
      /the essentials region is empty/,
    ],
    [null, /AGENTS\.md: file not found/],
  ];
  for (const [agentsMd, expected] of cases) {
    const root = await makeRepo(t, { 'AGENTS.md': agentsMd });
    await assert.rejects(
      planOutputs(root, { formatter: identity }),
      (error) =>
        error instanceof SyncValidationError &&
        expected.test(error.errors.join('\n')),
    );
  }
});

test('only synthesized Markdown goes through the formatter', async (t) => {
  const root = await makeRepo(t);
  const formatted = [];
  const outputs = await planOutputs(root, {
    formatter: async (text, filePath) => {
      formatted.push(path.relative(root, filePath).split(path.sep).join('/'));
      return text;
    },
  });
  assert.deepEqual([...new Set(formatted)].sort(), [
    '.claude/agents/demo-builder.md',
    '.claude/agents/demo-reviewer.md',
    '.claude/rules/always.md',
    '.claude/rules/core.md',
    '.cursor/rules/always.mdc',
    '.cursor/rules/core.mdc',
    '.github/agents/demo-builder.agent.md',
    '.github/agents/demo-reviewer.agent.md',
    '.github/copilot-instructions.md',
    '.github/instructions/always.instructions.md',
    '.github/instructions/core.instructions.md',
    'AGENTS.md',
  ]);
  assert.equal(formatted.filter((rel) => rel === 'AGENTS.md').length, 3);
  assert.equal(outputs.size, 17);
});

test('generated Markdown is stable under the repository Prettier', async (t) => {
  const root = await makeRepo(t);
  const format = await createPrettierFormatter(root);
  const outputs = await planOutputs(root, { formatter: format });
  for (const [rel, content] of outputs) {
    if (!/\.mdc?$/.test(rel)) continue;
    const absolute = path.join(root, ...rel.split('/'));
    assert.equal(await format(content, absolute), content, rel);
  }
  assert.match(outputs.get('.cursor/rules/core.mdc'), /\nglobs: packages\//);
  assert.equal(
    await format('name = "x"\n', path.join(root, '.codex/agents/x.toml')),
    'name = "x"\n',
    'files without a Prettier parser are returned unchanged',
  );
});

// ---------------------------------------------------------------- sync

test('sync writes every output once and is idempotent', async (t) => {
  const root = await makeRepo(t);
  const first = await syncAgents({ root, formatter: identity });
  assert.equal(first.created.length, 16);
  assert.deepEqual(first.updated, ['AGENTS.md']);
  assert.deepEqual(first.stale, []);
  for (const [rel, content] of first.outputs) {
    const onDisk = await readFile(path.join(root, ...rel.split('/')));
    assert.ok(onDisk.equals(Buffer.from(content)), rel);
  }
  const second = await syncAgents({ root, formatter: identity });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.stale, []);
  assert.equal(second.unchanged.length, 17);
});

test('stale generated files are reported, then deleted; hand-written files stay', async (t) => {
  const root = await makeRepo(t);
  await syncAgents({ root, formatter: identity });
  const extra = {
    '.claude/agents/old-agent.md': `---\nname: old-agent\n---\n\n${marker('.agents/agents/old-agent.md')}\n\nOld.\n`,
    '.codex/agents/old-agent.toml': `${tomlMarker('.agents/agents/old-agent.md')}\nname = "old-agent"\n`,
    '.claude/agents/hand-written.md': '---\nname: hand-written\n---\n\nMine.\n',
    '.cursor/rules/legacy.mdc': '---\ndescription: x\n---\n\nHand rule.\n',
    '.claude/skills/gone-skill/SKILL.md': `---\nname: gone-skill\n---\n\n${marker('.agents/skills/gone-skill/SKILL.md')}\n`,
    '.claude/skills/gone-skill/references/deep/notes.md': 'No marker.\n',
    '.claude/skills/demo-skill/references/removed.md': 'No marker.\n',
    '.claude/skills/hand-skill/SKILL.md':
      '---\nname: hand-skill\n---\n\nMine.\n',
    '.claude/skills/hand-skill/notes.md': 'Mine too.\n',
  };
  for (const [rel, content] of Object.entries(extra))
    await writeRel(root, rel, content);

  const expectedStale = [
    '.claude/agents/old-agent.md',
    '.claude/skills/demo-skill/references/removed.md',
    '.claude/skills/gone-skill/SKILL.md',
    '.claude/skills/gone-skill/references/deep/notes.md',
    '.codex/agents/old-agent.toml',
  ];
  const outputs = await planOutputs(root, { formatter: identity });
  assert.deepEqual(await findStaleOutputs(root, outputs), expectedStale);

  const checked = await syncAgents({ root, check: true, formatter: identity });
  assert.deepEqual(checked.stale, expectedStale);
  for (const rel of expectedStale) assert.equal(await exists(root, rel), true);

  const synced = await syncAgents({ root, formatter: identity });
  assert.deepEqual(synced.stale, expectedStale);
  for (const rel of expectedStale) assert.equal(await exists(root, rel), false);
  assert.equal(await exists(root, '.claude/skills/gone-skill'), false);
  assert.equal(await exists(root, '.claude/skills'), true);
  for (const rel of [
    '.claude/agents/hand-written.md',
    '.cursor/rules/legacy.mdc',
    '.claude/skills/hand-skill/SKILL.md',
    '.claude/skills/hand-skill/notes.md',
  ])
    assert.equal(await exists(root, rel), true, rel);
});

test('--check reports missing, drifted and stale files, exits 1 and writes nothing', async (t) => {
  const root = await makeRepo(t);
  const before = capture();
  assert.equal(await main(['--check', '--root', root], before.io), 1);
  const report = before.lines.error.join('\n');
  assert.match(report, /agents:check: 17 generated files out of date:/);
  assert.match(report, /  missing  \.claude\/agents\/demo-builder\.md/);
  assert.match(report, /  drifted  AGENTS\.md/);
  assert.match(report, /npm run agents:sync/);
  assert.equal(await exists(root, '.claude'), false);
  assert.equal(await readRel(root, 'AGENTS.md'), AGENTS_MD);

  const sync = capture();
  assert.equal(await main(['--root', root], sync.io), 0);
  assert.match(
    sync.lines.log.at(-1),
    /agents:sync: 16 created, 1 updated, 0 deleted, 0 unchanged\./,
  );
  assert.ok(
    sync.lines.log.includes('  created  .codex/agents/demo-builder.toml'),
  );

  const clean = capture();
  assert.equal(await main(['--check', '--root', root], clean.io), 0);
  assert.deepEqual(clean.lines.log, [
    'agents:check: 17 generated files up to date.',
  ]);

  await writeRel(root, '.codex/agents/demo-builder.toml', 'edited by hand\n');
  await writeRel(
    root,
    '.github/agents/old.agent.md',
    `${marker('.agents/agents/old.md')}\n`,
  );
  const drift = capture();
  assert.equal(await main(['--check', '--root', root], drift.io), 1);
  assert.match(
    drift.lines.error.join('\n'),
    /2 generated files out of date:\n  drifted  \.codex\/agents\/demo-builder\.toml\n  stale    \.github\/agents\/old\.agent\.md/,
  );
  assert.equal(
    await readRel(root, '.codex/agents/demo-builder.toml'),
    'edited by hand\n',
  );
});

// ---------------------------------------------------------------- validation

test('invalid sources fail validation with one message per problem', async (t) => {
  const skill = (frontmatter) => `---\n${frontmatter}\n---\n\nBody.\n`;
  const cases = [
    [
      {
        '.agents/skills/Bad_Skill/SKILL.md': skill(
          'name: Bad_Skill\ndescription: x',
        ),
      },
      /Bad_Skill\/SKILL\.md: name "Bad_Skill" must be 1-64 chars/,
    ],
    [
      {
        '.agents/skills/other/SKILL.md': skill(
          'name: demo-skill\ndescription: x',
        ),
      },
      /other\/SKILL\.md: name "demo-skill" must equal the folder name "other"/,
    ],
    [
      {
        '.agents/skills/other/SKILL.md': skill(
          'name: demo-skill\ndescription: x',
        ),
      },
      /duplicate skill name "demo-skill": \.agents\/skills\/demo-skill\/SKILL\.md, \.agents\/skills\/other\/SKILL\.md/,
    ],
    [
      { '.agents/skills/demo-skill/SKILL.md': skill('name: demo-skill') },
      /demo-skill\/SKILL\.md: description is missing/,
    ],
    [
      {
        '.agents/skills/demo-skill/SKILL.md': skill(
          `name: demo-skill\ndescription: ${'x'.repeat(1025)}`,
        ),
      },
      /description is 1025 characters \(max 1024\)/,
    ],
    [
      { '.agents/skills/empty/notes.md': 'x\n' },
      /\.agents\/skills\/empty\/: missing SKILL\.md/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': BUILDER_MD.replace(
          'agent]',
          'shell]',
        ),
      },
      /demo-builder\.md: unknown tool "shell" \(allowed: read, search, edit, execute, web, agent\)/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': BUILDER_MD.replace(
          'tools:',
          'model-tier: huge\ntools:',
        ),
      },
      /unknown model-tier "huge"/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': BUILDER_MD.replace(
          'tools:',
          'model: opus\ntools:',
        ),
      },
      /unknown frontmatter key "model"/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': BUILDER_MD.replace(/tools: .*\n/, ''),
      },
      /tools is missing/,
    ],
    [
      {
        '.agents/agents/demo-copy.md': BUILDER_MD,
      },
      /duplicate agent name "demo-builder": \.agents\/agents\/demo-builder\.md, \.agents\/agents\/demo-copy\.md/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': `${BUILDER_MD}\nNever write ''' here.\n`,
      },
      /demo-builder\.md: body contains "'''"/,
    ],
    [
      {
        '.agents/agents/demo-reviewer.md': REVIEWER_MD.replace(
          'skills: demo-skill',
          'skills: demo-skill, missing-skill',
        ),
      },
      /unknown skill "missing-skill"/,
    ],
    [
      {
        '.agents/agents/demo-reviewer.md': REVIEWER_MD.replace(
          'tools: read, search, edit, execute',
          'tools: edit',
        ),
      },
      /readonly agent has no tools left after dropping edit/,
    ],
    [
      { '.agents/agents/demo-builder.md': 'No frontmatter.\n' },
      /demo-builder\.md: missing YAML frontmatter/,
    ],
    [
      {
        '.agents/agents/demo-builder.md': BUILDER_MD.replace(
          'description: Implement',
          'description: Note: implement',
        ),
      },
      /demo-builder\.md: line 3: a value containing ": "/,
    ],
    [
      { '.agents/rules/core.md': CORE_RULE.replace(/paths: .*\n/, '') },
      /core\.md: paths is required unless alwaysApply is true/,
    ],
    [
      { '.agents/rules/Core_Rule.md': CORE_RULE },
      /file name "Core_Rule" must be/,
    ],
    [
      {
        '.agents/rules/core.md': CORE_RULE.replace(
          'alwaysApply: false',
          'alwaysApply: maybe',
        ),
      },
      /alwaysApply must be true or false/,
    ],
  ];
  for (const [overrides, expected] of cases) {
    const root = await makeRepo(t, overrides);
    await assert.rejects(
      planOutputs(root, { formatter: identity }),
      (error) => {
        assert.ok(error instanceof SyncValidationError, error.message);
        assert.match(error.errors.join('\n'), expected);
        return true;
      },
    );
  }
});

test('a root without .agents/ is rejected instead of deleting generated files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audivoya-agents-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeRel(
    root,
    '.claude/agents/x.md',
    `${marker('.agents/agents/x.md')}\n`,
  );
  const run = capture();
  assert.equal(await main(['--root', root], run.io), 1);
  assert.match(run.lines.error.join('\n'), /\.agents\/: directory not found/);
  assert.equal(await exists(root, '.claude/agents/x.md'), true);
});

test('main reports usage errors with exit code 2', async () => {
  const run = capture();
  assert.equal(await main(['--bogus'], run.io), 2);
  assert.match(
    run.lines.error.join('\n'),
    /Usage: node scripts\/agents\/sync\.mjs/,
  );
  assert.equal(await main(['stray'], run.io), 2);
});
