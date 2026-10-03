// Uses a disposable browser and owned media. Never reads an account profile or .env.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extension = process.argv[2];
if (!extension) throw new Error('Pass the extension dist/chromium directory.');
const manifest = JSON.parse(
  await readFile(path.join(extension, 'manifest.json'), 'utf8'),
);
const output = new URL('../public/assets/guide/', import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Owned media setup</title><body><h1>Audivoya setup</h1><p>Owned local media; no provider connected.</p><video controls></video></body></html>',
  );
}).listen(4181, '127.0.0.1');
const profile = await mkdtemp(path.join(tmpdir(), 'rd-site-capture-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: [
    '--disable-extensions-except=' + path.resolve(extension),
    '--load-extension=' + path.resolve(extension),
    '--enable-unsafe-extension-debugging',
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const source = await context.newPage();
  await source.goto('http://127.0.0.1:4181/');
  await source.bringToFront();
  const session = await context.browser().newBrowserCDPSession();
  const id = new URL(worker.url()).hostname;
  const sourceTarget = (
    await session.send('Target.getTargets', { filter: [{ type: 'tab' }] })
  ).targetInfos.find((target) => target.url === source.url());
  if (!sourceTarget) throw new Error('Owned source target missing');
  await session.send('Extensions.triggerAction', {
    id,
    targetId: sourceTarget.targetId,
  });
  let popup;
  for (let attempt = 0; attempt < 50 && !popup; attempt++) {
    popup = (await session.send('Target.getTargets')).targetInfos.find(
      (target) =>
        target.type === 'page' &&
        target.url === new URL('index.html', worker.url()).href,
    );
    if (!popup) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!popup) throw new Error('Actual action popup was not created');
  const attached = await session.send('Target.attachToTarget', {
    targetId: popup.targetId,
    flatten: false,
  });
  const pending = new Map();
  let sequence = 0;
  session.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== attached.sessionId) return;
    const packet = JSON.parse(event.message);
    const callback = pending.get(packet.id);
    if (!callback) return;
    clearTimeout(callback.timer);
    pending.delete(packet.id);
    if (packet.error) callback.reject(new Error('Popup operation failed'));
    else callback.resolve(packet.result);
  });
  const call = async (method, params = {}) => {
    const id = ++sequence;
    const result = new Promise((resolve, reject) =>
      pending.set(id, {
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.delete(id);
          reject(new Error('Popup timed out'));
        }, 5000),
      }),
    );
    await session.send('Target.sendMessageToTarget', {
      sessionId: attached.sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return result;
  };
  const evaluate = async (expression) =>
    (await call('Runtime.evaluate', { expression, returnByValue: true })).result
      .value;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      await evaluate(
        "document.getElementById('audio-source')?.textContent === '127.0.0.1'",
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (
    !(await evaluate(
      "document.getElementById('audio-source')?.textContent === '127.0.0.1' && document.getElementById('api-key').value === '' && document.getElementById('error').hidden",
    ))
  ) {
    console.log(
      await evaluate(
        "({source: document.getElementById('audio-source')?.textContent, status: document.getElementById('status')?.textContent, error: document.getElementById('error')?.textContent})",
      ),
    );
    throw new Error('Capture is not in a clean owned-media setup state');
  }
  const capture = async (selector, name) => {
    const bounds = await evaluate(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: 'start' }); const b = element.getBoundingClientRect(); const bottom = ${JSON.stringify(selector)} === '.app' ? document.querySelector('.controls').getBoundingClientRect().bottom : b.bottom; return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: bottom - b.top, scale: 1 }; })()`,
    );
    const shot = await call('Page.captureScreenshot', {
      format: 'png',
      clip: bounds,
      captureBeyondViewport: true,
    });
    await writeFile(new URL(name, output), Buffer.from(shot.data, 'base64'));
  };
  await capture('.controls', 'extension-setup.png');
  await capture('.app', 'extension-panel.png');
  await evaluate("document.getElementById('settings').open = true");
  await capture('#settings', 'extension-settings.png');
  await writeFile(
    new URL('capture.json', output),
    JSON.stringify(
      {
        captured: '2026-10-03',
        extension: manifest.version,
        name: manifest.name,
        browser: await context.browser().version(),
        mode: 'Real installed extension action popup, owned local page, setup only; no API key or provider requests',
        files: [
          'extension-setup.png',
          'extension-panel.png',
          'extension-settings.png',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Captured real extension setup and settings without credentials or uploads.',
  );
} finally {
  await context.close();
  server.close();
}

// Public documentation is accessible without signing in to a personal account.
if (process.argv.includes('--extension-only')) process.exit(0);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 820 },
  });
  await page.goto('https://ai.google.dev/gemini-api/docs/api-key', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page
    .getByRole('heading', { name: 'Using Gemini API keys', exact: true })
    .waitFor();
  await page
    .getByRole('heading', { name: 'Using Gemini API keys', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: new URL('google-key-docs.png', output).pathname.replace(
      /^\/(\w:)/,
      '$1',
    ),
  });
  console.log(
    'Captured Google public key documentation; no private dashboard used.',
  );
} finally {
  await browser.close();
}
