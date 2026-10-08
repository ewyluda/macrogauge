// Offline review evidence for PR #69. Run from any directory:
// node docs/reviews/2026-10-07-pr-69-repro.cjs
// Exit 1 is expected: the corrective provenance assertion fails at this head.
// Reads pinned Git objects; writes only stdout; never changes published data.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const head = '79623ff81f6e0155a98d6d794853046c9b31c2a4';
const requireSite = createRequire(path.join(root, 'site/package.json'));
const ts = requireSite('typescript');
const git = (...args) => execFileSync('git', args,
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const read = file => git('show', `${head}:${file}`);
const moduleUnderReview = { exports: {} };
const js = ts.transpileModule(read('site/src/lib/ledgerSeries.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('module', 'exports', js)(moduleUnderReview, moduleUnderReview.exports);
const { ledgerCommitsUrl, todayAtPublishes, LEDGER_SERIES } = moduleUnderReview.exports;
const ledger = JSON.parse(read('site/public/data/ledger.json'));
const dc = JSON.parse(read('site/public/data/datacenter.json'));
const gauge = JSON.parse(read('site/public/data/gauge_daily.json'));

// Discover the first commit that actually added each published_at row.
// This distinguishes the September backfill from the original publish date.
const appended = new Map();
let commit;
for (const line of git('log', '--reverse', '--format=COMMIT %H %cI', '-p', head,
  '--', 'store/ledger/pulse.jsonl').split('\n')) {
  if (line.startsWith('COMMIT ')) {
    const [, sha, committedAt] = line.split(' ');
    commit = { sha, committedAt };
  } else if (line.startsWith('+{')) {
    const row = JSON.parse(line.slice(1));
    if (!appended.has(row.published_at)) appended.set(row.published_at, commit);
  }
}

// Be generous to the URL: include the ENTIRE next day as well. A commit
// outside even that range cannot be returned by this publish-day filter.
function evidence(row) {
  const url = ledgerCommitsUrl('ewyluda/macrogauge', row.published_at);
  const query = new URL(url).searchParams;
  const addition = appended.get(row.published_at);
  assert.ok(addition, `No append commit found for ${row.published_at}`);
  const commitDay = new Date(addition.committedAt).toISOString().slice(0, 10);
  return { publishedAt: row.published_at, url, appendCommit: addition.sha,
    appendCommittedAt: addition.committedAt,
    appendCommitWithinEvenInclusiveWindow:
      commitDay >= query.get('since') && commitDay <= query.get('until') };
}

const checks = [];
function check(name, actual, expected) {
  let pass = true;
  try { assert.deepEqual(actual, expected); } catch { pass = false; }
  checks.push({ name, pass, actual, expected });
}

const archived = ledger.rows.filter(r => r.date === '2026-08-12').at(-1);
const latest = ledger.rows.at(-1);
const archivedEvidence = evidence(archived);
const latestEvidence = evidence(latest);
const unreachable = ledger.rows.map(evidence)
  .filter(e => !e.appendCommitWithinEvenInclusiveWindow);
check('F1: archived row link includes the commit that appended it',
  archivedEvidence.appendCommitWithinEvenInclusiveWindow, true);
check('Control: latest live row link includes its append commit',
  latestEvidence.appendCommitWithinEvenInclusiveWindow, true);

// Independent reference-date oracle against every committed row and series.
const history = { dc_build: dc.indexes.build, dc_hardware: dc.indexes.hardware,
  dc_ops: dc.indexes.ops, gauge: gauge.variants.gauge };
for (const series of LEDGER_SERIES) {
  const h = history[series.key];
  const expected = ledger.rows.map(row => {
    const wanted = row[series.asOf] ?? row.date;
    const index = h.dates.findIndex(date => date === wanted);
    return index < 0 ? null : h.yoy_pct[index] ?? null;
  });
  const actual = todayAtPublishes(ledger.rows, series.asOf, h.dates, h.yoy_pct);
  check(`Control: ${series.key} matches every row's reference date`,
    actual.every((value, index) => value === expected[index]), true);
}

const result = {
  reviewedHead: head,
  diagnostics: {
    totalRows: ledger.rows.length,
    rowsBeforeLedgerCreation: ledger.rows.filter(r => r.date < '2026-09-03').length,
    unreachableEvenWithInclusiveNextDay: unreachable.length,
    firstUnreachablePublish: unreachable[0].publishedAt,
    lastUnreachablePublish: unreachable.at(-1).publishedAt,
    archived: archivedEvidence,
    liveControl: latestEvidence,
  },
  checks,
  passed: checks.filter(c => c.pass).length,
  failed: checks.filter(c => !c.pass).length,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.failed ? 1 : 0;
