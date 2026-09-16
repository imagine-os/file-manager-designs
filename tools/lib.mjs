// Shared helpers for tools/*.mjs: locate Playwright + Chromium, start a static server.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  throw new Error('playwright not found. Run: cd tools && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright');
}

export function chromiumPath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const fixed = '/opt/pw-browsers/chromium';
  if (existsSync(fixed)) return fixed;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (d.startsWith('chromium-') && existsSync(p)) return p;
    }
  }
  return undefined; // let Playwright use its own default
}

export async function launch(pw) {
  return pw.chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

// Serve ROOT with python3 -m http.server on a free port. Returns { url, stop }.
export async function serve() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  const url = `http://127.0.0.1:${port}/`;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    try { const r = await fetch(url + 'designs/manifest.json'); if (r.ok) break; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error('http.server exited: ' + err);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => proc.kill() };
}

export async function readManifest() {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path.join(ROOT, 'designs', 'manifest.json'), 'utf8'));
}
