/* ==========================================================================
   prototype/shared/cube.js — the cube engine from prototype/facet/app.js as a
   reusable ES module. One call mounts one cube; a page can mount many.

     import { createCube } from '../shared/cube.js';
     const cube = createCube(document.getElementById('stage'), {
       files, axes, kinds,                         // from ../shared/data.js
       faces: { front: 'project', right: 'client', top: 'type' },
       controls: true, keys: true
     });
     cube.on('select', ({ id }) => …);

   Needs cube.css (+ chrome.css for tokens, .seg, .btn, .th.*) and the icon
   sprite (#i-reset) when controls are on.

   OPTIONS (all optional except files/axes/kinds)
     files        array of { id, name, kind, size, axes:{axisId:value} }
     axes         array of { id, label, color, values, none } (or an axesById map)
     kinds        { kind: { th, label } }
     faces        { front, right, top } axis ids           default project/client/type
     faceLabel    { front:'Front', right:'Right', top:'Top' }
     iso          { rx:-33, ry:-42 } resting orientation
     size         { min:320, max:600, w:.5, h:.53 } cube side = clamp(min, min(stageW*w, stageH*h), max)
     controls     true → floating Front/Right/Top/Reset toolbar inside the stage
     controlsExtra  HTML appended to the toolbar (e.g. a Flat button)
     keys         true → document keys 1 2 3 0 and arrows drive this cube
     hoverLights  true → hovering a group lights its files on the other faces
     connectors   true → dashed connector lines between the selection's positions
     acceptDrops  true → dropping text/plain=axisId on a face calls showAxis
     meta         true → rows show the file size on the right
     rowHTML(file) / groupHeaderHTML(group, axis) override the row / group header markup
     dblclickGroup  true → double-clicking a group header emits 'groupOpen'

   RETURNS
     el, wrap, conn, stage, faceEls:{front,right,top}, state:{rot, snap, faces, selected, files}
     on(event, fn) / off(event, fn)   events: rotate {rx,ry,snap} · snap {face} · drag {dx,dy}
                                      · select {id, source} · hover {axis, value, ids} ·
                                      axisSwap {axis, face, replaced} · groupOpen {axis, value, files}
                                      · layout {size}
     setFiles(files)                  swap the dataset and re-render every face
     setFaces({front,right,top})      set all three axes at once
     showAxis(axisId, face, {silent}) put an axis on a face (swaps if it was on another face)
     faceOf(axisId) → face|null       hiddenAxes() → axes not on the cube
     render()  renderFace(face)       update(axisId, movedId) re-renders the face showing that
                                      axis with a FLIP animation for the moved row
     groupsFor(axisId) → [{value, files}]
     snap('front'|'right'|'top'|'iso')  rotateBy(dRy, dRx, animate)  setRotation(rx, ry, animate, snapName)
     nearestClean()                    the clean orientation closest to the current one
     select(id|null, {source})         lit(ids, exceptFace)      scrollSelectedIntoView()
     layout()  markConn(ms)  drawConnectors()
     destroy()                         removes DOM, listeners and the RAF loop
   ========================================================================== */

var FACES = ['front', 'right', 'top'];
var PERSP = 2000;
var SNAPS = { front: { rx: 0, ry: 0 }, right: { rx: 0, ry: -90 }, top: { rx: -90, ry: 0 } };

export function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

