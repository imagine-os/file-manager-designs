/* ==========================================================================
   prototype/shared/data.js — the Northwind dataset shared by the "beyond the
   cube" prototypes (Tesseract, Polyhedron, Nested). ES module; also mirrored
   on window.SHARED_DATA for tests and the console.

   It is a SUPERSET of prototype/facet/data.js (which stays untouched): every
   field Facet reads is here with the same meaning, so an app written against
   FACET_DATA runs unchanged over `files` from this module.

   ---------------------------------------------------------------------------
   SHAPE
   ---------------------------------------------------------------------------
   people      { key: { name, initials, color } }            keys: Priya Justin Rosa Marco
   axes        [ { id, label, color, values:[…], none } ]    12 axes, in this order:
                 core   project client type quarter person        (Facet's five)
                 extra  status owner shared size modified format starred
   coreAxes / extraAxes   the two halves of `axes`
   axesById    { id: axis }
   kinds       { kind: { th, label } }   kind → thumbnail class (chrome.css .th.*) + label
   QUARTERS    ['2026-Q1','2026-Q2','2026-Q3','2026-Q4']   the time axis
   NOW         '2026-Q3'                                    the quarter "today" is in
   baseline    the 25 raw file records (see FILE RECORD), state at creation
   files       filesAt(NOW): what the workspace looks like today: the same 25
               files as Facet with the same core-axis values (three of them were
               created after Q1, so Q1 has 22 and Q2 has 23; two are archived
               in Q4).
   filesById   { id: file }  over `files`
   emptyFolders, pages, workspace   as in Facet

   FILE RECORD (baseline entry)
     id        stable slug
     name      display name with extension
     kind      key into `kinds`
     size      human string ("1.4 MB", "240 KB")
     owner     people key (account owner; also the value on the Owner axis)
     modified  human string ("Today, 09:41", "Sep 14", "Jun 30")
     path      the ONE folder a Ledger-style browser would show it in
     axes      { axisId: value } at the moment the file was created — every
               file has a value on each of the seven extra axes; a core axis
               may be missing (the file is in that axis's "none" group)
     created   quarter the file first exists in (default '2026-Q1')
     archived  quarter the file is archived in (optional); from then on its
               Status is "Archived" and the snapshot carries archivedAt
     history   ordered [ { at: quarter, changes: { axisId: value | null } } ]
               applied in order; null removes the file from that axis

   SNAPSHOT (what filesAt returns): a fresh copy of each record that exists at
   the quarter, with `axes` resolved (baseline + history up to and including
   that quarter) and `archivedAt` (quarter string or null). Safe to mutate.

   ---------------------------------------------------------------------------
   HELPERS
   ---------------------------------------------------------------------------
   filesAt(quarter, { dropArchived })  -> snapshot array (throws on unknown quarter)
   diff(q1, q2) -> { added:[file], removed:[file], archived:[file],
                     changed:[{ id, name, axis, from, to }] }   q1 → q2
   groupBy(files, axis)  -> [ { value, label, files } ]   axis = id or axis
                            object; one group per axis value (in axis order,
                            including empty ones) plus a trailing
                            { value:null, label: axis.none } group when needed
   valuesFor(axis)       -> copy of the axis's values
   quarterLabel('2026-Q3') -> 'Q3 2026'
   quarterIndex(q)       -> 0..3
   ========================================================================== */

export const people = {
  Priya:  { name: 'Priya Shah',     initials: 'PS', color: '#7c3aed' },
  Justin: { name: 'Justin Mehta',   initials: 'JM', color: '#0ea5e9' },
  Rosa:   { name: 'Rosa Delgado',   initials: 'RD', color: '#f97316' },
  Marco:  { name: 'Marco Bianchi',  initials: 'MB', color: '#e11d48' }
};

