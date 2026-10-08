/* Independent, offline review probes. Usage: node <this-file> [repository-root].
 * Uses the repository's locked TypeScript/React dependencies; changes no inputs.
 * Assertions describe the observed defects at a235fe3, not desired behavior.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const site = path.join(root, 'site');
const req = Module.createRequire(path.join(site, 'package.json'));
const ts = req('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('@/')) name = path.join(site, 'src', name.slice(2));
  return resolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, file) => {
  const text = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
  }).outputText;
  m._compile(text, file);
};
const lib = name => require(path.join(site, 'src/lib', name));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const component = name => require(path.join(site, 'src/components', name));
const findings = {};

// PR 71: headline's change and attribution use different end dates.
findings.rates_window = lib('ratesHeadline.ts').ratesHeadline(
  { value: 5, chg_1y_pp: 1 }, { value: 6.19, chg_1y: 1.19 },
  { as_of: '2026-09-30', base_date: '2025-09-30', yield_chg_1y: -1.1, oas_chg_1y: -1 },
);
assert.match(findings.rates_window.title, /up 119bp.*mostly from the credit spread/);
assert.match(findings.rates_window.detail, /−110bp/);

// PR 81: two distinct, multi-word places sharing their first token collapse.
const post = (id, place) => ({ id, ts: '2026-10-08T15:00:00Z',
  headline: `Microsoft opens a 500 MW data center in ${place}`, points: [],
  tickers: [{ ticker: 'MSFT', layer: 'hyperscalers' }], url: `https://example.com/${id}` });
const news = lib('newsTape.ts');
const posts = [post('ny', 'New York'), post('nj', 'New Jersey')];
findings.multiword_places = { headlines: posts.map(p => p.headline),
  sameStory: news.sameStory(...posts), stories: news.clusterStories(posts).length };
assert.equal(findings.multiword_places.stories, 1);

// PR 83: supported nonpositive power prices produce invalid SVG geometry.
const { HubMap } = component('HubMap.tsx');
const hubs = [
  { code: 'ice_pjm_west', label: 'PJM West', avg30: 20, avg30_yoy_pct: null },
  { code: 'caiso_sp15_da', label: 'CAISO SP15', avg30: -5, avg30_yoy_pct: null },
];
const map = renderToStaticMarkup(React.createElement(HubMap, { hubs }));
const zeroMap = renderToStaticMarkup(React.createElement(HubMap, { hubs: [{ ...hubs[0], avg30: 0 }] }));
findings.power_map = { mixed_price_radii: [...map.matchAll(/<circle[^>]+r="([^"]+)"/g)].map(m => m[1]),
  negative_price_invalid: map.includes('r="NaN"'), all_zero_invalid: zeroMap.includes('r="NaN"') };
assert.equal(findings.power_map.negative_price_invalid, true);
assert.equal(findings.power_map.all_zero_invalid, true);

// PR 90: an observed latest month is reported as unavailable instead of 0%.
const since = lib('escalationSince.ts');
const s = { key: 'example', label: 'Example', group: 'test', source: 'fixture',
  months: ['2026-08', '2026-09'], values: [100, 102] };
findings.same_month = { sinceRow: since.sinceRow(s, '2026-09', 1000000),
  rebased: since.rebased(s, '2026-09') };
assert.equal(findings.same_month.sinceRow, null);
assert.deepEqual(findings.same_month.rebased.values, [100]);
findings.amount_roundtrip = {
  typed: -100, displayed_escalated: since.sinceRow(s, '2026-08', -100).escalated,
  url_decoded: lib('urlState.ts').codecs.float(1, 1e12).parse('-100') ?? null,
  reload_fallback: 1000000,
};
assert.equal(findings.amount_roundtrip.url_decoded, null);

// PR 91: a hump with a completely flat year-ago denominator is called base effect.
findings.outlook_causality = lib('outlookHeadline.ts').outlookShape('2026-09', 2,
  [{ month: '2026-10', central_yoy_pct: 3 }, { month: '2026-11', central_yoy_pct: 2 }],
  { '2025-09': 100, '2025-10': 100, '2025-11': 100 });
assert.match(findings.outlook_causality.baseNote, /Much of the hump is base effect/);
assert.equal((findings.outlook_causality.baseNote.match(/rose 0.0%/g) || []).length, 2);

// PR 91: inverse-error weights are a supported producer mode; the new legend ignores them.
const { ForecasterDots } = component('ForecasterDots.tsx');
const dots = renderToStaticMarkup(React.createElement(ForecasterDots, { rows: [{ label: 'CPI',
  ensemble: 0.16, forecasters: [{ name: 'Macrogauge', value: 0.1 }, { name: 'Cleveland', value: 0.4 }] }] }));
findings.weighted_legend = { ensemble: 0.16, arithmetic_mean: 0.25,
  legend: dots.includes('equal-weight ensemble') ? 'equal-weight ensemble' : null };
assert.equal(findings.weighted_legend.legend, 'equal-weight ensemble');

// PR 92: the compare links exist for five hardware components absent from the calculator.
const dc = JSON.parse(fs.readFileSync(path.join(site, 'public/data/datacenter.json')));
const keys = new Set(['dc_build', 'dc_ops', 'dc_hardware', 'gauge', ...(dc.clause_series || []).map(x => x.code)]);
findings.hardware_links = ['hw_imported', 'semis_components', 'imported_semis', 'storage', 'network']
  .map(code => ({ code, offered_in_calculator: keys.has(code), url: `/calculator?series=${code},dc_hardware` }));
assert.equal(findings.hardware_links.filter(x => x.offered_in_calculator).length, 0);

// PR 93: full-history MAEs can reverse a ranking on the common graded month.
const lb = { basis: 'SA', window: 12, min_n_for_weights: 6, weights_earned: false,
  rows: [
    { reference_period: '2026-07', forecasts: { macrogauge: { error: 0 } } },
    { reference_period: '2026-08', forecasts: { macrogauge: { error: 1 }, cleveland: { error: 0.6 } } },
  ], stats: { macrogauge: { n: 2, mae_pp: 0.5, bias_pp: 0.5 }, cleveland: { n: 1, mae_pp: 0.6, bias_pp: 0.6 } } };
findings.scoreboard_windows = { takeaway: lib('scoreboardHeadline.ts').headToHeadTakeaway(lb),
  common_month: '2026-08', common_errors: { macrogauge: 1, cleveland: 0.6 } };
assert.match(findings.scoreboard_windows.takeaway, /Macrogauge has the smallest miss.*last 1 graded print/);

// PR 93: the rate-driven annotation fires with unchanged mortgage rates.
const dates = Array.from({ length: 61 }, (_, i) => new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10));
const yoy = dates.map((_, i) => 3 + i / 30);
findings.col_causality = lib('colJump.ts').colJump(dates, yoy, yoy, { now: 6, nowAsOf: dates.at(-1), yearAgo: 6 });
assert.ok(findings.col_causality);

// PR 93: pp gap chart inherits percent labels without overriding yAxis.
const personal = fs.readFileSync(path.join(site, 'src/components/MyInflationClient.tsx'), 'utf8');
const gapBlock = personal.slice(personal.indexOf('...baseOption()'), personal.indexOf('...baseOption()') + 1800);
findings.personal_gap_unit = { axis_formatter: lib('chartTheme.ts').baseOption().yAxis.axisLabel.formatter,
  gap_block_overrides_axis: /yAxis\s*:\s*\{/.test(gapBlock), tooltip_uses_pp: gapBlock.includes('toFixed(2)}pp') };
assert.equal(findings.personal_gap_unit.axis_formatter, '{value}%');
assert.equal(findings.personal_gap_unit.gap_block_overrides_axis, false);
assert.equal(findings.personal_gap_unit.tooltip_uses_pp, true);

const negativeMover = { label: 'Example hub', section: 'AI Infra', kind: 'level', unit: '$/MWh',
  value: 10, prev_value: -10, delta: -200, delta_unit: '%', significance: 66.67 };
findings.negative_power_headline = lib('changesHeadline.ts').changesHeadline([negativeMover]);
assert.match(findings.negative_power_headline, /fell 200.0% to \$10.00\/MWh/);

console.log(JSON.stringify({ reviewed_commit: 'a235fe378cb96c44955be96b7e91ec8a9739fd2e',
  fixtures_are_synthetic_except_hardware_roster: true, findings }, null, 2));
