import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { site } from '../site.config.mjs';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto('http://127.0.0.1:4180' + site.base);
  await page.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 640, height: 450 });
  await page.screenshot({
    path: 'artifacts/home-zoom-equivalent.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:4180' + site.base + 'guide/');
  await page.screenshot({
    path: 'artifacts/guide-desktop.png',
    fullPage: true,
  });
} finally {
  await browser.close();
}
