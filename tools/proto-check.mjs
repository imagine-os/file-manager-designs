#!/usr/bin/env node
// Drives the Facet prototype (prototype/facet/) like software: loads it at two viewports,
// fails on console errors / failed requests, exercises every feature, records a walkthrough
// video and writes 2× screenshots.
//
//   node tools/proto-check.mjs            # exit 1 on any failed step
//   node tools/proto-check.mjs --no-video # skip the recording (faster)
import path from 'node:path';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ROOT, loadPlaywright, launch, serve } from './lib.mjs';

const noVideo = process.argv.includes('--no-video');
const PROTO = 'prototype/facet/';
const pw = await loadPlaywright();
const server = await serve();
const browser = await launch(pw);
const URL = server.url + PROTO;
const results = [];
function pass(name, detail) { results.push({ ok: true, name, detail }); console.log(`  ok    ${name}${detail ? '  (' + detail + ')' : ''}`); }
function fail(name, detail) { results.push({ ok: false, name, detail }); console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
async function step(name, fn) {
  try { const d = await fn(); pass(name, typeof d === 'string' ? d : ''); }
  catch (e) { fail(name, e.message.split('\n')[0]); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(page, log) {
  page.on('console', (m) => { if (m.type() === 'error') log.push('console: ' + m.text()); });
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => log.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()} ${r.url()}`); });
}
async function open(context, query = '?notour') {
  const page = await context.newPage();
  const log = [];
  watch(page, log);
  await page.goto(URL + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Facet && document.querySelectorAll('.face .row').length > 20);
  await sleep(400);
  return { page, log };
}
async function dragMouse(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await page.mouse.up();
}
const rot = (page) => page.evaluate(() => ({ rx: Facet.state.rot.rx, ry: Facet.state.rot.ry, snap: Facet.state.snap }));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

try {
  /* ---------------- 1. load at two viewports ---------------- */
  console.log('\nLoad');
  for (const vp of [{ width: 1440, height: 900 }, { width: 1200, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const { page, log } = await open(ctx, '');
    await step(`loads clean at ${vp.width}×${vp.height}`, async () => {
      await sleep(900);
      expect(log.length === 0, log.join(' | '));
      const info = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight,
        faces: [...document.querySelectorAll('.face')].map((f) => f.querySelectorAll('.fb .row').length),
        tourOpen: !document.getElementById('tut').hidden,
        minFont: Math.min(...[...document.querySelectorAll('.tb, .sb .nav a, .chip, .face .row, .insp, .sbar')].map((n) => parseFloat(getComputedStyle(n).fontSize)))
      }));
      expect(info.sw <= info.iw && info.sh <= info.ih, `page overflows: ${info.sw}×${info.sh} in ${info.iw}×${info.ih}`);
      expect(info.faces.length === 3 && info.faces.every((n) => n === 25), `faces have ${info.faces} rows`);
      expect(info.tourOpen, 'tour did not auto-open on first visit');
      expect(info.minFont >= 12.5, `UI text as small as ${info.minFont}px`);
      return `25 rows on each of 3 faces, tour auto-opened, min UI font ${info.minFont}px`;
    });
    await ctx.close();
  }

  /* ---------------- 2. drive it ---------------- */
  console.log('\nInteractions (1440×900)');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, log } = await open(ctx);
  const stage = await page.locator('#cube-stage').boundingBox();
  const c = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await step('drag rotates the cube and it settles on a clean orientation', async () => {
    const before = await rot(page);
    await page.mouse.move(c.x - 60, c.y + 120); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(c.x - 60 + i * 14, c.y + 120 - i * 6); await sleep(16); }
    const mid = await rot(page);
    expect(!near(mid.ry, before.ry, 3) || !near(mid.rx, before.rx, 3), `rotation did not change while dragging (${JSON.stringify(mid)})`);
    expect(mid.snap === 'free', 'snap should be free while dragging');
    await page.mouse.up();
    await sleep(1300);
    const after = await rot(page);
    expect(after.snap !== 'free', `did not settle (snap=${after.snap})`);
    expect(after.rx >= -90 && after.rx <= 0 && after.ry >= -90 && after.ry <= 0, 'rotation left the readable range');
    return `mid-drag ry ${mid.ry.toFixed(0)}°, settled on "${after.snap}"`;
  });

  await step('Front / Right / Top / Reset snap the cube', async () => {
    const want = { front: [0, 0], right: [0, -90], top: [-90, 0], iso: [-33, -42] };
    for (const k of ['front', 'right', 'top', 'iso']) {
      await page.click(`#cube-controls [data-snap="${k}"]`);
      await sleep(650);
      const r = await rot(page);
      expect(near(r.rx, want[k][0]) && near(r.ry, want[k][1]) && r.snap === k, `${k}: got ${JSON.stringify(r)}`);
      if (k === 'top') expect(await page.getAttribute('#cube', 'data-topmode') === 'rows', 'top face should show rows when square-on');
      if (k !== 'iso') { const z = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('cube')).getPropertyValue('--zoom'))); expect(z > 1.05, `face not enlarged when square-on (zoom ${z})`); }
    }
    expect(await page.getAttribute('#cube', 'data-topmode') === 'tiles', 'top face should show tiles at the isometric view');
  });

  await step('keyboard: 2 snaps Right, 0 resets, arrows nudge', async () => {
    await page.keyboard.press('2'); await sleep(600);
    expect((await rot(page)).snap === 'right', 'key 2 did not snap Right');
    await page.keyboard.press('0'); await sleep(600);
    expect((await rot(page)).snap === 'iso', 'key 0 did not reset');
    await page.keyboard.press('ArrowLeft'); await sleep(550);
    const r = await rot(page); expect(near(r.ry, -50), `ArrowLeft did not nudge (ry ${r.ry})`);
    await page.keyboard.press('0'); await sleep(600);
  });

  await step('clicking a file selects it on all three faces with connectors', async () => {
    await page.click('.face.front .fb .row[data-id="acme-sow-q3"]');
    await sleep(800);
    const s = await page.evaluate(() => ({
      sel: Facet.state.selected,
      faces: ['front', 'right', 'top'].map((f) => !!document.querySelector(`.face.${f} .sel[data-id="acme-sow-q3"]`)),
      paths: document.querySelectorAll('#connectors path').length,
      insp: document.getElementById('inspector').textContent
    }));
    expect(s.sel === 'acme-sow-q3', `selected is ${s.sel}`);
    expect(s.faces.every(Boolean), `highlighted on faces: ${s.faces}`);
    expect(s.paths >= 2, `${s.paths} connector paths`);
    expect(/Where it sits/.test(s.insp) && /Atlas/.test(s.insp) && /Acme/.test(s.insp) && /Contract/.test(s.insp), 'inspector missing axis values');
    return `highlighted on 3 faces, ${s.paths} connector lines`;
  });

  await step('changing an axis value moves the file to the new group (with Undo)', async () => {
    await page.selectOption('#inspector select[data-set="project"]', 'Legal');
    await sleep(700);
    expect(await page.$('.face.front .grp[data-group="Legal"] .row[data-id="acme-sow-q3"]'), 'file not in Legal group on the Project face');
    expect(!(await page.$('.face.front .grp[data-group="Atlas"] .row[data-id="acme-sow-q3"]')), 'file still listed under Atlas');
    expect(await page.isVisible('#toast') && /Moved/.test(await page.textContent('#toast')), 'no Undo toast');
    await page.click('#toast #undo-btn'); await sleep(600);
    expect(await page.$('.face.front .grp[data-group="Atlas"] .row[data-id="acme-sow-q3"]'), 'undo did not move it back');
    // set a value on an axis the file has none on: clear Quarter, then add it back through "Set a value on another axis"
    await page.selectOption('#inspector select[data-set="quarter"]', ''); await sleep(500);
    expect(await page.$('#add-axis'), '"Set a value on another axis" did not appear');
    await page.click('#add-axis'); await sleep(200);
    await page.click('#menu [data-act="quarter"]'); await sleep(200);
    await page.selectOption('#inspector select[data-set="quarter"]', 'Q4 2026'); await sleep(400);
    const q = await page.evaluate(() => Facet.data.files.find((f) => f.id === 'acme-sow-q3').axes.quarter);
    expect(q === 'Q4 2026', `quarter is ${q}`);
    await page.evaluate(() => Facet.setAxis('acme-sow-q3', 'quarter', 'Q3 2026', { silent: true }));
  });

  await step('a hidden axis can be swapped onto a face from the chip menu', async () => {
    await page.click('#chips-hidden .chip[data-axis="quarter"]'); await sleep(200);
    expect(await page.isVisible('#menu'), 'menu did not open');
    await page.click('#menu [data-act="face:top"]'); await sleep(700);
    const s = await page.evaluate(() => ({ top: Facet.state.faces.top, header: document.querySelector('.face.top .fh').textContent, hidden: document.getElementById('chips-hidden').textContent }));
    expect(s.top === 'quarter' && /By Quarter/.test(s.header), `top face shows ${s.header}`);
    expect(/Type/.test(s.hidden), 'Type did not move to the hidden chips');
    expect(await page.$('.face.top .sel[data-id="acme-sow-q3"]'), 'selection lost on the re-rendered face');
    await page.evaluate(() => Facet.showAxis('type', 'top', { silent: true })); await sleep(500);
  });

  await step('dragging a chip onto a face assigns the axis', async () => {
    const ok = await page.evaluate(() => new Promise((res) => {
      const chip = document.querySelector('#chips-hidden .chip[data-axis="person"]');
      const face = document.querySelector('.face.right');
      const dt = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      face.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
      const lit = face.classList.contains('drop');
      face.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
      chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      setTimeout(() => res({ lit, right: Facet.state.faces.right }), 500);
    }));
    expect(ok.lit, 'face did not highlight as a drop target');
    expect(ok.right === 'person', `right face is ${ok.right}`);
    await page.evaluate(() => Facet.showAxis('client', 'right', { silent: true })); await sleep(500);
  });

  await step('hovering a group lights the same files up on the other faces', async () => {
    await page.hover('.face.front .gh[data-group="Legal"]'); await sleep(150);
    const n = await page.evaluate(() => document.querySelectorAll('.face.right .row.lit').length);
    expect(n >= 4, `${n} rows lit on the Client face`);
    await page.mouse.move(c.x, c.y - 300);
  });

  await step('search dims non-matching files', async () => {
    await page.fill('#search', 'acme'); await sleep(200);
    const s = await page.evaluate(() => ({ dim: document.querySelectorAll('.face.front .row.dim').length, bright: document.querySelectorAll('.face.front .row:not(.dim)').length, bar: document.getElementById('sbar').textContent }));
    expect(s.dim > 10 && s.bright === 8, `${s.bright} bright / ${s.dim} dimmed`);
    expect(/8 of 25/.test(s.bar), 'status bar does not report matches');
    await page.fill('#search', ''); await sleep(200);
  });

  await step('Flat mode unfolds the front face into a 2D list and back', async () => {
    await page.click('#flat-btn'); await sleep(800);
    const s = await page.evaluate(() => ({ flat: Facet.state.flat, visible: !document.getElementById('flat').hidden, groups: document.querySelectorAll('#flat .grp').length, sel: !!document.querySelector('#flat .row.sel[data-id="acme-sow-q3"]'), pressed: document.getElementById('flat-btn').getAttribute('aria-pressed') }));
    expect(s.flat && s.visible && s.groups === 6 && s.sel && s.pressed === 'true', JSON.stringify(s));
    await page.keyboard.press('f'); await sleep(700);
    expect(!(await page.evaluate(() => Facet.state.flat)) && await page.isHidden('#flat'), 'flat did not fold back');
    return `${s.groups} groups in the flat list`;
  });

  await step('switching to Ledger keeps the selection and shows it in its one folder', async () => {
    await page.click('#view-seg [data-view="ledger"]'); await sleep(500);
    const s = await page.evaluate(() => ({
      view: Facet.state.view, hidden: document.getElementById('ledger-stage').hidden,
      focus: !!document.querySelector('.mrow.focus[data-file="acme-sow-q3"]'),
      cols: document.querySelectorAll('#cols .col').length,
      crumbs: document.getElementById('ledger-crumbs').textContent, path: document.getElementById('pathbar').textContent,
      insp: document.getElementById('inspector').textContent
    }));
    expect(s.view === 'ledger' && !s.hidden, 'ledger stage not shown');
    expect(s.focus, 'selected file not focused in Ledger');
    expect(s.cols === 4, `${s.cols} columns`);
    expect(/Contracts/.test(s.crumbs) && /Acme SOW Q3\.pdf/.test(s.path), 'breadcrumb/path bar wrong');
    expect(/Quick Look/.test(s.insp) && /Location/.test(s.insp), 'Quick Look pane missing');
    return `${s.cols} columns, Quick Look on`;
  });

  await step('selecting in Ledger selects the same file in Facet', async () => {
    await page.click('.mrow[data-folder="Projects/Atlas"]'); await sleep(300);
    await page.click('.mrow[data-file="q3-pricing"]'); await sleep(300);
    await page.keyboard.press('ArrowDown'); await sleep(200);
    const inLedger = await page.evaluate(() => Facet.state.selected);
    await page.keyboard.press('l'); await sleep(700);
    const s = await page.evaluate(() => ({ view: Facet.state.view, sel: Facet.state.selected, faces: ['front', 'right', 'top'].map((f) => !!document.querySelector(`.face.${f} .sel[data-id="${Facet.state.selected}"]`)) }));
    expect(s.view === 'facet' && s.sel === inLedger && s.faces.every(Boolean), JSON.stringify(s));
    return `${s.sel} selected in both`;
  });

  await step('Compare drawer opens with the full table', async () => {
    await page.click('#compare-btn'); await sleep(400);
    const s = await page.evaluate(() => ({ open: !document.getElementById('compare').hidden, rows: document.querySelectorAll('#compare tbody tr').length, text: document.getElementById('compare').textContent }));
    expect(s.open && s.rows === 8, `${s.rows} rows`);
    for (const t of ['different attribute', 'several groups', 'Learning curve', 'Keyboard speed', 'Predictability', 'Duplicates', 'Best for', 'Find every Acme document']) expect(s.text.includes(t), `missing row: ${t}`);
    return `${s.rows} rows`;
  });

  await step('"Show me in Ledger" opens Clients › Acme and explains the other folders', async () => {
    await page.click('#compare [data-demo="ledger"]'); await sleep(700);
    const s = await page.evaluate(() => ({ view: Facet.state.view, path: Facet.state.ledgerPath.join('/'), spots: document.querySelectorAll('#cols .mrow.spot').length, callout: document.getElementById('ledger-callout').hidden ? '' : document.getElementById('ledger-callout').textContent }));
    expect(s.view === 'ledger' && s.path === 'Clients/Acme', `view ${s.view}, path ${s.path}`);
    expect(s.spots === 2, `${s.spots} Acme files highlighted`);
    expect(/2 of 8/.test(s.callout) && /Legal › Acme/.test(s.callout), 'callout does not explain the split');
  });

  await step('"Show me in Facet" turns to the Client face and highlights the Acme group', async () => {
    await page.click('#compare-btn'); await sleep(300);
    await page.click('#compare [data-demo="facet"]'); await sleep(1500);
    const s = await page.evaluate(() => ({ view: Facet.state.view, snap: Facet.state.snap, face: Facet.faceOf('client'), spot: !!document.querySelector('.face .grp.spot[data-group="Acme"]'), callout: document.getElementById('callout').hidden ? '' : document.getElementById('callout').textContent }));
    expect(s.view === 'facet' && s.snap === s.face && s.spot, JSON.stringify(s));
    expect(/8 files/.test(s.callout), 'callout missing count');
    await page.keyboard.press('Escape'); await page.click('#cube-controls [data-snap="iso"]'); await sleep(600);
  });

  await step('theme toggles to light and back', async () => {
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#theme-btn'); await sleep(200);
    const s = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('facet.theme'), title: document.getElementById('theme-btn').title }));
    expect(s.t === 'light' && s.bg !== bg0 && s.stored === 'light' && /dark/.test(s.title), JSON.stringify(s));
    await page.click('#theme-btn'); await sleep(200);
    expect(await page.getAttribute('html', 'data-theme') === 'dark', 'did not return to dark');
  });

  /* ---- tutorial ---- */
  console.log('\nTutorial');
  await step('tour opens from the top bar and spotlights its target', async () => {
    await page.click('#tour-btn'); await sleep(500);
    const s = await page.evaluate(() => ({ open: !document.getElementById('tut').hidden, ring: !document.getElementById('tut-ring').hidden, step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent }));
    expect(s.open && s.ring && /1 \/ 10/.test(s.step), JSON.stringify(s));
    return s.title;
  });

  await step('tour panel drags by its header and stays in bounds', async () => {
    const h = await page.locator('#tut-h').boundingBox();
    const before = await page.locator('#tut').boundingBox();
    await dragMouse(page, { x: h.x + 60, y: h.y + h.height / 2 }, { x: h.x + 360, y: h.y + h.height / 2 - 250 });
    await sleep(100);
    const after = await page.locator('#tut').boundingBox();
    const dbg = await page.evaluate(() => JSON.stringify(FacetTour.position()) + ' style=' + document.getElementById('tut').style.top + ' h=' + document.getElementById('tut').offsetHeight);
    expect(Math.abs(after.x - before.x - 300) < 4 && Math.abs(after.y - before.y + 250) < 4, `moved by ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)} (before ${JSON.stringify(before)} after ${JSON.stringify(after)} ${dbg})`);
    const h2 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h2.x + 60, y: h2.y + h2.height / 2 }, { x: 1430, y: 890 });
    await sleep(100);
    const far = await page.locator('#tut').boundingBox();
    expect(far.x + far.width <= 1440 && far.y + far.height <= 900 && far.x >= 0 && far.y >= 0, `out of bounds: ${JSON.stringify(far)}`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('facet.tour.pos')));
    expect(stored && Math.abs(stored.left - far.x) < 2, 'position not remembered');
    return `moved to ${far.x.toFixed(0)},${far.y.toFixed(0)}, clamped in viewport`;
  });

  await step('tour panel collapses to a pill and expands again', async () => {
    const full = await page.locator('#tut').boundingBox();
    await page.click('#tut-collapse'); await sleep(250);
    const pill = await page.locator('#tut').boundingBox();
    expect(pill.height < 60 && pill.width < full.width && await page.isHidden('#tut-b'), `pill is ${pill.width}×${pill.height}`);
    await page.click('#tut-collapse'); await sleep(250);
    expect((await page.locator('#tut').boundingBox()).height > 200, 'did not expand');
    // put it back in the corner so it does not cover the cube
    const h = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h.x + 60, y: h.y + h.height / 2 }, { x: 80, y: 560 });
  });

  await step('every action step blocks Next until done, and "Do it for me" completes it', async () => {
    const titles = [];
    for (let i = 0; i < 10; i++) {
      const s = await page.evaluate(() => ({ step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, hasTask: !!document.getElementById('tut-task'), nextDisabled: document.getElementById('tut-next').disabled, doit: !!document.getElementById('tut-doit'), next: document.getElementById('tut-next').textContent }));
      expect(s.step.startsWith(`${i + 1} /`), `expected step ${i + 1}, at "${s.step}"`);
      titles.push(s.title);
      if (s.hasTask) {
        expect(s.nextDisabled && s.doit, `step ${i + 1}: Next should wait for the action`);
        await page.click('#tut-doit');
        await page.waitForFunction(() => !document.getElementById('tut-next').disabled, null, { timeout: 4000 });
        await sleep(700);
        expect(await page.evaluate(() => document.getElementById('tut-task').classList.contains('done')), `step ${i + 1}: task not marked done`);
      }
      if (i === 9) {
        expect(await page.evaluate(() => document.querySelectorAll('#tut .bcard').length) === 3, 'final step lacks the three "beyond the cube" cards');
        expect(s.next === 'Done', `last button says ${s.next}`);
      }
      await page.click('#tut-next'); await sleep(500);
    }
    expect(await page.isHidden('#tut'), 'tour did not close on Done');
    expect(await page.evaluate(() => localStorage.getItem('facet.tour.seen')) === '1', 'seen flag not stored');
    return titles.length + ' steps';
  });

  await step('a returning visitor does not get the tour again, ? reopens it', async () => {
    await page.reload({ waitUntil: 'load' }); await sleep(900);
    expect(await page.isHidden('#tut'), 'tour auto-opened on a return visit');
    await page.keyboard.press('?'); await sleep(300);
    expect(await page.isVisible('#tut'), '? did not open the tour');
    await page.keyboard.press('?'); await sleep(200);
  });

  await step('no console errors or failed requests during the whole run', async () => { expect(log.length === 0, log.slice(0, 5).join(' | ')); });
  await ctx.close();

  /* ---------------- 3. screenshots (2×) ---------------- */
  console.log('\nScreenshots');
  const shotsDir = path.join(ROOT, 'shots'); mkdirSync(shotsDir, { recursive: true });
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const sp = (await open(sctx)).page;
  await step('shots/facet-proto-*.png', async () => {
    await sp.evaluate(() => Facet.select('acme-sow-q3')); await sleep(1000);
    await sp.screenshot({ path: path.join(shotsDir, 'facet-proto-cube.png') });
    await sp.evaluate(() => Facet.setView('ledger')); await sleep(600);
    await sp.screenshot({ path: path.join(shotsDir, 'facet-proto-ledger.png') });
    await sp.evaluate(() => { Facet.setView('facet'); }); await sleep(400);
    await sp.evaluate(() => { try { localStorage.removeItem('facet.tour.pos'); } catch (e) {} FacetTour.open(3); }); await sleep(700);
    await sp.screenshot({ path: path.join(shotsDir, 'facet-proto-tutorial.png') });
    await sp.evaluate(() => { FacetTour.close(); Facet.openCompare(true); }); await sleep(500);
    await sp.screenshot({ path: path.join(shotsDir, 'facet-proto-compare.png') });
    return 'cube, ledger, tutorial, compare';
  });
  await sctx.close();

  /* ---------------- 4. walkthrough video ---------------- */
  if (!noVideo) {
    console.log('\nVideo');
    const vdir = path.join(ROOT, 'prototype', 'facet', '.video-tmp');
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
    const vp = (await open(vctx)).page;
    await step('record walkthrough', async () => {
      const ev = (js) => vp.evaluate(js);
      await sleep(900);
      // 1 rotate
      await dragMouse(vp, { x: 600, y: 620 }, { x: 760, y: 560 }, 30); await sleep(1400);
      // 2 select
      await vp.click('.face.front .fb .row[data-id="acme-sow-q3"]'); await sleep(1800);
      // 3 snap faces
      await vp.click('#cube-controls [data-snap="right"]'); await sleep(1600);
      await vp.click('#cube-controls [data-snap="top"]'); await sleep(1600);
      await vp.click('#cube-controls [data-snap="iso"]'); await sleep(1400);
      // 4 change a value
      await vp.selectOption('#inspector select[data-set="project"]', 'Legal'); await sleep(2200);
      await vp.click('#toast #undo-btn'); await sleep(1400);
      // 5 swap axis
      await vp.click('#chips-hidden .chip[data-axis="quarter"]'); await sleep(900);
      await vp.click('#menu [data-act="face:top"]'); await sleep(1800);
      // 6 flat
      await vp.click('#flat-btn'); await sleep(2200);
      await vp.click('#flat-btn'); await sleep(1200);
      // 7 ledger
      await vp.click('#view-seg [data-view="ledger"]'); await sleep(2400);
      await vp.click('.mrow[data-folder="Legal"]'); await sleep(1000);
      await vp.click('.mrow[data-folder="Legal/Acme"]'); await sleep(900);
      await vp.click('.mrow[data-file="acme-msa-v4"]'); await sleep(1600);
      await vp.click('#view-seg [data-view="facet"]'); await sleep(1800);
      // 8 compare + demos
      await vp.click('#compare-btn'); await sleep(1800);
      await vp.click('#compare [data-demo="ledger"]'); await sleep(2400);
      await vp.click('#compare-btn'); await sleep(800);
      await vp.click('#compare [data-demo="facet"]'); await sleep(2800);
      await vp.keyboard.press('Escape'); await vp.click('#cube-controls [data-snap="iso"]'); await sleep(900);
      // 9 tour
      await ev(() => { try { localStorage.removeItem('facet.tour.pos'); } catch (e) {} FacetTour.open(0); }); await sleep(2200);
      await vp.click('#tut-next'); await sleep(900);
      await vp.click('#tut-doit'); await sleep(1600); await vp.click('#tut-next'); await sleep(700);
      await vp.click('#tut-doit'); await sleep(1400); await vp.click('#tut-next'); await sleep(700);
      const h = await vp.locator('#tut-h').boundingBox();
      await dragMouse(vp, { x: h.x + 60, y: h.y + 20 }, { x: h.x + 420, y: h.y - 380 }, 24); await sleep(900);
      await ev(() => FacetTour.go(9)); await sleep(2200);
      // 10 light theme, end
      await vp.click('#theme-btn'); await sleep(1400);
      await vp.click('#theme-btn'); await sleep(500);
    });
    const video = vp.video();
    await vctx.close();
    await step('save prototype/facet/walkthrough.webm', async () => {
      const src = await video.path();
      const dest = path.join(ROOT, 'prototype', 'facet', 'walkthrough.webm');
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(src, dest);
      try { const { rmSync } = await import('node:fs'); rmSync(vdir, { recursive: true, force: true }); } catch {}
      const mb = statSync(dest).size / 1048576;
      expect(mb < 15, `video is ${mb.toFixed(1)} MB`);
      // convert to mp4 if an ffmpeg with an H.264 encoder exists (Playwright's bundled one only has VP8)
      const ff = ['ffmpeg', ...(existsSync('/opt/pw-browsers') ? (await import('node:fs')).readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('ffmpeg')).map((d) => `/opt/pw-browsers/${d}/ffmpeg-linux`) : [])];
      let mp4 = '';
      for (const bin of ff) {
        const enc = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
        if (enc.status !== 0 || !/libx264|h264/.test(enc.stdout)) continue;
        const out = dest.replace(/\.webm$/, '.mp4');
        const r = spawnSync(bin, ['-y', '-i', dest, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { encoding: 'utf8' });
        if (r.status === 0 && existsSync(out)) { mp4 = out; unlinkSync(dest); break; }
      }
      return `${mp4 ? 'walkthrough.mp4' : 'walkthrough.webm'} ${mb.toFixed(1)} MB${mp4 ? '' : ' (no H.264 encoder available, kept WebM)'}`;
    });
  }
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
