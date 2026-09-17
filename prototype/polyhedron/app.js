/* ==========================================================================
   prototype/polyhedron/app.js — Polyhedron: one face per axis on a rolling
   solid that morphs as axes are folded away.

   Geometry (solids.js) gives each face a centroid, an outward normal and an
   in-plane basis; this file places one HTML panel per face with matrix3d,
   rotates the parent with a quaternion, culls/fades faces by their rotated
   normal every frame, and animates the morph between solids by transitioning
   each axis's panel to its new face (same DOM node, new transform + clip).

   window.Proto = { state, setAxes, toggleAxis, preset, rollTo, focus, unfocus,
                    flatten, select, frontmost, faceZ, solidName, tour, on, off, … }
   ========================================================================== */
import '../shared/icons.js';
import data, { files, axes, axesById, coreAxes, kinds, people, groupBy, filesAt, QUARTERS, NOW } from '../shared/data.js';
import { createTour } from '../shared/tour.js';
import { buildSolid, solidFor, unfold, inscribedRect, chordAt } from './solids.js';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DUR = reduced ? 0 : 1;

/* ---- quaternions [x, y, z, w]; q1*q2 applies q2 first ---- */
const Q = {
  id: () => [0, 0, 0, 1],
  axis(ax, deg) { const h = deg * Math.PI / 360, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; },
  mul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  },
  norm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / l); },
  rot(q, v) {
    const [x, y, z, w] = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((v) => -v); d = -d; }
    if (d > 0.9995) return Q.norm(a.map((v, i) => v + (b[i] - v) * t));
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  },
  // rotation that takes the basis (u, d, n) to (x, y, z): matrix rows u, d, n
  fromBasis(u, d, n) {
    const m = [u, d, n], tr = m[0][0] + m[1][1] + m[2][2];
    let x, y, z, w, S;
    if (tr > 0) { S = Math.sqrt(tr + 1) * 2; w = S / 4; x = (m[2][1] - m[1][2]) / S; y = (m[0][2] - m[2][0]) / S; z = (m[1][0] - m[0][1]) / S; }
    else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { S = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / S; x = S / 4; y = (m[0][1] + m[1][0]) / S; z = (m[0][2] + m[2][0]) / S; }
    else if (m[1][1] > m[2][2]) { S = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / S; x = (m[0][1] + m[1][0]) / S; y = S / 4; z = (m[1][2] + m[2][1]) / S; }
    else { S = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / S; x = (m[0][2] + m[2][0]) / S; y = (m[1][2] + m[2][1]) / S; z = S / 4; }
    return Q.norm([x, y, z, w]);
  },
  css(q) {
    const [x, y, z, w] = q;
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    return `matrix3d(${r[0].toFixed(5)},${r[1].toFixed(5)},${r[2].toFixed(5)},0,${r[3].toFixed(5)},${r[4].toFixed(5)},${r[5].toFixed(5)},0,${r[6].toFixed(5)},${r[7].toFixed(5)},${r[8].toFixed(5)},0,0,0,0,1)`;
  }
};
// the hero tilt shows the rolled face plus its neighbours; it must stay under half the angle between
// adjacent face normals (cube 90°, tetra/octa 109°/71°, dodecahedron 63°) so the rolled face stays front-most
const HERO_TILT = { tetrahedron: [-30, -38], cube: [-28, -36], octahedron: [-21, -26], dodecahedron: [-17, -22] };
const heroQ = () => { const t = HERO_TILT[state.solid] || HERO_TILT.cube; return Q.mul(Q.axis([1, 0, 0], t[0]), Q.axis([0, 1, 0], t[1])); };
const m3d = (u, d, n, c) => `matrix3d(${u[0].toFixed(5)},${u[1].toFixed(5)},${u[2].toFixed(5)},0,${d[0].toFixed(5)},${d[1].toFixed(5)},${d[2].toFixed(5)},0,${n[0].toFixed(5)},${n[1].toFixed(5)},${n[2].toFixed(5)},0,${c[0].toFixed(2)},${c[1].toFixed(2)},${c[2].toFixed(2)},1)`;

/* ---- presets ---- */
export const PRESETS = {
  cube: { label: 'Cube', n: 3, axes: ['project', 'client', 'type'], title: 'Facet’s three: Project, Client, Type' },
  core: { label: 'Core 5', n: 5, axes: coreAxes.map((a) => a.id), title: 'The five core axes: Project, Client, Type, Quarter, Person' },
  all: { label: 'Everything', n: 12, axes: axes.map((a) => a.id), title: 'All twelve axes: a dodecahedron' },
  legal: { label: 'Legal review', n: 4, axes: ['client', 'status', 'shared', 'type'], title: 'Client, Status, Shared with, Type' },
  owners: { label: 'Who owns what', n: 3, axes: ['owner', 'person', 'project'], title: 'Owner, Person, Project' }
};
const ORDER = axes.map((a) => a.id);
const canon = (ids) => ORDER.filter((id) => ids.includes(id));

/* ---- state ---- */
const state = {
  files: files.slice(), active: PRESETS.cube.axes.slice(), solid: 'cube', slots: [],
  selected: null, focused: null, flat: false, flatScale: 1, query: '', theme: 'dark', tab: 'file',
  view: { q: Q.id(), zoom: 1, tx: 0, ty: -18 }, frontmost: null
};
const filesById = {}; state.files.forEach((f) => { filesById[f.id] = f; });

/* ---- event bus ---- */
const listeners = {};
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); }
function emit(ev, d) { (listeners[ev] || []).slice().forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); }

/* ---- DOM ---- */
const stageEl = $('#poly-stage'), polyEl = $('#poly'), toolsEl = $('#tools');
const panels = {};   // key (axis id or blank-i) -> panel element
let geo = null;      // { solid, s, net }

/* ==========================================================================
   Geometry → panels
   ========================================================================== */
