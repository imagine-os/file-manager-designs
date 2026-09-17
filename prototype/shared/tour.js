/* ==========================================================================
   prototype/shared/tour.js — the floating, draggable, never-modal guided tour
   from prototype/facet/tutorial.js, made generic. ES module.

     import { createTour } from '../shared/tour.js';
     const tour = createTour({
       key: 'tesseract',                       // localStorage prefix: <key>.tour.pos / .seen
       steps: [ { title, body, target, event, task, check, before, after, doit, extra } ],
       on: bus.on, off: bus.off,               // event bus the action steps listen to
       button: '#tour-btn',                    // optional: click reopens at step 0
       autoOpen: true                          // first visit only; ?notour suppresses
     });

   STEP
     title    string (HTML allowed)         body   HTML paragraph
     target   CSS selector spotlighted by the ring (null for none)
     event    bus event name the step waits for (omit for a read-only step)
     task     short imperative shown in the task box ("Drag the cube")
     check(detail) → bool                   optional filter on the event payload
     before() / after()                     hooks when the step is entered / left forward
     doit()                                 "Do it for me" action; call tour.markDone() if
                                            the action does not emit the event itself
     extra    HTML appended under the body (e.g. the "beyond the cube" cards)

   OPTIONS
     panel / ring   elements or selectors; created and appended to <body> when absent
                    (classes .tut / .tut-ring from chrome.css, ids tut / tut-ring by default)
     title          panel header label, default 'Tour'
     nextLabel / doneLabel / doitLabel
     onOpen(index) / onClose()

   RETURNS
     open(at)  close()  toggle()  go(i)  markDone()  doit()  setCollapsed(bool)
     position() → {left, top}   index  isOpen  collapsed  steps  panel  ring  destroy()
   ========================================================================== */

