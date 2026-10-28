// PreToolUse guard for Bash and PowerShell tool calls (Claude Code, Cursor,
// Copilot). It blocks only the load-bearing cases from the AGENTS.md autonomy
// policy and lets everything else through:
//   - printing, copying out or uploading secret files (.env, credential txt,
//     service-account JSON);
//   - force-adding those files to git;
//   - force-pushing or deleting protected branches (main, develop).
// A block exits 2 with the reason on stderr, which all three harnesses treat
// as "deny and show the reason to the agent".
import path from 'node:path';
import { gitDirs, readBranch } from './lib/git-layout.mjs';
import {
  findRepoRoot,
  hookCwd,
  isEntryPoint,
  readJson,
  runHook,
  toolCommand,
} from './lib/hook-io.mjs';
import { programName, splitCommands } from './lib/shell-words.mjs';

/** Branches that are never force-pushed or deleted, whatever workspace.json says. */
export const DEFAULT_PROTECTED_BRANCHES = Object.freeze(['main', 'develop']);

const ALLOW = Object.freeze({ block: false });
const MAX_NESTING = 3;

const SECRET_NAMES = [
  /^\.env(?:[.*?][\w.*?-]*)?$/i,
  /^[\w.*?-]*credential[\w.*?-]*\.txt$/i,
  /^realtimedubbing-[\w.*?-]*\.json$/i,
  /^[\w.*?-]*service-account[\w.*?-]*\.json$/i,
  /^gha-creds-[\w.*?-]*\.json$/i,
];
const SECRET_GLOB_MARKERS =
  /credential|service-account|realtimedubbing-|gha-creds-/i;
const NOT_SECRET = new Set(['.env.example']);

/** Commands that print, transform or upload every file argument. */
const READERS = new Set([
  'cat',
  'type',
  'get-content',
  'gc',
  'more',
  'less',
  'head',
  'tail',
  'bat',
  'batcat',
  'nl',
  'tac',
  'od',
  'xxd',
  'hexdump',
  'strings',
  'base64',
  'cut',
  'sort',
  'uniq',
  'diff',
  'jq',
  'format-hex',
  'curl',
  'wget',
  'invoke-webrequest',
  'iwr',
  'invoke-restmethod',
  'irm',
  'nc',
  'ncat',
]);

/** Search tools: the first positional is a pattern, not a file (unless -e/-f). */
const SEARCHERS = {
  grep: { values: 'efmABCdD', pattern: 'e', file: 'f', select: '' },
  egrep: { values: 'efmABCdD', pattern: 'e', file: 'f', select: '' },
  fgrep: { values: 'efmABCdD', pattern: 'e', file: 'f', select: '' },
  rg: { values: 'efgtTmABCjMEr', pattern: 'e', file: 'f', select: 'g' },
  sed: { values: 'efl', pattern: 'e', file: 'f', select: '' },
  awk: { values: 'fvF', pattern: '', file: 'f', select: '' },
  gawk: { values: 'fvF', pattern: '', file: 'f', select: '' },
};
/** File-selector flags: `--include=.env` or `rg -g .env` reads that file like a path argument. */
const SEARCH_SELECT_LONG = new Set(['--include', '--glob', '--iglob']);
const SEARCH_VALUE_LONG = new Set([
  '--regexp',
  '--expression',
  '--file',
  '--max-count',
  '--context',
  '--after-context',
  '--before-context',
  '--glob',
  '--iglob',
  '--type',
  '--type-not',
  '--include',
  '--exclude',
  '--exclude-dir',
  '--max-depth',
  '--threads',
  '--encoding',
  '--replace',
  '--field-separator',
]);
const SELECT_STRING_SWITCHES = new Set([
  '-simplematch',
  '-casesensitive',
  '-allmatches',
  '-notmatch',
  '-quiet',
  '-list',
  '-raw',
  '-noemphasis',
]);

