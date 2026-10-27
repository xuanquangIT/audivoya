import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { site } from '../site.config.mjs';
import { port } from './worktree/ports.mjs';

const sitePort = port('SITE_PORT', {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
});
const base = `http://127.0.0.1:${sitePort}${site.base}`;

/** Resolves true once the preview answers, false when the deadline passes. */
async function isServing(deadline) {
  for (;;) {
    try {
      await fetch(base, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

await mkdir('artifacts', { recursive: true });
let serverProcess;
if (!(await isServing(0))) {
  // Reuses only this worktree's server: the port is unique per worktree slot.
  serverProcess = spawn(
    process.execPath,
    [fileURLToPath(new URL('./serve.mjs', import.meta.url))],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, SITE_PORT: String(sitePort) },
    },
  );
  if (!(await isServing(Date.now() + 10000))) {
    serverProcess.kill();
    throw new Error(`Preview server did not start on ${base}`);
  }
}

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

  await capture(base, 'artifacts/home-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(base, 'artifacts/home-mobile.png');
  await page.setViewportSize({ width: 640, height: 450 });
  await capture(base, 'artifacts/home-zoom-equivalent.png');
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(base + 'guide/', 'artifacts/guide-desktop.png');
  await capture(base + 'support/', 'artifacts/support-desktop.png');
  await capture(base + 'privacy/', 'artifacts/privacy-desktop.png');
  await capture(base + 'terms/', 'artifacts/terms-desktop.png');
} finally {
  await browser.close();
  if (serverProcess) serverProcess.kill();
}
