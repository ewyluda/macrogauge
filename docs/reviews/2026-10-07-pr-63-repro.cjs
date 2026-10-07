// Offline PR #63 review probes. Reads pinned Git source; does not edit the app,
// store, or published artifacts. Run: node docs/reviews/2026-10-07-pr-63-repro.cjs
// Exit 1 is intentional when the reviewed defects reproduce.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const head = '7111a5756480d6c977a0bb8e3c7d9aeb372df5c2';
const base = '5f589a0ddeb68b27add1fb4c6c26a7a62dbceaee';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const read = (file, ref = head) => execFileSync('git', ['show', `${ref}:${file}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Load the changed Python modules from pinned revisions. Dependencies used
// here (vintage.latest and write_json) are unchanged by this PR.
const python = String.raw`
import dataclasses, json, pathlib, sqlite3, subprocess, sys, tempfile, types
import jsonschema
head, base = sys.argv[1:]
root = pathlib.Path.cwd()
def read(file, ref=head):
    return subprocess.check_output(['git', 'show', ref + ':' + file], text=True)
def module(file, name, ref=head):
    m = types.ModuleType(name)
    m.__file__ = str(root / file)
    sys.modules[name] = m
    exec(compile(read(file, ref), m.__file__, 'exec'), m.__dict__)
    return m
loader = module('pipeline/dc_longlead.py', 'review_loader')
writer = module('pipeline/publish/longlead.py', 'review_writer')
old = module('pipeline/publish/longlead.py', 'review_base_writer', base)
baked = json.loads(read('site/public/data/longlead.json'))
components = [types.SimpleNamespace(code=p['code'], label=p['label'], weight=p['weight'])
              for p in baked['packages']]
config = json.loads(read('config/dc_longlead.json'))
schema = json.loads(read('schemas/longlead.schema.json'))
with tempfile.TemporaryDirectory(prefix='pr63-probe-') as tmp:
    p = pathlib.Path(tmp) / 'config.json'
    p.write_text(json.dumps(config))
    cfg = loader.load(p)
    def build(today):
        result = writer.build(cfg, components, None, today=today,
                              backlog=baked.get('backlog_months'))
        result['published_at'] = today + 'T12:00:00Z'
        jsonschema.Draft202012Validator(schema).validate(result)
        return result
    fresh = build('2026-10-07')
    aged = build('2027-04-01')
    # A supported partial curation update: switchgear moves to a new period
    # while the transformer observations retain their previous period.
    config['packages'][0]['lead_times'][0]['period'] = '2026-06-30'
    config['packages'][0]['lead_times'][0]['asof'] = '2026-08-04'
    p.write_text(json.dumps(config))
    cfg = loader.load(p)
    mixed = build('2026-10-07')

c = sqlite3.connect(':memory:')
c.execute('CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, '
          'vintage_date TEXT, source TEXT, route TEXT)')
c.executemany('INSERT INTO observations VALUES (?,?,?,"2026-10-07","test","test")',
    [(code, month, value)
     for month, uo, sh in [('2025-07-01', 0, 100), ('2026-07-01', 600, 100)]
     for code, value in [('fred_uo_electrical_sa', uo), ('fred_ship_electrical_sa', sh)]])
try:
    zero_head = {'result': writer.backlog_months(c), 'error': None}
except Exception as e:
    zero_head = {'result': None, 'error': type(e).__name__ + ': ' + str(e)}
zero_base = old.backlog_months(c)
print(json.dumps({'fresh': fresh, 'aged': aged, 'mixed': mixed,
                  'zero_head': zero_head, 'zero_base': zero_base,
                  'fixtures_schema_valid': True}))
`;
const fixtures = JSON.parse(execFileSync(path.join(root, '.venv/bin/python'),
  ['-c', python, head, base], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));

function compile(file, overrides = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = id => id in overrides ? overrides[id] : requireSite(id);
  new Function('require', 'module', 'exports', js)(localRequire, mod, mod.exports);
  return mod.exports;
}
const helpers = compile('site/src/lib/longLead.ts');
const format = compile('site/src/lib/format.ts');
const empty = () => null;
function render(data) {
  return renderToStaticMarkup(React.createElement(compile('site/src/app/longlead/page.tsx', {
    '../../../public/data/longlead.json': data,
    '@/lib/artifact': { artifact: (_, value) => value },
    '@/lib/longLead': helpers,
    '@/lib/format': format,
    '@/lib/csv': { flattenRow: x => x },
    '@/lib/chartTheme': { C: {} },
    '@/components/DownloadData': { DownloadData: empty },
    '@/components/LinesChart': { LinesChart: empty },
    '@/components/StaleBanner': { StaleBanner: empty },
  }).default));
}
const results = [];
function check(finding, name, actual, expected) {
  results.push({ finding, name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
}
const allLeads = data => data.packages.flatMap(p => p.lead_times ?? []);
const freshText = helpers.leadTakeaway(allLeads(fixtures.fresh));
const mixedText = helpers.leadTakeaway(allLeads(fixtures.mixed));
const agedHtml = render(fixtures.aged);
const agedBenchmark = agedHtml.match(/<p class="ll-board-note">([\s\S]*?)<\/p>/)[1];
const plain = text => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// F1: the ratio cannot identify new orders. Both periods satisfy
// U_end = U_start + net_new_orders - shipments.
const demandCounterexample = [
  { period: 'year_ago', start: 100, orders: 100, shipments: 100, end: 100 },
  { period: 'current', start: 150, orders: 70, shipments: 120, end: 100 },
];
check('control', 'Counterexample satisfies the backlog accounting identity',
  demandCounterexample.every(p => p.start + p.orders - p.shipments === p.end), true);
check('F1', 'The methodology does not categorically rule out cooling demand',
  render(fixtures.fresh).includes('not that demand cooled'), false);

check('F2', 'Partial survey updates preserve both observation periods in the headline',
  mixedText.includes('Q2 2025') && mixedText.includes('Q2 2026'), true);
check('F2', 'The vendor horizon clause includes its own observation or statement date',
  /2026/.test(freshText.split(';').at(-1)), true);
check('control', 'A single survey retains its original quarter in the headline',
  freshText.includes('industry survey, Q2 2025'), true);

check('F3', 'A zero year-ago unfilled-order balance does not abort backlog_months',
  fixtures.zero_head.error, null);
check('control', 'The base computes valid backlog ratios for the same zero-base fixture',
  fixtures.zero_base.electrical.ratio, [0, 6]);

check('control', 'The publisher ages the JLL benchmark to stale on April 1, 2027',
  fixtures.aged.lead_time_benchmark.stale, true);
check('F4', 'The displayed benchmark communicates its published stale status',
  /stale/i.test(agedBenchmark), true);
check('control', 'A stale package lead-time row already carries a stale badge',
  /ll-leads[\s\S]*?ll-tag-stale/.test(agedHtml), true);
check('control', 'Fresh, mixed-period and aged fixtures satisfy the schema',
  fixtures.fixtures_schema_valid, true);

const failed = results.filter(r => !r.pass).length;
console.log(JSON.stringify({ head, base, results, failed,
  diagnostics: { freshHeadline: freshText, mixedHeadline: mixedText,
    agedBenchmark: plain(agedBenchmark), zeroBacklog: fixtures.zero_head,
    demandCounterexample,
    counterexampleRatio: [1, 100 / 120], counterexampleNewOrdersYoY: -30,
    counterexampleShipmentsYoY: 20, counterexampleUnfilledYoY: 0,
    browserFinding: 'F5 requires the browser reflow steps in the review report.' } }, null, 2));
process.exitCode = failed ? 1 : 0;
