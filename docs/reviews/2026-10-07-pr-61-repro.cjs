// Offline PR #61 frontend probes. No application files or fixtures change.
// Run: node docs/reviews/2026-10-07-pr-61-repro.cjs [git-ref]
// Source/fixtures are read from the pinned commit; installed TS/React render
// the real page with synthetic data. Unrelated visual components are stubbed.
// Exit 1 means the review's correctness assertions failed as expected.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const ref = process.argv[2] || '360b7a6a0d8fd012b0663ff80c69c6754559697e';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const read = (file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' });
const results = [];
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
  const localRequire = (id) => id in overrides ? overrides[id] : requireSite(id);
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
const L = compile('site/src/lib/cloudGpu.ts');
const baked = JSON.parse(read('site/public/data/compute.json'));
const quote = (provider, price, day) => ({ code: `${provider}_h100`, provider, gpu: 'H100',
  instance: 'review fixture', gpus_per_instance: 8, region: 'review fixture',
  usd_per_gpu_hr: price, usd_per_instance_hr: price * 8, as_of: day, chg_30d_pct: null });
const data = { ...baked, published_at: '2026-10-21T12:00:00Z',
  cloud_gpus: [quote('AWS', 6.88, '2026-10-07'), quote('Azure', 12.29, '2026-10-21')],
  gpus: [{ code: 'vast_h100_sxm', label: 'H100 SXM (vast.ai)', usd_per_gpu_hr: 1.92,
    as_of: '2026-10-07', chg_30d_pct: null, tail: { dates: [], values: [] }, in_index: true }],
};
const rows = L.cloudRows(data);
const lead = L.cloudTakeaway(rows);
check('F4', 'The current-price takeaway does not recommend an expired quote without qualification',
  lead.includes('$6.88'), false);
check('F4', 'The current-price takeaway does not compare an expired marketplace quote without qualification',
  lead.includes('$1.92'), false);

const empty = () => null;
const overrides = {
  '../../../public/data/compute.json': data,
  'next/link': ({ children, href }) => React.createElement('a', { href }, children),
  '@/lib/artifact': { artifact: (_, payload) => payload },
  '@/lib/cloudGpu': L,
  '@/lib/chartTheme': { C: {} },
  '@/lib/computeCsv': { computeIndexRows: () => [] },
  '@/lib/format': { fmtSigned: (v) => String(v), yoyColor: () => 'inherit' },
  '@/components/Section': { Section: ({ id, title, children }) => React.createElement('section',
    { id }, React.createElement('h2', null, title), children) },
};
for (const name of ['KpiCard', 'LinesChart', 'TailSpark', 'DownloadData', 'Citation']) {
  overrides[`@/components/${name}`] = { [name]: empty };
}
const Page = compile('site/src/app/compute/page.tsx', overrides).default;
const html = renderToStaticMarkup(React.createElement(Page));
const cloudHtml = html.match(/<section id="cloud-gpus">[\s\S]*?<\/section>/)[0];
const visible = cloudHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('F4', 'A stale retained quote has a visible observation date', visible.includes('2026-10-07'), true);
check('control', 'The hidden title attribute retains the date', cloudHtml.includes('as of 2026-10-07'), true);
check('control', 'The synthetic input produces the H100 table row', rows.length, 1);

const aws = JSON.parse(read('tests/fixtures/aws_gpu_prices.json'));
const cw = read('tests/fixtures/coreweave_pricing.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const diagnostics = {
  takeaway: lead,
  staleQuoteIsBold: cloudHtml.includes('<strong>$6.88</strong>'),
  visibleCloudText: visible,
  a100AwsInstance: Object.values(aws.regions['US East (N. Virginia)'])
    .find((r) => r['Instance Type'] === 'p4d.24xlarge')['Instance Type'],
  a100CoreweaveGpuCountAndVram: cw.match(/NVIDIA A100 (\d+) (\d+) /)?.slice(1),
  coreweavePublishesH100Spot: cw.includes('NVIDIA HGX H100 On-Demand Price: $49.24 / Hour Spot Price: $19.71 / Hour'),
};
const failed = results.filter((r) => !r.pass).length;
console.log(JSON.stringify({ ref, results, diagnostics, failed }, null, 2));
process.exitCode = failed ? 1 : 0;
