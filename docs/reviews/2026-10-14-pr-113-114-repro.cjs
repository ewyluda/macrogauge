// Uses the actual TypeScript functions, transpiled without changing the sources.
// Usage: node docs/reviews/2026-10-14-pr-113-114-repro.cjs /tmp/pr114-data
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'site/node_modules/typescript'));
const input = process.argv[2];
if (!input) throw new Error('Pass the directory created by the Python probe');
function compile(source) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  }}).outputText;
  vm.runInNewContext(js, { exports });
  return exports;
}
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
const momentum = compile(read('site/src/lib/momentum.ts'));
function pairFrom(component) {
  const source = read(`site/src/components/${component}.tsx`);
  const fn = source.match(/function pair\([\s\S]*?\n}/)?.[0];
  assert.ok(fn, `pair not found in ${component}`);
  return compile(fn + '\nexport { pair };').pair;
}
const daily = JSON.parse(fs.readFileSync(path.join(input, 'gauge_daily.json')));
const rep = JSON.parse(fs.readFileSync(path.join(input, 'replay.json')));
const used = rep.components.find(c => c.code === 'used_vehicles');
const own = momentum.lastChange(used.index);
const sixMonth = momentum.annualizedAt(used.index, rep.dates, 6, own, used.missing_months);
const corrected = momentum.annualizedAt(used.index, rep.dates, 6, own, ['2026-04']);
assert.ok(sixMonth < -8 && sixMonth > -9);
assert.equal(corrected, null);

const col = daily.variants.col;
const rates = momentum.rateSeries('ann3', col.yoy_pct, col.index, col.dates, col.missing_months);
const pairs = {};
for (const component of ['ColChart', 'HeroChart']) {
  const data = pairFrom(component)(col.dates, rates);
  pairs[component] = {
    october_points: data.filter(([d]) => d.startsWith('2025-10')).length,
    january_points: data.filter(([d]) => d.startsWith('2026-01')).length,
    interior_nulls: data.filter(([d, v]) => d >= '2025-09' && d <= '2026-02' && v === null).length,
  };
}
assert.equal(pairs.ColChart.interior_nulls, 0);
assert.equal(pairs.ColChart.october_points, 0);
assert.equal(pairs.HeroChart.interior_nulls, 62);
assert.equal(pairs.HeroChart.october_points, 31);
const evidence = {
  used_vehicles: { own_date: rep.dates[own], six_month_base: momentum.monthsBefore(rep.dates[own], 6),
    published_gap_metadata: used.missing_months, current_six_month_rate: sixMonth,
    with_actual_gap_metadata: corrected },
  charts: pairs,
};
fs.writeFileSync(path.join(input, 'javascript-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
