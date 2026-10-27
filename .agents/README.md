# Agent platform — website repository

This repository uses the Audivoya agent platform. How it works — canonical sources, the generator, hooks, the harness matrix (Claude Code, Codex, Cursor, Copilot), and how to add a skill, agent or rule — is documented upstream in the extension repository: `.agents/README.md` in `xuanquangIT/audivoya-extension` (locally `$HUB/Realtime-Dubbing/.agents/README.md`, `$HUB` being the parent of this main checkout). This file lists only what differs here.

## Site specifics

| Item             | Value                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Repo id          | `site` (`.agents/workspace.json`)                                                                                    |
| Branches         | Base and only protected branch: `main`. Every merge to `main` deploys GitHub Pages (Deploy class in `AGENTS.md`)     |
| Worktrees        | `../worktrees/site/<type>-<slug>` relative to the main checkout                                                      |
| Ports            | `slotBase` 26000: `SITE_PORT` legacy 4180, offset 80; `SITE_CAPTURE_PORT` legacy 4181, offset 81                     |
| Machine lock     | `capture`, shared with the extension's e2e and probes; wrap `scripts/capture-guide.mjs` in it                        |
| Gate             | `npm run check` (includes `agents:check`), `npm run test:e2e`, `npm test`                                            |
| Release coupling | `site-release-sync` (two phases) and `site-capture`; the extension reads `public/assets/guide/` for its store images |

## Catalog

- Skills (`.agents/skills/`): `site-ship`, `site-worktree`, `site-release-sync`, `site-capture`, `site-content`, `site-deploy`, `site-deps`.
- Agents (`.agents/agents/`): `site-implementer`, `site-reviewer` (read-only), `site-qa` (read-only), `site-release-sync`.
- Rules (`.agents/rules/`): `pages`, `scripts`, `tests`, `ci`, `docs`, `agent-config`.

`AGENTS.md` lists them with descriptions (generated regions).

## Changing the platform here

| Change                                                                      | Where                                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Site skill, agent or rule content                                           | Edit `.agents/…` here, run `npm run agents:sync`, commit sources and generated files      |
| Generator, hooks, worktree CLI (`scripts/agents/**`, `scripts/worktree/**`) | Change upstream in the extension repo first, then re-vendor (below)                       |
| Ports, base branch, copied files                                            | `.agents/workspace.json` here                                                             |
| Hook wiring and permissions                                                 | `.claude/settings.json` here (same structure as the extension's; protected branch `main`) |

Re-vendor from the extension's reviewed `develop`, in a `chore/vendor-agent-platform` worktree:

```sh
EXT="$(dirname "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")/Realtime-Dubbing"
git -C "$EXT" fetch origin
git -C "$EXT" archive origin/develop scripts/agents scripts/worktree | tar -x -f -
node scripts/worktree/wt.mjs doctor          # vendored-file parity
npm test && npm run check
```

Commit as `chore(agents): vendor agent platform scripts from extension <sha>`.
