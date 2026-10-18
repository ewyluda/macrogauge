/* Offline PR #132 review probe. Reads immutable Git objects; changes no source
 * or published data. Run from any directory:
 * node docs/reviews/2026-10-18-pr-132-repro.cjs [evidence-output.json]
 * Uses the repository's installed TypeScript compiler. React hooks and the
 * EChart render boundary are mocked so the actual component options can be
 * inspected without a browser. This is not a pixel-rendering test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const siteRequire = createRequire(path.join(root, 'site/package.json'));
const ts = siteRequire('typescript');
const HEAD = 'd00d18938558a0e7238adf9f397978a350fc9588';
const BASE = 'b181dfcb6b79e554194ac1da3790e25085d4736d';
const git = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const jsx = (type, props) => ({ type, props });
const EChart = function EChart() {};

function loader(ref) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const compiled = ts.transpileModule(git(ref, file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const requireForFile = (name) => {
      if (name === 'react') return { useMemo: (fn) => fn(), useState: (v) => [v, () => {}] };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === './EChart') return { EChart };
      if (name === './RateModeControl') return { useRateMode: () => ['yoy', () => {}], RateModeControl: () => null };
      if (name === './SegmentedControl') return { SegmentedControl: () => null };
      if (name === '@/lib/useUrlState') return { useUrlState: (_k, v) => [v, () => {}] };
      if (name === '@/lib/urlState') return { codecs: { enumOf: () => ({}) } };
      let target = name.startsWith('@/') ? `site/src/${name.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
      if (!/\.tsx?$/.test(target)) target += '.ts';
      return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: `${ref.slice(0, 7)}/${file}` })(requireForFile, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

function optionOf(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === EChart) return node.props.option;
  for (const child of [node.props?.children].flat(Infinity)) {
    const option = optionOf(child);
    if (option) return option;
  }
  return null;
}

const head = loader(HEAD);
const base = loader(BASE);
const { closeStep, pairWithBreaks } = head('site/src/lib/chartPairs.ts');
const compare = JSON.parse(git(HEAD, 'site/public/data/compare.json'));
const n = compare.months.indexOf('2025-11-01') + 1;
assert(n > 2);
const months = compare.months.slice(0, n);
const official = compare.official_yoy_pct.slice(0, n);
const core = compare.official_core_yoy_pct.slice(0, n);
assert.deepEqual(months.slice(-2), ['2025-09-01', '2025-11-01']);

function consumerTails(load) {
  const hero = load('site/src/components/HeroChart.tsx').HeroChart({
    dates: months, gauge: official, tracker: official, months, official, core,
  });
  const col = load('site/src/components/ColChart.tsx').ColChart({
    dates: months, col: official, gauge: official, months, official,
  });
  const lines = load('site/src/components/LinesChart.tsx').LinesChart({
    series: [{ name: 'Official CPI', x: months, y: official, color: '#526170', step: true }],
  });
  return Object.fromEntries(Object.entries({ HeroChart: hero, ColChart: col, LinesChart: lines })
    .map(([name, el]) => [name, optionOf(el).series.find((s) => s.name === 'Official CPI').data.slice(-3)]));
}

const consumers = consumerTails(head);
const baseConsumers = consumerTails(base);
for (const name of Object.keys(consumers)) {
  assert.equal(consumers[name].at(-1)[0], '2025-12-31');
  assert.equal(baseConsumers[name].at(-1)[0], '2025-11-01');
}
const quarterly = closeStep([['2026-01-01', 1], ['2026-04-01', 2]]);
assert.equal(quarterly.at(-1)[0], '2026-06-30');
const daily = [['2026-10-16', 4], ['2026-10-17', 4]];
assert.equal(closeStep(daily), daily);
const nullEnd = [['2026-08-01', 1], ['2026-09-01', null]];
assert.equal(closeStep(nullEnd), nullEnd);
const current = closeStep(pairWithBreaks(compare.months, compare.official_yoy_pct));
assert.equal(current.at(-1)[0], '2026-09-30');

const evidence = {
  pr: 132, head: HEAD, base: BASE,
  method: 'Actual TS helpers and chart components evaluated with mocked React hooks and render boundary; no browser rendering or data mutation.',
  monthly_gap: {
    fixture: 'Committed compare.json truncated at its November 2025 observation; October 2025 is absent in the actual artifact.',
    last_observations: pairWithBreaks(months, official).slice(-3),
    expected_month_end: '2025-11-30', actual_synthetic_end: '2025-12-31',
    extra_days: 31, head_consumer_tails: consumers, base_consumer_tails: baseConsumers,
  },
  controls: {
    current_cpi_tail: current.slice(-3), quarterly_tail: quarterly,
    daily_unchanged: true, null_ended_unchanged: true,
  },
};
const json = JSON.stringify(evidence, null, 2) + '\n';
if (process.argv[2]) fs.writeFileSync(process.argv[2], json);
process.stdout.write(json);