export function createCube(stageEl, options) {
  var o = Object.assign({
    faces: { front: 'project', right: 'client', top: 'type' },
    faceLabel: { front: 'Front', right: 'Right', top: 'Top' },
    iso: { rx: -33, ry: -42 },
    size: { min: 320, max: 600, w: 0.5, h: 0.53 },
    controls: true, controlsExtra: '', keys: false, hoverLights: true, connectors: true, acceptDrops: true, meta: false, dblclickGroup: true
  }, options || {});
  if (!stageEl) throw new Error('createCube: stage element required');
  var axesById = Array.isArray(o.axes) ? {} : (o.axes || {});
  if (Array.isArray(o.axes)) o.axes.forEach(function (a) { axesById[a.id] = a; });
  var axesList = Object.keys(axesById).map(function (k) { return axesById[k]; });
  var kinds = o.kinds || {};
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || stageEl).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || stageEl).querySelectorAll(s)); };
  var ISO = o.iso;
  var CLEAN = [
    { n: 'iso', rx: ISO.rx, ry: ISO.ry }, { n: 'front', rx: 0, ry: 0 }, { n: 'right', rx: 0, ry: -90 }, { n: 'top', rx: -90, ry: 0 },
    { n: 'free', rx: -33, ry: -70 }, { n: 'free', rx: -33, ry: -15 }, { n: 'free', rx: -58, ry: -42 }, { n: 'free', rx: -58, ry: -70 },
    { n: 'free', rx: -58, ry: -15 }, { n: 'free', rx: 0, ry: -45 }, { n: 'free', rx: -45, ry: 0 }, { n: 'free', rx: -45, ry: -90 }, { n: 'free', rx: -90, ry: -45 }
  ];

  var state = { rot: { rx: ISO.rx, ry: ISO.ry }, snap: 'iso', faces: Object.assign({}, o.faces), selected: null, files: (o.files || []).slice() };
  var filesById = {};
  function indexFiles() { filesById = {}; state.files.forEach(function (f) { filesById[f.id] = f; }); }
  indexFiles();

  /* ---- events ---- */
  var listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return api; }
  function off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(function (f) { return f !== fn; }); return api; }
  function emit(ev, d) { (listeners[ev] || []).slice().forEach(function (fn) { try { fn(d, api); } catch (e) { console.error(e); } }); }

  /* ---- DOM ---- */
  stageEl.classList.add('cube-stage');
  var wrapEl = document.createElement('div'); wrapEl.className = 'cube-wrap';
  var cubeEl = document.createElement('div'); cubeEl.className = 'cube';
  var faceEls = {};
  FACES.forEach(function (face) {
    var s = document.createElement('section'); s.className = 'face ' + face; s.setAttribute('data-face', face); s.setAttribute('aria-label', o.faceLabel[face] + ' face');
    cubeEl.appendChild(s); faceEls[face] = s;
  });
  wrapEl.appendChild(cubeEl);
  var connEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); connEl.setAttribute('class', 'connectors'); connEl.setAttribute('aria-hidden', 'true');
  var toolsEl = null;
  if (o.controls) {
    toolsEl = document.createElement('div'); toolsEl.className = 'cube-tools'; toolsEl.setAttribute('role', 'toolbar'); toolsEl.setAttribute('aria-label', 'Cube controls');
    toolsEl.innerHTML = '<div class="seg snaps">' +
      '<button type="button" data-snap="front" title="Bring the front face square-on (1)">' + esc(o.faceLabel.front) + '<kbd>1</kbd></button>' +
      '<button type="button" data-snap="right" title="Bring the right face square-on (2)">' + esc(o.faceLabel.right) + '<kbd>2</kbd></button>' +
      '<button type="button" data-snap="top" title="Bring the top face square-on (3)">' + esc(o.faceLabel.top) + '<kbd>3</kbd></button>' +
      '<button type="button" data-snap="iso" title="Back to the three-face view (0)"><svg class="ic"><use href="#i-reset"/></svg>Reset<kbd>0</kbd></button></div>' + (o.controlsExtra || '');
    toolsEl.addEventListener('click', function (e) { var b = e.target.closest('[data-snap]'); if (b) snap(b.getAttribute('data-snap')); });
  }
  stageEl.prepend(wrapEl, connEl);
  if (toolsEl) stageEl.appendChild(toolsEl);

  /* ---- geometry ---- */
  var cubeSize = 500, connDirtyUntil = 0;
  function layout() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (!w || !h) return;
    cubeSize = Math.round(Math.max(o.size.min, Math.min(w * o.size.w, h * o.size.h, o.size.max)));
    cubeEl.style.setProperty('--s', cubeSize + 'px');
    applyRotation();
    emit('layout', { size: cubeSize });
  }
  function zoomFor(sn) {
    if (sn === 'front' || sn === 'right' || sn === 'top') {
      // the face sits at z = S·zoom/2, so perspective magnifies it by P/(P - z); solve for the zoom whose apparent size is A
      var w = stageEl.clientWidth, h = stageEl.clientHeight;
      var A = Math.min(w - 64, h - 118);
      var z = (A * PERSP) / (cubeSize * (PERSP + A / 2));
      return Math.max(0.9, Math.min(z, 1.6));
    }
    return 1;
  }
  function applyRotation() {
    var r = state.rot;
    cubeEl.style.setProperty('--rx', r.rx + 'deg');
    cubeEl.style.setProperty('--ry', r.ry + 'deg');
    cubeEl.style.setProperty('--zoom', zoomFor(state.snap).toFixed(3));
    cubeEl.style.setProperty('--cy', (state.snap === 'iso' || state.snap === 'free' ? -Math.round(cubeSize * 0.08) : -24) + 'px');
    cubeEl.setAttribute('data-topmode', r.rx <= -62 ? 'rows' : 'tiles');
    markConn(600);
  }
  function setRotation(rx, ry, animate, snapName) {
    state.rot.rx = Math.max(-90, Math.min(0, rx));
    state.rot.ry = Math.max(-90, Math.min(0, ry));
    state.snap = snapName || 'free';
    cubeEl.classList.toggle('animating', !!animate && !reduced);
    applyRotation();
    if (toolsEl) $$('[data-snap]', toolsEl).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-snap') === state.snap); });
    emit('rotate', { rx: state.rot.rx, ry: state.rot.ry, snap: state.snap });
  }
  function snap(name) {
    var t = SNAPS[name] || ISO;
    cancelInertia();
    setRotation(t.rx, t.ry, true, name in SNAPS || name === 'iso' ? name : 'free');
    emit('snap', { face: name });
    if (state.selected) setTimeout(scrollSelectedIntoView, 60);
  }
  function rotateBy(dry, drx, animate) { cancelInertia(); setRotation(state.rot.rx + (drx || 0), state.rot.ry + (dry || 0), animate !== false); }
  function nearestClean() {
    var best = null, bd = 1e9;
    CLEAN.forEach(function (c) { var d = Math.hypot(c.rx - state.rot.rx, c.ry - state.rot.ry); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  /* ---- drag to rotate: pointer events, light inertia, settle on a clean orientation ---- */
  var drag = null, inertiaRAF = 0, suppressClickUntil = 0;
  function cancelInertia() { if (inertiaRAF) cancelAnimationFrame(inertiaRAF); inertiaRAF = 0; }
  function onDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.callout, .toast, select, button, input, a, .cube-tools')) return;
    cancelInertia();
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, id: e.pointerId };
    cubeEl.classList.remove('animating');
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    if (!drag.moved) { drag.moved = true; stageEl.classList.add('grabbing'); try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    var now = performance.now(), dt = Math.max(1, now - drag.t);
    drag.vx = 0.7 * drag.vx + 0.3 * (dx / dt); drag.vy = 0.7 * drag.vy + 0.3 * (dy / dt);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    setRotation(state.rot.rx - dy * 0.35, state.rot.ry + dx * 0.35, false, 'free');
  }
  function onUp(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    stageEl.classList.remove('grabbing');
    if (!d.moved) return;
    suppressClickUntil = performance.now() + 250;
    emit('drag', { dx: d.x - d.sx, dy: d.y - d.sy });
    var vx = d.vx * 0.35 * 16, vy = d.vy * 0.35 * 16, frames = 0;
    if (reduced) { vx = vy = 0; }
    function step() {
      frames++;
      if (Math.abs(vx) < 0.15 && Math.abs(vy) < 0.15 || frames > 40) {
        inertiaRAF = 0;
        var c = nearestClean();
        setRotation(c.rx, c.ry, true, c.n);
        emit('snap', { face: c.n, settled: true });
        if (state.selected) setTimeout(scrollSelectedIntoView, 80);
        return;
      }
      setRotation(state.rot.rx - vy, state.rot.ry + vx, false, 'free');
      vx *= 0.86; vy *= 0.86;
      inertiaRAF = requestAnimationFrame(step);
    }
    inertiaRAF = requestAnimationFrame(step);
  }
  function onClickCapture(e) { if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }
  stageEl.addEventListener('pointerdown', onDown);
  stageEl.addEventListener('pointermove', onMove);
  stageEl.addEventListener('pointerup', onUp);
  stageEl.addEventListener('pointercancel', onUp);
  stageEl.addEventListener('click', onClickCapture, true);

  /* ---- data helpers ---- */
  function byName(a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); }
  function faceOf(axisId) { for (var i = 0; i < FACES.length; i++) if (state.faces[FACES[i]] === axisId) return FACES[i]; return null; }
  function hiddenAxes() { return axesList.filter(function (a) { return !faceOf(a.id); }); }
  function groupsFor(axisId) {
    var ax = axesById[axisId];
    var groups = ax.values.map(function (v) { return { value: v, files: state.files.filter(function (f) { return f.axes[axisId] === v; }).sort(byName) }; });
    var none = state.files.filter(function (f) { return !f.axes[axisId]; }).sort(byName);
    if (none.length) groups.push({ value: null, files: none });
    return groups;
  }
  function thClass(f) { var k = kinds[f.kind]; return 'th ' + (k ? k.th : 'doc'); }

  /* ---- face rendering ---- */
  function rowHTML(f) {
    if (o.rowHTML) return o.rowHTML(f, api);
    var k = kinds[f.kind];
    return '<div class="row" data-id="' + esc(f.id) + '" role="button" tabindex="-1" title="' + esc(f.name) + (k ? ' · ' + esc(k.label) : '') + (f.size ? ' · ' + esc(f.size) : '') + '"><span class="' + thClass(f) + '"></span><span class="nm">' + esc(f.name) + '</span>' + (o.meta && f.size ? '<span class="meta">' + esc(f.size) + '</span>' : '') + '</div>';
  }
  function groupHeaderHTML(g, ax, total) {
    if (o.groupHeaderHTML) return o.groupHeaderHTML(g, ax, api);
    var label = g.value === null ? ax.none : g.value;
    var w = total ? Math.round(g.files.length / total * 100) : 0;
    return '<header class="gh" data-group="' + esc(g.value === null ? '' : g.value) + '" title="' + esc(label) + ': ' + g.files.length + ' file' + (g.files.length === 1 ? '' : 's') + '"><b>' + esc(label) + '</b><span class="bar"><i style="--w:' + w + '%"></i></span><small>' + g.files.length + '</small></header>';
  }
  function groupsHTML(axisId) {
    var ax = axesById[axisId], total = state.files.length;
    return groupsFor(axisId).map(function (g) {
      return '<div class="grp' + (g.value === null ? ' none' : '') + '" data-group="' + esc(g.value === null ? '' : g.value) + '">' + groupHeaderHTML(g, ax, total) + g.files.map(rowHTML).join('') + '</div>';
    }).join('');
  }
  function tilesHTML(axisId) {
    var ax = axesById[axisId], groups = groupsFor(axisId), dense = groups.length > 6;
    return groups.map(function (g) {
      var label = g.value === null ? ax.none : g.value;
      var shown = dense ? g.files.slice(0, 3) : g.files, more = g.files.length - shown.length;
      return '<div class="tile' + (g.value === null ? ' none' : '') + '" data-group="' + esc(g.value === null ? '' : g.value) + '"><div><b title="' + esc(label) + '">' + esc(label) + '</b><small>' + g.files.length + ' file' + (g.files.length === 1 ? '' : 's') + '</small></div>' +
        '<div class="ths">' + shown.map(function (f) { return '<span class="' + thClass(f) + '" data-id="' + esc(f.id) + '" role="button" title="' + esc(f.name) + '"></span>'; }).join('') + (more > 0 ? '<span class="more">+' + more + '</span>' : '') + '</div></div>';
    }).join('');
  }
  function renderFace(face) {
    var axisId = state.faces[face], ax = axesById[axisId], el = faceEls[face];
    if (!ax) { el.innerHTML = '<div class="empty">No axis on this face</div>'; return; }
    var fb = $('.fb', el), st = fb ? fb.scrollTop : 0;
    var groups = groupsFor(axisId);
    el.style.setProperty('--fc', ax.color);
    el.innerHTML = '<header class="fh"><span class="fdot"></span>By ' + esc(ax.label) + '<span class="pos">' + esc(o.faceLabel[face]) + '</span><span class="cnt">' + groups.length + ' groups</span></header>' +
      '<div class="fb">' + groupsHTML(axisId) + '</div>' +
      (face === 'top' ? '<div class="tiles' + (groups.length > 6 ? ' dense' : '') + '">' + tilesHTML(axisId) + '</div>' : '');
    $('.fb', el).scrollTop = st;
    $('.fb', el).addEventListener('scroll', function () { markConn(100); }, { passive: true });
    applySelection(false);
  }
  function render() { FACES.forEach(renderFace); }
  function update(axisId, movedId) {
    var face = faceOf(axisId);
    if (!face) return;
    var before = captureTops(face);
    renderFace(face);
    if (movedId) flip(face, before, movedId);
    setTimeout(scrollSelectedIntoView, 50);
  }
  function captureTops(face) { var m = {}; $$('.fb .row', faceEls[face]).forEach(function (r) { m[r.getAttribute('data-id')] = r.offsetTop; }); return m; }
  function flip(face, before, movedId) {
    if (reduced) return;
    var rows = $$('.fb .row', faceEls[face]), anim = [];
    rows.forEach(function (r) {
      var id = r.getAttribute('data-id');
      if (!(id in before)) return;
      var dy = before[id] - r.offsetTop;
      if (Math.abs(dy) < 1) return;
      r.style.transition = 'none'; r.style.transform = 'translateY(' + dy + 'px)';
      anim.push(r);
    });
    if (!anim.length) return;
    void faceEls[face].offsetHeight;
    requestAnimationFrame(function () {
      anim.forEach(function (r) { r.style.transition = 'transform 360ms cubic-bezier(.2,.7,.2,1)'; r.style.transform = ''; });
      var moved = $('.fb .row[data-id="' + movedId + '"]', faceEls[face]); if (moved) moved.classList.add('moved');
      setTimeout(function () { anim.forEach(function (r) { r.style.transition = ''; }); }, 400);
    });
    markConn(500);
  }

  /* ---- clicks, hover ---- */
  function onItemClick(e) {
    var row = e.target.closest('[data-id]');
    if (row && row.getAttribute('data-id') && stageEl.contains(row)) { select(row.getAttribute('data-id'), { source: 'cube' }); e.preventDefault(); }
  }
  function onDblClick(e) {
    if (!o.dblclickGroup) return;
    var gh = e.target.closest('.gh, .tile'); if (!gh) return;
    var face = gh.closest('.face'), axisId = state.faces[face.getAttribute('data-face')], v = gh.getAttribute('data-group') || null;
    emit('groupOpen', { axis: axisId, value: v, face: face.getAttribute('data-face'), files: state.files.filter(function (f) { return (f.axes[axisId] || null) === v; }) });
  }
  function onOver(e) {
    var gh = e.target.closest('.gh, .tile'); if (!gh) return;
    var face = gh.closest('.face'), axisId = state.faces[face.getAttribute('data-face')], v = gh.getAttribute('data-group');
    var ids = state.files.filter(function (f) { return (f.axes[axisId] || '') === v; }).map(function (f) { return f.id; });
    if (o.hoverLights) lit(ids, face);
    emit('hover', { axis: axisId, value: v || null, ids: ids });
  }
  function onOut(e) { if (e.target.closest('.gh, .tile') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.gh, .tile'))) { if (o.hoverLights) lit([], null); emit('hover', { axis: null, value: null, ids: [] }); } }
  stageEl.addEventListener('click', onItemClick);
  stageEl.addEventListener('dblclick', onDblClick);
  stageEl.addEventListener('mouseover', onOver);
  stageEl.addEventListener('mouseout', onOut);
  function lit(ids, exceptFace) {
    $$('.lit').forEach(function (n) { n.classList.remove('lit'); });
    if (!ids.length) return;
    var set = {}; ids.forEach(function (i) { set[i] = 1; });
    FACES.forEach(function (face) {
      var el = faceEls[face];
      if (el === exceptFace) return;
      $$('[data-id]', el).forEach(function (n) { if (set[n.getAttribute('data-id')]) { n.classList.add('lit'); var t = n.closest('.tile'); if (t) t.classList.add('lit'); } });
    });
  }

  /* ---- selection ---- */
  function select(id, opts) {
    opts = opts || {};
    state.selected = id && filesById[id] ? id : null;
    applySelection(true);
    emit('select', { id: state.selected, file: state.selected ? filesById[state.selected] : null, source: opts.source || 'api' });
  }
  function applySelection(scroll) {
    $$('.sel').forEach(function (n) { n.classList.remove('sel'); });
    if (state.selected) {
      $$('[data-id="' + state.selected + '"]').forEach(function (n) { n.classList.add('sel'); var t = n.closest('.tile'); if (t) t.classList.add('sel'); });
      if (scroll) scrollSelectedIntoView();
    }
    markConn(400);
  }
  function scrollSelectedIntoView() {
    if (!state.selected) return;
    FACES.forEach(function (face) {
      var fb = $('.fb', faceEls[face]); var row = fb && $('.row[data-id="' + state.selected + '"]', fb);
      if (!fb || !row) return;
      var target = row.offsetTop - fb.clientHeight / 2 + row.offsetHeight / 2;
      if (Math.abs(fb.scrollTop - target) > 8) fb.scrollTo({ top: Math.max(0, target), behavior: reduced ? 'auto' : 'smooth' });
    });
    markConn(700);
  }

  /* ---- connector lines between the selected file's positions ---- */
  function markConn(ms) { connDirtyUntil = Math.max(connDirtyUntil, performance.now() + (ms || 0)); }
  function visibleIn(el, container) {
    var r = el.getBoundingClientRect(), c = container.getBoundingClientRect();
    return r.bottom > c.top + 30 && r.top < c.bottom - 4 && r.width > 0;
  }
  function drawConnectors() {
    if (!o.connectors || !state.selected || stageEl.hidden) { connEl.innerHTML = ''; return; }
    var st = stageEl.getBoundingClientRect(), pts = {};
    FACES.forEach(function (face) {
      var el = faceEls[face], node, fr = el.getBoundingClientRect();
      if (fr.width < 70 || fr.height < 70) return; // edge-on
      if (face === 'top' && cubeEl.getAttribute('data-topmode') === 'tiles') node = $('.tiles [data-id="' + state.selected + '"]', el);
      else node = $('.fb .row[data-id="' + state.selected + '"]', el);
      if (!node || !visibleIn(node, el)) return;
      var r = node.getBoundingClientRect();
      pts[face] = { l: r.left - st.left, r: r.right - st.left, t: r.top - st.top, b: r.bottom - st.top, cx: (r.left + r.right) / 2 - st.left, cy: (r.top + r.bottom) / 2 - st.top };
    });
    var out = '';
    function seg(a, b) { var mx = (a.x + b.x) / 2; out += '<path d="M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' C' + mx.toFixed(1) + ' ' + a.y.toFixed(1) + ' ' + mx.toFixed(1) + ' ' + b.y.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1) + '"/><circle cx="' + a.x.toFixed(1) + '" cy="' + a.y.toFixed(1) + '" r="3.5"/><circle cx="' + b.x.toFixed(1) + '" cy="' + b.y.toFixed(1) + '" r="3.5"/>'; }
    var f = pts.front, r = pts.right, t = pts.top;
    if (f && r) seg({ x: f.r - 6, y: f.cy }, { x: r.l + 6, y: r.cy });
    if (f && t) seg({ x: f.cx, y: f.t + 2 }, { x: t.cx, y: t.b - 2 });
    else if (r && t) seg({ x: r.cx, y: r.t + 2 }, { x: t.cx, y: t.b - 2 });
    connEl.innerHTML = out;
  }
  var alive = true, loopRAF = 0;
  (function loop() { if (!alive) return; if (performance.now() < connDirtyUntil || drag || inertiaRAF) drawConnectors(); loopRAF = requestAnimationFrame(loop); })();

  /* ---- axes on faces ---- */
  function showAxis(axisId, face, opts) {
    opts = opts || {};
    if (!axesById[axisId] || !o.faceLabel[face]) return;
    var current = faceOf(axisId), replaced = state.faces[face];
    if (current === face) return;
    if (current) state.faces[current] = replaced; // swap
    state.faces[face] = axisId;
    var swapFaces = current ? [face, current] : [face];
    cubeEl.classList.add('swapping');
    swapFaces.forEach(function (fc) { var el = faceEls[fc]; $$('.fb, .tiles', el).forEach(function (n) { n.style.opacity = '0'; }); });
    setTimeout(function () {
      swapFaces.forEach(renderFace);
      cubeEl.classList.remove('swapping');
      swapFaces.forEach(function (fc) { var el = faceEls[fc]; $$('.fb, .tiles', el).forEach(function (n) { n.style.opacity = ''; }); });
      markConn(400);
      emit('axisSwap', { axis: axisId, face: face, replaced: replaced, movedTo: current, silent: !!opts.silent });
      setTimeout(scrollSelectedIntoView, 30);
    }, reduced || opts.immediate ? 0 : 180);
  }
  function setFaces(map) { FACES.forEach(function (f) { if (map[f] !== undefined) state.faces[f] = map[f]; }); render(); emit('axisSwap', { all: true }); }
  function setFiles(files) { state.files = (files || []).slice(); indexFiles(); if (state.selected && !filesById[state.selected]) state.selected = null; render(); }

  // drop an axis chip onto a face
  var dropHandlers = [];
  if (o.acceptDrops) FACES.forEach(function (face) {
    var el = faceEls[face];
    var over = function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop'); };
    var leave = function () { el.classList.remove('drop'); };
    var drop = function (e) { e.preventDefault(); el.classList.remove('drop'); var a = e.dataTransfer.getData('text/plain'); if (a && axesById[a]) showAxis(a, face); };
    el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop);
    dropHandlers.push([el, over, leave, drop]);
  });

  /* ---- keys (optional; for single-cube pages) ---- */
  function onKey(e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (stageEl.hidden || !stageEl.offsetParent) return;
    switch (e.key) {
      case '1': e.preventDefault(); snap('front'); break;
      case '2': e.preventDefault(); snap('right'); break;
      case '3': e.preventDefault(); snap('top'); break;
      case '0': e.preventDefault(); snap('iso'); break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        e.preventDefault();
        rotateBy(e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0, e.key === 'ArrowUp' ? 8 : e.key === 'ArrowDown' ? -8 : 0, true);
        break;
    }
  }
  if (o.keys) document.addEventListener('keydown', onKey);

  /* ---- resize ---- */
  var ro = new ResizeObserver(function () { layout(); markConn(300); });
  ro.observe(stageEl);
  var onWinResize = function () { markConn(300); };
  window.addEventListener('resize', onWinResize);

  function destroy() {
    alive = false; cancelAnimationFrame(loopRAF); cancelInertia(); ro.disconnect();
    window.removeEventListener('resize', onWinResize);
    if (o.keys) document.removeEventListener('keydown', onKey);
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (ev, i) { stageEl.removeEventListener(ev, [onDown, onMove, onUp, onUp][i]); });
    stageEl.removeEventListener('click', onClickCapture, true);
    stageEl.removeEventListener('click', onItemClick); stageEl.removeEventListener('dblclick', onDblClick);
    stageEl.removeEventListener('mouseover', onOver); stageEl.removeEventListener('mouseout', onOut);
    dropHandlers.forEach(function (h) { h[0].removeEventListener('dragover', h[1]); h[0].removeEventListener('dragleave', h[2]); h[0].removeEventListener('drop', h[3]); });
    wrapEl.remove(); connEl.remove(); if (toolsEl) toolsEl.remove();
    stageEl.classList.remove('cube-stage', 'grabbing');
    listeners = {};
  }

  /* ---- boot ---- */
  render();
  layout();
  setRotation(ISO.rx, ISO.ry, false, 'iso');
  requestAnimationFrame(function () { cubeEl.classList.add('animating'); });

  var api = {
    el: cubeEl, wrap: wrapEl, conn: connEl, tools: toolsEl, stage: stageEl, faceEls: faceEls, state: state, FACES: FACES,
    on: on, off: off,
    setFiles: setFiles, setFaces: setFaces, showAxis: showAxis, faceOf: faceOf, hiddenAxes: hiddenAxes, axesById: axesById,
    render: render, renderFace: renderFace, update: update, groupsFor: groupsFor,
    snap: snap, rotateBy: rotateBy, setRotation: setRotation, nearestClean: nearestClean,
    select: select, lit: lit, scrollSelectedIntoView: scrollSelectedIntoView,
    layout: layout, markConn: markConn, drawConnectors: drawConnectors,
    get size() { return cubeSize; }, destroy: destroy
  };
  return api;
}

export default createCube;
