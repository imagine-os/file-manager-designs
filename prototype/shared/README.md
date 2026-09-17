# prototype/shared — the foundation for the "beyond the cube" prototypes

Everything the Tesseract, Polyhedron and Nested prototypes have in common lives
here, so the same 25 Northwind files behave the same everywhere and the pages
look like one product. Facet (`prototype/facet/`) keeps its own copies and is
untouched apart from the strip at the top.

```
data.js        the dataset: 25 files, 12 axes, a history per file over 2026 Q1–Q4, helpers   (ES module)
cube.js        createCube(stageEl, options): the cube engine from Facet as a factory             (ES module)
cube.css       styles the engine needs (.cube-stage .cube .face .row .tiles .connectors .cube-tools)
chrome.css     the Northwind chrome: tokens, app grid, sidebar, top bar, buttons, chips, inspector,
               toast, callout, status bar, popover menu, drawer shell, tour panel, light/dark, responsive
tour.js        createTour(options): the floating, draggable, never-modal tour, generic            (ES module)
icons.js       injects the icon sprite (#i-cube, #i-reset, #i-grip …) once into <body>          (ES module)
proto-nav.css  the strip above each app ("Prototypes: Facet · Tesseract · Polyhedron · Nested")
proto-nav.js   fills the strip, the About popover, the [ and ] keys                              (classic script)
```

The class names each CSS file provides are listed in a comment at the top of
that file. All paths are relative; nothing here needs a build step or a server
(the pages run from `file://` too), and there are no dependencies.

## Starting a new prototype

`prototype/tesseract/`, `prototype/polyhedron/` and `prototype/nested/` were
each started from the skeleton below: shared chrome, one shared cube over the
shared data, chips, an inspector, status bar, theme toggle, a tour and the
strip. A new prototype starts the same way. Keep the ids the skeleton uses for
the shared pieces (`#proto-nav`, `#about`, `#tut`, `#tut-ring`, `#tour-btn`,
`#theme-btn`) so the strip and the tour keep working.

### Page skeleton

```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tesseract prototype · Northwind files</title>
<meta name="color-scheme" content="dark light">
<link rel="stylesheet" href="../shared/chrome.css">     <!-- tokens + chrome, first -->
<link rel="stylesheet" href="../shared/cube.css">       <!-- if the page hosts cubes -->
<link rel="stylesheet" href="../shared/proto-nav.css">  <!-- the strip; sets --proto-nav-h -->
<link rel="stylesheet" href="app.css">                  <!-- only what this prototype adds -->
</head>
<body>
<nav class="pnav" id="proto-nav" data-proto="tesseract"></nav>   <!-- must precede .app -->
<template id="about"><p>What this prototype adds and how to drive it (shown by "About this prototype").</p></template>

<div class="app" id="app" style="--ac:#22d3ee">          <!-- sidebar | main | inspector grid -->
  <aside class="sb" id="sidebar">…</aside>
  <main class="mn">
    <header class="tb">… <button class="btn" id="tour-btn">Tour</button> <button class="ib" id="theme-btn">…</button></header>
    <section class="stage" id="stage">
      <div class="chips" id="chips">…</div>
      <div id="cube-stage"></div>                       <!-- createCube() mounts here -->
      <div class="toast" id="toast" hidden role="status"></div>
    </section>
    <footer class="sbar" id="sbar"></footer>
  </main>
  <aside class="insp" id="inspector"></aside>
</div>

<aside class="tut" id="tut" hidden role="dialog" aria-modal="false" aria-label="Guided tour"></aside>
<div class="tut-ring" id="tut-ring" hidden aria-hidden="true"></div>

<script type="module" src="app.js"></script>
<script src="../shared/proto-nav.js"></script>
</body>
</html>
```

`.app` uses `height:100%` in chrome.css; proto-nav.css shortens any `.app`
that follows the strip to `calc(100vh - var(--proto-nav-h))`, so the page
never scrolls. Do not put the strip inside the app's top bar.

### app.js

