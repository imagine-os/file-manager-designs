/* prototype/shared/icons.js — the Northwind icon sprite used by chrome.css,
   cube.js (#i-reset) and tour.js (#i-grip #i-min #i-x #i-plus #i-check).
   Importing the module injects the sprite once at the top of <body>, so
   <svg class="ic"><use href="#i-cube"/></svg> works anywhere on the page.

     import '../shared/icons.js';               // side effect: sprite injected
     import { SPRITE, injectIcons } from '../shared/icons.js';

   Symbols: i-home i-inbox i-clock i-star i-search i-plus i-chev i-chevr i-back
   i-layers i-share i-cube i-cols i-flat i-gear i-x i-check i-hand i-sun i-moon
   i-compare i-help i-reset i-undo i-grip i-min i-folder i-play i-sidebar
   i-external i-time i-poly i-nested */
export var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" id="proto-icons"><defs>' +
  '<symbol id="i-home" viewBox="0 0 16 16"><path d="M3 7.5 8 3l5 4.5V13H3z"/></symbol>' +
  '<symbol id="i-inbox" viewBox="0 0 16 16"><path d="M2 9h3l1 2h4l1-2h3M2 9v4h12V9l-2-6H4z"/></symbol>' +
  '<symbol id="i-clock" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></symbol>' +
  '<symbol id="i-star" viewBox="0 0 16 16"><path d="m8 2 1.8 3.8 4.2.6-3 2.9.7 4.2L8 11.5l-3.7 2 .7-4.2-3-2.9 4.2-.6z"/></symbol>' +
  '<symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/></symbol>' +
  '<symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></symbol>' +
  '<symbol id="i-chev" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></symbol>' +
  '<symbol id="i-chevr" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></symbol>' +
  '<symbol id="i-back" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></symbol>' +
  '<symbol id="i-layers" viewBox="0 0 16 16"><path d="M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></symbol>' +
  '<symbol id="i-share" viewBox="0 0 16 16"><path d="M4 8v5.5h8V8M8 2.5v7.5M5.2 5.3 8 2.5l2.8 2.8"/></symbol>' +
  '<symbol id="i-cube" viewBox="0 0 16 16"><path d="M8 1.8 14 5v6l-6 3.2L2 11V5z"/><path d="M2 5l6 3 6-3M8 8v6.2"/></symbol>' +
  '<symbol id="i-cols" viewBox="0 0 16 16"><path d="M2.5 3h11v10h-11zM6.2 3v10M9.8 3v10"/></symbol>' +
  '<symbol id="i-flat" viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11z"/><path d="M2.5 6.5h11M6 6.5v6"/></symbol>' +
  '<symbol id="i-gear" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/></symbol>' +
  '<symbol id="i-x" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></symbol>' +
  '<symbol id="i-check" viewBox="0 0 16 16"><path d="m3 8.5 3 3 7-7"/></symbol>' +
  '<symbol id="i-hand" viewBox="0 0 16 16"><path d="M5 8V3.5a1 1 0 0 1 2 0V7M7 3.5V3a1 1 0 0 1 2 0v4M9 4a1 1 0 0 1 2 0v3.5M11 6a1 1 0 0 1 2 0v3.5c0 2.5-1.8 4-4.3 4S5.2 12.3 4.3 11L2.6 8.8a1 1 0 0 1 1.6-1.2L5 8.5"/></symbol>' +
  '<symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/></symbol>' +
  '<symbol id="i-moon" viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></symbol>' +
  '<symbol id="i-compare" viewBox="0 0 16 16"><path d="M2.5 3h4.5v10h-4.5zM9 3h4.5v10H9z"/><path d="M4.75 6v4M11.25 6v4"/></symbol>' +
  '<symbol id="i-help" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.5c0 1.2-1.9 1.4-1.9 2.6"/><circle cx="8" cy="11.6" r=".6" fill="currentColor"/></symbol>' +
  '<symbol id="i-reset" viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.8v2.7h2.7"/></symbol>' +
  '<symbol id="i-undo" viewBox="0 0 16 16"><path d="M3.5 6.5h6a3 3 0 0 1 0 6H6M3.5 6.5 6 4M3.5 6.5 6 9"/></symbol>' +
  '<symbol id="i-grip" viewBox="0 0 16 16"><circle cx="5.5" cy="4" r="1" fill="currentColor"/><circle cx="10.5" cy="4" r="1" fill="currentColor"/><circle cx="5.5" cy="8" r="1" fill="currentColor"/><circle cx="10.5" cy="8" r="1" fill="currentColor"/><circle cx="5.5" cy="12" r="1" fill="currentColor"/><circle cx="10.5" cy="12" r="1" fill="currentColor"/></symbol>' +
  '<symbol id="i-min" viewBox="0 0 16 16"><path d="M3.5 8h9"/></symbol>' +
  '<symbol id="i-folder" viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z"/></symbol>' +
  '<symbol id="i-play" viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z"/></symbol>' +
  '<symbol id="i-sidebar" viewBox="0 0 16 16"><path d="M2.5 3h11v10h-11zM6 3v10"/></symbol>' +
  '<symbol id="i-external" viewBox="0 0 16 16"><path d="M9 3h4v4M13 3 7.5 8.5M6 4H3.5v8.5H12V10"/></symbol>' +
  // new for the three prototypes
  '<symbol id="i-time" viewBox="0 0 16 16"><path d="M2 12.5h12M4 12.5V5l4-2.5 4 2.5v7.5"/><path d="M4 5l4 2.5L12 5M8 7.5v5"/><circle cx="11" cy="12.5" r="1.4" fill="currentColor"/></symbol>' +
  '<symbol id="i-poly" viewBox="0 0 16 16"><path d="M8 1.5 13.2 4.7l1 5.6L10.6 14H5.4L1.8 10.3l1-5.6z"/><path d="M8 1.5 6 6l2 5 2-5zM3 4.7l3 1.3M13.2 4.7 10 6M1.8 10.3 6 6M14.2 10.3 10 6M5.4 14 8 11l2.6 3"/></symbol>' +
  '<symbol id="i-nested" viewBox="0 0 16 16"><path d="M8 1.8 14 5v6l-6 3.2L2 11V5z"/><path d="M2 5l6 3 6-3M8 8v6.2"/><path d="M8 5.6 10.6 7v2.8L8 11.2 5.4 9.8V7z" opacity=".7"/></symbol>' +
  '</defs></svg>';

export function injectIcons() {
  if (typeof document === 'undefined' || document.getElementById('proto-icons')) return;
  var t = document.createElement('template'); t.innerHTML = SPRITE;
  document.body.insertBefore(t.content.firstChild, document.body.firstChild);
}
injectIcons();