/** Interpreters whose inline code can read any file. */
const INLINE_CODE = {
  node: /^(?:-p?e|-e?p|--eval|--print)(?:=.*)?$/,
  bun: /^(?:-e|--eval|--print)(?:=.*)?$/,
  deno: /^eval$/,
  python: /^-[A-Za-z]*c$/,
  python3: /^-[A-Za-z]*c$/,
  py: /^-[A-Za-z]*c$/,
  perl: /^-[A-Za-z]*[eE]$/,
  ruby: /^-[A-Za-z]*e$/,
};

const COPIERS = new Set(['cp', 'mv', 'scp', 'rsync', 'copy', 'move']);
const PS_COPIERS = new Set(['copy-item', 'cpi', 'move-item', 'mi']);
const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const EVALUATORS = new Set(['eval', 'invoke-expression', 'iex']);
const PREFIX_WORDS = new Set([
  'sudo',
  'command',
  'builtin',
  'exec',
  'nohup',
  'nice',
  'time',
  'timeout',
  'stdbuf',
  'xargs',
  'env',
  'noglob',
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '{',
  '}',
  '!',
]);
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);
const DOTNET_FILE_API = /\[(?:system\.)?io\.file\]::/i;

/**
 * Decide whether a shell command (Bash, Git Bash, PowerShell or cmd syntax)
 * must be blocked. Pure: no file system or process access.
 * @param {string} command Full command line, possibly chained with && ; | etc.
 * @param {{ protectedBranches?: readonly string[], currentBranch?: string }} [context]
 *   `currentBranch` resolves `git push --force` without a refspec and `HEAD` refspecs.
 * @returns {{ block: boolean, reason?: string }}
 */
export function classifyCommand(command, context = {}) {
  if (typeof command !== 'string' || !command.trim()) return ALLOW;
  const ctx = {
    protectedBranches: [
      ...new Set([
        ...DEFAULT_PROTECTED_BRANCHES,
        ...(context.protectedBranches ?? []),
      ]),
    ],
    currentBranch: context.currentBranch || undefined,
  };
  return classifyLine(command, ctx, 0);
}

/**
 * Name of the first secret file a word refers to, or '' when none. Works on
 * paths, globs, `--opt=value`, `@file` and inline code such as `open('.env')`.
 * @param {string} word
 * @returns {string}
 */
