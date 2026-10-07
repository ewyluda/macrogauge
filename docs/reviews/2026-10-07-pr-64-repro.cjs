// Offline review probes. Run: node docs/reviews/2026-10-07-pr-64-repro.cjs
// Exit 1 means the corrective assertions fail on the pinned PR head.
// No production source, artifact, store, or network is changed.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const head = '41d62f26a262c78fd514189bb4465ad672d12ecb';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const read = file => execFileSync('git', ['show', `${head}:${file}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const baked = JSON.parse(read('site/public/data/capacity.json'));
const config = JSON.parse(read('config/capacity.json'));
const results = [], diagnostics = {};
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
  new Function('require', 'module', 'exports', js)(
    id => id in overrides ? overrides[id] : requireSite(id), module, module.exports);
  return module.exports;
}
const cohort = compile('site/src/lib/capacityCohort.ts');
const chartTip = compile('site/src/components/capacity/ChartTip.tsx');
const { ValuationScatter } = compile('site/src/components/capacity/ValuationScatter.tsx', {
  './ChartTip': chartTip,
});

// Run the pinned publisher offline using only the committed quotes. Retain
// the original artifact timestamp: this is a probe, not a fresh publication.
const fresh = JSON.parse(execFileSync(path.join(root, '.venv/bin/python'), ['-c', `
import json, sys, jsonschema
p=json.load(sys.stdin)
ns={"__name__":"pr64_offline_writer"}
exec(compile(p["writer"],"pr64/pipeline/publish/capacity.py","exec"),ns)
quotes={}
for c in p["baked"]["companies"]:
    quotes["fmp_cap_"+c["t"].lower()]=(c["priced_date"],c["cap"])
    quotes["fmp_px_"+c["t"].lower()]=(c["priced_date"],c["px"])
quotes["fmp_cap_nvda"]=(p["baked"]["priced_date"],p["baked"]["reference"]["nvda_cap_b"])
ns["_latest"]=lambda conn,code: quotes.get(code,(None,None))
fresh=ns["build"](None,p["config"],today=p["baked"]["priced_date"])
fresh={"published_at":p["baked"]["published_at"],**fresh}
jsonschema.Draft202012Validator(p["schema"]).validate(fresh)
print(json.dumps(fresh))
`], { cwd: root, encoding: 'utf8', input: JSON.stringify({ baked, config,
  writer: read('pipeline/publish/capacity.py'), schema: JSON.parse(read('schemas/capacity.schema.json')) }) }));

const contributors = fresh.companies.filter(c => c.dupe == null && c.ev_per_mw != null);
const headline = cohort.capacityHeadline(fresh.cohorts, fresh.reference, contributors.length);
diagnostics.headline = headline;
diagnostics.valuation = {
  contributorCount: contributors.length,
  equityCapB: contributors.reduce((sum, c) => sum + c.cap, 0),
  enterpriseValueB: fresh.reference.cohort_ev_b,
  nvidiaEquityCapB: fresh.reference.nvda_cap_b,
};
diagnostics.valuation.equityRatio = diagnostics.valuation.nvidiaEquityCapB / diagnostics.valuation.equityCapB;
diagnostics.valuation.mixedBasisRatio = diagnostics.valuation.nvidiaEquityCapB / diagnostics.valuation.enterpriseValueB;
check('F1', 'The standalone capacity headline identifies its tracked estimate universe',
  /track/i.test(headline.title) && /estimat/i.test(headline.title), true);
check('F2', 'The mixed-basis valuation sentence names enterprise value and market cap',
  /enterprise value|\bEV\b/.test(headline.detail) && /market cap/i.test(headline.detail), true);
check('control', 'Offline regeneration with saved quotes gives the stated cohort EV',
  fresh.reference.cohort_ev_b, 242.5);

diagnostics.filteredScatter = {};
for (const ticker of ['AKAM', 'MARA', 'EQIX']) {
  const row = fresh.companies.find(c => c.t === ticker);
  const html = renderToStaticMarkup(React.createElement(ValuationScatter, { rows: [row] }));
  diagnostics.filteredScatter[ticker] = html;
  check('control', `${ticker} is suppressed by the publisher`, row.ev_per_mw, null);
  // MARA supplies a plain-ASCII reason, avoiding HTML entity comparison.
  if (ticker === 'MARA') check('F3', 'An excluded-only search retains its curated withholding reason',
    html.includes(row.ev_note), true);
}

// Mirrors the new browser test's loop input exactly.
const exercised = baked.companies.filter(c => c.ev_note).map(c => c.t).sort();
diagnostics.shippedSuppression = {
  loopIterations: exercised.length,
  rows: baked.companies.filter(c => ['AKAM','MARA','EQIX'].includes(c.t))
    .map(c => ({ ticker: c.t, ev_per_mw: c.ev_per_mw, ev_note: c.ev_note ?? null })),
  cohortEV: baked.reference.cohort_ev_b,
};
check('F4', 'The new browser-test suppression loop exercises the three configured exclusions',
  exercised, ['AKAM', 'EQIX', 'MARA']);
const full = renderToStaticMarkup(React.createElement(ValuationScatter, { rows: fresh.companies }));
check('control', 'The regenerated unfiltered scatter has two business median lines',
  (full.match(/class="cap-median"/g) || []).length, 2);
check('control', 'The regenerated table has cloud and landlord groups only',
  (full.match(/class="cap-table-group"/g) || []).length, 2);
console.log(JSON.stringify({ head, results, diagnostics }, null, 2));
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
