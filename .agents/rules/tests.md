---
description: Playwright browser tests — both projects, data-driven expectations, per-worktree ports, never weaken assertions
paths: tests/**,playwright.config.mjs
alwaysApply: false
---

# Browser tests

- `playwright.config.mjs` defines two projects that every test runs in: `desktop` (Chromium 1440×1000) and `mobile` (390×844, `isMobile`, `hasTouch`). Keep both; add viewports inside a test (`page.setViewportSize`) rather than new projects.
- The base URL comes from `SITE_PORT` via `scripts/worktree/ports.mjs`; tests use relative `page.goto(site.base + route)` and derive the local origin from `baseURL`. Never write a literal port or host.
- `webServer` runs `npm run build && npm run dev`. Locally it reuses a server already on the worktree's own port (no rebuild); in CI (`CI=true`) it always starts fresh, `forbidOnly` is on and `retries` is 1.
- The suite is the public-surface contract. Keep these assertions: no external requests, no page errors, HTTP 200 for every route, no horizontal overflow (also at 320 and 640 px), every image loads, no `form`/`input`, store links equal `site.stores.*`, `.store-pending` count, language list equals `src/languages.json`, CSP blocks an injected inline script, new-tab links carry `noopener noreferrer` over HTTPS, `mailto:` equals `site.email`.
- Expectations derive from data: `site` from `site.config.mjs`, `languageCatalog` from `src/languages.json`. Never hardcode a version, count, URL or email.
- Locators use roles and visible text (`getByRole('link', { name: 'Install for Chrome' })`). A deliberate copy change updates the locator in the same PR; never delete, loosen or `skip` an assertion to get green, and never commit `test.only`.
- A pass only on retry is a flaky test: fix the wait (`expect.poll`, `toBeVisible`) instead of adding sleeps or retries.
- Debug: `npx playwright test --project=mobile -g "<title>"`, `npx playwright test --last-failed`, `npx playwright show-trace test-results/<dir>/trace.zip`.
- New test files: `tests/<area>.spec.mjs`, ESM, `import { test, expect } from '@playwright/test'`; no network beyond the local server.
- Verify: `npm run test:e2e` (both projects) and `npm run check`.