export function secretIn(word) {
  for (const fragment of word.split(/[\s'"`=@,;:()<>[\]{}+]+/)) {
    const name = fragment.replaceAll('\\', '/').split('/').pop() ?? '';
    if (!name || NOT_SECRET.has(name.toLowerCase())) continue;
    if (SECRET_NAMES.some((pattern) => pattern.test(name))) return name;
    if (/[*?]/.test(name) && SECRET_GLOB_MARKERS.test(name)) return name;
  }
  return '';
}

function classifyLine(line, ctx, depth) {
  if (depth > MAX_NESTING) return ALLOW;
  if (DOTNET_FILE_API.test(line)) {
    const name = secretIn(line);
    if (name) return exposes('.NET file API', name);
  }
  for (const words of splitCommands(line)) {
    const verdict = classifyWords(words, ctx, depth);
    if (verdict.block) return verdict;
  }
  // Command substitution inside double quotes stays one word above, so classify its body too.
  for (const match of line.matchAll(/\$\(([^()]*)\)/g)) {
    const verdict = classifyLine(match[1], ctx, depth + 1);
    if (verdict.block) return verdict;
  }
  return ALLOW;
}

function classifyWords(rawWords, ctx, depth) {
  const redirect = rawWords.findIndex(
    (word, i) => word === '<' && secretIn(rawWords[i + 1] ?? ''),
  );
  if (redirect !== -1)
    return exposes('input redirection', secretIn(rawWords[redirect + 1]));

  const words = stripPrefixes(rawWords.filter((word) => word !== '<'));
  if (words.length === 0) return ALLOW;
  const program = programName(words[0]);
  const args = words.slice(1);

  const nested = nestedScript(program, args);
  if (nested !== undefined) return classifyLine(nested, ctx, depth + 1);
  if (program === 'git') return classifyGit(args, ctx);
  if (program === 'gh' && args[0] === 'api')
    return classifyGhApi(args.slice(1));
  if (READERS.has(program) || (program === 'gh' && args[0] === 'gist'))
    return firstSecret(program, args);
  if (SEARCHERS[program])
    return firstSecret(program, searchFileArgs(SEARCHERS[program], args));
  if (program === 'findstr') return firstSecret(program, findstrFileArgs(args));
  if (program === 'select-string' || program === 'sls')
    return firstSecret(program, selectStringFileArgs(args));
  if (
    INLINE_CODE[program] &&
    args.some((arg) => INLINE_CODE[program].test(arg))
  )
    return firstSecret(`${program} inline code`, args);
  if (COPIERS.has(program) || PS_COPIERS.has(program))
    return classifyCopy(program, args);
  return ALLOW;
}

function stripPrefixes(words) {
  let i = 0;
  while (i < words.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) {
      i += 1;
    } else if (PREFIX_WORDS.has(words[i].toLowerCase())) {
      i += 1;
      while (i < words.length && /^(?:-.*|\d+[smhd]?)$/.test(words[i])) i += 1;
    } else break;
  }
  return words.slice(i);
}

/** Script text run by a nested shell or evaluator, or undefined. */
function nestedScript(program, args) {
  if (EVALUATORS.has(program)) return args.join(' ');
  if (program === 'cmd') {
    const flag = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return flag === -1 ? undefined : args.slice(flag + 1).join(' ');
  }
  if (POSIX_SHELLS.has(program)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/i.test(arg));
    return flag === -1 ? undefined : args.slice(flag + 1).join(' ');
  }
  if (POWERSHELLS.has(program)) {
    const encoded = args.findIndex((arg) =>
      /^-(?:e|ec|enc|encodedcommand)$/i.test(arg),
    );
    if (encoded !== -1 && args[encoded + 1])
      return Buffer.from(args[encoded + 1], 'base64').toString('utf16le');
    const flag = args.findIndex((arg) =>
      /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(arg),
    );
    return flag === -1 ? undefined : args.slice(flag + 1).join(' ');
  }
  return undefined;
}

function firstSecret(label, candidates) {
  for (const candidate of candidates) {
    const name = secretIn(candidate);
    if (name) return exposes(label, name);
  }
  return ALLOW;
}

function exposes(label, name) {
  return {
    block: true,
    reason:
      `Blocked: ${label} would expose the secret file "${name}". ` +
      'Agents never read, print, copy out or upload secrets (AGENTS.md, autonomy policy). ' +
      'Scripts load them with node --env-file-if-exists=.env; read .env.example for variable names.',
  };
}

function searchFileArgs(spec, args) {
  const files = [];
  let explicitPattern = false;
  let patternSeen = false;
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options && arg === '--') {
      options = false;
    } else if (options && arg.startsWith('--')) {
      const [name, inline] = splitOnce(arg, '=');
      const value =
        inline ?? (SEARCH_VALUE_LONG.has(name) ? args[(i += 1)] : undefined);
      if (name === '--regexp' || name === '--expression')
        explicitPattern = true;
      if (name === '--file') {
        explicitPattern = true;
        if (value) files.push(value);
      }
      if (SEARCH_SELECT_LONG.has(name) && value && !value.startsWith('!'))
        files.push(value);
    } else if (options && /^-[^-]/.test(arg)) {
      for (let j = 1; j < arg.length; j += 1) {
        if (!spec.values.includes(arg[j])) continue;
        const value = arg.slice(j + 1) || args[(i += 1)];
        if (arg[j] === spec.pattern) explicitPattern = true;
        if (arg[j] === spec.file) {
          explicitPattern = true;
          if (value) files.push(value);
        }
        if (arg[j] === spec.select && value && !value.startsWith('!'))
          files.push(value);
        break;
      }
    } else if (!explicitPattern && !patternSeen) {
      patternSeen = true;
    } else {
      files.push(arg);
    }
  }
  return files;
}

