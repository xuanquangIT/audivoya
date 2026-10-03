# Website validation

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