export function createTour(options) {
  var o = Object.assign({ key: 'proto', title: 'Tour', nextLabel: 'Next', doneLabel: 'Done', doitLabel: 'Do it for me', autoOpen: true, steps: [] }, options || {});
  var steps = o.steps;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var KEY_POS = o.key + '.tour.pos', KEY_SEEN = o.key + '.tour.seen';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var busOn = o.on || function () {}, busOff = o.off || function () {};

  function ensure(el, cls, id, attrs) {
    if (typeof el === 'string') el = $(el);
    if (!el) el = document.getElementById(id);
    if (!el) {
      el = document.createElement(cls === 'tut-ring' ? 'div' : 'aside'); el.className = cls; el.id = id; el.hidden = true;
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      document.body.appendChild(el);
    }
    return el;
  }
  var panel = ensure(o.panel, 'tut', 'tut', { 'aria-label': 'Guided tour', role: 'dialog', 'aria-modal': 'false' });
  var ring = ensure(o.ring, 'tut-ring', 'tut-ring', { 'aria-hidden': 'true' });

  var idx = 0, open = false, collapsed = false, done = {}, currentHandler = null, rafId = 0, pos = null;
  var ico = function (name) { return '<svg class="ic"><use href="#' + name + '"/></svg>'; };

  function build() {
    panel.innerHTML = '<div class="tut-h" id="tut-h" title="Drag to move this panel">' + ico('i-grip') + '<b>' + o.title + '</b><span class="step" id="tut-step"></span><button class="ib" type="button" id="tut-collapse" title="Collapse to a pill" aria-label="Collapse the tour">' + ico('i-min') + '</button><button class="ib" type="button" id="tut-close" title="Close the tour (reopen with ?)" aria-label="Close the tour">' + ico('i-x') + '</button></div>' +
      '<div class="tut-b" id="tut-b"></div>' +
      '<div class="tut-f"><button class="btn sm" type="button" id="tut-back">Back</button><span class="tut-dots" id="tut-dots" aria-hidden="true"></span><button class="skip" type="button" id="tut-skip" title="Close the tour">Skip</button><button class="btn sm pri" type="button" id="tut-next">' + o.nextLabel + '</button></div>';
    $('#tut-close', panel).addEventListener('click', close);
    $('#tut-skip', panel).addEventListener('click', close);
    $('#tut-collapse', panel).addEventListener('click', function () { setCollapsed(!collapsed); });
    $('#tut-back', panel).addEventListener('click', function () { go(idx - 1); });
    $('#tut-next', panel).addEventListener('click', function () { if (idx === steps.length - 1) close(); else go(idx + 1); });
    dragify($('#tut-h', panel));
  }

  function render() {
    var s = steps[idx];
    $('#tut-step', panel).textContent = (idx + 1) + ' / ' + steps.length;
    var html = '<h2>' + s.title + '</h2><p>' + s.body + '</p>';
    if (s.event) {
      html += '<div class="tut-task' + (done[idx] ? ' done' : '') + '" id="tut-task"><span class="st">' + ico('i-check') + '</span><span>' + (done[idx] ? 'Done' : s.task) + '</span>' + (done[idx] || !s.doit ? '' : '<button class="btn sm" type="button" id="tut-doit">' + o.doitLabel + '</button>') + '</div>';
    }
    if (s.extra) html += s.extra;
    $('#tut-b', panel).innerHTML = html;
    var doit = $('#tut-doit', panel); if (doit) doit.addEventListener('click', function () { if (s.doit) s.doit(api); });
    $('#tut-dots', panel).innerHTML = steps.map(function (_, i) { return '<i class="' + (i === idx ? 'on' : i < idx ? 'done' : '') + '"></i>'; }).join('');
    var back = $('#tut-back', panel);
    back.disabled = idx === 0; back.style.visibility = idx === 0 ? 'hidden' : '';
    var next = $('#tut-next', panel);
    next.textContent = idx === steps.length - 1 ? o.doneLabel : o.nextLabel;
    next.disabled = !!(s.event && !done[idx]);
    next.title = next.disabled ? 'Complete the step first' + (s.doit ? ', or press “' + o.doitLabel + '”' : '') : '';
    $('#tut-skip', panel).hidden = idx === steps.length - 1;
  }

  function markDone() {
    if (done[idx]) return;
    done[idx] = true;
    var t = $('#tut-task', panel); if (t) { t.classList.add('done'); t.children[1].textContent = 'Done'; var d = $('#tut-doit', panel); if (d) d.remove(); }
    var n = $('#tut-next', panel); if (n) { n.disabled = false; n.title = ''; if (!reduced) setTimeout(function () { if (!n.disabled) n.focus({ preventScroll: true }); }, 50); }
  }

  function go(i) {
    if (i < 0 || i >= steps.length) return;
    var prev = steps[idx];
    if (currentHandler) { busOff(prev.event, currentHandler); currentHandler = null; }
    if (prev.after && i > idx) prev.after(api);
    idx = i;
    var s = steps[idx];
    if (s.before) s.before(api);
    if (s.event) {
      currentHandler = function (d) { if (!s.check || s.check(d)) markDone(); };
      busOn(s.event, currentHandler);
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

  /* ---- placement & dragging ---- */
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
  var onResize = function () { if (pos) place(pos); };
  window.addEventListener('resize', onResize);

  function setCollapsed(v) {
    collapsed = !!v;
    panel.classList.toggle('collapsed', collapsed);
    var b = $('#tut-collapse', panel);
    if (b) { b.innerHTML = ico(collapsed ? 'i-plus' : 'i-min'); b.title = collapsed ? 'Expand the tour' : 'Collapse to a pill'; b.setAttribute('aria-label', b.title); }
    place(pos || defaultPos());
    updateRing();
  }

  function openTour(at) {
    if (!steps.length) return;
    if (!panel.innerHTML) build();
    open = true; panel.hidden = false; collapsed = false; panel.classList.remove('collapsed');
    var saved = null; try { saved = JSON.parse(localStorage.getItem(KEY_POS)); } catch (e) { /* ignore */ }
    place(saved && typeof saved.left === 'number' ? saved : defaultPos());
    go(typeof at === 'number' ? at : idx);
    if (!(saved && typeof saved.left === 'number')) place(defaultPos());
    cancelAnimationFrame(rafId); loop();
    try { localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* ignore */ }
    if (o.onOpen) o.onOpen(idx);
  }
  function close() {
    open = false; panel.hidden = true; ring.hidden = true; cancelAnimationFrame(rafId);
    if (currentHandler) { busOff(steps[idx].event, currentHandler); currentHandler = null; }
    try { localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* ignore */ }
    if (o.onClose) o.onClose();
  }
  function toggle() { if (open) close(); else openTour(); }

  var btn = typeof o.button === 'string' ? $(o.button) : o.button;
  var onBtn = function () { if (open) go(0); else openTour(0); };
  if (btn) btn.addEventListener('click', onBtn);

  var seen = null; try { seen = localStorage.getItem(KEY_SEEN); } catch (e) { /* ignore */ }
  if (o.autoOpen && !seen && !/\bnotour\b/.test(location.search)) setTimeout(function () { openTour(0); }, 400);

  function destroy() { close(); window.removeEventListener('resize', onResize); if (btn) btn.removeEventListener('click', onBtn); }

  var api = {
    open: openTour, close: close, toggle: toggle, go: go, markDone: markDone, setCollapsed: setCollapsed,
    position: function () { return pos; }, doit: function () { var s = steps[idx]; if (s.doit) s.doit(api); },
    get index() { return idx; }, get isOpen() { return open; }, get collapsed() { return collapsed; },
    steps: steps, panel: panel, ring: ring, destroy: destroy
  };
  return api;
}

export default createTour;
