/* ==========================================================================
   prototype/shared/proto-nav.js — the "Prototypes:" strip above each app.
   Classic script (no module needed), so it also drops into Facet's page.

     <link rel="stylesheet" href="../shared/proto-nav.css">
     <nav class="pnav" id="proto-nav" data-proto="tesseract"></nav>   ← before .app
     <template id="about"> …HTML shown by "About this prototype"… </template>
     <script src="../shared/proto-nav.js" defer></script>

   - Renders: "Prototypes:" · Facet · Tesseract · Polyhedron · Nested (the
     current one highlighted, found from data-proto or the URL) · About this
     prototype (popover filled from <template id="about">; hidden when there
     is no template) · ← Portfolio.
   - Keys: [ and ] go to the previous / next prototype (ignored while typing).
   - Escape closes the popover.
   - window.ProtoNav = { list, current, go(slug), prev(), next(), about(open) }.
   ========================================================================== */
(function () {
  'use strict';
  var LIST = [
    { slug: 'facet',      name: 'Facet',      color: '#34d399', href: '../facet/' },
    { slug: 'tesseract',  name: 'Tesseract',  color: '#22d3ee', href: '../tesseract/' },
    { slug: 'polyhedron', name: 'Polyhedron', color: '#8b7cf6', href: '../polyhedron/' },
    { slug: 'nested',     name: 'Nested',     color: '#f5b544', href: '../nested/' }
  ];
  var nav = document.getElementById('proto-nav') || document.querySelector('.pnav');
  if (!nav) {
    nav = document.createElement('nav'); nav.className = 'pnav'; nav.id = 'proto-nav';
    var app = document.querySelector('.app');
    if (app && app.parentNode) app.parentNode.insertBefore(nav, app); else document.body.insertBefore(nav, document.body.firstChild);
  }
  nav.classList.add('pnav');
  nav.setAttribute('aria-label', 'Prototypes');

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fromUrl = (location.pathname.match(/\/prototype\/([a-z-]+)\//) || [])[1];
  var currentSlug = nav.getAttribute('data-proto') || document.documentElement.getAttribute('data-proto') || document.body.getAttribute('data-proto') || fromUrl || '';
  var idx = -1;
  LIST.forEach(function (p, i) { if (p.slug === currentSlug) idx = i; });
  var current = idx >= 0 ? LIST[idx] : null;
  var tpl = document.getElementById('about');

  nav.innerHTML = '<span class="pnav-l">Prototypes</span><span class="pnav-pills" role="list">' +
    LIST.map(function (p, i) {
      var cur = i === idx;
      return '<a class="pnav-pill" role="listitem" href="' + p.href + '" style="--c:' + p.color + '"' + (cur ? ' aria-current="page"' : '') + ' title="' + esc(p.name) + (cur ? ' (this prototype)' : idx >= 0 && i === idx - 1 ? ' · [' : idx >= 0 && i === idx + 1 ? ' · ]' : '') + '"><i></i>' + esc(p.name) + (idx >= 0 && i === idx - 1 ? '<kbd>[</kbd>' : idx >= 0 && i === idx + 1 ? '<kbd>]</kbd>' : '') + '</a>';
    }).join('') + '</span>' +
    '<span class="pnav-grow"></span>' +
    (tpl ? '<button class="pnav-about" type="button" id="pnav-about" aria-expanded="false" aria-controls="pnav-pop" title="What this prototype adds, and how to drive it"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.2"/></svg><span>About this prototype</span></button><span class="pnav-sep"></span>' : '') +
    '<a class="pnav-back" href="../../index.html" title="Back to the design portfolio">&larr; Portfolio</a>';

  /* ---- popover ---- */
  var pop = null, aboutBtn = document.getElementById('pnav-about');
  function about(open) {
    if (!tpl) return;
    var show = typeof open === 'boolean' ? open : !(pop && !pop.hidden);
    if (!pop) {
      pop = document.createElement('div'); pop.className = 'pnav-pop'; pop.id = 'pnav-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'About this prototype'); pop.hidden = true;
      pop.innerHTML = '<div class="pnav-pop-h"><div><span class="pnav-eyebrow">About this prototype</span><h2>' + (current ? esc(current.name) : esc(document.title)) + '</h2></div><button class="pnav-pop-x" type="button" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg></button></div>';
      pop.appendChild(tpl.content.cloneNode(true));
      var keys = document.createElement('div'); keys.className = 'pnav-keys';
      keys.innerHTML = '<span><kbd>[</kbd><kbd>]</kbd> other prototypes</span><span><kbd>Esc</kbd> close</span>';
      pop.appendChild(keys);
      document.body.appendChild(pop);
      pop.addEventListener('click', function (e) { if (e.target.closest('.pnav-pop-x')) about(false); });
    }
    pop.hidden = !show;
    if (aboutBtn) aboutBtn.setAttribute('aria-expanded', String(show));
    if (show) { var x = pop.querySelector('.pnav-pop-x'); if (x) x.focus({ preventScroll: true }); }
  }
  if (aboutBtn) aboutBtn.addEventListener('click', function () { about(); });
  document.addEventListener('pointerdown', function (e) { if (pop && !pop.hidden && !e.target.closest('#pnav-pop, #pnav-about')) about(false); });

  /* ---- keys ---- */
  function go(slug) { var p = LIST.filter(function (x) { return x.slug === slug; })[0]; if (p) location.href = p.href; }
  function prev() { if (idx >= 0) go(LIST[(idx - 1 + LIST.length) % LIST.length].slug); else go(LIST[LIST.length - 1].slug); }
  function next() { if (idx >= 0) go(LIST[(idx + 1) % LIST.length].slug); else go(LIST[0].slug); }
  document.addEventListener('keydown', function (e) {
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '[') { e.preventDefault(); prev(); }
    else if (e.key === ']') { e.preventDefault(); next(); }
    else if (e.key === 'Escape' && pop && !pop.hidden) { e.preventDefault(); e.stopPropagation(); about(false); }
  }, true);

  window.ProtoNav = { list: LIST, current: current, go: go, prev: prev, next: next, about: about, el: nav };
})();
