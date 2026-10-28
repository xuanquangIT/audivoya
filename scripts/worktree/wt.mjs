#!/usr/bin/env node
// Worktree lifecycle CLI: one task = one worktree = one `<type>/<slug>` branch = one PR.
// Run from anywhere inside the repository (main checkout or any worktree). Everything
// repository-specific comes from `.agents/workspace.json`.
import { UsageError, isMainModule } from './lib/cli.mjs';
import { cmdDoctor, cmdInit } from './lib/cmd-doctor.mjs';
import { cmdClaims, cmdList, cmdPath } from './lib/cmd-inspect.mjs';
import { cmdNew } from './lib/cmd-new.mjs';
import { cmdPrune, cmdRemove } from './lib/cmd-remove.mjs';
import { BRANCH_TYPES } from './lib/names.mjs';

export const USAGE = `Usage: node scripts/worktree/wt.mjs <command> [options]

Commands:
  new <type>/<slug> [--base <ref>] [--claims a,b] [--task "..."] [--owner who]
                    [--no-setup] [--no-fetch]
                         create worktree + branch from origin/<baseBranch>, bootstrap it
  list [--json]          worktrees with slot, dev port, dirty count, ahead/behind, claims, age
  claims                 overlapping claims across worktrees (exit 1 on overlap)
  path <slug|branch|path>
                         print a worktree's absolute path
  rm <slug|branch|path> [--force] [--delete-branch]
                         remove a worktree (refuses dirty ones without --force)
  prune [--merged] [--dry-run]
                         prune stale entries; --merged also removes merged-PR worktrees/branches (gh)
  doctor                 check node, git, gh, repo config, ports, ignores, shared-script parity
  init                   set rerere/fetch.prune/longpaths/autoSetupRemote, origin/HEAD, worktree root

Types: ${BRANCH_TYPES.join(', ')}. Slug: lowercase a-z, 0-9, hyphens, <= 40 chars.
Exit codes: 0 ok, 1 failure or claim overlap, 2 usage error.`;

/** @type {Record<string, (args: string[]) => Promise<number>>} */
const COMMANDS = {
  new: cmdNew,
  list: cmdList,
  claims: cmdClaims,
  path: cmdPath,
  rm: cmdRemove,
  prune: cmdPrune,
  doctor: cmdDoctor,
  init: cmdInit,
};

/**
 * CLI entry point.
 * @param {string[]} [argv]
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError('missing command');
  if (['help', '--help', '-h'].includes(command)) {
    console.log(USAGE);
    return 0;
  }
  const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  if (!handler) throw new UsageError(`unknown command "${command}"`);
  return handler(rest);
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`wt: ${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`wt: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