const FIT = { tetrahedron: 1.0, cube: 1.0, octahedron: 1.1, dodecahedron: 1.12 };
function budget() {
  const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600;
  return clamp(Math.min(w * 0.36, h * 0.46), 170, 420);
}
function unitScale(solid) { return budget() * FIT[solid.name] / solid.circum; }
function clipPoints(pts, ox, oy) {
  const six = pts.length === 3 ? [0, 0, 1, 1, 2, 2] : pts.length === 4 ? [0, 0, 1, 2, 2, 3] : [0, 0, 1, 2, 3, 4];
  return six.map((i) => `${(ox + pts[i][0]).toFixed(1)}px ${(oy + pts[i][1]).toFixed(1)}px`).join(',');
}
// the panel is the polygon's bounding box plus a 7px margin; (ox, oy) is where the face centroid sits inside it
function faceLayout(face, s, f, rot) {
  const k = s * f, cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
  const pts = face.local.map((p) => [(p[0] * cs - p[1] * sn) * k, (p[0] * sn + p[1] * cs) * k]);
  const R = face.R * k;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = Math.round(maxX - minX + 14), H = Math.round(maxY - minY + 14), ox = 7 - minX, oy = 7 - minY;
  const ins = 1 - 9 / R;
  const inner = pts.map((p) => [p[0] * ins, p[1] * ins]);
  const rect = inscribedRect(inner, 44);
  rect.x += 2; rect.w -= 4; rect.h -= 4;
  let head;
  // header above the content rect where the polygon is still wide enough; lower the rect until it is
  const want = Math.min(250, rect.w * 0.92);
  let hy = rect.y - 36, ch = chordAt(inner, hy);
  while (ch && ch[1] - ch[0] < want && rect.h > 120) { rect.y += 6; rect.h -= 6; hy += 6; ch = chordAt(inner, hy); }
  if (R < 92) {
    // a tiny face (the net of a dodecahedron): just the axis name, centred on the polygon
    const c0 = chordAt(inner, 0) || [-R * 0.6, R * 0.6], cw = c0[1] - c0[0];
    head = { x: c0[0] + cw * 0.04, y: -16, w: cw * 0.92, h: 32, apex: false, mini: true };
  } else if (ch && ch[1] - ch[0] >= 110 && !(face.verts.length === 4 && !rot)) {
    const cw = ch[1] - ch[0];
    head = { x: ch[0] + cw * 0.04, y: hy, w: cw * 0.92, h: 32, apex: true };
  } else {
    head = { x: rect.x, y: rect.y, w: rect.w, h: 34, apex: false };
    rect.y += 36; rect.h -= 36;
  }
  return { pts, R, W, H, ox, oy, rect, head, clip: clipPoints(pts, ox, oy), bw: maxX - minX, bh: maxY - minY, midY: (maxY + minY) / 2 };
}
const PERSP = 1600;
function curScale() { return geo.s * (state.flat ? state.flatScale : 1); }
function perspAt(lift) { const zf = state.flat ? lift : geo.solid.inradius * curScale() + lift; return PERSP / (PERSP - zf); }
function focusScale(face, s) {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  const L = faceLayout(face, s, 1), pf = perspAt(40);
  return clamp(Math.min((w - 80) / (L.bw * pf), (h - 136) / (L.bh * pf)), 1, 2.4);
}
// seat = how many symmetry steps (360°/sides) the face's content is turned so its text reads upright
function seatedBasis(face, seat) {
  const phi = (seat || 0) * 2 * Math.PI / face.verts.length, cs = Math.cos(phi), sn = Math.sin(phi);
  const u = face.u.map((v, i) => v * cs + face.d[i] * sn), d = face.d.map((v, i) => v * cs - face.u[i] * sn);
  return { u, d };
}
function solidTransform(face, s, lift, collapsed, seat) {
  const c = [face.c[0] * s + face.n[0] * lift, face.c[1] * s + face.n[1] * lift, face.c[2] * s + face.n[2] * lift];
  const k = collapsed ? 0.02 : 1, b = seatedBasis(face, seat);
  return m3d(b.u.map((v) => v * k), b.d.map((v) => v * k), face.n.map((v) => v * k), c);
}
// in the net the panel is not rotated at all (text upright); the polygon itself is drawn turned by the unfold angle
function netTransform(face, s, lift) {
  const p = geo.net.placed[face.i];
  return m3d([1, 0, 0], [0, 1, 0], [0, 0, 1], [p.center[0] * s, p.center[1] * s, lift]);
}
function reseat(immediate) {
  if (state.flat) return;
  const q = state.view.q;
  Object.keys(panels).forEach((key) => {
    const el = panels[key], face = el._face; if (!face || el.classList.contains('gone')) return;
    if (Q.rot(q, face.n)[2] < -0.2) return;
    const d = Q.rot(q, face.d), alpha = Math.atan2(d[0], d[1]), step = 2 * Math.PI / face.verts.length;
    const seat = Math.round(alpha / step);
    if (seat !== (el._seat || 0)) {
      el._seat = seat;
      if (immediate) polyEl.classList.add('notrans');
      el.style.transform = solidTransform(face, curScale(), el._lift || 0, false, seat);
      if (immediate) { void el.offsetWidth; polyEl.classList.remove('notrans'); }
    }
  });
}
function px(el, o) { for (const k in o) el.style[k] = typeof o[k] === 'number' ? o[k].toFixed(1) + 'px' : o[k]; }

function createPanel(axisId, slot) {
  const el = document.createElement('section');
  el.className = 'face' + (axisId ? '' : ' blank');
  el.setAttribute('data-axis', axisId || '');
  el.setAttribute('data-mode', axisId ? 'full' : 'blank');
  if (axisId) { const ax = axesById[axisId]; el.style.setProperty('--fc', ax.color); el.setAttribute('aria-label', 'By ' + ax.label); }
  else el.setAttribute('aria-label', 'Spare face');
  el.innerHTML = '<div class="fin"><svg class="outline" aria-hidden="true"><polygon points=""/></svg><div class="shade"></div>' +
    (axisId
      ? '<header class="fh" title="Click to focus this face"><span class="fdot"></span><span class="ft"></span><span class="pos">front</span><span class="cnt"></span></header><div class="fb"></div><div class="fl" title="Click to focus this face"></div><button class="fx" type="button" title="Unfocus (Esc)" aria-label="Unfocus this face"><svg class="ic"><use href="#i-x"/></svg></button>'
      : '<div class="fb"><svg class="ic"><use href="#i-plus"/></svg><b>Spare face</b><button type="button" data-add title="Put an axis on this face">Add an axis</button></div>') + '</div>';
  return el;
}
function renderFaceContent(el, axisId) {
  const stamp = axisId + ':' + filesStamp;
  if (el._stamp === stamp) return;
  el._stamp = stamp;
  const ax = axesById[axisId], groups = groupBy(state.files, axisId), total = state.files.length;
  $('.ft', el).innerHTML = '<span class="by">By </span>' + esc(ax.label);
  $('.cnt', el).textContent = groups.filter((g) => g.files.length).length + ' groups';
  const fb = $('.fb', el), st = fb.scrollTop;
  fb.innerHTML = groups.map((g) => {
    const w = total ? Math.round(g.files.length / total * 100) : 0;
    return `<div class="grp${g.value === null ? ' none' : ''}" data-group="${esc(g.value === null ? '' : g.value)}"><header class="gh" data-group="${esc(g.value === null ? '' : g.value)}" title="${esc(g.label)}: ${g.files.length} file${g.files.length === 1 ? '' : 's'}"><b>${esc(g.label)}</b><span class="bar"><i style="--w:${w}%"></i></span><small>${g.files.length}</small></header>` +
      g.files.map((f) => { const k = kinds[f.kind]; return `<div class="row" data-id="${esc(f.id)}" role="button" tabindex="-1" title="${esc(f.name)}${k ? ' · ' + esc(k.label) : ''} · ${esc(f.size)}"><span class="th ${k ? k.th : 'doc'}"></span><span class="nm">${esc(f.name)}</span></div>`; }).join('') + '</div>';
  }).join('');
  fb.scrollTop = st;
  $('.fl', el).innerHTML = groups.filter((g) => g.files.length).map((g) => `<div class="lab${g.value === null ? ' none' : ''}" data-group="${esc(g.value === null ? '' : g.value)}"><b>${esc(g.label)}</b><small>${g.files.length}</small></div>`).join('');
}
let filesStamp = 0;

