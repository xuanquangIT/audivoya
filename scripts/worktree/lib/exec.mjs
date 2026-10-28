// Cross-platform process helpers for non-git tools (npm, gh).
import { spawnSync } from 'node:child_process';
import { SAFE_COMMAND_TOKEN } from './config.mjs';

/**
 * Joins argv into a shell command line. Only plain tokens are accepted, so no quoting or
 * escaping is ever needed in cmd.exe or POSIX shells.
 * @param {readonly string[]} argv
 * @returns {string}
 * @throws {Error} When a token contains shell metacharacters.
 */
export function shellCommandLine(argv) {
  if (argv.length === 0) throw new Error('empty command');
  for (const token of argv)
    if (!SAFE_COMMAND_TOKEN.test(token))
      throw new Error(`refusing to run unsafe command token "${token}"`);
  return argv.join(' ');
}

/**
 * Runs a configured command (e.g. `npm ci ...`) and returns its exit status. Windows needs a
 * shell to launch `.cmd` shims such as npm.cmd; argv is validated by `shellCommandLine` first.
 * POSIX runs the executable directly.
 * @param {readonly string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: import('node:child_process').StdioOptions }} [options]
 * @returns {number}
 */
export function runCommand(argv, { cwd, env, stdio = 'inherit' } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync(shellCommandLine(argv), {
          cwd,
          env,
          stdio,
          shell: true,
          windowsHide: true,
        })
      : spawnSync(argv[0], argv.slice(1), { cwd, env, stdio });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/**
 * Runs a native executable (git, gh) without a shell and captures its output.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: boolean, missing: boolean, status: number | null, stdout: string, stderr: string }}
 */
export function runTool(command, args, { cwd, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error)
    return {
      ok: false,
      missing: result.error.code === 'ENOENT',
      status: null,
      stdout: '',
      stderr: result.error.message,
    };
  return {
    ok: result.status === 0,
    missing: false,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
