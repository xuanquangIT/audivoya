# Website validation

## Chrome Web Store launch (October 6, 2026)

Verified the publisher's Chrome Web Store URL resolves to the canonical `chromewebstore.google.com` listing for **Audivoya - AI Dubbing & Captions**, returns HTTP 200, and includes an **Add to Chrome** action. Home, setup guide, install section, FAQ, support copy and search metadata now identify version 0.2.15 as available for desktop Chrome and link directly to the listing. Edge remains marked pending until its own Add-ons publication is verified; the site does not imply that the Chrome listing is the Edge store listing. The store settings contain only the verified Chrome URL.

The existing store-state browser assertion now expects one pending listing (Edge) instead of two. No new test was added. The Chrome item ID in the public URL is `epkhkijhmdajkhaedfdncdoaafdhnhlk`. No extension package, provider policy, key flow or privacy handling changed. Website install links remain independently verified per store.

## Audivoya 0.2.15 release guide (October 4, 2026)

Updated the guide for Fullscreen / Exit fullscreen, external native fullscreen state such as F11, restoration of normal/maximized mode, picture fitting above expanded Controls, and bounded audio catch-up. Skipped translated speech and seek-handshake waiting are disclosed without claiming lower provider latency or guaranteed completeness. The versioned privacy/config copy now targets 0.2.15. Public install links remain pending store approval.

Refreshed the setup/panel/settings screenshots from the actual packaged 0.2.15 action popup in a disposable Chromium profile on owned localhost content. No key, provider request, private content or user profile was used. The existing capture helper records the real date and crops to the visible native popup viewport to avoid compositor repetition beyond that viewport. Captions identify the crop and setup-only evidence; image dimensions match the captures. Google's separately attributed public documentation image is unchanged.

Local build/link/CSP/secret checks verify 17 public files; all ten desktop/mobile browser cases pass. Formatting is normalized in this validation record after the initial check exposed a pre-existing formatting discrepancy. GitHub Pages deployment follows protected PR verification and merge. These website checks do not prove translation performance, store acceptance or capture startup stability.

## Collapsed sync controls and source playback (October 4, 2026, candidate 0.2.14)

The guide describes a collapsed-by-default Controls panel, local play/pause, ten-second skips, playback speeds, volumes and mute. Playback commands affect the current source player immediately; seeking refills the delayed view. The guide preserves the source-tab fallback for inaccessible/custom/embedded players and blocked Play, as well as experimental synchronization limits. No website tracker, remote asset, dependency or credential flow changed. Local build/link/CSP/secret-pattern checks and ten desktop/mobile browser checks pass; public deployment follows protected-branch CI.

## Sync recovery controls (October 4, 2026, extension candidate 0.2.13)

The guide now describes original/dubbed audio sliders and mute in the sync viewer, retaining picture/original audio during temporary translation reconnects, and closing a viewer when its session ends. Source-tab playback controls and experimental synchronization limits remain explicit. Local build/link/CSP/secret-pattern checks and all ten desktop/mobile E2E cases pass. Public deployment follows the protected PR merge.

## Same-website sessions (October 4, 2026, extension candidate 0.2.12)

Updated the guide, homepage and privacy copy to describe default-on continuation through videos, full navigation, SPA route changes and reloads in the selected tab on the exact same origin. Another origin/subdomain, closing that tab, Stop or the original session time limit ends capture. Navigation origin checks are local; full URLs are not persisted or uploaded. Existing settings screenshots are labeled as earlier candidates rather than presenting them as captures of the new control. No capture, provider request or credential input occurs on this website. Local build, link/CSP/secret-pattern checks and formatting pass across 17 public files; all ten desktop/mobile E2E cases pass. Public deployment and exact live checks follow the protected PR merge.

## Local credential disclosure update (October 4, 2026)

Updated guide/home/privacy source for automatic browser-profile encryption in the 0.2.11 candidate, with explicit same-profile key limitations and the earlier 0.2.10 session-only behavior. No installer/password prompt is described. Existing screenshots are labeled as earlier candidate captures. Local build, link/anchor/CSP/secret-pattern checks, formatting and all ten desktop/mobile browser cases pass. Website source remains undeployed; older validation below records earlier deployments. No provider request or credential input occurs on this site.

## Microsoft Edge setup guidance

Added Edge-specific instructions to the installation guide: use the verified Edge Add-ons listing when public, show the extension in Edge's toolbar, grant the optional displayed Google API origin for dubbing and use Audio monitor without a provider key. The guide explains browser-session key deletion on restart/reload and where to manage/remove the extension. Existing privacy, provider-charge and delayed-viewing disclosures are unchanged. No public install link is enabled solely from a draft or successful API submission.

## Full translation language catalog (extension candidate 0.2.10)