export const coreAxes = [
  { id: 'project', label: 'Project', color: '#34d399', values: ['Atlas', 'Website', 'Legal', 'Board', 'Hiring'], none: 'No project' },
  { id: 'client',  label: 'Client',  color: '#f5b544', values: ['Acme', 'Globex', 'Internal'],                   none: 'No client' },
  { id: 'type',    label: 'Type',    color: '#8b7cf6', values: ['Contract', 'Deck', 'Sheet', 'Markdown', 'Design', 'Document', 'Image'], none: 'Untyped' },
  { id: 'quarter', label: 'Quarter', color: '#22d3ee', values: ['Q2 2026', 'Q3 2026', 'Q4 2026'],                none: 'No quarter' },
  { id: 'person',  label: 'Person',  color: '#fb7185', values: ['Priya', 'Justin', 'Rosa', 'Marco'],             none: 'Unassigned' }
];

export const extraAxes = [
  { id: 'status',   label: 'Status',      color: '#a3e635', values: ['Draft', 'In review', 'Final', 'Signed', 'Archived'],              none: 'No status' },
  { id: 'owner',    label: 'Owner',       color: '#e879f9', values: ['Priya', 'Justin', 'Rosa', 'Marco'],                             none: 'No owner' },
  { id: 'shared',   label: 'Shared with', color: '#2dd4bf', values: ['Acme', 'Globex', 'Legal team', 'Board', 'Nobody'],              none: 'Not shared' },
  { id: 'size',     label: 'Size',        color: '#fb923c', values: ['Tiny', 'Small', 'Medium', 'Large'],                             none: 'Unknown size' },
  { id: 'modified', label: 'Modified',    color: '#60a5fa', values: ['This week', 'This month', 'This quarter', 'Older'],             none: 'Never modified' },
  { id: 'format',   label: 'Format',      color: '#fbbf24', values: ['PDF', 'Keynote', 'Excel', 'Markdown', 'Figma', 'PNG', 'Word'], none: 'Other format' },
  { id: 'starred',  label: 'Starred',     color: '#f472b6', values: ['Starred', 'Not starred'],                                       none: 'Unknown' }
];

export const axes = coreAxes.concat(extraAxes);
export const axesById = {};
axes.forEach(function (a) { axesById[a.id] = a; });

export const kinds = {
  pdf:  { th: 'doc',     label: 'PDF',                 format: 'PDF' },
  sig:  { th: 'doc sig', label: 'PDF · for signature', format: 'PDF' },
  xlsx: { th: 'sheet',   label: 'Spreadsheet',         format: 'Excel' },
  key:  { th: 'deck',    label: 'Keynote deck',        format: 'Keynote' },
  md:   { th: 'md',      label: 'Markdown',            format: 'Markdown' },
  fig:  { th: 'fig',     label: 'Figma file',          format: 'Figma' },
  fig2: { th: 'fig2',    label: 'Figma file',          format: 'Figma' },
  png:  { th: 'img',     label: 'PNG image',           format: 'PNG' },
  docx: { th: 'doc',     label: 'Word document',       format: 'Word' }
};

export const QUARTERS = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'];
export const NOW = '2026-Q3';
export const workspace = 'Northwind';

export function quarterIndex(q) {
  var i = QUARTERS.indexOf(q);
  if (i < 0) throw new Error('Unknown quarter "' + q + '" (expected one of ' + QUARTERS.join(', ') + ')');
  return i;
}
export function quarterLabel(q) { var p = String(q).split('-'); return p[1] + ' ' + p[0]; }

/* ---- derived attribute helpers (Size, Modified, Format buckets) ---- */
const KB = 1024;
export function sizeBytes(str) {
  var m = /([\d.]+)\s*(KB|MB|GB)/i.exec(str || '');
  if (!m) return 0;
  var n = parseFloat(m[1]), u = m[2].toUpperCase();
  return n * (u === 'GB' ? KB * KB * KB : u === 'MB' ? KB * KB : KB);
}
export function sizeBucket(str) {
  var b = sizeBytes(str);
  return b < 100 * KB ? 'Tiny' : b < KB * KB ? 'Small' : b < 10 * KB * KB ? 'Medium' : 'Large';
}
// "today" is Thu 2026-09-17; the week starts Mon Sep 14; the quarter started Jul 1.
export function modifiedBucket(str) {
  if (/^(Today|Yesterday)/.test(str)) return 'This week';
  var m = /^([A-Z][a-z]{2}) (\d+)/.exec(str || '');
  if (!m) return 'Older';
  var mon = m[1], day = +m[2];
  if (mon === 'Sep') return day >= 14 ? 'This week' : 'This month';
  if (mon === 'Jul' || mon === 'Aug') return 'This quarter';
  return 'Older';
}

