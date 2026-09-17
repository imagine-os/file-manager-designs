/* app.js — Nested cubes prototype.
   The root cube is Facet's cube over the shared dataset. Any group on a face
   opens into a child cube holding only that group's files, grouped by the
   three axes that still tell them apart; the parent shrinks into the
   breadcrumb as a live mini cube, so the path is a row of cubes. Exposes
   window.Proto for the tour and tools/proto-check-nested.mjs. */
import '../shared/icons.js';
import data, { files, axes, axesById, kinds, people, groupBy, filesAt, QUARTERS, NOW, workspace } from '../shared/data.js';
import { createCube, esc } from '../shared/cube.js';
import { createTour } from '../shared/tour.js';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const FACES = ['front', 'right', 'top'];
const FACE_LABEL = { front: 'Front', right: 'Right', top: 'Top' };
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ANIM = reduced ? 0 : 420;
const CUBE_SIZE = { min: 320, max: 600, w: 0.5, h: 0.58 };
const attr = (v) => String(v).replace(/["\\]/g, '\\$&');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---- event bus (the tour and tests listen here; cubes have their own) ---- */
const listeners = {};
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); }
function emit(ev, d) { (listeners[ev] || []).slice().forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); }

/* ---- state ---- */
const state = {
  levels: [],          // the path of cubes, root first; the last one is current
  selected: null,      // file id, shared by every cube on the path
  theme: 'dark',
  query: '',
  compare: null,       // { a, b, el, sibling } while comparing siblings
  focusGroup: null,    // { axis, value } focused by a click on a group header
  hoverGroup: null,    // { axis, value } under the pointer
  busy: false,         // a zoom animation is in flight
  lastChange: 0
};
const levelsEl = $('#levels'), minimapEl = $('#minimap'), crumbsEl = $('#crumbs'), menuEl = $('#menu');
const current = () => state.levels[state.levels.length - 1];
const depth = () => state.levels.length;

/* =====================================================================
   Choosing axes for a child cube
   ===================================================================== */
// every unused axis, ranked by how many non-empty groups it makes of these files; ties keep the axis order (core first)
function rank(list, used) {
  return axes.filter((a) => used.indexOf(a.id) < 0)
    .map((a, i) => ({ a, i, n: groupBy(list, a).filter((g) => g.files.length).length }))
    .sort((x, y) => y.n - x.n || x.i - y.i);
}
// { front, right, top } for a cube, or null when the group should open as a flat list (depth guard)
function chooseFaces(list, used) {
  const ranked = rank(list, used);
  if (list.length < 2 || ranked.length < 3 || ranked.filter((r) => r.n >= 2).length < 2) return null;
  return { front: ranked[0].a.id, right: ranked[1].a.id, top: ranked[2].a.id };
}
const modeFor = (list, used) => (chooseFaces(list, used) ? 'cube' : 'list');

/* =====================================================================
   Levels: one cube (or list) per step of the path
   ===================================================================== */
function makeLevel(parent, axisId, value, groupFiles) {
  const ax = axisId ? axesById[axisId] : null;
  const used = parent ? parent.used.concat(axisId) : [];
  const faces = parent ? chooseFaces(groupFiles, used) : { front: 'project', right: 'client', top: 'type' };
  const lvl = {
    depth: parent ? parent.depth + 1 : 1, axis: axisId, value, ax,
    label: ax ? (value === null ? ax.none : value) : workspace,
    files: groupFiles, used, faces, mode: faces ? 'cube' : 'list',
    color: ax ? ax.color : 'var(--ac)', cube: null, list: null
  };
  const el = document.createElement('div');
  el.className = 'level'; el.setAttribute('data-depth', lvl.depth); el.style.setProperty('--lc', lvl.color);
  const stage = document.createElement('div');
  stage.className = lvl.mode === 'cube' ? 'cube-stage' : 'list-stage'; stage.style.cssText = 'position:relative;flex:1;min-height:0';
  el.appendChild(stage);
  levelsEl.insertBefore(el, minimapEl);
  lvl.el = el; lvl.stageEl = stage;
  if (lvl.mode === 'cube') mountCube(lvl); else mountList(lvl);
  return lvl;
}
function destroyLevel(lvl) {
  if (lvl.mo) lvl.mo.disconnect();
  if (lvl.cube) lvl.cube.destroy();
  if (lvl.list) lvl.list.destroy();
  lvl.el.remove();
}

/* ---- the "Open ▸" affordance on group headers (rows) and tiles (top face) ---- */
function openBtn(mode, label, big) {
  return `<button class="open${mode === 'list' ? ' list' : ''}" type="button" data-open title="${mode === 'cube' ? 'Open ' + esc(label) + ' as its own cube' : 'Too few axes left to build a cube of ' + esc(label) + ': open it as a flat list'}">${mode === 'cube' ? 'Open' : 'List'}<svg class="ic"><use href="#i-chevr"/></svg></button>`;
}
function headerHTML(g, ax, lvl) {
  const label = g.value === null ? ax.none : g.value, n = g.files.length, total = lvl.files.length;
  const w = total ? Math.round(n / total * 100) : 0;
  const mode = n ? modeFor(g.files, lvl.used.concat(ax.id)) : 'cube';
  return `<header class="gh" data-group="${esc(g.value === null ? '' : g.value)}" title="${esc(label)}: ${plural(n, 'file')}.${n ? (mode === 'cube' ? ' Double-click, or press Open, to open it as its own cube.' : ' Too few axes left for a cube: opens as a list.') : ''}"><b>${esc(label)}</b><span class="bar"><i style="--w:${w}%"></i></span><small>${n}</small>${n ? openBtn(mode, label) : ''}</header>`;
}
function injectTileButtons(lvl) {
  const cube = lvl.cube; if (!cube) return;
  const axisId = cube.state.faces.top, ax = axesById[axisId]; if (!ax) return;
  $$('.tile', cube.faceEls.top).forEach((t) => {
    if ($('.open', t)) return;
    const v = t.getAttribute('data-group') || null;
    const list = lvl.files.filter((f) => (f.axes[axisId] || null) === v);
    if (!list.length) return;
    const label = v === null ? ax.none : v;
    const tmp = document.createElement('template'); tmp.innerHTML = openBtn(modeFor(list, lvl.used.concat(axisId)), label);
    t.appendChild(tmp.content.firstChild);
  });
}