function applyLayout(el, face, s, isNew) {
  const isFocus = el._axis && state.focused === el._axis;
  const f = isFocus ? focusScale(face, s) : 1;
  const L = faceLayout(face, s, f, state.flat && geo.net ? geo.net.placed[face.i].angle : 0); el._layout = L; el._f = f;
  const { W, H, ox, oy } = L;
  px(el, { width: W, height: H, left: -ox, top: -oy });
  el.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
  // the clip lives on an inner wrapper: Chrome stops hit-testing a clipped element that is itself 3D-transformed once it lies square-on
  $('.fin', el).style.clipPath = `polygon(${L.clip})`;
  const svg = $('.outline', el); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('polygon', svg).setAttribute('points', L.pts.map((p) => `${(ox + p[0]).toFixed(1)},${(oy + p[1]).toFixed(1)}`).join(' '));
  const fh = $('.fh', el); if (fh) { px(fh, { left: ox + L.head.x, top: oy + L.head.y, width: L.head.w, height: L.head.h }); fh.classList.toggle('apex', !!L.head.apex); fh.classList.toggle('narrow', L.head.w < 210); fh.classList.toggle('tight', L.head.w < 170 || !!L.head.mini); }
  ['.fb', '.fl'].forEach((sel) => { const n = $(sel, el); if (n) px(n, { left: ox + L.rect.x, top: oy + L.rect.y, width: L.rect.w, height: L.rect.h }); });
  el.classList.toggle('small', L.R < 120);
  el.classList.toggle('mini', !!L.head.mini);
  const lift = isFocus ? 26 * f : 0; el._lift = lift;
  const t = state.flat ? netTransform(face, s, lift) : solidTransform(face, s, lift, false, el._seat || 0);
  el.classList.toggle('focus', !!isFocus);
  if (isNew) {
    el.style.transform = solidTransform(face, s, 0, true, 0); el.style.opacity = '0';
    void el.offsetWidth;
    requestAnimationFrame(() => { el.style.transform = t; });
  } else el.style.transform = t;
  el._t = t;
}
function removePanel(key) {
  const el = panels[key]; if (!el) return;
  delete panels[key];
  el.classList.add('gone');
  if (el._face) el.style.transform = solidTransform(el._face, curScale(), 0, true, el._seat || 0);
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 720 * DUR + 20);
}
function layoutAll(immediate) {
  const solid = buildSolid(state.solid), s0 = unitScale(solid);
  geo = { solid, s: s0, net: null, edgeFaces: solid.edges.map(([a, b]) => solid.faces.filter((f) => f.verts.includes(a) && f.verts.includes(b)).map((f) => f.i)) };
  if (state.flat) { geo.net = unfold(solid, netRoot()); state.flatScale = netFit(); }
  const s = curScale();
  if (immediate) polyEl.classList.add('notrans');
  const keep = {};
  solid.faces.forEach((face, i) => {
    const axisId = state.slots[i] || null, key = axisId || 'blank-' + i;
    let el = panels[key]; const isNew = !el;
    if (!el) { el = createPanel(axisId, i); panels[key] = el; polyEl.appendChild(el); }
    el._face = face; el._axis = axisId; el.setAttribute('data-slot', i);
    if (axisId) renderFaceContent(el, axisId);
    applyLayout(el, face, s, isNew && !immediate);
    keep[key] = 1;
  });
  Object.keys(panels).forEach((k) => { if (!keep[k]) removePanel(k); });
  if (immediate) { void polyEl.offsetWidth; requestAnimationFrame(() => polyEl.classList.remove('notrans')); }
  applySelection(false); applyQuery();
  requestFrame();
}
function netRoot() { const fm = state.frontmost || state.slots[0]; const el = fm && panels[fm]; return el && el._face ? el._face.i : 0; }
function netFit() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight, bb = geo.net.bbox;
  return clamp(Math.min((w - 60) / (bb.w * geo.s), (h - 104) / (bb.h * geo.s)), 0.22, 1);
}
function faceOf(axisId) { const el = panels[axisId]; return el && el._face ? el._face : null; }

/* ==========================================================================
   Axes → solid
   ========================================================================== */
function applySolid(silent) {
  const n = state.active.length, name = solidFor(n), solid = buildSolid(name), changed = name !== state.solid || state.slots.length !== solid.faces.length;
  let slots;
  if (!changed) {
    slots = state.slots.map((a) => (a && state.active.includes(a) ? a : null));
    state.active.forEach((a) => { if (!slots.includes(a)) slots[slots.indexOf(null)] = a; });
  } else {
    const prev = {}; state.slots.forEach((a, i) => { if (a) prev[a] = i; });
    const order = state.active.slice().sort((a, b) => (prev[a] ?? 100 + ORDER.indexOf(a)) - (prev[b] ?? 100 + ORDER.indexOf(b)));
    slots = new Array(solid.faces.length).fill(null);
    order.forEach((a, i) => { slots[i] = a; });
  }
  const prevFront = state.frontmost;
  state.solid = name; state.slots = slots;
  if (state.focused && !state.active.includes(state.focused)) state.focused = null;
  layoutAll(false);
  const keepFront = prevFront && state.active.includes(prevFront) ? prevFront : state.active[0];
  if (state.focused) rollTo(state.focused, { hero: false, silent: true });
  else if (!state.flat && keepFront) rollTo(keepFront, { hero: true, silent: true });
  else if (state.flat) flatten(true, { relayout: true });
  renderRail(); renderChips(); renderStatus(); renderInspector();
  if (!silent) emit('axes', { active: state.active.slice(), solid: name, faces: solid.faces.length, spare: solid.faces.length - n });
}
function setAxes(ids, opts) {
  opts = opts || {};
  const next = canon(ids);
  if (!next.length) { toast('Keep at least one axis on the solid.'); return false; }
  state.active = next;
  applySolid(opts.silent);
  return true;
}
function toggleAxis(id, force) {
  if (!axesById[id]) return false;
  const isOn = state.active.includes(id), want = typeof force === 'boolean' ? force : !isOn;
  if (want === isOn) return true;
  if (!want && state.active.length === 1) { toast('Keep at least one axis on the solid.'); return false; }
  const before = state.solid;
  const ok = setAxes(want ? state.active.concat(id) : state.active.filter((a) => a !== id));
  if (ok) {
    const ax = axesById[id], solid = buildSolid(state.solid);
    toast(`<b>${esc(ax.label)}</b> ${want ? 'unfolded onto a face' : 'folded away'}${before !== state.solid ? ` · the solid is now a <b>${solid.label.toLowerCase()}</b>` : ''} · ${state.active.length} of ${axes.length} axes`);
    if (want) rollTo(id, { hero: true });
  }
  return ok;
}
function preset(name) {
  const p = PRESETS[name]; if (!p) return;
  if (state.focused) unfocus({ silent: true });
  setAxes(p.axes);
  emit('preset', { name, axes: p.axes.slice(), solid: state.solid });
  toast(`<b>${esc(p.label)}</b>: ${p.axes.length} axes on a ${buildSolid(state.solid).label.toLowerCase()}`);
}
function currentPreset() { const key = state.active.join(','); return Object.keys(PRESETS).find((k) => canon(PRESETS[k].axes).join(',') === key) || null; }

/* ==========================================================================
   View: rotation, animation, per-frame face culling
   ========================================================================== */
