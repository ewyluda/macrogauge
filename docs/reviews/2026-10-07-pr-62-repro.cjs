// Offline PR #62 review probes. No application source or published data changes.
// Run: node docs/reviews/2026-10-07-pr-62-repro.cjs
// Exit 1 means the review's correctness assertions fail on the pinned PR head.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const head = '4399a5cfa0a6c089f24e5f4ff6d4b61113715008';
const base = '7936a6a45607170c0d6a38521529717654007fcf';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const read = (file, ref = head) => execFileSync('git', ['show', `${ref}:${file}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const baked = JSON.parse(read('site/public/data/datacenter.json'));
const results = [];
const diagnostics = {};
function check(finding, name, actual, expected) {
  let pass = true;
  try { assert.deepEqual(actual, expected); } catch { pass = false; }
  results.push({ finding, name, pass, actual, expected });
}
function compile(file, overrides = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = id => id in overrides ? overrides[id] : requireSite(id);
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
const format = compile('site/src/lib/format.ts');
const brief = compile('site/src/lib/homeBrief.ts', { './format': format });
const hub = compile('site/src/lib/dcHub.ts', { './homeBrief': brief });
const KpiCard = compile('site/src/components/KpiCard.tsx').KpiCard;
const PowerPanel = compile('site/src/components/PowerPanel.tsx', { '@/lib/format': format }).PowerPanel;
const empty = () => null;
function renderPage(file, data) {
  const overrides = {
    '../../../public/data/datacenter.json': data,
    '../../../public/data/dc_grades.json': JSON.parse(read('site/public/data/dc_grades.json')),
    '../../../public/data/longlead.json': { teaser: [] },
    '../../../public/data/news.json': { posts: [] },
    'next/link': ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children),
    '@/lib/dcHub': hub,
    '@/lib/format': format,
    '@/lib/newsTape': { clusterStories: () => [] },
    '@/lib/artifact': { artifact: (_, payload) => payload },
    '@/lib/exportSpecs': { dcBuildMonthlyCsvSpec: () => ({}) },
    '@/components/KpiCard': { KpiCard },
    '@/components/PowerPanel': { PowerPanel },
  };
  for (const name of ['DownloadData', 'Citation', 'DcIndexChart', 'DcConstructionChart',
    'ParityTable', 'StateTileMap', 'HardwareGapPanel', 'ContextPanel', 'LongLeadStrip',
    'NewsFeed', 'DcDrivers', 'StaleBanner']) overrides[`@/components/${name}`] = { [name]: empty };
  return renderToStaticMarkup(React.createElement(compile(file, overrides).default));
}

// F1: TypeScript checking with JSON supplied in memory. Tracked sources come
// from Git; ignored schema types and dependencies come from the checkout.
// Exclude generated Next route validators from both runs because the base
// has no /power route, while the current .next directory does.
const tracked = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', head],
  { cwd: root, encoding: 'utf8' }).trim().split('\n'));
function typecheckWithNullPower(ref) {
  const configPath = path.join(root, 'site/tsconfig.json');
  const config = ts.parseConfigFileTextToJson(configPath, read('site/tsconfig.json', ref));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, 'site'));
  const host = ts.createCompilerHost(parsed.options);
  const original = host.readFile.bind(host);
  const data = { ...baked, power: null };
  host.readFile = file => {
    const relative = path.relative(root, file);
    if (relative === 'site/public/data/datacenter.json') return JSON.stringify(data);
    if (ref === base && ['site/src/app/power/page.tsx', 'site/src/lib/dcHub.ts',
      'site/src/lib/dcHub.test.ts'].includes(relative)) return 'export {};';
    if (tracked.has(relative)) return read(relative, ref);
    return original(file);
  };
  const files = parsed.fileNames.filter(file => !file.includes('/.next/'));
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true, incremental: false }, host);
  return ts.getPreEmitDiagnostics(program).map(d => ({
    code: d.code, file: d.file && path.relative(root, d.file.fileName),
    line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
}
const headErrors = typecheckWithNullPower(head);
const baseErrors = typecheckWithNullPower(base);
diagnostics.nullPowerHead = headErrors;
diagnostics.nullPowerBase = baseErrors;
check('F1', 'A schema-valid null power block still typechecks', headErrors.length, 0);
check('control', 'The base revision typechecks with the same null power block', baseErrors.length, 0);

// F2: the checked-in artifact already demonstrates the mismatched dates.
const html = renderPage('site/src/app/power/page.tsx', baked);
const heroHtml = html.match(/<header[\s\S]*?<\/header>/)[0];
const kpiHtml = html.match(/<div class="kpi-row">[\s\S]*?<section/)[0];
const selected = hub.powerSummary(baked.power).hub;
const newest = baked.power.hubs.reduce((d, h) => h.asof > d ? h.asof : d, '');
diagnostics.powerDates = { publishedAt: baked.published_at, selectedHub: selected.label,
  selectedAsOf: selected.asof, newestDeliveryDate: newest,
  visibleHero: heroHtml.replace(/<[^>]+>/g, ' '),
  visibleKpis: kpiHtml.replace(/<[^>]+>/g, ' ') };
check('F2', 'The selected power KPI discloses its own September 29 observation date',
  kpiHtml.includes(format.fmtDay(selected.asof)), true);
check('F2', 'Updated is not later than the artifact publication day', newest <= baked.published_at.slice(0, 10), true);
check('control', 'The selected PJM headline uses the published 61.9 percent value', html.includes('61.9%'), true);

// F3: capacity_markets is optional, whereas capacity_auction is required.
const legacy = structuredClone(baked);
delete legacy.power.capacity_markets;
const legacySum = hub.powerSummary(legacy.power);
check('F3', 'The summary retains the required PJM auction when optional markets are absent',
  legacySum.capacity?.price ?? null, legacy.power.capacity_auction.rows.at(-1).price_mw_day);
const legacyHtml = renderToStaticMarkup(React.createElement(PowerPanel, { power: legacy.power }));
check('control', 'The detailed panel already renders the legacy PJM auction', legacyHtml.includes('$325'), true);

// F4: independent of the legacy fallback, a complete current shape can have
// valid levels but no YoY history and a latest capacity multiple below two.
const thin = structuredClone(baked);
for (const h of thin.power.hubs) h.avg30_yoy_pct = null;
for (const market of thin.power.capacity_markets) {
  if (market.iso === 'PJM') market.rows = [
    { period: '2024/25', price_mw_day: 100 }, { period: '2028/29', price_mw_day: 150 },
  ];
}
thin.power.capacity_auction.rows = [
  { delivery_year: '2024/25', price_mw_day: 100 }, { delivery_year: '2028/29', price_mw_day: 150 },
];
thin.power.capacity_auction.multiple = 1.5;
const thinSum = hub.powerSummary(thin.power);
const thinHtml = renderPage('site/src/app/datacenter/page.tsx', thin);
diagnostics.thinHistory = thinSum;
check('F4', 'The hub keeps its power section when capacity and tariffs are available', thinHtml.includes('id="dc-power"'), true);
check('control', 'The thin-history fixture still has a capacity reading', thinSum.capacity?.price, 150);
check('control', 'The thin-history fixture still has 17 tariff rows', thinSum.tariffs, 17);
check('control', 'The dead Power jump link remains in the thin-history render', thinHtml.includes('href="#dc-power"'), true);

// Validate the controlled data states against the actual published contract.
const validate = execFileSync(path.join(root, '.venv/bin/python'), ['-c',
  'import json,sys,jsonschema; p=json.load(sys.stdin); [jsonschema.Draft202012Validator(p["schema"]).validate(x) for x in p["fixtures"]]; print("valid")'],
  { cwd: root, encoding: 'utf8', input: JSON.stringify({ schema: JSON.parse(read('schemas/datacenter.schema.json')),
    fixtures: [{ ...baked, power: null }, legacy, thin] }) });
check('control', 'All three synthetic artifacts pass the JSON schema', validate.trim(), 'valid');
const failed = results.filter(r => !r.pass).length;
console.log(JSON.stringify({ head, base, results, diagnostics, failed }, null, 2));
process.exitCode = failed ? 1 : 0;