function mountCube(lvl) {
  const cube = createCube(lvl.stageEl, {
    files: lvl.files, axes, kinds, faces: lvl.faces, controls: true, keys: false, size: CUBE_SIZE,
    controlsExtra: '<span class="hint" title="Click a group header to focus it, then Enter opens it"><kbd>Enter</kbd> open group</span>',
    groupHeaderHTML: (g, ax) => headerHTML(g, ax, lvl)
  });
  lvl.cube = cube;
  cube.on('select', (d) => onSelect(lvl, d));
  cube.on('groupOpen', (d) => { if (lvl === current() && performance.now() - state.lastChange > 500) openGroup(d.axis, d.value); });
  cube.on('hover', (d) => { state.hoverGroup = d.axis ? { axis: d.axis, value: d.value } : null; });
  cube.on('snap', () => { if (lvl === current()) renderStatus(); });
  cube.on('axisSwap', (d) => {
    lvl.faces = Object.assign({}, cube.state.faces);
    state.focusGroup = null;
    if (lvl === current()) { renderChips(); renderCrumbs(); renderStatus(); renderInspector(); renderSidebar(); applyQuery(); }
    if (!d.all) emit('axisSwap', { depth: lvl.depth, axis: d.axis, face: d.face, replaced: d.replaced });
  });
  lvl.mo = new MutationObserver(() => injectTileButtons(lvl));
  lvl.mo.observe(cube.faceEls.top, { childList: true });
  injectTileButtons(lvl);
  lvl.stageEl.addEventListener('click', (e) => {
    const gh = e.target.closest('.gh, .tile'); if (!gh) return;
    const faceEl = gh.closest('.face'); if (!faceEl) return;
    const axisId = cube.state.faces[faceEl.getAttribute('data-face')], v = gh.getAttribute('data-group') || null;
    if (e.target.closest('[data-open]')) { e.stopPropagation(); e.preventDefault(); openGroup(axisId, v); return; }
    if (e.target.closest('[data-id]')) return; // a thumbnail inside a tile selects the file instead
    focusGroup(lvl, axisId, v);
  });
}
function focusGroup(lvl, axisId, value) {
  $$('.grp.focus, .tile.focus', lvl.el).forEach((n) => n.classList.remove('focus'));
  const face = lvl.cube.faceOf(axisId); if (!face) return;
  $$(`.face.${face} .grp[data-group="${attr(value === null ? '' : value)}"], .face.${face} .tile[data-group="${attr(value === null ? '' : value)}"]`, lvl.el).forEach((n) => n.classList.add('focus'));
  state.focusGroup = { axis: axisId, value };
  renderStatus();
}
function headerFor(lvl, axisId, value) {
  if (!lvl.cube) return null;
  const face = lvl.cube.faceOf(axisId); if (!face) return null;
  const tiles = face === 'top' && lvl.cube.el.getAttribute('data-topmode') === 'tiles';
  return $(`.face.${face} ${tiles ? '.tile' : '.gh'}[data-group="${attr(value === null ? '' : value)}"]`, lvl.el);
}
function spotGroup(lvl, axisId, value) {
  if (!lvl.cube) return;
  const face = lvl.cube.faceOf(axisId); if (!face) return;
  const sel = `.face.${face} .grp[data-group="${attr(value === null ? '' : value)}"], .face.${face} .tile[data-group="${attr(value === null ? '' : value)}"]`;
  const nodes = $$(sel, lvl.el);
  nodes.forEach((n) => n.classList.add('spot'));
  const grp = nodes.find((n) => n.classList.contains('grp')), fb = grp && grp.closest('.fb');
  if (grp && fb) fb.scrollTo({ top: Math.max(0, grp.offsetTop - 8), behavior: reduced ? 'auto' : 'smooth' });
  setTimeout(() => nodes.forEach((n) => n.classList.remove('spot')), 2600);
}

/* ---- depth guard: the flat list with the same chrome ---- */
function mountList(lvl) {
  const el = document.createElement('div'); el.className = 'listpanel';
  const ranked = rank(lvl.files, lvl.used), inf = ranked.filter((r) => r.n >= 2);
  const gAx = inf.length ? inf[0].a : null;
  const usedNames = lvl.used.map((id) => axesById[id].label);
  const why = lvl.files.length < 2
    ? `<b>Only one file</b> is in this group, so there is nothing left to split. Its remaining facts are in the inspector.`
    : `After ${usedNames.slice(0, -1).join(', ')}${usedNames.length > 1 ? ' and ' : ''}${usedNames.slice(-1)} fixed these ${lvl.files.length} files, ${inf.length === 0 ? '<b>no axis</b> still tells them apart' : `only <b>${inf.map((r) => r.a.label).join('</b> and <b>')}</b> still tell${inf.length === 1 ? 's' : ''} them apart`}. A cube needs at least two, so this level is a list.`;
  const row = (f) => { const k = kinds[f.kind], p = people[f.owner]; return `<button class="lp-row" type="button" data-id="${esc(f.id)}" title="${esc(f.name)} · ${esc(k.label)} · ${esc(f.size)}"><span class="th ${k.th}"></span><span class="nm">${esc(f.name)}</span><span class="meta">${esc(k.label.replace(' · for signature', ''))}</span><span class="meta"><span class="av" style="--c:${p.color}">${p.initials}</span>${esc(p.name.split(' ')[0])}</span><span class="meta">${esc(f.modified)}</span></button>`; };
  const cols = '<div class="lp-cols"><span></span><span>Name</span><span>Kind</span><span>Owner</span><span>Modified</span></div>';
  const body = gAx
    ? groupBy(lvl.files, gAx).filter((g) => g.files.length).map((g) => `<div class="lp-grp"><div class="lp-gh"><span class="dot" style="--c:${gAx.color}"></span>${esc(gAx.label)} · ${esc(g.label)}<small>${g.files.length}</small></div>${g.files.map(row).join('')}</div>`).join('')
    : lvl.files.map(row).join('');
  el.innerHTML = `<div class="lp-h"><span class="fdot"></span>${esc(lvl.label)} · flat list<span class="cnt">${plural(lvl.files.length, 'file')} · ${state.levels.concat([lvl]).map((l) => l.label).join(' › ')}</span></div>` +
    `<div class="lp-why"><svg class="ic"><use href="#i-layers"/></svg><span>${why}</span></div><div class="lp-b">${cols}${body}</div>`;
  el.addEventListener('click', (e) => { const r = e.target.closest('[data-id]'); if (r) onSelect(lvl, { id: r.getAttribute('data-id'), source: 'list' }); });
  lvl.stageEl.appendChild(el);
  lvl.list = {
    el,
    select(id) { $$('.lp-row.sel', el).forEach((n) => n.classList.remove('sel')); if (id) { const r = $(`.lp-row[data-id="${attr(id)}"]`, el); if (r) { r.classList.add('sel'); r.scrollIntoView({ block: 'nearest' }); } } },
    destroy() { el.remove(); }
  };
}

/* =====================================================================
   Navigating the path: open a group, zoom back out
   ===================================================================== */
