#!/usr/bin/env node
// Drives the Polyhedron prototype (prototype/polyhedron/) like software: loads it at two viewports,
// fails on console errors / failed requests / page overflow, exercises every feature through
// window.Proto and the UI, records a walkthrough video and writes 2× screenshots.
//
//   node tools/proto-check-polyhedron.mjs            # exit 1 on any failed step
//   node tools/proto-check-polyhedron.mjs --no-video # skip the recording (faster)
import path from 'node:path';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { ROOT, loadPlaywright, launch, serve } from './lib.mjs';

const noVideo = process.argv.includes('--no-video');
const PROTO = 'prototype/polyhedron/';
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
  await page.waitForFunction(() => window.Proto && document.querySelectorAll('#poly .face .row').length > 20);
  await sleep(500);
  return { page, log };
}
async function dragMouse(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await page.mouse.up();
}
const snap = (page) => page.evaluate(() => ({
  solid: Proto.solidName(), label: Proto.solidLabel(), active: Proto.state.active.slice(), front: Proto.frontmost(), focused: Proto.state.focused, flat: Proto.state.flat,
  q: Proto.state.view.q.slice(), z: Proto.faceZ(), panels: document.querySelectorAll('#poly .face:not(.gone)').length, blanks: document.querySelectorAll('#poly .face.blank:not(.gone)').length,
  chip: document.getElementById('solid-chip').textContent, sbar: document.getElementById('sbar-solid').textContent
}));
const SOLID_FOR = { 1: 'cube', 2: 'cube', 3: 'cube', 4: 'tetrahedron', 5: 'cube', 6: 'cube', 7: 'octahedron', 8: 'octahedron', 9: 'dodecahedron', 10: 'dodecahedron', 11: 'dodecahedron', 12: 'dodecahedron' };
const FACES = { cube: 6, tetrahedron: 4, octahedron: 8, dodecahedron: 12 };

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
        solid: Proto.solidName(), active: Proto.state.active, panels: document.querySelectorAll('#poly .face').length, blanks: document.querySelectorAll('#poly .face.blank').length,
        rows: [...document.querySelectorAll('#poly .face[data-axis]:not(.blank)')].map((f) => f.querySelectorAll('.fb .row').length),
        full: document.querySelectorAll('#poly .face[data-mode="full"]').length,
        tourOpen: !document.getElementById('tut').hidden, strip: !!document.querySelector('#proto-nav .pnav-pill[aria-current="page"]'), about: !!document.getElementById('pnav-about'),
        minFont: Math.min(...[...document.querySelectorAll('.tb, .sb .nav a, .sb .axt, .pre, .chip, #poly .face[data-mode="full"] .row, #poly .face[data-mode="full"] .gh, #poly .face .fh, .insp, .sbar')].map((n) => parseFloat(getComputedStyle(n).fontSize)))
      }));
      expect(info.sw <= info.iw && info.sh <= info.ih, `page overflows: ${info.sw}×${info.sh} in ${info.iw}×${info.ih}`);
      expect(info.solid === 'cube' && info.active.join() === 'project,client,type', `default is ${info.solid} with ${info.active}`);
      expect(info.panels === 6 && info.blanks === 3, `${info.panels} panels, ${info.blanks} blank`);
      expect(info.rows.length === 3 && info.rows.every((n) => n === 25), `faces have ${info.rows} rows`);
      expect(info.full >= 2, `${info.full} faces readable`);
      expect(info.tourOpen, 'tour did not auto-open on first visit');
      expect(info.strip && info.about, 'proto-nav strip or About button missing');
      expect(info.minFont >= 12, `UI text as small as ${info.minFont}px`);
      return `cube, 3 axes + 3 spare faces, 25 rows each, ${info.full} readable, tour auto-opened, min font ${info.minFont}px`;
    });
    await ctx.close();
  }

  /* ---------------- 2. drive it ---------------- */
  console.log('\nInteractions (1440×900)');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, log } = await open(ctx);
  await page.evaluate(() => { window.__ev = {}; ['roll', 'focus', 'unfocus', 'axes', 'preset', 'flat', 'select', 'hover', 'drag'].forEach((e) => Proto.on(e, (d) => { (window.__ev[e] = window.__ev[e] || []).push(d); })); });
  const stage = await page.locator('#poly-stage').boundingBox();
  const c = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await step('drag rolls the solid with inertia and reports the roll', async () => {
    const before = await snap(page);
    let mid;
    try {
      await page.mouse.move(c.x - 80, c.y + 140); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(c.x - 80 + i * 18, c.y + 140 - i * 4); await sleep(16); }
      mid = await snap(page);
    } finally { await page.mouse.up(); }
    expect(mid.q.some((v, i) => Math.abs(v - before.q[i]) > 0.01), 'orientation did not change while dragging');
    await sleep(300);
    const coasting = await snap(page);
    expect(coasting.q.some((v, i) => Math.abs(v - mid.q[i]) > 0.002), 'no inertia after release');
    await sleep(1600);
    const ev = await page.evaluate(() => window.__ev.roll || []);
    expect(ev.some((d) => d.source === 'drag'), 'no roll event from the drag');
    return `front-most now ${coasting.front}`;
  });

  await step('Roll to menu turns the chosen axis to the front (its normal has the highest z)', async () => {
    await page.click('#roll-btn'); await sleep(200);
    expect(await page.isVisible('#menu') && (await page.$$('#menu [data-act^="roll:"]')).length === 3, 'menu did not list the 3 active axes');
    await page.click('#menu [data-act="roll:type"]'); await sleep(900);
    const s = await snap(page);
    expect(s.front === 'type', `front-most is ${s.front}`);
    expect(s.z.type > s.z.project && s.z.type > s.z.client && s.z.type > 0.6, `z: ${JSON.stringify(s.z)}`);
    expect(await page.$('#poly .face[data-axis="type"].front-most'), 'front-most class not on the Type face');
    expect(/Type in front/.test(await page.textContent('#sbar')), 'status bar does not name the front face');
    return `type z=${s.z.type.toFixed(2)}`;
  });

  await step('keyboard: 2 rolls to the 2nd axis, arrows nudge, 0 resets, Enter focuses, Esc unfocuses', async () => {
    await page.keyboard.press('2'); await sleep(900);
    expect((await snap(page)).front === 'client', 'key 2 did not roll to Client');
    const q0 = (await snap(page)).q;
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    expect((await snap(page)).q.some((v, i) => Math.abs(v - q0[i]) > 0.01), 'ArrowLeft did not nudge');
    await page.keyboard.press('0'); await sleep(900);
    expect((await snap(page)).front === 'project', 'key 0 did not reset to the first axis');
    await page.keyboard.press('Enter'); await sleep(900);
    let s = await snap(page);
    expect(s.focused === 'project' && s.z.project > 0.98, `Enter: focused ${s.focused}, z ${s.z.project}`);
    expect(await page.$('#poly .face[data-axis="project"].focus'), 'focused face lacks .focus');
    await page.keyboard.press('Escape'); await sleep(900);
    s = await snap(page);
    expect(!s.focused && s.z.project < 0.9, `Esc: focused ${s.focused}, z ${s.z.project}`);
  });

  await step('clicking a face header focuses it square-on and enlarged; × lets go', async () => {
    const before = await page.locator('#poly .face[data-axis="client"]').boundingBox();
    const hb = await page.locator('#poly .face[data-axis="client"] .fh').boundingBox();
    const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el && el.closest('.face') ? el.closest('.face').getAttribute('data-axis') : String(el && el.className); }, [hb.x + hb.width / 2, hb.y + hb.height / 2]);
    expect(hit === 'client', `header of the Client face is covered by ${hit}`);
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(1000);
    const s = await snap(page);
    expect(s.focused === 'client' && s.z.client > 0.98, `focused ${s.focused} z ${s.z.client}`);
    const after = await page.locator('#poly .face[data-axis="client"]').boundingBox();
    expect(after.width > before.width * 1.2, `face did not enlarge (${before.width.toFixed(0)} → ${after.width.toFixed(0)})`);
    expect(after.y >= stage.y - 8 && after.y + after.height <= stage.y + stage.height + 8, `focused face leaves the stage: ${JSON.stringify(after)} vs stage ${JSON.stringify(stage)}`);
    const others = await page.evaluate(() => [...document.querySelectorAll('#poly .face[data-axis]:not(.blank):not(.focus)')].map((f) => parseFloat(f.style.opacity)));
    expect(others.every((o) => o < 0.4), `other faces did not recede: ${others}`);
    const rowFont = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#poly .face.focus .row')).fontSize));
    expect(rowFont >= 15, `focused rows are ${rowFont}px`);
    const xb = await page.locator('#poly .face.focus .fx').boundingBox();
    await page.mouse.click(xb.x + xb.width / 2, xb.y + xb.height / 2); await sleep(900);
    expect(!(await snap(page)).focused, 'did not unfocus');
    expect((await page.evaluate(() => window.__ev.focus.length)) >= 2 && (await page.evaluate(() => window.__ev.unfocus.length)) >= 2, 'focus/unfocus events missing');
    return `${before.width.toFixed(0)} → ${after.width.toFixed(0)}px wide`;
  });

  await step('toggling axes morphs the solid: 3 cube → 4 tetrahedron → 5/6 cube → 7/8 octahedron → 12 dodecahedron', async () => {
    const seen = [];
    const check = async (n) => {
      await sleep(850);
      const s = await snap(page);
      const want = SOLID_FOR[n];
      expect(s.active.length === n, `${s.active.length} active, wanted ${n}`);
      expect(s.solid === want, `${n} axes gave ${s.solid}, wanted ${want}`);
      expect(s.panels === FACES[want] && s.blanks === FACES[want] - n, `${s.panels} panels / ${s.blanks} blank for ${want} with ${n} axes`);
      expect(new RegExp(want, 'i').test(s.chip) && new RegExp(want, 'i').test(s.sbar), `labels say "${s.chip}" / "${s.sbar}"`);
      const rows = await page.evaluate(() => [...document.querySelectorAll('#poly .face[data-axis]:not(.blank):not(.gone)')].map((f) => f.querySelectorAll('.fb .row').length));
      expect(rows.length === n && rows.every((r) => r === 25), `rows per face: ${rows}`);
      const transforms = await page.evaluate(() => [...document.querySelectorAll('#poly .face:not(.gone)')].map((f) => f.style.transform));
      expect(new Set(transforms).size === transforms.length, 'two faces share a transform');
      seen.push(`${n}→${s.label}`);
    };
    await page.click('#axes-rail [data-axis="quarter"]'); await check(4);
    expect(/tetrahedron/i.test(await page.textContent('#toast')), 'toast did not announce the morph');
    await page.click('#axes-rail [data-axis="person"]'); await check(5);
    await page.evaluate(() => Proto.toggleAxis('status', true)); await check(6);
    await page.evaluate(() => Proto.toggleAxis('owner', true)); await check(7);
    await page.evaluate(() => Proto.toggleAxis('shared', true)); await check(8);
    await page.evaluate(() => Proto.setAxes(Proto.axes.map((a) => a.id))); await check(12);
    const ev = await page.evaluate(() => window.__ev.axes.map((d) => d.solid));
    expect(ev.includes('tetrahedron') && ev.includes('octahedron') && ev.includes('dodecahedron'), `axes events: ${ev}`);
    expect(await page.evaluate(() => document.querySelectorAll('#axes-rail .axt[aria-pressed="true"]').length) === 12, 'rail switches not all on');
    return seen.join(', ');
  });

  await step('the last axis cannot be folded away', async () => {
    await page.evaluate(() => Proto.setAxes(['project'])); await sleep(700);
    const ok = await page.evaluate(() => Proto.toggleAxis('project', false));
    expect(ok === false && (await snap(page)).active.length === 1, 'folded away the last axis');
    expect(/at least one axis/.test(await page.textContent('#toast')), 'no explanation toast');
    await page.evaluate(() => Proto.preset('all')); await sleep(900);
  });

  await step('on the dodecahedron, Roll to brings any of the 12 faces to the front', async () => {
    for (const ax of ['status', 'starred', 'project']) {
      await page.evaluate((a) => Proto.rollTo(a), ax); await sleep(850);
      const s = await snap(page);
      const zs = Object.entries(s.z).sort((a, b) => b[1] - a[1]);
      expect(s.front === ax && zs[0][0] === ax && zs[0][1] > 0.6, `${ax}: front ${s.front}, top z ${zs[0]}`);
      const full = await page.evaluate(() => document.querySelectorAll('#poly .face[data-mode="full"]').length);
      const back = await page.evaluate(() => [...document.querySelectorAll('#poly .face[data-axis]:not(.blank)')].filter((f) => parseFloat(f.style.opacity) < 0.05).length);
      expect(full >= 1 && back >= 4, `${full} readable faces, ${back} culled`);
    }
    return 'status, starred, project each rolled to the front';
  });

  await step('clicking a file selects it on all 12 faces; the inspector lists where it sits', async () => {
    await page.click('#poly .face[data-axis="project"] .fb .row[data-id="acme-sow-q3"]'); await sleep(700);
    const s = await page.evaluate(() => ({
      sel: Proto.state.selected,
      rows: document.querySelectorAll('#poly .face .row.sel[data-id="acme-sow-q3"]').length,
      labs: document.querySelectorAll('#poly .face .lab.sel').length,
      perFace: [...document.querySelectorAll('#poly .face[data-axis]:not(.blank)')].every((f) => f.querySelector('.row.sel') && f.querySelector('.lab.sel')),
      insp: document.getElementById('inspector').textContent, where: document.querySelectorAll('#where .wr').length,
      front: document.querySelectorAll('#where .wr .st.front').length
    }));
    expect(s.sel === 'acme-sow-q3', `selected is ${s.sel}`);
    expect(s.rows === 12 && s.labs === 12 && s.perFace, `highlighted rows ${s.rows}, labels ${s.labs}`);
    expect(/Where it sits/.test(s.insp) && s.where === 12, `${s.where} where-it-sits rows`);
    for (const v of ['Atlas', 'Acme', 'Contract', 'Q3 2026', 'Priya', 'In review', 'Medium', 'This week', 'PDF', 'Starred']) expect(s.insp.includes(v), `inspector missing ${v}`);
    expect(s.front >= 1 && /on 12 faces/.test(s.insp), 'front-face pill or face count missing');
    return `12 rows + 12 group labels lit, ${s.where} axes listed`;
  });

  await step('a where-it-sits row rolls to that axis; a folded axis unfolds first', async () => {
    await page.click('#where .wr[data-axis="format"]'); await sleep(900);
    expect((await snap(page)).front === 'format', 'did not roll to Format');
    await page.evaluate(() => Proto.toggleAxis('size', false)); await sleep(800);
    expect((await snap(page)).solid === 'dodecahedron' && (await snap(page)).blanks === 1, 'expected a dodecahedron with one spare face');
    await page.click('#where .wr[data-axis="size"]'); await sleep(1000);
    const s = await snap(page);
    expect(s.active.includes('size') && s.front === 'size', `size active ${s.active.includes('size')}, front ${s.front}`);
  });

  await step('hovering a group lights its files on the other faces', async () => {
    await page.evaluate(() => Proto.rollTo('project')); await sleep(900);
    await page.hover('#poly .face[data-axis="project"] .gh[data-group="Legal"]'); await sleep(150);
    const n = await page.evaluate(() => ({ rows: document.querySelectorAll('#poly .face:not([data-axis="project"]) .row.lit').length, labs: document.querySelectorAll('#poly .face .lab.lit').length, ev: (window.__ev.hover || []).filter((d) => d.axis).length }));
    expect(n.rows >= 20 && n.labs >= 5 && n.ev >= 1, JSON.stringify(n));
    await page.mouse.move(c.x, stage.y + 10);
    return `${n.rows} rows, ${n.labs} labels lit`;
  });

  await step('search dims non-matching files on every face', async () => {
    await page.fill('#search', 'acme'); await sleep(250);
    const s = await page.evaluate(() => ({ dim: document.querySelectorAll('#poly .face[data-axis="project"] .row.dim').length, bright: document.querySelectorAll('#poly .face[data-axis="project"] .row:not(.dim)').length, bar: document.getElementById('sbar').textContent }));
    expect(s.dim === 17 && s.bright === 8, `${s.bright} bright / ${s.dim} dimmed`);
    expect(/8 of 25/.test(s.bar), 'status bar does not report matches');
    await page.fill('#search', ''); await sleep(200);
  });

  await step('Flatten unfolds the dodecahedron into a 12-face net and folds back', async () => {
    await page.click('#flat-btn'); await sleep(1000);
    const s = await page.evaluate(() => {
      const faces = [...document.querySelectorAll('#poly .face:not(.gone)')];
      const flat2d = faces.every((f) => /,0,0,1,0,/.test(f.style.transform.replace(/\s/g, '')) || /0\.00000,0\.00000,1\.00000/.test(f.style.transform));
      const rects = faces.map((f) => f.getBoundingClientRect());
      const st = document.getElementById('poly-stage').getBoundingClientRect();
      return { flat: Proto.state.flat, pressed: document.getElementById('flat-btn').getAttribute('aria-pressed'), n: faces.length, flat2d, visible: faces.every((f) => parseFloat(f.style.opacity) > 0.9), inside: rects.every((r) => r.left >= st.left - 2 && r.right <= st.right + 2 && r.top >= st.top - 2 && r.bottom <= st.bottom + 2), net: Proto.geo().net && Proto.geo().net.placed.length, sel: document.querySelectorAll('#poly .face .lab.sel').length, status: document.getElementById('sbar').textContent };
    });
    expect(s.flat && s.pressed === 'true' && s.n === 12 && s.net === 12, JSON.stringify(s));
    expect(s.flat2d, 'faces are not laid flat');
    expect(s.visible, 'not every face is visible in the net');
    expect(s.inside, 'net does not fit inside the stage');
    expect(s.sel === 12 && /Unfolded/.test(s.status), 'selection or status lost in the net');
    await page.keyboard.press('f'); await sleep(1000);
    const back = await snap(page);
    expect(!back.flat && back.z.project > 0.6, `did not fold back (flat ${back.flat}, project z ${back.z.project})`);
    expect((await page.evaluate(() => window.__ev.flat.map((d) => d.on))).join() === 'true,false', 'flat events wrong');
  });

  await step('presets set the rail: Cube 3, Core 5, Legal review 4, Who owns what 3, Everything 12', async () => {
    const want = { cube: [3, 'cube'], core: [5, 'cube'], legal: [4, 'tetrahedron'], owners: [3, 'cube'], all: [12, 'dodecahedron'] };
    const out = [];
    for (const k of Object.keys(want)) {
      await page.click(`#presets [data-preset="${k}"]`); await sleep(900);
      const s = await snap(page);
      expect(s.active.length === want[k][0] && s.solid === want[k][1], `${k}: ${s.active.length} axes on a ${s.solid}`);
      expect(await page.getAttribute(`#presets [data-preset="${k}"]`, 'aria-pressed') === 'true', `${k} preset not shown as current`);
      if (k === 'legal') expect(s.active.join() === 'client,type,status,shared', `legal review axes: ${s.active}`);
      if (k === 'owners') expect(s.active.join() === 'project,person,owner', `who owns what axes: ${s.active}`);
      out.push(`${k}=${s.active.length}/${s.solid}`);
    }
    expect((await page.evaluate(() => window.__ev.preset.map((d) => d.name))).slice(-5).join() === 'cube,core,legal,owners,all', 'preset events wrong');
    return out.join(' ');
  });

  await step('Solid tab: name, face count, axes per face, wireframe turning in sync', async () => {
    await page.click('#inspector [data-tab="solid"]'); await sleep(300);
    const s = await page.evaluate(() => ({ name: document.getElementById('solid-name').textContent, lines: document.querySelectorAll('#wire line').length, polys: document.querySelectorAll('#wire polygon').length, texts: document.querySelectorAll('#wire text').length, faces: document.querySelectorAll('#facelist .wr').length, html: document.getElementById('wire').innerHTML, rule: document.querySelector('.rule').textContent }));
    expect(/Dodecahedron/.test(s.name) && /12 faces/.test(s.name), `name says ${s.name}`);
    expect(s.lines === 30 && s.polys >= 3 && s.texts >= 1 && s.faces === 12, `wire: ${s.lines} edges, ${s.polys} faces, ${s.texts} labels; list ${s.faces}`);
    expect(/Platonic/.test(s.rule) && /dodecahedron/.test(s.rule), 'rule text missing');
    await page.keyboard.press('ArrowRight'); await sleep(250);
    expect((await page.evaluate(() => document.getElementById('wire').innerHTML)) !== s.html, 'wireframe did not turn with the solid');
    await page.click('#facelist .wr[data-axis="owner"]'); await sleep(900);
    expect((await snap(page)).front === 'owner', 'face list row did not roll to Owner');
    await page.click('#inspector [data-tab="file"]'); await sleep(200);
    return `${s.lines} edges, ${s.polys} lit faces`;
  });

  await step('theme toggles to light and back', async () => {
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#theme-btn'); await sleep(250);
    const s = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('polyhedron.theme'), title: document.getElementById('theme-btn').title, faceBg: getComputedStyle(document.querySelector('#poly .face[data-axis="project"] .fin')).backgroundColor }));
    expect(s.t === 'light' && s.bg !== bg0 && s.stored === 'light' && /dark/.test(s.title), JSON.stringify(s));
    expect(/255, 255, 255|rgb\(2[45]\d/.test(s.faceBg), `faces did not go light: ${s.faceBg}`);
    await page.click('#theme-btn'); await sleep(250);
    expect(await page.getAttribute('html', 'data-theme') === 'dark', 'did not return to dark');
  });

  /* ---- tour ---- */
  console.log('\nTour');
  await step('tour opens from the top bar with 7 steps and spotlights its target', async () => {
    await page.evaluate(() => Proto.preset('cube')); await sleep(800);
    await page.click('#tour-btn'); await sleep(500);
    const s = await page.evaluate(() => ({ open: !document.getElementById('tut').hidden, ring: !document.getElementById('tut-ring').hidden, step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent }));
    expect(s.open && s.ring && /1 \/ 7/.test(s.step), JSON.stringify(s));
    return s.title;
  });

  await step('tour panel drags by its header, stays in bounds, collapses to a pill', async () => {
    const h = await page.locator('#tut-h').boundingBox();
    const before = await page.locator('#tut').boundingBox();
    await dragMouse(page, { x: h.x + 60, y: h.y + h.height / 2 }, { x: h.x + 260, y: h.y + h.height / 2 - 200 });
    await sleep(100);
    const after = await page.locator('#tut').boundingBox();
    expect(Math.abs(after.x - before.x - 200) < 4 && Math.abs(after.y - before.y + 200) < 4, `moved by ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}`);
    const h2 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h2.x + 60, y: h2.y + h2.height / 2 }, { x: 1430, y: 890 });
    await sleep(100);
    const far = await page.locator('#tut').boundingBox();
    expect(far.x + far.width <= 1440 && far.y + far.height <= 900 && far.x >= 0 && far.y >= 0, `out of bounds: ${JSON.stringify(far)}`);
    await page.click('#tut-collapse'); await sleep(250);
    const pill = await page.locator('#tut').boundingBox();
    expect(pill.height < 60 && await page.isHidden('#tut-b'), `pill is ${pill.width}×${pill.height}`);
    await page.click('#tut-collapse'); await sleep(250);
    const h3 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h3.x + 60, y: h3.y + h3.height / 2 }, { x: 80, y: 560 });
  });

  await step('every action step waits for its action, and "Do it for me" completes all 7', async () => {
    const titles = [];
    for (let i = 0; i < 7; i++) {
      const s = await page.evaluate(() => ({ step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, hasTask: !!document.getElementById('tut-task'), nextDisabled: document.getElementById('tut-next').disabled, doit: !!document.getElementById('tut-doit'), next: document.getElementById('tut-next').textContent }));
      expect(s.step.startsWith(`${i + 1} /`), `expected step ${i + 1}, at "${s.step}"`);
      titles.push(s.title);
      if (s.hasTask) {
        expect(s.nextDisabled && s.doit, `step ${i + 1}: Next should wait for the action`);
        await page.click('#tut-doit');
        await page.waitForFunction(() => !document.getElementById('tut-next').disabled, null, { timeout: 5000 });
        await sleep(900);
        expect(await page.evaluate(() => document.getElementById('tut-task').classList.contains('done')), `step ${i + 1}: task not marked done`);
      } else expect(i === 0, `step ${i + 1} has no task`);
      if (i === 3) expect((await snap(page)).solid === 'tetrahedron', 'fold step did not leave a tetrahedron');
      if (i === 4) expect((await snap(page)).solid === 'dodecahedron', 'preset step did not reach the dodecahedron');
      if (i === 5) expect((await snap(page)).flat, 'flatten step did not flatten');
      if (i === 6) { expect(s.next === 'Done', `last button says ${s.next}`); expect((await snap(page)).flat === false, 'net was not folded back before the last step'); expect(await page.evaluate(() => Proto.state.selected === 'acme-sow-q3'), 'select step did not select'); }
      await page.click('#tut-next'); await sleep(700);
    }
    expect(await page.isHidden('#tut'), 'tour did not close on Done');
    expect(await page.evaluate(() => localStorage.getItem('polyhedron.tour.seen')) === '1', 'seen flag not stored');
    return titles.join(' · ');
  });

  await step('a returning visitor does not get the tour again, ? reopens it, About popover works', async () => {
    await page.reload({ waitUntil: 'load' }); await sleep(1000);
    expect(await page.isHidden('#tut'), 'tour auto-opened on a return visit');
    await page.keyboard.press('?'); await sleep(300);
    expect(await page.isVisible('#tut'), '? did not open the tour');
    await page.keyboard.press('?'); await sleep(200);
    await page.click('#pnav-about'); await sleep(200);
    expect(await page.isVisible('#pnav-pop') && /dodecahedron/i.test(await page.textContent('#pnav-pop')), 'About popover missing');
    await page.keyboard.press('Escape'); await sleep(150);
  });

  await step('no console errors or failed requests during the whole run', async () => { expect(log.length === 0, log.slice(0, 5).join(' | ')); });
  await ctx.close();

  /* ---------------- 3. screenshots (2×) ---------------- */
  console.log('\nScreenshots');
  const shotsDir = path.join(ROOT, 'shots'); mkdirSync(shotsDir, { recursive: true });
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const sp = (await open(sctx)).page;
  await step('shots/proto-polyhedron*.png', async () => {
    await sp.evaluate(() => { Proto.preset('all'); }); await sleep(1100);
    await sp.evaluate(() => { Proto.select('acme-sow-q3'); Proto.focus('client'); }); await sleep(1300);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-polyhedron.png') });
    await sp.evaluate(() => { Proto.unfocus(); }); await sleep(900);
    await sp.evaluate(() => { Proto.flatten(true); }); await sleep(1200);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-polyhedron-net.png') });
    await sp.evaluate(() => { Proto.flatten(false); }); await sleep(1000);
    await sp.evaluate(() => { Proto.select(null); Proto.preset('core'); }); await sleep(1000);
    await sp.evaluate(() => { try { localStorage.removeItem('polyhedron.tour.pos'); } catch (e) {} Proto.tour.open(3); }); await sleep(900);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-polyhedron-tour.png') });
    return 'hero (dodecahedron, focused face, selection), net, tour';
  });
  await sctx.close();

  /* ---------------- 4. walkthrough video ---------------- */
  if (!noVideo) {
    console.log('\nVideo');
    const vdir = path.join(ROOT, 'prototype', 'polyhedron', '.video-tmp');
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
    const vp = (await open(vctx)).page;
    await step('record walkthrough', async () => {
      const ev = (js) => vp.evaluate(js);
      await sleep(800);
      // 1 roll the cube
      await dragMouse(vp, { x: 560, y: 620 }, { x: 760, y: 560 }, 30); await sleep(1600);
      await vp.click('#chips-active .chip[data-axis="client"]'); await sleep(1400);
      // 2 focus + unfocus
      await vp.click('#poly .face[data-axis="client"] .fh'); await sleep(1800);
      await vp.keyboard.press('Escape'); await sleep(1200);
      // 3 grow: core 5 → everything
      await vp.click('#presets [data-preset="core"]'); await sleep(1800);
      await vp.click('#axes-rail [data-axis="quarter"]'); await sleep(2000);
      await vp.click('#presets [data-preset="all"]'); await sleep(2200);
      await dragMouse(vp, { x: 560, y: 600 }, { x: 900, y: 520 }, 34); await sleep(1800);
      // 4 roll to via menu
      await vp.click('#roll-btn'); await sleep(900);
      await vp.click('#menu [data-act="roll:status"]'); await sleep(1500);
      // 5 select a file, inspector
      await vp.click('#poly .face[data-axis="status"] .fb .row[data-id="acme-sow-q3"]'); await sleep(2000);
      await vp.click('#where .wr[data-axis="owner"]'); await sleep(1600);
      // 6 solid tab + a nudge
      await vp.click('#inspector [data-tab="solid"]'); await sleep(1200);
      await vp.keyboard.press('ArrowRight'); await sleep(300); await vp.keyboard.press('ArrowRight'); await sleep(1200);
      // 7 flatten and back
      await vp.click('#flat-btn'); await sleep(2600);
      await vp.click('#flat-btn'); await sleep(1600);
      // 8 fold down to legal review (tetrahedron), then who owns what
      await vp.click('#presets [data-preset="legal"]'); await sleep(2200);
      await vp.click('#presets [data-preset="owners"]'); await sleep(2000);
      // 9 tour, briefly
      await ev(() => { try { localStorage.removeItem('polyhedron.tour.pos'); } catch (e) {} Proto.tour.open(0); }); await sleep(1800);
      await vp.click('#tut-next'); await sleep(700);
      await vp.click('#tut-doit'); await sleep(1400); await vp.click('#tut-next'); await sleep(700);
      await vp.click('#tut-doit'); await sleep(1400);
      await ev(() => Proto.tour.close()); await sleep(400);
      await vp.keyboard.press('Escape'); await sleep(800);
      // 10 light theme, end
      await vp.click('#theme-btn'); await sleep(1400);
      await vp.click('#theme-btn'); await sleep(600);
    });
    const video = vp.video();
    await vctx.close();
    await step('save prototype/polyhedron/walkthrough.webm', async () => {
      const src = await video.path();
      const dest = path.join(ROOT, 'prototype', 'polyhedron', 'walkthrough.webm');
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(src, dest);
      try { rmSync(vdir, { recursive: true, force: true }); } catch {}
      const mb = statSync(dest).size / 1048576;
      expect(mb < 15, `video is ${mb.toFixed(1)} MB`);
      return `walkthrough.webm ${mb.toFixed(1)} MB`;
    });
  }
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
