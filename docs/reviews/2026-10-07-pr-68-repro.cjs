// Offline probes of the reviewed PR head. Run from any directory:
// node docs/reviews/2026-10-07-pr-68-repro.cjs
// Exit 1 means corrective assertions fail on that pinned head (expected).
// Only stdout is written; no network, published artifact, or store mutation.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const head = 'cbd0be9006b1c478a3a1c2cc82c18e01d08c98cc';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const read = file => execFileSync('git', ['show', `${head}:${file}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const results = [], diagnostics = {};
function check(finding, name, actual, expected) {
  let pass = true;
  try { assert.deepEqual(actual, expected); } catch { pass = false; }
  results.push({ finding, name, pass, actual, expected });
}

// Execute the actual writer against injected offline observations. All four
// scenarios are validated against the PR's rates schema in Python.
const fixtures = JSON.parse(execFileSync(path.join(root, '.venv/bin/python'), ['-c', `
import json, sys, jsonschema
p=json.load(sys.stdin)
ns={"__name__":"pr68_offline_writer"}
exec(compile(p["writer"],"pr68/pipeline/publish/rates.py","exec"),ns)
base={
 "DGS10":{"2025-10-06":4.2,"2026-10-06":5.3},
 "BAMLC0A0CM":{"2025-10-06":0.9,"2026-10-06":1.1},
 "BAMLC0A4CBBBEY":{"2025-10-06":5.0,"2026-10-06":6.19},
 "BAMLC0A4CBBB":{"2025-09-08":0.94,"2026-09-08":1.02},
 "SOFR30DAYAVG":{"2026-10-06":3.79}}
out={}
for name in ("lagged_spread","small_yield_move","missing_yield","missing_year_base"):
 rows={k:dict(v) for k,v in base.items()}
 if name != "lagged_spread":
  rows["BAMLC0A4CBBB"]={"2025-10-06":0.94,"2026-10-06":1.02}
 if name == "small_yield_move": rows["BAMLC0A4CBBBEY"]["2025-10-06"]=6.14
 if name == "missing_yield": rows.pop("BAMLC0A4CBBBEY")
 if name == "missing_year_base": rows["BAMLC0A4CBBBEY"].pop("2025-10-06")
 ns["_rows"]=lambda conn,code: rows.get(code,{})
 artifact={"published_at":p["published_at"],**ns["build"](None)}
 jsonschema.Draft202012Validator(p["schema"]).validate(artifact)
 out[name]=artifact
print(json.dumps(out))
`], { cwd: root, encoding: 'utf8', input: JSON.stringify({
  writer: read('pipeline/publish/rates.py'),
  schema: JSON.parse(read('schemas/rates.schema.json')),
  published_at: JSON.parse(read('site/public/data/pulse.json')).published_at,
}) }));

