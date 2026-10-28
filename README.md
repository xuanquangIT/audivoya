# Audivoya - AI Dubbing & Captions

Public product information, setup guide, privacy policy, support and terms for Audivoya. Publisher: Quang Vu.

Production URL: https://xuanquangit.github.io/audivoya/

Audivoya is the publisher-selected product brand, formerly Realtime Dubbing. The publisher requested new repository and website URLs before store submission: public website repository `xuanquangIT/audivoya`, private extension repository `xuanquangIT/audivoya-extension`, and Pages base `/audivoya/`. Trademark/domain clearance is not claimed by this rename. The compact wordmark is Audivoya and the complete product title is Audivoya - AI Dubbing & Captions.

The extension repository stays private. This site does not contain its source, API credentials, recordings or distributions. The desktop Chrome and Microsoft Edge store releases are public. No unofficial install link is invented.

## Development

Use Node.js 24 and npm:

```sh
npm ci --ignore-scripts
npm run build
npm run dev
npm run check
npx playwright install chromium
npm run test:e2e
node scripts/verify-live.mjs
```

Open http://127.0.0.1:4180/audivoya/. The preview uses the real deployment base so path failures are visible locally.

## Parallel worktrees & ports

One task = one worktree = one branch = one PR. Keep this main checkout on `main` for integration and review, and do task work in a linked worktree:

```sh
node scripts/worktree/wt.mjs new docs/refresh-guide --claims src/pages.mjs,docs/VALIDATION.md
node scripts/worktree/wt.mjs list
node scripts/worktree/wt.mjs claims
node scripts/worktree/wt.mjs rm docs/refresh-guide --delete-branch
```

`new` fetches, branches from `origin/main` into `../worktrees/site/docs-refresh-guide`, copies `.env` when the main checkout has one, runs `npm ci --ignore-scripts` and records the slot in the gitignored `.worktree.json`. `claims` exits 1 when two worktrees claim the same path; claim the merge hotspots (`src/pages.mjs`, `site.config.mjs`, `public/assets/site.css`, `docs/VALIDATION.md`) whenever a task edits them. Worktrees created by Claude Code, Codex or Cursor bootstrap themselves with `node scripts/worktree/setup.mjs` (via `.worktreeinclude` and `.cursor/worktrees.json`).

Ports are defined in `.agents/workspace.json`:

| Checkout                      | `SITE_PORT` (`npm run dev`, Playwright, `capture-preview`) | `SITE_CAPTURE_PORT` (`capture-guide`) |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Main checkout and CI (slot 0) | 4180                                                       | 4181                                  |
| Worktree slot N (1-49)        | 26000 + 100 × N + 80 (slot 1: 26180)                       | 26000 + 100 × N + 81 (slot 1: 26181)  |

An explicitly set variable always wins, for example `SITE_PORT=4300 npm run dev`. `node scripts/worktree/ports.mjs` prints the ports of the current checkout. Because every worktree has its own port, local Playwright runs can safely reuse an already running preview (`reuseExistingServer` is off on CI) without testing another worktree's `dist`.

`.gitattributes` and `.editorconfig` keep every checkout on LF line endings, so `prettier --check` gives the same result in each worktree whatever `core.autocrlf` is set to.

## Structure

- `src/pages.mjs`: English page copy and semantic HTML.
- `site.config.mjs`: publisher, canonical origin/base and verified store URLs.
- `public/assets`: owned artwork, CSS, minimal progressive enhancement and reviewed screenshots.
- `scripts/build.mjs`: builds only the public allowlisted directory and page templates into `dist`.
- `scripts/check.mjs`: public link/anchor, CSP, asset, secret-pattern and claim checks.
- `tests`: desktop/mobile browser, disclosure, isolation and network checks.
- `.github/workflows/pages.yml`: checks and deploys `dist` with pinned actions and scoped permissions.

`npm run build` removes only this project's generated `dist` directory, with an absolute path guard. It does not load `.env`. There is no production npm dependency.

## Content maintenance

Verify feature claims against the extension before changing copy. The current Chromium candidate exposes all 78 output languages documented for Gemini Live Translation (79 accepted codes including the Norwegian alias); the Chromium candidate targets desktop Chrome and Edge. Firefox, Safari and mobile live capture are not released. Do not promise instantaneous translation, exact word alignment, unlimited usage or every website.

The desktop Chrome and Microsoft Edge releases are public. Their canonical store URLs are configured in `site.config.mjs`. Keep privacy disclosures aligned with actual extension/provider behavior. Deploy from a reviewed PR into `main`; GitHub Actions publishes only after checks pass.

GitHub Pages hosts this informational project site. There is no checkout, payment, credential form, login or commercial SaaS runtime. Reassess hosting before introducing those features under [GitHub Pages usage restrictions](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Screenshot provenance

`scripts/capture-guide.mjs <path-to-extension-dist/chromium>` captures the actual installed extension in a disposable test browser, from an owned localhost page. It never reads `.env`, sends provider audio, loads a personal profile or enters a real key. The Google image is its public API documentation, not a private dashboard; attribution and CC BY 4.0 link accompany it. Public capture metadata identifies the tested extension/browser. Re-check current Google instructions before publishing refreshed guides.

See [security notes](docs/SECURITY.md), [validation](docs/VALIDATION.md) and [LICENSE](LICENSE).

Language facts are versioned in `src/languages.json`, matching the extension’s reviewed catalog. Home, setup, support and metadata use that catalog; the full expandable language list links to the model-specific Google source. Generic Gemini Live agent/transcription language lists are not a substitute for the translation-model list.

## Credential disclosure refresh (October 4, 2026)

Website source now distinguishes the current 0.2.15 automatic browser-profile encryption from earlier 0.2.10 session-only behavior. There is no companion/password setup. The encryption key lives in the same profile, so this is not an OS vault or protection against profile takeover. Deploy matching privacy copy before releasing the new extension; source changes alone do not update the public website.
