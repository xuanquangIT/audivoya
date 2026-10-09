import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { site } from '../site.config.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  async function capture(url, path) {
    await page.goto(url);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path, fullPage: true });
  }

  await capture(
    'http://127.0.0.1:4180' + site.base,
    'artifacts/home-desktop.png',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(
    'http://127.0.0.1:4180' + site.base,
    'artifacts/home-mobile.png',
  );
  await page.setViewportSize({ width: 640, height: 450 });
  await capture(
    'http://127.0.0.1:4180' + site.base,
    'artifacts/home-zoom-equivalent.png',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(
    'http://127.0.0.1:4180' + site.base + 'guide/',
    'artifacts/guide-desktop.png',
  );
  await capture(
    'http://127.0.0.1:4180' + site.base + 'support/',
    'artifacts/support-desktop.png',
  );
  await capture(
    'http://127.0.0.1:4180' + site.base + 'privacy/',
    'artifacts/privacy-desktop.png',
  );
  await capture(
    'http://127.0.0.1:4180' + site.base + 'terms/',
    'artifacts/terms-desktop.png',
  );
} finally {
  await browser.close();
}