let anim = null, raf = 0, inertia = null, reseatTimer = 0;
function requestFrame() { if (!raf) raf = requestAnimationFrame(tick); }
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function animateTo(to, ms, done) {
  if (reduced || ms === 0) { Object.assign(state.view, to); anim = null; applyView(); updateFaces(); if (done) done(); return; }
  anim = { from: { q: state.view.q.slice(), zoom: state.view.zoom, tx: state.view.tx, ty: state.view.ty }, to: Object.assign({ q: state.view.q, zoom: state.view.zoom, tx: state.view.tx, ty: state.view.ty }, to), t0: performance.now(), ms, done };
  requestFrame();
}
function applyView() {
  const v = state.view;
  polyEl.style.transform = `translate3d(${v.tx.toFixed(1)}px,${v.ty.toFixed(1)}px,0) scale(${v.zoom.toFixed(4)}) ${Q.css(v.q)}`;
}
function tick(now) {
  raf = 0;
  let busy = false;
  if (anim) {
    const t = clamp((now - anim.t0) / anim.ms, 0, 1), e = easeOut(t);
    state.view.q = Q.slerp(anim.from.q, anim.to.q, e);
    state.view.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
    state.view.tx = anim.from.tx + (anim.to.tx - anim.from.tx) * e;
    state.view.ty = anim.from.ty + (anim.to.ty - anim.from.ty) * e;
    if (t >= 1) { const d = anim.done; anim = null; if (d) d(); } else busy = true;
  }
  if (inertia) {
    inertia.frames++;
    if ((Math.abs(inertia.vx) < 0.08 && Math.abs(inertia.vy) < 0.08) || inertia.frames > 90) { inertia = null; settle(); }
    else { spin(inertia.vx, inertia.vy); inertia.vx *= 0.9; inertia.vy *= 0.9; busy = true; }
  }
  applyView(); updateFaces(); drawWire();
  if (busy) requestFrame();
}
function spin(dxDeg, dyDeg) {
  state.view.q = Q.norm(Q.mul(Q.mul(Q.axis([0, 1, 0], dxDeg), Q.axis([1, 0, 0], -dyDeg)), state.view.q));
}
function faceZ() { const out = {}; state.active.forEach((a) => { const f = faceOf(a); if (f) out[a] = state.flat ? 1 : Q.rot(state.view.q, f.n)[2]; }); return out; }
function frontmost() {
  let best = null, bz = -2;
  state.active.forEach((a) => { const f = faceOf(a); if (!f) return; const z = Q.rot(state.view.q, f.n)[2]; if (z > bz) { bz = z; best = a; } });
  return best;
}
let lastModes = {};
function updateFaces() {
  const q = state.view.q, focused = state.focused, flat = state.flat;
  let front = null, fz = -2;
  Object.keys(panels).forEach((key) => {
    const el = panels[key], face = el._face; if (!face) return;
    const z = flat ? 1 : Q.rot(q, face.n)[2];
    const blank = !el._axis;
    if (!blank && z > fz) { fz = z; front = el._axis; }
    // rows are readable when the face points at you AND its down-direction is not foreshortened (a cube's top face at the hero angle fails the second test, like Facet's tiles)
    let readable = false;
    if (!blank && !flat && z > 0.5) {
      const b = seatedBasis(face, el._seat || 0), d = Q.rot(q, b.d);
      const tilt = Math.abs(Math.atan2(d[0], d[1]));
      readable = Math.hypot(d[0], d[1]) > 0.74 && tilt < 0.72;
    }
    let mode = blank ? 'blank' : focused === el._axis ? 'full' : flat ? 'label' : readable ? 'full' : z > 0.1 ? 'label' : 'back';
    let op = flat ? 1 : clamp((z - 0.02) / 0.26, 0, 1);
    if (blank) op *= 0.75;
    if (focused && focused !== el._axis) op *= flat ? 0.45 : 0.22;
    if (el.classList.contains('gone')) return;
    const sh = flat ? 0 : clamp((1 - z) * 0.3, 0, 0.32);
    if (lastModes[key] !== mode) { el.setAttribute('data-mode', mode); lastModes[key] = mode; }
    const ops = op.toFixed(2); if (el.style.opacity !== ops) el.style.opacity = ops;
    const shs = sh.toFixed(3); if (el._sh !== shs) { el._sh = shs; el.style.setProperty('--sh', shs); }
    el.style.pointerEvents = op < 0.15 ? 'none' : '';
  });
  if (front !== state.frontmost) {
    state.frontmost = front;
    Object.keys(panels).forEach((k) => panels[k].classList.toggle('front-most', panels[k]._axis === front && !!front));
    $$('#chips-active .chip').forEach((c) => c.classList.toggle('on', c.getAttribute('data-axis') === front));
    $$('#axes-rail .axt').forEach((c) => c.classList.toggle('front-most', c.getAttribute('data-axis') === front));
    renderStatus();
    if (state.tab === 'solid' || state.selected) refreshInspectorStates();
    emit('frontmost', { axis: front });
  }
}
function rollTo(axisId, opts) {
  opts = opts || {};
  const face = faceOf(axisId); if (!face) return false;
  if (state.flat && !opts.keepFlat) { flatten(false, { silent: true, then: axisId }); return true; }
  inertia = null;
  const qFace = Q.fromBasis(face.u, face.d, face.n);
  const target = opts.hero === false ? qFace : Q.mul(heroQ(), qFace);
  let ty = -18;
  if (opts.hero === false && state.focused === axisId) {
    // centre the focused polygon's bounding box (its centroid sits low in an apex-up polygon), leaving room for the tools bar
    const el = panels[axisId], L = el && el._layout;
    if (L) ty = -L.midY * perspAt(26 * (el._f || 1)) - 26;
  }
  animateTo({ q: target, zoom: 1, tx: 0, ty }, (opts.ms ?? 640) * DUR, () => { reseat(); if (state.selected) scrollSelectedIntoView(); });
  if (!opts.silent) emit('roll', { axis: axisId, source: opts.source || 'api' });
  return true;
}
function settle() {
  // roll about the screen axis so the front-most face reads upright, then report the roll
  const a = frontmost(); const f = a && faceOf(a);
  if (f) {
    const d = Q.rot(state.view.q, f.d), ang = Math.atan2(d[0], d[1]) * 180 / Math.PI;
    if (Math.abs(ang) > 3 && Math.abs(ang) < 150) animateTo({ q: Q.norm(Q.mul(Q.axis([0, 0, 1], ang), state.view.q)) }, 420 * DUR, reseat);
    else reseat();
  }
  emit('roll', { axis: a, source: 'drag', settled: true });
}
function reset() {
  if (state.flat) { flatten(false, { silent: true }); }
  if (state.focused) unfocus({ silent: true });
  rollTo(state.active[0], { hero: true, source: 'reset' });
  emit('reset', {});
}

/* ---- focus ---- */
function focus(axisId, opts) {
  opts = opts || {};
  if (!axisId || !state.active.includes(axisId)) return false;
  if (state.focused === axisId) return true;
  state.focused = axisId;
  polyEl.classList.add('focused');
  Object.keys(panels).forEach((k) => { const el = panels[k]; if (el._face) applyLayout(el, el._face, curScale(), false); });
  if (!state.flat) rollTo(axisId, { hero: false, silent: true });
  renderStatus(); refreshInspectorStates(); updateTools();
  if (!opts.silent) emit('focus', { axis: axisId, source: opts.source || 'api' });
  setTimeout(scrollSelectedIntoView, 60);
  return true;
}
function unfocus(opts) {
  opts = opts || {};
  if (!state.focused) return;
  const was = state.focused; state.focused = null;
  polyEl.classList.remove('focused');
  Object.keys(panels).forEach((k) => { const el = panels[k]; if (el._face) applyLayout(el, el._face, curScale(), false); });
  if (!state.flat) rollTo(was, { hero: true, silent: true });
  renderStatus(); refreshInspectorStates(); updateTools();
  if (!opts.silent) emit('unfocus', { axis: was });
}