function findstrFileArgs(args) {
  const files = [];
  let explicitPattern = false;
  let patternSeen = false;
  for (const arg of args) {
    const option = /^\/([a-z])(?::(.*))?$/i.exec(arg);
    if (option) {
      const letter = option[1].toLowerCase();
      if (letter === 'c') explicitPattern = true;
      if ((letter === 'g' || letter === 'f') && option[2])
        files.push(option[2]);
    } else if (!explicitPattern && !patternSeen) {
      patternSeen = true;
    } else {
      files.push(arg);
    }
  }
  return files;
}

function selectStringFileArgs(args) {
  const files = [];
  const positional = [];
  let patternGiven = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!/^-[a-z]/i.test(arg)) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = splitOnce(arg.toLowerCase(), ':');
    if (SELECT_STRING_SWITCHES.has(name)) continue;
    const value = inline ?? args[(i += 1)];
    if (name === '-pattern') patternGiven = true;
    else if (
      ['-path', '-literalpath', '-lp', '-pspath'].includes(name) &&
      value
    )
      files.push(value);
  }
  return files.concat(patternGiven ? positional : positional.slice(1));
}

function classifyCopy(program, args) {
  const { sources, destination } = PS_COPIERS.has(program)
    ? powershellCopyArgs(args)
    : posixCopyArgs(args, program === 'copy' || program === 'move');
  const name = sources.map(secretIn).find(Boolean);
  if (!name || (destination && keepsSecretName(destination))) return ALLOW;
  return {
    block: true,
    reason:
      `Blocked: ${program} would copy the secret file "${name}" to "${destination ?? '?'}". ` +
      'Secrets may only be copied to another gitignored secret path (for example .env in a worktree); ' +
      'node scripts/worktree/setup.mjs does this for new worktrees.',
  };
}

/** `cp`/`mv`/`scp`/`rsync` and cmd's `copy`/`move` (whose switches look like `/y`). */
function posixCopyArgs(args, cmdSwitches) {
  const positional = [];
  let destination;
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options && arg === '--') options = false;
    else if (options && (arg === '-t' || arg === '--target-directory'))
      destination = args[(i += 1)];
    else if (options && arg.startsWith('--target-directory='))
      destination = splitOnce(arg, '=')[1];
    else if (options && /^-./.test(arg)) continue;
    else if (cmdSwitches && /^\/-?[a-z]$/i.test(arg)) continue;
    else positional.push(arg);
  }
  if (destination === undefined) destination = positional.pop();
  return { sources: positional, destination };
}

function powershellCopyArgs(args) {
  const sources = [];
  const positional = [];
  let destination;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!/^-[a-z]/i.test(arg)) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = splitOnce(arg.toLowerCase(), ':');
    if (
      ['-recurse', '-force', '-container', '-passthru', '-whatif'].includes(
        name,
      )
    )
      continue;
    const value = inline ?? args[(i += 1)];
    if (name.startsWith('-dest')) destination = value;
    else if (['-path', '-literalpath', '-lp'].includes(name) && value)
      sources.push(value);
  }
  if (sources.length === 0 && positional.length > 0)
    sources.push(positional.shift());
  if (destination === undefined) destination = positional.shift();
  return { sources, destination };
}

function keepsSecretName(destination) {
  const normalized = destination.replaceAll('\\', '/');
  if (/^(?:[\w.-]+@)?[\w.-]{2,}:/.test(normalized)) return false; // [user@]host:path
  return (
    normalized.endsWith('/') ||
    ['.', '..', '~'].includes(normalized) ||
    Boolean(secretIn(normalized))
  );
}

