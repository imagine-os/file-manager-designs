#!/usr/bin/env node
// Site checker. Loads index.html and every design page over a local static
// server and fails on: console errors, failed requests (404s etc.), broken
// internal links, missing prev/next on design pages, stale inline manifest or
// icon-sprite copies, text overflow inside the device frame, and horizontal
// page overflow at phone width (390px).
//
//   node tools/check.mjs          # compact report, exit 1 on any failure
//   node tools/check.mjs --verbose
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, loadPlaywright, launch, serve, readManifest } from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const pw = await loadPlaywright();
const manifest = await readManifest();
const manifestText = JSON.stringify(manifest);
const iconsSvg = await readFile(path.join(ROOT, 'assets', 'icons.svg'), 'utf8');
const canonicalIcons = symbolIds(iconsSvg);

const server = await serve();
const browser = await launch(pw);
const problems = []; // {page, kind, detail}
const okLinks = new Set();
const badLinks = new Map();
let pagesChecked = 0;

function report(page, kind, detail) { problems.push({ page, kind, detail }); }

async function linkOk(url) {
  if (okLinks.has(url)) return true;
  if (badLinks.has(url)) return false;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (r.ok) { okLinks.add(url); return true; }
    badLinks.set(url, r.status); return false;
  } catch (e) { badLinks.set(url, e.message); return false; }
}

try {
  const pages = ['index.html', 'prototype/facet/index.html', ...manifest.map((d) => `designs/${d.slug}.html`)];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  for (const rel of pages) {
    const page = await context.newPage();
    const url = server.url + rel;
    const isDesign = rel.startsWith('designs/');
    page.on('console', (m) => { if (m.type() === 'error') report(rel, 'console', m.text()); });
    page.on('pageerror', (e) => report(rel, 'pageerror', e.message));
    page.on('requestfailed', (r) => report(rel, 'request', `${r.url()} ${r.failure() && r.failure().errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) report(rel, 'http', `${r.status()} ${r.url().replace(server.url, '/')}`); });
    const resp = await page.goto(url, { waitUntil: 'load' });
    if (!resp || !resp.ok()) { report(rel, 'http', `page returned ${resp && resp.status()}`); await page.close(); continue; }
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(250); // let nav.js finish fetching the manifest
    pagesChecked++;

    // --- internal links
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => ({ raw: a.getAttribute('href'), abs: a.href, hidden: a.hasAttribute('hidden') })));
    for (const h of hrefs) {
      if (h.hidden || !h.raw || h.raw.startsWith('#') || !h.abs.startsWith(server.url)) continue;
      if (/^[a-z]+:/i.test(h.raw) && !h.raw.startsWith('http://127.0.0.1')) continue;
      const clean = h.abs.split('#')[0];
      if (!(await linkOk(clean))) report(rel, 'link', `${h.raw} → ${badLinks.get(clean)}`);
      // in-page anchors on the same document
      if (h.abs.includes('#') && clean === url.split('#')[0]) {
        const id = h.abs.split('#')[1];
        if (id && !(await page.$('#' + CSS_escape(id)))) report(rel, 'anchor', `#${id} not found`);
      }
    }
    // src/href of assets that are relative
    const assets = await page.$$eval('link[rel=stylesheet][href], script[src], img[src]', (els) => els.map((e) => e.href || e.src));
    for (const a of assets) if (a.startsWith(server.url) && !(await linkOk(a))) report(rel, 'asset', `${a.replace(server.url, '/')} → ${badLinks.get(a)}`);

    // --- inline manifest and sprite copies
    const inline = await page.$eval('#manifest', (s) => s.textContent).catch(() => null);
    if (inline === null) { if (!rel.startsWith('prototype/')) report(rel, 'manifest', 'no inline <script id="manifest">'); }
    else { try { if (JSON.stringify(JSON.parse(inline)) !== manifestText) report(rel, 'manifest', 'inline copy differs from designs/manifest.json (run tools/sync-manifest.mjs)'); } catch { report(rel, 'manifest', 'inline manifest is not valid JSON'); } }

    if (isDesign) {
      const slug = rel.replace(/^designs\/|\.html$/g, '');
      const ids = symbolIds(await page.content());
      const missing = canonicalIcons.filter((id) => !ids.includes(id));
      if (missing.length) report(rel, 'sprite', `inline sprite lacks: ${missing.join(', ')}`);
      const used = await page.$$eval('use', (us) => us.map((u) => (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace('#', '')));
      for (const u of new Set(used)) if (u && !ids.includes(u)) report(rel, 'sprite', `<use href="#${u}"> has no symbol`);

      // --- nav state
      const nav = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const a = (s) => { const n = q(s); return n ? { href: n.getAttribute('href'), hidden: n.hasAttribute('hidden'), text: n.textContent.trim() } : null; };
        return {
          prev: a('.topnav [data-nav=prev]'), next: a('.topnav [data-nav=next]'),
          pprev: a('.pager [data-nav=prev]'), pnext: a('.pager [data-nav=next]'),
          pos: q('.pos') ? q('.pos').textContent.trim() : null,
          jump: q('select.jump') ? q('select.jump').options.length : 0,
          slug: document.documentElement.getAttribute('data-slug'),
          title: document.title,
          scale: (() => { const s = q('.viewport .screen'); return s ? getComputedStyle(s).getPropertyValue('--s').trim() : null; })(),
        };
      });
      if (nav.slug !== slug) report(rel, 'nav', `data-slug="${nav.slug}" ≠ file name`);
      for (const k of ['prev', 'next', 'pprev', 'pnext']) {
        const n = nav[k];
        if (!n || n.hidden || !n.href || n.href === '#') report(rel, 'nav', `missing ${k} link`);
        else if (!n.text) report(rel, 'nav', `${k} link has no name`);
      }
      if (!nav.pos || !/^\d+\s*\/\s*\d+$/.test(nav.pos)) report(rel, 'nav', `position indicator is "${nav.pos}"`);
      if (nav.jump < manifest.length + 1) report(rel, 'nav', `jump menu has ${nav.jump} options, expected ≥ ${manifest.length + 1}`);
      if (!nav.scale || Number.isNaN(parseFloat(nav.scale))) report(rel, 'screen', 'screen has no --s scale (nav.js did not run?)');
      if (!manifest.some((d) => d.slug === slug)) report(rel, 'manifest', 'page has no manifest entry');

      // --- overflow inside the device frame
      const ov = await page.evaluate(overflowScan);
      for (const o of ov) report(rel, 'overflow', o);
    }
    await page.close();
  }
  // narrow viewport: the screen must scale down, never widen the page
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, deviceScaleFactor: 2 });
  for (const rel of pages) {
    const page = await phone.newPage();
    await page.goto(server.url + rel, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (w[0] > w[1] + 1) report(rel, 'narrow', `page is ${w[0]}px wide in a ${w[1]}px viewport (horizontal scroll)`);
    await page.close();
  }
  await phone.close();
  // manifest → page/shot existence
  for (const d of manifest) {
    for (const f of [`designs/${d.slug}.html`, d.shot || `shots/${d.slug}.png`, `shots/thumb-${d.slug}.png`]) {
      if (!(await linkOk(server.url + f))) report('manifest.json', 'missing', `${d.slug}: ${f} → ${badLinks.get(server.url + f)}`);
    }
  }
} finally {
  await browser.close();
  server.stop();
}