/* ---- the records ---- */
const STARRED = { 'acme-sow-q3': 1, 'q3-pricing': 1, 'home-fig': 1, 'board-deck': 1, 'globex-sow': 1, 'atlas-roadmap': 1, 'launch-brief': 1 };

// f(id, name, kind, size, owner, modified, path, coreAxesAtCreation, { status, shared, created, archived, history })
function f(id, name, kind, size, owner, modified, path, core, x) {
  x = x || {};
  var ax = {};
  for (var k in core) ax[k] = core[k];
  ax.status = x.status || 'Draft';
  ax.owner = owner;
  ax.shared = x.shared || 'Nobody';
  ax.size = sizeBucket(size);
  ax.modified = modifiedBucket(modified);
  ax.format = kinds[kind].format;
  ax.starred = STARRED[id] ? 'Starred' : 'Not starred';
  var rec = { id: id, name: name, kind: kind, size: size, owner: owner, modified: modified, path: path, axes: ax, created: x.created || QUARTERS[0], history: x.history || [] };
  if (x.archived) rec.archived = x.archived;
  return rec;
}
const Q1 = '2026-Q1', Q2 = '2026-Q2', Q3 = '2026-Q3', Q4 = '2026-Q4';

/* `axes` below is the state AT CREATION. History carries the file forward; the
   present (Q3) state of the 25 original files equals prototype/facet/data.js. */
