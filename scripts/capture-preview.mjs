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
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('html').evaluate((node) => (node.style.zoom = '2'));
  console.log(
    await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rootWidth: document.documentElement.clientWidth,
      overflow: [...document.querySelectorAll('body *')]
        .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 12)
        .map((node) => ({
          tag: node.tagName,
          class: node.className,
          right: node.getBoundingClientRect().right,
        })),
    })),
  );
  await page.screenshot({ path: 'artifacts/home-zoom.png' });
} finally {
  await browser.close();
}
