# Audivoya website — agent guide

Public site for Audivoya - AI Dubbing & Captions (home, setup guide, privacy, support, terms) at https://xuanquangit.github.io/audivoya/, repository `xuanquangIT/audivoya`. The private extension repository `Realtime-Dubbing` (`xuanquangIT/audivoya-extension`) sits beside this one; the site mirrors its facts and never leads them.

<!-- agents:essentials:start -->

## Essentials

- **Stack.** Node 24 ESM, no runtime dependencies, exact dev pins (`@playwright/test`, `prettier`). `scripts/build.mjs` renders the five routes of `src/pages.mjs` (`''`, `guide/`, `privacy/`, `support/`, `terms/`) into `dist/` with a shared header, footer and meta CSP, copies `public/`, writes `sitemap.xml`, `404.html` and `.nojekyll`.
- **Facts are data.** `site.config.mjs`: `extensionVersion` = the version live in the stores, `updated` = sitemap lastmod, `stores.chrome`/`stores.edge` = anonymously verified listings. `src/languages.json` is a byte copy of the extension's `docs/release/chrome-store/languages.json`. Never hardcode versions, language counts or store URLs in copy or tests.
- **Gate.** `npm run check` (build, `scripts/check.mjs`, `prettier --check .`, `agents:check`) and `npm run test:e2e` (Playwright `desktop` 1440×1000 and `mobile` 390×844). CI job `verify` adds gitleaks and `npm audit --audit-level=high`.
- **Public-surface invariants** (`scripts/check.mjs`, tests): meta CSP with `connect-src 'none'` and `form-action 'none'`; no `<form>`, `<input>`, `<iframe>`, inline `<script>` or `on*=` handlers; no external requests (self-hosted assets); internal links under `/audivoya/`; external links HTTPS with `target="_blank" rel="noopener noreferrer"`; no credential-like strings; files < 3 MB; no banned claims (`BYOK`, `100% secure`, `zero latency`, `millisecond translation`, `unlimited dubbing`, `trusted by <n>`); no retired brand "Realtime Dubbing".
- **Honest copy.** Version and availability text changes only after the store listing is verified anonymously. Privacy copy matches the extension's privacy page before that extension version is submitted. Evidence not produced is written NOT RUN.
- **Flow.** One task = one worktree = one branch = one PR into `main`: `node scripts/worktree/wt.mjs new <type>/<slug> --claims <paths>`. Conventional Commits, squash merge, linear history, required check `verify` on an up-to-date branch. Every merge to `main` deploys GitHub Pages.
- **Secrets.** Never read, print, copy or commit `.env`, `*credential*.txt`, `realtimedubbing-*.json` or service-account JSON.
- **Agent config.** Harness files are generated from `.agents/`: edit the source, then `npm run agents:sync`.

<!-- agents:essentials:end -->

## Workspace

| Path (`$HUB` = parent of the main checkout) | Role                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `$HUB/Landing-Page`                         | Main checkout on `main`: integration, review, post-deploy checks; no task work |
| `$HUB/worktrees/site/<type>-<slug>`         | Task worktrees, branch `<type>/<slug>` from `origin/main`                      |
| `$HUB/Realtime-Dubbing`                     | Extension main checkout (`develop`); read-only for site tasks                  |
| `$HUB/worktrees/ext/<type>-<slug>`          | Extension worktrees, e.g. `release-0.2.18` for a release candidate             |

`node $HUB/tools/wt.mjs list` shows the worktrees of both repos. Harness-made worktrees (`claude -w`, Codex, Cursor) run `node scripts/worktree/setup.mjs` first.

## Commands