export const baseline = [
  // Acme SOW: drafted in Q1 for Q2 by Justin, handed to Priya in Q2, slipped to Q3 and went to review, signs in Q4
  f('acme-sow-q3',   'Acme SOW Q3.pdf',        'sig',  '1.1 MB',  'Priya',  'Today, 09:41',     'Projects/Atlas/Contracts', { project: 'Atlas',   client: 'Acme',     type: 'Contract', quarter: 'Q2 2026', person: 'Justin' },
    { shared: 'Acme', history: [ { at: Q2, changes: { person: 'Priya' } }, { at: Q3, changes: { quarter: 'Q3 2026', status: 'In review' } }, { at: Q4, changes: { status: 'Signed' } } ] }),
  // MSA: started under Atlas, moved to the Legal project in Q2, signs in Q4
  f('acme-msa-v4',   'Acme MSA v4.pdf',        'pdf',  '1.4 MB',  'Justin', 'Yesterday, 17:42', 'Legal/Acme',               { project: 'Atlas',   client: 'Acme',     type: 'Contract', quarter: 'Q3 2026', person: 'Justin' },
    { shared: 'Legal team', history: [ { at: Q2, changes: { project: 'Legal', status: 'In review' } }, { at: Q4, changes: { status: 'Signed' } } ] }),
  // NDA: signed long ago, archived in Q4
  f('acme-nda',      'Acme NDA.pdf',           'pdf',  '240 KB',  'Rosa',   'Aug 28',           'Legal/Acme',               { project: 'Legal',   client: 'Acme',     type: 'Contract', person: 'Rosa' },
    { status: 'Signed', shared: 'Acme', archived: Q4 }),
  // DPA: drafted with no client, attached to Acme in Q3
  f('dpa-acme',      'DPA — Acme.pdf',         'pdf',  '380 KB',  'Rosa',   'Sep 2',            'Legal/Acme',               { project: 'Legal',   type: 'Contract', quarter: 'Q3 2026', person: 'Rosa' },
    { shared: 'Legal team', history: [ { at: Q3, changes: { client: 'Acme', status: 'In review', shared: 'Acme' } } ] }),
  // created in Q3
  f('acme-renewal',  'Acme renewal deck.key',  'key',  '18.4 MB', 'Justin', 'Sep 14',           'Clients/Acme',             { project: 'Atlas',   client: 'Acme',     type: 'Deck',     quarter: 'Q4 2026', person: 'Justin' },
    { shared: 'Acme', created: Q3 }),
  // kickoff notes: Priya's, reassigned to Rosa in Q2 when they were finished
  f('acme-kickoff',  'Acme kickoff notes.md',  'md',   '9 KB',    'Rosa',   'Jul 15',           'Clients/Acme',             { project: 'Atlas',   client: 'Acme',     type: 'Markdown', quarter: 'Q2 2026', person: 'Priya' },
    { shared: 'Acme', history: [ { at: Q2, changes: { person: 'Rosa', status: 'Final' } } ] }),
  // budget: rolled from Q2 to Q3, reviewed in Q3, final in Q4
  f('launch-budget', 'Launch budget.xlsx',     'xlsx', '248 KB',  'Marco',  'Sep 10',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Sheet',    quarter: 'Q2 2026', person: 'Marco' },
    { history: [ { at: Q3, changes: { quarter: 'Q3 2026', status: 'In review' } }, { at: Q4, changes: { status: 'Final' } } ] }),
  // pricing deck: internal until Q3, then became the Acme deck
  f('q3-pricing',    'Q3 pricing deck.key',    'key',  '38.2 MB', 'Justin', 'Sep 8',            'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Deck',     quarter: 'Q3 2026', person: 'Justin' },
    { history: [ { at: Q3, changes: { client: 'Acme', status: 'Final', shared: 'Acme' } } ] }),
  f('launch-brief',  'launch-brief.pdf',       'pdf',  '812 KB',  'Priya',  'Sep 3',            'Projects/Atlas',           { project: 'Atlas',   client: 'Acme',     type: 'Document', quarter: 'Q3 2026', person: 'Priya' },
    { status: 'Final', shared: 'Acme' }),
  f('kickoff',       'kickoff.md',             'md',   '6 KB',    'Priya',  'Jul 14',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Markdown', quarter: 'Q2 2026', person: 'Priya' },
    { status: 'Final' }),
  // roadmap: was a Q3 document, pushed to Q4 in Q3
  f('atlas-roadmap', 'Atlas roadmap.md',       'md',   '14 KB',   'Justin', 'Sep 12',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Markdown', quarter: 'Q3 2026', person: 'Justin' },
    { history: [ { at: Q3, changes: { quarter: 'Q4 2026' } } ] }),
  // created in Q2
  f('home-fig',      'home.fig',               'fig2', '12.7 MB', 'Rosa',   'Sep 15',           'Projects/Website',         { project: 'Website', client: 'Internal', type: 'Design',   quarter: 'Q3 2026', person: 'Rosa' },
    { status: 'In review', created: Q2 }),
  f('hero-render',   'Hero render 02.png',     'png',  '60.5 MB', 'Rosa',   'Sep 14',           'Projects/Website/Assets',  { project: 'Website', client: 'Internal', type: 'Image',    quarter: 'Q3 2026', person: 'Rosa' },
    { status: 'Final' }),
  // copy deck: Rosa's until Marco took it over in Q3
  f('copy-deck',     'copy-deck.docx',         'docx', '96 KB',   'Marco',  'Sep 11',           'Projects/Website',         { project: 'Website', client: 'Internal', type: 'Document', quarter: 'Q3 2026', person: 'Rosa' },
    { history: [ { at: Q3, changes: { person: 'Marco', status: 'In review' } } ] }),
  // brand refresh: finished in Q2, archived in Q4
  f('brand-refresh', 'Brand refresh.fig',      'fig',  '48.1 MB', 'Rosa',   'Jun 30',           'Projects/Brand refresh',   { project: 'Website', client: 'Internal', type: 'Design',   quarter: 'Q2 2026', person: 'Rosa' },
    { status: 'Final', archived: Q4 }),
  f('gx-deck',       'GX deck.key',            'key',  '22.0 MB', 'Justin', 'Aug 20',           'Clients/Globex',           { client: 'Globex',   type: 'Deck',       quarter: 'Q3 2026', person: 'Justin' },
    { status: 'Final', shared: 'Globex' }),
  // Globex SOW: no project at first, filed under Legal in Q2, signed in Q3
  f('globex-sow',    'Globex SOW.pdf',         'sig',  '900 KB',  'Priya',  'Aug 22',           'Clients/Globex',           { client: 'Globex',   type: 'Contract', quarter: 'Q3 2026', person: 'Priya' },
    { shared: 'Globex', history: [ { at: Q2, changes: { project: 'Legal', status: 'In review' } }, { at: Q3, changes: { status: 'Signed' } } ] }),
  f('globex-pricing','Globex pricing.xlsx',    'xlsx', '180 KB',  'Marco',  'Sep 13',           'Clients/Globex',           { client: 'Globex',   type: 'Sheet',      quarter: 'Q3 2026', person: 'Marco' },
    { status: 'In review', shared: 'Globex' }),
  // vendor terms: generic until Globex was attached in Q2
  f('vendor-terms',  'Vendor terms.pdf',       'pdf',  '1.2 MB',  'Justin', 'Jul 30',           'Legal/Vendors',            { project: 'Legal',   type: 'Contract', person: 'Justin' },
    { status: 'Signed', shared: 'Legal team', history: [ { at: Q2, changes: { client: 'Globex' } } ] }),
  // board agenda: rolls forward every quarter
  f('board-agenda',  'Board agenda.md',        'md',   '4 KB',    'Priya',  'Sep 16',           'Board/2026-09',            { project: 'Board',   client: 'Internal', type: 'Markdown', quarter: 'Q2 2026', person: 'Priya' },
    { status: 'Final', shared: 'Board', history: [ { at: Q3, changes: { quarter: 'Q3 2026', status: 'Draft' } }, { at: Q4, changes: { quarter: 'Q4 2026' } } ] }),
  f('board-deck',    'Board deck Q3.key',      'key',  '31.0 MB', 'Priya',  'Sep 16',           'Board/2026-09',            { project: 'Board',   client: 'Internal', type: 'Deck',     quarter: 'Q3 2026', person: 'Priya' },
    { status: 'In review', shared: 'Board' }),
  // created in Q3
  f('q3-pl',         'Q3 P&L.xlsx',            'xlsx', '1.9 MB',  'Marco',  'Sep 15',           'Finance',                  { project: 'Board',   client: 'Internal', type: 'Sheet',    quarter: 'Q3 2026', person: 'Marco' },
    { shared: 'Board', created: Q3 }),
  f('offer-diaz',    'Offer — R. Diaz.pdf',    'sig',  '210 KB',  'Priya',  'Sep 9',            'People/Hiring',            { project: 'Hiring',  client: 'Internal', type: 'Contract', quarter: 'Q3 2026', person: 'Priya' },
    { status: 'In review' }),
  // JD: Marco wrote it, Priya owns it from Q3
  f('jd-design-lead','JD — Design lead.docx',  'docx', '40 KB',   'Priya',  'Aug 12',           'People/Hiring',            { project: 'Hiring',  client: 'Internal', type: 'Document', quarter: 'Q3 2026', person: 'Marco' },
    { status: 'Final', history: [ { at: Q3, changes: { person: 'Priya' } } ] }),
  // hiring plan: lived under Board until Hiring became its own project in Q3
  f('hiring-plan',   'Hiring plan 2027.xlsx',  'xlsx', '320 KB',  'Marco',  'Sep 5',            'People/Hiring',            { project: 'Board',   client: 'Internal', type: 'Sheet',    quarter: 'Q4 2026', person: 'Marco' },
    { shared: 'Board', history: [ { at: Q3, changes: { project: 'Hiring' } } ] })
];

