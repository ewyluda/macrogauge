// Independent review probes. No application files or fixtures are changed.
// Run from any directory: node docs/reviews/2026-10-07-pr-60-repro.cjs [git-ref]
// The reviewed commit intentionally fails the correctness assertions below.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const ref = process.argv[2] || 'd14b0aa20fedf4017fa6d92b02734d102ff6cf27';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const read = (file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' });
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  function localRequire(id) {
    if (id.startsWith('@/')) return load(`site/src/${id.slice(2)}.ts`);
    if (id.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), `${id}.ts`));
    return requireSite(id);
  }
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}

const L = load('site/src/lib/newsTape.ts');
const { NewsFeed } = load('site/src/components/NewsFeed.tsx');
const news = JSON.parse(read('site/public/data/news.json'));
const React = requireSite('react');
const { renderToStaticMarkup } = requireSite('react-dom/server');
const render = (posts) => renderToStaticMarkup(React.createElement(NewsFeed, { snapshot: { ...news, live_url: null, posts } }));
let id = 0;
const post = (headline, over = {}) => ({
  id: `probe-${++id}`, ts: '2026-10-07T12:00:00Z', category: 'company', kind: 'text', headline,
  points: [{ label: 'Detail', text: 'Supporting detail.' }],
  tickers: [{ ticker: 'MSFT', layer: 'Cloud Delivery' }], impacted: [], url: null, has_media: false, ...over,
});
const results = [];
function check(finding, name, actual, expected) {
  let pass = true;
  try { assert.deepEqual(actual, expected); } catch { pass = false; }
  results.push({ finding, name, pass, actual, expected });
}

check('control', 'Pinned tape has 138 stories', L.clusterStories(news.posts).length, 138);
check('F1', 'Unrelated deals with an equal amount stay separate', L.sameStory(
  post('Microsoft signs $5 billion contract with Duke Energy for nuclear electricity'),
  post('Microsoft acquires cybersecurity startup for $5 billion to expand cloud security'),
), false);
check('F1', 'Different campuses and capacities stay separate', L.sameStory(
  post('Microsoft opens 200 MW data center in Texas'),
  post('Microsoft opens 900 MW data center in Finland'),
), false);

const old = post('Microsoft secures 500 MW nuclear power agreement for new data centers', { ts: '2026-10-06T12:00:00Z' });
const cancellation = post('MICROSOFT CANCELS 500 MW NUCLEAR POWER AGREEMENT FOR NEW DATA CENTERS', { points: [] });
check('F2', 'Latest cancellation leads the story', L.clusterStories([cancellation, old])[0].lead.id, cancellation.id);

const micron = news.posts.filter((p) => ['3A7F621BC65A120A9A5C', '3AE4E2920EF79F8855F5'].includes(p.id));
check('F3', 'Folded Micron Q1 guidance remains in rendered markup', render(micron).includes('Revenue of $61.5 billion'), true);
check('F4', 'Capacity parser consumes a complete grouped decimal', L.figures(post('Microsoft opens a 1,250.5 MW data center campus in Texas'))[0].value, 1250.5);

const revenueAndDeal = post('Microsoft reported $100 billion of revenue and signed a $5 billion data center financing deal');
check('F5', 'Deal dollars excludes revenue in the same sentence', L.topFigures(L.clusterStories([revenueAndDeal]), 'dollars', 1)[0].figure.value, 5e9);

const blackHills = news.posts.find((p) => p.id === '3A00216F4A1F698DA7A8');
check('F6', 'Signed Black Hills agreement retains its stated capacity', L.figures(blackHills).some((f) => f.value === 590), true);
check('F6', 'A completed project is not a forecast', L.figures(post('Microsoft completed its 500 MW data center project in Texas')).some((f) => f.value === 500), true);
check('F6', 'The month May is not a forecast', L.figures(post('Microsoft signed a 500 MW power agreement in May')).some((f) => f.value === 500), true);
check('control', 'Short substantive headline with details is not a stub', L.noiseReason(post('NVIDIA HALTS GPU SHIPMENTS')), null);
check('control', 'Single-company premarket deal is not a roundup', L.noiseReason(post('Microsoft shares rose premarket after signing a 500 MW power contract')), null);
check('F7', 'Short substantive wire flash without details is not a stub', L.noiseReason(post('NVIDIA HALTS GPU SHIPMENTS', { points: [] })), null);
check('F10', 'All-capitals MAY is still a forecast', L.figures(post('MICROSOFT MAY ADD 500 MW OF DATA CENTER CAPACITY IN TEXAS', { points: [] })), []);

// F8: model valid future snapshots for the smoke test, without modifying the
// baked artifact. Only the last story has repeats; all 41 predecessors are
// independent ticker-specific posts, so it cannot be on the first 40-row page.
const singles = Array.from({ length: 41 }, (_, i) => post(`Company ${i} opens a new data center campus`, {
  tickers: [{ ticker: `T${i}`, layer: 'Cloud Delivery' }],
}));
const latePair = [
  post('Microsoft secures 333 MW power contract for an AI campus', { ts: '2026-10-06T12:00:00Z' }),
  post('Microsoft secures 333 MW power contract for an AI campus', { ts: '2026-10-06T11:00:00Z' }),
];
const latePosts = [...singles, ...latePair];
const lateStories = L.clusterStories(latePosts).filter((s) => s.infra);
const lateHtml = render(latePosts);
const initialRowsHtml = lateHtml.slice(lateHtml.indexOf('<li class="news-item"'));
const testAssumptions = {
  firstFoldedIndex: lateStories.findIndex((s) => s.also.length),
  foldedHeadlinePresentInInitialStoryRows: initialRowsHtml.includes(latePair[0].headline),
  emptyTapeHasModeNote: render([]).includes('data-testid="news-mode-note"'),
  emptyInfraStories: L.clusterStories([]).filter((s) => s.infra).length,
};

const chain = [0, 3, 6].map((days) => post('Microsoft signs 500 MW agreement for new data center campus', {
  ts: `2026-10-${String(7 - days).padStart(2, '0')}T12:00:00Z`,
}));
check('F9', 'Every cluster stays within the advertised 96-hour span', L.clusterStories(chain).every((s) => {
  const dates = [s.lead, ...s.also].map((p) => Date.parse(p.ts));
  return Math.max(...dates) - Math.min(...dates) <= L.STORY_WINDOW_H * 3600000;
}), true);

console.log(JSON.stringify({ ref, results, testAssumptions, failed: results.filter((r) => !r.pass).length }, null, 2));
process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