/* ---- flatten to a net ---- */
function flatten(onOff, opts) {
  opts = opts || {};
  const want = typeof onOff === 'boolean' ? onOff : !state.flat;
  if (want) {
    const wasFlat = state.flat;
    state.flat = true;
    geo.net = unfold(geo.solid, netRoot());
    Object.keys(panels).forEach((k) => { panels[k]._seat = 0; });
    const fs = netFit(), bb = geo.net.bbox, s = geo.s * fs;
    state.flatScale = fs;
    Object.keys(panels).forEach((k) => { const el = panels[k]; if (el._face) applyLayout(el, el._face, s, false); });
    stageEl.classList.add('flat');
    animateTo({ q: Q.id(), zoom: 1, tx: -bb.cx * s, ty: -bb.cy * s - 12 }, (opts.relayout && wasFlat ? 0 : 680) * DUR);
    if (!opts.silent && !opts.relayout) emit('flat', { on: true, solid: state.solid, scale: fs });
  } else {
    if (!state.flat) return;
    state.flat = false; state.flatScale = 1;
    stageEl.classList.remove('flat');
    Object.keys(panels).forEach((k) => { const el = panels[k]; if (el._face) applyLayout(el, el._face, geo.s, false); });
    const target = opts.then || state.focused || state.frontmost || state.active[0];
    rollTo(target, { hero: !state.focused, silent: true, ms: 680 });
    if (!opts.silent) emit('flat', { on: false });
  }
  updateTools(); renderStatus();
}
function updateTools() {
  const fb = $('#flat-btn'); fb.setAttribute('aria-pressed', String(state.flat));
  const fo = $('#focus-btn'); fo.setAttribute('aria-pressed', String(!!state.focused)); fo.title = state.focused ? 'Unfocus (Esc)' : 'Focus the front-most face (Enter)';
}

/* ==========================================================================
   Drag to roll (pointer events, inertia, settle upright)
   ========================================================================== */
let drag = null, suppressClickUntil = 0;
stageEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.poly-tools, .menu, .toast, .callout, button, .fx')) return;
  if (state.flat) return;
  inertia = null; anim = null;
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, id: e.pointerId };
});
stageEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  if (!drag.moved) { drag.moved = true; stageEl.classList.add('grabbing'); try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
  const now = performance.now(), dt = Math.max(1, now - drag.t);
  drag.vx = 0.7 * drag.vx + 0.3 * (dx / dt); drag.vy = 0.7 * drag.vy + 0.3 * (dy / dt);
  drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
  spin(dx * 0.32, dy * 0.32);
  requestFrame();
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag; drag = null; stageEl.classList.remove('grabbing');
  if (!d.moved) return;
  suppressClickUntil = performance.now() + 250;
  emit('drag', { dx: d.x - d.sx, dy: d.y - d.sy });
  inertia = { vx: reduced ? 0 : d.vx * 0.32 * 16, vy: reduced ? 0 : d.vy * 0.32 * 16, frames: 0 };
  requestFrame();
}
stageEl.addEventListener('pointerup', endDrag); stageEl.addEventListener('pointercancel', endDrag);
stageEl.addEventListener('click', (e) => { if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

/* ---- clicks inside faces ---- */
stageEl.addEventListener('click', (e) => {
  const row = e.target.closest('.row[data-id]');
  if (row) { select(row.getAttribute('data-id'), { source: 'face' }); return; }
  if (e.target.closest('.fx')) { unfocus({ source: 'face' }); return; }
  const face = e.target.closest('.face');
  if (!face) return;
  if (face.classList.contains('blank')) { if (e.target.closest('[data-add]') || face.getAttribute('data-mode') === 'blank') openAddMenu(e.target.closest('[data-add]') || face); return; }
  const inHeader = e.target.closest('.fh'), inLabels = e.target.closest('.fl'), mode = face.getAttribute('data-mode');
  if (inHeader || inLabels || mode === 'label') {
    if (state.focused === face._axis) unfocus({ source: 'face' }); else focus(face._axis, { source: 'face' });
  }
});
stageEl.addEventListener('mouseover', (e) => {
  const g = e.target.closest('.gh, .lab'); if (!g) return;
  const face = g.closest('.face'); if (!face || !face._axis) return;
  const v = g.getAttribute('data-group') || null;
  const ids = state.files.filter((f) => (f.axes[face._axis] || null) === v).map((f) => f.id);
  lit(ids, face); emit('hover', { axis: face._axis, value: v, ids });
});
stageEl.addEventListener('mouseout', (e) => {
  if (e.target.closest('.gh, .lab') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.gh, .lab'))) { lit([], null); emit('hover', { axis: null, value: null, ids: [] }); }
});
function lit(ids, exceptEl) {
  $$('.lit', polyEl).forEach((n) => n.classList.remove('lit'));
  if (!ids.length) return;
  const set = {}; ids.forEach((i) => { set[i] = 1; });
  Object.keys(panels).forEach((k) => {
    const el = panels[k]; if (el === exceptEl || !el._axis) return;
    $$('.row[data-id]', el).forEach((n) => { if (set[n.getAttribute('data-id')]) n.classList.add('lit'); });
    const values = {}; ids.forEach((id) => { const f = filesById[id]; if (f) values[f.axes[el._axis] || ''] = 1; });
    $$('.lab', el).forEach((n) => { if (values[n.getAttribute('data-group')]) n.classList.add('lit'); });
  });
}

/* ==========================================================================
   Selection, search
   ========================================================================== */
function select(id, opts) {
  opts = opts || {};
  state.selected = id && filesById[id] ? id : null;
  if (state.selected) state.tab = 'file';
  applySelection(true);
  renderInspector(); renderStatus();
  emit('select', { id: state.selected, file: state.selected ? filesById[state.selected] : null, source: opts.source || 'api' });
}
function applySelection(scroll) {
  $$('.sel', polyEl).forEach((n) => n.classList.remove('sel'));
  if (!state.selected) return;
  const f = filesById[state.selected];
  Object.keys(panels).forEach((k) => {
    const el = panels[k]; if (!el._axis) return;
    $$(`.row[data-id="${state.selected}"]`, el).forEach((n) => n.classList.add('sel'));
    const v = f.axes[el._axis] || '';
    $$('.lab', el).forEach((n) => { if (n.getAttribute('data-group') === v) n.classList.add('sel'); });
  });
  if (scroll) scrollSelectedIntoView();
}
function scrollSelectedIntoView() {
  if (!state.selected) return;
  Object.keys(panels).forEach((k) => {
    const el = panels[k], fb = $('.fb', el), row = fb && $(`.row[data-id="${state.selected}"]`, fb);
    if (!row) return;
    const target = row.offsetTop - fb.clientHeight / 2 + row.offsetHeight / 2;
    if (Math.abs(fb.scrollTop - target) > 8) fb.scrollTo({ top: Math.max(0, target), behavior: reduced ? 'auto' : 'smooth' });
  });
}
function applyQuery() {
  const q = state.query.toLowerCase();
  let hits = 0;
  const match = {}; state.files.forEach((f) => { const m = !q || f.name.toLowerCase().includes(q) || Object.values(f.axes).some((v) => String(v).toLowerCase().includes(q)); match[f.id] = m; if (m) hits++; });
  $$('.row[data-id]', polyEl).forEach((n) => n.classList.toggle('dim', !match[n.getAttribute('data-id')]));
  Object.keys(panels).forEach((k) => {
    const el = panels[k]; if (!el._axis) return;
    $$('.lab', el).forEach((n) => { const v = n.getAttribute('data-group'); const any = !q || state.files.some((f) => match[f.id] && (f.axes[el._axis] || '') === v); n.classList.toggle('dim', !any); });
  });
  state.hits = q ? hits : null;
}
$('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); applyQuery(); renderStatus(); emit('search', { query: state.query }); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; state.query = ''; applyQuery(); renderStatus(); e.target.blur(); } });

/* ==========================================================================
   Sidebar rail, chips, tools, menus
   ========================================================================== */
function groupCount(axisId) { return groupBy(state.files, axisId).filter((g) => g.files.length).length; }
function renderRail() {
  const cur = currentPreset();
  $('#presets').innerHTML = Object.keys(PRESETS).map((k) => { const p = PRESETS[k]; return `<button class="pre" type="button" data-preset="${k}" aria-pressed="${cur === k}" title="${esc(p.title)}">${esc(p.label)}<span class="n">${p.n}</span></button>`; }).join('');
  $('#axes-rail').innerHTML = axes.map((ax) => {
    const onIt = state.active.includes(ax.id);
    return `<button type="button" class="axt${ax.id === state.frontmost ? ' front-most' : ''}" data-axis="${ax.id}" role="switch" aria-pressed="${onIt}" aria-checked="${onIt}" style="--c:${ax.color}" title="${onIt ? 'Fold ' + esc(ax.label) + ' away' : 'Unfold ' + esc(ax.label) + ' onto a face'} · ${groupCount(ax.id)} groups"><span class="dot"></span><span class="lbl">${esc(ax.label)}</span><span class="cnt">${groupCount(ax.id)}</span><span class="sw" aria-hidden="true"></span></button>`;
  }).join('');
  $('#axes-count').textContent = `${state.active.length} of ${axes.length}`;
}
$('#presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) preset(b.getAttribute('data-preset')); });
$('#axes-rail').addEventListener('click', (e) => { const b = e.target.closest('[data-axis]'); if (b) toggleAxis(b.getAttribute('data-axis')); });

function renderChips() {
  const solid = buildSolid(state.solid), spare = solid.faces.length - state.active.length;
  $('#solid-chip').innerHTML = `<svg class="ic"><use href="#i-poly"/></svg>${solid.label}<small>${solid.faces.length} faces${spare ? ` · ${spare} spare` : ''}</small>`;
  $('#chips-active').innerHTML = state.active.map((id, i) => { const ax = axesById[id]; return `<button class="chip${id === state.frontmost ? ' on' : ''}" type="button" data-axis="${id}" style="--c:${ax.color}" title="Roll ${esc(ax.label)} to the front${i < 9 ? ' (' + (i + 1) + ')' : ''}"><span class="dot"></span>${esc(ax.label)}${i < 9 ? `<small>${i + 1}</small>` : ''}</button>`; }).join('');
}
$('#chips-active').addEventListener('click', (e) => { const c = e.target.closest('[data-axis]'); if (c) rollTo(c.getAttribute('data-axis'), { hero: true, source: 'chip' }); });

/* menus (shared .menu popover) */
const menuEl = $('#menu');
function openMenu(anchor, html, onPick) {
  menuEl.innerHTML = html; menuEl.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  let left = clamp(r.left + r.width / 2 - mw / 2, 8, innerWidth - mw - 8), top = r.top - mh - 8;
  if (top < 8) top = clamp(r.bottom + 8, 8, innerHeight - mh - 8);
  menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
  menuEl._pick = onPick;
  const first = $('button:not([disabled])', menuEl); if (first) first.focus({ preventScroll: true });
}
function closeMenu() { menuEl.hidden = true; menuEl.innerHTML = ''; menuEl._pick = null; $('#roll-btn').setAttribute('aria-expanded', 'false'); }
menuEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (!b) return; const act = b.getAttribute('data-act'); closeMenu(); if (menuEl._lastPick) menuEl._lastPick(act); });
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !e.target.closest('#menu, #roll-btn')) closeMenu(); });
function openRollMenu() {
  const html = '<div class="mh">Roll to</div>' + state.active.map((id, i) => { const ax = axesById[id]; return `<button type="button" data-act="roll:${id}" style="--c:${ax.color}"><span class="dot"></span>${esc(ax.label)}${id === state.frontmost ? '<small>front</small>' : ''}${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`; }).join('') +
    `<hr><button type="button" data-act="focus"><svg class="ic"><use href="#i-search"/></svg>${state.focused ? 'Unfocus' : 'Focus the front face'}<kbd>${state.focused ? 'Esc' : '⏎'}</kbd></button><button type="button" data-act="flat"><svg class="ic"><use href="#i-flat"/></svg>${state.flat ? 'Fold the net back up' : 'Flatten to a net'}<kbd>F</kbd></button><button type="button" data-act="reset"><svg class="ic"><use href="#i-reset"/></svg>Reset the view<kbd>0</kbd></button>`;
  menuEl._lastPick = (act) => {
    if (act.startsWith('roll:')) rollTo(act.slice(5), { hero: true, source: 'menu' });
    else if (act === 'focus') { if (state.focused) unfocus(); else focus(frontmost(), { source: 'menu' }); }
    else if (act === 'flat') flatten();
    else if (act === 'reset') reset();
  };
  openMenu($('#roll-btn'), html);
  $('#roll-btn').setAttribute('aria-expanded', 'true');
}
function openAddMenu(anchor) {
  const offAxes = axes.filter((a) => !state.active.includes(a.id));
  const html = '<div class="mh">Put an axis on this face</div>' + (offAxes.length ? offAxes.map((ax) => `<button type="button" data-act="add:${ax.id}" style="--c:${ax.color}"><span class="dot"></span>${esc(ax.label)}<small>${groupCount(ax.id)} groups</small></button>`).join('') : '<button type="button" disabled>Every axis is already on the solid</button>');
  menuEl._lastPick = (act) => { if (act.startsWith('add:')) toggleAxis(act.slice(4), true); };
  openMenu(anchor, html);
}
$('#roll-btn').addEventListener('click', () => { if (menuEl.hidden) openRollMenu(); else closeMenu(); });
$('#focus-btn').addEventListener('click', () => { if (state.focused) unfocus({ source: 'tools' }); else focus(frontmost(), { source: 'tools' }); });
$('#flat-btn').addEventListener('click', () => flatten());
$('#reset-btn').addEventListener('click', reset);

