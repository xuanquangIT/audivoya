---
description: Repository documentation — validation log format, security notes, README facts kept in sync with the site
paths: docs/**,README.md
alwaysApply: false
---

# Documentation

- English, plain and specific. Dates read "October 7, 2026". No banned claims or absolutes; public repo, so no local paths, account details or secrets.
- `docs/VALIDATION.md` is the evidence log, newest entry first. Prepend one entry per PR that changes the public build:

  ```markdown
  ## <What changed for users> (<Month D, YYYY>)

  <User-visible change and why. Extension reference: version, ref and SHA compared, or "none".>

  <Evidence with real numbers: "Local build/link/CSP/secret checks verify N public files and all 10 desktop/mobile browser cases pass." Capture provenance (extension version, browser, mode) when images changed. Store listing results (URL, HTTP status, version) in Phase B.>

  <What this does not prove (translation quality, latency, store acceptance) and any ordering constraint ("publish before the X.Y.Z store submission", "publish only after X.Y.Z is live").>
  ```

  Write NOT RUN for any tier you did not exercise. Never rewrite older entries except to correct a fact, marked "Correction (<date>):". On rebase conflicts keep both entries in date order.

- Post-deploy `verify-live.mjs` results go in a PR comment (site-deploy §6), not a new commit, because every commit to `main` redeploys.
- `docs/SECURITY.md`: update when a security boundary changes — new script with network access, new asset type, CSP or permission change, new workflow capability.
- `README.md`: Development commands, "Parallel worktrees & ports", Structure, Content maintenance (language count, availability, what not to promise), Screenshot provenance. Update the facts in the same PR as the change that alters them. Keep agent procedures out of README; they live in `.agents/`.
- Relative links between repo files; HTTPS for external links.
- Verify: `npx prettier --check docs README.md` (part of `npm run check`).