const GH_API_VALUE_OPTIONS = new Set([
  '-H',
  '--header',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
  '-p',
  '--preview',
]);
const GH_API_BODY_OPTIONS = new Set([
  '-f',
  '--raw-field',
  '-F',
  '--field',
  '--input',
]);
/** Endpoints behind the "Never" list: protection, rulesets, environments, secrets, variables, access. */
const GH_API_SENSITIVE =
  /(?:^|\/)(?:branches\/[^/]+\/protection|rulesets|environments|actions\/(?:secrets|variables|permissions)|dependabot\/secrets|codespaces\/secrets|collaborators|invitations|hooks|keys|teams|members|memberships|transfer)(?:\/|$)|^\/?(?:repos\/[^/]+\/[^/]+|orgs\/[^/]+)\/?$/;

/**
 * `gh api` stays prompt-free for reads and ordinary writes (PR comments, labels, reviews);
 * a mutating call to a settings, protection, environment, secret or access endpoint is blocked.
 */
function classifyGhApi(args) {
  let method;
  let body = false;
  let endpoint;
  for (let i = 0; i < args.length; i += 1) {
    const [name, inline] = splitOnce(args[i], '=');
    if (name === '-X' || name === '--method') {
      method = (inline ?? args[(i += 1)] ?? '').toUpperCase();
    } else if (GH_API_BODY_OPTIONS.has(name)) {
      body = true;
      if (inline === undefined) i += 1;
    } else if (GH_API_VALUE_OPTIONS.has(name)) {
      if (inline === undefined) i += 1;
    } else if (!args[i].startsWith('-') && endpoint === undefined) {
      endpoint = args[i];
    }
  }
  const mutating = method ? method !== 'GET' && method !== 'HEAD' : body;
  if (!mutating || !endpoint) return ALLOW;
  const path = endpoint.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (!GH_API_SENSITIVE.test(path)) return ALLOW;
  return {
    block: true,
    reason:
      `Blocked: gh api ${method ?? 'POST'} ${path} changes repository or organization settings, protection, environments, secrets, variables or access. ` +
      'Agents never change those (AGENTS.md, autonomy policy); ask the maintainer. Reads and PR, issue, label or review calls stay allowed.',
  };
}

function classifyGit(args, ctx) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (GIT_VALUE_OPTIONS.has(args[i])) i += 1;
    i += 1;
  }
  const subcommand = args[i];
  const rest = args.slice(i + 1);
  if (subcommand === 'push') return classifyPush(rest, ctx);
  if (subcommand === 'add' || subcommand === 'stage') return classifyAdd(rest);
  return ALLOW;
}

function classifyAdd(args) {
  let force = false;
  let all = false;
  let options = true;
  const paths = [];
  for (const arg of args) {
    if (options && arg === '--') options = false;
    else if (options && arg.startsWith('--')) {
      if (arg === '--force') force = true;
      if (arg === '--all') all = true;
    } else if (options && /^-[A-Za-z]+$/.test(arg)) {
      if (arg.includes('f')) force = true;
      if (arg.includes('A')) all = true;
    } else paths.push(arg);
  }
  if (!force) return ALLOW;
  const name = paths.map(secretIn).find(Boolean);
  const broad =
    all || paths.some((p) => ['.', './', '*', ':/', ':'].includes(p));
  if (!name && !broad) return ALLOW;
  return {
    block: true,
    reason: name
      ? `Blocked: git add --force of the secret file "${name}". Secrets are never committed.`
      : 'Blocked: git add --force of everything would stage gitignored secrets such as .env. Force-add explicit, non-secret paths only.',
  };
}