export const emptyFolders = ['Archive', 'Templates', 'Design system', 'Projects/Onboarding', 'Projects/Pricing 2027'];
export const pages = { 'acme-sow-q3': 8, 'acme-msa-v4': 12, 'acme-nda': 3, 'dpa-acme': 6, 'globex-sow': 7, 'vendor-terms': 5, 'launch-brief': 4, 'offer-diaz': 2 };

/* ---- helpers ---- */
export function filesAt(quarter, opts) {
  opts = opts || {};
  var qi = quarterIndex(quarter);
  var out = [];
  baseline.forEach(function (rec) {
    if (quarterIndex(rec.created) > qi) return;
    var ax = {};
    for (var k in rec.axes) ax[k] = rec.axes[k];
    rec.history.forEach(function (h) {
      if (quarterIndex(h.at) > qi) return;
      for (var a in h.changes) { if (h.changes[a] === null || h.changes[a] === undefined) delete ax[a]; else ax[a] = h.changes[a]; }
    });
    var archivedAt = rec.archived && quarterIndex(rec.archived) <= qi ? rec.archived : null;
    if (archivedAt) ax.status = 'Archived';
    if (archivedAt && opts.dropArchived) return;
    out.push({ id: rec.id, name: rec.name, kind: rec.kind, size: rec.size, owner: rec.owner, modified: rec.modified, path: rec.path, axes: ax, created: rec.created, archived: rec.archived || null, archivedAt: archivedAt, history: rec.history });
  });
  return out;
}