| Command                                                                 | Purpose                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm ci --ignore-scripts`                                               | Install from the lockfile                                              |
| `npm run build` / `npm run dev`                                         | Generate `dist/` / serve it at `http://127.0.0.1:$SITE_PORT/audivoya/` |
| `npm run check`                                                         | Static gate (see Essentials)                                           |
| `npm run test:e2e`                                                      | Playwright desktop + mobile; builds and serves on the worktree's port  |
| `npm test`                                                              | Node tests of the vendored platform scripts                            |
| `npm run format`                                                        | Prettier write                                                         |
| `node scripts/capture-preview.mjs`                                      | Full-page PNGs of every route into `artifacts/` (build first)          |
| `node scripts/capture-guide.mjs <ext>/dist/chromium [--extension-only]` | Recapture `public/assets/guide/` from a real extension build           |
| `node scripts/generate-social-card.mjs`                                 | Regenerate `public/assets/social-card.png`                             |
| `node scripts/verify-live.mjs`                                          | After deploy: hash-compare `dist/` with production, browser checks     |
| `npm run agents:sync` / `npm run agents:check`                          | Regenerate / verify harness files from `.agents/`                      |

Ports: `SITE_PORT` (serve, Playwright, test request filter, capture-preview) and `SITE_CAPTURE_PORT` (capture-guide) are 4180/4181 in the main checkout and CI, `26000 + 100·N + 80/81` in worktree slot N. `node scripts/worktree/ports.mjs --env` prints them; an explicit env var wins. The extension's look-ahead server also defaults to 4180, so do parallel work in worktrees.

## Extension coupling

- Releases: [site-release-sync](.agents/skills/site-release-sync/SKILL.md). Phase A before store submission (privacy, guide, FAQ, languages, captures; version claims unchanged) must be live before the extension release PR merges. Phase B after the listing is live (version, store links, social card, live check).
- `scripts/capture-guide.mjs` depends on extension markup (`#audio-source`, `#api-key`, `#error`, `#status`, `#settings`, `#session-mode`, `#start-sync`, `.controls`, `.app`; sync `#picture`, `#controls > summary`, `#stop`).
- The extension's `scripts/build-store-assets.mjs` reads `public/assets/guide/` (`--captures <dir>` or `AUDIVOYA_SITE_DIR`).
- The extension links to `/`, `/guide/`, `/privacy/` and `/support/` under `/audivoya/` (manifest `homepage_url`, popup, privacy page, store listings): never rename or remove these routes.

## Autonomy policy

- **Autonomous — just do it:** read anything except secrets, including the extension repo; create worktrees and branches; edit any tracked site file (pages, styles, assets, scripts, tests, CI, docs, agent config); install from the lockfile; run every local build, check, Playwright run, `capture-preview`, `capture-guide` (disposable profile, owned page), anonymous store-listing check and `verify-live.mjs`; build the extension's gitignored `dist/` for captures (in an extension worktree at the release commit, or a throwaway detached one you remove afterwards); commit; push non-`main` branches (`--force-with-lease` on your own branch only); open, update, label and comment on PRs; re-run and fix CI; rebase; prune merged worktrees and branches; triage Dependabot PRs.
- **Deploy — do it when the request asks to deploy, publish, release or ship, then report:** merge any PR into `main` (every merge, docs-only and Dependabot included, publishes GitHub Pages); `gh workflow run pages.yml`; re-running a failed `main` run as part of that deploy.
- **Never:** read, print, commit or upload secrets; rotate or revoke credentials; change repository settings, branch protection, the `github-pages` environment or Actions secrets/variables; push or force-push to `main`; disable or weaken `scripts/check.mjs`, gitleaks, the CSP or test assertions to get green; edit, commit, push or switch branches in the extension repo from a site task; publish a version or store availability not verified on the live listing; claim evidence that was not produced (write NOT RUN).

## Conventions

- Branches: `feat/`, `fix/`, `docs/`, `release/site-<x.y.z>` (Phase A) and `release/site-<x.y.z>-live` (Phase B), `deps/`; also `ci/`, `test/`, `chore/`, `refactor/`, `perf/`. Slug lowercase, ≤ 40 characters.
- Commits: Conventional Commits, imperative subject ≤ 72 characters; scopes `pages`, `privacy`, `guide`, `capture`, `release`, `e2e`, `ci`, `deps`, `agents`, `worktree`, `docs`. Body: user-visible outcome, then evidence. Copy-only changes are `docs:`; Dependabot uses `build(deps)`.
- PRs: title = squash subject; body sections Summary, Extension reference, Evidence, Deploy (template in [site-ship](.agents/skills/site-ship/SKILL.md)). Feature PRs never change `extensionVersion` or `stores`.
- Evidence tiers: static/build · browser UI (desktop + mobile) · screenshot review · installed-extension capture · store listing (anonymous) · live site (`verify-live.mjs`).
- `docs/VALIDATION.md`: prepend one entry per PR that changes the public build; post-deploy results go in a PR comment.
- Hot files (claim them, keep diffs narrow): `src/pages.mjs`, `site.config.mjs`, `public/assets/site.css`, `docs/VALIDATION.md`; `public/assets/guide/` is binary, one capture branch at a time.

