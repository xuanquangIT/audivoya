---
name: site-worktree
description: Create, bootstrap, list and clean up site worktrees. Each one gets its own SITE_PORT and SITE_CAPTURE_PORT slot and file claims, and installed-extension capture runs under the machine-wide lock. Use when starting parallel site work, when port 4180 or 4181 is busy (EADDRINUSE), after Claude, Codex or Cursor created its own worktree, when tests seem to hit another checkout, or to prune merged branches.
paths: scripts/worktree/**,.agents/workspace.json,.worktreeinclude,.cursor/worktrees.json
argument-hint: '<new|list|claims|rm|prune|doctor> [type/slug]'
---

# Website worktrees

Layout (`$HUB` = parent directory of the main checkout):

| Path                                | Role                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `$HUB/Landing-Page`                 | Main checkout, stays on `main`: integration, review, post-deploy checks only |
| `$HUB/worktrees/site/<type>-<slug>` | One task each, branch `<type>/<slug>` cut from `origin/main`                 |
| `$HUB/worktrees/ext/…`              | Extension worktrees (read-only for site tasks)                               |

`scripts/worktree/*` is a byte-identical copy of the extension repo's; config comes from `.agents/workspace.json` (`baseBranch: main`, `protectedBranches: ["main"]`, `slotBase: 26000`). Run the commands below from anywhere inside the repo. From the hub, `node tools/wt.mjs site <command> …` forwards to the same CLI and `node tools/wt.mjs list` shows both repos.

## Commands

| Goal                              | Command                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Once per clone                    | `node scripts/worktree/wt.mjs init`, then `node scripts/worktree/wt.mjs doctor`                                                                                                                               |
| Start a task                      | `node scripts/worktree/wt.mjs new docs/caption-prefs --claims src/pages.mjs,docs/VALIDATION.md --task "Explain per-site caption preferences" --owner claude`                                                  |
| Continue a pushed branch          | From the main checkout: `git fetch origin && git worktree add ../worktrees/site/fix-guide-overflow fix/guide-overflow`, then `node scripts/worktree/setup.mjs` inside it (`wt new` refuses existing branches) |
| Print a worktree path             | `node scripts/worktree/wt.mjs path caption-prefs`                                                                                                                                                             |
| Re-bootstrap (missing deps/state) | `node scripts/worktree/setup.mjs` (`--install` forces `npm ci`, `--json` for machine output)                                                                                                                  |
| See all worktrees                 | `node scripts/worktree/wt.mjs list` (`--json`): branch, slot, port, dirty files, ahead/behind, claims, age                                                                                                    |
| Check overlaps                    | `node scripts/worktree/wt.mjs claims` — exit 1 means two worktrees claim the same path                                                                                                                        |
| Show ports                        | `node scripts/worktree/ports.mjs --env`                                                                                                                                                                       |
| Remove one                        | `node scripts/worktree/wt.mjs rm docs/caption-prefs --delete-branch` (refuses when dirty; `--force` discards)                                                                                                 |
| Remove all merged                 | `node scripts/worktree/wt.mjs prune --merged --dry-run`, then without `--dry-run`                                                                                                                             |

Naming: types `feat fix docs chore ci test refactor perf release deps`; slug lowercase `a-z0-9` with single hyphens, ≤ 40 characters (Windows path budget). Release syncs use `release/site-<x.y.z>` and `release/site-<x.y.z>-live`. `new` fetches `origin`, unsets the upstream so the first `git push -u origin HEAD` creates the branch's own, writes `.worktree.json`, runs setup and warns on claim overlap.

## Ports

| Checkout                      | `SITE_PORT` (serve, Playwright, test request filter, capture-preview) | `SITE_CAPTURE_PORT` (capture-guide) |
| ----------------------------- | --------------------------------------------------------------------- | ----------------------------------- |
| Main checkout and CI (slot 0) | 4180                                                                  | 4181                                |
| Worktree slot N (1–49)        | 26000 + 100·N + 80 (slot 1: 26180, slot 3: 26380)                     | 26000 + 100·N + 81 (slot 1: 26181)  |

Precedence: explicit env var > `.worktree.json` slot > legacy. Override for one command:

```sh
SITE_PORT=26999 npm run dev                      # Git Bash
$env:SITE_PORT = '26999'; npm run dev            # PowerShell (unset: Remove-Item Env:SITE_PORT)
```

- Slot 0 of both repos collides on 4180 (site preview vs. the extension look-ahead server). Do task work in worktrees, or set `SITE_PORT` when both run from main checkouts.
- Playwright reuses a server already on `SITE_PORT` locally and does not rebuild it. Because the port is per worktree it is your own server; run `npm run build` first if it serves an old `dist/`.

## Claims and hot files

Claim what you will edit (prefix match, no globs). Hot files: `src/pages.mjs`, `site.config.mjs`, `public/assets/site.css`, `docs/VALIDATION.md`. `public/assets/guide` holds binaries that cannot be merged: only one capture or release-sync worktree at a time. On overlap, coordinate: narrow the edit, sequence the PRs, or rebase after the other merges.

## Machine-wide capture lock

`scripts/capture-guide.mjs` drives a real extension with tab capture. Wrap it in the lock the extension's e2e and probes use, so parallel capture never shares the machine:

```sh
node scripts/worktree/machine-lock.mjs capture -- node scripts/capture-guide.mjs "<ext>/dist/chromium" --extension-only
```

It waits (one "waiting for <cwd>" message) while another worktree holds it, treats a dead pid or a lock older than 30 minutes (`--timeout-min`) as stale and passes the command's exit code through.

## Harness-native worktrees

| Harness                        | Where it creates them                                | Then                                                                                   |
| ------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Claude Code `claude -w <name>` | `.claude/worktrees/<name>`, branch `worktree-<name>` | `node scripts/worktree/setup.mjs`; `git branch -m <type>/<slug>` before the first push |
| Codex app                      | `~/.codex/worktrees/…`, often detached               | `node scripts/worktree/setup.mjs`; `git switch -c <type>/<slug>`                       |
| Cursor parallel agents         | `~/.cursor/worktrees/…`                              | `.cursor/worktrees.json` runs setup; rename the branch as above                        |

`setup.mjs` copies the `copyFromMain` files listed in `.agents/workspace.json` without reading them, allocates the lowest free slot whose ports bind on 127.0.0.1, and runs `npm ci --ignore-scripts` when `node_modules` is missing or older than the lockfile. It never copies `node_modules`.

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Port <n> is already in use` from serve or capture-guide | `node scripts/worktree/ports.mjs --env`; find the owner: `netstat -ano \| findstr :<n>` (PowerShell: `Get-NetTCPConnection -LocalPort <n>`) |
| E2E passes but tests clearly old content                 | A stale `npm run dev` from this worktree: stop it or `npm run build`                                                                        |
| `EBUSY` / `EPERM` on `rm` (Windows)                      | Stop `npm run dev`, Playwright and IDE terminals in that worktree, then retry                                                               |
| `Filename too long`                                      | Shorter slug; `wt doctor` checks `core.longpaths`                                                                                           |
| `slug … must be lowercase …` / `unknown branch type`     | Use an allowed type and slug                                                                                                                |
| Merged branch not removed by `prune --merged`            | Squash merges defeat ancestry; prune reads merged PRs from `gh`, so check `gh auth status` and that a PR existed                            |
| `node_modules` missing or Playwright browser missing     | `node scripts/worktree/setup.mjs --install`; `npx playwright install chromium`                                                              |
| `wt doctor` reports vendored-file drift                  | Re-vendor from the extension repo (`.agents/README.md`); never hand-edit `scripts/worktree/*` here                                          |

## Done when

- [ ] The worktree sits under `$HUB/worktrees/site/`, on `<type>/<slug>`, with a slot and claims in `.worktree.json`.
- [ ] `node scripts/worktree/wt.mjs claims` exits 0, or the overlap is acknowledged in the task report.
- [ ] `npm run check` passes inside it.
- [ ] After the PR merged: worktree and local branch removed, `wt list` shows only live work.
