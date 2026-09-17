/* tutorial.js — floating, draggable, never-modal guided tour for the Facet prototype.
   Depends on window.Facet (app.js). Position and "seen" flag live in localStorage. */
(function () {
  'use strict';
  var F = window.Facet; if (!F) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var panel = $('#tut'), ring = $('#tut-ring');
  var KEY_POS = 'facet.tour.pos', KEY_SEEN = 'facet.tour.seen';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function svgIllo(which) {
    var stroke = 'stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"';
    if (which === 'tesseract') {
      return '<svg viewBox="0 0 64 56" ' + stroke + ' aria-hidden="true"><g opacity=".35"><path d="M8 20l12-8h20l-12 8z"/><path d="M8 20v18l12 8V28z"/><path d="M20 28l20-8v18l-20 8z"/></g><g><path d="M20 14l12-8h20l-12 8z"/><path d="M20 14v18l12 8V22z"/><path d="M32 22l20-8v18l-20 8z"/></g><path d="M8 20l12-6M40 20l12-6M8 38l12-6M28 46l12-6" stroke-dasharray="2 2" opacity=".7"/><path d="M6 52h52" opacity=".5"/><circle cx="38" cy="52" r="3" fill="currentColor" stroke="none"/></svg>';
    }
    if (which === 'poly') {
      return '<svg viewBox="0 0 64 56" ' + stroke + ' aria-hidden="true"><path d="M32 4l18 8 6 18-10 18H18L8 30l6-18z"/><path d="M32 4l-6 16 6 18 6-18z"/><path d="M14 12l12 8M50 12L38 20M8 30l18 8M56 30L38 38M18 48l8-10M46 48l-8-10"/><path d="M26 20h12" opacity=".6"/><circle cx="32" cy="38" r="2" fill="currentColor" stroke="none"/></svg>';
    }
    return '<svg viewBox="0 0 64 56" ' + stroke + ' aria-hidden="true"><path d="M6 18l14-8h22l-14 8z"/><path d="M6 18v22l14 8V26z"/><path d="M20 26l22-8v22l-22 8z"/><path d="M40 10h18v14h-18z" opacity=".45"/><g transform="translate(36 30)"><path d="M4 8l6-4h10l-6 4z"/><path d="M4 8v10l6 4V12z"/><path d="M10 12l10-4v10l-10 4z"/></g><path d="M28 32l8 2" stroke-dasharray="2 2"/></svg>';
  }

  var steps = [
    { title: 'One set of files, three ways to see it', target: '#cube-stage',
      body: 'This is Facet. The <b>25 files</b> on the cube are one set. Each face groups them by a different axis: right now <b>Project</b>, <b>Client</b> and <b>Type</b>. Nothing is copied when you turn it; a rotation is just a different question about the same files.<br><br>This panel never blocks anything: drag it by its header, collapse it to a pill, or close it and press <kbd>?</kbd> to bring it back.' },
    { title: 'Drag the cube', target: '#cube-stage', event: 'drag', task: 'Drag anywhere on the stage to rotate',
      body: 'Press and drag on the stage. The cube turns with a little momentum and settles on a clean angle when you let go, so the faces stay readable. Arrow keys nudge it too.',
      doit: function () { animateDrag(); } },
    { title: 'Bring a face square-on', target: '#cube-controls', event: 'snap', task: 'Press Right, or key 2',
      body: 'The <b>Front / Right / Top</b> buttons turn one face flat toward you and enlarge it, so a grouping becomes an ordinary list. <b>Reset</b> (or <kbd>0</kbd>) goes back to the three-face view.',
      check: function (d) { return d && d.face !== 'iso'; }, doit: function () { F.snap('right'); } },
    { title: 'Select a file and watch all three faces', target: '.face.front', event: 'select', task: 'Click any file on a face',
      body: 'Click a file. It lights up on <b>every face at once</b>, with connector lines between its three positions, and the inspector on the right shows where it sits on all five axes. Hover a group name to light up its files on the other faces.',
      check: function (d) { return d && d.id; }, before: function () { F.snap('iso'); }, doit: function () { F.snap('iso'); setTimeout(function () { F.select('acme-sow-q3'); }, 500); } },
    { title: 'Move it by changing a fact', target: '#homes', event: 'axisChange', task: 'Change a value in “Where it sits”',
      body: 'In <b>Where it sits</b>, change the <b>Project</b> from Atlas to Legal. The file slides to its new group on that face. The other faces do not change, because only one fact about the file changed. Every change has an <b>Undo</b>.',
      before: function () { if (!F.state.selected) F.select('acme-sow-q3'); },
      check: function (d) { return d && !d.silent; },
      doit: function () { if (!F.state.selected) F.select('acme-sow-q3'); var f = F.state.selected; var cur = F.data.files.filter(function (x) { return x.id === f; })[0]; F.setAxis(f, 'project', cur.axes.project === 'Legal' ? 'Atlas' : 'Legal'); } },
    { title: 'Swap a hidden axis onto a face', target: '#chips-hidden', event: 'axisSwap', task: 'Put Quarter or Person on a face',
      body: 'Two axes are <b>hidden</b>: Quarter and Person. Click one and choose a face, or drag the chip onto the cube. The face re-renders around the new grouping; the files are the same.',
      doit: function () { F.showAxis('quarter', 'top'); } },
    { title: 'Flat mode: the cube is just three lists', target: '#flat-btn', event: 'flat', task: 'Turn on Flat (F)',
      body: 'Press <kbd>F</kbd> or the <b>Flat</b> button. The front face unfolds into a normal grouped list, the kind any file manager could show. That is the whole trick: the cube is three of these lists standing next to each other. Toggle it again to fold back.',
      check: function (d) { return d && d.on; }, doit: function () { F.toggleFlat(true); }, after: function () { if (F.state.flat) F.toggleFlat(false); } },
    { title: 'Same file, classic Ledger', target: '#view-seg', event: 'view', task: 'Switch to Ledger (L)',
      body: 'Switch to <b>Ledger</b>. It is the column browser you already know: every file in exactly one folder. Your selected file stays selected, so you land on the one folder the tree had to choose for it. Notice what is <i>not</i> next to it.',
      check: function (d) { return d && d.view === 'ledger'; }, doit: function () { F.setView('ledger'); } },
    { title: 'Compare the two, fairly', target: '#compare-btn', event: 'compare', task: 'Open Compare',
      body: 'The <b>Compare</b> drawer lays the two side by side: what each is good at, and where each pays. Try the live demo row, “find every Acme document”, in both views. Ledger is faster to learn and to drive by keyboard; Facet is where cross-cutting questions stop needing a search.',
      check: function (d) { return d && d.open; }, doit: function () { F.openCompare(true); } },
    { title: 'Beyond the cube', target: null, beyond: true,
      body: 'Three faces is where a 3D filing system starts, not where it ends.' }
  ];

  var idx = 0, open = false, collapsed = false, done = {}, currentHandler = null, rafId = 0, pos = null;

  function build() {
    panel.innerHTML = '<div class="tut-h" id="tut-h" title="Drag to move this panel"><svg class="ic grip"><use href="#i-grip"/></svg><b>Tour</b><span class="step" id="tut-step"></span><button class="ib" type="button" id="tut-collapse" title="Collapse to a pill" aria-label="Collapse the tour"><svg class="ic"><use href="#i-min"/></svg></button><button class="ib" type="button" id="tut-close" title="Close the tour (reopen with ?)" aria-label="Close the tour"><svg class="ic"><use href="#i-x"/></svg></button></div>' +
      '<div class="tut-b" id="tut-b"></div>' +
      '<div class="tut-f"><button class="btn sm" type="button" id="tut-back">Back</button><span class="tut-dots" id="tut-dots" aria-hidden="true"></span><button class="skip" type="button" id="tut-skip" title="Close the tour">Skip</button><button class="btn sm pri" type="button" id="tut-next">Next</button></div>';
    $('#tut-close').addEventListener('click', close);
    $('#tut-skip').addEventListener('click', close);
    $('#tut-collapse').addEventListener('click', function () { setCollapsed(!collapsed); });
    $('#tut-back').addEventListener('click', function () { go(idx - 1); });
    $('#tut-next').addEventListener('click', function () { if (idx === steps.length - 1) close(); else go(idx + 1); });
    dragify($('#tut-h'));
  }

  function render() {
    var s = steps[idx];
    $('#tut-step').textContent = (idx + 1) + ' / ' + steps.length;
    var b = $('#tut-b');
    var html = '<h2>' + s.title + '</h2><p>' + s.body + '</p>';
    if (s.event) {
      html += '<div class="tut-task' + (done[idx] ? ' done' : '') + '" id="tut-task"><span class="st"><svg class="ic"><use href="#i-check"/></svg></span><span>' + (done[idx] ? 'Done' : s.task) + '</span>' + (done[idx] ? '' : '<button class="btn sm" type="button" id="tut-doit">Do it for me</button>') + '</div>';
    }
    if (s.beyond) {
      html += '<div class="beyond">' +
        '<div class="bcard"><div style="color:var(--ac)">' + svgIllo('tesseract') + '</div><div><b>Tesseract slicing</b><span>A fourth axis, time, as a scrubber under the cube. Drag it and a whole cube slides through: the same faces show how the groupings looked in Q2, look in Q3, will look in Q4.</span></div></div>' +
        '<div class="bcard"><div style="color:#8b7cf6">' + svgIllo('poly') + '</div><div><b>Facet polyhedron</b><span>More faces than three. A dodecahedron-like solid where every face is an axis; roll it to the pair you need, and the faces you do not care about fold away behind.</span></div></div>' +
        '<div class="bcard"><div style="color:#f5b544">' + svgIllo('nested') + '</div><div><b>Nested cubes</b><span>Open a group on a face into its own smaller cube: Acme&#8217;s files as Type × Quarter × Person. Breadcrumbs become a path of cubes, so you drill down without leaving 3D.</span></div></div>' +
        '</div>';
    }
    b.innerHTML = html;
    var doit = $('#tut-doit'); if (doit) doit.addEventListener('click', function () { if (s.doit) s.doit(); });
    $('#tut-dots').innerHTML = steps.map(function (_, i) { return '<i class="' + (i === idx ? 'on' : i < idx ? 'done' : '') + '"></i>'; }).join('');
    $('#tut-back').disabled = idx === 0;
    $('#tut-back').style.visibility = idx === 0 ? 'hidden' : '';
    var next = $('#tut-next');
    next.textContent = idx === steps.length - 1 ? 'Done' : 'Next';
    next.disabled = !!(s.event && !done[idx]);
    next.title = next.disabled ? 'Complete the step first, or press “Do it for me”' : '';
    $('#tut-skip').hidden = idx === steps.length - 1;
  }

  function markDone() {
    if (done[idx]) return;
    done[idx] = true;
    var t = $('#tut-task'); if (t) { t.classList.add('done'); t.children[1].textContent = 'Done'; var d = $('#tut-doit'); if (d) d.remove(); }
    $('#tut-next').disabled = false; $('#tut-next').title = '';
    if (!reduced) setTimeout(function () { var n = $('#tut-next'); if (n && !n.disabled) n.focus({ preventScroll: true }); }, 50);
  }

  function go(i) {
    if (i < 0 || i >= steps.length) return;
    var prev = steps[idx];
    if (currentHandler) { F.off(prev.event, currentHandler); currentHandler = null; }
    if (prev.after && i > idx) prev.after();
    idx = i;
    var s = steps[idx];
    if (s.before) s.before();
    if (s.event) {
      currentHandler = function (d) { if (!s.check || s.check(d)) markDone(); };
      F.on(s.event, currentHandler);
    }
    render();
    setCollapsed(false);
    updateRing();
  }

  function updateRing() {
    var s = steps[idx];
    var t = open && !collapsed && s && s.target ? document.querySelector(s.target) : null;
    if (t && (t.offsetParent === null && getComputedStyle(t).position !== 'fixed')) t = null;
    if (!t) { ring.hidden = true; return; }
    var r = t.getBoundingClientRect();
    if (!r.width && !r.height) { ring.hidden = true; return; }
    ring.hidden = false;
    var pad = 6;
    ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
  }
  function loop() { if (open) { updateRing(); rafId = requestAnimationFrame(loop); } }

  /* ---- panel placement & dragging ---- */
  function clampPos(p) {
    var w = panel.offsetWidth || 360, h = panel.offsetHeight || 200;
    return { left: Math.max(8, Math.min(window.innerWidth - w - 8, p.left)), top: Math.max(8, Math.min(window.innerHeight - h - 8, p.top)) };
  }
  function place(p) { pos = clampPos(p); panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px'; }
  function defaultPos() { return { left: 16, top: Math.max(80, window.innerHeight - (panel.offsetHeight || 380) - 48) }; }
  function savePos() { try { localStorage.setItem(KEY_POS, JSON.stringify(pos)); } catch (e) { /* ignore */ } }
  function dragify(handle) {
    var d = null;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var r = panel.getBoundingClientRect();
      pos = { left: r.left, top: r.top };
      d = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top, id: e.pointerId };
      handle.classList.add('grabbing'); handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', function (e) { if (!d || e.pointerId !== d.id) return; place({ left: d.left + e.clientX - d.x, top: d.top + e.clientY - d.y }); });
    function up(e) { if (!d || e.pointerId !== d.id) return; d = null; handle.classList.remove('grabbing'); savePos(); }
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  }
  window.addEventListener('resize', function () { if (pos) place(pos); });

  function setCollapsed(v) {
    collapsed = !!v;
    panel.classList.toggle('collapsed', collapsed);
    var b = $('#tut-collapse');
    if (b) { b.innerHTML = '<svg class="ic"><use href="#' + (collapsed ? 'i-plus' : 'i-min') + '"/></svg>'; b.title = collapsed ? 'Expand the tour' : 'Collapse to a pill'; b.setAttribute('aria-label', b.title); }
    place(pos || defaultPos());
    updateRing();
  }

  function openTour(at) {
    if (!panel.innerHTML) build();
    open = true; panel.hidden = false; collapsed = false; panel.classList.remove('collapsed');
    var saved = null; try { saved = JSON.parse(localStorage.getItem(KEY_POS)); } catch (e) { /* ignore */ }
    place(saved && typeof saved.left === 'number' ? saved : defaultPos());
    go(typeof at === 'number' ? at : idx);
    if (!(saved && typeof saved.left === 'number')) place(defaultPos());
    cancelAnimationFrame(rafId); loop();
    try { localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* ignore */ }
    F.state.tour = true;
  }
  function close() {
    open = false; panel.hidden = true; ring.hidden = true; cancelAnimationFrame(rafId);
    if (currentHandler) { F.off(steps[idx].event, currentHandler); currentHandler = null; }
    try { localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* ignore */ }
    F.state.tour = false;
  }
  function toggle() { if (open) close(); else openTour(); }

  // scripted drag for "Do it for me" on step 2: a smooth swing and settle
  function animateDrag() {
    var start = performance.now(), dur = reduced ? 0 : 700, from = { rx: F.state.rot.rx, ry: F.state.rot.ry };
    function frame(now) {
      var t = Math.min(1, (now - start) / (dur || 1)), e = 1 - Math.pow(1 - t, 3);
      F.rotateBy((from.ry - 30 * Math.sin(e * Math.PI) - F.state.rot.ry), (from.rx - 14 * Math.sin(e * Math.PI) - F.state.rot.rx), false);
      if (t < 1) requestAnimationFrame(frame); else { F.snap('iso'); }
    }
    requestAnimationFrame(frame);
    markDone();
  }

  $('#tour-btn').addEventListener('click', function () { if (open) go(0); else openTour(0); });

  var seen = null; try { seen = localStorage.getItem(KEY_SEEN); } catch (e) { /* ignore */ }
  if (!seen && !/\bnotour\b/.test(location.search)) setTimeout(function () { openTour(0); }, 400);

  window.FacetTour = { open: openTour, close: close, toggle: toggle, go: go, get index() { return idx; }, get isOpen() { return open; }, get collapsed() { return collapsed; }, steps: steps, setCollapsed: setCollapsed, position: function () { return pos; }, doit: function () { var s = steps[idx]; if (s.doit) s.doit(); } };
})();
