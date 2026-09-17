/* app.js — Facet prototype: cube, Ledger, inspector, compare drawer.
   Vanilla JS, no dependencies. Exposes window.Facet for tutorial.js and tests. */
(function () {
  'use strict';
  var D = window.FACET_DATA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var axesById = {}; D.axes.forEach(function (a) { axesById[a.id] = a; });
  var filesById = {}; D.files.forEach(function (f) { filesById[f.id] = f; });
  var FACES = ['front', 'right', 'top'];
  var FACE_LABEL = { front: 'Front', right: 'Right', top: 'Top' };
  var ISO = { rx: -33, ry: -42 };
  var PERSP = 2000;
  var SNAPS = { iso: ISO, front: { rx: 0, ry: 0 }, right: { rx: 0, ry: -90 }, top: { rx: -90, ry: 0 } };
  // orientations the cube settles on after a drag
  var CLEAN = [
    { n: 'iso', rx: -33, ry: -42 }, { n: 'front', rx: 0, ry: 0 }, { n: 'right', rx: 0, ry: -90 }, { n: 'top', rx: -90, ry: 0 },
    { n: 'free', rx: -33, ry: -70 }, { n: 'free', rx: -33, ry: -15 }, { n: 'free', rx: -58, ry: -42 }, { n: 'free', rx: -58, ry: -70 },
    { n: 'free', rx: -58, ry: -15 }, { n: 'free', rx: 0, ry: -45 }, { n: 'free', rx: -45, ry: 0 }, { n: 'free', rx: -45, ry: -90 }, { n: 'free', rx: -90, ry: -45 }
  ];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    view: 'facet',
    faces: { front: 'project', right: 'client', top: 'type' },
    rot: { rx: ISO.rx, ry: ISO.ry },
    snap: 'iso',
    selected: null,
    flat: false,
    query: '',
    ledgerPath: ['Projects', 'Atlas', 'Contracts'],
    theme: 'dark',
    compare: false
  };
  var undoStack = [];
  var listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function off(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(function (f) { return f !== fn; }); }
  function emit(ev, detail) { (listeners[ev] || []).slice().forEach(function (fn) { try { fn(detail); } catch (e) { console.error(e); } }); }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function thClass(f) { return 'th ' + D.kinds[f.kind].th; }
  function byName(a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); }
  function faceOf(axisId) { for (var i = 0; i < FACES.length; i++) if (state.faces[FACES[i]] === axisId) return FACES[i]; return null; }
  function hiddenAxes() { return D.axes.filter(function (a) { return !faceOf(a.id); }); }
  function matches(f) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    if (f.name.toLowerCase().indexOf(q) >= 0) return true;
    for (var k in f.axes) if (f.axes[k] && String(f.axes[k]).toLowerCase().indexOf(q) >= 0) return true;
    return f.path.toLowerCase().indexOf(q) >= 0;
  }
  function groupsFor(axisId) {
    var ax = axesById[axisId];
    var groups = ax.values.map(function (v) { return { value: v, files: D.files.filter(function (f) { return f.axes[axisId] === v; }).sort(byName) }; });
    var none = D.files.filter(function (f) { return !f.axes[axisId]; }).sort(byName);
    if (none.length) groups.push({ value: null, files: none });
    return groups;
  }

  /* =====================================================================
     Cube
     ===================================================================== */
  var stageEl = $('#cube-stage'), cubeEl = $('#cube'), wrapEl = $('#cube-wrap'), connEl = $('#connectors');
  var faceEls = { front: $('.face.front'), right: $('.face.right'), top: $('.face.top') };
  var cubeSize = 500;
  var connDirtyUntil = 0;

  function layoutCube() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (!w || !h) return;
    cubeSize = Math.round(Math.max(320, Math.min(w * 0.5, h * 0.53, 600)));
    cubeEl.style.setProperty('--s', cubeSize + 'px');
    applyRotation();
  }
  function zoomFor(snap) {
    if (snap === 'front' || snap === 'right' || snap === 'top') {
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
    emit('rotate', { rx: state.rot.rx, ry: state.rot.ry, snap: state.snap });
    $$('#cube-controls [data-snap]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-snap') === state.snap); });
    renderStatus();
  }
  function snap(name) {
    var t = SNAPS[name] || ISO;
    cancelInertia();
    if (state.flat) toggleFlat(false, true);
    setRotation(t.rx, t.ry, true, name in SNAPS ? name : 'free');
    emit('snap', { face: name });
    if (state.selected) setTimeout(scrollSelectedIntoView, 60);
  }
  $('#cube-controls').addEventListener('click', function (e) { var b = e.target.closest('[data-snap]'); if (b) snap(b.getAttribute('data-snap')); });
  function rotateBy(dry, drx, animate) { cancelInertia(); setRotation(state.rot.rx + drx, state.rot.ry + dry, animate !== false); }
  function nearestClean() {
    var best = null, bd = 1e9;
    CLEAN.forEach(function (c) { var d = Math.hypot(c.rx - state.rot.rx, c.ry - state.rot.ry); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  // drag to rotate (pointer events, light inertia, settle on a clean orientation)
  var drag = null, inertiaRAF = 0;
  function cancelInertia() { if (inertiaRAF) cancelAnimationFrame(inertiaRAF); inertiaRAF = 0; }
  stageEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || state.flat) return;
    if (e.target.closest('.callout, .toast, select, button')) return;
    cancelInertia();
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, id: e.pointerId };
    cubeEl.classList.remove('animating');
  });
  stageEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    if (!drag.moved) { drag.moved = true; stageEl.classList.add('grabbing'); try { stageEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    var now = performance.now(), dt = Math.max(1, now - drag.t);
    drag.vx = 0.7 * drag.vx + 0.3 * (dx / dt); drag.vy = 0.7 * drag.vy + 0.3 * (dy / dt);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    setRotation(state.rot.rx - dy * 0.35, state.rot.ry + dx * 0.35, false, 'free');
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    stageEl.classList.remove('grabbing');
    if (!d.moved) return;
    suppressClickUntil = performance.now() + 250;
    emit('drag', { dx: d.x - d.sx, dy: d.y - d.sy });
    // inertia: carry velocity (px/ms → deg) for a moment, then settle
    var vx = d.vx * 0.35 * 16, vy = d.vy * 0.35 * 16, frames = 0;
    if (reduced) { vx = vy = 0; }
    function step() {
      frames++;
      if (Math.abs(vx) < 0.15 && Math.abs(vy) < 0.15 || frames > 40) {
        inertiaRAF = 0;
        var c = nearestClean();
        setRotation(c.rx, c.ry, true, c.n);
        if (state.selected) setTimeout(scrollSelectedIntoView, 80);
        return;
      }
      setRotation(state.rot.rx - vy, state.rot.ry + vx, false, 'free');
      vx *= 0.86; vy *= 0.86;
      inertiaRAF = requestAnimationFrame(step);
    }
    inertiaRAF = requestAnimationFrame(step);
  }
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);
  var suppressClickUntil = 0;
  stageEl.addEventListener('click', function (e) { if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);

  /* ---- face rendering ---- */
  function rowHTML(f, extra) {
    return '<div class="row' + (extra || '') + '" data-id="' + f.id + '" role="button" tabindex="-1" title="' + esc(f.name) + ' · ' + esc(D.kinds[f.kind].label) + ' · ' + esc(f.size) + '"><span class="' + thClass(f) + '"></span><span class="nm">' + esc(f.name) + '</span></div>';
  }
  function groupsHTML(axisId, withMeta) {
    var ax = axesById[axisId], total = D.files.length;
    return groupsFor(axisId).map(function (g) {
      var label = g.value === null ? ax.none : g.value;
      var w = Math.round(g.files.length / total * 100);
      return '<div class="grp' + (g.value === null ? ' none' : '') + '" data-group="' + esc(g.value === null ? '' : g.value) + '">' +
        '<header class="gh" data-group="' + esc(g.value === null ? '' : g.value) + '" title="' + esc(label) + ': ' + g.files.length + ' file' + (g.files.length === 1 ? '' : 's') + '. Hover to light them up on the other faces."><b>' + esc(label) + '</b><span class="bar"><i style="--w:' + w + '%"></i></span><small>' + g.files.length + '</small></header>' +
        g.files.map(function (f) { return withMeta ? rowHTML(f).replace('</div>', '<span class="meta">' + esc(f.size) + '</span></div>') : rowHTML(f); }).join('') +
        '</div>';
    }).join('');
  }
  function tilesHTML(axisId) {
    var ax = axesById[axisId], groups = groupsFor(axisId), dense = groups.length > 6;
    return groups.map(function (g) {
      var label = g.value === null ? ax.none : g.value;
      var shown = dense ? g.files.slice(0, 3) : g.files, more = g.files.length - shown.length;
      return '<div class="tile' + (g.value === null ? ' none' : '') + '" data-group="' + esc(g.value === null ? '' : g.value) + '"><div><b title="' + esc(label) + '">' + esc(label) + '</b><small>' + g.files.length + ' file' + (g.files.length === 1 ? '' : 's') + '</small></div>' +
        '<div class="ths">' + shown.map(function (f) { return '<span class="' + thClass(f) + '" data-id="' + f.id + '" role="button" title="' + esc(f.name) + '"></span>'; }).join('') + (more > 0 ? '<span class="more">+' + more + '</span>' : '') + '</div></div>';
    }).join('');
  }
  function renderFace(face) {
    var axisId = state.faces[face], ax = axesById[axisId], el = faceEls[face];
    var fb = $('.fb', el), st = fb ? fb.scrollTop : 0;
    var groups = groupsFor(axisId);
    el.style.setProperty('--fc', ax.color);
    el.innerHTML = '<header class="fh"><span class="fdot"></span>By ' + esc(ax.label) + '<span class="pos">' + FACE_LABEL[face] + '</span><span class="cnt">' + groups.length + ' groups</span></header>' +
      '<div class="fb">' + groupsHTML(axisId) + '</div>' +
      (face === 'top' ? '<div class="tiles' + (groups.length > 6 ? ' dense' : '') + '">' + tilesHTML(axisId) + '</div>' : '');
    $('.fb', el).scrollTop = st;
    $('.fb', el).addEventListener('scroll', function () { markConn(100); }, { passive: true });
  }
  function renderFaces() { FACES.forEach(renderFace); applySelection(false); applyQuery(); renderChips(); renderAxesNav(); }
  function renderFlat() {
    var flat = $('#flat'), axisId = state.faces.front, ax = axesById[axisId];
    flat.style.setProperty('--fc', ax.color);
    flat.innerHTML = '<header class="fh"><span class="fdot"></span>By ' + esc(ax.label) + ' · flat<span class="cnt">' + D.files.length + ' files · the front face, unfolded</span></header><div class="fb">' + groupsHTML(axisId, true) + '</div>';
  }

  // clicks on rows / thumbs / group headers (delegated)
  function onItemClick(e) {
    var row = e.target.closest('[data-id]');
    if (row && row.getAttribute('data-id')) { select(row.getAttribute('data-id'), { source: 'facet' }); e.preventDefault(); }
  }
  stageEl.addEventListener('click', onItemClick);
  stageEl.addEventListener('mouseover', function (e) {
    var gh = e.target.closest('.gh, .tile');
    if (!gh) return;
    var face = gh.closest('.face');
    var axisId = face ? state.faces[face.getAttribute('data-face')] : state.faces.front;
    var v = gh.getAttribute('data-group');
    var ids = D.files.filter(function (f) { return (f.axes[axisId] || '') === v; }).map(function (f) { return f.id; });
    litIds(ids, face);
  });
  stageEl.addEventListener('mouseout', function (e) { if (e.target.closest('.gh, .tile') && !e.relatedTarget?.closest?.('.gh, .tile')) litIds([], null); });
  function litIds(ids, exceptFace) {
    $$('.lit', stageEl).forEach(function (n) { n.classList.remove('lit'); });
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
    var f = id ? filesById[id] : null;
    state.selected = f ? f.id : null;
    applySelection(true);
    renderInspector();
    renderStatus();
    if (f && state.view === 'ledger') { state.ledgerPath = f.path.split('/'); renderLedger(); }
    emit('select', { id: state.selected, source: opts.source || 'api' });
  }
  function applySelection(scroll) {
    $$('.sel').forEach(function (n) { n.classList.remove('sel'); });
    if (state.selected) {
      $$('[data-id="' + state.selected + '"]').forEach(function (n) { n.classList.add('sel'); var t = n.closest('.tile'); if (t) t.classList.add('sel'); });
      $$('.mrow[data-file="' + state.selected + '"]').forEach(function (n) { n.classList.add('focus'); });
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
    var fr = $('#flat .row.sel'); if (fr) fr.scrollIntoView({ block: 'nearest' });
    markConn(700);
  }

  /* ---- connector lines between the selected file's three positions ---- */
  function markConn(ms) { connDirtyUntil = Math.max(connDirtyUntil, performance.now() + (ms || 0)); }
  function visibleIn(el, container) {
    var r = el.getBoundingClientRect(), c = container.getBoundingClientRect();
    return r.bottom > c.top + 30 && r.top < c.bottom - 4 && r.width > 0;
  }
  function drawConnectors() {
    if (!state.selected || state.view !== 'facet' || state.flat) { connEl.innerHTML = ''; return; }
    var st = stageEl.getBoundingClientRect();
    var pts = {};
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
  (function loop() { if (performance.now() < connDirtyUntil || drag || inertiaRAF) drawConnectors(); requestAnimationFrame(loop); })();

  /* ---- axis value changes ---- */
  function setAxis(fileId, axisId, value, opts) {
    opts = opts || {};
    var f = filesById[fileId], ax = axesById[axisId];
    if (!f || !ax) return;
    var old = f.axes[axisId] || null;
    var next = value || null;
    if (old === next) return;
    var face = faceOf(axisId);
    var before = face ? captureTops(face) : null;
    if (next) f.axes[axisId] = next; else delete f.axes[axisId];
    if (face) { renderFace(face); applySelection(false); applyQuery(); if (before) flip(face, before, fileId); }
    if (state.flat) renderFlat();
    applySelection(false);
    renderInspector();
    renderStatus();
    if (!opts.silent) {
      undoStack.push(function () { setAxis(fileId, axisId, old, { silent: true }); });
      var msg = next ? (old ? 'Moved <b>' + esc(f.name) + '</b> from ' + esc(old) + ' to <b>' + esc(next) + '</b> on ' + esc(ax.label) : 'Set ' + esc(ax.label) + ' of <b>' + esc(f.name) + '</b> to <b>' + esc(next) + '</b>') : 'Cleared ' + esc(ax.label) + ' on <b>' + esc(f.name) + '</b>';
      toast(msg + (face ? '' : ' <span style="color:var(--dim)">(' + esc(ax.label) + ' is not on the cube right now)</span>'), true);
    }
    emit('axisChange', { id: fileId, axis: axisId, from: old, to: next, silent: !!opts.silent });
    setTimeout(scrollSelectedIntoView, 50);
  }
  function captureTops(face) {
    var m = {}; $$('.fb .row', faceEls[face]).forEach(function (r) { m[r.getAttribute('data-id')] = r.offsetTop; }); return m;
  }
  function flip(face, before, movedId) {
    if (reduced) return;
    var rows = $$('.fb .row', faceEls[face]);
    var anim = [];
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
  function undo() { var fn = undoStack.pop(); if (fn) { fn(); toast('Undone', false); } }

  /* ---- toast ---- */
  var toastTimer = 0;
  function toast(html, withUndo) {
    var t = $('#toast');
    t.innerHTML = '<span class="msg">' + html + '</span>' + (withUndo ? '<button class="u" type="button" id="undo-btn"><svg class="ic"><use href="#i-undo"/></svg>Undo</button>' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, withUndo ? 7000 : 2500);
    var u = $('#undo-btn'); if (u) u.addEventListener('click', function () { undo(); });
  }

  /* ---- axes on faces ---- */
  function showAxis(axisId, face, opts) {
    opts = opts || {};
    if (!axesById[axisId] || !FACE_LABEL[face]) return;
    var current = faceOf(axisId), replaced = state.faces[face];
    if (current === face) return;
    if (current) state.faces[current] = replaced; // swap
    state.faces[face] = axisId;
    var swapFaces = current ? [face, current] : [face];
    cubeEl.classList.add('swapping');
    swapFaces.forEach(function (fc) { var el = faceEls[fc]; $$('.fb, .tiles', el).forEach(function (n) { n.style.opacity = '0'; }); el.style.transition = 'transform 220ms var(--ease)'; });
    setTimeout(function () {
      swapFaces.forEach(renderFace);
      applySelection(false); applyQuery(); renderChips(); renderAxesNav(); renderInspector(); renderStatus();
      if (state.flat) renderFlat();
      cubeEl.classList.remove('swapping');
      swapFaces.forEach(function (fc) { var el = faceEls[fc]; $$('.fb, .tiles', el).forEach(function (n) { n.style.opacity = ''; }); el.style.transition = ''; });
      markConn(400);
      if (!opts.silent) toast('<b>' + esc(axesById[axisId].label) + '</b> is now on the ' + FACE_LABEL[face] + ' face' + (current ? ', <b>' + esc(axesById[replaced].label) + '</b> moved to ' + FACE_LABEL[current] : ', <b>' + esc(axesById[replaced].label) + '</b> is hidden'), false);
      emit('axisSwap', { axis: axisId, face: face, replaced: replaced });
      setTimeout(scrollSelectedIntoView, 30);
    }, reduced ? 0 : 180);
  }
  function setFaces(map) { FACES.forEach(function (f) { state.faces[f] = map[f]; }); renderFaces(); renderInspector(); renderStatus(); if (state.flat) renderFlat(); emit('axisSwap', { all: true }); }

  function renderChips() {
    $('#chips-shown').innerHTML = FACES.map(function (face) {
      var ax = axesById[state.faces[face]];
      return '<button class="chip on" type="button" draggable="true" data-axis="' + ax.id + '" style="--c:' + ax.color + '" title="' + esc(ax.label) + ' is on the ' + FACE_LABEL[face] + ' face. Click to move it, or drag onto another face."><span class="dot"></span>' + esc(ax.label) + '<small>' + FACE_LABEL[face] + '</small></button>';
    }).join('');
    $('#chips-hidden').innerHTML = hiddenAxes().map(function (ax) {
      return '<button class="chip" type="button" draggable="true" data-axis="' + ax.id + '" style="--c:' + ax.color + '" title="' + esc(ax.label) + ' is not on the cube. Click to choose a face, or drag it onto one."><span class="dot"></span>' + esc(ax.label) + '</button>';
    }).join('');
  }
  function renderAxesNav() {
    $('#axes-nav').innerHTML = D.axes.map(function (ax) {
      var face = faceOf(ax.id);
      return '<button type="button" class="' + (face ? 'on' : '') + '" data-axis="' + ax.id + '" style="--c:' + ax.color + '" title="' + esc(ax.label) + (face ? ' · ' + FACE_LABEL[face] + ' face' : ' · hidden') + '"><span class="dot"></span><span>' + esc(ax.label) + '</span>' + (face ? '<span class="facepill">' + FACE_LABEL[face] + '</span>' : '<span class="cnt">hidden</span>') + '</button>';
    }).join('');
  }
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-axis]');
    if (!chip || e.target.closest('.menu')) return;
    e.preventDefault();
    openAxisMenu(chip, chip.getAttribute('data-axis'));
  });
  // drag a chip onto a face
  document.addEventListener('dragstart', function (e) {
    var chip = e.target.closest && e.target.closest('.chip[data-axis]');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', chip.getAttribute('data-axis'));
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });
  document.addEventListener('dragend', function (e) { $$('.chip.dragging').forEach(function (c) { c.classList.remove('dragging'); }); $$('.face.drop').forEach(function (f) { f.classList.remove('drop'); }); });
  FACES.forEach(function (face) {
    var el = faceEls[face];
    el.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop'); });
    el.addEventListener('dragleave', function () { el.classList.remove('drop'); });
    el.addEventListener('drop', function (e) { e.preventDefault(); el.classList.remove('drop'); var a = e.dataTransfer.getData('text/plain'); if (a) showAxis(a, face); });
  });

  /* ---- popover menu ---- */
  var menuEl = $('#menu');
  function openMenu(anchor, html, onPick) {
    menuEl.innerHTML = html;
    menuEl.hidden = false;
    var r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
    var top = r.bottom + 6; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menuEl.style.left = left + 'px'; menuEl.style.top = top + 'px';
    menuEl.onclick = function (e) { var b = e.target.closest('button[data-act]'); if (!b || b.disabled) return; closeMenu(); onPick(b.getAttribute('data-act'), b); };
    var first = $('button', menuEl); if (first) first.focus();
  }
  function closeMenu() { menuEl.hidden = true; menuEl.innerHTML = ''; }
  document.addEventListener('pointerdown', function (e) { if (!menuEl.hidden && !e.target.closest('#menu')) closeMenu(); });
  function openAxisMenu(anchor, axisId) {
    var ax = axesById[axisId], face = faceOf(axisId), html;
    if (face) {
      html = '<div class="mh"><span class="dot" style="--c:' + ax.color + '"></span>' + esc(ax.label) + ' · ' + FACE_LABEL[face] + ' face</div>' +
        FACES.filter(function (f) { return f !== face; }).map(function (f) { return '<button type="button" data-act="face:' + f + '">Move to ' + FACE_LABEL[f] + '<small>swap with ' + esc(axesById[state.faces[f]].label) + '</small></button>'; }).join('') +
        '<hr>' + hiddenAxes().map(function (h) { return '<button type="button" data-act="replace:' + h.id + '"><span class="dot" style="--c:' + h.color + '"></span>Replace with ' + esc(h.label) + '</button>'; }).join('');
    } else {
      html = '<div class="mh"><span class="dot" style="--c:' + ax.color + '"></span>Show ' + esc(ax.label) + ' on…</div>' +
        FACES.map(function (f) { return '<button type="button" data-act="face:' + f + '">' + FACE_LABEL[f] + ' face<small>replaces ' + esc(axesById[state.faces[f]].label) + '</small></button>'; }).join('');
    }
    openMenu(anchor, html, function (act) {
      var p = act.split(':');
      if (p[0] === 'face') showAxis(axisId, p[1]);
      else if (p[0] === 'replace') showAxis(p[1], face);
    });
  }

  /* ---- search ---- */
  function applyQuery() {
    var q = state.query;
    D.files.forEach(function (f) {
      var ok = !q || matches(f);
      $$('[data-id="' + f.id + '"]').forEach(function (n) { n.classList.toggle('dim', !ok); });
      $$('.mrow[data-file="' + f.id + '"]').forEach(function (n) { n.classList.toggle('dim', !ok); });
    });
  }
  $('#search').addEventListener('input', function (e) { state.query = e.target.value.trim(); applyQuery(); renderStatus(); emit('search', { query: state.query }); });
  $('#search').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; state.query = ''; applyQuery(); renderStatus(); e.target.blur(); } });

  /* ---- flat mode ---- */
  var flatBtn = $('#flat-btn');
  function toggleFlat(v, quiet) {
    var next = typeof v === 'boolean' ? v : !state.flat;
    if (next === state.flat) return;
    state.flat = next;
    flatBtn.setAttribute('aria-pressed', String(next));
    var flat = $('#flat');
    if (next) {
      cancelInertia();
      cubeEl.classList.add('flatmode');
      setRotation(0, 0, true, 'front');
      setTimeout(function () { renderFlat(); flat.hidden = false; wrapEl.style.opacity = '0'; wrapEl.style.transition = 'opacity 200ms'; applySelection(false); applyQuery(); }, reduced ? 0 : 260);
    } else {
      flat.hidden = true; wrapEl.style.opacity = ''; cubeEl.classList.remove('flatmode');
      if (!quiet) setRotation(ISO.rx, ISO.ry, true, 'iso');
    }
    connEl.innerHTML = '';
    renderStatus();
    emit('flat', { on: next });
  }
  flatBtn.addEventListener('click', function () { toggleFlat(); });
  $('#flat').addEventListener('click', onItemClick);

  /* =====================================================================
     Ledger (Miller columns over the same files)
     ===================================================================== */
  var tree = (function build() {
    var root = { name: D.workspace, children: {}, files: [], path: [] };
    function ensure(parts) { var n = root; parts.forEach(function (p, i) { if (!n.children[p]) n.children[p] = { name: p, children: {}, files: [], path: parts.slice(0, i + 1) }; n = n.children[p]; }); return n; }
    D.files.forEach(function (f) { ensure(f.path.split('/')).files.push(f); });
    D.emptyFolders.forEach(function (p) { ensure(p.split('/')); });
    return root;
  })();
  function nodeAt(path) { var n = tree; for (var i = 0; i < path.length; i++) { n = n.children[path[i]]; if (!n) return null; } return n; }
  function countItems(n) { return Object.keys(n.children).length + n.files.length; }
  function countFilesDeep(n) { var c = n.files.length; Object.keys(n.children).forEach(function (k) { c += countFilesDeep(n.children[k]); }); return c; }
  function fold(dim) { return '<span class="fold' + (dim ? ' dim' : '') + '"></span>'; }
  function chev() { return '<svg class="ic chv"><use href="#i-chevr"/></svg>'; }

  function renderLedger() {
    var cols = $('#cols'), path = state.ledgerPath.slice();
    // trim to an existing path
    while (path.length && !nodeAt(path)) path.pop();
    state.ledgerPath = path;
    var nodes = [tree]; for (var i = 0; i < path.length; i++) nodes.push(nodeAt(path.slice(0, i + 1)));
    var sel = state.selected ? filesById[state.selected] : null;
    var cw = Math.max(170, Math.min(220, Math.floor((cols.clientWidth - 250) / Math.max(1, nodes.length - 1))));
    cols.style.setProperty('--cw', cw + 'px');
    cols.innerHTML = nodes.map(function (n, depth) {
      var subs = Object.keys(n.children).sort().map(function (k) { return n.children[k]; });
      var files = n.files.slice().sort(byName);
      var rows = subs.map(function (s) {
        var onPath = path[depth] === s.name;
        var deep = countFilesDeep(s);
        return '<button type="button" class="mrow' + (onPath ? ' path' : '') + '" data-folder="' + esc(s.path.join('/')) + '" title="' + esc(s.name) + ' · ' + countItems(s) + ' item' + (countItems(s) === 1 ? '' : 's') + '">' + fold(deep === 0) + '<span class="nm">' + esc(s.name) + '</span>' + chev() + '</button>';
      }).concat(files.map(function (f) {
        return '<button type="button" class="mrow' + (sel && sel.id === f.id ? ' focus' : '') + '" data-file="' + f.id + '" title="' + esc(f.name) + ' · ' + esc(f.size) + '"><span class="' + thClass(f) + '"></span><span class="nm">' + esc(f.name) + '</span><span class="sz">' + esc(f.size) + '</span></button>';
      })).join('');
      if (!rows) rows = '<div class="empty"><b>Empty folder</b>Nothing has been filed here yet.</div>';
      var isLast = depth === nodes.length - 1;
      return '<div class="col" data-depth="' + depth + '"><div class="col-h">' + esc(n.name) + '<span class="cnt">' + countItems(n) + ' item' + (countItems(n) === 1 ? '' : 's') + (isLast && files.length ? ' · by name' : '') + '</span></div><div class="rows">' + rows + '</div></div>';
    }).join('');
    // breadcrumb + path bar
    var crumbs = '<button type="button" data-path="" title="Go to ' + esc(D.workspace) + '"><svg class="ic" style="width:14px;height:14px"><use href="#i-home"/></svg>' + (path.length > 2 ? '' : ' ' + esc(D.workspace)) + '</button>';
    path.forEach(function (p, i) {
      var isLast = i === path.length - 1;
      if (path.length > 2 && i < path.length - 2) { if (i === 0) crumbs += '<svg class="ic sep"><use href="#i-chevr"/></svg><button type="button" data-path="' + esc(path.slice(0, path.length - 2).join('/')) + '" title="' + esc(path.slice(0, path.length - 2).join(' › ')) + '">…</button>'; return; }
      crumbs += '<svg class="ic sep"><use href="#i-chevr"/></svg>' + (isLast ? '<b>' + esc(p) + '</b>' : '<button type="button" data-path="' + esc(path.slice(0, i + 1).join('/')) + '">' + esc(p) + '</button>');
    });
    var crumbEl = $('#ledger-crumbs');
    crumbEl.innerHTML = crumbs;
    // collapse further if the top bar is tight: keep only the last segment after the ellipsis
    if (crumbEl.scrollWidth > crumbEl.clientWidth + 1 && path.length > 1) {
      crumbEl.innerHTML = '<button type="button" data-path="" title="Go to ' + esc(D.workspace) + '"><svg class="ic" style="width:14px;height:14px"><use href="#i-home"/></svg></button><svg class="ic sep"><use href="#i-chevr"/></svg><button type="button" data-path="' + esc(path.slice(0, path.length - 1).join('/')) + '" title="' + esc(path.slice(0, path.length - 1).join(' › ')) + '">…</button><svg class="ic sep"><use href="#i-chevr"/></svg><b>' + esc(path[path.length - 1]) + '</b>';
    }
    var last = nodes[nodes.length - 1];
    var pb = '<span class="seg2"><svg class="ic" style="color:var(--dim)"><use href="#i-home"/></svg>' + esc(D.workspace) + '</span>';
    path.forEach(function (p, i) { pb += chev() + '<button type="button" class="seg2" data-path="' + esc(path.slice(0, i + 1).join('/')) + '">' + fold(false) + esc(p) + '</button>'; });
    if (sel && sel.path === path.join('/')) pb += chev() + '<span class="seg2"><span class="' + thClass(sel) + '"></span><b>' + esc(sel.name) + '</b></span>';
    pb += '<span class="stat">' + countItems(last) + ' item' + (countItems(last) === 1 ? '' : 's') + (sel && sel.path === path.join('/') ? ', 1 selected' : '') + ' · 1.8 TB available</span>';
    $('#pathbar').innerHTML = pb;
    applyQuery();
    var fr = $('.mrow.focus', cols); if (fr) fr.scrollIntoView({ block: 'nearest' });
    cols.scrollLeft = cols.scrollWidth;
    renderStatus();
  }
  $('#ledger-stage').addEventListener('click', function (e) {
    var b = e.target.closest('[data-folder], [data-file], [data-path]');
    if (!b) return;
    if (b.hasAttribute('data-folder')) { state.ledgerPath = b.getAttribute('data-folder').split('/'); state.selected = null; renderLedger(); renderInspector(); applySelection(false); emit('ledgerPath', { path: state.ledgerPath }); }
    else if (b.hasAttribute('data-file')) select(b.getAttribute('data-file'), { source: 'ledger' });
    else if (b.hasAttribute('data-path')) { var p = b.getAttribute('data-path'); state.ledgerPath = p ? p.split('/') : []; state.selected = null; renderLedger(); renderInspector(); applySelection(false); emit('ledgerPath', { path: state.ledgerPath }); }
  });
  $('#ledger-crumbs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-path]'); if (!b) return;
    var p = b.getAttribute('data-path'); state.ledgerPath = p ? p.split('/') : []; state.selected = null; renderLedger(); renderInspector(); applySelection(false);
  });
  function ledgerKey(key) {
    var node = nodeAt(state.ledgerPath); if (!node) return false;
    var files = node.files.slice().sort(byName);
    var idx = state.selected ? files.findIndex(function (f) { return f.id === state.selected; }) : -1;
    if (key === 'ArrowDown') { if (files.length) select(files[Math.min(files.length - 1, idx + 1)].id, { source: 'ledger' }); return true; }
    if (key === 'ArrowUp') { if (files.length) select(files[Math.max(0, idx - 1)].id, { source: 'ledger' }); return true; }
    if (key === 'ArrowLeft') { if (state.ledgerPath.length) { state.ledgerPath.pop(); state.selected = null; renderLedger(); renderInspector(); applySelection(false); } return true; }
    if (key === 'ArrowRight') { var subs = Object.keys(node.children).sort(); if (subs.length) { state.ledgerPath.push(subs[0]); state.selected = null; renderLedger(); renderInspector(); applySelection(false); } return true; }
    return false;
  }

  /* =====================================================================
     Views
     ===================================================================== */
  var appEl = $('#app');
  function setView(v) {
    if (v !== 'facet' && v !== 'ledger') return;
    if (v === state.view) return;
    state.view = v;
    appEl.setAttribute('data-view', v);
    $$('#view-seg [data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === v)); });
    $('#facet-stage').hidden = v !== 'facet';
    $('#ledger-stage').hidden = v !== 'ledger';
    document.documentElement.style.setProperty('--view-ac', v === 'ledger' ? 'var(--ledger)' : 'var(--ac)');
    hideCallouts();
    if (v === 'ledger') { if (state.selected) state.ledgerPath = filesById[state.selected].path.split('/'); renderLedger(); }
    else { layoutCube(); applySelection(true); }
    renderInspector(); renderStatus();
    emit('view', { view: v });
  }
  $('#view-seg').addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) setView(b.getAttribute('data-view')); });

  /* ---- inspector ---- */
  var inspEl = $('#inspector');
  function avatar(p, size) { var pe = D.people[p]; return '<span class="av" style="--c:' + pe.color + (size ? ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px' : '') + '">' + pe.initials + '</span>'; }
  function pathHTML(f, withFile) {
    var parts = f.path.split('/');
    var h = '<span class="location"><svg class="ic chv"><use href="#i-home"/></svg>' + esc(D.workspace);
    parts.forEach(function (p) { h += '<svg class="ic chv"><use href="#i-chevr"/></svg><span class="fold"></span>' + esc(p); });
    if (withFile) h += '<svg class="ic chv"><use href="#i-chevr"/></svg><b>' + esc(f.name) + '</b>';
    return h + '</span>';
  }
  function renderInspector() {
    var f = state.selected ? filesById[state.selected] : null;
    if (!f) {
      if (state.view === 'ledger') {
        var node = nodeAt(state.ledgerPath) || tree;
        inspEl.innerHTML = '<div class="ih"><svg class="ic"><use href="#i-search"/></svg>Quick Look<span class="kbd">Space</span></div><div class="none"><svg class="ic big"><use href="#i-folder"/></svg><div><b>' + esc(node.name) + '</b>' + countItems(node) + ' item' + (countItems(node) === 1 ? '' : 's') + ' · ' + countFilesDeep(node) + ' file' + (countFilesDeep(node) === 1 ? '' : 's') + ' inside</div><p style="margin:0">Select a file in the last column to preview it here. Arrow keys move the focus; Space opens Quick Look.</p></div>';
      } else {
        inspEl.innerHTML = '<div class="ih"><svg class="ic"><use href="#i-cube"/></svg>File</div><div class="none"><svg class="ic big"><use href="#i-cube"/></svg><div><b>Select a file on any face</b>It lights up on all three faces at once, and this panel shows where it sits on every axis.</div><div class="tags" style="justify-content:center">' + D.axes.map(function (a) { return '<span class="pill c" style="--c:' + a.color + '">' + esc(a.label) + '</span>'; }).join('') + '</div></div>';
      }
      return;
    }
    var kind = D.kinds[f.kind];
    var setAxes = D.axes.filter(function (a) { return f.axes[a.id]; });
    var unset = D.axes.filter(function (a) { return !f.axes[a.id]; });
    var shownCount = setAxes.filter(function (a) { return faceOf(a.id); }).length;
    var owner = D.people[f.owner];
    if (state.view === 'ledger') {
      var isDoc = f.kind === 'pdf' || f.kind === 'sig' || f.kind === 'docx';
      var pages = D.pages[f.id] || (isDoc ? 2 : 0);
      var page = isDoc
        ? '<div class="page"><div class="ph"><span>' + esc((f.axes.client && f.axes.client !== 'Internal' ? f.axes.client + ' · ' : '') + 'Northwind') + '</span><span>Confidential</span></div><div class="pt">' + esc(f.name.replace(/\.[a-z]+$/i, '')) + '</div><div class="ps">' + esc(kind.label) + ' · ' + esc(f.modified) + '</div><div class="ln s"></div><div class="clause">1. Purpose</div><div class="ln"></div><div class="clause">2. Scope</div><div class="ln"></div><div class="clause">3. Terms</div><div class="ln s" style="width:85%"></div><div class="pn">1</div><div class="pgnav"><svg class="ic" style="width:12px;height:12px"><use href="#i-back"/></svg>1 / ' + pages + '<svg class="ic" style="width:12px;height:12px"><use href="#i-chevr"/></svg></div></div>'
        : '<div class="page ' + thClass(f) + '"></div>';
      var tags = D.axes.filter(function (a) { return a.id !== 'project' && f.axes[a.id]; }).map(function (a) { return '<span class="pill c" style="--c:' + a.color + '">' + esc(f.axes[a.id]) + '</span>'; }).join('');
      inspEl.innerHTML = '<div class="ih"><svg class="ic"><use href="#i-search"/></svg>Quick Look<span class="kbd">Space</span><button class="ib" type="button" data-close title="Close Quick Look" aria-label="Close Quick Look"><svg class="ic"><use href="#i-x"/></svg></button></div>' +
        page +
        '<h3>' + esc(f.name) + '<span class="pill ledger">' + esc(f.name.split('.').pop().toUpperCase()) + '</span></h3>' +
        '<div class="meta"><span>Kind</span><b>' + esc(kind.label) + (pages ? ' · ' + pages + ' pages' : '') + '</b><span>Size</span><b>' + esc(f.size) + '</b><span>Owner</span><b>' + avatar(f.owner, 18) + esc(owner.name) + '</b><span>Modified</span><b>' + esc(f.modified) + '</b></div>' +
        '<div class="sec-h">Location</div>' + pathHTML(f, false) +
        '<div class="sec-h">Tags<span class="cnt">' + D.axes.filter(function (a) { return a.id !== 'project' && f.axes[a.id]; }).length + '</span><span class="act">Edit</span></div><div class="tags">' + tags + '<span class="pill" style="border-style:dashed;color:var(--dim)">+ Tag</span></div>' +
        '<div class="bothviews"><b>One address.</b> In Ledger this file lives in exactly one folder. The tags above are how it gets a second home, but the columns can only browse folders. <button class="btn sm" type="button" data-goto="facet" style="margin-top:8px"><svg class="ic"><use href="#i-cube"/></svg>See it on the cube</button></div>' +
        '<div style="display:flex;gap:8px"><button class="btn pri-ledger" type="button" style="flex:1;justify-content:center">Open in Preview</button><button class="btn" type="button" title="Share this file"><svg class="ic"><use href="#i-share"/></svg>Share</button></div>' +
        '<div class="kbdrow"><span><span class="kbd">↑</span><span class="kbd">↓</span>move</span><span><span class="kbd">←</span><span class="kbd">→</span>folders</span><span><span class="kbd">Space</span>preview</span></div>';
    } else {
      var homes = setAxes.map(function (a) {
        var face = faceOf(a.id);
        return '<div class="home" data-axis="' + a.id + '" style="--c:' + a.color + '"><span class="axn"><span class="dot"></span>' + esc(a.label) + '</span>' +
          '<select aria-label="' + esc(a.label) + ' of ' + esc(f.name) + '" data-set="' + a.id + '" title="Change the ' + esc(a.label) + ' of this file">' + a.values.map(function (v) { return '<option' + (v === f.axes[a.id] ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '<option value="">None (remove from this axis)</option></select>' +
          '<span class="where' + (face ? '' : ' hidden') + '" title="' + (face ? 'Shown on the ' + FACE_LABEL[face] + ' face' : 'This axis is not on the cube right now') + '">' + (face ? FACE_LABEL[face] : 'hidden') + '</span></div>';
      }).join('');
      var act = '<div>' + avatar(f.owner, 20) + '<span><b>' + esc(owner.name.split(' ')[0]) + '</b> ' + (f.kind === 'sig' ? 'sent for signature' : 'uploaded this file') + '</span><time>' + esc(f.modified.replace(/^Today, /, '')) + '</time></div>' +
        (f.axes.client ? '<div>' + avatar('Rosa', 20) + '<span><b>Rosa</b> set Client to ' + esc(f.axes.client) + '</span><time>Aug 28</time></div>' : '') +
        (f.axes.project ? '<div>' + avatar('Justin', 20) + '<span><b>Justin</b> filed it under ' + esc(f.axes.project) + '</span><time>Aug 14</time></div>' : '');
      inspEl.innerHTML = '<div class="ih"><svg class="ic"><use href="#i-cube"/></svg>File<button class="ib" type="button" data-close title="Clear selection (Esc)" aria-label="Clear selection"><svg class="ic"><use href="#i-x"/></svg></button></div>' +
        '<div class="prev ' + thClass(f) + '"></div>' +
        '<h3>' + esc(f.name) + '<span class="pill ac" title="' + shownCount + ' of the ' + setAxes.length + ' axes this file has a value on are on the cube">' + shownCount + ' of 3 faces</span></h3>' +
        '<div class="meta"><span>Kind</span><b>' + esc(kind.label) + ' · ' + esc(f.size) + '</b><span>Owner</span><b>' + avatar(f.owner, 18) + esc(owner.name) + '</b><span>Modified</span><b>' + esc(f.modified) + '</b><span>Folder</span><b style="display:block"><span class="location" style="font-size:12.5px">' + f.path.split('/').map(esc).join('<svg class="ic chv"><use href="#i-chevr"/></svg>') + '</span></b></div>' +
        '<div class="sec-h">Where it sits<span class="cnt">· ' + setAxes.length + ' of 5 axes · ' + shownCount + ' shown</span></div>' +
        '<div class="homes" id="homes">' + homes + (unset.length ? '<button class="home add" type="button" id="add-axis" title="Give this file a value on an axis it is not on yet"><svg class="ic"><use href="#i-plus"/></svg>Set a value on another axis<span class="cnt" style="margin-left:auto;color:var(--dim);font-size:12px">' + unset.map(function (a) { return a.label; }).join(', ') + '</span></button>' : '') + '</div>' +
        '<div class="bothviews"><b>In Ledger</b> this file has one address: ' + f.path.split('/').map(esc).join(' › ') + '. Its other ' + Math.max(0, setAxes.length - 1) + ' groupings are tags there, not places. <button class="btn sm" type="button" data-goto="ledger" style="margin-top:8px"><svg class="ic"><use href="#i-cols"/></svg>Show in Ledger</button></div>' +
        '<div class="sec-h">Activity</div><div class="act-list">' + act + '</div>';
    }
  }
  inspEl.addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-set]');
    if (!sel || !state.selected) return;
    setAxis(state.selected, sel.getAttribute('data-set'), sel.value || null);
  });
  inspEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { select(null); return; }
    var g = e.target.closest('[data-goto]'); if (g) { setView(g.getAttribute('data-goto')); return; }
    var add = e.target.closest('#add-axis');
    if (add && state.selected) {
      var f = filesById[state.selected];
      var unset = D.axes.filter(function (a) { return !f.axes[a.id]; });
      openMenu(add, '<div class="mh">Set a value on…</div>' + unset.map(function (a) { return '<button type="button" data-act="' + a.id + '"><span class="dot" style="--c:' + a.color + '"></span>' + esc(a.label) + '<small>' + (faceOf(a.id) ? FACE_LABEL[faceOf(a.id)] + ' face' : 'hidden') + '</small></button>'; }).join(''), function (axisId) {
        // add a pending row with a "Choose…" select
        var a = axesById[axisId];
        var row = document.createElement('div');
        row.className = 'home'; row.style.setProperty('--c', a.color); row.setAttribute('data-axis', a.id);
        row.innerHTML = '<span class="axn"><span class="dot"></span>' + esc(a.label) + '</span><select aria-label="' + esc(a.label) + ' of ' + esc(f.name) + '" data-set="' + a.id + '"><option value="" selected disabled>Choose…</option>' + a.values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('') + '</select><span class="where' + (faceOf(a.id) ? '' : ' hidden') + '">' + (faceOf(a.id) ? FACE_LABEL[faceOf(a.id)] : 'hidden') + '</span>';
        add.parentNode.insertBefore(row, add);
        $('select', row).focus();
      });
    }
  });

  /* ---- status bar ---- */
  function renderStatus() {
    var sel = state.selected ? filesById[state.selected] : null, h;
    if (state.view === 'ledger') {
      var node = nodeAt(state.ledgerPath) || tree;
      h = '<b>' + countItems(node) + ' item' + (countItems(node) === 1 ? '' : 's') + '</b> in ' + esc(node.name) + (sel ? '<span class="sep">·</span>' + esc(sel.name) + ' selected' : '') + '<span class="r"><span class="keys"><span><span class="kbd">↑↓</span>move</span><span><span class="kbd">←→</span>folders</span><span><span class="kbd">L</span>Facet</span></span><span class="sync"><i></i>Synced</span></span>';
    } else {
      var n = state.query ? D.files.filter(matches).length : D.files.length;
      h = '<b>' + (state.query ? n + ' of ' + D.files.length + ' files match' : D.files.length + ' files') + '</b><span class="sep">·</span>' + FACES.map(function (f) { return esc(axesById[state.faces[f]].label); }).join(' × ') + ' on the cube<span class="sep">·</span>' + hiddenAxes().length + ' hidden ax' + (hiddenAxes().length === 1 ? 'is' : 'es') +
        (state.flat ? '<span class="sep">·</span>Flat' : (state.snap === 'iso' ? '' : '<span class="sep">·</span>' + (state.snap === 'free' ? 'Free angle' : FACE_LABEL[state.snap] + ' face square-on'))) +
        (sel ? '<span class="sep">·</span>' + esc(sel.name) + ' selected' : '') +
        '<span class="r"><span class="keys"><span><span class="kbd">1 2 3</span>faces</span><span><span class="kbd">0</span>reset</span><span><span class="kbd">F</span>flat</span><span><span class="kbd">L</span>Ledger</span><span><span class="kbd">?</span>tour</span></span><span class="sync"><i></i>Synced</span></span>';
    }
    $('#sbar').innerHTML = h;
  }

  /* ---- callouts (demo explanations) ---- */
  function callout(where, title, body) {
    var el = $(where === 'ledger' ? '#ledger-callout' : '#callout');
    el.innerHTML = '<div><b>' + title + '</b>' + body + '</div><button class="ib" type="button" data-dismiss title="Dismiss" aria-label="Dismiss"><svg class="ic"><use href="#i-x"/></svg></button>';
    el.hidden = false;
    el.onclick = function (e) { if (e.target.closest('[data-dismiss]')) el.hidden = true; };
  }
  function hideCallouts() { $('#callout').hidden = true; $('#ledger-callout').hidden = true; $$('.spot').forEach(function (n) { n.classList.remove('spot'); }); }

  /* ---- compare drawer + demos ---- */
  var drawerEl = $('#compare'), compareBtn = $('#compare-btn');
  function openCompare(v) {
    var next = typeof v === 'boolean' ? v : !state.compare;
    state.compare = next; drawerEl.hidden = !next; compareBtn.setAttribute('aria-expanded', String(next));
    if (next) drawerEl.scrollTop = 0;
    emit('compare', { open: next });
  }
  compareBtn.addEventListener('click', function () { openCompare(); });
  $('#compare-close').addEventListener('click', function () { openCompare(false); });
  drawerEl.addEventListener('click', function (e) { var b = e.target.closest('[data-demo]'); if (b) demo(b.getAttribute('data-demo')); });
  function demo(which) {
    var acme = D.files.filter(function (f) { return f.axes.client === 'Acme'; });
    var byFolder = {}; acme.forEach(function (f) { byFolder[f.path] = (byFolder[f.path] || 0) + 1; });
    var folders = Object.keys(byFolder);
    if (which === 'ledger') {
      openCompare(false);
      setView('ledger');
      state.ledgerPath = ['Clients', 'Acme']; state.selected = null; renderLedger(); renderInspector(); applySelection(false);
      $$('.mrow[data-file]', $('#cols')).forEach(function (r) { var f = filesById[r.getAttribute('data-file')]; if (f && f.axes.client === 'Acme') r.classList.add('spot'); });
      var others = folders.filter(function (p) { return p !== 'Clients/Acme'; }).map(function (p) { return '<b>' + esc(p.split('/').join(' › ')) + '</b> (' + byFolder[p] + ')'; });
      callout('ledger', 'One folder at a time', 'Clients › Acme holds <b>' + byFolder['Clients/Acme'] + ' of ' + acme.length + '</b> Acme files. The rest were filed by what they are, not who they are for: ' + others.join(', ') + '. Each is a separate trip, or a search.');
    } else {
      openCompare(false);
      setView('facet');
      if (state.flat) toggleFlat(false, true);
      var face = faceOf('client');
      var go = function () {
        snap(face || 'right');
        setTimeout(function () {
          var el = faceEls[faceOf('client')], grp = $('.grp[data-group="Acme"]', el), fb = $('.fb', el);
          if (grp && fb) { fb.scrollTo({ top: Math.max(0, grp.offsetTop - 8), behavior: reduced ? 'auto' : 'smooth' }); grp.classList.add('spot'); }
          callout('facet', 'One group, ' + acme.length + ' files, ' + folders.length + ' folders', 'The Client face lists every Acme file whatever folder it was saved in: SOW, MSA, NDA, DPA, decks and notes together. Click any of them to see its other homes light up on the other faces.');
        }, 520);
      };
      if (!face) { showAxis('client', 'right', { silent: true }); setTimeout(go, 260); } else go();
    }
    emit('demo', { which: which });
  }

  /* ---- theme ---- */
  var themeBtn = $('#theme-btn');
  function setTheme(t) {
    state.theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    var toLight = state.theme === 'dark';
    themeBtn.innerHTML = '<svg class="ic"><use href="#' + (toLight ? 'i-sun' : 'i-moon') + '"/></svg>';
    themeBtn.title = 'Switch to ' + (toLight ? 'light' : 'dark') + ' theme';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    try { localStorage.setItem('facet.theme', state.theme); } catch (e) { /* ignore */ }
    emit('theme', { theme: state.theme });
  }
  themeBtn.addEventListener('click', function () { setTheme(state.theme === 'dark' ? 'light' : 'dark'); });

  /* ---- saved angles, sidebar ---- */
  $$('[data-angle]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var which = a.getAttribute('data-angle');
      if (state.view !== 'facet') setView('facet');
      if (state.flat) toggleFlat(false, true);
      if (which === 'legal') { setFaces({ front: 'type', right: 'client', top: 'quarter' }); snap('front'); setTimeout(function () { var g = $('.face.front .grp[data-group="Contract"]'); if (g) { g.classList.add('spot'); $('.face.front .fb').scrollTo({ top: g.offsetTop - 8 }); } }, 500); }
      else if (which === 'client-quarter') { setFaces({ front: 'client', right: 'quarter', top: 'type' }); snap('iso'); }
      else if (which === 'people') { setFaces({ front: 'person', right: 'project', top: 'type' }); snap('iso'); }
      $$('[data-angle]').forEach(function (n) { n.classList.toggle('on', n === a); });
    });
  });
  $('#sb-toggle').addEventListener('click', function () { appEl.classList.toggle('sb-open'); setTimeout(layoutCube, 50); });
  $$('.sb .nav a:not([data-angle])').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); }); });

  /* ---- keyboard ---- */
  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
    if (e.key === 'Escape') {
      if (!menuEl.hidden) { closeMenu(); return; }
      if (state.compare) { openCompare(false); return; }
      if (!$('#callout').hidden || !$('#ledger-callout').hidden) { hideCallouts(); return; }
      if (typing) return;
      if (state.selected) { select(null); return; }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '1': if (state.view === 'facet') { e.preventDefault(); snap('front'); } break;
      case '2': if (state.view === 'facet') { e.preventDefault(); snap('right'); } break;
      case '3': if (state.view === 'facet') { e.preventDefault(); snap('top'); } break;
      case '0': if (state.view === 'facet') { e.preventDefault(); snap('iso'); } break;
      case 'f': case 'F': if (state.view === 'facet') { e.preventDefault(); toggleFlat(); } break;
      case 'l': case 'L': e.preventDefault(); setView(state.view === 'facet' ? 'ledger' : 'facet'); break;
      case '/': e.preventDefault(); $('#search').focus(); break;
      case 'c': case 'C': e.preventDefault(); openCompare(); break;
      case 'z': case 'Z': e.preventDefault(); undo(); break;
      case '?': e.preventDefault(); if (window.FacetTour) window.FacetTour.toggle(); break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        if (state.view === 'ledger') { if (ledgerKey(e.key)) e.preventDefault(); break; }
        if (state.flat) break;
        e.preventDefault();
        rotateBy(e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0, e.key === 'ArrowUp' ? 8 : e.key === 'ArrowDown' ? -8 : 0, true);
        break;
    }
  });

  /* ---- resize ---- */
  var ro = new ResizeObserver(function () { layoutCube(); markConn(300); });
  ro.observe(stageEl);
  window.addEventListener('resize', function () { markConn(300); });

  /* ---- boot ---- */
  var storedTheme = null; try { storedTheme = localStorage.getItem('facet.theme'); } catch (e) { /* ignore */ }
  setTheme(storedTheme || 'dark');
  renderFaces();
  layoutCube();
  setRotation(ISO.rx, ISO.ry, false, 'iso');
  $('#nav-all-count').textContent = D.files.length;
  renderInspector();
  renderStatus();
  renderLedger();
  cubeEl.classList.add('animating');

  window.Facet = {
    state: state, data: D, on: on, off: off,
    select: select, snap: snap, rotateBy: rotateBy, setAxis: setAxis, showAxis: showAxis, setFaces: setFaces,
    toggleFlat: toggleFlat, setView: setView, openCompare: openCompare, demo: demo, setTheme: setTheme, undo: undo,
    faceOf: faceOf, hiddenAxes: hiddenAxes, layout: layoutCube, drawConnectors: drawConnectors, toast: toast
  };
})();