// Render real server-page JSX, KpiCard, and StaleBanner. Unrelated charts,
// client controls, and news are inert so no browser or network is needed.
function loader(rates) {
  const cache = new Map();
  function load(file) {
    if (file === 'site/public/data/rates.json') return rates;
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith('.json')) return JSON.parse(read(file));
    const module = { exports: {} };
    cache.set(file, module.exports);
    const js = ts.transpileModule(read(file), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    function resolve(id) {
      if (id === 'next/link') return { __esModule: true,
        default: ({ children, href }) => React.createElement('a', { href }, children) };
      if (id === '@/lib/newsTape') return { clusterStories: () => [] };
      if (id.startsWith('@/components/') && !['@/components/KpiCard', '@/components/StaleBanner'].includes(id)) {
        return new Proxy({}, { get: () => ({ children }) => React.createElement('div', null, children) });
      }
      if (id.startsWith('@/')) return load(`site/src/${id.slice(2)}${id.startsWith('@/components/') ? '.tsx' : '.ts'}`);
      if (id.startsWith('.')) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
        return load(path.posix.extname(resolved) ? resolved : `${resolved}.ts`);
      }
      return requireSite(id);
    }
    new Function('require', 'module', 'exports', js)(resolve, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  return load;
}
function render(file, fixture) {
  const Page = loader(fixture)(file).default;
  return renderToStaticMarkup(React.createElement(Page));
}
function text(html) { return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
const lagged = fixtures.lagged_spread;
const load = loader(lagged);
const { ratesHeadline } = load('site/src/lib/ratesHeadline.ts');
const ten = lagged.curve.find(r => r.code === 'DGS10');
const headline = ratesHeadline(ten, lagged.credit.bbb_yield, lagged.credit.bbb_oas);
diagnostics.lagged = {
  treasuryAsOf: ten.as_of, yieldAsOf: lagged.credit.bbb_yield.as_of,
  spreadAsOf: lagged.credit.bbb_oas.as_of, headline,
};
check('F1', 'Do not attribute the latest yield move using a spread from a different reporting window',
  headline.includes('almost all of that is rates, not credit'), false);

const hubHtml = render('site/src/app/datacenter/page.tsx', lagged);
const strip = hubHtml.match(/<section id="dc-capital"[\s\S]*?<\/section>/)[0];
diagnostics.capitalStrip = text(strip);
check('F2', 'The funding strip distinguishes financing benchmarks from a project borrowing quote',
  /benchmark|proxy|indicative/i.test(text(strip)), true);
check('F1', 'The capital strip discloses observation dates even when the artifact publish is current',
  /2026-10-06|Oct 6, 2026/.test(text(strip)), true);

const ratesHtml = render('site/src/app/rates/page.tsx', lagged);
const bbbCard = ratesHtml.match(/<div class="kpi-label"[^>]*>BBB corporate yield[\s\S]*?<\/div><\/div>/)[0];
diagnostics.bbbCard = text(bbbCard);
check('F1', 'The new BBB yield card displays its observation date',
  /2026-10-06|Oct 6, 2026/.test(text(bbbCard)), true);

diagnostics.publishGate = {};
for (const [name, fixture] of Object.entries(fixtures)) {
  if (name === 'lagged_spread') continue;
  const html = render('site/src/app/rates/page.tsx', fixture);
  const dc = render('site/src/app/datacenter/page.tsx', fixture);
  const capital = dc.match(/<section id="dc-capital"[\s\S]*?<\/section>/)[0];
  const skipped = !fixture.credit.bbb_yield; // actual e2e line 430
  const hasBbb = capital.includes('BBB corporate yield');
  const hasTakeaway = html.includes('data-testid="rates-takeaway"');
  diagnostics.publishGate[name] = { skipped, hasBbb, hasTakeaway,
    value: fixture.credit.bbb_yield.value, chg_1y: fixture.credit.bbb_yield.chg_1y };
  check('F3', `${name}: valid data must not violate the publish-gated browser assertions`,
    skipped || (hasBbb && hasTakeaway), true);
}

const { rowsFromSpec, toCsv } = load('site/src/lib/csv.ts');
const { RATES_HISTORY_CSV } = load('site/src/lib/exportSpecs.ts');
const csv = toCsv(rowsFromSpec(fixtures.small_yield_move, RATES_HISTORY_CSV));
diagnostics.historyCsvHeader = csv.split('\r\n')[0];
check('F4', 'Rates-history CSV includes the new IG and BBB spread columns',
  ['ig_oas', 'bbb_oas'].every(k => diagnostics.historyCsvHeader.split(',').includes(k)), true);

const old = JSON.parse(read('site/public/data/rates.json'));
check('control', 'The committed pre-series artifact keeps the Treasury-only headline',
  ratesHeadline(old.curve.find(r => r.code === 'DGS10'), old.credit.bbb_yield, old.credit.bbb_oas),
  'The 10-year Treasury is 5.31% (+113bp on the year)');
check('control', 'The writer preserves the small year-over-year move rather than rounding it away',
  fixtures.small_yield_move.credit.bbb_yield.chg_1y, 0.05);
check('control', 'A current artifact timestamp alone does not detect stale source observations',
  load('site/src/lib/stale.ts').staleness([lagged.published_at], lagged.published_at), null);
console.log(JSON.stringify({ head, schemaValidFixtures: Object.keys(fixtures), diagnostics, results }, null, 2));
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
