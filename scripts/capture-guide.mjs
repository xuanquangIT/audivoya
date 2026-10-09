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
// Owned demo page: a generated canvas animation plus a quiet tone in a real
// <video>, so tab capture and the sync viewer have something to show. No remote
// media, third-party site or provider is involved.
const demoPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Owned media setup</title>
<style>html,body{margin:0;background:#0d171b;color:#edf4f1;font:16px/1.5 'Segoe UI',system-ui,sans-serif}main{max-width:960px;margin:0 auto;padding:28px 20px}h1{margin:0 0 4px;font-size:24px}p{margin:0 0 14px;color:#a2b4b9}video{display:block;width:100%;aspect-ratio:16/9;border-radius:14px;background:#0b1418}</style>
<body><main><h1>Audivoya setup</h1><p>Owned local media generated in this page; no provider connected.</p><video id="demo" controls></video></main>
<script>
const canvas = document.createElement('canvas');
canvas.width = 960; canvas.height = 540;
const ctx = canvas.getContext('2d');
function draw(now) {
  const t = now / 1000;
  const g = ctx.createLinearGradient(0, 0, 960, 540);
  g.addColorStop(0, '#0f2a33'); g.addColorStop(1, '#1d5a52');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 540);
  ctx.fillStyle = '#edf4f1'; ctx.font = '600 44px Segoe UI, sans-serif';
  ctx.fillText('Demo lecture', 60, 120);
  ctx.fillStyle = '#a2d9c2'; ctx.font = '24px Segoe UI, sans-serif';
  ctx.fillText('Generated locally · not a real video', 60, 162);
  for (let i = 0; i < 32; i++) {
    const h = 30 + 120 * Math.abs(Math.sin(t * 2 + i * 0.55));
    ctx.fillStyle = i % 2 ? '#7be5b8' : '#4fb08d';
    ctx.fillRect(60 + i * 27, 420 - h, 16, h);
  }
  ctx.fillStyle = '#edf4f1'; ctx.font = '20px Consolas, monospace';
  ctx.fillText('clip ' + t.toFixed(1) + ' s', 60, 500);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
const stream = canvas.captureStream(30);
const audio = new AudioContext();
const tone = audio.createOscillator();
const level = audio.createGain();
const sink = audio.createMediaStreamDestination();
level.gain.value = 0.02;
tone.frequency.value = 220;
tone.connect(level).connect(sink);
tone.start();
stream.addTrack(sink.stream.getAudioTracks()[0]);
const video = document.getElementById('demo');
video.srcObject = stream;
video.play().catch(() => {});
</script></body></html>`;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(demoPage);
}).listen(4181, '127.0.0.1');
const profile = await mkdtemp(path.join(tmpdir(), 'rd-site-capture-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [
    '--disable-extensions-except=' + path.resolve(extension),
    '--load-extension=' + path.resolve(extension),
    '--enable-unsafe-extension-debugging',
    '--autoplay-policy=no-user-gesture-required',
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
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: 'start' }); const b = element.getBoundingClientRect(); const bottom = ${JSON.stringify(selector)} === '.app' ? document.querySelector('.controls').getBoundingClientRect().bottom : b.bottom; const top = Math.max(0, b.top); return { x: b.left + scrollX, y: top + scrollY, width: b.width, height: Math.min(bottom, innerHeight) - top, scale: 1 }; })()`,
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

  // Real Start with sync window click, in Audio monitor so no key or provider
  // request is involved. The viewer is then captured from the actual window.
  await evaluate(
    "(() => { const mode = document.getElementById('session-mode'); mode.value = 'monitor'; mode.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('settings').open = false; })()",
  );
  const viewerPromise = context.waitForEvent('page', {
    predicate: (page) => page.url().includes('/sync.html#'),
    timeout: 15000,
  });
  await evaluate("document.getElementById('start-sync').click()");
  const viewer = await viewerPromise;
  await viewer.waitForLoadState('domcontentloaded');
  await viewer.waitForFunction(
    () => {
      const picture = document.getElementById('picture');
      return (
        picture instanceof HTMLCanvasElement &&
        picture.width > 0 &&
        document.getElementById('status')?.hidden === true
      );
    },
    undefined,
    { timeout: 20000 },
  );
  await viewer.waitForTimeout(1500);
  await viewer.screenshot({
    path: new URL('extension-sync.png', output).pathname.replace(
      /^\/(\w:)/,
      '$1',
    ),
  });
  await viewer.locator('#controls > summary').click();
  await viewer.waitForTimeout(600);
  await viewer.screenshot({
    path: new URL('extension-sync-controls.png', output).pathname.replace(
      /^\/(\w:)/,
      '$1',
    ),
  });
  await viewer.locator('#stop').click();
  await writeFile(
    new URL('capture.json', output),
    JSON.stringify(
      {
        captured: new Date().toISOString().slice(0, 10),
        extension: manifest.version,
        name: manifest.name,
        browser: await context.browser().version(),
        mode: 'Real installed extension action popup, cropped to its visible viewport, and the real sync viewer opened with Start with sync window in Audio monitor; owned generated page, setup only; no API key or provider requests',
        files: [
          'extension-setup.png',
          'extension-panel.png',
          'extension-settings.png',
          'extension-sync.png',
          'extension-sync-controls.png',
        ],
      },
      null,
      2,
    ) + '\n',
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
