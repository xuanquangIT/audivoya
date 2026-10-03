import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { site } from '../site.config.mjs';
import { pages } from '../src/pages.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const destination = path.join(root, 'dist');
if (path.dirname(destination) !== root || path.basename(destination) !== 'dist')
  throw new Error('Unsafe build destination');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'public'), destination, {
  recursive: true,
  dereference: false,
});
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
const link = (route = '') => site.base + route;
const external = 'target="_blank" rel="noopener noreferrer"';
const nav = (active) =>
  [
    ['', 'Overview'],
    ['guide/', 'Setup guide'],
    ['support/', 'Support'],
  ]
    .map(
      ([route, label]) =>
        `<a href="${link(route)}" ${active === route ? 'aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
const header = (active) =>
  `<a class="skip" href="#main">Skip to content</a><header class="site-header"><div class="wrap nav-bar"><a class="wordmark" href="${link()}" aria-label="Audivoya home"><img src="${link('assets/icon.svg')}" width="34" height="34" alt="">Audivoya<span class="beta-label">Preview</span></a><nav aria-label="Main navigation">${nav(active)}</nav><a class="button small nav-cta" href="${link('guide/')}">Get started <span aria-hidden="true">↗</span></a></div></header>`;
const footer = `<footer class="site-footer"><div class="wrap footer-top"><div><a class="wordmark" href="${link()}"><img src="${link('assets/icon.svg')}" width="30" height="30" alt="">Audivoya</a><p>More understanding. Fewer language barriers.</p></div><nav aria-label="Footer navigation"><a href="${link('guide/')}">Setup guide</a><a href="${link('privacy/')}">Privacy</a><a href="${link('support/')}">Support</a><a href="${link('terms/')}">Terms</a></nav></div><div class="wrap footer-bottom"><span>© 2026 Quang Vu. All rights reserved.</span><span>Independent project. Not affiliated with Google, Microsoft or media websites.</span></div></footer>`;
const policy =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests";
for (const page of pages) {
  const canonical = site.origin + link(page.route);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${esc(page.title)}</title><meta name="description" content="${esc(page.description)}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${site.origin + link('assets/social-card.png')}"><meta property="og:image:alt" content="Audivoya — listen beyond language"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="${link('assets/icon.svg')}" type="image/svg+xml"><link rel="stylesheet" href="${link('assets/site.css')}"><script src="${link('assets/site.js')}" defer></script></head><body>${header(page.route)}<main id="main">${page.body}</main>${footer}</body></html>`;
  const folder = path.join(destination, page.route);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'index.html'), html);
}
await writeFile(
  path.join(destination, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${site.origin + link(page.route)}</loc><lastmod>${site.updated}</lastmod></url>`).join('')}</urlset>`,
);
await writeFile(path.join(destination, '.nojekyll'), '');
await writeFile(
  path.join(destination, '404.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Page not found · Audivoya</title><link rel="stylesheet" href="${link('assets/site.css')}"><main class="wrap document"><h1>That page is missing.</h1><p><a href="${link()}">Return to Audivoya</a></p></main></html>`,
);
console.log(`Built ${pages.length} public pages at ${site.origin + site.base}`);
