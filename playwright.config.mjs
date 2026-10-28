import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { site } from './site.config.mjs';
import { port } from './scripts/worktree/ports.mjs';

// Slot 0 (main checkout, CI) keeps 4180; each linked worktree gets its own port,
// so reusing an already-running local server can never test another worktree.
const sitePort = port('SITE_PORT', {
  cwd: fileURLToPath(new URL('./', import.meta.url)),
});
// Pin the resolved value so the webServer command and every worker agree.
process.env.SITE_PORT = String(sitePort);
const baseURL = `http://127.0.0.1:${sitePort}${site.base}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
