# Facet prototype

An interactive, high-fidelity prototype of **Facet** (design 04) with the classic
**Ledger** column browser beside it, over one shared dataset. Vanilla HTML/CSS/JS,
no build step, no dependencies, relative paths only, so it runs from GitHub Pages
under the repository sub-path or straight from disk.

Live: <https://imagine-os.github.io/file-manager-designs/prototype/facet/>

```
index.html      markup: sidebar, top bar, Facet stage (cube), Ledger stage, inspector, compare drawer, tour shell
app.css         tokens (dark default, light via [data-theme="light"]), layout, cube faces, Ledger, inspector, drawer, tour
data.js         THE dataset: 25 files, five axes (Project, Client, Type, Quarter, Person), one folder path per file
app.js          cube (rotate, snap, flatten, connectors), axis chips, inspector, search, undo, Ledger, compare, theme
tutorial.js     the floating tour: 10 steps, draggable, collapsible, waits for actions, "Do it for me"
walkthrough.webm  ~1 min screen recording (VP8) produced by tools/proto-check.mjs
```

## What it does

- **Cube.** A real CSS 3D cube (`transform-style: preserve-3d`). Drag to rotate (pointer
  events, light inertia, settles on a clean orientation). **Front / Right / Top** bring a face
  square-on and enlarge it; **Reset** returns to the three-face view. Keys `1 2 3 0`, arrows nudge.
  The top face shows groups as large tiles at the isometric angle and as rows once square-on.
- **Axes.** Three of five axes are on the cube. Click a hidden chip (or drag it onto a face) to
  swap it in; the face re-renders around the new grouping.
- **Selection.** Click a file: it lights up on all three faces with connector lines, and the
  inspector shows *Where it sits* on every axis with a dropdown per axis (including *None*) and
  *Set a value on another axis*. Changing a value slides the file to its new group. Every change
  has an Undo toast. Hovering a group lights its files up on the other faces.
- **Flat** (`F`) unfolds the front face into a normal 2D grouped list.
- **Ledger** (`L`) renders the same 25 files as Miller columns with Quick Look and a breadcrumb;
  every file appears in exactly one folder. Selection persists across the switch.
- **Compare** opens a drawer: Ledger vs Facet on finding by another attribute, multi-group files,
  learning curve, keyboard speed, predictability, duplicates and *best for*, plus a live demo
  ("find every Acme document") that runs in each view.
- **Tour** (`?`) is a floating panel: draggable by its header, collapsible to a pill, never modal,
  remembers its position, auto-opens on first visit, spotlights its target, and waits for the
  action (or does it for you).
- Light/dark toggle, `prefers-reduced-motion` honoured, tooltips on every icon button.

## Beyond the cube

Three directions the 3D system could grow, also shown on the last step of the tour:

1. **Tesseract slicing.** A fourth axis, time, as a scrubber under the cube. Dragging it slides
   a whole cube through, so the same faces show how the groupings looked in Q2, look in Q3 and
   will look in Q4.
2. **Facet polyhedron.** More faces than three: a dodecahedron-like solid where every face is an
   axis. Roll it to the pair you need; the faces you do not care about fold away behind.
3. **Nested cubes.** A group on a face opens into its own smaller cube (Acme's files as
   Type × Quarter × Person). Breadcrumbs become a path of cubes, so you drill down without
   leaving 3D.

## Testing

`node tools/proto-check.mjs` serves the repository, opens the prototype at 1440×900 and
1200×800, fails on console errors or failed requests, then drives every feature listed above
(drag, snaps, selection on three faces, axis change, axis swap, flat, Ledger sync, compare and
both demos, the whole tour with "Do it for me", panel drag/collapse, theme). It records
`walkthrough.webm` and writes `shots/facet-proto-*.png`.