function crumbMiniRect(d) { const m = $(`.crumb[data-depth="${d}"] .mini`, crumbsEl); return m ? m.getBoundingClientRect() : crumbsEl.getBoundingClientRect(); }
function flipTransform(rect) {
  const L = levelsEl.getBoundingClientRect(), W = L.width || 1, H = L.height || 1;
  const s = Math.max(0.03, Math.min(rect.width / W, rect.height / H));
  const cx = rect.left - L.left + rect.width / 2, cy = rect.top - L.top + rect.height / 2;
  return `translate(${(cx - W * s / 2).toFixed(1)}px,${(cy - H * s / 2).toFixed(1)}px) scale(${s.toFixed(4)})`;
}
// shrink a level into a rectangle (a crumb's mini cube, or a group header) and hide it
function flipOut(lvl, rect, done) {
  const el = lvl.el;
  if (!ANIM) { el.classList.add('away'); if (done) done(); return; }
  el.classList.add('flip'); el.style.transform = flipTransform(rect); el.style.opacity = '0';
  setTimeout(() => { el.classList.remove('flip'); el.classList.add('away'); el.style.transform = ''; el.style.opacity = ''; if (done) done(); }, ANIM);
}
// grow a level out of a rectangle into the stage
function flipIn(lvl, rect) {
  const el = lvl.el;
  el.classList.remove('away');
  if (!ANIM) return;
  el.classList.remove('flip'); el.style.transform = flipTransform(rect); el.style.opacity = '0';
  void el.offsetHeight;
  requestAnimationFrame(() => {
    el.classList.add('flip'); el.style.transform = ''; el.style.opacity = '1';
    setTimeout(() => { el.classList.remove('flip'); el.style.opacity = ''; }, ANIM);
  });
}
// while a zoom is in flight, further zooms queue up instead of being dropped
let pending = null;
function setBusy() { state.busy = true; state.lastChange = performance.now(); setTimeout(() => { state.busy = false; const fn = pending; pending = null; if (fn) fn(); }, ANIM + 30); }
function queue(fn) { pending = fn; return true; }

function openGroup(axisId, value, opts) {
  opts = opts || {};
  if (state.busy) return queue(() => openGroup(axisId, value, opts));
  const lvl = current(); if (!lvl || lvl.mode !== 'cube' || !axesById[axisId]) return false;
  if (value === undefined) value = null;
  if (state.compare) closeCompare(true);
  const groupFiles = lvl.files.filter((f) => (f.axes[axisId] || null) === value);
  if (!groupFiles.length) { toast('That group is empty; there is nothing to open.'); return false; }
  closeMenu();
  const hdr = headerFor(lvl, axisId, value);
  const fromRect = hdr ? hdr.getBoundingClientRect() : levelsEl.getBoundingClientRect();
  const toRect = crumbMiniRect(lvl.depth);
  const child = makeLevel(lvl, axisId, value, groupFiles);
  state.levels.push(child);
  if (state.selected && !groupFiles.some((f) => f.id === state.selected)) setSelected(null);
  else if (state.selected) syncSelection();
  setBusy();
  flipOut(lvl, toRect);
  setCurrent(child);
  flipIn(child, fromRect);
  setTimeout(() => { const c = $(`.crumb[data-depth="${child.depth}"]`, crumbsEl); if (c) { c.classList.add('land'); setTimeout(() => c.classList.remove('land'), 800); } }, ANIM * 0.6);
  const ax = axesById[axisId];
  if (!opts.silent) toast(child.mode === 'cube'
    ? `Opened <b>${esc(ax.label)} · ${esc(child.label)}</b> as its own cube: ${plural(groupFiles.length, 'file')} by ${FACES.map((f) => esc(axesById[child.faces[f]].label)).join(' × ')}`
    : `Opened <b>${esc(ax.label)} · ${esc(child.label)}</b> as a list: too few axes left for a cube`);
  emit('open', { depth: child.depth, axis: axisId, value, files: groupFiles.length, mode: child.mode, faces: child.faces });
  return true;
}
function goTo(d, opts) {
  opts = opts || {};
  if (state.busy) return queue(() => goTo(d, opts));
  const cur = current();
  if (d < 1 || d >= cur.depth) return false;
  if (state.compare) closeCompare(true);
  closeMenu();
  const target = state.levels[d - 1];
  const removed = state.levels.slice(d), child = removed[0];
  state.levels = state.levels.slice(0, d);
  removed.slice(1).forEach(destroyLevel);
  const fromRect = crumbMiniRect(target.depth);
  setBusy();
  setCurrent(target);
  const hdr = headerFor(target, child.axis, child.value);
  flipIn(target, fromRect);
  flipOut(child, hdr ? hdr.getBoundingClientRect() : fromRect, () => destroyLevel(child));
  spotGroup(target, child.axis, child.value);
  if (state.selected && target.cube) setTimeout(() => target.cube.scrollSelectedIntoView(), ANIM);
  emit('zoom', { depth: d, dir: 'out', from: cur.depth, axis: child.axis, value: child.value });
  return true;
}
const up = () => goTo(depth() - 1);
const home = () => goTo(1);
function jumpToSibling(value) {
  const lvl = current(); if (lvl.depth < 2) return;
  const axisId = lvl.axis;
  goTo(lvl.depth - 1);
  setTimeout(() => openGroup(axisId, value), ANIM + 60);
}

function setCurrent(lvl) {
  state.levels.forEach((l) => {
    l.el.classList.toggle('current', l === lvl);
    if (l !== lvl && !l.el.classList.contains('flip')) l.el.classList.add('away');
  });
  state.focusGroup = null; state.hoverGroup = null;
  renderCrumbs(); renderChips(); renderMinimap(); renderStatus(); renderInspector(); renderSidebar(); applyQuery();
  $('#up-btn').disabled = lvl.depth < 2; $('#home-btn').disabled = lvl.depth < 2;
  const cb = $('#compare-btn'); cb.disabled = lvl.depth < 2 || lvl.mode !== 'cube';
  cb.title = cb.disabled ? (lvl.depth < 2 ? 'Open a group first, then compare it with a sibling group' : 'A flat list has no cube to compare') : `Put ${lvl.label} beside a sibling ${lvl.ax.label} group as two cubes that turn together (C)`;
  $('#tb-where').innerHTML = state.levels.map((l, i) => (i === state.levels.length - 1 ? `<b>${esc(l.label)}</b>` : esc(l.label))).join('<span class="sep">›</span>') + `<span class="sep">·</span>${plural(lvl.files.length, 'file')}`;
  document.title = (lvl.depth > 1 ? lvl.label + ' · ' : '') + 'Nested cubes prototype · Northwind files';
}

/* =====================================================================
   The path of cubes (breadcrumb), mini-map, chips, sidebar, status
   ===================================================================== */
function miniHTML(lvl, cls) {
  const f = lvl.faces;
  const c = (face) => (f ? axesById[f[face]].color : 'var(--dim)');
  return `<span class="mini${lvl.mode === 'list' ? ' list' : ''}${cls ? ' ' + cls : ''}" aria-hidden="true"><span class="mc"><i class="mf f" style="--c:${c('front')}"></i><i class="mf b" style="--c:${c('front')}"></i><i class="mf r" style="--c:${c('right')}"></i><i class="mf l" style="--c:${c('right')}"></i><i class="mf t" style="--c:${c('top')}"></i><i class="mf u" style="--c:${c('top')}"></i></span></span>`;
}
function renderCrumbs() {
  const cur = current();
  crumbsEl.innerHTML = state.levels.map((l, i) => {
    const has = state.selected && l.files.some((f) => f.id === state.selected);
    const tip = `<span class="crumb-tip"><span class="tip-h">${l.mode === 'cube' ? 'Faces of this cube' : 'Flat list'}</span>` +
      (l.mode === 'cube' ? FACES.map((f) => `<div><span>${FACE_LABEL[f]}</span><span class="dot" style="--c:${axesById[l.faces[f]].color}"></span><b>${esc(axesById[l.faces[f]].label)}</b></div>`).join('') : `<div><b>${plural(l.files.length, 'file')}</b> · too few axes left for a cube</div>`) +
      (l.depth > 1 ? `<div><span>Fixed</span><b>${l.used.map((id) => esc(axesById[id].label)).join(', ')}</b></div>` : '') +
      (l !== cur ? `<div style="color:var(--ac)">Click to zoom back out to this cube</div>` : '') + '</span>';
    return (i ? '<svg class="ic crumb-sep" aria-hidden="true"><use href="#i-chevr"/></svg>' : '') +
      `<button class="crumb${l === cur ? ' current' : ''}" type="button" data-depth="${l.depth}" style="--lc:${l.color}"${l === cur ? ' aria-current="location"' : ''} aria-label="${esc(l.label)}, ${plural(l.files.length, 'file')}${l === cur ? ', current cube' : ', zoom back out to this cube'}">${miniHTML(l)}<span class="lbl"><small>${l.ax ? esc(l.ax.label) : 'Root'}</small><b>${esc(l.label)}<em>· ${plural(l.files.length, 'file')}</em></b></span>${has ? '<span class="sdot" title="The selected file is on this cube"></span>' : ''}${tip}</button>`;
  }).join('');
}
crumbsEl.addEventListener('click', (e) => { const b = e.target.closest('.crumb'); if (b) goTo(+b.getAttribute('data-depth')); });

