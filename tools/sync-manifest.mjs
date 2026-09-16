#!/usr/bin/env node
// Copies designs/manifest.json into the inline <script id="manifest"> block of
// index.html and every designs/*.html, so navigation works over file:// with the
// same data the live site fetches. Run after editing the manifest.
import path from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { ROOT } from './lib.mjs';

const manifest = JSON.parse(await readFile(path.join(ROOT, 'designs', 'manifest.json'), 'utf8'));
const json = JSON.stringify(manifest, null, 2);
const files = ['index.html', ...(await readdir(path.join(ROOT, 'designs'))).filter((f) => f.endsWith('.html')).map((f) => 'designs/' + f)];
const re = /(<script type="application\/json" id="manifest">\n)[\s\S]*?(\n<\/script>)/;
let changed = 0;
for (const f of files) {
  const p = path.join(ROOT, f);
  const src = await readFile(p, 'utf8');
  if (!re.test(src)) { console.warn(`skip ${f}: no inline manifest block`); continue; }
  const next = src.replace(re, `$1${json}$2`);
  if (next !== src) { await writeFile(p, next); changed++; console.log(`updated ${f}`); }
}
console.log(`${changed} file(s) updated`);
