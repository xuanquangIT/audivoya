import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const logo = await readFile(
  new URL('../public/assets/icon.svg', import.meta.url),
  'utf8',
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html lang="en"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#fafbf6;color:#172b25;font:24px 'Segoe UI',sans-serif;padding:55px 65px}.brand{display:flex;align-items:center;gap:14px;font-size:24px;font-weight:650}.brand svg{width:45px;height:45px}.tag{margin-top:65px;font-size:13px;letter-spacing:2px;font-weight:650}h1{margin:20px 0 24px;font-size:76px;line-height:1.07;letter-spacing:-3px;font-weight:650}em{font-family:Georgia,serif;font-weight:400;color:#397958}.sub{font-size:19px;color:#53645d}.orb{position:absolute;right:70px;top:200px;width:240px;height:240px;border-radius:50%;background:#c6efd8;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:300}.foot{position:absolute;bottom:50px;font-size:13px;color:#53645d}</style><body><div class="brand">${logo}Realtime Dubbing</div><div class="tag">LISTEN BEYOND LANGUAGE</div><h1>A new language.<br>The same <em>curiosity.</em></h1><div class="sub">Website audio. Bilingual captions. Your listening controls.</div><div class="orb">↔</div><div class="foot">DESKTOP CHROME &amp; EDGE · STORE RELEASE COMING SOON</div></body></html>`,
  );
  await page.screenshot({ path: 'public/assets/social-card.png' });
} finally {
  await browser.close();
}
