# File Manager Design Portfolio

A static portfolio of high-fidelity file-manager product screens, built as plain
HTML/CSS with no build step, no external fonts, scripts or CDNs, and published
with GitHub Pages.

- **Live site:** <https://imagine-os.github.io/file-manager-designs/> (repository `imagine-os/file-manager-designs`)
- **Gallery:** `index.html`, two collections: *Innovative* (files that live in many places) and *Classic* (conventional file managers, done well)
- **Design pages:** `designs/<slug>.html`, one per screen

Every screen is designed at 1440 × 900 inside a device frame and scaled to fit
the viewport. Open `index.html` directly from disk (file://) or serve the folder;
both work.

## Layout

```
index.html               gallery: cards for both collections + version history
designs/<slug>.html      one page per design (nav bar, device frame, description, prev/next)
designs/manifest.json    THE list of designs; nav, jump menu and tools read it
assets/screens.css       shared screen chrome: tokens, device frame, sidebar, top bar,
                         cards, inspector, thumbnails, overlays, icon sizing
assets/site.css          gallery, nav bar and design-page layout (depends on screens.css tokens)
assets/nav.js            prev/next, jump menu, position, keyboard shortcuts, screen scaling
assets/icons.svg         canonical icon sprite (each page inlines an identical copy)
shots/<slug>.png         2× capture of the device frame (2880 px wide)
shots/thumb-<slug>.png   720 px thumbnail used by the gallery cards
tools/screenshot.mjs     regenerates shots/ and thumbnails with Playwright
tools/check.mjs          site checker (console errors, 404s, links, nav, overflow, phone width)
tools/proto-check.mjs    drives the Facet prototype end to end, records the walkthrough video and shots
prototype/facet/         interactive Facet + Ledger prototype (index.html, app.css, app.js, data.js, tutorial.js)
tools/sync-manifest.mjs  copies manifest.json into every page's inline fallback
.github/workflows/pages.yml  publishes the site to the gh-pages branch on push to main
```

## Prototype

`prototype/facet/` is an interactive build of the Facet concept with the classic Ledger
browser beside it: a real CSS 3D cube over one shared dataset (`data.js`), a Miller-column
Ledger of the same files, a Compare drawer with live demos, and a draggable, never-modal
tutorial. Vanilla HTML/CSS/JS, relative paths only. Live at
<https://imagine-os.github.io/file-manager-designs/prototype/facet/>; see
`prototype/facet/README.md` for the feature list and the three "beyond the cube" directions.
`node tools/proto-check.mjs` drives every feature with Playwright, records
`prototype/facet/walkthrough.webm` and writes `shots/facet-proto-*.png`.

## Adding a design

Three things: a page, a shot, a manifest entry.

1. **Page.** Copy an existing page, e.g. `designs/orbit.html`, to `designs/<slug>.html`.
   Set `<html data-slug="<slug>">`, the `<title>`, `<meta name="description">`, the accent
   colour on `<body style="--ac:#…">`, the header (`.num`, `<h1>`, `.coll-tag`), the
   `.tag` one-liner, the description block (`<section class="body">`: a paragraph and the
   *How multi-home shows up* / equivalent note) and the screen itself inside
   `.frame > .device > .viewport > .screen`. The screen is laid out at a fixed 1440 × 900
   and scaled by nav.js, so all absolute positions inside `.stage` are in unscaled pixels.
   Use the shared classes from `assets/screens.css` (`.sb`, `.tb`, `.stage`, `.insp`, `.fc`,
   `.kc`, `.chip`, `.th.doc|sheet|deck|img|fig|md`, `.tip`, `.pill`, …). CSS that only your
   screen needs goes in the page's own `<style>` block. Leave the nav bar, the inline icon
   sprite, the pager and the inline `#manifest` script as they are; nav.js fills them.
   The static `href`s on the prev/next links are only a no-JS fallback.
2. **Manifest.** Append to `designs/manifest.json`:
   ```json
   { "slug": "tree", "number": "11", "name": "Tree", "collection": "classic", "accent": "#60a5fa",
     "summary": "One line, used on the gallery card and as the page tagline.",
     "shot": "shots/tree.png" }
   ```
   `collection` is `"innovative"` or `"classic"`; order within the file is the prev/next order.
   Then run `node tools/sync-manifest.mjs` so the inline copies in every page match
   (needed for file://; over http the JSON file is fetched directly).
3. **Shot.** `node tools/screenshot.mjs <slug>` writes `shots/<slug>.png` and
   `shots/thumb-<slug>.png`. Add a card to the matching `<ul class="cards">` in `index.html`
   (the card markup is documented in a comment there; for the Classic collection replace the
   placeholder `<div>`).

Finish with `node tools/check.mjs` and fix anything it reports.

## Tools

The tools need Node 18+ and Playwright with a Chromium. Install once, without
downloading a browser:

```sh
cd tools && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install && cd ..
```

Chromium is looked up at `$CHROME_PATH`, then `/opt/pw-browsers/chromium`, then any
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`; otherwise Playwright's own default is used.
Both scripts start a temporary `python3 -m http.server` on a free port and run from the repo root:

```sh
node tools/screenshot.mjs             # all designs; or: node tools/screenshot.mjs orbit loom
node tools/check.mjs                  # add --verbose for the full list
node tools/sync-manifest.mjs          # after editing designs/manifest.json
```

`check.mjs` exits non-zero on: console errors or page errors, any request that fails or
returns ≥ 400, broken internal links or anchors, a design page without working prev/next,
position indicator or jump menu, stale inline manifest or icon-sprite copies, elements inside
the device frame whose content is wider than their box or whose text is cut off by the frame or
a clipping ancestor (more than 2 px), and any page that scrolls horizontally at 390 px wide.

## Keyboard

On any page: `←` / `→` previous / next design (wrapping within the collection),
`Esc` or `G` back to the gallery, `?` toggle the shortcut hint. The *Jump to* menu in the
nav bar lists every design grouped by collection.

## Publishing

Pushing to `main` runs `.github/workflows/pages.yml`, which copies the repository minus
`.github/` and `tools/` into a single commit and force-pushes it to the `gh-pages` branch
using the workflow's `GITHUB_TOKEN`. Enable Pages once in *Settings → Pages*: source
"Deploy from a branch", branch `gh-pages`, folder `/ (root)`. `.nojekyll` is present so
Pages serves the files as they are. All links are relative, so the site works under the
repository sub-path.

## Versions

- **v1** 2026-09-16, ten concepts as annotated diagrams (superseded)
- **v2** 2026-09-16, rebuilt as full product screens
- **v4** 2026-09-17, interactive Facet prototype with Ledger comparison and guided tutorial (`prototype/facet/`)
- **v3** 2026-09-16, refined all ten innovative screens (one gesture per screen, reconciled counts, unified product chrome, status bar), added the Classic collection (Ledger, Mosaic, Twin, Crew, Lens), published on GitHub Pages