On October 3, 2026, replaced three-language product claims with all 78 named targets documented for Gemini Live Translation. The reviewed model-specific snapshot matches the extension, including the Norwegian alias. Home, feature copy, guide, FAQ, support and metadata use the complete catalog. An accessible expandable list displays all names and links to Google's source. The text distinguishes provider-documented coverage from all-language listening validation. Existing owned screenshots remain setup examples with Vietnamese selected.

Local checks verify 17 public files, formatting, security/link/CSP guardrails. Ten desktop/mobile browser cases pass, including the full list, setup copy and expanded-list layout. Dependency audit reports zero known vulnerabilities. No new provider call, user credential, executable dependency, analytics or CSP relaxation is introduced. Public install links remain unavailable until a listing is verified; protected Pages deployment follows the reviewed merge.

## Audivoya rebrand

On October 3, 2026, the publisher selected **Audivoya - AI Dubbing & Captions**. The site uses Audivoya as its compact wordmark and the full title in homepage metadata/sharing artwork, with the existing Listen beyond language tagline. The publisher also requested the new public URL `https://xuanquangit.github.io/audivoya/`, public repository `xuanquangIT/audivoya` and private extension repository `xuanquangIT/audivoya-extension` before store submission. Current copy, policies, guide and screenshot provenance are refreshed; historical deployment evidence below retains the earlier name/URL. No analytics, credentials, payment UI, dependencies or CSP changes are introduced.

Local `npm run check` verifies all 17 public output files, including the new real primary-panel screenshot from extension 0.2.9. Eight desktop/mobile browser cases pass, and source/build validation rejects retired product text. Screenshot review confirms the branded header, empty key field and setup-only state; the native screenshot is clipped to the visible header/primary controls to avoid Chromium popup compositing beyond its viewport. Google documentation remains separately attributed. Gitleaks reports no known secret pattern in the public build; npm audit reports zero known development-package vulnerabilities. Public deployment and anonymous live checks follow the protected PR/Pages workflow.

Prepared October 3, 2026. This is a website release record; it does not certify store approval, installed user Edge behavior or live dubbing latency.

## Evidence scope

- Copy checked against the private extension's current implementation and release disclosures: three target languages, Chrome/Edge candidate, provider key/fees, direct audio sharing, one-hour saved-key use, optional local sync buffer, rate-following limits and arrival-timed VTT.
- Google key instructions checked against https://ai.google.dev/gemini-api/docs/api-key on October 3, 2026. The public documentation screenshot is attributed; no signed-in dashboard, real API key or paid provider request is used.
- Real installed extension controls captured in a disposable Chromium browser with an owned local page. Images demonstrate setup/settings, not translation quality or latency.
- Desktop/mobile checks cover all five public pages, local assets, overflow, keyboard disclosures, setup navigation, accurate pending-store controls, no unintended external requests and CSP isolation. The narrow/zoom-equivalent checks cover 320 and 640 CSS pixel viewports; they do not claim every device or native browser zoom implementation.
- Source/public artifact checks verify links, anchors, relative deployment base, size bounds, CSP, disallowed credential/transaction inputs and prohibited unsupported claims. Secrets are additionally checked with Gitleaks; npm audit covers development packages only.

Deployment and exact final outcomes are appended after live verification. The site should be accessible without GitHub sign-in at the public homepage, guide, privacy, support and terms URLs. Approved store URLs remain absent until verified by the publisher.

## Local release checks

Windows, Node.js 24.11.1 and Playwright Chromium 153.0.8010.12: `npm run check` passes for all 16 public output files; all eight desktop/mobile browser cases pass. `npm audit` reports zero known vulnerabilities across five development-package records. Screenshot review confirms a clean Ready state on the owned localhost page, an empty key field and no account identities. Static artwork is illustrative and does not depict a translated provider result.

The first Linux CI run exposed horizontal overflow at the 320-pixel desktop viewport with Linux fallback fonts. Mobile title wrapping and header spacing were adjusted without weakening the assertion. Deployment is held behind the same browser check; the failed run remains visible for audit.

## Public deployment

[Linux Pages run 37107595941](https://github.com/xuanquangIT/realtime-dubbing-site/actions/runs/37107595941) passed all checks and deployed commit `0293c5b`. The initial failed run `37107458070` remains visible; the narrow-font regression is resolved in the subsequent run.

Anonymous live verification on October 3, 2026 matches all 15 served files to the local artifact byte for byte. A fresh Chromium context passes 15 page/viewport combinations (five pages at 1440, 390 and 320 CSS pixels), with loaded images, no horizontal overflow and zero requests to other origins. Screenshots and `live-verification.json` remain local under ignored `artifacts`. The site is accessible without GitHub sign-in, including `/guide/`, `/privacy/`, `/support/` and `/terms/`. GitHub Pages reports HTTPS enforcement enabled. These checks do not establish translation quality or store approval.
