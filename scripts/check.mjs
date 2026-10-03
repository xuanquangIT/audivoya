import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { site } from '../site.config.mjs';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    assert(
      !item.isSymbolicLink(),
      'Symlinks are not allowed in the public artifact',
    );
    if (item.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}
const files = await walk(root);
const credentials = [
  /AIza[\w-]{35}/,
  /AQ\.[\w-]{35,}/,
  /gh[pousr]_[\w]{30,}/,
  /github_pat_[\w]{40,}/,
  /sk-(?:proj-)?[\w-]{24,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  assert(
    !/(^|\/)\.env|\.map$|\.zip$|\.pem$|\.key$|(^|\/)(?:node_modules|\.git)\//.test(
      relative,
    ),
    'Forbidden deployment file: ' + relative,
  );
  assert(
    (await lstat(file)).size < 3 * 1024 * 1024,
    'Unexpectedly large asset: ' + relative,
  );
  if (!/\.(html|css|js|svg|json|xml|txt)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const pattern of credentials)
    assert(
      !pattern.test(text),
      'Credential-like value detected in ' + relative,
    );
  if (!file.endsWith('.html')) continue;
  assert(text.includes('Content-Security-Policy'), 'Missing CSP: ' + relative);
  assert(
    text.includes("connect-src 'none'") && text.includes("form-action 'none'"),
    'Unexpected network/form policy',
  );
  assert(
    !/<(?:iframe|form|input)\b|\son\w+=|<script(?![^>]*src=)/i.test(text),
    'Unexpected executable or input surface',
  );
  assert(
    !/\bBYOK\b|100% secure|zero latency|millisecond translation|unlimited dubbing|trusted by \d/i.test(
      text,
    ),
    'Unverified product claim',
  );
  const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML ID: ' + relative);
  for (const match of text.matchAll(/\b(href|src)="([^"]+)"/g)) {
    const value = match[2];
    if (/^(https:|mailto:)/.test(value)) continue;
    if (value.startsWith('#')) {
      assert(ids.includes(value.slice(1)), 'Missing local anchor ' + value);
      continue;
    }
    assert(value.startsWith(site.base), 'Broken deployment base: ' + value);
    const [route, hash] = value.slice(site.base.length).split('#');
    const target = path.join(
      root,
      route.endsWith('/') || !route ? route + 'index.html' : route,
    );
    const body = await readFile(target);
    if (hash)
      assert(
        body.toString().includes('id="' + hash + '"'),
        'Missing target anchor ' + value,
      );
  }
}
console.log(
  `Verified ${files.length} public files: links, anchors, CSP, claim boundaries and secret patterns.`,
);
