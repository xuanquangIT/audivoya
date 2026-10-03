# Website security boundaries

The deployment contains static HTML/CSS/images and one local, optional progressive-enhancement script. Production has no npm runtime, backend, API key entry, contact form, cookie code, analytics, third-party fonts or third-party scripts. Neither build nor CI loads root environment files. Public links use HTTPS and new-tab links include `noopener noreferrer`. A no-referrer policy reduces outbound referrer disclosure.

Each page carries a restrictive meta CSP: no network connections, forms, objects, foreign scripts or base URL. GitHub Pages does not provide configurable response headers; meta CSP cannot enforce `frame-ancestors` or a response-level report-only policy. This site has no credential/payment UI to expose through framing. Hosting protections and request/IP processing are GitHub's responsibility and are disclosed in the policy. Do not describe this as absolute security.

The build copies only `public/` and known page templates to `dist`; deployment never uploads repository root, private extension source or development artifacts. The artifact check rejects secrets, maps, archives and unexpected inputs. Gitleaks checks Git history and the public build with redacted output, including the provider's authorization-key pattern. Screenshots are captured without actual credentials or personal account data. Browser tests enforce no external requests before a user follows a link and check that injected inline script is blocked by CSP.

GitHub Actions uses immutable action SHA pins, read-only default permissions, credential-free checkout, public-branch checks, short job timeouts and a separate Pages deployment job with only Pages/OIDC writes. Pull-request jobs cannot deploy. Gitleaks downloads are version- and SHA-256-pinned. Development-only Playwright and Prettier are exact versions; they do not ship in the website. Weekly dependency/action proposals require review.

Public repository visibility is intentional. Proprietary ownership and third-party screenshot attribution remain explicit. No published material should contain private provider output, account identities, screenshots of keys or unauthorized media artwork.

Send security reports privately to xuanquang.work.it@gmail.com with redacted reproducible evidence. There is no new paid AI security scan or assertion that previous budget-limited scans completed.