/* ==========================================================================
   Inspector: File tab (where it sits) and Solid tab (wireframe)
   ========================================================================== */
const inspEl = $('#inspector');
function avatar(p) { const pe = people[p]; return pe ? `<span class="av" style="--c:${pe.color}">${pe.initials}</span>` : ''; }
function stateOf(axisId) {
  if (!state.active.includes(axisId)) return { cls: 'off', text: 'folded' };
  if (axisId === state.focused) return { cls: 'front', text: 'focused' };
  if (axisId === state.frontmost) return { cls: 'front', text: 'front' };
  const z = faceZ()[axisId] ?? -1;
  return z > 0.1 ? { cls: 'on', text: 'visible' } : { cls: '', text: 'turned away' };
}
function tabsHTML() {
  return `<div class="itabs" role="tablist" aria-label="Inspector"><button role="tab" type="button" data-tab="file" aria-selected="${state.tab === 'file'}"><svg class="ic"><use href="#i-folder"/></svg>File</button><button role="tab" type="button" data-tab="solid" aria-selected="${state.tab === 'solid'}"><svg class="ic"><use href="#i-poly"/></svg>Solid</button></div>`;
}
function renderInspector() {
  let body;
  if (state.tab === 'solid') body = solidTabHTML();
  else {
    const f = state.selected ? filesById[state.selected] : null;
    if (!f) body = `<div class="ih"><svg class="ic"><use href="#i-folder"/></svg>File</div><div class="none"><svg class="ic big"><use href="#i-poly"/></svg><div><b>Select a file on any face</b>Every file has a value on all ${axes.length} axes, so it appears on every face of the solid. Pick one to see where it sits.</div><div class="tags">${state.active.map((id) => `<span class="pill c" style="--c:${axesById[id].color}">${esc(axesById[id].label)}</span>`).join('')}</div></div>`;
    else {
      const kind = kinds[f.kind];
      const rows = axes.map((ax) => { const st = stateOf(ax.id), offIt = !state.active.includes(ax.id); return `<button class="wr" type="button" data-axis="${ax.id}" data-off="${offIt ? 1 : 0}" style="--c:${ax.color}" title="${offIt ? 'Unfold ' + esc(ax.label) + ' and roll to it' : 'Roll ' + esc(ax.label) + ' to the front'}"><span class="dot"></span><span class="ax">${esc(ax.label)}</span><b>${esc(f.axes[ax.id] || ax.none)}</b><span class="st ${st.cls}">${st.text}</span></button>`; }).join('');
      body = `<div class="ih"><svg class="ic"><use href="#i-folder"/></svg>File<button class="ib" type="button" data-close title="Clear selection (Esc)" aria-label="Clear selection"><svg class="ic"><use href="#i-x"/></svg></button></div>
        <div class="prev th ${kind.th}"></div><h3>${esc(f.name)}<span class="pill ac">on ${state.active.length} face${state.active.length === 1 ? '' : 's'}</span></h3>
        <div class="meta"><span>Kind</span><b>${esc(kind.label)} · ${esc(f.size)}</b><span>Owner</span><b>${avatar(f.owner)}${esc(people[f.owner].name)}</b><span>Modified</span><b>${esc(f.modified)}</b><span>Folder</span><b>${esc(f.path.split('/').join(' › '))}</b></div>
        <div class="sec-h">Where it sits<span class="cnt">· ${axes.length} axes · ${state.active.length} on the solid</span></div><div class="wl" id="where">${rows}</div>`;
    }
  }
  inspEl.innerHTML = tabsHTML() + `<div class="body">${body}</div>`;
  if (state.tab === 'solid') drawWire(true);
}
function solidTabHTML() {
  const solid = buildSolid(state.solid), n = state.active.length, spare = solid.faces.length - n;
  const zs = faceZ();
  const list = state.active.slice().sort((a, b) => (zs[b] ?? -1) - (zs[a] ?? -1)).map((id) => { const ax = axesById[id], st = stateOf(id); return `<button class="wr" type="button" data-axis="${id}" style="--c:${ax.color}" title="Roll ${esc(ax.label)} to the front"><span class="dot"></span><span class="ax">${esc(ax.label)}</span><span class="z">${(zs[id] ?? 0).toFixed(2)}</span><span class="st ${st.cls}">${st.text}</span></button>`; }).join('');
  const ladder = [['1–3', 'cube'], ['4', 'tetrahedron'], ['5–6', 'cube'], ['7–8', 'octahedron'], ['9–12', 'dodecahedron']].map(([r, s]) => { const cur = (r === '1–3' && n <= 3) || (r === '4' && n === 4) || (r === '5–6' && n >= 5 && n <= 6) || (r === '7–8' && n >= 7 && n <= 8) || (r === '9–12' && n >= 9); return `<span class="${cur ? 'cur' : ''}">${r}</span><span class="${cur ? 'cur' : ''}">${s}</span>`; }).join('');
  return `<div class="ih"><svg class="ic"><use href="#i-poly"/></svg>Solid</div>
    <svg class="wire" id="wire" viewBox="0 0 260 200" aria-label="Wireframe of the ${solid.label.toLowerCase()}, turning with the solid"></svg>
    <h3 id="solid-name">${solid.label}<span class="pill ac">${solid.faces.length} faces</span></h3>
    <div class="meta"><span>Axes</span><b>${n} of ${axes.length} on faces</b><span>Spare</span><b>${spare ? spare + ' blank face' + (spare === 1 ? '' : 's') : 'none'}</b><span>Edges</span><b>${solid.edges.length} · ${solid.sides === 3 ? 'triangles' : solid.sides === 4 ? 'squares' : 'pentagons'}</b><span>View</span><b>${state.flat ? 'Unfolded net' : state.focused ? 'Focused on ' + esc(axesById[state.focused].label) : 'Rolling'}</b></div>
    <div class="sec-h">Faces<span class="cnt">· sorted by how much they face you</span></div><div class="facelist" id="facelist">${list}</div>
    <div class="rule"><b>The rule.</b> Faces are always a Platonic solid: the smallest one with at least as many faces as active axes, except that up to three axes keep the cube so the first view is Facet’s. Spare faces stay blank.<div class="ladder">${ladder}</div></div>`;
}
function refreshInspectorStates() {
  if (state.tab === 'solid') { const fl = $('#facelist'); if (fl) { const zs = faceZ(); const list = state.active.slice().sort((a, b) => (zs[b] ?? -1) - (zs[a] ?? -1)); fl.innerHTML = list.map((id) => { const ax = axesById[id], st = stateOf(id); return `<button class="wr" type="button" data-axis="${id}" style="--c:${ax.color}"><span class="dot"></span><span class="ax">${esc(ax.label)}</span><span class="z">${(zs[id] ?? 0).toFixed(2)}</span><span class="st ${st.cls}">${st.text}</span></button>`; }).join(''); } }
  else $$('#where .wr').forEach((b) => { const id = b.getAttribute('data-axis'), st = stateOf(id), n = $('.st', b); n.className = 'st ' + st.cls; n.textContent = st.text; b.setAttribute('data-off', state.active.includes(id) ? 0 : 1); });
}
inspEl.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]'); if (tab) { state.tab = tab.getAttribute('data-tab'); renderInspector(); return; }
  if (e.target.closest('[data-close]')) { select(null); return; }
  const wr = e.target.closest('.wr[data-axis]');
  if (wr) { const id = wr.getAttribute('data-axis'); if (!state.active.includes(id)) toggleAxis(id, true); else rollTo(id, { hero: true, source: 'inspector' }); }
});
let wireDirty = true;
function drawWire(force) {
  const svg = $('#wire'); if (!svg) return;
  const solid = geo.solid, q = state.view.q, k = 78 / solid.circum, cx = 130, cy = 100;
  const P = solid.verts.map((v) => { const r = Q.rot(q, v); return [cx + r[0] * k, cy + r[1] * k, r[2]]; });
  const fz = solid.faces.map((f) => Q.rot(q, f.n)[2]);
  let out = '';
  solid.faces.forEach((f, i) => {
    if (fz[i] <= 0) return;
    const axisId = state.slots[i], col = axisId ? axesById[axisId].color : 'var(--dim)';
    out += `<polygon points="${f.verts.map((vi) => P[vi][0].toFixed(1) + ',' + P[vi][1].toFixed(1)).join(' ')}" fill="${col}" fill-opacity="${(axisId ? 0.12 + 0.3 * fz[i] : 0.05).toFixed(2)}"/>`;
  });
  solid.edges.forEach(([a, b], i) => { const front = geo.edgeFaces[i].some((fi) => fz[fi] > 0); out += `<line class="${front ? '' : 'back'}" x1="${P[a][0].toFixed(1)}" y1="${P[a][1].toFixed(1)}" x2="${P[b][0].toFixed(1)}" y2="${P[b][1].toFixed(1)}"/>`; });
  solid.faces.forEach((f, i) => {
    const axisId = state.slots[i]; if (!axisId || fz[i] < 0.45) return;
    const c = Q.rot(q, f.c); out += `<text x="${(cx + c[0] * k).toFixed(1)}" y="${(cy + c[1] * k + 3).toFixed(1)}" fill-opacity="${fz[i].toFixed(2)}">${esc(axesById[axisId].label)}</text>`;
  });
  svg.innerHTML = out;
}