function renderMinimap() {
  const cur = current();
  let html = '';
  for (let i = state.levels.length - 1; i >= 0; i--) {
    const l = state.levels[i], leaf = i === state.levels.length - 1;
    html = `<div class="mm${l === cur ? ' current' : ''}${leaf ? ' leaf' : ''}" data-depth="${l.depth}"><button class="mm-btn mm-l" type="button" data-depth="${l.depth}" title="${l === cur ? 'This cube' : 'Zoom back out to ' + esc(l.label)}"${l === cur ? ' aria-current="location"' : ''}><span class="dot" style="--c:${l.color}"></span><b>${esc(l.label)}</b><small>${l.files.length}</small></button>${html}</div>`;
  }
  minimapEl.innerHTML = `<div class="mm-t">Cubes open</div>${html}`;
}
minimapEl.addEventListener('click', (e) => { const b = e.target.closest('[data-depth]'); if (b) goTo(+b.getAttribute('data-depth')); });

function renderChips() {
  const lvl = current();
  const fixed = state.levels.slice(1).map((l) => `<span class="chip fixed" data-fixed="${l.axis}" style="--c:${l.ax.color}" title="Fixed by the path: every file on this cube has ${esc(l.ax.label)} = ${esc(l.label)}"><span class="dot"></span>${esc(l.ax.label)}<small>${esc(l.label)}</small></span>`).join('');
  $('#chips-fixed').innerHTML = fixed;
  $('#chips-fixed-l').hidden = !fixed;
  if (lvl.mode === 'cube') {
    const cube = lvl.cube;
    $('#chips-shown').innerHTML = FACES.map((face) => { const ax = axesById[cube.state.faces[face]]; return `<button class="chip on" type="button" draggable="true" data-axis="${ax.id}" style="--c:${ax.color}" title="${esc(ax.label)} is on the ${FACE_LABEL[face]} face. Click to move it, or drag it onto another face."><span class="dot"></span>${esc(ax.label)}<small>${FACE_LABEL[face]}</small></button>`; }).join('');
    $('#chips-hidden').innerHTML = freeAxes(lvl).map((ax) => `<button class="chip" type="button" draggable="true" data-axis="${ax.id}" style="--c:${ax.color}" title="${esc(ax.label)} is free: ${groupBy(lvl.files, ax).filter((g) => g.files.length).length} groups on these files. Click to choose a face, or drag it onto one."><span class="dot"></span>${esc(ax.label)}</button>`).join('');
  } else {
    $('#chips-shown').innerHTML = `<span class="chip fixed" style="--c:var(--dim)" title="This level is a flat list: fewer than two free axes still tell these files apart"><svg class="ic" style="width:14px;height:14px"><use href="#i-layers"/></svg>Flat list · no cube at this depth</span>`;
    $('#chips-hidden').innerHTML = freeAxes(lvl).map((ax) => `<span class="chip fixed" data-axis="${ax.id}" style="--c:${ax.color};opacity:.6" title="${esc(ax.label)}: only ${groupBy(lvl.files, ax).filter((g) => g.files.length).length} group here"><span class="dot"></span>${esc(ax.label)}</span>`).join('');
  }
}
function freeAxes(lvl) { return axes.filter((a) => lvl.used.indexOf(a.id) < 0 && !(lvl.faces && FACES.some((f) => lvl.faces[f] === a.id))); }

function renderSidebar() {
  const lvl = current();
  $('#path-nav').innerHTML = state.levels.map((l) => `<button type="button" class="${l === lvl ? 'on' : ''}" data-depth="${l.depth}" title="${l === lvl ? 'This cube' : 'Zoom back out to ' + esc(l.label)}">${miniHTML(l)}<span>${esc(l.label)}</span><span class="cnt">${l.files.length}</span></button>`).join('');
  $('#path-count').textContent = String(lvl.depth);
  $('#axes-nav').innerHTML = axes.map((ax) => {
    const fixedLvl = state.levels.find((l) => l.axis === ax.id);
    const face = lvl.cube ? lvl.cube.faceOf(ax.id) : null;
    const st = fixedLvl ? `<span class="facepill" title="Fixed by the path">${esc(fixedLvl.label)}</span>` : face ? `<span class="facepill">${FACE_LABEL[face]}</span>` : '<span class="cnt">free</span>';
    return `<button type="button" class="${face || fixedLvl ? 'on' : ''}" data-axis="${ax.id}" ${fixedLvl ? 'data-fixed="1"' : ''} style="--c:${ax.color}" title="${esc(ax.label)}${fixedLvl ? ' · fixed to ' + esc(fixedLvl.label) + ' by the path' : face ? ' · ' + FACE_LABEL[face] + ' face' : ' · free'}"><span class="dot"></span><span>${esc(ax.label)}</span>${st}</button>`;
  }).join('');
  $('#axes-count').textContent = String(axes.length);
}
$('#path-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-depth]'); if (b) goTo(+b.getAttribute('data-depth')); });

function renderStatus() {
  const lvl = current(), sel = state.selected ? files.find((f) => f.id === state.selected) : null;
  const n = state.query ? lvl.files.filter(matches).length : lvl.files.length;
  let h = `<b>${state.query ? n + ' of ' + lvl.files.length + ' files match' : plural(lvl.files.length, 'file')}</b><span class="sep">·</span>cube ${lvl.depth} of ${state.levels.length}`;
  if (lvl.mode === 'cube') {
    h += `<span class="sep">·</span>${FACES.map((f) => esc(axesById[lvl.cube.state.faces[f]].label)).join(' × ')}`;
    if (lvl.cube.state.snap !== 'iso') h += `<span class="sep">·</span>${lvl.cube.state.snap === 'free' ? 'Free angle' : FACE_LABEL[lvl.cube.state.snap] + ' face square-on'}`;
  } else h += '<span class="sep">·</span>Flat list';
  if (lvl.depth > 1) h += `<span class="sep">·</span>${state.levels.slice(1).map((l) => esc(l.ax.label) + ' = ' + esc(l.label)).join(', ')}`;
  if (state.compare) h += `<span class="sep">·</span>Comparing with ${esc(state.compare.sibling.label)}`;
  if (state.focusGroup) { const ax = axesById[state.focusGroup.axis]; h += `<span class="sep">·</span>${esc(ax.label)} · ${esc(state.focusGroup.value === null ? ax.none : state.focusGroup.value)} focused`; }
  if (sel) h += `<span class="sep">·</span>${esc(sel.name)} selected`;
  h += `<span class="r"><span class="keys"><span><span class="kbd">Enter</span>open</span><span><span class="kbd">⌫</span>up</span><span><span class="kbd">Home</span>root</span><span><span class="kbd">1 2 3</span>faces</span><span><span class="kbd">0</span>reset</span><span><span class="kbd">?</span>tour</span></span><span class="sync"><i></i>Synced</span></span>`;
  $('#sbar').innerHTML = h;
}

