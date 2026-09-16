#!/usr/bin/env node
// Capture every design's device frame to shots/<slug>.png (1440 CSS px wide, 2× scale)
// and a 720px-wide thumbnail to shots/thumb-<slug>.png.
//
//   node tools/screenshot.mjs            # all designs in designs/manifest.json
//   node tools/screenshot.mjs orbit loom # only these slugs
//   node tools/screenshot.mjs --no-thumbs
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ROOT, loadPlaywright, launch, serve, readManifest } from './lib.mjs';

const args = process.argv.slice(2);
const wantThumbs = !args.includes('--no-thumbs');
const only = args.filter((a) => !a.startsWith('--'));

const pw = await loadPlaywright();
const manifest = (await readManifest()).filter((d) => !only.length || only.includes(d.slug));
if (!manifest.length) { console.error('no matching designs'); process.exit(1); }

const server = await serve();
const browser = await launch(pw);
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1520, height: 1100 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('  pageerror:', e.message));
  for (const d of manifest) {
    const url = `${server.url}designs/${d.slug}.html`;
    const resp = await page.goto(url, { waitUntil: 'load' });
    if (!resp || !resp.ok()) { console.error(`✗ ${d.slug}: HTTP ${resp && resp.status()} for ${url}`); failed++; continue; }
    // Make the frame exactly 1440 CSS px wide so the screen renders at scale 1.
    await page.addStyleTag({ content: '.design main.wrap{max-width:1440px;padding-inline:0} .topnav{position:static}' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForFunction(() => {
      const s = document.querySelector('.viewport .screen');
      return s && Math.abs(parseFloat(getComputedStyle(s).getPropertyValue('--s')) - 1) < 0.002;
    }, null, { timeout: 5000 }).catch(() => console.warn(`  ${d.slug}: screen did not reach scale 1, capturing anyway`));
    await page.waitForTimeout(150);
    const device = await page.$('.device');
    if (!device) { console.error(`✗ ${d.slug}: no .device element`); failed++; continue; }
    const out = path.join(ROOT, d.shot || `shots/${d.slug}.png`);
    await device.screenshot({ path: out, type: 'png' });
    const box = await device.boundingBox();
    let msg = `✓ ${d.slug}: ${out.replace(ROOT + '/', '')} (${Math.round(box.width)}×${Math.round(box.height)} @2x)`;
    if (wantThumbs) {
      const thumb = path.join(path.dirname(out), 'thumb-' + path.basename(out));
      const buf = await makeThumb(browser, out, 720);
      await writeFile(thumb, buf);
      msg += ` + ${thumb.replace(ROOT + '/', '')}`;
    }
    console.log(msg);
  }
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);

// Downscale a PNG to `width` px using the browser's canvas (no native image libraries needed).
async function makeThumb(browser, file, width) {
  const { readFile } = await import('node:fs/promises');
  const b64 = (await readFile(file)).toString('base64');
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const dataUrl = await p.evaluate(async ({ src, width }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + src;
    await img.decode();
    const h = Math.round(img.naturalHeight * width / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = width; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, width, h);
    return c.toDataURL('image/png');
  }, { src: b64, width });
  await ctx.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