```js
import '../shared/icons.js';                                     // sprite for <use href="#i-…">
import data, { files, axes, kinds, people, filesAt, diff, groupBy, QUARTERS, NOW } from '../shared/data.js';
import { createCube, esc } from '../shared/cube.js';
import { createTour } from '../shared/tour.js';

const cube = createCube(document.getElementById('cube-stage'), {
  files, axes, kinds,
  faces: { front: 'project', right: 'client', top: 'type' },
  controls: true,            // Front / Right / Top / Reset toolbar in the stage
  keys: true                 // 1 2 3 0 and arrows (only for a single-cube page)
});
cube.on('select', ({ id, file }) => { /* render the inspector */ });
cube.on('groupOpen', ({ axis, value, files }) => { /* Nested: open a child cube */ });

// change a fact about a file, then re-render the face that shows that axis with a FLIP animation
file.axes.project = 'Legal';
cube.update('project', file.id);

// time travel (Tesseract): swap the dataset for another quarter's snapshot
cube.setFiles(filesAt('2026-Q2'));
const changes = diff('2026-Q2', '2026-Q3');   // { added, removed, archived, changed:[{id, axis, from, to}] }

// many cubes (Nested): every createCube() is independent; destroy() removes one
const child = createCube(childStageEl, { files: cube.groupsFor('client').find(g => g.value === 'Acme').files, axes, kinds, faces: { front: 'type', right: 'quarter', top: 'person' }, controls: false });

const tour = createTour({
  key: 'tesseract',                     // localStorage: tesseract.tour.pos / tesseract.tour.seen
  on: cube.on, off: cube.off,           // any bus with on(event, fn) / off(event, fn)
  button: '#tour-btn',
  steps: [
    { title: 'Read-only step', body: 'HTML', target: '#cube-stage' },
    { title: 'Action step', body: '…', target: '.cube-tools', event: 'snap', task: 'Press Right',
      check: d => d.face === 'right', doit: () => cube.snap('right') },
  ]
});
```

`data.js` also mirrors itself on `window.SHARED_DATA`; every prototype exposes
`window.Proto = { cube, tour, state, … }` for tests, the way Facet exposes
`window.Facet`. Keep that habit: tests drive the page through it.

### The strip

`proto-nav.js` finds `#proto-nav` (or creates one before `.app`), highlights
the current prototype from `data-proto` (or the URL), links `../facet/`,
`../tesseract/`, `../polyhedron/`, `../nested/` and `../../index.html`, renders
`<template id="about">` in a popover behind "About this prototype", and binds
`[` / `]` to move between prototypes (ignored while typing). It exposes
`window.ProtoNav = { list, current, go(slug), prev(), next(), about(open) }`.

### Data at a glance

- `axes` (12): `project client type quarter person` (Facet's five, `coreAxes`) then
  `status owner shared size modified format starred` (`extraAxes`). Every file has
  a value on each extra axis; core axes may be missing (the file is in that
  axis's "none" group, labelled by `axis.none`).
- `files` is today's snapshot (`filesAt(NOW)`, `NOW = '2026-Q3'`) and equals
  Facet's 25 files on the five core axes. `baseline` holds the raw records with
  `created`, optional `archived`, and `history: [{ at, changes }]`.
- `filesAt(q)` → 22 files in Q1, 23 in Q2, 25 in Q3 and Q4 (two archived in Q4,
  `archivedAt` set and Status = Archived; pass `{ dropArchived: true }` to omit them).
- `groupBy(files, axis)` → `[{ value, label, files }]` in axis order plus a trailing
  none group; `valuesFor(axis)`, `quarterLabel('2026-Q3') → 'Q3 2026'`.

## Rules

1. **Do not edit `prototype/facet/`** beyond its strip, and do not edit the
   shared files in a way that changes Facet's or another prototype's behaviour;
   add options instead. `data.js` must stay a superset of Facet's `data.js`.
2. **Each prototype has its own end-to-end test** under `tools/`, named
   `proto-check-<slug>.mjs` (e.g. `tools/proto-check-tesseract.mjs`), built like
   `tools/proto-check.mjs`: serve the repo with `tools/lib.mjs`, open the page at
   1440×900 and 1200×800, fail on console errors / failed requests / page
   overflow, drive every feature through `window.Proto`, and write
   `shots/<slug>-proto-*.png`. `node tools/proto-check-<slug>.mjs` must pass
   before the prototype ships, and `node tools/check.mjs` must stay green.
3. **Hero shot.** The check script writes `shots/proto-<slug>.png`, a 1440×900 capture
   at @2x (2880×1800), plus `shots/proto-<slug>-*.png` details. The hub
   (`prototype/index.html`) and the portfolio banner use 720px-wide thumbnails
   `shots/thumb-proto-<slug>.png` made from the hero (canvas downscale, as in
   `tools/screenshot.mjs`); regenerate the thumbnail whenever the hero changes.
4. Relative paths only, no dependencies, no build step; dark by default with the
   `[data-theme="light"]` tokens honoured; `prefers-reduced-motion` respected
   (the shared modules already do); every icon button has a `title`.
