#!/usr/bin/env node
// Drives the Nested cubes prototype (prototype/nested/) like software: loads it at two
// viewports, fails on console errors / failed requests / page overflow, opens groups into
// child cubes, walks the path of cubes back and forth, overrides axes, hits the depth guard,
// uses the mini-map, selects across levels, compares siblings, runs the tour with
// "Do it for me", toggles the theme and the strip, records a walkthrough video and writes
// 2× screenshots.
//
//   node tools/proto-check-nested.mjs            # exit 1 on any failed step
//   node tools/proto-check-nested.mjs --no-video # skip the recording (faster)
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ROOT, loadPlaywright, launch, serve } from './lib.mjs';

const noVideo = process.argv.includes('--no-video');
const PROTO = 'prototype/nested/';
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
const ANIM = 520; // the zoom animation is 420ms plus a short busy guard

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
  await page.waitForFunction(() => window.Proto && document.querySelectorAll('.level.current .face .row').length > 20);
  await sleep(400);
  return { page, log };
}
async function dragMouse(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await page.mouse.up();
}
const snap = (page) => page.evaluate(() => ({
  depth: Proto.depth, files: Proto.current().files.length, mode: Proto.current().mode, faces: Proto.current().faces,
  crumbs: document.querySelectorAll('#crumbs .crumb').length, minis: document.querySelectorAll('#crumbs .crumb .mini').length,
  visible: [...document.querySelectorAll('.level')].filter((l) => !l.classList.contains('away')).length,
  selected: Proto.state.selected
}));
// wait until any queued zoom animation has finished
const settle = async (page, extra = 120) => { await page.waitForFunction(() => !Proto.state.busy, null, { timeout: 5000 }); await sleep(extra); };
const inWindow = (r, w, h) => r.x >= -1 && r.y >= -1 && r.x + r.width <= w + 1 && r.y + r.height <= h + 1;

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
        faces: [...document.querySelectorAll('.level.current .face')].map((f) => f.querySelectorAll('.fb .row').length),
        tourOpen: !document.getElementById('tut').hidden,
        strip: document.querySelector('#proto-nav .pnav-pill[aria-current="page"]')?.textContent.trim(),
        crumbs: document.querySelectorAll('#crumbs .crumb').length,
        minimap: document.querySelectorAll('#minimap .mm').length,
        opens: document.querySelectorAll('.level.current .face .gh .open').length,
        minFont: Math.min(...[...document.querySelectorAll('.tb, .sb .nav a, .chip, .face .row, .insp, .sbar, .crumb, .crumb small, .minimap, .mm-l, .tb-where, .crumbs-l, .chips-l')].map((n) => parseFloat(getComputedStyle(n).fontSize)))
      }));
      expect(info.sw <= info.iw && info.sh <= info.ih, `page overflows: ${info.sw}×${info.sh} in ${info.iw}×${info.ih}`);
      expect(info.faces.length === 3 && info.faces.every((n) => n === 25), `faces have ${info.faces} rows`);
      expect(info.tourOpen, 'tour did not auto-open on first visit');
      expect(info.strip === 'Nested', `strip highlights "${info.strip}"`);
      expect(info.crumbs === 1 && info.minimap === 1, `root should show one crumb and one mini-map level (${info.crumbs}, ${info.minimap})`);
      expect(info.opens >= 15, `only ${info.opens} group headers carry an Open affordance`);
      expect(info.minFont >= 12, `UI text as small as ${info.minFont}px`);
      // the cube's toolbar, the mini-map and the path bar all fit inside the stage
      for (const sel of ['.level.current .cube-tools', '#minimap', '#crumbs-bar', '#chips']) {
        const r = await page.locator(sel).boundingBox();
        expect(r && inWindow(r, vp.width, vp.height), `${sel} leaves the viewport: ${JSON.stringify(r)}`);
      }
      const tools = await page.locator('.level.current .cube-tools').boundingBox(), mm = await page.locator('#minimap').boundingBox();
      expect(tools.x > mm.x + mm.width, 'toolbar overlaps the mini-map');
      return `25 rows × 3 faces, tour auto-opened, ${info.opens} Open affordances, min font ${info.minFont}px`;
    });
    await ctx.close();
  }

  /* ---------------- 2. drive it ---------------- */
  console.log('\nInteractions (1440×900)');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, log } = await open(ctx);

  await step('Open ▸ on Client · Acme opens a child cube of 8 files on three other axes', async () => {
    const hdr = page.locator('.level.current .face.right .gh[data-group="Acme"]');
    await hdr.hover(); await sleep(150);
    const vis = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.level.current .face.right .gh[data-group="Acme"] .open')).opacity));
    expect(vis > 0.9, `Open affordance not revealed on hover (opacity ${vis})`);
    const t0 = Date.now();
    await hdr.locator('.open').click();
    // mid-animation: both levels are in flight
    await sleep(120);
    const mid = await page.evaluate(() => ({ flipping: document.querySelectorAll('.level.flip').length, t: document.querySelector('.level[data-depth="1"]').style.transform }));
    await page.waitForFunction(() => !Proto.state.busy, null, { timeout: 3000 });
    await sleep(100);
    const s = await snap(page);
    expect(s.depth === 2 && s.files === 8 && s.mode === 'cube', `depth ${s.depth}, ${s.files} files, ${s.mode}`);
    expect(!Object.values(s.faces).includes('client'), `child faces reuse Client: ${JSON.stringify(s.faces)}`);
    expect(new Set(Object.values(s.faces)).size === 3, 'child faces are not three distinct axes');
    expect(s.crumbs === 2 && s.minis === 2, `${s.crumbs} crumbs / ${s.minis} mini cubes`);
    expect(s.visible === 1, `${s.visible} levels visible after the zoom`);
    expect(mid.flipping === 2 && /scale/.test(mid.t), `FLIP transforms not applied mid-animation (${mid.flipping} flipping, "${mid.t}")`);
    const fixed = await page.evaluate(() => [...document.querySelectorAll('#chips-fixed .chip')].map((c) => c.getAttribute('data-fixed')));
    expect(fixed.join() === 'client', `fixed chips: ${fixed}`);
    expect(!(await page.$('#chips-hidden [data-axis="client"]')), 'Client is still offered as a free axis');
    expect(/Acme/.test(await page.textContent('#tb-where')), 'top bar does not show the path');
    return `${Date.now() - t0}ms, faces ${Object.values(s.faces).join(' × ')}`;
  });

  await step('double-clicking Type · Contract drills to depth 3 with the path fixed', async () => {
    const face = await page.evaluate(() => Proto.cube.faceOf('type'));
    expect(face, 'Type is not on the child cube');
    await page.dblclick(`.level.current .face.${face} .gh[data-group="Contract"] b`);
    await page.waitForFunction(() => !Proto.state.busy, null, { timeout: 3000 }); await sleep(100);
    const s = await snap(page);
    expect(s.depth === 3 && s.files === 4 && s.crumbs === 3, `depth ${s.depth}, ${s.files} files, ${s.crumbs} crumbs`);
    expect(!['client', 'type'].some((a) => Object.values(s.faces).includes(a)), `grandchild reuses a path axis: ${JSON.stringify(s.faces)}`);
    const used = await page.evaluate(() => Proto.current().used);
    expect(used.join() === 'client,type', `used axes ${used}`);
    expect((await page.evaluate(() => document.querySelectorAll('#minimap .mm').length)) === 3, 'mini-map does not show three nested levels');
    return `faces ${Object.values(s.faces).join(' × ')}`;
  });

  await step('clicking a cube in the path zooms back out and highlights the group it came from', async () => {
    await page.click('#crumbs .crumb[data-depth="2"]');
    await sleep(80);
    const spot = await page.evaluate(() => !!document.querySelector('.level[data-depth="2"] .grp.spot[data-group="Contract"], .level[data-depth="2"] .tile.spot[data-group="Contract"]'));
    await page.waitForFunction(() => !Proto.state.busy, null, { timeout: 3000 }); await sleep(120);
    const s = await snap(page);
    expect(s.depth === 2 && s.crumbs === 2 && s.visible === 1, `depth ${s.depth}, ${s.crumbs} crumbs, ${s.visible} visible`);
    expect(spot, 'the Contract group was not highlighted on the way back');
    expect((await page.evaluate(() => document.querySelectorAll('.level').length)) === 2, 'the child level was not destroyed');
  });

  await step('Backspace goes up one level', async () => {
    await page.evaluate(() => Proto.open('type', 'Contract')); await settle(page);
    expect((await snap(page)).depth === 3, 'could not reopen Contract');
    await page.keyboard.press('Backspace'); await settle(page);
    const s = await snap(page);
    expect(s.depth === 2, `depth ${s.depth} after Backspace`);
  });

  await step('a free chip overrides a child face; path axes are never offered', async () => {
    const before = await page.evaluate(() => Object.assign({}, Proto.current().faces));
    const free = await page.evaluate(() => [...document.querySelectorAll('#chips-hidden .chip')].map((c) => c.getAttribute('data-axis')));
    expect(free.length && !free.includes('client'), `free chips: ${free}`);
    await page.click(`#chips-hidden .chip[data-axis="${free[0]}"]`); await sleep(200);
    expect(await page.isVisible('#menu'), 'menu did not open');
    await page.click('#menu [data-act="face:top"]'); await sleep(600);
    const s = await snap(page);
    expect(s.faces.top === free[0], `top face is ${s.faces.top}, wanted ${free[0]}`);
    const shown = await page.evaluate(() => [...document.querySelectorAll('#chips-shown .chip')].map((c) => c.getAttribute('data-axis')));
    expect(shown.includes(free[0]) && !shown.includes(before.top), `chips show ${shown}`);
    expect(/By /.test(await page.textContent('.level.current .face.top .fh')), 'top face header missing');
    // the mini cube in the path picks up the new colour
    const col = await page.evaluate((id) => { const ax = SHARED_DATA.axesById[id]; const t = document.querySelector('#crumbs .crumb.current .mini .mf.t'); return t.style.getPropertyValue('--c').trim() === ax.color; }, free[0]);
    expect(col, 'the current crumb did not recolour');
    // and drag-and-drop still works for a different free axis
    const ok = await page.evaluate(() => new Promise((res) => {
      const chip = document.querySelector('#chips-hidden .chip'); const face = document.querySelector('.level.current .face.right');
      const dt = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      face.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, cancelable: true }));
      const lit = face.classList.contains('drop');
      face.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, cancelable: true }));
      chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      setTimeout(() => res({ lit, right: Proto.current().faces.right, axis: chip.getAttribute('data-axis') }), 500);
    }));
    expect(ok.lit && ok.right === ok.axis, `drop: ${JSON.stringify(ok)}`);
    return `top ← ${free[0]}, right ← ${ok.axis}`;
  });

  await step('depth guard: a group with too few axes left opens as a flat list', async () => {
    await page.evaluate(() => Proto.open('type', 'Contract')); await settle(page);
    const face = await page.evaluate(() => Proto.cube && Proto.cube.faceOf('person'));
    if (!face) await page.evaluate(() => Proto.showAxis('person', 'front', { immediate: true })); await sleep(300);
    const hdrText = await page.evaluate(() => document.querySelector(`.level.current .face.${Proto.cube.faceOf('person')} .gh[data-group="Justin"] .open`)?.textContent);
    expect(/List/.test(hdrText || ''), `the Justin header should say List, says "${hdrText}"`);
    await page.evaluate(() => Proto.open('person', 'Justin')); await settle(page);
    const s = await snap(page);
    expect(s.depth === 4 && s.mode === 'list' && s.files === 1, `depth ${s.depth}, ${s.mode}, ${s.files} files`);
    const lp = await page.evaluate(() => ({ vis: !!document.querySelector('.level.current .listpanel'), rows: document.querySelectorAll('.level.current .lp-row').length, why: document.querySelector('.level.current .lp-why')?.textContent || '', chips: document.getElementById('chips-shown').textContent, crumbList: !!document.querySelector('#crumbs .crumb.current .mini.list'), compare: document.getElementById('compare-btn').disabled }));
    expect(lp.vis && lp.rows === 1 && /Only one file/.test(lp.why), `list panel: ${JSON.stringify(lp)}`);
    expect(/Flat list/.test(lp.chips) && lp.crumbList && lp.compare, 'chrome does not reflect list mode');
    await page.click('.level.current .lp-row'); await sleep(200);
    expect((await snap(page)).selected === 'acme-msa-v4', 'selecting in the list did not select');
    await page.evaluate(() => Proto.select(null));
    // Home returns to the root
    await page.keyboard.press('Home'); await settle(page);
    const r = await snap(page);
    expect(r.depth === 1 && r.crumbs === 1 && (await page.evaluate(() => document.querySelectorAll('.level').length)) === 1, `Home left depth ${r.depth}, ${r.crumbs} crumbs`);
  });

  await step('mini-map draws the nesting; clicking a level zooms there', async () => {
    await page.evaluate(() => Proto.open('client', 'Acme')); await settle(page);
    await page.evaluate(() => Proto.open('type', 'Contract')); await settle(page);
    const mm = await page.evaluate(() => ({ n: document.querySelectorAll('#minimap .mm').length, nested: !!document.querySelector('#minimap .mm[data-depth="1"] .mm[data-depth="2"] .mm[data-depth="3"]'), cur: document.querySelector('#minimap .mm.current')?.getAttribute('data-depth'), labels: [...document.querySelectorAll('#minimap .mm-l b')].map((b) => b.textContent) }));
    expect(mm.n === 3 && mm.nested && mm.cur === '3', JSON.stringify(mm));
    expect(mm.labels.join('›') === 'Northwind›Acme›Contract', `labels ${mm.labels}`);
    await page.click('#minimap .mm-l[data-depth="1"]'); await settle(page);
    expect((await snap(page)).depth === 1, 'mini-map click did not zoom to the root');
    return mm.labels.join(' › ');
  });

  await step('selection carries across levels: dot on each mini cube, path in the inspector, Show in root', async () => {
    await page.evaluate(() => Proto.open('client', 'Acme')); await settle(page);
    await page.evaluate(() => Proto.open('type', 'Contract')); await settle(page);
    const face = await page.evaluate(() => { const c = Proto.cube; return Object.keys(c.state.faces).find((f) => c.state.faces[f] !== c.state.faces.top) || 'front'; });
    await page.click(`.level.current .face.${face} .fb .row[data-id="acme-sow-q3"]`); await sleep(500);
    const s = await page.evaluate(() => ({
      sel: Proto.state.selected, dots: document.querySelectorAll('#crumbs .crumb .sdot').length,
      onAll: [1, 2, 3].every((d) => Proto.cubeAt(d).state.selected === 'acme-sow-q3'),
      insp: document.getElementById('inspector').textContent,
      pathSteps: [...document.querySelectorAll('#inspector .pathline .step b')].map((b) => b.textContent),
      pills: document.querySelectorAll('#inspector .tags .pill').length,
      showRoot: !!document.querySelector('#inspector [data-show-root]')
    }));
    expect(s.sel === 'acme-sow-q3', `selected ${s.sel}`);
    expect(s.dots === 3, `${s.dots} dots on the mini cubes`);
    expect(s.onAll, 'the file is not selected on every cube of the path');
    expect(s.pathSteps.join(' › ') === 'Northwind › Acme › Contract › Acme SOW Q3.pdf', `path reads ${s.pathSteps.join(' › ')}`);
    expect(s.pills >= 5 && /Also belongs to/.test(s.insp) && /Project · Atlas/.test(s.insp), 'other memberships missing');
    expect(s.showRoot, 'no Show in root button');
    await page.click('#inspector [data-show-root]'); await settle(page, 400);
    const r = await page.evaluate(() => ({ depth: Proto.depth, sel: Proto.state.selected, spot: document.querySelectorAll('.level.current .face .row.spot[data-id="acme-sow-q3"]').length, selRows: document.querySelectorAll('.level.current .face .row.sel[data-id="acme-sow-q3"]').length, dots: document.querySelectorAll('#crumbs .sdot').length }));
    expect(r.depth === 1 && r.sel === 'acme-sow-q3', `after Show in root: depth ${r.depth}, selected ${r.sel}`);
    expect(r.spot >= 2 && r.selRows === 3, `${r.spot} spotlit rows, ${r.selRows} selected rows on the root`);
    expect(r.dots === 1, `${r.dots} dots at the root`);
    return `path ${s.pathSteps.join(' › ')}`;
  });

  await step('Compare siblings puts Acme beside Globex as two cubes that turn together', async () => {
    expect(await page.evaluate(() => document.getElementById('compare-btn').disabled), 'Compare should be disabled at the root');
    await page.evaluate(() => Proto.open('client', 'Acme')); await settle(page);
    await page.click('#compare-btn'); await sleep(500);
    const s = await page.evaluate(() => ({
      open: !!document.getElementById('compare'), cubes: document.querySelectorAll('#compare .cmp-stage .cube').length,
      a: Proto.state.compare.a.state.files.length, b: Proto.state.compare.b.state.files.length, sib: Proto.state.compare.sibling.value,
      sameFaces: JSON.stringify(Proto.state.compare.a.state.faces) === JSON.stringify(Proto.state.compare.b.state.faces) && JSON.stringify(Proto.state.compare.a.state.faces) === JSON.stringify(Proto.current().faces),
      hiddenMain: Proto.current().stageEl.hidden, pressed: document.getElementById('compare-btn').getAttribute('aria-pressed'),
      head: document.querySelector('#compare .cmp-h').textContent, options: document.querySelectorAll('#cmp-pick option').length,
      selSynced: !!document.querySelector('#cmp-a .row.sel[data-id="acme-sow-q3"]')
    }));
    expect(s.open && s.cubes === 2, `compare has ${s.cubes} cubes`);
    expect(s.a === 8 && s.b === 4 && s.sib === 'Globex', `Acme ${s.a} vs ${s.sib} ${s.b}`);
    expect(s.sameFaces && s.hiddenMain && s.pressed === 'true', JSON.stringify(s));
    expect(/Acme vs Globex/.test(s.head) && s.options === 2, 'header / sibling picker wrong');
    expect(s.selSynced, 'selection not carried into the compare cube');
    // both fit side by side without overflowing the stage
    const [ra, rb, st] = await Promise.all([page.locator('#cmp-a .cube').boundingBox(), page.locator('#cmp-b .cube').boundingBox(), page.locator('#levels').boundingBox()]);
    expect(ra.x + ra.width <= rb.x + 4 && rb.x + rb.width <= st.x + st.width + 1, 'compare cubes overlap or overflow');
    // sync: snap one, the other follows; drag one, the other follows
    await page.click('#compare .cmp-tools [data-snap="right"]'); await sleep(650);
    const rot = await page.evaluate(() => ({ a: Proto.state.compare.a.state.snap, b: Proto.state.compare.b.state.snap, ry: Proto.state.compare.b.state.rot.ry }));
    expect(rot.a === 'right' && rot.b === 'right' && Math.abs(rot.ry + 90) < 1, `sync after snap: ${JSON.stringify(rot)}`);
    await page.keyboard.press('0'); await sleep(650);
    const cb = await page.locator('#cmp-b').boundingBox();
    await dragMouse(page, { x: cb.x + cb.width / 2 - 40, y: cb.y + cb.height / 2 + 100 }, { x: cb.x + cb.width / 2 + 60, y: cb.y + cb.height / 2 + 60 }, 12);
    await sleep(1300);
    const rot2 = await page.evaluate(() => ({ a: Proto.state.compare.a.state.rot, b: Proto.state.compare.b.state.rot }));
    expect(Math.abs(rot2.a.rx - rot2.b.rx) < 0.6 && Math.abs(rot2.a.ry - rot2.b.ry) < 0.6, `cubes drifted apart: ${JSON.stringify(rot2)}`);
    // pick the other sibling
    await page.selectOption('#cmp-pick', 'Internal'); await sleep(400);
    expect((await page.evaluate(() => Proto.state.compare.b.state.files.length)) === 13, 'switching the sibling did not rebuild the cube');
    await page.click('#compare-close'); await sleep(300);
    const c = await page.evaluate(() => ({ gone: !document.getElementById('compare'), main: !Proto.current().stageEl.hidden, pressed: document.getElementById('compare-btn').getAttribute('aria-pressed'), depth: Proto.depth }));
    expect(c.gone && c.main && c.pressed === 'false' && c.depth === 2, JSON.stringify(c));
    return 'Acme 8 vs Globex 4, snapped and dragged in sync, closed';
  });

  await step('keyboard: Enter opens the focused group, Esc goes up, 1/2/3/0 snap, C compares', async () => {
    await page.evaluate(() => Proto.home()); await settle(page);
    await page.click('.level.current .face.right .gh[data-group="Acme"] b'); await sleep(150);
    expect(await page.evaluate(() => !!document.querySelector('.level.current .grp.focus[data-group="Acme"]')), 'click did not focus the group');
    await page.keyboard.press('Enter'); await settle(page);
    expect((await snap(page)).depth === 2, 'Enter did not open the focused group');
    await page.keyboard.press('2'); await sleep(600);
    expect((await page.evaluate(() => Proto.cube.state.snap)) === 'right', 'key 2 did not snap the child cube');
    await page.keyboard.press('0'); await sleep(600);
    expect((await page.evaluate(() => Proto.cube.state.snap)) === 'iso', 'key 0 did not reset');
    await page.keyboard.press('c'); await sleep(400);
    expect(await page.evaluate(() => !!Proto.state.compare), 'C did not open compare');
    await page.keyboard.press('Escape'); await sleep(300);
    expect(await page.evaluate(() => !Proto.state.compare), 'Esc did not close compare');
    await page.keyboard.press('Escape'); await settle(page);
    expect((await snap(page)).depth === 1, 'Esc did not go up one level');
    // hover + Enter also works
    await page.hover('.level.current .face.front .gh[data-group="Legal"]'); await sleep(100);
    await page.keyboard.press('Enter'); await settle(page);
    const s = await snap(page);
    expect(s.depth === 2 && (await page.evaluate(() => Proto.current().label)) === 'Legal', `hover + Enter opened ${JSON.stringify(s)}`);
    await page.keyboard.press('Home'); await settle(page);
    expect((await snap(page)).depth === 1, 'Home did not return to the root');
  });

  await step('theme toggles to light and back', async () => {
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#theme-btn'); await sleep(200);
    const s = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('nested.theme'), title: document.getElementById('theme-btn').title }));
    expect(s.t === 'light' && s.bg !== bg0 && s.stored === 'light' && /dark/.test(s.title), JSON.stringify(s));
    await page.click('#theme-btn'); await sleep(200);
    expect(await page.getAttribute('html', 'data-theme') === 'dark', 'did not return to dark');
  });

  /* ---- tour ---- */
  console.log('\nTour');
  await step('tour opens from the top bar and spotlights the Acme group', async () => {
    await page.click('#tour-btn'); await sleep(500);
    const s = await page.evaluate(() => ({ open: !document.getElementById('tut').hidden, ring: !document.getElementById('tut-ring').hidden, step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, n: document.querySelectorAll('#tut-dots i').length }));
    expect(s.open && s.ring && /1 \/ 7/.test(s.step) && s.n === 7, JSON.stringify(s));
    return s.title;
  });

  await step('tour panel drags by its header and stays in bounds', async () => {
    const h = await page.locator('#tut-h').boundingBox();
    const before = await page.locator('#tut').boundingBox();
    await dragMouse(page, { x: h.x + 60, y: h.y + h.height / 2 }, { x: h.x + 360, y: h.y + h.height / 2 - 250 });
    await sleep(100);
    const after = await page.locator('#tut').boundingBox();
    expect(Math.abs(after.x - before.x - 300) < 4 && Math.abs(after.y - before.y + 250) < 4, `moved by ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}`);
    const h2 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h2.x + 60, y: h2.y + h2.height / 2 }, { x: 1430, y: 890 });
    await sleep(100);
    const far = await page.locator('#tut').boundingBox();
    expect(far.x + far.width <= 1440 && far.y + far.height <= 900 && far.x >= 0 && far.y >= 0, `out of bounds: ${JSON.stringify(far)}`);
    const h3 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h3.x + 60, y: h3.y + h3.height / 2 }, { x: 1300, y: 400 });
  });

  await step('every action step blocks Next until done, and "Do it for me" completes it', async () => {
    const titles = [];
    for (let i = 0; i < 7; i++) {
      const s = await page.evaluate(() => ({ step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, hasTask: !!document.getElementById('tut-task'), nextDisabled: document.getElementById('tut-next').disabled, doit: !!document.getElementById('tut-doit'), next: document.getElementById('tut-next').textContent }));
      expect(s.step.startsWith(`${i + 1} /`), `expected step ${i + 1}, at "${s.step}"`);
      titles.push(s.title);
      if (s.hasTask) {
        expect(s.nextDisabled && s.doit, `step ${i + 1}: Next should wait for the action`);
        await page.click('#tut-doit');
        await page.waitForFunction(() => !document.getElementById('tut-next').disabled, null, { timeout: 6000 });
        await sleep(700);
        expect(await page.evaluate(() => document.getElementById('tut-task').classList.contains('done')), `step ${i + 1}: task not marked done`);
      }
      if (i === 6) expect(s.next === 'Done', `last button says ${s.next}`);
      await page.click('#tut-next'); await sleep(600);
    }
    expect(await page.isHidden('#tut'), 'tour did not close on Done');
    expect(await page.evaluate(() => localStorage.getItem('nested.tour.seen')) === '1', 'seen flag not stored');
    const end = await snap(page);
    expect(end.depth === 1 && end.selected === 'acme-sow-q3', `tour should end on the root with the file selected (depth ${end.depth}, ${end.selected})`);
    return titles.length + ' steps: ' + titles.join(' / ');
  });

  await step('a returning visitor does not get the tour again, ? reopens it', async () => {
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.Proto); await sleep(900);
    expect(await page.isHidden('#tut'), 'tour auto-opened on a return visit');
    await page.keyboard.press('?'); await sleep(300);
    expect(await page.isVisible('#tut'), '? did not open the tour');
    await page.keyboard.press('?'); await sleep(200);
  });

  /* ---- strip ---- */
  console.log('\nStrip');
  await step('the prototypes strip links the four prototypes, About opens, [ moves to Polyhedron', async () => {
    const s = await page.evaluate(() => ({ pills: [...document.querySelectorAll('#proto-nav .pnav-pill')].map((a) => a.textContent.replace(/[\[\]]/g, '').trim()), cur: document.querySelector('#proto-nav [aria-current="page"]')?.textContent.trim(), back: document.querySelector('#proto-nav .pnav-back')?.getAttribute('href') }));
    expect(s.pills.join() === 'Facet,Tesseract,Polyhedron,Nested' && s.cur === 'Nested' && s.back === '../../index.html', JSON.stringify(s));
    await page.click('#pnav-about'); await sleep(200);
    expect(await page.isVisible('#pnav-pop') && /Nested cubes/.test(await page.textContent('#pnav-pop')), 'About popover missing');
    await page.keyboard.press('Escape'); await sleep(100);
    expect(await page.isHidden('#pnav-pop'), 'Esc did not close About');
    await page.keyboard.press('[');
    await page.waitForURL(/prototype\/polyhedron\//, { timeout: 4000 });
    await page.goBack({ waitUntil: 'load' }); await page.waitForFunction(() => window.Proto); await sleep(400);
  });

  await step('no console errors or failed requests during the whole run', async () => { expect(log.length === 0, log.slice(0, 5).join(' | ')); });
  await ctx.close();

  /* ---------------- 3. screenshots (2×) ---------------- */
  console.log('\nScreenshots');
  const shotsDir = path.join(ROOT, 'shots'); mkdirSync(shotsDir, { recursive: true });
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const sp = (await open(sctx)).page;
  await step('shots/proto-nested*.png', async () => {
    await sp.evaluate(() => Proto.open('client', 'Acme')); await settle(sp, 300);
    await sp.evaluate(() => Proto.select('acme-sow-q3')); await sleep(900);
    await sp.evaluate(() => { document.getElementById('toast').hidden = true; });
    await sp.screenshot({ path: path.join(shotsDir, 'proto-nested.png') });
    await sp.evaluate(() => Proto.openCompare()); await sleep(900);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-nested-compare.png') });
    await sp.evaluate(() => { Proto.closeCompare(); try { localStorage.removeItem('nested.tour.pos'); } catch (e) {} Proto.tour.open(1); }); await sleep(700);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-nested-tour.png') });
    await sp.evaluate(() => Proto.tour.close());
    return 'hero (depth 2, path of cubes), compare, tour';
  });
  await sctx.close();

  /* ---------------- 4. walkthrough video ---------------- */
  if (!noVideo) {
    console.log('\nVideo');
    const vdir = path.join(ROOT, 'prototype', 'nested', '.video-tmp');
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
    const vp = (await open(vctx)).page;
    let where = 'start';
    await step('record walkthrough', async () => {
      const ev = (js) => vp.evaluate(js);
      const mark = (w) => { where = w; };
      await sleep(800);
      // 1 hover Acme, press Open
      mark('open Acme');
      const acme = vp.locator('.level.current .face.right .gh[data-group="Acme"]');
      await acme.hover(); await sleep(600);
      await acme.locator('.open').click(); await sleep(1600);
      // 2 select a file: it lights up on both cubes in the path
      mark('select');
      await vp.click('.level.current .face.front .fb .row[data-id="acme-sow-q3"]'); await sleep(1200);
      // 3 drill into Contract
      mark('drill Contract');
      await vp.dblclick('.level.current .face.front .gh[data-group="Contract"] b'); await sleep(1600);
      // 4 hover the path, zoom back to Acme via the crumb
      mark('crumb');
      await vp.hover('#crumbs .crumb[data-depth="1"]'); await sleep(700);
      await vp.click('#crumbs .crumb[data-depth="2"]'); await sleep(1300);
      // 5 override an axis
      mark('override');
      await vp.click('#chips-hidden .chip[data-axis="person"]'); await sleep(600);
      await vp.click('#menu [data-act="face:top"]'); await sleep(1100);
      // 6 compare siblings, turn both
      mark('compare');
      await vp.click('#compare-btn'); await sleep(1300);
      await vp.click('#compare .cmp-tools [data-snap="right"]'); await sleep(1000);
      await vp.click('#compare .cmp-tools [data-snap="iso"]'); await sleep(800);
      await vp.click('#compare-close'); await sleep(700);
      // 7 depth guard: a single-file group becomes a list
      mark('list');
      await ev(() => Proto.open('type', 'Contract')); await sleep(1100);
      await ev(() => Proto.open('person', 'Justin')); await sleep(1400);
      // 8 mini-map back to Acme, select the SOW again (the list dropped it), Show in root
      mark('minimap');
      await vp.click('#minimap .mm-l[data-depth="2"]'); await sleep(1100);
      await ev(() => Proto.select('acme-sow-q3')); await sleep(700);
      await vp.click('#inspector [data-show-root]'); await sleep(1700);
      // 9 tour, a couple of steps
      mark('tour');
      await ev(() => { try { localStorage.removeItem('nested.tour.pos'); } catch (e) {} Proto.tour.open(0); }); await sleep(1200);
      await vp.click('#tut-doit'); await sleep(1300); await vp.click('#tut-next'); await sleep(800);
      await vp.click('#tut-next'); await sleep(400);
      await vp.click('#tut-doit'); await sleep(1100);
      await ev(() => Proto.tour.close()); await sleep(300);
      // 10 light theme, end
      mark('theme');
      await vp.click('#theme-btn'); await sleep(1000);
      await vp.click('#theme-btn'); await sleep(400);
    }).catch(() => {});
    if (results[results.length - 1].ok === false) { results[results.length - 1].detail += ` (at: ${where})`; console.log(`        at: ${where}`); }
    const video = vp.video();
    await vctx.close();
    await step('save prototype/nested/walkthrough.webm', async () => {
      const src = await video.path();
      const dest = path.join(ROOT, 'prototype', 'nested', 'walkthrough.webm');
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(src, dest);
      try { rmSync(vdir, { recursive: true, force: true }); } catch {}
      const mb = statSync(dest).size / 1048576;
      expect(mb < 15, `video is ${mb.toFixed(1)} MB`);
      // duration budget (60s), measured with Playwright's bundled ffmpeg when it is there
      let secs = '';
      const ff = existsSync('/opt/pw-browsers') ? readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('ffmpeg')).map((d) => `/opt/pw-browsers/${d}/ffmpeg-linux`).find(existsSync) : null;
      if (ff) {
        const r = spawnSync(ff, ['-hide_banner', '-i', dest], { encoding: 'utf8' });
        const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
        if (m) { const d = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); secs = ` · ${d.toFixed(0)}s`; expect(d <= 60, `video runs ${d.toFixed(0)}s, over the 60s budget`); }
      }
      return `walkthrough.webm ${mb.toFixed(1)} MB${secs}`;
    });
  }
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