/* =====================================================================
   Selection across levels, inspector
   ===================================================================== */
function onSelect(lvl, d) {
  if (d.source === 'sync') return;
  setSelected(d.id, lvl);
}
function setSelected(id, fromLvl) {
  state.selected = id || null;
  syncSelection(fromLvl);
  renderInspector(); renderCrumbs(); renderStatus();
  emit('select', { id: state.selected, depth: fromLvl ? fromLvl.depth : depth() });
}
function syncSelection(fromLvl) {
  state.levels.forEach((l) => {
    if (l === fromLvl) return;
    if (l.cube) l.cube.select(state.selected, { source: 'sync' });
    if (l.list) l.list.select(state.selected);
  });
  if (state.compare) [state.compare.a, state.compare.b].forEach((c) => { if (c !== (fromLvl && fromLvl.cube)) c.select(state.selected, { source: 'sync' }); });
}
const select = (id) => setSelected(id, null);

function showInRoot() {
  if (!state.selected) return false;
  const id = state.selected;
  const spot = () => {
    const root = state.levels[0];
    if (!root.cube) return;
    root.cube.select(id, { source: 'sync' });
    root.cube.scrollSelectedIntoView();
    const rows = $$(`.face [data-id="${attr(id)}"]`, root.el);
    rows.forEach((n) => { n.classList.add('spot'); const t = n.closest('.tile'); if (t) t.classList.add('spot'); });
    setTimeout(() => $$('.spot', root.el).forEach((n) => n.classList.remove('spot')), 2600);
    emit('showRoot', { id });
  };
  if (depth() > 1) { goTo(1); setTimeout(spot, ANIM + 40); } else spot();
  return true;
}

function avatar(p) { const pe = people[p]; return pe ? `<span class="av" style="--c:${pe.color}">${pe.initials}</span>` : ''; }
function chev() { return '<svg class="ic chv"><use href="#i-chevr"/></svg>'; }
function pathLineHTML(file, extraStep) {
  let h = `<span class="pathline"><button class="step" type="button" data-depth="1" title="Zoom out to the root cube"><svg class="ic" style="width:12px;height:12px"><use href="#i-home"/></svg><b>${esc(workspace)}</b></button>`;
  state.levels.slice(1).forEach((l) => {
    const inIt = !file || l.files.some((f) => f.id === file.id);
    if (!inIt) return;
    h += `<span class="seg">${chev()}<button class="step" type="button" data-depth="${l.depth}" title="${l === current() ? 'This cube' : 'Zoom to ' + esc(l.label)}"><span class="dot" style="--c:${l.ax.color}"></span><small>${esc(l.ax.label)}</small><b>${esc(l.label)}</b></button></span>`;
  });
  if (extraStep) h += `<span class="seg">${chev()}<span class="step"><span class="dot" style="--c:${extraStep.color}"></span><small>${esc(extraStep.axis)}</small><b>${esc(extraStep.label)}</b></span></span>`;
  if (file) h += `<span class="seg">${chev()}<span class="step file"><span class="th ${kinds[file.kind].th}" style="width:12px;height:12px;border-radius:3px"></span><b>${esc(file.name)}</b></span></span>`;
  return h + '</span>';
}
function renderInspector() {
  const insp = $('#inspector'), lvl = current();
  const f = state.selected ? files.find((x) => x.id === state.selected) : null;
  if (!f) {
    let sibs = '';
    if (lvl.depth > 1) {
      const parent = state.levels[lvl.depth - 2];
      const groups = groupBy(parent.files, lvl.axis).filter((g) => g.files.length);
      sibs = `<div class="sec-h">Siblings<span class="cnt">· ${groups.length} ${esc(lvl.ax.label)} groups in ${esc(parent.label)}</span></div><div class="sibs">` +
        groups.map((g) => `<button class="sib${g.value === lvl.value ? ' cur' : ''}" type="button" data-sibling="${esc(g.value === null ? '' : g.value)}" style="--c:${lvl.ax.color}" title="${g.value === lvl.value ? 'This cube' : 'Jump to ' + esc(g.label) + ' instead'}"><span class="dot"></span>${esc(g.label)}<span class="bar"><i style="--w:${Math.round(g.files.length / parent.files.length * 100)}%"></i></span><small>${g.files.length}</small></button>`).join('') + '</div>';
    }
    insp.innerHTML = `<div class="ih"><svg class="ic"><use href="#i-nested"/></svg>This cube<span class="kbd">${lvl.depth} of ${state.levels.length}</span></div>` +
      `<div class="cubecard">${miniHTML(lvl)}<div><b>${esc(lvl.label)}</b><small>${plural(lvl.files.length, 'file')} · ${lvl.mode === 'cube' ? FACES.map((x) => esc(axesById[lvl.faces[x]].label)).join(' × ') : 'flat list'}</small></div></div>` +
      (lvl.depth > 1 ? `<div class="sec-h">Path</div>${pathLineHTML(null)}` : '') +
      (lvl.mode === 'cube' ? `<div class="sec-h">Faces<span class="cnt">· ${lvl.depth > 1 ? 'chosen for these files' : 'the Facet defaults'}</span></div><div class="tags">${FACES.map((x) => { const ax = axesById[lvl.faces[x]]; return `<span class="pill c" style="--c:${ax.color}" title="${groupBy(lvl.files, ax).filter((g) => g.files.length).length} groups">${esc(ax.label)} · ${FACE_LABEL[x]}</span>`; }).join('')}</div>` : '') +
      sibs +
      `<div class="note">${lvl.depth > 1
        ? `<b>Every file here has ${state.levels.slice(1).map((l) => esc(l.ax.label) + ' = ' + esc(l.label)).join(' and ')}.</b> ${lvl.mode === 'cube' ? `The faces were picked as the three free axes that split these ${lvl.files.length} files into the most groups; the chips above override them.` : 'Fewer than two free axes still tell these files apart, so this level is a flat list rather than a cube.'}`
        : '<b>Hover a group and press Open ▸</b> (or double-click it). The group becomes its own cube, and this cube shrinks into the path above.'}</div>` +
      (lvl.depth > 1 ? `<div class="btnrow"><button class="btn" type="button" data-up><svg class="ic"><use href="#i-back"/></svg>Zoom out</button>${lvl.mode === 'cube' ? '<button class="btn" type="button" data-compare><svg class="ic"><use href="#i-compare"/></svg>Compare siblings</button>' : ''}</div>` : '');
    return;
  }
  const kind = kinds[f.kind], owner = people[f.owner];
  const onLevels = state.levels.filter((l) => l.files.some((x) => x.id === f.id));
  const inCurrent = onLevels.indexOf(lvl) >= 0;
  const fixedAxes = onLevels.map((l) => l.axis).filter(Boolean);
  let extra = null;
  if (!inCurrent && state.compare && state.compare.sibling.files.some((x) => x.id === f.id)) extra = { axis: lvl.ax.label, label: state.compare.sibling.label, color: lvl.ax.color };
  const others = axes.filter((a) => f.axes[a.id] && fixedAxes.indexOf(a.id) < 0 && !(extra && a.id === lvl.axis));
  insp.innerHTML = `<div class="ih"><svg class="ic"><use href="#i-cube"/></svg>File<button class="ib" type="button" data-close title="Clear selection" aria-label="Clear selection"><svg class="ic"><use href="#i-x"/></svg></button></div>` +
    `<div class="prev th ${kind.th}"></div>` +
    `<h3>${esc(f.name)}<span class="pill ac" title="This file is on ${onLevels.length} of the ${state.levels.length} cubes in the path">on ${onLevels.length} of ${state.levels.length} cube${state.levels.length === 1 ? '' : 's'}</span></h3>` +
    `<div class="meta"><span>Kind</span><b>${esc(kind.label)} · ${esc(f.size)}</b><span>Owner</span><b>${avatar(f.owner)}${esc(owner.name)}</b><span>Modified</span><b>${esc(f.modified)}</b></div>` +
    `<div class="sec-h">Path to it<span class="cnt">· ${onLevels.length - 1 + (extra ? 1 : 0)} group${onLevels.length - 1 + (extra ? 1 : 0) === 1 ? '' : 's'} deep</span></div>${pathLineHTML(f, extra)}` +
    `<div class="sec-h">Also belongs to<span class="cnt">· ${others.length} other axes</span></div><div class="tags">${others.map((a) => `<span class="pill c" style="--c:${a.color}" title="${esc(a.label)}: ${esc(f.axes[a.id])}">${esc(a.label)} · ${esc(f.axes[a.id])}</span>`).join('')}</div>` +
    (extra ? `<div class="note"><b>Sibling cube.</b> This file is in ${esc(extra.label)}, the group being compared, not on the path itself.</div>` : '') +
    `<div class="btnrow"><button class="btn pri" type="button" data-show-root title="Zoom all the way out and highlight this file on the root cube"><svg class="ic"><use href="#i-home"/></svg>Show in root</button>${lvl.depth > 1 && inCurrent ? '<button class="btn" type="button" data-up title="Zoom out one level; the file stays selected"><svg class="ic"><use href="#i-back"/></svg>Zoom out</button>' : ''}</div>`;
}
$('#inspector').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { select(null); return; }
  if (e.target.closest('[data-show-root]')) { showInRoot(); return; }
  if (e.target.closest('[data-up]')) { up(); return; }
  if (e.target.closest('[data-compare]')) { openCompare(); return; }
  const sib = e.target.closest('[data-sibling]'); if (sib && !sib.classList.contains('cur')) { jumpToSibling(sib.getAttribute('data-sibling') || null); return; }
  const st = e.target.closest('.pathline [data-depth]'); if (st) goTo(+st.getAttribute('data-depth'));
});