## Skills

<!-- agents:skills:start -->

| Skill               | Purpose                                                                            | Source                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `site-capture`      | Recapture the setup-guide screenshots from a real extension build.                 | [.agents/skills/site-capture/SKILL.md](.agents/skills/site-capture/SKILL.md)           |
| `site-content`      | Review website copy for unverifiable claims and privacy parity with the extension. | [.agents/skills/site-content/SKILL.md](.agents/skills/site-content/SKILL.md)           |
| `site-deploy`       | Deploy the website to production and prove it is live.                             | [.agents/skills/site-deploy/SKILL.md](.agents/skills/site-deploy/SKILL.md)             |
| `site-deps`         | Triage Dependabot and upgrade site tooling.                                        | [.agents/skills/site-deps/SKILL.md](.agents/skills/site-deps/SKILL.md)                 |
| `site-release-sync` | Sync the website with an extension release in two phases.                          | [.agents/skills/site-release-sync/SKILL.md](.agents/skills/site-release-sync/SKILL.md) |
| `site-ship`         | Ship one website change from worktree to a green PR into main.                     | [.agents/skills/site-ship/SKILL.md](.agents/skills/site-ship/SKILL.md)                 |
| `site-worktree`     | Create, bootstrap, list and clean up site worktrees.                               | [.agents/skills/site-worktree/SKILL.md](.agents/skills/site-worktree/SKILL.md)         |

<!-- agents:skills:end -->

## Agents

<!-- agents:agents:start -->

| Agent               | Purpose                                                                           | Source                                                                     |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `site-implementer`  | Implement one website task brief in its own worktree and open a green PR to main. | [.agents/agents/site-implementer.md](.agents/agents/site-implementer.md)   |
| `site-qa`           | Run the website quality gate and return PASS or FAIL with evidence.               | [.agents/agents/site-qa.md](.agents/agents/site-qa.md)                     |
| `site-release-sync` | Run the two-phase website sync for one extension release and open the site PR.    | [.agents/agents/site-release-sync.md](.agents/agents/site-release-sync.md) |
| `site-reviewer`     | Review a website branch or PR diff and return file:line findings with a verdict.  | [.agents/agents/site-reviewer.md](.agents/agents/site-reviewer.md)         |

<!-- agents:agents:end -->

## Rules

<!-- agents:rules:start -->

| Rule           | Applies to                                                                                                                                                         | Source                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `agent-config` | `.agents/**`, `.claude/**`, `.cursor/**`, `.codex/**`, `.github/agents/**`, `.github/instructions/**`, `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md` | [.agents/rules/agent-config.md](.agents/rules/agent-config.md) |
| `ci`           | `.github/**`                                                                                                                                                       | [.agents/rules/ci.md](.agents/rules/ci.md)                     |
| `docs`         | `docs/**`, `README.md`                                                                                                                                             | [.agents/rules/docs.md](.agents/rules/docs.md)                 |
| `pages`        | `src/**`, `site.config.mjs`, `public/**`                                                                                                                           | [.agents/rules/pages.md](.agents/rules/pages.md)               |
| `scripts`      | `scripts/**`                                                                                                                                                       | [.agents/rules/scripts.md](.agents/rules/scripts.md)           |
| `tests`        | `tests/**`, `playwright.config.mjs`                                                                                                                                | [.agents/rules/tests.md](.agents/rules/tests.md)               |

<!-- agents:rules:end -->

## Agent platform

Sources live in `.agents/` ([README](.agents/README.md)); `scripts/agents/**` and `scripts/worktree/**` are byte-identical copies of the extension repo's, whose `.agents/README.md` documents the generator, hooks and harness matrix.
