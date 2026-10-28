// Minimal, shell-agnostic command-line splitter for the Bash/PowerShell guard.
//
// It is deliberately approximate: it must understand Git Bash, POSIX sh,
// PowerShell and cmd command lines well enough to find the program and the
// arguments of every simple command, without executing or expanding anything.
// Backslashes are kept literally because Windows paths use them.

const SEPARATORS = new Set([';', '&', '|', '(', ')', '`', '\n', '\r']);

/**
 * Split a command line into simple commands, each an array of unquoted words.
 * Command separators outside quotes: `;`, `&`, `&&`, `|`, `||`, `(`, `)`,
 * backticks and newlines, so `$(cmd)` and PowerShell's `& cmd` yield `cmd` as
 * its own command. Input redirection `<` is emitted as a separate `<` word.
 * Inside double quotes, `\"` and `` `" `` are escaped quotes. A word-initial `#` starts a
 * comment that runs to the end of the line. A standalone `{` or `}` (PowerShell script
 * blocks, shell groups) also separates commands.
 * @param {string} line
 * @returns {string[][]}
 */
export function splitCommands(line) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = '';

  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = '';
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if ((ch === '\\' || ch === '`') && line[i + 1] === '"') {
        word += '"';
        i += 1;
      } else if (ch === '"') quote = '';
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '#' && !inWord) {
      while (i + 1 < line.length && line[i + 1] !== '\n') i += 1;
    } else if (
      (ch === '{' && !inWord && /^\s/.test(line[i + 1] ?? ' ')) ||
      (ch === '}' && !inWord && /^[\s;&|)]/.test(line[i + 1] ?? ' '))
    ) {
      endCommand();
    } else if (SEPARATORS.has(ch)) {
      endCommand();
    } else if (ch === '<') {
      endWord();
      words.push('<');
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/**
 * Normalize a program word to a lowercase command name: strips directories
 * and `.exe`/`.cmd`/`.bat`/`.ps1`, so `"C:\Program Files\Git\cmd\git.exe"`
 * and `/usr/bin/git` both become `git`.
 * @param {string} word
 * @returns {string}
 */
export function programName(word) {
  const base = word.replaceAll('\\', '/').split('/').pop() ?? '';
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}
