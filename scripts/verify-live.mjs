import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { site } from '../site.config.mjs';
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else files.push(file);
  }
  return files;
}
const files = (await walk('dist')).filter(
  (file) => path.basename(file) !== '.nojekyll',
);
for (const file of files) {
  const relative = path.relative('dist', file).replaceAll('\\', '/');
  const response = await fetch(site.origin + site.base + relative, {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    response.status,
    200,
    'Public resource unavailable: ' + relative,
  );
  const expected = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  const actual = createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex');
  assert.equal(actual, expected, 'Deployed content differs: ' + relative);
}
const browser = await chromium.launch();
const report = {
  date: '2026-10-03',
  origin: site.origin + site.base,
  matchedFiles: files.length,
  pages: [],
};
await mkdir('artifacts', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const external = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(site.origin + '/'))
        external.push(request.url());
    });
    for (const route of ['', 'guide/', 'privacy/', 'support/', 'terms/']) {
      const response = await page.goto(site.origin + site.base + route, {
        waitUntil: 'networkidle',
      });
      assert.equal(response.status(), 200);
      assert(await page.getByRole('heading', { level: 1 }).isVisible());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'Horizontal overflow: ' + route,
      );
      await page.locator('footer').scrollIntoViewIfNeeded();
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      assert.equal(external.length, 0, 'Unexpected external request');
      report.pages.push({
        width,
        route: route || '/',
        status: response.status(),
      });
    }
    await page.goto(site.origin + site.base, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: `artifacts/live-home-${width}.png`,
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  'artifacts/live-verification.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    status: 'passed',
    publicFilesMatched: files.length,
    browserPageChecks: report.pages.length,
    externalRequests: 0,
  }),
);
