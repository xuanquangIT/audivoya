# Audivoya - AI Dubbing & Captions

Public product information, setup guide, privacy policy, support and terms for Audivoya. Publisher: Quang Vu.

Production URL: https://xuanquangit.github.io/audivoya/

Audivoya is the publisher-selected product brand, formerly Realtime Dubbing. The publisher requested new repository and website URLs before store submission: public website repository `xuanquangIT/audivoya`, private extension repository `xuanquangIT/audivoya-extension`, and Pages base `/audivoya/`. Trademark/domain clearance is not claimed by this rename. The compact wordmark is Audivoya and the complete product title is Audivoya - AI Dubbing & Captions.

The extension repository stays private. This site does not contain its source, API credentials, recordings or distributions. Chrome and Edge store listings are pending; no install link is invented.

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

After store approval, put the verified HTTPS listing URLs in `site.config.mjs` and update the explicit availability copy. Keep privacy disclosures aligned with actual extension/provider behavior. Deploy from a reviewed PR into `main`; GitHub Actions publishes only after checks pass.

GitHub Pages hosts this informational project site. There is no checkout, payment, credential form, login or commercial SaaS runtime. Reassess hosting before introducing those features under [GitHub Pages usage restrictions](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Screenshot provenance

`scripts/capture-guide.mjs <path-to-extension-dist/chromium>` captures the actual installed extension in a disposable test browser, from an owned localhost page. It never reads `.env`, sends provider audio, loads a personal profile or enters a real key. The Google image is its public API documentation, not a private dashboard; attribution and CC BY 4.0 link accompany it. Public capture metadata identifies the tested extension/browser. Re-check current Google instructions before publishing refreshed guides.

See [security notes](docs/SECURITY.md), [validation](docs/VALIDATION.md) and [LICENSE](LICENSE).

Language facts are versioned in `src/languages.json`, matching the extension’s reviewed catalog. Home, setup, support and metadata use that catalog; the full expandable language list links to the model-specific Google source. Generic Gemini Live agent/transcription language lists are not a substitute for the translation-model list.
