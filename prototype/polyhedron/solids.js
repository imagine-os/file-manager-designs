/* ==========================================================================
   prototype/polyhedron/solids.js — the geometry behind the Polyhedron
   prototype. Pure functions, no DOM. Coordinates are in the CSS 3D frame
   (x right, y DOWN, z toward the viewer); every solid here is symmetric
   under a y-flip, so the classic vertex sets can be used as they are.

     solidFor(n)            -> 'cube' | 'tetrahedron' | 'octahedron' | 'dodecahedron'
     buildSolid(name)       -> { name, label, sides, faces, verts, edges, circum, inradius, edge }
     unfold(solid, root)    -> { placed: [ per face: { pts:[[x,y]…], angle, center:[x,y] } ], bbox }
     inscribedRect(poly)    -> largest axis-aligned rectangle inside a convex polygon
     chordAt(poly, y)       -> [xl, xr] where a horizontal line crosses the polygon, or null

   THE RULE (which solid for how many axes)
     Faces are only ever Platonic solids, so every face is a regular polygon
     and the same four shapes cover every count: the smallest Platonic solid
     with at least n faces, except that 1–3 axes use the cube (so the first
     view is Facet's cube). Spare faces stay on the solid, blank and dim:
       1–3 → cube (6)        4 → tetrahedron (4)     5–6 → cube (6)
       7–8 → octahedron (8)  9–12 → dodecahedron (12)
     No prisms: none of the counts fall back to one.

   FACE RECORD
     i        index in the solid's face order (front-most first at identity)
     n        unit outward normal          c  centroid (unit-scale)
     verts    vertex indices in winding order (consistent from outside)
     u, d     in-plane basis: u = screen-right, d = screen-DOWN when the face
              is square-on; u × d = n. d points at the midpoint of the edge
              nearest to "down" (or to +z for horizontal faces), so a face is
              always drawn apex-up / edge-down.
     local    the vertices as 2D [x, y] in the (u, d) basis, unit-scale
     R, r     face circumradius / inradius (unit-scale)
     adj      [ { face, edge:[vi, vj] } ] neighbours sharing an edge
   ========================================================================== */

const PHI = (1 + Math.sqrt(5)) / 2;

function signs(fn) { const out = []; for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) out.push(fn(a, b, c)); return out; }
function uniq(list) { const seen = {}; return list.filter((v) => { const k = v.map((x) => x.toFixed(6)).join(','); if (seen[k]) return false; seen[k] = 1; return true; }); }

export const SOLIDS = {
  tetrahedron: { label: 'Tetrahedron', sides: 3, verts: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], normals: [[-1, -1, -1], [-1, 1, 1], [1, -1, 1], [1, 1, -1]] },
  cube: { label: 'Cube', sides: 4, verts: signs((a, b, c) => [a, b, c]), normals: [[0, 0, 1], [1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1]] },
  octahedron: { label: 'Octahedron', sides: 3, verts: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], normals: signs((a, b, c) => [a, b, c]) },
  dodecahedron: {
    label: 'Dodecahedron', sides: 5,
    verts: uniq(signs((a, b, c) => [a, b, c]).concat(signs((a, b) => [0, a / PHI, b * PHI]), signs((a, b) => [a / PHI, b * PHI, 0]), signs((a, b) => [a * PHI, 0, b / PHI]))),
    normals: uniq(signs((a, b) => [0, a * PHI, b]).concat(signs((a, b) => [a * PHI, b, 0]), signs((a, b) => [a, 0, b * PHI])))
  }
};
export const SOLID_FACES = { tetrahedron: 4, cube: 6, octahedron: 8, dodecahedron: 12 };

export function solidFor(n) {
  if (n <= 3) return 'cube';
  if (n === 4) return 'tetrahedron';
  if (n <= 6) return 'cube';
  if (n <= 8) return 'octahedron';
  return 'dodecahedron';
}

/* ---- vector helpers ---- */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const project = (v, n) => sub(v, scale(n, dot(v, n)));