function classifyPush(args, ctx) {
  let force = false;
  let remove = false;
  let mirror = false;
  let all = false;
  let options = true;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options && arg === '--') options = false;
    else if (options && arg.startsWith('--')) {
      const [name, inline] = splitOnce(arg, '=');
      if (
        ['--force', '--force-with-lease', '--force-if-includes'].includes(name)
      )
        force = true;
      else if (name === '--delete') remove = true;
      else if (name === '--mirror') mirror = true;
      else if (name === '--all' || name === '--branches') all = true;
      else if (
        inline === undefined &&
        ['--repo', '--receive-pack', '--exec', '--push-option'].includes(name)
      )
        i += 1;
    } else if (options && /^-[A-Za-z]+$/.test(arg)) {
      if (arg.includes('f')) force = true;
      if (arg.includes('d')) remove = true;
      if (arg.endsWith('o')) i += 1;
    } else positional.push(arg);
  }

  if (mirror)
    return pushBlock(
      'git push --mirror would overwrite or delete the protected branches.',
    );
  if (force && all)
    return pushBlock(
      'git push --all with force would force-push the protected branches.',
    );

  const refspecs = positional.slice(1);
  const targets = refspecs.map((spec) => parseRefspec(spec, ctx));
  if (force && refspecs.length === 0 && ctx.currentBranch)
    targets.push({ branch: ctx.currentBranch, forced: true, deleted: false });

  for (const target of targets) {
    if (!ctx.protectedBranches.includes(target.branch)) continue;
    if (target.deleted || remove)
      return pushBlock(
        `deleting the protected branch "${target.branch}" is never allowed.`,
      );
    if (target.forced || force)
      return pushBlock(
        `force-push to the protected branch "${target.branch}". ` +
          'Push your own <type>/<slug> branch (git push --force-with-lease origin <type>/<slug>) and merge through a PR.',
      );
  }
  return ALLOW;
}

function parseRefspec(spec, ctx) {
  const forced = spec.startsWith('+');
  const body = forced ? spec.slice(1) : spec;
  const colon = body.lastIndexOf(':');
  const source = colon === -1 ? body : body.slice(0, colon);
  const destination = colon === -1 ? body : body.slice(colon + 1) || source;
  let branch = destination.replace(/^refs\/heads\//, '');
  if (branch === 'HEAD' || branch === '@') branch = ctx.currentBranch ?? '';
  return { branch, forced, deleted: colon !== -1 && source === '' };
}

function pushBlock(message) {
  return { block: true, reason: `Blocked: ${message}` };
}

function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  return index === -1
    ? [value, undefined]
    : [value.slice(0, index), value.slice(index + 1)];
}

/**
 * Context for push decisions: protected branches from `.agents/workspace.json`
 * (merged with the defaults) and the branch checked out in `cwd`.
 * @param {string} cwd
 * @returns {{ protectedBranches?: string[], currentBranch?: string }}
 */
export function pushContext(cwd) {
  const root = findRepoRoot(cwd);
  if (!root) return {};
  const config = readJson(path.join(root, '.agents', 'workspace.json'));
  const configured = Array.isArray(config?.protectedBranches)
    ? config.protectedBranches.filter((name) => typeof name === 'string')
    : [];
  const dirs = gitDirs(root);
  const branch = dirs ? readBranch(dirs.gitDir) : '';
  return {
    protectedBranches: configured,
    currentBranch: branch && !branch.startsWith('(') ? branch : undefined,
  };
}

/**
 * Hook entry: classify the tool call's command and block with exit code 2.
 * @param {Record<string, any>} input Parsed hook payload.
 * @returns {{ code: number, stderr?: string }}
 */
export function guardBash(input) {
  const command = toolCommand(input);
  if (!command) return { code: 0 };
  const context = /\bpush\b/.test(command) ? pushContext(hookCwd(input)) : {};
  const verdict = classifyCommand(command, context);
  return verdict.block
    ? { code: 2, stderr: `${verdict.reason}\n` }
    : { code: 0 };
}

if (isEntryPoint(import.meta.url)) await runHook('guard-bash', guardBash);