/* =====================================================================
   Axes on faces: chips, menu, drag
   ===================================================================== */
function showAxis(axisId, face, opts) {
  const lvl = current(); if (!lvl.cube || lvl.used.indexOf(axisId) >= 0) return false;
  lvl.cube.showAxis(axisId, face, opts);
  return true;
}
function openMenu(anchor, html, onPick) {
  menuEl.innerHTML = html; menuEl.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
  let top = r.bottom + 6; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
  menuEl.onclick = (e) => { const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return; closeMenu(); onPick(b.getAttribute('data-act'), b); };
  const first = $('button', menuEl); if (first) first.focus();
}
function closeMenu() { menuEl.hidden = true; menuEl.innerHTML = ''; }
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !e.target.closest('#menu')) closeMenu(); });
function openAxisMenu(anchor, axisId) {
  const lvl = current(); if (!lvl.cube) return;
  const cube = lvl.cube, ax = axesById[axisId], face = cube.faceOf(axisId);
  const free = freeAxes(lvl);
  let html;
  if (face) {
    html = `<div class="mh"><span class="dot" style="--c:${ax.color}"></span>${esc(ax.label)} · ${FACE_LABEL[face]} face</div>` +
      FACES.filter((f) => f !== face).map((f) => `<button type="button" data-act="face:${f}">Move to ${FACE_LABEL[f]}<small>swap with ${esc(axesById[cube.state.faces[f]].label)}</small></button>`).join('') +
      (free.length ? '<hr>' + free.map((h) => `<button type="button" data-act="replace:${h.id}"><span class="dot" style="--c:${h.color}"></span>Replace with ${esc(h.label)}<small>${groupBy(lvl.files, h).filter((g) => g.files.length).length} groups</small></button>`).join('') : '');
  } else {
    html = `<div class="mh"><span class="dot" style="--c:${ax.color}"></span>Show ${esc(ax.label)} on…</div>` +
      FACES.map((f) => `<button type="button" data-act="face:${f}">${FACE_LABEL[f]} face<small>replaces ${esc(axesById[cube.state.faces[f]].label)}</small></button>`).join('');
  }
  openMenu(anchor, html, (act) => { const p = act.split(':'); if (p[0] === 'face') showAxis(axisId, p[1]); else if (p[0] === 'replace') showAxis(p[1], face); });
}
document.addEventListener('click', (e) => {
  const chip = e.target.closest('button[data-axis]');
  if (!chip || e.target.closest('.menu') || chip.hasAttribute('data-fixed')) return;
  e.preventDefault();
  openAxisMenu(chip, chip.getAttribute('data-axis'));
});
document.addEventListener('dragstart', (e) => { const chip = e.target.closest && e.target.closest('.chip[data-axis]'); if (!chip) return; e.dataTransfer.setData('text/plain', chip.getAttribute('data-axis')); e.dataTransfer.effectAllowed = 'move'; chip.classList.add('dragging'); });
document.addEventListener('dragend', () => { $$('.chip.dragging').forEach((c) => c.classList.remove('dragging')); $$('.face.drop').forEach((f) => f.classList.remove('drop')); });

/* =====================================================================
   Compare siblings: two cubes with the same axes, turning together
   ===================================================================== */