const cache = {};
export function buildSolid(name) {
  if (cache[name]) return cache[name];
  const def = SOLIDS[name];
  if (!def) throw new Error('Unknown solid ' + name);
  const verts = def.verts;
  // faces = the vertices that lie furthest along each normal
  let faces = def.normals.map((raw) => {
    const n = norm(raw);
    const ds = verts.map((v) => dot(v, n));
    const max = Math.max(...ds);
    const idx = ds.map((d, i) => (d > max - 1e-6 ? i : -1)).filter((i) => i >= 0);
    const c = scale(idx.reduce((acc, i) => [acc[0] + verts[i][0], acc[1] + verts[i][1], acc[2] + verts[i][2]], [0, 0, 0]), 1 / idx.length);
    // winding: consistent when viewed from outside
    const r = norm(sub(verts[idx[0]], c)), s = cross(n, r);
    idx.sort((a, b) => Math.atan2(dot(sub(verts[a], c), s), dot(sub(verts[a], c), r)) - Math.atan2(dot(sub(verts[b], c), s), dot(sub(verts[b], c), r)));
    return { n, c, verts: idx };
  });
  // order: the faces most visible at the identity orientation first (front, right, top … back)
  const W = [0.6, -0.5, 1];
  faces.sort((a, b) => dot(b.n, W) - dot(a.n, W));
  faces.forEach((f, i) => { f.i = i; });

  // in-plane basis: d = toward the midpoint of the edge nearest "down" (+y), or +z for horizontal faces
  faces.forEach((f) => {
    let pref = project([0, 1, 0], f.n);
    if (len(pref) < 0.05) pref = project([0, 0, 1], f.n);
    pref = norm(pref);
    let best = null, bd = -2;
    for (let k = 0; k < f.verts.length; k++) {
      const a = verts[f.verts[k]], b = verts[f.verts[(k + 1) % f.verts.length]];
      const mid = norm(sub(scale([a[0] + b[0], a[1] + b[1], a[2] + b[2]], 0.5), f.c));
      const d = dot(mid, pref);
      if (d > bd) { bd = d; best = mid; }
    }
    f.d = norm(project(best, f.n));
    f.u = norm(cross(f.d, f.n));
    f.local = f.verts.map((vi) => { const p = sub(verts[vi], f.c); return [dot(p, f.u), dot(p, f.d)]; });
    f.R = len(sub(verts[f.verts[0]], f.c));
    const a = verts[f.verts[0]], b = verts[f.verts[1]];
    f.r = len(sub(scale([a[0] + b[0], a[1] + b[1], a[2] + b[2]], 0.5), f.c));
    f.adj = [];
  });
  // adjacency + edges
  const edges = [], seen = {};
  faces.forEach((f) => {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k], b = f.verts[(k + 1) % f.verts.length];
      const key = a < b ? a + '-' + b : b + '-' + a;
      if (!seen[key]) { seen[key] = 1; edges.push([a, b]); }
    }
  });
  faces.forEach((f, i) => faces.forEach((g, j) => {
    if (j <= i) return;
    const shared = f.verts.filter((v) => g.verts.includes(v));
    if (shared.length === 2) { f.adj.push({ face: j, edge: shared }); g.adj.push({ face: i, edge: shared }); }
  }));
  const solid = {
    name, label: def.label, sides: def.sides, faces, verts, edges,
    circum: len(verts[0]), inradius: len(faces[0].c), edge: len(sub(verts[edges[0][0]], verts[edges[0][1]]))
  };
  cache[name] = solid;
  return solid;
}

/* ---- the net: BFS spanning tree from `root`, each child reflected across its shared edge.
   Every face keeps its outside-view winding, so the child lands on the far side of the edge. ---- */
/* which face hangs off which: a list of [face, parent] in placement order (root first, parent null).
   BFS is the default; the dodecahedron uses the classic two-flower net and the octahedron the
   six-triangle band with a cap above and below, both wider than tall, which suits a landscape stage. */
const adjOf = (solid, i) => solid.faces[i].adj.map((a) => a.face);
function antipode(solid, i) { const n = solid.faces[i].n; let best = -1, bd = -0.5; solid.faces.forEach((f, j) => { const d = f.n[0] * n[0] + f.n[1] * n[1] + f.n[2] * n[2]; if (d < bd) { bd = d; best = j; } }); return best; }
function netPlan(solid, root, variant) {
  const adj = (i) => adjOf(solid, i);
  if (solid.name === 'dodecahedron') {
    const F = root, petals = adj(F), B = antipode(solid, F), qs = adj(B);
    const link = petals[(variant || 0) % petals.length];
    const q1 = qs.find((q) => adj(q).includes(link));
    return [[F, null]].concat(petals.map((p) => [p, F]), [[q1, link], [B, q1]], qs.filter((q) => q !== q1).map((q) => [q, B]));
  }
  if (solid.name === 'octahedron') {
    const R = root, R2 = antipode(solid, R), band = solid.faces.map((_, i) => i).filter((i) => i !== R && i !== R2);
    const chain = [adj(R).find((i) => band.includes(i))];
    while (chain.length < 6) { const last = chain[chain.length - 1]; chain.push(adj(last).find((i) => band.includes(i) && !chain.includes(i))); }
    const order = [[chain[0], null]];
    for (let i = 1; i < 6; i++) order.push([chain[i], chain[i - 1]]);
    order.push([R, adj(R).includes(chain[2]) ? chain[2] : chain[3]], [R2, adj(R2).includes(chain[3]) ? chain[3] : chain[2]]);
    return order;
  }
  const order = [[root, null]], seen = { [root]: 1 }, queue = [root];
  while (queue.length) { const fi = queue.shift(); adj(fi).forEach((gi) => { if (seen[gi]) return; seen[gi] = 1; order.push([gi, fi]); queue.push(gi); }); }
  return order;
}

