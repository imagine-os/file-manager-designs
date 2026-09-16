/* ==========================================================================
   nav.js — shared navigation for every page.

   Reads the design list from designs/manifest.json (fetch), falling back to
   the inline copy in <script type="application/json" id="manifest"> so the
   site also works when opened over file://. From that list it:

     - fills the "Jump to" <select> (grouped by collection),
     - wires the prev / next buttons in the nav bar and the bottom pager
       (wrapping within the current design's collection),
     - writes the "n / total" position indicator,
     - handles keyboard shortcuts: ← / → prev / next, Esc or G to the
       gallery, ? toggles the shortcut hint,
     - keeps the 1440×900 .screen scaled to its .viewport (--s).

   A design page identifies itself with <html data-slug="…">. The gallery
   (index.html) has no data-slug and only gets the Jump-to menu and keys.
   Site root is found from the <script src> so the same file works from
   index.html and from designs/*.html. No dependencies.
   ========================================================================== */
(function () {
  'use strict';

  var script = document.currentScript || document.querySelector('script[src$="nav.js"]');
  var ROOT = script ? script.getAttribute('src').replace(/assets\/nav\.js(\?.*)?$/, '') : '';
  var slug = document.documentElement.getAttribute('data-slug') || null;
  var COLLECTIONS = { innovative: 'Innovative', classic: 'Classic' };

  function href(path) { return ROOT + path; }
  function designHref(d) { return href('designs/' + d.slug + '.html'); }

  /* ---- manifest loading: fetch, then inline fallback ---- */
  function inlineManifest() {
    var el = document.getElementById('manifest');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }
  function loadManifest() {
    var inline = inlineManifest();
    if (location.protocol === 'file:' || typeof fetch !== 'function') {
      return Promise.resolve(inline || []);
    }
    return fetch(href('designs/manifest.json'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return inline || []; });
  }

  /* ---- nav wiring ---- */
  function el(sel) { return document.querySelector(sel); }

  function fillJump(list, current) {
    var sel = el('select.jump');
    if (!sel) return;
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = ''; first.textContent = 'Jump to…'; first.disabled = true;
    if (!current) first.selected = true;
    sel.appendChild(first);
    var home = document.createElement('option');
    home.value = href('index.html'); home.textContent = 'Gallery';
    sel.appendChild(home);
    Object.keys(COLLECTIONS).forEach(function (key) {
      var items = list.filter(function (d) { return d.collection === key; });
      if (!items.length) return;
      var g = document.createElement('optgroup');
      g.label = COLLECTIONS[key];
      items.forEach(function (d) {
        var o = document.createElement('option');
        o.value = designHref(d);
        o.textContent = d.number + '  ' + d.name;
        if (current && d.slug === current.slug) o.selected = true;
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
    sel.addEventListener('change', function () { if (sel.value) location.href = sel.value; });
  }

  function setLink(node, d, label) {
    if (!node) return;
    if (!d) { node.setAttribute('hidden', ''); return; }
    node.removeAttribute('hidden');
    node.href = designHref(d);
    node.title = label + ': ' + d.name;
    var nm = node.querySelector('.pn-name, b');
    if (nm) nm.textContent = d.name;
  }

  function wire(list) {
    var current = slug ? list.filter(function (d) { return d.slug === slug; })[0] : null;
    fillJump(list, current);

    var collLinks = document.querySelectorAll('.coll a[data-collection]');
    Array.prototype.forEach.call(collLinks, function (a) {
      a.setAttribute('aria-current', current && a.getAttribute('data-collection') === current.collection ? 'true' : 'false');
    });

    if (!current) return { list: list };

    var siblings = list.filter(function (d) { return d.collection === current.collection; });
    var i = siblings.indexOf(current);
    var prev = siblings[(i - 1 + siblings.length) % siblings.length];
    var next = siblings[(i + 1) % siblings.length];
    if (siblings.length < 2) { prev = null; next = null; }

    Array.prototype.forEach.call(document.querySelectorAll('[data-nav="prev"]'), function (n) { setLink(n, prev, 'Previous'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav="next"]'), function (n) { setLink(n, next, 'Next'); });
    var pos = el('.pos');
    if (pos) pos.innerHTML = '<b>' + (i + 1) + '</b> / ' + siblings.length;
    document.title = current.name + ' · File Manager Design Portfolio';
    return { list: list, current: current, prev: prev, next: next };
  }

  /* ---- keyboard ---- */
  function keys(state) {
    var hint = el('.shortcuts');
    var btn = el('.hint-btn');
    function toggleHint(force) {
      if (!hint) return;
      var show = typeof force === 'boolean' ? force : hint.hasAttribute('hidden');
      if (show) hint.removeAttribute('hidden'); else hint.setAttribute('hidden', '');
      if (btn) btn.setAttribute('aria-expanded', String(show));
    }
    if (btn) btn.addEventListener('click', function () { toggleHint(); });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft':
          if (state.prev) { e.preventDefault(); location.href = designHref(state.prev); }
          break;
        case 'ArrowRight':
          if (state.next) { e.preventDefault(); location.href = designHref(state.next); }
          break;
        case 'Escape':
          if (hint && !hint.hasAttribute('hidden')) { toggleHint(false); break; }
          if (slug) location.href = href('index.html');
          break;
        case 'g': case 'G':
          if (slug) location.href = href('index.html');
          break;
        case '?':
          e.preventDefault(); toggleHint();
          break;
      }
    });
  }

  /* ---- screen scaling: .screen is 1440 wide, scale to its .viewport ---- */
  function fitScreens() {
    var vps = document.querySelectorAll('.viewport');
    function fit(v) {
      var s = v.querySelector('.screen');
      var w = v.getBoundingClientRect().width;
      if (s && w > 0) s.style.setProperty('--s', (w / 1440).toFixed(4));
    }
    Array.prototype.forEach.call(vps, fit);
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function (entries) { entries.forEach(function (en) { fit(en.target); }); });
      Array.prototype.forEach.call(vps, function (v) { ro.observe(v); });
    } else {
      window.addEventListener('resize', function () { Array.prototype.forEach.call(vps, fit); });
    }
  }

  fitScreens();
  loadManifest().then(function (list) { keys(wire(list || [])); });
})();