let linkLock = false;
function link(a, b) {
  a.on('rotate', (d) => {
    if (linkLock) return;
    linkLock = true;
    try { b.setRotation(d.rx, d.ry, a.el.classList.contains('animating'), d.snap); } finally { linkLock = false; }
  });
}
function siblingsOf(lvl) {
  const parent = state.levels[lvl.depth - 2];
  return groupBy(parent.files, lvl.axis).filter((g) => g.files.length && g.value !== lvl.value);
}
function openCompare(siblingValue) {
  const lvl = current();
  if (lvl.depth < 2 || lvl.mode !== 'cube' || state.busy) return false;
  if (state.compare) { if (siblingValue === undefined || siblingValue === state.compare.sibling.value) return true; closeCompare(true); }
  const sibs = siblingsOf(lvl);
  if (!sibs.length) { toast(`${esc(lvl.label)} has no sibling ${esc(lvl.ax.label)} group to compare with.`); return false; }
  // default: the next sibling in axis order (Acme → Globex), wrapping around
  const all = groupBy(state.levels[lvl.depth - 2].files, lvl.axis).filter((g) => g.files.length);
  const idx = all.findIndex((g) => g.value === lvl.value);
  const sib = sibs.find((g) => g.value === siblingValue) || all[(idx + 1) % all.length];
  closeMenu();
  const el = document.createElement('div'); el.className = 'compare'; el.id = 'compare';
  const col = (id, label, n, tag, pick) => `<div class="cmp-col" data-side="${id}"><div class="ch"><span class="dot" style="--c:${lvl.ax.color}"></span>${pick ? `<select id="cmp-pick" aria-label="Sibling group to compare with">${sibs.map((g) => `<option value="${esc(g.value === null ? '' : g.value)}"${g.value === sib.value ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>` : `<b>${esc(label)}</b>`}<span class="cnt">${plural(n, 'file')}</span><span class="tag${tag === 'This cube' ? ' cur' : ''}">${tag}</span></div><div class="cube-stage cmp-stage" id="cmp-${id}"></div></div>`;
  el.innerHTML = `<div class="cmp-h"><svg class="ic"><use href="#i-compare"/></svg><span><b>${esc(lvl.ax.label)}: ${esc(lvl.label)} vs ${esc(sib.label)}</b> · both cubes grouped by ${FACES.map((f) => esc(axesById[lvl.faces[f]].label)).join(' × ')}; drag either one and both turn</span><button class="ib" type="button" id="compare-close" title="Back to the single cube (Esc)" aria-label="Close comparison"><svg class="ic"><use href="#i-x"/></svg></button></div>` +
    `<div class="cmp-cols">${col('a', lvl.label, lvl.files.length, 'This cube', false)}${col('b', sib.label, sib.files.length, 'Sibling', true)}</div>` +
    `<div class="cube-tools cmp-tools" role="toolbar" aria-label="Compare controls"><div class="seg snaps"><button type="button" data-snap="front" title="Front faces square-on (1)">Front<kbd>1</kbd></button><button type="button" data-snap="right" title="Right faces square-on (2)">Right<kbd>2</kbd></button><button type="button" data-snap="top" title="Top faces square-on (3)">Top<kbd>3</kbd></button><button type="button" data-snap="iso" title="Back to the three-face view (0)"><svg class="ic"><use href="#i-reset"/></svg>Reset<kbd>0</kbd></button></div></div>`;
  lvl.stageEl.hidden = true;
  lvl.el.appendChild(el);
  levelsEl.classList.add('comparing');
  const size = { min: 220, max: 460, w: 0.72, h: 0.56 };
  const a = createCube($('#cmp-a', el), { files: lvl.files, axes, kinds, faces: lvl.faces, controls: false, keys: false, size, groupHeaderHTML: (g, ax) => headerHTML(g, ax, lvl) });
  const b = createCube($('#cmp-b', el), { files: sib.files, axes, kinds, faces: lvl.faces, controls: false, keys: false, size, groupHeaderHTML: (g, ax) => headerHTML(g, ax, { files: sib.files, used: lvl.used }) });
  link(a, b); link(b, a);
  const r = lvl.cube.state;
  a.setRotation(r.rot.rx, r.rot.ry, false, r.snap);
  a.on('select', (d) => onSelect({ cube: a, depth: lvl.depth }, d));
  b.on('select', (d) => onSelect({ cube: b, depth: lvl.depth }, d));
  a.on('groupOpen', (d) => openGroup(d.axis, d.value));
  a.on('snap', () => renderStatus());
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-snap]'); if (s) { a.snap(s.getAttribute('data-snap')); return; }
    if (e.target.closest('#compare-close')) closeCompare();
    const o = e.target.closest('[data-open]'); if (o && o.closest('#cmp-a')) { const gh = o.closest('.gh, .tile'), face = gh.closest('.face'); openGroup(a.state.faces[face.getAttribute('data-face')], gh.getAttribute('data-group') || null); }
  });
  $('#cmp-pick', el).addEventListener('change', (e) => openCompare(e.target.value || null));
  if (state.selected) { a.select(state.selected, { source: 'sync' }); b.select(state.selected, { source: 'sync' }); }
  state.compare = { a, b, el, sibling: sib, lvl };
  const cb = $('#compare-btn'); cb.setAttribute('aria-pressed', 'true');
  renderStatus(); renderInspector();
  emit('compare', { on: true, sibling: sib.value, group: lvl.value });
  return true;
}
function closeCompare(silent) {
  const c = state.compare; if (!c) return false;
  c.a.destroy(); c.b.destroy(); c.el.remove();
  c.lvl.stageEl.hidden = false;
  levelsEl.classList.remove('comparing');
  state.compare = null;
  $('#compare-btn').setAttribute('aria-pressed', 'false');
  if (state.selected && c.lvl.cube) c.lvl.cube.select(state.selected, { source: 'sync' });
  if (!silent) { renderStatus(); renderInspector(); }
  emit('compare', { on: false });
  return true;
}
$('#compare-btn').addEventListener('click', () => { if (state.compare) closeCompare(); else openCompare(); });

/* =====================================================================
   Search, toast, theme, keys
   ===================================================================== */
function matches(f) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  if (f.name.toLowerCase().indexOf(q) >= 0) return true;
  for (const k in f.axes) if (f.axes[k] && String(f.axes[k]).toLowerCase().indexOf(q) >= 0) return true;
  return false;
}
function applyQuery() {
  const lvl = current(); if (!lvl) return;
  lvl.files.forEach((f) => { const ok = matches(f); $$(`[data-id="${attr(f.id)}"]`, lvl.el).forEach((n) => n.classList.toggle('dim', !ok)); });
}
$('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); applyQuery(); renderStatus(); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; state.query = ''; applyQuery(); renderStatus(); e.target.blur(); } });

let toastTimer = 0;
function toast(html) { const t = $('#toast'); t.innerHTML = `<span class="msg">${html}</span>`; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

function setTheme(t) {
  state.theme = t === 'light' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', state.theme);
  const b = $('#theme-btn'); b.innerHTML = `<svg class="ic"><use href="#${state.theme === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`; b.title = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`; b.setAttribute('aria-label', b.title);
  try { localStorage.setItem('nested.theme', state.theme); } catch (e) { /* ignore */ }
  emit('theme', { theme: state.theme });
}
$('#theme-btn').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#sb-toggle').addEventListener('click', () => { $('#app').classList.toggle('sb-open'); setTimeout(() => { const l = current(); if (l.cube) l.cube.layout(); }, 50); });
$$('.sb .nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (a.id === 'nav-all') home(); }));
$('#up-btn').addEventListener('click', up);
$('#home-btn').addEventListener('click', home);

function activeCube() { return state.compare ? state.compare.a : current().cube; }
document.addEventListener('keydown', (e) => {
  const t = e.target, tag = t && t.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  if (e.key === 'Escape') {
    if (!menuEl.hidden) { closeMenu(); return; }
    if (typing) return;
    if (state.compare) { e.preventDefault(); closeCompare(); return; }
    if (depth() > 1) { e.preventDefault(); up(); return; }
    if (state.selected) select(null);
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const cube = activeCube();
  switch (e.key) {
    case 'Backspace': e.preventDefault(); up(); break;
    case 'Home': e.preventDefault(); home(); break;
    case 'Enter': {
      const g = state.focusGroup || state.hoverGroup;
      if (g && current().cube) { e.preventDefault(); openGroup(g.axis, g.value); }
      break;
    }
    case '1': if (cube) { e.preventDefault(); cube.snap('front'); } break;
    case '2': if (cube) { e.preventDefault(); cube.snap('right'); } break;
    case '3': if (cube) { e.preventDefault(); cube.snap('top'); } break;
    case '0': if (cube) { e.preventDefault(); cube.snap('iso'); } break;
    case 'c': case 'C': e.preventDefault(); if (state.compare) closeCompare(); else openCompare(); break;
    case '/': e.preventDefault(); $('#search').focus(); break;
    case '?': e.preventDefault(); tour.toggle(); break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      if (cube) { e.preventDefault(); cube.rotateBy(e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0, e.key === 'ArrowUp' ? 8 : e.key === 'ArrowDown' ? -8 : 0, true); }
      break;
  }
});

/* ---- the mini cubes turn slowly, all in step ---- */
if (!reduced) (function spin() { document.body.style.setProperty('--spin', (((performance.now() / 26000) * 360) % 360 - 35).toFixed(2) + 'deg'); requestAnimationFrame(spin); })();

/* =====================================================================
   Tour
   ===================================================================== */
function ensureChild(then) {
  if (depth() >= 2) { then(); return; }
  const root = state.levels[0];
  if (root.cube.faceOf('client')) openGroup('client', 'Acme', { silent: true });
  else { const g = root.cube.groupsFor(root.faces.right).filter((x) => x.files.length > 2)[0]; openGroup(root.faces.right, g.value, { silent: true }); }
  setTimeout(then, ANIM + 60);
}
const tour = createTour({
  key: 'nested', on, off, button: '#tour-btn',
  steps: [
    { title: 'A group opens into its own cube', target: '.level.current .face.right .gh[data-group="Acme"]', event: 'open', task: 'Open Client · Acme',
      body: 'This is Facet\'s cube: 25 files by Project × Client × Type. Hover <b>Acme</b> on the Client face and press <b>Open ▸</b> (or double-click it). The eight Acme files become a cube of their own, grouped by the three free axes that split them best; this cube shrinks into the path above.',
      check: (d) => d.depth === 2, doit: () => { const root = state.levels[0]; if (root.cube.faceOf('client')) openGroup('client', 'Acme'); else { root.cube.showAxis('client', 'right', { silent: true }); setTimeout(() => openGroup('client', 'Acme'), 300); } } },
    { title: 'The breadcrumb is a path of cubes', target: '#crumbs-bar',
      body: 'Each step of the way is a live mini cube: <b>Northwind</b>, then <b>Acme</b>. Hover one to see which axis is on which face; the dashed chips below say what the path has fixed (Client = Acme), so those axes are not offered again. The mini-map bottom-left draws the same nesting.' },
    { title: 'Drill again', target: '.level.current .face', event: 'open', task: 'Open a group on this cube',
      body: 'Open any group here, say <b>Type · Contract</b>. Only unused axes are left for the grandchild, so the faces get more specific the deeper you go; a group with too few axes left opens as a flat list instead.',
      check: (d) => d.depth >= 3, doit: () => { const lvl = current(); if (!lvl.cube) return; const pref = lvl.cube.faceOf('type') ? lvl.cube.groupsFor('type').find((g) => g.value === 'Contract') : null; if (pref && pref.files.length) openGroup('type', 'Contract'); else { const ax = lvl.faces.front, g = lvl.cube.groupsFor(ax).filter((x) => x.files.length > 1).sort((x, y) => y.files.length - x.files.length)[0]; openGroup(ax, g ? g.value : null); } } },
    { title: 'Zoom back out', target: '#crumbs', event: 'zoom', task: 'Click a cube in the path, or press Backspace',
      body: 'Click any earlier cube in the path (or the mini-map), or press <kbd>Backspace</kbd>. The child folds back into the group it came from, which lights up so you can see where you were. <kbd>Home</kbd> goes straight to the root.',
      check: (d) => d.dir === 'out', doit: () => up() },
    { title: 'Override an axis', target: '#chips', event: 'axisSwap', task: 'Put a free axis on a face',
      body: 'The chosen faces are a suggestion. Click a <b>free</b> chip and pick a face, or drag it onto one. Axes the path already used stay fixed, so a child cube never re-asks a question the path has answered.',
      before: () => { if (depth() < 2) ensureChild(() => {}); },
      doit: () => ensureChild(() => { const lvl = current(); const free = freeAxes(lvl)[0]; if (free) showAxis(free.id, 'top'); else tour.markDone(); }) },
    { title: 'Compare siblings', target: '#compare-btn', event: 'compare', task: 'Press Compare siblings',
      body: 'From inside a child cube, <b>Compare siblings</b> puts this group beside a sibling group (Acme vs Globex) as two cubes with the same axes that turn together, so you can compare their shape: who has more contracts, which quarter is busier.',
      check: (d) => d.on, doit: () => ensureChild(() => openCompare()) },
    { title: 'Select, and show in root', target: '#inspector', event: 'showRoot', task: 'Select a file, then press Show in root',
      body: 'Select any file: it lights up on every cube in the path (the dot on each mini cube) and the inspector shows the path it took, plus its other memberships. <b>Show in root</b> zooms all the way out and highlights it on the first cube.',
      before: () => { if (state.compare) closeCompare(); },
      doit: () => ensureChild(() => { const lvl = current(); const f = lvl.files.find((x) => x.id === 'acme-sow-q3') || lvl.files[0]; select(f.id); setTimeout(showInRoot, 350); }) }
  ]
});

/* =====================================================================
   Boot
   ===================================================================== */
let storedTheme = null; try { storedTheme = localStorage.getItem('nested.theme'); } catch (e) { /* ignore */ }
setTheme(storedTheme || 'dark');
state.levels.push(makeLevel(null, null, null, files.slice()));
setCurrent(state.levels[0]);
$('#nav-all-count').textContent = String(files.length);

window.Proto = {
  state, data, tour, on, off, filesAt, QUARTERS, NOW, groupBy,
  get cube() { return current().cube; }, get depth() { return depth(); }, current, levels: () => state.levels, cubeAt: (d) => state.levels[d - 1] && state.levels[d - 1].cube,
  open: openGroup, goTo, up, home, showAxis, select, showInRoot, openCompare, closeCompare, jumpToSibling, chooseFaces, rank, setTheme, toast, focusGroup: (axis, value) => focusGroup(current(), axis, value)
};
