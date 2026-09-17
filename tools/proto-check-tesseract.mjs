#!/usr/bin/env node
// Drives the Tesseract prototype (prototype/tesseract/) like software: loads it at two
// viewports, fails on console errors / failed requests / page overflow, exercises every
// feature through window.Proto, records a walkthrough video and writes 2× screenshots.
//
//   node tools/proto-check-tesseract.mjs            # exit 1 on any failed step
//   node tools/proto-check-tesseract.mjs --no-video # skip the recording (faster)
import path from 'node:path';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { ROOT, loadPlaywright, launch, serve } from './lib.mjs';

const noVideo = process.argv.includes('--no-video');
const PROTO = 'prototype/tesseract/';
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
  await page.waitForFunction(() => window.Proto && window.ProtoNav && document.querySelectorAll('#cube-stage .face .row').length > 20);
  await sleep(500);
  return { page, log };
}
async function dragMouse(page, from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); }
  await page.mouse.up();
}
const frontRows = (page) => page.evaluate(() => document.querySelectorAll('#cube-stage .face.front .fb .row').length);
const groupOf = (page, id) => page.evaluate((id) => { const r = document.querySelector(`#cube-stage .face.front .fb .row[data-id="${id}"]`); return r ? r.closest('.grp').getAttribute('data-group') : null; }, id);

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
        faces: [...document.querySelectorAll('#cube-stage .face')].map((f) => f.querySelectorAll('.fb .row').length),
        ghosts: [Proto.ghosts.L.q, Proto.ghosts.R.q],
        ghostRows: document.querySelectorAll('#ghost-l .face.front .fb .row').length,
        tourOpen: !document.getElementById('tut').hidden,
        strip: document.querySelectorAll('#proto-nav .pnav-pill').length,
        current: document.querySelector('#proto-nav .pnav-pill[aria-current="page"]')?.textContent.trim(),
        about: !!document.getElementById('pnav-about'),
        minFont: Math.min(...[...document.querySelectorAll('.tb, .sb .nav a, .sb .nav button, .chip, .face .row, .insp, .sbar, .tick, .tnow, .gcap, .wl-tag, .tl-ev li, .drow, .home')].map((n) => parseFloat(getComputedStyle(n).fontSize))),
        q: Proto.state.q, when: document.getElementById('tnow').textContent
      }));
      expect(info.sw <= info.iw && info.sh <= info.ih, `page overflows: ${info.sw}×${info.sh} in ${info.iw}×${info.ih}`);
      expect(info.faces.length === 3 && info.faces.every((n) => n === 25), `faces have ${info.faces} rows`);
      expect(info.q === 2 && /Q3 2026/.test(info.when) && /Now/.test(info.when), `did not open at Q3 2026 (now): ${info.when}`);
      expect(info.ghosts[0] === 1 && info.ghosts[1] === 3 && info.ghostRows === 23, `ghosts show ${info.ghosts} with ${info.ghostRows} rows in the left one`);
      expect(info.tourOpen, 'tour did not auto-open on first visit');
      expect(info.strip === 4 && /Tesseract/.test(info.current) && info.about, `proto-nav strip: ${info.strip} pills, current "${info.current}", about ${info.about}`);
      expect(info.minFont >= 12, `UI text as small as ${info.minFont}px`);
      return `25 rows on 3 faces at Q3 2026, ghosts Q2/Q4, strip present, tour auto-opened, min UI font ${info.minFont}px`;
    });
    await ctx.close();
  }

  /* ---------------- 2. drive it ---------------- */
  console.log('\nInteractions (1440×900)');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, log } = await open(ctx);

  await step('scrubbing to each quarter gives 22 / 23 / 25 / 25 files, Q4 with 2 archived', async () => {
    const counts = [];
    for (let i = 0; i < 4; i++) {
      await page.evaluate((i) => Proto.setTime(i), i); await sleep(650);
      const s = await page.evaluate(() => ({ n: document.querySelectorAll('#cube-stage .face.front .fb .row').length, right: document.querySelectorAll('#cube-stage .face.right .fb .row').length, arch: document.querySelectorAll('#cube-stage .face.front .fb .row.arch').length, tags: document.querySelectorAll('#cube-stage .face.front .rtag.arch').length, nav: document.getElementById('nav-all-count').textContent, bar: document.getElementById('sbar').textContent, tnow: document.getElementById('tnow').textContent, q: Proto.state.q, handle: document.getElementById('handle').getAttribute('aria-valuetext') }));
      counts.push(s.n);
      expect(s.n === s.right, `front ${s.n} vs right ${s.right}`);
      expect(s.q === i && +s.nav === s.n, `state q ${s.q}, sidebar count ${s.nav}`);
      expect(s.handle === ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'][i], `slider says ${s.handle}`);
      if (i === 0) expect(/3 not created yet/.test(s.tnow), 'Q1 does not mention the 3 files not created yet');
      if (i === 3) { expect(s.arch === 2 && s.tags === 2 && /2 archived/.test(s.bar), `Q4: ${s.arch} archived rows, ${s.tags} tags`); }
      else expect(s.arch === 0, `${s.arch} archived rows in quarter ${i}`);
    }
    expect(counts.join('/') === '22/23/25/25', `counts ${counts.join('/')}`);
    return counts.join(' / ') + ' rows';
  });

  await step('a file changes group when time moves (Acme MSA v4: Atlas in Q1 → Legal in Q2) and flashes', async () => {
    await page.evaluate(() => Proto.setTime(0)); await sleep(600);
    expect((await groupOf(page, 'acme-msa-v4')) === 'Atlas', 'not under Atlas in Q1');
    expect(!(await page.$('#cube-stage .face.front .fb .row[data-id="q3-pl"]')), 'Q3 P&L should not exist in Q1');
    await page.evaluate(() => Proto.setTime(1)); await sleep(120);
    const flashed = await page.evaluate(() => !!document.querySelector('#cube-stage .face.front .fb .row.tmoved[data-id="acme-msa-v4"]'));
    await sleep(600);
    expect((await groupOf(page, 'acme-msa-v4')) === 'Legal', 'not under Legal in Q2');
    expect(flashed, 'moved row did not flash');
    const born = await page.evaluate(() => !!document.querySelector('#cube-stage .face.front .fb .row.born[data-id="home-fig"]'));
    expect(born, 'home.fig (created Q2) did not get the born animation');
    await page.evaluate(() => Proto.setTime(2)); await sleep(500);
    expect((await groupOf(page, 'dpa-acme')) === 'Legal' && (await page.evaluate(() => document.querySelector('#cube-stage .face.right .fb .row[data-id="dpa-acme"]').closest('.grp').getAttribute('data-group'))) === 'Acme', 'DPA — Acme not under Acme on the Client face in Q3');
    await page.evaluate(() => Proto.setTime(1)); await sleep(400);
    expect((await page.evaluate(() => document.querySelector('#cube-stage .face.right .fb .row[data-id="dpa-acme"]').closest('.grp').getAttribute('data-group'))) === '', 'DPA — Acme should be in the "No client" group in Q2');
  });

  await step('dragging the scrubber handle moves through time', async () => {
    const tr = await page.locator('#track').boundingBox();
    const y = tr.y + 21;
    await dragMouse(page, { x: tr.x + tr.width / 3, y }, { x: tr.x + tr.width, y }, 20);
    await sleep(600);
    expect((await page.evaluate(() => Proto.state.q)) === 3, 'drag to the end did not reach Q4');
    await dragMouse(page, { x: tr.x + tr.width, y }, { x: tr.x, y }, 20);
    await sleep(600);
    expect((await page.evaluate(() => Proto.state.q)) === 0, 'drag to the start did not reach Q1');
    await page.click('#track .tick[data-q="1"]'); await sleep(500);
    expect((await page.evaluate(() => Proto.state.q)) === 1, 'clicking a tick did not scrub');
  });

  await step('keyboard: ← → step quarters, Space plays and pauses, G D P toggle, 1 2 3 0 snap faces', async () => {
    await page.mouse.click(700, 885); // a neutral spot (status bar text) so no button holds focus
    await page.keyboard.press('ArrowRight'); await sleep(450);
    expect((await page.evaluate(() => Proto.state.q)) === 2, '→ did not step forward');
    await page.keyboard.press('ArrowLeft'); await sleep(450);
    expect((await page.evaluate(() => Proto.state.q)) === 1, '← did not step back');
    await page.keyboard.press(' '); await sleep(100);
    expect(await page.evaluate(() => Proto.state.playing && document.getElementById('play-btn').getAttribute('aria-pressed') === 'true'), 'Space did not play');
    await sleep(2900);
    expect((await page.evaluate(() => Proto.state.q)) === 2, 'play did not advance a quarter after ~2.5s');
    await page.keyboard.press(' '); await sleep(100);
    expect(!(await page.evaluate(() => Proto.state.playing)), 'Space did not pause');
    await page.keyboard.press('g'); await sleep(200);
    expect(!(await page.evaluate(() => Proto.state.ghosts)) && await page.evaluate(() => document.getElementById('ghost-l').classList.contains('off')), 'G did not hide the ghosts');
    await page.keyboard.press('g'); await sleep(200);
    expect(await page.evaluate(() => Proto.state.ghosts), 'G did not show the ghosts again');
    await page.keyboard.press('d'); await sleep(200);
    expect((await page.evaluate(() => Proto.state.tab)) === 'diff', 'D did not open the diff');
    await page.keyboard.press('d'); await sleep(200);
    expect((await page.evaluate(() => Proto.state.tab)) === 'file', 'D did not close the diff');
    await page.keyboard.press('p'); await sleep(200);
    expect((await page.evaluate(() => Proto.state.pinned)) === 2, 'P did not pin Q3');
    await page.keyboard.press('p'); await sleep(200);
    expect((await page.evaluate(() => Proto.state.pinned)) === null, 'P did not unpin');
    for (const [k, snap] of [['2', 'right'], ['3', 'top'], ['1', 'front'], ['0', 'iso']]) {
      await page.keyboard.press(k); await sleep(600);
      const s = await page.evaluate(() => ({ snap: Proto.cube.state.snap, ghost: Proto.ghosts.L.api.state.snap, ds: document.getElementById('tstage').getAttribute('data-snap'), gop: getComputedStyle(document.getElementById('ghost-l')).opacity }));
      expect(s.snap === snap && s.ghost === snap && s.ds === snap, `key ${k}: ${JSON.stringify(s)}`);
      if (snap !== 'iso') expect(+s.gop === 0, `ghosts should fade when a face is square-on (opacity ${s.gop})`);
    }
    await page.keyboard.press('Home'); await sleep(400);
    expect((await page.evaluate(() => Proto.state.q)) === 0, 'Home did not go to Q1');
  });

  await step('ghosts toggle from the toolbar and follow the live cube’s rotation', async () => {
    await page.evaluate(() => Proto.setTime(1)); await sleep(500);
    await page.click('#ghosts-btn'); await sleep(250);
    await sleep(300);
    let s = await page.evaluate(() => ({ on: Proto.state.ghosts, pressed: document.getElementById('ghosts-btn').getAttribute('aria-pressed'), op: getComputedStyle(document.getElementById('ghost-r')).opacity }));
    expect(!s.on && s.pressed === 'false' && +s.op < 0.05, JSON.stringify(s));
    await page.click('#ghosts-btn'); await sleep(450);
    s = await page.evaluate(() => ({ on: Proto.state.ghosts, op: getComputedStyle(document.getElementById('ghost-r')).opacity, L: Proto.ghosts.L.q, R: Proto.ghosts.R.q }));
    expect(s.on && +s.op > 0.2 && s.L === 0 && s.R === 2, JSON.stringify(s));
    const stage = await page.locator('#cube-stage').boundingBox();
    const c = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 + 100 };
    await dragMouse(page, { x: c.x - 80, y: c.y }, { x: c.x + 60, y: c.y - 30 }, 16);
    await sleep(1200);
    const r = await page.evaluate(() => ({ live: Proto.cube.state.rot, ghost: Proto.ghosts.L.api.state.rot, snap: Proto.cube.state.snap }));
    expect(Math.abs(r.live.rx - r.ghost.rx) < 0.01 && Math.abs(r.live.ry - r.ghost.ry) < 0.01, `ghost rotation ${JSON.stringify(r.ghost)} vs live ${JSON.stringify(r.live)}`);
    await page.evaluate(() => Proto.cube.snap('iso')); await sleep(600);
    return `settled on "${r.snap}", ghosts in sync`;
  });

  await step('selecting a file draws world lines to the ghosts with a labelled delta', async () => {
    await page.click('#cube-stage .face.front .fb .row[data-id="acme-msa-v4"]'); await sleep(1100);
    const s = await page.evaluate(() => ({
      sel: Proto.state.selected, gsel: [Proto.ghosts.L.api.state.selected, Proto.ghosts.R.api.state.selected],
      paths: document.querySelectorAll('#worldlines path').length, chg: document.querySelectorAll('#worldlines path.chg').length,
      tags: [...document.querySelectorAll('#caps .wl-tag')].map((n) => n.textContent),
      caps: [...document.querySelectorAll('#caps .gcap')].map((n) => n.textContent),
      conn: document.querySelectorAll('#cube-stage .connectors path').length,
      insp: document.getElementById('inspector').textContent
    }));
    expect(s.sel === 'acme-msa-v4' && s.gsel.every((g) => g === 'acme-msa-v4'), `selection ${s.sel} / ghosts ${s.gsel}`);
    expect(s.paths >= 3, `${s.paths} world lines`);
    expect(s.chg >= 1 && s.tags.some((t) => /Project/.test(t) && /Atlas/.test(t) && /Legal/.test(t) && /Q2 2026/.test(t)), `delta label missing: ${JSON.stringify(s.tags)}`);
    expect(s.caps.length === 2 && /Q1 2026/.test(s.caps[0]) && /previous/.test(s.caps[0]) && /Q3 2026/.test(s.caps[1]) && /next/.test(s.caps[1]), `captions ${JSON.stringify(s.caps)}`);
    expect(s.conn >= 2, `${s.conn} connector lines on the live cube`);
    expect(/Timeline/.test(s.insp) && /Where it sits/.test(s.insp) && /Atlas\s*→\s*Legal/.test(s.insp), 'inspector lacks the timeline');
    return `${s.paths} world lines (${s.chg} changed), label “${s.tags[0]}”`;
  });

  await step('a file that does not exist yet gets a “not created” marker and a Go-to button', async () => {
    await page.evaluate(() => Proto.setTime(0)); await sleep(500);
    await page.evaluate(() => Proto.select('q3-pl')); await sleep(900);
    const s = await page.evaluate(() => ({ sel: Proto.state.selected, cubeSel: Proto.cube.state.selected, insp: document.getElementById('inspector').textContent, abs: document.querySelectorAll('#worldlines path.abs').length, tag: [...document.querySelectorAll('#caps .wl-tag')].map((n) => n.textContent).join(' | '), callout: document.getElementById('callout').hidden ? '' : document.getElementById('callout').textContent }));
    expect(s.sel === 'q3-pl' && s.cubeSel === null, `selection kept as ${s.sel}, cube ${s.cubeSel}`);
    expect(/Not created yet/.test(s.insp) && /Go to Q3 2026/.test(s.insp), 'inspector does not explain the absence');
    expect(/3 files not created yet/.test(s.callout), 'Q1 callout missing');
    await page.click('#inspector [data-time="2"]'); await sleep(700);
    const t = await page.evaluate(() => ({ q: Proto.state.q, sel: Proto.cube.state.selected }));
    expect(t.q === 2 && t.sel === 'q3-pl', `Go to Q3 → q ${t.q}, selected ${t.sel}`);
    // archived in Q4: the row fades and the inspector says so
    await page.evaluate(() => { Proto.setTime(3); Proto.select('acme-nda'); }); await sleep(900);
    const a = await page.evaluate(() => ({ row: document.querySelector('#cube-stage .face.front .fb .row.arch[data-id="acme-nda"]') !== null, insp: document.getElementById('inspector').textContent, tags: [...document.querySelectorAll('#caps .wl-tag')].map((n) => n.textContent).join(' | ') }));
    expect(a.row && /Archived/.test(a.insp), 'archived file not shown as archived');
    expect(/Still active/.test(a.tags), `world-line label for the archived file: ${a.tags}`);
  });

  await step('timeline dots scrub time and list what changed', async () => {
    await page.evaluate(() => { Proto.setTime(2); Proto.select('acme-sow-q3'); }); await sleep(700);
    const s = await page.evaluate(() => ({ dots: document.querySelectorAll('#timeline .tl-q').length, has: [...document.querySelectorAll('#timeline .tl-q')].map((d) => d.className.replace('tl-q', '').trim()), events: [...document.querySelectorAll('#timeline .tl-ev li')].map((l) => l.textContent) }));
    expect(s.dots === 4, `${s.dots} dots`);
    expect(/created/.test(s.has[0]) && /has/.test(s.has[1]) && /has/.test(s.has[2]) && /has/.test(s.has[3]), `dot classes ${JSON.stringify(s.has)}`);
    expect(s.events.length === 4 && /Justin\s*→\s*Priya/.test(s.events[1]) && /Signed/.test(s.events[3]), `events ${JSON.stringify(s.events)}`);
    await page.click('#timeline .tl-q[data-time="3"]'); await sleep(700);
    const t = await page.evaluate(() => ({ q: Proto.state.q, cur: document.querySelector('#timeline .tl-q.cur')?.getAttribute('data-time'), status: document.querySelector('#homes .home[data-axis="status"] .val')?.textContent }));
    expect(t.q === 3 && t.cur === '3' && /Signed/.test(t.status), JSON.stringify(t));
    await page.click('#timeline .tl-ev li[data-time="1"]'); await sleep(600);
    expect((await page.evaluate(() => Proto.state.q)) === 1, 'clicking a timeline event did not scrub');
    return `${s.events.length} events`;
  });

  await step('Diff panel lists Added / Changed / Archived, rows select files, axis bar drawn', async () => {
    await page.evaluate(() => Proto.setTime(2)); await sleep(400);
    await page.click('#diff-btn'); await sleep(300);
    let s = await page.evaluate(() => ({ tab: Proto.state.tab, pressed: document.getElementById('diff-btn').getAttribute('aria-pressed'), from: document.getElementById('diff-from').value, to: document.getElementById('diff-to').value, text: document.getElementById('inspector').textContent, rows: document.querySelectorAll('#inspector .drow').length, bar: document.querySelectorAll('#inspector .dbar i').length, leg: document.querySelector('#inspector .dleg')?.textContent }));
    expect(s.tab === 'diff' && s.pressed === 'true' && s.from === '1' && s.to === '2', `diff ${s.from}→${s.to}, tab ${s.tab}`);
    expect(/2 added/.test(s.text) && /Acme renewal deck/.test(s.text) && /Q3 P&L/.test(s.text), 'added files missing');
    expect(/Changed/.test(s.text) && /DPA — Acme/.test(s.text) && /none\s*→\s*Acme/.test(s.text), 'changed files missing');
    expect(s.rows >= 12 && s.bar >= 4 && /Client/.test(s.leg) && /Status/.test(s.leg), `${s.rows} rows, ${s.bar} bar segments, legend ${s.leg}`);
    await page.click('#inspector .drow[data-select="q3-pricing"]'); await sleep(600);
    s = await page.evaluate(() => ({ sel: Proto.state.selected, hl: !!document.querySelector('#inspector .drow.sel[data-select="q3-pricing"]'), cubeSel: !!document.querySelector('#cube-stage .face.right .row.sel[data-id="q3-pricing"]') }));
    expect(s.sel === 'q3-pricing' && s.hl && s.cubeSel, JSON.stringify(s));
    await page.selectOption('#diff-to', '3'); await sleep(300);
    s = await page.evaluate(() => ({ from: Proto.state.diffFrom, to: Proto.state.diffTo, text: document.getElementById('inspector').textContent }));
    expect(s.from === 1 && s.to === 3 && /2 archived/.test(s.text) && /Acme NDA/.test(s.text) && /Brand refresh/.test(s.text), `Q2→Q4 archived list: ${s.from}→${s.to}`);
    await page.click('#diff-swap'); await sleep(200);
    expect((await page.evaluate(() => [Proto.state.diffFrom, Proto.state.diffTo].join())) === '3,1', 'swap did not swap');
    await page.evaluate(() => Proto.setDiff(1, 1)); await sleep(200);
    expect(/two different quarters/.test(await page.textContent('#inspector')), 'same-quarter diff has no empty state');
    await page.evaluate(() => { Proto.setDiff(1, 2); Proto.openDiff(false); }); await sleep(200);
    expect((await page.evaluate(() => Proto.state.tab)) === 'file', 'diff did not close');
  });

  await step('Pin this moment freezes a ghost, badged, that survives scrubbing away', async () => {
    await page.evaluate(() => { Proto.setTime(0); Proto.select('acme-msa-v4'); }); await sleep(500);
    await page.click('#pin-btn'); await sleep(400);
    let s = await page.evaluate(() => ({ pinned: Proto.state.pinned, pressed: document.getElementById('pin-btn').getAttribute('aria-pressed'), label: document.getElementById('pin-btn').textContent, live: !!document.querySelector('#caps .gcap.live'), toast: document.getElementById('toast').textContent }));
    expect(s.pinned === 0 && s.pressed === 'true' && /Pinned Q1 2026/.test(s.label) && s.live && /Pinned/.test(s.toast), JSON.stringify(s));
    await page.evaluate(() => Proto.setTime(3)); await sleep(900);
    s = await page.evaluate(() => ({ L: Proto.ghosts.L.q, R: Proto.ghosts.R.q, pinnedCls: document.getElementById('ghost-l').classList.contains('pinned'), cap: [...document.querySelectorAll('#caps .gcap')].map((n) => n.textContent).join(' | '), rows: document.querySelectorAll('#ghost-l .face.front .fb .row').length, tick: !!document.querySelector('#track .tick.pin[data-q="0"]'), moment: /pinned/.test(document.getElementById('moments').textContent), lines: document.querySelectorAll('#worldlines path').length }));
    expect(s.L === 0 && s.R === null && s.pinnedCls, `slots L ${s.L} R ${s.R}, pinned class ${s.pinnedCls}`);
    expect(/Pinned/.test(s.cap) && /Q1 2026/.test(s.cap) && /3 quarters back/.test(s.cap), `caption ${s.cap}`);
    expect(s.rows === 22 && s.tick && s.moment, `pinned ghost has ${s.rows} rows, tick ${s.tick}, moment ${s.moment}`);
    expect(s.lines >= 1, 'no world lines to the pinned ghost');
    // ghosts off keeps the pinned one
    await page.evaluate(() => Proto.setGhosts(false)); await sleep(300);
    expect(await page.evaluate(() => !document.getElementById('ghost-l').classList.contains('off') && Proto.ghosts.L.isPin), 'pinned ghost hid with the others');
    await page.evaluate(() => Proto.setGhosts(true)); await sleep(200);
    await page.evaluate(() => Proto.setTime(2)); await sleep(500);
    expect((await page.evaluate(() => [Proto.ghosts.L.q, Proto.ghosts.R.q].join())) === '0,3', 'pinned Q1 should take the left slot at Q3');
    await page.click('#pin-btn'); await sleep(200);
    expect((await page.evaluate(() => Proto.state.pinned)) === null, 'did not unpin');
    expect((await page.evaluate(() => [Proto.ghosts.L.q, Proto.ghosts.R.q].join())) === '1,3', 'ghosts did not return to prev/next');
  });

  await step('play loops through all four quarters and wraps', async () => {
    await page.evaluate(() => Proto.setTime(3)); await sleep(300);
    await page.click('#play-btn'); await sleep(200);
    expect(await page.evaluate(() => Proto.state.playing && /playing/.test(document.getElementById('sbar').textContent)), 'not playing');
    await sleep(2700);
    expect((await page.evaluate(() => Proto.state.q)) === 0, 'did not wrap from Q4 to Q1');
    await sleep(2500);
    expect((await page.evaluate(() => Proto.state.q)) === 1, 'did not advance to Q2');
    await page.click('#play-btn'); await sleep(100);
    expect(!(await page.evaluate(() => Proto.state.playing)), 'did not pause');
    await page.evaluate(() => Proto.setTime(2)); await sleep(300);
  });

  await step('a hidden axis can be put on the top face; ghosts follow', async () => {
    await page.click('#chips-hidden .chip[data-axis="status"]'); await sleep(700);
    const s = await page.evaluate(() => ({ top: Proto.cube.state.faces.top, gtop: Proto.ghosts.L.api.state.faces.top, header: document.querySelector('#cube-stage .face.top .fh').textContent, hidden: document.getElementById('chips-hidden').textContent }));
    expect(s.top === 'status' && s.gtop === 'status' && /By Status/.test(s.header) && /Type/.test(s.hidden), JSON.stringify(s));
    await page.evaluate(() => Proto.cube.showAxis('type', 'top', { silent: true })); await sleep(500);
  });

  await step('search dims non-matching rows and the status bar reports matches', async () => {
    await page.fill('#search', 'acme'); await sleep(200);
    const s = await page.evaluate(() => ({ dim: document.querySelectorAll('#cube-stage .face.front .row.dim').length, bright: document.querySelectorAll('#cube-stage .face.front .row:not(.dim)').length, bar: document.getElementById('sbar').textContent }));
    expect(s.dim > 10 && s.bright === 8 && /8 of 25/.test(s.bar), `${s.bright} bright / ${s.dim} dim, bar "${s.bar.slice(0, 40)}"`);
    await page.fill('#search', ''); await page.keyboard.press('Escape'); await sleep(200);
  });

  await step('theme toggles to light and back', async () => {
    const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#theme-btn'); await sleep(250);
    const s = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('tesseract.theme'), title: document.getElementById('theme-btn').title, gop: getComputedStyle(document.getElementById('ghost-l')).opacity }));
    expect(s.t === 'light' && s.bg !== bg0 && s.stored === 'light' && /dark/.test(s.title) && +s.gop > 0.3, JSON.stringify(s));
    await page.click('#theme-btn'); await sleep(200);
    expect(await page.getAttribute('html', 'data-theme') === 'dark', 'did not return to dark');
  });

  await step('the strip’s About popover renders the template', async () => {
    await page.click('#pnav-about'); await sleep(250);
    const s = await page.evaluate(() => ({ open: !document.getElementById('pnav-pop').hidden, text: document.getElementById('pnav-pop').textContent }));
    expect(s.open && /fourth axis/.test(s.text) && /world lines/.test(s.text) && /Pin this moment/.test(s.text), 'about popover incomplete');
    await page.keyboard.press('Escape'); await sleep(150);
    expect(await page.evaluate(() => document.getElementById('pnav-pop').hidden), 'Escape did not close the popover');
  });

  /* ---- tour ---- */
  console.log('\nTour');
  await step('tour opens from the top bar with 7 steps and spotlights its target', async () => {
    await page.evaluate(() => { Proto.select(null); Proto.setTime(2); }); await sleep(300);
    await page.click('#tour-btn'); await sleep(500);
    const s = await page.evaluate(() => ({ open: !document.getElementById('tut').hidden, ring: !document.getElementById('tut-ring').hidden, step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, n: Proto.tour.steps.length }));
    expect(s.open && s.ring && /1 \/ 7/.test(s.step) && s.n === 7, JSON.stringify(s));
    return s.title;
  });

  await step('tour panel drags by its header and stays in bounds', async () => {
    const h = await page.locator('#tut-h').boundingBox();
    const before = await page.locator('#tut').boundingBox();
    await dragMouse(page, { x: h.x + 60, y: h.y + h.height / 2 }, { x: h.x + 360, y: h.y + h.height / 2 - 200 });
    await sleep(100);
    const after = await page.locator('#tut').boundingBox();
    expect(Math.abs(after.x - before.x - 300) < 4 && Math.abs(after.y - before.y + 200) < 4, `moved by ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}`);
    const h2 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h2.x + 60, y: h2.y + h2.height / 2 }, { x: 1430, y: 890 });
    await sleep(100);
    const far = await page.locator('#tut').boundingBox();
    expect(far.x + far.width <= 1440 && far.y + far.height <= 900 && far.x >= 0 && far.y >= 0, `out of bounds: ${JSON.stringify(far)}`);
    const h3 = await page.locator('#tut-h').boundingBox();
    await dragMouse(page, { x: h3.x + 60, y: h3.y + h3.height / 2 }, { x: 80, y: 520 });
    await sleep(100);
  });

  await step('every action step blocks Next until done, and “Do it for me” completes it', async () => {
    const titles = [];
    for (let i = 0; i < 7; i++) {
      const s = await page.evaluate(() => ({ step: document.getElementById('tut-step').textContent, title: document.querySelector('#tut h2').textContent, hasTask: !!document.getElementById('tut-task'), nextDisabled: document.getElementById('tut-next').disabled, doit: !!document.getElementById('tut-doit'), next: document.getElementById('tut-next').textContent }));
      expect(s.step.startsWith(`${i + 1} /`), `expected step ${i + 1}, at "${s.step}"`);
      titles.push(s.title);
      if (s.hasTask) {
        expect(s.nextDisabled && s.doit, `step ${i + 1}: Next should wait for the action`);
        await page.click('#tut-doit');
        await page.waitForFunction(() => !document.getElementById('tut-next').disabled, null, { timeout: 4000 });
        await sleep(900);
        expect(await page.evaluate(() => document.getElementById('tut-task').classList.contains('done')), `step ${i + 1}: task not marked done`);
      }
      if (i === 2) expect((await groupOf(page, 'acme-msa-v4')) === 'Legal' && (await page.evaluate(() => Proto.state.selected)) === 'acme-msa-v4', 'step 3 did not move Acme MSA into Legal');
      if (i === 3) expect((await page.evaluate(() => document.querySelectorAll('#worldlines path').length)) >= 3, 'step 4 shows no world lines');
      if (i === 4) expect((await page.evaluate(() => Proto.state.tab)) === 'diff', 'step 5 did not open the diff');
      if (i === 5) expect((await page.evaluate(() => Proto.state.pinned)) !== null, 'step 6 did not pin');
      if (i === 6) { expect(s.next === 'Done', `last button says ${s.next}`); expect(await page.evaluate(() => Proto.state.playing), 'step 7 did not start playing'); }
      await page.click('#tut-next'); await sleep(500);
    }
    expect(await page.isHidden('#tut'), 'tour did not close on Done');
    expect(!(await page.evaluate(() => Proto.state.playing)), 'closing the tour should pause playback');
    expect(await page.evaluate(() => localStorage.getItem('tesseract.tour.seen')) === '1', 'seen flag not stored');
    return titles.length + ' steps: ' + titles.join(' · ');
  });

  await step('a returning visitor does not get the tour again, ? reopens it, ?q= deep-links a quarter', async () => {
    await page.goto(URL + '?q=2026-Q2', { waitUntil: 'load' }); await sleep(900);
    expect(await page.isHidden('#tut'), 'tour auto-opened on a return visit');
    expect((await page.evaluate(() => Proto.state.q)) === 1, '?q=2026-Q2 did not open at Q2');
    await page.keyboard.press('?'); await sleep(300);
    expect(await page.isVisible('#tut'), '? did not open the tour');
    await page.keyboard.press('?'); await sleep(200);
    await page.evaluate(() => { Proto.pin(false); Proto.setTime(2); });
  });

  await step('no console errors or failed requests during the whole run', async () => { expect(log.length === 0, log.slice(0, 5).join(' | ')); });
  await ctx.close();

  /* ---------------- 3. screenshots (2×) ---------------- */
  console.log('\nScreenshots');
  const shotsDir = path.join(ROOT, 'shots'); mkdirSync(shotsDir, { recursive: true });
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const sp = (await open(sctx)).page;
  await step('shots/proto-tesseract*.png', async () => {
    await sp.evaluate(() => { Proto.setTime(1); Proto.select('acme-msa-v4'); }); await sleep(1500);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-tesseract.png') });
    await sp.evaluate(() => { Proto.setTime(2); Proto.openDiff(true); }); await sleep(900);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-tesseract-diff.png') });
    await sp.evaluate(() => { Proto.openDiff(false); Proto.select('acme-msa-v4'); Proto.setTime(1); try { localStorage.removeItem('tesseract.tour.pos'); } catch (e) {} Proto.tour.open(3); }); await sleep(900);
    await sp.screenshot({ path: path.join(shotsDir, 'proto-tesseract-tour.png') });
    await sp.evaluate(() => Proto.tour.close());
    return 'hero, diff, tour';
  });
  await sctx.close();

  /* ---------------- 4. walkthrough video ---------------- */
  if (!noVideo) {
    console.log('\nVideo');
    const vdir = path.join(ROOT, 'prototype', 'tesseract', '.video-tmp');
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: vdir, size: { width: 1440, height: 900 } } });
    const vp = (await open(vctx)).page;
    await step('record walkthrough', async () => {
      const ev = (js) => vp.evaluate(js);
      await sleep(800);
      // 1 scrub back to Q1 with the keyboard, then drag forward
      await vp.mouse.click(700, 885);
      await vp.keyboard.press('ArrowLeft'); await sleep(1000);
      await vp.keyboard.press('ArrowLeft'); await sleep(1200);
      const tr = await vp.locator('#track').boundingBox();
      await dragMouse(vp, { x: tr.x + 2, y: tr.y + 21 }, { x: tr.x + tr.width, y: tr.y + 21 }, 40); await sleep(1400);
      // 2 select a file with history and step through its life
      await ev(() => Proto.setTime(0)); await sleep(1000);
      await vp.click('#cube-stage .face.front .fb .row[data-id="acme-msa-v4"]'); await sleep(1500);
      await vp.keyboard.press('ArrowRight'); await sleep(1800);
      // 3 rotate: the ghosts follow
      await dragMouse(vp, { x: 620, y: 620 }, { x: 760, y: 580 }, 24); await sleep(1400);
      await ev(() => Proto.cube.snap('iso')); await sleep(900);
      // 4 timeline dot
      await vp.click('#timeline .tl-q[data-time="3"]'); await sleep(1600);
      // 5 diff
      await vp.click('#diff-btn'); await sleep(1000);
      await ev(() => Proto.setDiff(2, 3)); await sleep(900);
      await vp.click('#inspector .drow[data-select="acme-nda"]'); await sleep(1500);
      await vp.click('#diff-btn'); await sleep(800);
      // 6 pin and compare
      await ev(() => Proto.setTime(0)); await sleep(1000);
      await vp.click('#pin-btn'); await sleep(1200);
      await ev(() => Proto.setTime(3)); await sleep(1800);
      await vp.click('#pin-btn'); await sleep(800);
      // 7 ghosts off/on
      await vp.click('#ghosts-btn'); await sleep(800);
      await vp.click('#ghosts-btn'); await sleep(800);
      // 8 play a loop
      await vp.click('#play-btn'); await sleep(5400);
      await vp.click('#play-btn'); await sleep(600);
      // 9 tour
      await ev(() => { try { localStorage.removeItem('tesseract.tour.pos'); } catch (e) {} Proto.tour.open(0); }); await sleep(1600);
      await vp.click('#tut-next'); await sleep(700);
      await vp.click('#tut-doit'); await sleep(1400); await vp.click('#tut-next'); await sleep(700);
      await vp.click('#tut-doit'); await sleep(1600); await vp.click('#tut-next'); await sleep(1200);
      await ev(() => Proto.tour.close()); await sleep(400);
      // 10 light theme, end
      await vp.click('#theme-btn'); await sleep(1100);
      await vp.click('#theme-btn'); await sleep(600);
    });
    const video = vp.video();
    await vctx.close();
    await step('save prototype/tesseract/walkthrough.webm', async () => {
      const src = await video.path();
      const dest = path.join(ROOT, 'prototype', 'tesseract', 'walkthrough.webm');
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
