import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from '../site.config.mjs';
import { port } from './worktree/ports.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
// Main checkout and CI: 4180. Linked worktrees get their own slot port; an
// explicit SITE_PORT always wins (see .agents/workspace.json).
const listenPort = port('SITE_PORT', { cwd: projectRoot });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(site.base)) {
      response.writeHead(302, { Location: site.base });
      response.end();
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(site.base.length));
    let file = path.resolve(root, relative || 'index.html');
    if (file !== root && !file.startsWith(root + path.sep))
      throw new Error('Outside root');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
})
  .on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${listenPort} is already in use. Stop the other preview server or set SITE_PORT.`
        : `Preview server failed: ${error.message}`,
    );
    process.exit(1);
  })
  .listen(listenPort, '127.0.0.1', () =>
    console.log(`Preview: http://127.0.0.1:${listenPort}${site.base}`),
  );
