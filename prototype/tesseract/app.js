/* app.js — Tesseract prototype: the Facet cube with time as a fourth axis.
   One live cube (shared engine) over the snapshot for the current quarter, two
   ghost cubes for the neighbouring quarters (or a pinned moment) receding
   behind it, world lines from the selected file to its ghost positions, a
   scrubber, a diff panel and a per-file timeline. Exposes window.Proto. */
import '../shared/icons.js';
import data, { axes, kinds, people, baseline, filesAt, diff, QUARTERS, NOW, quarterLabel, quarterIndex } from '../shared/data.js';
import { createCube, esc } from '../shared/cube.js';
import { createTour } from '../shared/tour.js';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const FACES = ['front', 'right', 'top'];
const FACE_LABEL = { front: 'Front', right: 'Right', top: 'Top' };
const NOW_I = quarterIndex(NOW);
const STEP_MS = 2500;
const CUBE_SIZE = { min: 300, max: 560, w: 0.44, h: 0.5 };
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const axesById = {}; axes.forEach((a) => { axesById[a.id] = a; });
const baseById = {}; baseline.forEach((r) => { baseById[r.id] = r; });
const SNAP = QUARTERS.map((q) => filesAt(q));                       // the four snapshots, immutable here
const byId = SNAP.map((list) => { const m = {}; list.forEach((f) => { m[f.id] = f; }); return m; });
const qLabel = (i) => quarterLabel(QUARTERS[i]);
const short = (i) => QUARTERS[i].split('-')[1];

/* ---- state ---- */
const state = {
  q: NOW_I, t: NOW_I, files: SNAP[NOW_I], selected: null, playing: false, ghosts: true, pinned: null,
  tab: 'file', diffFrom: NOW_I - 1, diffTo: NOW_I, query: '', theme: 'dark'
};

/* ---- event bus (the tour listens here; cube events are forwarded) ---- */
const listeners = {};
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); }
function emit(ev, d) { (listeners[ev] || []).slice().forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); }

/* ---- rows: archived files fade, files born this quarter get a tag ---- */
function rowHTMLFor(quarterOf) {
  return (f) => {
    const k = kinds[f.kind] || { th: 'doc', label: '' };
    const qi = quarterOf();
    const tag = f.archivedAt ? '<span class="rtag arch">Archived</span>' : (qi > 0 && f.created === QUARTERS[qi] ? '<span class="rtag new">New</span>' : '');
    const title = `${f.name} · ${k.label} · ${f.size}${f.archivedAt ? ' · archived in ' + quarterLabel(f.archivedAt) : ''}${qi > 0 && f.created === QUARTERS[qi] ? ' · created this quarter' : ''}`;
    return `<div class="row${f.archivedAt ? ' arch' : ''}" data-id="${esc(f.id)}" role="button" tabindex="-1" title="${esc(title)}"><span class="th ${k.th}"></span><span class="nm">${esc(f.name)}</span>${tag}</div>`;
  };
}

/* ---- the live cube ---- */
const liveStage = $('#cube-stage');
const cube = createCube(liveStage, {
  files: state.files, axes, kinds,
  faces: { front: 'project', right: 'client', top: 'type' },
  controls: true, keys: false, size: CUBE_SIZE, rowHTML: rowHTMLFor(() => state.q),
  controlsExtra: '<button class="btn tog" id="ghosts-btn" type="button" aria-pressed="true" title="Show the previous and next quarter as ghost cubes (G)"><svg class="ic"><use href="#i-layers"/></svg>Ghosts<kbd>G</kbd></button>' +
    '<button class="btn tog" id="pin-btn" type="button" aria-pressed="false" title="Pin this moment as a ghost to compare against (P)"><svg class="ic" viewBox="0 0 16 16"><path d="M9.5 2.5l4 4-2.2.6-2.6 2.6.3 2.8-1.6-1.6L4 14.3 1.7 12l3.4-3.4L3.5 7l2.8.3 2.6-2.6z"/></svg>Pin this moment<kbd>P</kbd></button>'
});

/* ---- the ghost cubes: slot L (earlier) and slot R (later) ---- */
function makeGhost(id) {
  const stage = $(id);
  const g = { stage, q: null, api: null };
  g.api = createCube(stage, {
    files: [], axes, kinds, faces: { ...cube.state.faces },
    controls: false, keys: false, size: CUBE_SIZE, hoverLights: false, connectors: false, acceptDrops: false, dblclickGroup: false,
    rowHTML: rowHTMLFor(() => (g.q === null ? 0 : g.q))
  });
  stage.classList.add('empty');
  return g;
}
const ghosts = { L: makeGhost('#ghost-l'), R: makeGhost('#ghost-r') };
const ghostList = [ghosts.L, ghosts.R];
const tstage = $('#tstage');
const capsEl = $('#caps');
const wlEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
wlEl.setAttribute('class', 'worldlines'); wlEl.setAttribute('aria-hidden', 'true'); wlEl.id = 'worldlines';
liveStage.appendChild(wlEl);

function ghostSlots() {
  const q = state.q, p = state.pinned;
  const L = p !== null && p < q ? p : (q > 0 ? q - 1 : null);
  const R = p !== null && p > q ? p : (q < QUARTERS.length - 1 ? q + 1 : null);
  return { L, R };
}
function updateGhosts() {
  const slots = ghostSlots();
  ['L', 'R'].forEach((side) => {
    const g = ghosts[side], qi = slots[side];
    const isPin = qi !== null && state.pinned === qi && state.pinned !== state.q;
    const shown = qi !== null && (state.ghosts || isPin);
    if (g.q !== qi) {
      g.q = qi;
      g.api.setFiles(qi === null ? [] : SNAP[qi]);
      if (state.selected && qi !== null && byId[qi][state.selected]) g.api.select(state.selected);
    }
    const dist = qi === null ? 1 : Math.abs(qi - state.q);
    const scale = dist >= 3 ? 0.4 : dist === 2 ? 0.44 : 0.5;
    const gx = (side === 'L' ? -1 : 1) * (dist >= 2 ? 38 : 35);
    g.stage.style.setProperty('--gx', gx + '%');
    g.stage.style.setProperty('--gy', (dist >= 2 ? -9 : -7) + '%');
    g.stage.style.setProperty('--gs', String(scale));
    g.stage.classList.toggle('empty', qi === null);
    g.stage.classList.toggle('off', !shown);
    g.stage.classList.toggle('pinned', isPin);
    g.shown = shown && qi !== null;
    g.isPin = isPin;
  });
  markWL(900);
}
cube.on('rotate', ({ rx, ry, snap }) => {
  const anim = cube.el.classList.contains('animating');
  ghostList.forEach((g) => g.api.setRotation(rx, ry, anim, snap));
  tstage.setAttribute('data-snap', snap);
  markWL(anim ? 700 : 120);
});
cube.on('layout', () => markWL(400));
cube.on('axisSwap', () => { ghostList.forEach((g) => g.api.setFaces({ ...cube.state.faces })); renderChips(); renderInspector(); renderStatus(); applyQuery(); markWL(600); });
liveStage.addEventListener('scroll', () => markWL(160), true);