export function diff(q1, q2) {
  var a = filesAt(q1), b = filesAt(q2);
  var byA = {}, byB = {};
  a.forEach(function (x) { byA[x.id] = x; }); b.forEach(function (x) { byB[x.id] = x; });
  var res = { from: q1, to: q2, added: [], removed: [], archived: [], changed: [] };
  b.forEach(function (x) { if (!byA[x.id]) res.added.push(x); });
  a.forEach(function (x) { if (!byB[x.id]) res.removed.push(x); });
  b.forEach(function (x) {
    var y = byA[x.id]; if (!y) return;
    if (x.archivedAt && !y.archivedAt) res.archived.push(x);
    axes.forEach(function (ax) {
      var from = y.axes[ax.id] || null, to = x.axes[ax.id] || null;
      if (from !== to) res.changed.push({ id: x.id, name: x.name, axis: ax.id, from: from, to: to });
    });
  });
  return res;
}

function axisOf(axis) { var a = typeof axis === 'string' ? axesById[axis] : axis; if (!a) throw new Error('Unknown axis ' + axis); return a; }
function byName(a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); }

export function valuesFor(axis) { return axisOf(axis).values.slice(); }

export function groupBy(list, axis) {
  var ax = axisOf(axis);
  var groups = ax.values.map(function (v) { return { value: v, label: v, files: list.filter(function (x) { return x.axes[ax.id] === v; }).sort(byName) }; });
  var none = list.filter(function (x) { return !x.axes[ax.id]; }).sort(byName);
  if (none.length) groups.push({ value: null, label: ax.none, files: none });
  return groups;
}

export const files = filesAt(NOW);
export const filesById = {};
files.forEach(function (x) { filesById[x.id] = x; });

const data = { people: people, axes: axes, coreAxes: coreAxes, extraAxes: extraAxes, axesById: axesById, kinds: kinds, files: files, filesById: filesById, baseline: baseline, emptyFolders: emptyFolders, pages: pages, workspace: workspace, QUARTERS: QUARTERS, NOW: NOW, filesAt: filesAt, diff: diff, groupBy: groupBy, valuesFor: valuesFor, quarterLabel: quarterLabel, quarterIndex: quarterIndex, sizeBucket: sizeBucket, modifiedBucket: modifiedBucket };
if (typeof window !== 'undefined') window.SHARED_DATA = data;
export default data;
