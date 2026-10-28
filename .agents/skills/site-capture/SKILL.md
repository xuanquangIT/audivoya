---
name: site-capture
description: Recapture the setup-guide screenshots from a real extension build. Runs scripts/capture-guide.mjs in a disposable Chromium profile, reviews the images, fixes image sizes and captions in src/pages.mjs and hands the captures to the extension's build-store-assets. Use when the extension popup or sync window changed, capture.json is behind the release, capture-guide fails, or store screenshots need fresh captures.
paths: scripts/capture-guide.mjs,public/assets/guide/**
argument-hint: '<path to extension dist/chromium>'
---

# Guide screenshots from a real extension build

`scripts/capture-guide.mjs <ext>/dist/chromium [--extension-only]` loads the unpacked extension into a throwaway Chromium profile, serves an owned generated demo page on `SITE_CAPTURE_PORT`, opens the real action popup and the real sync window (Audio monitor: no key, no provider request) and writes `public/assets/guide/`:

| File                          | Captured from                                                         | Used by                                            |
| ----------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| `extension-setup.png`         | popup `.controls`                                                     | not referenced by `src/pages.mjs` today            |
| `extension-panel.png`         | popup `.app` down to `.controls`                                      | guide; extension store assets                      |
| `extension-settings.png`      | popup `#settings` opened                                              | guide; extension store assets                      |
| `extension-sync.png`          | sync window, 1280×900                                                 | home `.sync-shot`, guide; extension store assets   |
| `extension-sync-controls.png` | sync window with `#controls` expanded                                 | guide; extension store assets                      |
| `google-key-docs.png`         | Google's public API-key docs (skipped by `--extension-only`)          | guide, with capture date and CC BY 4.0 attribution |
| `capture.json`                | metadata: `captured`, `extension`, `name`, `browser`, `mode`, `files` | provenance                                         |

Never hand-edit these files, never capture from `dist/chromium-dev` (`Audivoya [DEV]`, DEV badge), a personal profile, a real key or a third-party site. One capture branch at a time: claim `public/assets/guide`.

## 1. Get a clean production build of the extension

The extension repo is read-only for site work: besides fetching refs, write only its gitignored `dist/` or a throwaway detached worktree that you remove afterwards.

```sh
SITE_MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
HUB="$(dirname "$SITE_MAIN")"
EXT="$HUB/Realtime-Dubbing"
EXT_DIR="$HUB/worktrees/ext/release-0.2.18"   # an extension checkout at the commit you document
git -C "$EXT_DIR" status --porcelain           # must print nothing
git -C "$EXT_DIR" log -1 --format='%H %s'
(cd "$EXT_DIR" && npm run build:chromium)
node -p "require(process.argv[1]).version" "$EXT_DIR/dist/chromium/manifest.json"
```

No checkout sits at the commit (for example a tag of an old release)? Use a throwaway detached worktree and remove it afterwards:

```sh
git -C "$EXT" fetch origin --tags
git -C "$EXT" worktree add --detach "$HUB/worktrees/ext/capture-0.2.18" v0.2.18
(cd "$HUB/worktrees/ext/capture-0.2.18" && npm ci --ignore-scripts --no-audit --no-fund && npm run build:chromium)
# … capture …
git -C "$EXT" worktree remove --force "$HUB/worktrees/ext/capture-0.2.18"
```

## 2. Capture under the machine lock

```sh
npx playwright install chromium
node scripts/worktree/machine-lock.mjs capture -- node scripts/capture-guide.mjs "$EXT_DIR/dist/chromium" --extension-only
```

Drop `--extension-only` only to refresh `google-key-docs.png` (needs network, public page only). Then update its figcaption date ("captured <Month D, YYYY>") and keep the attribution.

## 3. Review every image

Open each PNG and `capture.json`:

- [ ] No key characters, account names, profile UI or third-party content; the source shows the generated "Demo lecture" clip.
- [ ] Popup images are cropped to the visible popup; no error banner; the source reads `127.0.0.1`.
- [ ] `extension-sync-controls.png` shows Controls expanded; `extension-sync.png` collapsed.
- [ ] The UI matches the extension build you documented (labels, layout).
- [ ] `capture.json` `extension` equals the manifest version; `captured` is today.

## 4. Fix sizes, captions and alt text

```sh
node -e "const fs=require('node:fs');const d='public/assets/guide/';for(const f of fs.readdirSync(d).filter((n)=>n.endsWith('.png'))){const b=fs.readFileSync(d+f);console.log(f,b.readUInt32BE(16)+'x'+b.readUInt32BE(20))}"
grep -n -o "guide/[a-z-]*\.png')}\" width=\"[0-9]*\" height=\"[0-9]*\"" src/pages.mjs
```

- Every `<img>` `width`/`height` equals the PNG's pixel size (layout shift and the 320 px test depend on it).
- Captions must name the version that was captured. Captions that interpolate `site.extensionVersion` claim the store-live version: `grep -n 'figcaption>Audivoya \${site.extensionVersion}' src/pages.mjs`. When the capture version differs (release-sync Phase A), make them read the metadata instead: `import capture from '../public/assets/guide/capture.json' with { type: 'json' };` and `${capture.extension}`.
- Update `alt` text when visible controls changed.
- Run `npm run check`, `npm run test:e2e`, then `npm run build && node scripts/capture-preview.mjs` and review `artifacts/guide-desktop.png` and `artifacts/home-*.png`.

## 5. Hand off to the extension's store assets

The extension builds store images from these captures. Give the extension release manager the site worktree path; on the extension side they run:

```sh
node scripts/build-store-assets.mjs --captures "<site worktree>/public/assets/guide"
# or: AUDIVOYA_SITE_DIR="<site worktree>" node scripts/build-store-assets.mjs
```

## Selector contract

`capture-guide.mjs` depends on extension markup: `#audio-source`, `#api-key`, `#error`, `#status`, `#settings`, `#session-mode` (value `monitor`), `#start-sync`, `.controls`, `.app`, and in `sync.html` `#picture` (a canvas), `#status`, `#controls > summary`, `#stop`. Check a release for removals before capturing:

```sh
git -C "$EXT" diff v<live> <ext-ref> -- apps/extension/index.html apps/extension/sync.html \
  | grep -E '^-.*(id="(audio-source|api-key|error|status|settings|session-mode|start-sync|picture|controls|stop)"|class="[^"]*(controls|app))'
```

Renamed selectors: update `scripts/capture-guide.mjs` in the same site PR.

## Failures

| Message                                                                          | Cause                                                       | Fix                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Pass the extension dist/chromium directory.` / `ENOENT … manifest.json`         | Missing or wrong path                                       | Pass the directory that contains `manifest.json`                                          |
| `Port <n> is already in use`                                                     | Another capture outside the lock                            | Use the lock; or set `SITE_CAPTURE_PORT`                                                  |
| `Owned source target missing`, `Actual action popup was not created`             | CDP `Extensions.triggerAction` unavailable in this Chromium | `npx playwright install chromium`; keep Playwright aligned with the extension (site-deps) |
| `Capture is not in a clean owned-media setup state` (prints source/status/error) | Popup did not bind the demo tab, or shows an error          | Rerun once; confirm a clean production build; check the selector contract                 |
| Timeout waiting for `/sync.html#` or `#picture`                                  | Sync flow or `#start-sync`/`#session-mode` changed          | Diff the extension markup; update `capture-guide.mjs`                                     |
| `Popup timed out`                                                                | Slow machine or parallel load                               | Rerun under the lock                                                                      |
| Google heading `Using Gemini API keys` not found                                 | Google changed its page                                     | Use `--extension-only`; update the heading after checking the page manually               |

## Done when

- [ ] Captures come from a clean `dist/chromium` at a named extension commit; `capture.json` records that version.
- [ ] Every image reviewed; sizes, captions and alt text match.
- [ ] `npm run check` and `npm run test:e2e` pass; guide and home screenshots reviewed.
- [ ] `docs/VALIDATION.md` entry states extension version, commit, browser, mode and what the images do not prove (no translation, no performance).
- [ ] Extension side told where the captures are (worktree path or merged commit).