/* ---- world lines: the selected file's row on the live cube joined to its rows in the ghosts ---- */
let wlDirtyUntil = 0;
function markWL(ms) { wlDirtyUntil = Math.max(wlDirtyUntil, performance.now() + (ms || 0)); }
function nodeRect(api, face, id, st) {
  const el = api.faceEls[face];
  const fr = el.getBoundingClientRect();
  if (fr.width < 40 || fr.height < 40) return null;
  const tiles = face === 'top' && api.el.getAttribute('data-topmode') === 'tiles';
  const node = tiles ? el.querySelector('.tiles [data-id="' + id + '"]') : el.querySelector('.fb .row[data-id="' + id + '"]');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (!r.width) return null;
  const box = (tiles ? el : node.closest('.fb') || el).getBoundingClientRect();
  if (r.top < box.top - 2 || r.bottom > box.bottom + 2) return null;
  return { l: r.left - st.left, r: r.right - st.left, t: r.top - st.top, b: r.bottom - st.top, cx: (r.left + r.right) / 2 - st.left, cy: (r.top + r.bottom) / 2 - st.top };
}
function unionRect(api, st) {
  let u = null;
  FACES.forEach((f) => {
    const r = api.faceEls[f].getBoundingClientRect(); if (r.width < 20) return;
    u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  if (!u) return null;
  return { l: u.left - st.left, t: u.top - st.top, r: u.right - st.left, b: u.bottom - st.top, cx: (u.left + u.right) / 2 - st.left, cy: (u.top + u.bottom) / 2 - st.top };
}
const fmtVal = (v) => (v === null || v === undefined ? 'none' : v);
function changeQuarter(id, axisId, a, b) { // the quarter (between a and b, inclusive of the later) where the fact last changed
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = hi; i > lo; i--) { const x = byId[i][id], y = byId[i - 1][id]; if (!x || !y) return i; if ((x.axes[axisId] || null) !== (y.axes[axisId] || null)) return i; }
  return hi;
}
function drawWorldLines() {
  const id = state.selected;
  const snapOk = cube.state.snap === 'iso' || cube.state.snap === 'free';
  const st = liveStage.getBoundingClientRect();
  let paths = '', caps = '';
  const tags = [];
  // captions above the ghosts (and a pin badge on the live cube when the pinned moment is the current one)
  ghostList.forEach((g) => {
    if (!g.shown || !snapOk) return;
    const u = unionRect(g.api, st); if (!u) return;
    const n = SNAP[g.q].length, arch = SNAP[g.q].filter((f) => f.archivedAt).length;
    const rel = g.q < state.q ? (state.q - g.q === 1 ? 'previous' : `${state.q - g.q} quarters back`) : (g.q - state.q === 1 ? 'next' : `${g.q - state.q} quarters ahead`);
    caps += `<div class="gcap" style="left:${u.cx.toFixed(1)}px;top:${(u.t - 10).toFixed(1)}px">${g.isPin ? '<span class="pinb"><svg viewBox="0 0 16 16"><path d="M9.5 2.5l4 4-2.2.6-2.6 2.6.3 2.8-1.6-1.6L4 14.3 1.7 12l3.4-3.4L3.5 7l2.8.3 2.6-2.6z"/></svg>Pinned</span>' : '<i></i>'}<b>${qLabel(g.q)}</b><span>${rel} · ${n} files${arch ? ' · ' + arch + ' archived' : ''}</span></div>`;
  });
  if (state.pinned === state.q && snapOk) {
    const u = unionRect(cube, st);
    if (u) caps += `<div class="gcap live" style="left:${u.cx.toFixed(1)}px;top:${(u.t - 10).toFixed(1)}px"><span class="pinb"><svg viewBox="0 0 16 16"><path d="M9.5 2.5l4 4-2.2.6-2.6 2.6.3 2.8-1.6-1.6L4 14.3 1.7 12l3.4-3.4L3.5 7l2.8.3 2.6-2.6z"/></svg>Pinned</span><b>${qLabel(state.q)}</b><span>scrub away to compare</span></div>`;
  }
  if (id && snapOk) {
    const live = byId[state.q][id];
    ghostList.forEach((g) => {
      if (!g.shown) return;
      const side = g === ghosts.L ? 'L' : 'R';
      const gf = byId[g.q][id];
      let linked = false;
      if (gf && live) {
        FACES.forEach((face) => {
          const a = nodeRect(cube, face, id, st); if (!a) return;
          const b = nodeRect(g.api, face, id, st); if (!b) return;
          linked = true;
          const axisId = cube.state.faces[face], ax = axesById[axisId];
          const from = gf.axes[axisId] || null, to = live.axes[axisId] || null;
          const changed = from !== to;
          const p1 = side === 'L' ? { x: a.l + 3, y: a.cy } : { x: a.r - 3, y: a.cy };
          const p2 = side === 'L' ? { x: b.r - 1, y: b.cy } : { x: b.l + 1, y: b.cy };
          paths += seg(p1, p2, changed ? ax.color : null, changed ? 'chg' : '');
          if (changed) {
            const later = Math.max(g.q, state.q), earlier = Math.min(g.q, state.q);
            const cq = changeQuarter(id, axisId, earlier, later);
            const fv = g.q < state.q ? from : to, tv = g.q < state.q ? to : from;
            tags.push({ side, x: p1.x + (p2.x - p1.x) * 0.72, y: p1.y + (p2.y - p1.y) * 0.72, html: `<i></i><b>${esc(ax.label)}</b>${esc(fmtVal(fv))}<span class="arr">→</span>${esc(fmtVal(tv))}<small>in ${qLabel(cq)}</small>`, c: ax.color });
          }
        });
        if (linked && (!!gf.archivedAt) !== (!!live.archivedAt)) {
          const u = unionRect(g.api, st);
          if (u) tags.push({ side, x: u.cx, y: u.b + 16, html: `<i></i>${gf.archivedAt ? 'Archived in ' + quarterLabel(gf.archivedAt) : 'Still active here'}`, c: '#f5b544' });
        }
      }
      if (!linked) {
        const a = nodeRect(cube, 'front', id, st) || nodeRect(cube, 'right', id, st) || nodeRect(cube, 'top', id, st);
        const u = unionRect(g.api, st);
        if (a && u) {
          const p1 = side === 'L' ? { x: a.l + 3, y: a.cy } : { x: a.r - 3, y: a.cy };
          const p2 = { x: u.cx, y: u.cy };
          paths += seg(p1, p2, null, 'abs');
          const rec = baseById[id];
          const why = !gf ? `Not created yet · created in ${quarterLabel(rec.created)}` : (live ? 'Row out of view on this face' : 'Not created yet');
          tags.push({ side, x: u.cx, y: u.cy, html: `<i></i>${why}`, c: null, abs: true });
        }
      }
    });
  }
  // spread labels that would overlap on the same side
  ['L', 'R'].forEach((side) => {
    const list = tags.filter((t) => t.side === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i++) if (list[i].y - list[i - 1].y < 26) list[i].y = list[i - 1].y + 26;
  });
  wlEl.innerHTML = paths;
  capsEl.innerHTML = caps + tags.map((t) => `<div class="wl-tag${t.abs ? ' abs' : ''}" style="left:${t.x.toFixed(1)}px;top:${t.y.toFixed(1)}px${t.c ? ';--c:' + t.c : ''}">${t.html}</div>`).join('');
  // keep captions and labels inside the stage
  Array.from(capsEl.children).forEach((n) => {
    const r = n.getBoundingClientRect();
    let dx = 0;
    if (r.left < st.left + 8) dx = st.left + 8 - r.left; else if (r.right > st.right - 8) dx = st.right - 8 - r.right;
    if (dx) n.style.left = (parseFloat(n.style.left) + dx).toFixed(1) + 'px';
    if (r.top < st.top + 6) n.style.top = (parseFloat(n.style.top) + (st.top + 6 - r.top)).toFixed(1) + 'px';
  });
}
function seg(a, b, color, cls) {
  const dx = b.x - a.x;
  const c1 = { x: a.x + dx * 0.45, y: a.y }, c2 = { x: a.x + dx * 0.55, y: b.y };
  const style = color ? ` style="--c:${color}"` : '';
  return `<g${style}><path class="${cls}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/><circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="3.2"/><circle class="end" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="3"/></g>`;
}
(function loop() { if (performance.now() < wlDirtyUntil) drawWorldLines(); requestAnimationFrame(loop); })();

/* ---- time ---- */
function captureTops() { const m = {}; FACES.forEach((face) => { m[face] = {}; $$('.fb .row', cube.faceEls[face]).forEach((r) => { m[face][r.getAttribute('data-id')] = r.offsetTop; }); }); return m; }
function flipAll(before, d) {
  const changedByAxis = {};
  if (d) d.changed.forEach((c) => { (changedByAxis[c.axis] = changedByAxis[c.axis] || {})[c.id] = 1; });
  FACES.forEach((face) => {
    const el = cube.faceEls[face], axisId = cube.state.faces[face], moved = changedByAxis[axisId] || {};
    const rows = $$('.fb .row', el), anim = [];
    rows.forEach((r) => {
      const id = r.getAttribute('data-id');
      if (!(id in before[face])) { r.classList.add('born'); return; }
      if (reduced) return;
      const dy = before[face][id] - r.offsetTop;
      if (Math.abs(dy) < 1) return;
      r.style.transition = 'none'; r.style.transform = `translateY(${dy}px)`;
      anim.push(r);
    });
    void el.offsetHeight;
    requestAnimationFrame(() => {
      anim.forEach((r) => { r.style.transition = 'transform 460ms cubic-bezier(.2,.7,.2,1)'; r.style.transform = ''; });
      rows.forEach((r) => { if (moved[r.getAttribute('data-id')]) r.classList.add('tmoved'); });
      setTimeout(() => anim.forEach((r) => { r.style.transition = ''; }), 500);
    });
  });
  cube.markConn(700);
}
function setTime(i, opts = {}) {
  i = Math.max(0, Math.min(QUARTERS.length - 1, Math.round(i)));
  if (!opts.keepT) state.t = i;
  if (i === state.q && !opts.force) { renderTimebar(); return; }
  const prevQ = state.q;
  state.q = i; state.files = SNAP[i];
  const d = diff(QUARTERS[prevQ], QUARTERS[i]);
  const before = captureTops();
  cube.setFiles(state.files);
  if (state.selected && cube.state.selected !== state.selected && byId[i][state.selected]) cube.select(state.selected, { source: 'time' });
  flipAll(before, d);
  updateGhosts();
  applyQuery();
  renderTimebar(); renderMoments(); renderInspector(); renderStatus(); renderCallout(prevQ);
  try { const u = new URL(location.href); u.searchParams.set('q', QUARTERS[i]); history.replaceState(null, '', u); } catch (e) { /* ignore */ }
  emit('time', { q: i, quarter: QUARTERS[i], from: prevQ, added: d.added.length, changed: d.changed.length, archived: d.archived.length });
}
function step(dir) { setTime(state.q + dir); }

/* ---- play ---- */
let playTimer = 0;
function play(v) {
  const next = typeof v === 'boolean' ? v : !state.playing;
  if (next === state.playing) return;
  state.playing = next;
  clearInterval(playTimer);
  if (next) playTimer = setInterval(() => setTime((state.q + 1) % QUARTERS.length), reduced ? STEP_MS * 1.4 : STEP_MS);
  const b = $('#play-btn'); b.setAttribute('aria-pressed', String(next)); b.title = next ? 'Pause (Space)' : 'Play through the quarters (Space)'; b.setAttribute('aria-label', b.title);
  $('#timebar').classList.toggle('playing', next);
  renderStatus();
  emit('play', { playing: next });
}
$('#play-btn').addEventListener('click', () => play());

/* ---- ghosts + pin ---- */
function setGhosts(v) {
  state.ghosts = typeof v === 'boolean' ? v : !state.ghosts;
  $('#ghosts-btn').setAttribute('aria-pressed', String(state.ghosts));
  updateGhosts(); renderStatus();
  emit('ghosts', { on: state.ghosts });
}
function pin(v) {
  if (v === false || (v === undefined && state.pinned !== null)) state.pinned = null; // the button toggles: pinned → unpin, else pin this moment
  else state.pinned = typeof v === 'number' ? v : state.q;
  const b = $('#pin-btn');
  b.setAttribute('aria-pressed', String(state.pinned !== null));
  b.innerHTML = `<svg class="ic" viewBox="0 0 16 16"><path d="M9.5 2.5l4 4-2.2.6-2.6 2.6.3 2.8-1.6-1.6L4 14.3 1.7 12l3.4-3.4L3.5 7l2.8.3 2.6-2.6z"/></svg>${state.pinned === null ? 'Pin this moment' : 'Pinned ' + esc(qLabel(state.pinned))}<kbd>P</kbd>`;
  b.title = state.pinned === null ? 'Pin this moment as a ghost to compare against (P)' : `Unpin ${qLabel(state.pinned)} (P)`;
  updateGhosts(); renderTimebar(); renderMoments(); renderStatus();
  if (state.pinned !== null) toast(`Pinned <b>${esc(qLabel(state.pinned))}</b>. Scrub away and it stays as a ghost to compare against.`); else toast('Unpinned');
  emit('pin', { pinned: state.pinned === null ? null : QUARTERS[state.pinned] });
}
$('#ghosts-btn').addEventListener('click', () => setGhosts());
$('#pin-btn').addEventListener('click', () => pin());

/* ---- scrubber ---- */
const trackEl = $('#track'), handleEl = $('#handle');
function renderTicks() {
  $('#ticks').innerHTML = QUARTERS.map((q, i) => {
    const n = SNAP[i].length, arch = SNAP[i].filter((f) => f.archivedAt).length;
    const chg = i > 0 ? diff(QUARTERS[i - 1], q) : null;
    const changes = chg ? chg.added.length + chg.changed.length : 0;
    return `<button class="tick" type="button" data-q="${i}" style="--i:${i}" title="${esc(qLabel(i))}: ${n} files${arch ? ', ' + arch + ' archived' : ''}${chg ? ` · ${chg.added.length} added, ${chg.changed.length} facts changed since ${qLabel(i - 1)}` : ' · the baseline'}"><i></i><span><span class="lg">${esc(qLabel(i))}</span><span class="sm">${esc(short(i))}</span>${changes ? `<em class="chg" title="${changes} changes since ${esc(qLabel(i - 1))}">+${changes}</em>` : ''}</span><small>${n} files${arch ? ' · ' + arch + ' archived' : ''}</small></button>`;
  }).join('');
}
function renderTimebar() {
  trackEl.style.setProperty('--t', String(state.t));
  handleEl.setAttribute('aria-valuenow', String(state.q));
  handleEl.setAttribute('aria-valuetext', qLabel(state.q));
  $$('.tick', trackEl).forEach((b) => { const i = +b.getAttribute('data-q'); b.classList.toggle('cur', i === state.q); b.classList.toggle('past', i < state.q); b.classList.toggle('pin', i === state.pinned); });
  const n = state.files.length, arch = state.files.filter((f) => f.archivedAt).length, notYet = baseline.length - n;
  const prev = state.q > 0 ? diff(QUARTERS[state.q - 1], QUARTERS[state.q]) : null;
  const when = state.q === NOW_I ? '<span class="pill ac">Now</span>' : state.q < NOW_I ? '<span class="pill">Past</span>' : '<span class="pill warn">Ahead</span>';
  $('#tnow').innerHTML = `<div class="q"><b>${esc(qLabel(state.q))}</b>${when}${state.pinned === state.q ? '<span class="pill warn">Pinned</span>' : ''}</div>` +
    `<small><b>${n} files</b>${notYet ? ` · ${notYet} not created yet` : ''}${arch ? ` · ${arch} archived` : ''}</small>` +
    `<span class="delta">${prev ? `<b>+${prev.added.length}</b> files · <b>${prev.changed.length}</b> facts changed since ${esc(qLabel(state.q - 1))}` : 'The baseline: where 2026 starts'}</span>`;
  $('#tb-when').innerHTML = `Viewing <b>${esc(qLabel(state.q))}</b>${state.q === NOW_I ? '<span class="pill ac">now</span>' : ''}${state.pinned !== null ? `<span class="pill warn">vs pinned ${esc(qLabel(state.pinned))}</span>` : ''}`;
  $('#nav-all-count').textContent = n;
}
function tFromX(x) { const r = trackEl.getBoundingClientRect(); return Math.max(0, Math.min(3, (x - r.left) / r.width * 3)); }
let sdrag = null;
trackEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const tick = e.target.closest('.tick');
  if (tick) { setTime(+tick.getAttribute('data-q')); return; }
  e.preventDefault();
  sdrag = { id: e.pointerId };
  trackEl.classList.add('dragging'); try { trackEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  play(false);
  scrubTo(tFromX(e.clientX));
});
trackEl.addEventListener('pointermove', (e) => { if (sdrag && e.pointerId === sdrag.id) scrubTo(tFromX(e.clientX)); });
function endScrub(e) { if (!sdrag || (e && e.pointerId !== sdrag.id)) return; sdrag = null; trackEl.classList.remove('dragging'); state.t = state.q; renderTimebar(); emit('scrub', { q: state.q }); }
trackEl.addEventListener('pointerup', endScrub); trackEl.addEventListener('pointercancel', endScrub);
function scrubTo(t) { state.t = t; setTime(t, { keepT: true }); renderTimebar(); }
handleEl.addEventListener('keydown', (e) => { if (e.key === 'Home') { e.preventDefault(); setTime(0); } if (e.key === 'End') { e.preventDefault(); setTime(3); } });