/* ==========================================================================
   Toast, status, theme, keys
   ========================================================================== */
let toastTimer = 0;
function toast(html) { const t = $('#toast'); t.innerHTML = `<span class="msg">${html}</span>`; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }
function renderStatus() {
  const solid = buildSolid(state.solid), sel = state.selected ? filesById[state.selected] : null;
  const fm = state.frontmost ? axesById[state.frontmost].label : '';
  $('#sbar').innerHTML = `<b>${state.hits != null ? `${state.hits} of ${state.files.length} files match` : state.files.length + ' files'}</b><span class="sep">·</span><span class="solid" id="sbar-solid">${solid.label}</span><span class="sep">·</span>${state.active.length} of ${axes.length} axes on faces${fm ? `<span class="sep">·</span>${state.focused ? 'Focused on ' : ''}${esc(fm)}${state.focused ? '' : ' in front'}` : ''}${state.flat ? '<span class="sep">·</span>Unfolded' : ''}${sel ? `<span class="sep">·</span>${esc(sel.name)} selected` : ''}<span class="r"><span class="keys"><span><span class="kbd">1–9</span>roll</span><span><span class="kbd">⏎</span>focus</span><span><span class="kbd">F</span>net</span><span><span class="kbd">0</span>reset</span><span><span class="kbd">?</span>tour</span></span><span class="sync"><i></i>Synced</span></span>`;
}
function setTheme(t) {
  state.theme = t === 'light' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', state.theme);
  const b = $('#theme-btn'); b.innerHTML = `<svg class="ic"><use href="#${state.theme === 'dark' ? 'i-sun' : 'i-moon'}"/></svg>`; b.title = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`; b.setAttribute('aria-label', b.title);
  try { localStorage.setItem('polyhedron.theme', state.theme); } catch (e) { /* ignore */ }
}
$('#theme-btn').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#sb-toggle').addEventListener('click', () => { $('#app').classList.toggle('sb-open'); setTimeout(() => layoutAll(true), 60); });
$$('.sb .nav a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
document.addEventListener('keydown', (e) => {
  const t = e.target, tag = t && t.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  if (e.key === 'Escape' && !typing) {
    if (!menuEl.hidden) { closeMenu(); return; }
    if (state.focused) { unfocus({ source: 'key' }); return; }
    if (state.flat) { flatten(false); return; }
    if (state.selected) { select(null); return; }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!menuEl.hidden && e.key !== '?') return;
  switch (e.key) {
    case '/': e.preventDefault(); $('#search').focus(); break;
    case '?': e.preventDefault(); tour.toggle(); break;
    case 'Enter': e.preventDefault(); if (state.focused) unfocus({ source: 'key' }); else focus(frontmost(), { source: 'key' }); break;
    case 'f': case 'F': e.preventDefault(); flatten(); break;
    case '0': e.preventDefault(); reset(); break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
      if (state.flat) return;
      e.preventDefault(); inertia = null; anim = null;
      spin(e.key === 'ArrowLeft' ? -12 : e.key === 'ArrowRight' ? 12 : 0, e.key === 'ArrowUp' ? -12 : e.key === 'ArrowDown' ? 12 : 0);
      requestFrame(); clearTimeout(reseatTimer); reseatTimer = setTimeout(reseat, 380); emit('roll', { axis: frontmost(), source: 'key' });
      break;
    default:
      if (/^[1-9]$/.test(e.key)) { const id = state.active[+e.key - 1]; if (id) { e.preventDefault(); rollTo(id, { hero: true, source: 'key' }); } }
  }
});

/* ---- resize ---- */
new ResizeObserver(() => { if (geo) { layoutAll(true); if (state.flat) flatten(true, { relayout: true }); } }).observe(stageEl);

/* ==========================================================================
   Tour
   ========================================================================== */
const tour = createTour({
  key: 'polyhedron', on, off, button: '#tour-btn',
  steps: [
    { title: 'Every axis gets a face', target: '#poly-stage', body: `Facet’s cube shows three axes because a cube has three visible faces. Polyhedron gives <b>every</b> axis its own face: the same ${files.length} files, and a solid that grows from a cube to a <b>dodecahedron</b> as you switch axes on. Faces turned toward you are readable; faces turning away fade to their labels.` },
    { title: 'Roll it', target: '#poly-stage', event: 'roll', task: 'Drag the solid, or use Roll to › Client', body: 'Drag to roll the solid; it keeps rolling a little and settles upright. <b>Roll to</b> in the bar below (or keys <kbd>1</kbd>–<kbd>9</kbd>) turns a chosen axis to the front along the shortest path.', check: (d) => d.source !== 'reset', doit: () => rollTo(state.active[1] || state.active[0], { hero: true, source: 'tour' }) },
    { title: 'Focus a face', target: '#poly-stage', event: 'focus', task: 'Click a face header, or press Enter', body: 'Click a face’s header to bring it square-on and enlarge it: the full list of files, grouped by that axis. The other faces recede. <kbd>Esc</kbd> or the × lets go.', doit: () => focus(frontmost(), { source: 'tour' }) },
    { title: 'Fold an axis away', target: '#axes-rail', event: 'axes', task: 'Switch Quarter off in the Axes rail', body: 'Every axis is a switch in the rail. Fold one away and its face collapses; the solid <b>re-forms</b> to fit what is left. With five axes on a cube, folding one leaves four: a <b>tetrahedron</b>.', before: () => { if (state.focused) unfocus({ silent: true }); if (state.flat) flatten(false, { silent: true }); if (state.active.length !== 5) { setAxes(PRESETS.core.axes, { silent: true }); toast('Switched to <b>Core 5</b> so there is something to fold'); } }, check: (d) => d.solid === 'tetrahedron', doit: () => toggleAxis(state.active.includes('quarter') ? 'quarter' : state.active[state.active.length - 1], false) },
    { title: 'Everything at once', target: '#presets', event: 'preset', task: 'Press the Everything preset', body: 'Presets set the whole rail at once. <b>Everything</b> puts all twelve axes on a dodecahedron; <b>Legal review</b> and <b>Who owns what</b> are the sets a team would actually save.', check: (d) => d.name === 'all', doit: () => preset('all') },
    { title: 'Flatten to a net', target: '#flat-btn', event: 'flat', task: 'Press Flatten, or key F', body: 'Not sure where a face went? <b>Flatten</b> unfolds the solid into its net, every face at once, laid out the way a paper model would be cut. Press again to fold it back up.', check: (d) => d.on, doit: () => flatten(true), after: () => { if (state.flat) flatten(false); } },
    { title: 'One file, twelve places', target: '#inspector', event: 'select', task: 'Click any file on a face', body: 'Every file has a value on every axis, so selecting one lights it up on <b>every</b> face, and the inspector lists where it sits on all twelve. Hover a group to see its files light up on the other faces.', check: (d) => !!d.id, doit: () => { if (!state.flat) rollTo(state.active[0], { hero: true, silent: true }); select('acme-sow-q3', { source: 'tour' }); } }
  ]
});

/* ==========================================================================
   Boot
   ========================================================================== */
let storedTheme = null; try { storedTheme = localStorage.getItem('polyhedron.theme'); } catch (e) { /* ignore */ }
setTheme(storedTheme || 'dark');
state.slots = [];
applySolid(true);
state.view.q = Q.mul(heroQ(), Q.fromBasis(faceOf(state.active[0]).u, faceOf(state.active[0]).d, faceOf(state.active[0]).n));
reseat(true);
anim = null; applyView(); updateFaces(); updateTools();
renderInspector(); renderStatus();
$('#nav-all-count').textContent = state.files.length;

window.Proto = {
  state, axes, files: state.files, PRESETS, tour, on, off, Q,
  setAxes, toggleAxis, preset, currentPreset, rollTo, focus, unfocus, flatten, select, reset,
  frontmost, faceZ, faceOf, solidName: () => state.solid, solidLabel: () => buildSolid(state.solid).label,
  geo: () => geo, panels, layout: () => layoutAll(true), toast,
  data, filesAt, QUARTERS, NOW, groupBy
};