export function unfold(solid, root) {
  root = root || 0;
  if (solid.name === 'dodecahedron') {
    // five ways to hang the second flower; keep the one that fits a landscape stage best
    let best = null;
    for (let v = 0; v < 5; v++) { const net = unfoldPlan(solid, root, v); if (!best || net.bbox.h < best.bbox.h) best = net; }
    return best;
  }
  return unfoldPlan(solid, root, 0);
}
function unfoldPlan(solid, root, variant) {
  const placed = new Array(solid.faces.length).fill(null);
  const local2 = (f, vi) => f.local[f.verts.indexOf(vi)];
  const place = (f, angle, la, pa) => {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const map = {};
    f.verts.forEach((vi) => { const l = local2(f, vi); const x = l[0] - la[0], y = l[1] - la[1]; map[vi] = [pa[0] + cs * x - sn * y, pa[1] + sn * x + cs * y]; });
    const cx = pa[0] + cs * (0 - la[0]) - sn * (0 - la[1]), cy = pa[1] + sn * (0 - la[0]) + cs * (0 - la[1]);
    return { map, angle, center: [cx, cy], pts: f.verts.map((vi) => map[vi]) };
  };
  netPlan(solid, root, variant).forEach(([gi, pi]) => {
    const g = solid.faces[gi];
    if (pi === null) { placed[gi] = place(g, 0, [0, 0], [0, 0]); return; }
    const pf = placed[pi], edge = solid.faces[pi].adj.find((a) => a.face === gi).edge;
    const [A, B] = edge;
    const la = local2(g, A), lb = local2(g, B);
    const pa = pf.map[A], pb = pf.map[B];
    const angle = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) - Math.atan2(lb[1] - la[1], lb[0] - la[0]);
    placed[gi] = place(g, angle, la, pa);
  });
  // turn the whole net so that one of its edges is horizontal and it is as short as possible
  // (the cross stays axis-aligned, the octahedron's band lies flat, the two flowers sit side by side)
  const r0 = placed[root], cands = [];
  for (let i = 0; i < r0.pts.length; i++) { const a = r0.pts[i], b = r0.pts[(i + 1) % r0.pts.length]; cands.push(-Math.atan2(b[1] - a[1], b[0] - a[0])); }
  let rot = 0, bh = Infinity, bw = -1;
  cands.forEach((c) => {
    const cs = Math.cos(c), sn = Math.sin(c); let lo = 1e9, hi = -1e9, xl = 1e9, xh = -1e9;
    placed.forEach((p) => p.pts.forEach(([x, y]) => { const yy = sn * x + cs * y, xx = cs * x - sn * y; lo = Math.min(lo, yy); hi = Math.max(hi, yy); xl = Math.min(xl, xx); xh = Math.max(xh, xx); }));
    const h = hi - lo, w = xh - xl;
    if (h < bh - 1e-6 || (Math.abs(h - bh) < 1e-6 && w > bw + 1e-6)) { bh = h; bw = w; rot = c; }
  });
  if (Math.abs(rot) > 1e-6) {
    const cs = Math.cos(rot), sn = Math.sin(rot), R = ([x, y]) => [cs * x - sn * y, sn * x + cs * y];
    placed.forEach((p) => { p.pts = p.pts.map(R); p.center = R(p.center); p.angle += rot; for (const k in p.map) p.map[k] = R(p.map[k]); });
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  placed.forEach((p) => p.pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }));
  return { placed, bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 } };
}

/* ---- 2D helpers for laying content inside a face polygon ---- */
export function chordAt(poly, y) {
  let xl = Infinity, xr = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((y < Math.min(a[1], b[1])) || (y > Math.max(a[1], b[1])) || a[1] === b[1]) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    const x = a[0] + t * (b[0] - a[0]);
    xl = Math.min(xl, x); xr = Math.max(xr, x);
  }
  return xr > xl ? [xl, xr] : null;
}
export function inscribedRect(poly, steps) {
  steps = steps || 40;
  const ys = poly.map((p) => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys), dy = (maxY - minY) / steps;
  let best = null;
  for (let i = 1; i < steps; i++) {
    const t = minY + i * dy, ct = chordAt(poly, t);
    if (!ct) continue;
    for (let j = i + 1; j < steps; j++) {
      const b = minY + j * dy, cb = chordAt(poly, b);
      if (!cb) continue;
      const l = Math.max(ct[0], cb[0]), r = Math.min(ct[1], cb[1]);
      const w = r - l, h = b - t;
      if (w <= 0) continue;
      const area = w * h;
      if (!best || area > best.area) best = { x: l, y: t, w, h, area };
    }
  }
  return best;
}