/* ---- callout for the edge quarters ---- */
let calloutTimer = 0;
function renderCallout(prevQ) {
  const c = $('#callout');
  clearTimeout(calloutTimer);
  const notYet = baseline.filter((r) => quarterIndex(r.created) > state.q);
  const arch = state.files.filter((f) => f.archivedAt);
  let html = '';
  if (state.q === 0 && notYet.length) html = `<div><b>${notYet.length} files not created yet</b>${notYet.map((r) => esc(r.name)).join(', ')} appear later in the year. Scrub forward to watch them arrive.</div>`;
  else if (arch.length && !(prevQ !== undefined && SNAP[prevQ].some((f) => f.archivedAt))) html = `<div><b>${arch.length} files archived</b>${arch.map((r) => esc(r.name)).join(' and ')} fade to a ghost on every face and keep an Archive tag.</div>`;
  if (!html) { c.hidden = true; return; }
  c.style.setProperty('--cc', state.q === 0 ? 'var(--ac)' : 'var(--warn)');
  c.innerHTML = html + '<button class="ib" type="button" data-close title="Dismiss" aria-label="Dismiss"><svg class="ic"><use href="#i-x"/></svg></button>';
  c.hidden = false;
  calloutTimer = setTimeout(() => { c.hidden = true; }, 6000);
}
$('#callout').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) $('#callout').hidden = true; });