// --- report
const byPage = new Map();
for (const p of problems) { if (!byPage.has(p.page)) byPage.set(p.page, []); byPage.get(p.page).push(p); }
console.log(`checked ${pagesChecked} pages, ${okLinks.size} distinct URLs ok, ${problems.length} problem(s)`);
for (const [pg, list] of byPage) {
  console.log(`\n${pg}`);
  const shown = verbose ? list : list.slice(0, 12);
  for (const p of shown) console.log(`  [${p.kind}] ${p.detail}`);
  if (list.length > shown.length) console.log(`  … ${list.length - shown.length} more (use --verbose)`);
}
if (!problems.length) console.log('all clear');
process.exit(problems.length ? 1 : 0);

function symbolIds(htmlText) {
  return [...htmlText.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
}
function CSS_escape(s) { return s.replace(/([^\w-])/g, '\\$1'); }

// Runs in the page. Walks every element inside .device and flags:
//  - elements whose scrollWidth exceeds clientWidth by > 2px (content wider than its box),
//  - text-bearing elements whose box extends > 2px outside the device frame or outside
//    the nearest overflow-clipping ancestor (text that is visibly cut off).
// Positions are compared in screen pixels; the 1440×900 screen may be scaled.
function overflowScan() {
  const device = document.querySelector('.device');
  if (!device) return ['no .device element'];
  const out = [];
  const frame = device.getBoundingClientRect();
  const tol = 2;
  const screen = device.querySelector('.screen');
  const scale = screen ? parseFloat(getComputedStyle(screen).getPropertyValue('--s')) || 1 : 1;
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t) s += ` "${t.slice(0, 40)}${t.length > 40 ? '…' : ''}"`;
    return s;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const clips = (el) => { const o = getComputedStyle(el); return /(hidden|clip|scroll|auto)/.test(o.overflowX + ' ' + o.overflowY) || o.clipPath !== 'none'; };
  for (const el of device.querySelectorAll('*')) {
    if (el.closest('svg')) continue; // svg internals have no scrollWidth semantics
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // 1. content wider than its own box (only meaningful for elements that lay out text/children)
    // A container that clips (overflow hidden) and has no text of its own is a viewport for
    // decorative children (lenses, wells, gradients); its children are judged by rule 2 instead.
    const clipContainer = clips(el) && !hasOwnText(el) && cs.textOverflow !== 'ellipsis';
    if (el.tagName !== 'svg' && !clipContainer && el.scrollWidth - el.clientWidth > tol && el.clientWidth > 0) {
      if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') {
        out.push(`ellipsis-truncated ${label(el)} (${el.scrollWidth - el.clientWidth}px hidden)`);
      } else {
        out.push(`scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}: ${label(el)}`);
      }
    }
    // 2. text that is cut off by the frame or a clipping ancestor
    if (!hasOwnText(el)) continue;
    let clipRect = { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom };
    let a = el.parentElement;
    while (a && a !== device) {
      if (clips(a)) {
        const ar = a.getBoundingClientRect();
        clipRect = { left: Math.max(clipRect.left, ar.left), top: Math.max(clipRect.top, ar.top), right: Math.min(clipRect.right, ar.right), bottom: Math.min(clipRect.bottom, ar.bottom) };
      }
      a = a.parentElement;
    }
    const t = tol * scale + 0.5;
    const over = [];
    if (r.left < clipRect.left - t) over.push(`left ${Math.round((clipRect.left - r.left) / scale)}px`);
    if (r.right > clipRect.right + t) over.push(`right ${Math.round((r.right - clipRect.right) / scale)}px`);
    if (r.top < clipRect.top - t) over.push(`top ${Math.round((clipRect.top - r.top) / scale)}px`);
    if (r.bottom > clipRect.bottom + t) over.push(`bottom ${Math.round((r.bottom - clipRect.bottom) / scale)}px`);
    if (over.length) out.push(`clipped ${over.join(', ')}: ${label(el)}`);
  }
  return out;
}
