/* data.js — the one dataset both views render.
   Facet reads `axes` on each file; Ledger reads `path`. Several files sit in a
   folder that is only one of the groups they belong to (a Legal contract filed
   under Clients/Globex, an Atlas deck filed under Clients/Acme), which is the
   point the comparison makes. */
window.FACET_DATA = (function () {
  var people = {
    Priya:  { name: 'Priya Shah',     initials: 'PS', color: '#7c3aed' },
    Justin: { name: 'Justin Mehta',   initials: 'JM', color: '#0ea5e9' },
    Rosa:   { name: 'Rosa Delgado',   initials: 'RD', color: '#f97316' },
    Marco:  { name: 'Marco Bianchi',  initials: 'MB', color: '#e11d48' }
  };

  var axes = [
    { id: 'project', label: 'Project', color: '#34d399', values: ['Atlas', 'Website', 'Legal', 'Board', 'Hiring'], none: 'No project' },
    { id: 'client',  label: 'Client',  color: '#f5b544', values: ['Acme', 'Globex', 'Internal'],                   none: 'No client' },
    { id: 'type',    label: 'Type',    color: '#8b7cf6', values: ['Contract', 'Deck', 'Sheet', 'Markdown', 'Design', 'Document', 'Image'], none: 'Untyped' },
    { id: 'quarter', label: 'Quarter', color: '#22d3ee', values: ['Q2 2026', 'Q3 2026', 'Q4 2026'],                none: 'No quarter' },
    { id: 'person',  label: 'Person',  color: '#fb7185', values: ['Priya', 'Justin', 'Rosa', 'Marco'],             none: 'Unassigned' }
  ];

  // kind → thumbnail class (see app.css .th.*) and a human label
  var kinds = {
    pdf:  { th: 'doc',     label: 'PDF' },
    sig:  { th: 'doc sig', label: 'PDF · for signature' },
    xlsx: { th: 'sheet',   label: 'Spreadsheet' },
    key:  { th: 'deck',    label: 'Keynote deck' },
    md:   { th: 'md',      label: 'Markdown' },
    fig:  { th: 'fig',     label: 'Figma file' },
    fig2: { th: 'fig2',    label: 'Figma file' },
    png:  { th: 'img',     label: 'PNG image' },
    docx: { th: 'doc',     label: 'Word document' }
  };

  function f(id, name, kind, size, owner, modified, path, ax) {
    return { id: id, name: name, kind: kind, size: size, owner: owner, modified: modified, path: path, axes: ax };
  }

  var files = [
    f('acme-sow-q3',   'Acme SOW Q3.pdf',        'sig',  '1.1 MB',  'Priya',  'Today, 09:41',     'Projects/Atlas/Contracts', { project: 'Atlas',   client: 'Acme',     type: 'Contract', quarter: 'Q3 2026', person: 'Priya' }),
    f('acme-msa-v4',   'Acme MSA v4.pdf',        'pdf',  '1.4 MB',  'Justin', 'Yesterday, 17:42', 'Legal/Acme',               { project: 'Legal',   client: 'Acme',     type: 'Contract', quarter: 'Q3 2026', person: 'Justin' }),
    f('acme-nda',      'Acme NDA.pdf',           'pdf',  '240 KB',  'Rosa',   'Aug 28',           'Legal/Acme',               { project: 'Legal',   client: 'Acme',     type: 'Contract', person: 'Rosa' }),
    f('dpa-acme',      'DPA — Acme.pdf',         'pdf',  '380 KB',  'Rosa',   'Sep 2',            'Legal/Acme',               { project: 'Legal',   client: 'Acme',     type: 'Contract', quarter: 'Q3 2026', person: 'Rosa' }),
    f('acme-renewal',  'Acme renewal deck.key',  'key',  '18.4 MB', 'Justin', 'Sep 14',           'Clients/Acme',             { project: 'Atlas',   client: 'Acme',     type: 'Deck',     quarter: 'Q4 2026', person: 'Justin' }),
    f('acme-kickoff',  'Acme kickoff notes.md',  'md',   '9 KB',    'Rosa',   'Jul 15',           'Clients/Acme',             { project: 'Atlas',   client: 'Acme',     type: 'Markdown', quarter: 'Q2 2026', person: 'Rosa' }),
    f('launch-budget', 'Launch budget.xlsx',     'xlsx', '248 KB',  'Marco',  'Sep 10',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Sheet',    quarter: 'Q3 2026', person: 'Marco' }),
    f('q3-pricing',    'Q3 pricing deck.key',    'key',  '38.2 MB', 'Justin', 'Sep 8',            'Projects/Atlas',           { project: 'Atlas',   client: 'Acme',     type: 'Deck',     quarter: 'Q3 2026', person: 'Justin' }),
    f('launch-brief',  'launch-brief.pdf',       'pdf',  '812 KB',  'Priya',  'Sep 3',            'Projects/Atlas',           { project: 'Atlas',   client: 'Acme',     type: 'Document', quarter: 'Q3 2026', person: 'Priya' }),
    f('kickoff',       'kickoff.md',             'md',   '6 KB',    'Priya',  'Jul 14',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Markdown', quarter: 'Q2 2026', person: 'Priya' }),
    f('atlas-roadmap', 'Atlas roadmap.md',       'md',   '14 KB',   'Justin', 'Sep 12',           'Projects/Atlas',           { project: 'Atlas',   client: 'Internal', type: 'Markdown', quarter: 'Q4 2026', person: 'Justin' }),
    f('home-fig',      'home.fig',               'fig2', '12.7 MB', 'Rosa',   'Sep 15',           'Projects/Website',         { project: 'Website', client: 'Internal', type: 'Design',   quarter: 'Q3 2026', person: 'Rosa' }),
    f('hero-render',   'Hero render 02.png',     'png',  '60.5 MB', 'Rosa',   'Sep 14',           'Projects/Website/Assets',  { project: 'Website', client: 'Internal', type: 'Image',    quarter: 'Q3 2026', person: 'Rosa' }),
    f('copy-deck',     'copy-deck.docx',         'docx', '96 KB',   'Marco',  'Sep 11',           'Projects/Website',         { project: 'Website', client: 'Internal', type: 'Document', quarter: 'Q3 2026', person: 'Marco' }),
    f('brand-refresh', 'Brand refresh.fig',      'fig',  '48.1 MB', 'Rosa',   'Jun 30',           'Projects/Brand refresh',   { project: 'Website', client: 'Internal', type: 'Design',   quarter: 'Q2 2026', person: 'Rosa' }),
    f('gx-deck',       'GX deck.key',            'key',  '22.0 MB', 'Justin', 'Aug 20',           'Clients/Globex',           { client: 'Globex',   type: 'Deck',       quarter: 'Q3 2026', person: 'Justin' }),
    f('globex-sow',    'Globex SOW.pdf',         'sig',  '900 KB',  'Priya',  'Aug 22',           'Clients/Globex',           { project: 'Legal',   client: 'Globex',   type: 'Contract', quarter: 'Q3 2026', person: 'Priya' }),
    f('globex-pricing','Globex pricing.xlsx',    'xlsx', '180 KB',  'Marco',  'Sep 13',           'Clients/Globex',           { client: 'Globex',   type: 'Sheet',      quarter: 'Q3 2026', person: 'Marco' }),
    f('vendor-terms',  'Vendor terms.pdf',       'pdf',  '1.2 MB',  'Justin', 'Jul 30',           'Legal/Vendors',            { project: 'Legal',   client: 'Globex',   type: 'Contract', person: 'Justin' }),
    f('board-agenda',  'Board agenda.md',        'md',   '4 KB',    'Priya',  'Sep 16',           'Board/2026-09',            { project: 'Board',   client: 'Internal', type: 'Markdown', quarter: 'Q3 2026', person: 'Priya' }),
    f('board-deck',    'Board deck Q3.key',      'key',  '31.0 MB', 'Priya',  'Sep 16',           'Board/2026-09',            { project: 'Board',   client: 'Internal', type: 'Deck',     quarter: 'Q3 2026', person: 'Priya' }),
    f('q3-pl',         'Q3 P&L.xlsx',            'xlsx', '1.9 MB',  'Marco',  'Sep 15',           'Finance',                  { project: 'Board',   client: 'Internal', type: 'Sheet',    quarter: 'Q3 2026', person: 'Marco' }),
    f('offer-diaz',    'Offer — R. Diaz.pdf',    'sig',  '210 KB',  'Priya',  'Sep 9',            'People/Hiring',            { project: 'Hiring',  client: 'Internal', type: 'Contract', quarter: 'Q3 2026', person: 'Priya' }),
    f('jd-design-lead','JD — Design lead.docx',  'docx', '40 KB',   'Priya',  'Aug 12',           'People/Hiring',            { project: 'Hiring',  client: 'Internal', type: 'Document', quarter: 'Q3 2026', person: 'Priya' }),
    f('hiring-plan',   'Hiring plan 2027.xlsx',  'xlsx', '320 KB',  'Marco',  'Sep 5',            'People/Hiring',            { project: 'Hiring',  client: 'Internal', type: 'Sheet',    quarter: 'Q4 2026', person: 'Marco' })
  ];

  // Extra folders that exist in the tree but hold no files in this sample, so the
  // Ledger looks like a real drive rather than a list of exactly the used paths.
  var emptyFolders = ['Archive', 'Templates', 'Design system', 'Projects/Onboarding', 'Projects/Pricing 2027'];

  // A few "Quick Look" details per kind so the Ledger preview has something to say.
  var pages = { 'acme-sow-q3': 8, 'acme-msa-v4': 12, 'acme-nda': 3, 'dpa-acme': 6, 'globex-sow': 7, 'vendor-terms': 5, 'launch-brief': 4, 'offer-diaz': 2 };

  return { people: people, axes: axes, kinds: kinds, files: files, emptyFolders: emptyFolders, pages: pages, workspace: 'Northwind' };
})();