/* ---- chips + sidebar ---- */
function renderChips() {
  $('#chips-shown').innerHTML = FACES.map((face) => { const ax = axesById[cube.state.faces[face]]; return `<button class="chip on" type="button" draggable="true" data-axis="${ax.id}" style="--c:${ax.color}" title="${esc(ax.label)} is on the ${FACE_LABEL[face]} face. Drag it onto another face to swap."><span class="dot"></span>${esc(ax.label)}<small>${FACE_LABEL[face]}</small></button>`; }).join('');
  $('#chips-hidden').innerHTML = cube.hiddenAxes().map((ax) => `<button class="chip" type="button" draggable="true" data-axis="${ax.id}" style="--c:${ax.color}" title="Show ${esc(ax.label)} on the top face (or drag it onto any face)"><span class="dot"></span>${esc(ax.label)}</button>`).join('');
  $('#axes-nav').innerHTML = axes.map((ax) => { const face = cube.faceOf(ax.id); return `<button type="button" class="${face ? 'on' : ''}" data-axis="${ax.id}" style="--c:${ax.color}" title="${esc(ax.label)}${face ? ' · ' + FACE_LABEL[face] + ' face' : ' · click to show on the top face'}"><span class="dot"></span><span>${esc(ax.label)}</span>${face ? `<span class="facepill">${FACE_LABEL[face]}</span>` : '<span class="cnt">hidden</span>'}</button>`; }).join('');
  $('#axes-count').textContent = axes.length;
}
function renderMoments() {
  $('#moments').innerHTML = QUARTERS.map((q, i) => `<button type="button" class="${i === state.q ? 'on' : ''}" data-time="${i}" title="Scrub to ${esc(qLabel(i))} (${SNAP[i].length} files)"><svg class="ic"><use href="#i-clock"/></svg><span>${esc(qLabel(i))}</span><span class="cnt">${SNAP[i].length}</span>${i === NOW_I ? '<span class="pill ac">now</span>' : ''}${i === state.pinned ? '<span class="pill warn">pinned</span>' : ''}</button>`).join('');
}
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-time]'); if (m) { e.preventDefault(); setTime(+m.getAttribute('data-time')); return; }
  const chip = e.target.closest('[data-axis]'); if (!chip) return;
  e.preventDefault(); const id = chip.getAttribute('data-axis'); if (!cube.faceOf(id)) cube.showAxis(id, 'top');
});
document.addEventListener('dragstart', (e) => { const chip = e.target.closest && e.target.closest('.chip[data-axis]'); if (!chip) return; e.dataTransfer.setData('text/plain', chip.getAttribute('data-axis')); chip.classList.add('dragging'); });
document.addEventListener('dragend', () => $$('.chip.dragging').forEach((c) => c.classList.remove('dragging')));

/* ---- search dims non-matching rows on the live cube ---- */
function matches(f) { const q = state.query; if (!q) return true; if (f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) return true; return Object.keys(f.axes).some((k) => String(f.axes[k]).toLowerCase().includes(q)); }
function applyQuery() {
  const hit = {}; state.files.forEach((f) => { hit[f.id] = matches(f); });
  $$('.face .row, .face .tiles .th[data-id]', liveStage).forEach((n) => n.classList.toggle('dim', state.query && !hit[n.getAttribute('data-id')]));
}
$('#search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); applyQuery(); renderStatus(); });

/* ---- selection ---- */
function select(id) { if (id && byId[state.q][id]) cube.select(id, { source: 'api' }); else { state.selected = id || null; cube.select(null, { source: 'api' }); if (id) { state.selected = id; afterSelect(); } } }
function afterSelect() {
  ghostList.forEach((g) => { if (g.q === null) return; if (state.selected && byId[g.q][state.selected]) g.api.select(state.selected); else g.api.select(null); });
  if (state.tab !== 'file' && state.selected) { /* keep the diff open; just highlight */ }
  renderInspector(); renderStatus(); markWL(1200);
}
cube.on('select', ({ id, source }) => {
  if (id || source !== 'time') state.selected = id;
  afterSelect();
  emit('select', { id, source, file: id ? byId[state.q][id] : null });
});
['snap', 'drag'].forEach((ev) => cube.on(ev, (d) => emit(ev, d)));

/* ---- inspector ---- */
function avatar(p) { const pe = people[p]; return pe ? `<span class="av" style="--c:${pe.color}">${pe.initials}</span>` : ''; }
function factHTML(axisId, from, to) { const ax = axesById[axisId]; return `<span class="fact" style="--c:${ax.color}"><b>${esc(ax.label)}</b>${esc(fmtVal(from))}<span class="arr">→</span>${esc(fmtVal(to))}</span>`; }
function historyOf(id) { // [{ q, kind:'created'|'changed'|'archived', facts:[{axis, from, to}] }]
  const rec = baseById[id]; const out = [];
  const c = quarterIndex(rec.created);
  out.push({ q: c, kind: 'created', facts: [] });
  for (let i = c + 1; i < QUARTERS.length; i++) {
    const a = byId[i - 1][id], b = byId[i][id];
    const facts = axes.map((ax) => ({ axis: ax.id, from: a.axes[ax.id] || null, to: b.axes[ax.id] || null })).filter((x) => x.from !== x.to);
    if (b.archivedAt && !a.archivedAt) out.push({ q: i, kind: 'archived', facts: facts.filter((x) => x.axis !== 'status') });
    else if (facts.length) out.push({ q: i, kind: 'changed', facts });
  }
  return out;
}
function tabsHTML() {
  const d = diff(QUARTERS[state.diffFrom], QUARTERS[state.diffTo]);
  const n = d.added.length + d.archived.length + new Set(d.changed.map((c) => c.id)).size;
  return `<div class="seg itabs" role="tablist" aria-label="Inspector"><button role="tab" type="button" data-tab="file" aria-selected="${state.tab === 'file'}" title="The selected file and its timeline"><svg class="ic"><use href="#i-cube"/></svg>File</button><button role="tab" type="button" data-tab="diff" aria-selected="${state.tab === 'diff'}" title="What changed between two quarters (D)"><svg class="ic"><use href="#i-compare"/></svg>Diff<span class="cnt">${n}</span></button></div>`;
}
function renderInspector() {
  const insp = $('#inspector');
  insp.innerHTML = tabsHTML() + (state.tab === 'diff' ? diffHTML() : fileHTML());
  $('#diff-btn').setAttribute('aria-pressed', String(state.tab === 'diff'));
}
function fileHTML() {
  const id = state.selected;
  if (!id) return `<div class="none"><svg class="ic big"><use href="#i-time"/></svg><div><b>Select a file on any face</b>It lights up on every face, world lines join it to its past and future in the ghost cubes, and this panel shows its timeline through 2026.</div><div class="tags" style="justify-content:center">${QUARTERS.map((q, i) => `<span class="pill${i === state.q ? ' ac' : ''}">${esc(qLabel(i))}</span>`).join('')}</div></div>`;
  const rec = baseById[id], f = byId[state.q][id], kind = kinds[rec.kind];
  const hist = historyOf(id);
  const shown = f || { ...rec, axes: rec.axes, archivedAt: null };
  const created = quarterIndex(rec.created);
  let head = `<div class="ih"><svg class="ic"><use href="#i-cube"/></svg>File<button class="ib" type="button" data-close title="Clear selection (Esc)" aria-label="Clear selection"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="prev th ${kind.th}${!f ? ' absent' : ''}${f && f.archivedAt ? ' arch' : ''}"></div><h3>${esc(rec.name)}${f && f.archivedAt ? '<span class="pill">Archived</span>' : ''}${!f ? '<span class="pill">Not created yet</span>' : (rec.created === QUARTERS[state.q] && state.q > 0 ? '<span class="pill ac">New this quarter</span>' : '')}</h3>
    <div class="meta"><span>Kind</span><b>${esc(kind.label)} · ${esc(rec.size)}</b><span>Owner</span><b>${avatar(rec.owner)}${esc(people[rec.owner].name)}</b><span>Modified</span><b>${esc(rec.modified)}</b></div>`;
  if (!f) head += `<div class="note"><span><b>${esc(rec.name)}</b> does not exist in ${esc(qLabel(state.q))}. It is created in <b>${esc(qLabel(created))}</b>${rec.axes.project ? ` under ${esc(rec.axes.project)}` : ''}.</span><button class="btn sm" type="button" data-time="${created}"><svg class="ic"><use href="#i-play"/></svg>Go to ${esc(qLabel(created))}</button></div>`;
  // where it sits (read-only at this moment)
  const prevF = state.q > 0 ? byId[state.q - 1][id] : null;
  const homes = axes.map((a) => {
    const v = shown.axes[a.id] || null; const face = cube.faceOf(a.id);
    const was = prevF ? (prevF.axes[a.id] || null) : v;
    const changed = f && prevF && was !== v;
    return `<div class="home${changed ? ' changed' : ''}" data-axis="${a.id}" style="--c:${a.color}" title="${esc(a.label)}: ${esc(fmtVal(v))}${changed ? ' (was ' + esc(fmtVal(was)) + ' in ' + esc(qLabel(state.q - 1)) + ')' : ''}"><span class="axn"><span class="dot"></span>${esc(a.label)}</span><span class="val${v ? '' : ' none'}">${esc(v || a.none)}${changed ? `<small>was ${esc(fmtVal(was))}</small>` : ''}</span><span class="where${face ? '' : ' hidden'}">${face ? FACE_LABEL[face] : 'hidden'}</span></div>`;
  }).join('');
  // timeline
  const evByQ = {}; hist.forEach((h) => { evByQ[h.q] = h; });
  const lifeEnd = rec.archived ? quarterIndex(rec.archived) : QUARTERS.length - 1;
  const track = QUARTERS.map((q, i) => {
    const h = evByQ[i];
    const cls = ['tl-q', i === state.q ? 'cur' : '', i < created ? 'absent' : 'alive', h ? h.kind : '', h && h.kind === 'changed' ? 'has' : ''].filter(Boolean).join(' ');
    const t = i < created ? 'Not created yet' : h ? (h.kind === 'created' ? 'Created' : h.kind === 'archived' ? 'Archived' : `${h.facts.length} fact${h.facts.length === 1 ? '' : 's'} changed`) : 'No change';
    return `<button class="${cls}" type="button" data-time="${i}" title="${esc(qLabel(i))}: ${t}. Click to scrub there."><i>${h && h.kind === 'archived' ? '<b>×</b>' : ''}</i>${h && h.kind === 'changed' ? `<span class="cnt">${h.facts.length}</span>` : ''}<span>${short(i)}</span></button>`;
  }).join('');
  const events = hist.map((h) => `<li class="${h.q === state.q ? 'cur' : ''}" data-time="${h.q}" title="Scrub to ${esc(qLabel(h.q))}"><b>${esc(qLabel(h.q))}</b><div class="facts">${h.kind === 'created' ? `<span class="fact plain">Created${rec.axes.project ? ' in ' + esc(rec.axes.project) : ''}${rec.axes.client ? ' for ' + esc(rec.axes.client) : ''}</span>` : ''}${h.kind === 'archived' ? '<span class="fact" style="--c:#f5b544"><b>Archived</b></span>' : ''}${h.facts.map((x) => factHTML(x.axis, x.from, x.to)).join('')}</div></li>`).join('');
  return head +
    `<div class="sec-h">Timeline<span class="cnt">· ${hist.length - 1} change${hist.length - 1 === 1 ? '' : 's'} across 2026</span></div>` +
    `<div class="tl" id="timeline"><div class="tl-track"><span class="life" style="--l:${(created / 3 * 75 + 12.5).toFixed(1)}%;--r:${((3 - lifeEnd) / 3 * 75 + 12.5).toFixed(1)}%"></span>${track}</div><ul class="tl-ev">${events}</ul></div>` +
    `<div class="sec-h">Where it sits<span class="cnt">· in ${esc(qLabel(state.q))}</span></div><div class="homes ro" id="homes">${homes}</div>`;
}
function diffHTML() {
  const from = state.diffFrom, to = state.diffTo;
  const d = diff(QUARTERS[from], QUARTERS[to]);
  const opts = (sel) => QUARTERS.map((q, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(qLabel(i))}</option>`).join('');
  const perAxis = {}; d.changed.forEach((c) => { perAxis[c.axis] = (perAxis[c.axis] || 0) + 1; });
  const axisOrder = axes.filter((a) => perAxis[a.id]);
  const byFile = {}; d.changed.forEach((c) => { (byFile[c.id] = byFile[c.id] || []).push(c); });
  const changedIds = Object.keys(byFile).filter((id) => !d.archived.some((a) => a.id === id));
  const row = (f, when, facts) => `<button class="drow${state.selected === f.id ? ' sel' : ''}" type="button" data-select="${esc(f.id)}" title="Select ${esc(f.name)}"><span class="th ${kinds[f.kind].th}"></span><span class="nm">${esc(f.name)}</span><span class="when">${when}</span>${facts ? `<span class="facts">${facts}</span>` : ''}</button>`;
  const same = from === to;
  return `<div class="ih"><svg class="ic"><use href="#i-compare"/></svg>Diff<span class="kbd" style="margin-left:auto;color:var(--dim)">D</span></div>
    <div class="drange"><select id="diff-from" aria-label="From quarter" title="From">${opts(from)}</select><button class="ib" type="button" id="diff-swap" title="Swap the two quarters" aria-label="Swap the two quarters"><svg class="ic"><use href="#i-compare"/></svg></button><select id="diff-to" aria-label="To quarter" title="To">${opts(to)}</select></div>` +
    (same ? `<div class="empty">Pick two different quarters to see what changed between them.</div>` :
    `<div class="dsum"><div class="tot"><span><b>${d.added.length}</b> added</span><span><b>${changedIds.length}</b> changed</span><span><b>${d.archived.length}</b> archived</span><span><b>${d.changed.length}</b> facts</span></div>` +
      (axisOrder.length ? `<div class="dbar" role="img" aria-label="Changed facts per axis: ${axisOrder.map((a) => a.label + ' ' + perAxis[a.id]).join(', ')}">${axisOrder.map((a) => `<i style="--n:${perAxis[a.id]};--c:${a.color}" title="${esc(a.label)}: ${perAxis[a.id]}"></i>`).join('')}</div><div class="dleg">${axisOrder.map((a) => `<span><span class="dot" style="--c:${a.color};width:7px;height:7px;border-radius:50%;background:${a.color};display:inline-block"></span>${esc(a.label)} <b>${perAxis[a.id]}</b></span>`).join('')}</div>` : '<div class="empty">No facts changed.</div>') + '</div>' +
    `<div class="sec-h">Added<span class="cnt">· ${d.added.length}</span></div><div class="dlist">${d.added.length ? d.added.map((f) => row(f, 'created ' + esc(quarterLabel(f.created)), null)).join('') : '<div class="empty">Nothing new</div>'}</div>` +
    `<div class="sec-h">Changed<span class="cnt">· ${changedIds.length} file${changedIds.length === 1 ? '' : 's'}</span></div><div class="dlist">${changedIds.length ? changedIds.map((id) => { const f = byId[to][id]; return row(f, byFile[id].length + ' fact' + (byFile[id].length === 1 ? '' : 's'), byFile[id].map((c) => factHTML(c.axis, c.from, c.to)).join('')); }).join('') : '<div class="empty">No file changed</div>'}</div>` +
    `<div class="sec-h">Archived<span class="cnt">· ${d.archived.length}</span></div><div class="dlist">${d.archived.length ? d.archived.map((f) => row(f, 'archived ' + esc(quarterLabel(f.archivedAt)), (byFile[f.id] || []).filter((c) => c.axis !== 'status').map((c) => factHTML(c.axis, c.from, c.to)).join(''))).join('') : '<div class="empty">Nothing archived</div>'}</div>`);
}
function setTab(tab) {
  const open = tab === 'diff';
  if (state.tab === tab) return;
  state.tab = tab; renderInspector();
  emit('diff', { open, from: QUARTERS[state.diffFrom], to: QUARTERS[state.diffTo] });
}
function openDiff(v) { setTab((typeof v === 'boolean' ? v : state.tab !== 'diff') ? 'diff' : 'file'); }
function setDiff(from, to) {
  if (typeof from === 'string') from = quarterIndex(from);
  if (typeof to === 'string') to = quarterIndex(to);
  state.diffFrom = Math.max(0, Math.min(3, from)); state.diffTo = Math.max(0, Math.min(3, to));
  renderInspector();
  emit('diff', { open: state.tab === 'diff', from: QUARTERS[state.diffFrom], to: QUARTERS[state.diffTo] });
}
$('#inspector').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]'); if (t) { setTab(t.getAttribute('data-tab')); return; }
  if (e.target.closest('[data-close]')) { cube.select(null); return; }
  if (e.target.closest('#diff-swap')) { setDiff(state.diffTo, state.diffFrom); return; }
  const s = e.target.closest('[data-select]');
  if (s) { const id = s.getAttribute('data-select'); if (!byId[state.q][id]) setTime(state.diffTo); select(id); }
});
$('#inspector').addEventListener('change', (e) => {
  if (e.target.id === 'diff-from') setDiff(+e.target.value, state.diffTo);
  if (e.target.id === 'diff-to') setDiff(state.diffFrom, +e.target.value);
});
$('#diff-btn').addEventListener('click', () => openDiff());

/* ---- toast, status, theme, share ---- */
let toastTimer = 0;
function toast(html) { const t = $('#toast'); t.innerHTML = `<span class="msg">${html}</span>`; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }
function renderStatus() {
  const sel = state.selected ? baseById[state.selected] : null;
  const n = state.files.length, arch = state.files.filter((f) => f.archivedAt).length;
  const hits = state.query ? state.files.filter(matches).length : null;
  $('#sbar').innerHTML = `<b>${hits !== null ? `${hits} of ${n}` : n} files</b><span class="sep">·</span><b>${esc(qLabel(state.q))}</b>${state.q === NOW_I ? ' (now)' : ''}<span class="sep">·</span>${FACES.map((f) => esc(axesById[cube.state.faces[f]].label)).join(' × ')}${arch ? `<span class="sep">·</span>${arch} archived` : ''}${state.pinned !== null ? `<span class="sep">·</span>pinned ${esc(qLabel(state.pinned))}` : ''}${state.playing ? '<span class="sep">·</span>playing' : ''}${sel ? `<span class="sep">·</span>${esc(sel.name)} selected` : ''}<span class="r"><span class="keys"><span><span class="kbd">← →</span>time</span><span><span class="kbd">Space</span>play</span><span><span class="kbd">G</span>ghosts</span><span><span class="kbd">D</span>diff</span><span><span class="kbd">P</span>pin</span><span><span class="kbd">?</span>tour</span></span><span class="sync"><i></i>Synced</span></span>`;
}
function setTheme(t) {
  state.theme = t === 'light' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', state.theme);
  const b = $('#theme-btn'); b.innerHTML = `<svg class="ic"><use href="#${state.theme === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`; b.title = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`; b.setAttribute('aria-label', b.title);
  try { localStorage.setItem('tesseract.theme', state.theme); } catch (e) { /* ignore */ }
  markWL(300);
}
$('#theme-btn').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#share-btn').addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('q', QUARTERS[state.q]); if (state.selected) u.searchParams.set('file', state.selected); try { navigator.clipboard && navigator.clipboard.writeText(u.toString()); } catch (e) { /* ignore */ } toast(`Link to <b>${esc(qLabel(state.q))}</b> copied`); });
$('#sb-toggle').addEventListener('click', () => { $('#app').classList.toggle('sb-open'); setTimeout(() => { cube.layout(); ghostList.forEach((g) => g.api.layout()); }, 50); });
$$('.sb .nav a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));

/* ---- keys ---- */
document.addEventListener('keydown', (e) => {
  const t = e.target, tag = t && t.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  if (e.key === 'Escape' && !typing) { if (state.selected) { cube.select(null); return; } if ($('#callout') && !$('#callout').hidden) { $('#callout').hidden = true; return; } }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case '/': e.preventDefault(); $('#search').focus(); break;
    case '?': e.preventDefault(); tour.toggle(); break;
    case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) cube.rotateBy(-8, 0, true); else { play(false); step(-1); } break;
    case 'ArrowRight': e.preventDefault(); if (e.shiftKey) cube.rotateBy(8, 0, true); else { play(false); step(1); } break;
    case 'ArrowUp': e.preventDefault(); cube.rotateBy(0, 8, true); break;
    case 'ArrowDown': e.preventDefault(); cube.rotateBy(0, -8, true); break;
    case ' ': if (tag === 'BUTTON' || tag === 'A') return; e.preventDefault(); play(); break;
    case '1': e.preventDefault(); cube.snap('front'); break;
    case '2': e.preventDefault(); cube.snap('right'); break;
    case '3': e.preventDefault(); cube.snap('top'); break;
    case '0': e.preventDefault(); cube.snap('iso'); break;
    case 'g': case 'G': e.preventDefault(); setGhosts(); break;
    case 'd': case 'D': e.preventDefault(); openDiff(); break;
    case 'p': case 'P': e.preventDefault(); pin(); break;
    case 'Home': e.preventDefault(); setTime(0); break;
    case 'End': e.preventDefault(); setTime(3); break;
  }
});

/* ---- tour ---- */
const TOUR_FILE = 'acme-msa-v4'; // Atlas → Legal in Q2 on the Project face, signed in Q4
const tour = createTour({
  key: 'tesseract', on, off, button: '#tour-btn',
  steps: [
    { title: 'Time is the fourth axis', target: '#timebar',
      body: 'The cube still shows <b>Project × Client × Type</b>, but this is one moment: <b>' + esc(qLabel(NOW_I)) + '</b>. The scrubber underneath is a fourth axis. Slide it and the whole cube moves through 2026: files glide between groups as their facts change, files that do not exist yet are absent, archived ones fade.<br><br>This panel never blocks anything. Drag it by its header, collapse it, or close it and press <kbd>?</kbd> to bring it back.' },
    { title: 'Scrub through the year', target: '#track', event: 'time', task: 'Drag the handle to another quarter, or press ← →',
      body: 'Drag the handle, click a quarter, or use <kbd>←</kbd> <kbd>→</kbd>. Memberships change at quarter boundaries; each move re-sorts every face with a slide, and the rows that changed flash in their face’s colour. Q1 has only 22 files; three are created later.',
      before: () => { if (state.q !== NOW_I) setTime(NOW_I); }, check: (d) => d.q !== NOW_I, doit: () => setTime(1) },
    { title: 'Watch one file move', target: '.face.front', event: 'time', task: 'Step forward to Q2 2026 (→)',
      body: '<b>Acme MSA v4.pdf</b> is selected and we are back in <b>Q1 2026</b>, when it lived under <b>Atlas</b>. Step to Q2 and it slides into <b>Legal</b> on the Project face; the Client and Type faces stay put, because only one fact about it changed.',
      before: () => { play(false); setTime(0); select(TOUR_FILE); }, check: (d) => d.q === 1, doit: () => setTime(1) },
    { title: 'Ghost cubes and world lines', target: '#tstage',
      body: 'Behind the live cube, two fainter cubes show the <b>previous</b> and <b>next</b> quarter, turning in sync. That is the tesseract projection: an inner and outer cube joined by edges. The thin <b>world lines</b> run from the selected file’s row to the same row in each ghost, and a label says what changed on that face and when. Toggle them with <kbd>G</kbd>.',
      before: () => { setGhosts(true); if (!state.selected) select(TOUR_FILE); if (state.q === 0) setTime(1); cube.snap('iso'); } },
    { title: 'Diff two quarters', target: '#diff-btn', event: 'diff', task: 'Open Diff (D)',
      body: 'The <b>Diff</b> tab lists everything <b>Added</b>, <b>Changed</b> and <b>Archived</b> between two quarters (by default the previous one and the one you are viewing), with a bar of which axes moved most. Every row selects that file, so a review of the quarter is a walk through the cube.',
      before: () => openDiff(false), check: (d) => d.open, doit: () => openDiff(true) },
    { title: 'Pin a moment, then compare', target: '#pin-btn', event: 'pin', task: 'Pin this moment (P)',
      body: '<b>Pin this moment</b> freezes a ghost of the quarter you are viewing. Scrub anywhere else and the pinned cube stays put with a pin badge, so <b>Q1 vs Q4</b> is one glance instead of two trips.',
      before: () => { openDiff(false); }, check: (d) => d.pinned, doit: () => { pin(state.q); setTimeout(() => setTime(state.q === 3 ? 0 : 3), 700); } },
    { title: 'Play the year', target: '#play-btn', event: 'play', task: 'Press Space or the play button',
      body: '<b>Space</b> plays the four quarters in a loop, about 2.5 seconds each. Watch a face while it runs: the groups swell and shrink, the three new files arrive, and the archived ones fade in Q4.<br><br>Keys: <kbd>←</kbd> <kbd>→</kbd> time · <kbd>Space</kbd> play · <kbd>G</kbd> ghosts · <kbd>D</kbd> diff · <kbd>P</kbd> pin · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>0</kbd> faces · <kbd>[</kbd> <kbd>]</kbd> other prototypes.',
      before: () => play(false), check: (d) => d.playing, doit: () => play(true), after: () => play(false) }
  ],
  onClose: () => { if (state.playing) play(false); }
});

/* ---- boot ---- */
let storedTheme = null; try { storedTheme = localStorage.getItem('tesseract.theme'); } catch (e) { /* ignore */ }
setTheme(storedTheme || 'dark');
renderTicks();
renderChips(); renderMoments(); renderTimebar(); renderInspector(); renderStatus();
updateGhosts();
(function fromUrl() {
  try {
    const p = new URLSearchParams(location.search);
    const q = p.get('q'); if (q && QUARTERS.includes(q) && quarterIndex(q) !== state.q) setTime(quarterIndex(q));
    const f = p.get('file'); if (f && baseById[f]) setTimeout(() => select(f), 300);
  } catch (e) { /* ignore */ }
})();
requestAnimationFrame(() => { ghostList.forEach((g) => g.api.setRotation(cube.state.rot.rx, cube.state.rot.ry, false, cube.state.snap)); markWL(1500); });

window.Proto = {
  cube, ghosts, tour, state, data, on, off, filesAt, diff, QUARTERS, NOW,
  setTime, step, play, setGhosts, pin, openDiff, setDiff, setTab, select, setTheme, drawWorldLines, historyOf, ghostSlots
};
