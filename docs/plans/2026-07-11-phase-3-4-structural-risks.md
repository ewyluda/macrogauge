# Phase 3/4 structural risks — pickup note (2026-07-11)

Context: the 2026-07-11 xhigh code review of `450fea1` (Phase 3 nowcast) +
`b1c51ef` (Phase 4 composites) found five model-math bugs and three structural
risks. **The math bugs are fixed** (Kalshi CDF expectation + nearest-event
scoping, NFP real 2-param OLS + claims converted to thousands, fuel WTI
$/bbl → $/gal at 42 gal/bbl, CPI nowcast window clamped to the target month,
heatcheck momentum diff-mode for rates/spreads + cadence-scaled periods —
covered by 11 new tests, suite at 239). **The three structural risks below are
NOT fixed** and are the next session's work, roughly in this order.

## Risk 1 — one nowcast failure takes down composites and gauge QA; the release calendar guarantees it on 2026-12-11

Mechanism (`pipeline/run_daily.py:158-183`): the phase-3 block sits inside the
single engine `try:` **before** the composites writers and **before** the
`gauge_qa`/`artifacts` assignment. Any exception there — and
`models.build_latest` (`pipeline/engine/nowcast/models.py`) hard-raises
`ValueError("release calendar has no future CPI print")` when
`release_calendar.next_print()` returns `None` — falls to the generic
`except`, so:

- `engine_ok` goes critical-false in qa.json even though the gauge published fine;
- heatcheck/stress/recession (which don't depend on the CPI calendar at all)
  silently stop updating along with all 8 phase-3 files;
- qa.json loses the CRITICAL gauge checks (`gauge_current`,
  `gauge_components_present`, `basket_weights_sum`) for artifacts already deployed.

The trigger is not hypothetical: `config/release_calendar.json`'s last entry is
**2026-12-10**, so every run from **2026-12-11** fails this way until the 2027
calendar is hand-added (the ~Oct calendar-refresh task is the same deadline).

Fix direction: calendar exhaustion should degrade the nowcast (publish
`status: "unavailable"` / keep `pulse`'s `next_print: null` convention), not
raise; and the phase-3 + phase-4 blocks should each have their own isolation so
a nowcast failure can't freeze composites or eat gauge QA. No test currently
covers "phase-3 fails but gauge is fine" — add one (existing isolation tests
only break `gauge_engine.run` at the top).

## Risk 2 — valid degraded artifacts break the site build (deploy outage)

Mechanism: pages statically import the committed JSON, so TypeScript types are
inferred from the *current sample*, and `next build` (no `ignoreBuildErrors`)
fails when a differently-shaped but valid artifact is committed by the bot:

- `build_fuel`'s degraded branch emits only `{published_at, available: false,
  formula}` — no `forward_2wk`/`proxy`/`as_of`. The next build after such a
  publish fails with TS2339 at `site/src/app/page.tsx:160` and
  `site/src/app/next-print/page.tsx:7` (reproduced with the site's tsc). The
  runtime `fuel.available ?` guards can't save a compile error. Trigger:
  `fmp_wti` < 2 store rows or empty `aaa_gas_d` (fresh/rebuilt store).
- Same class: any page reading an array that can legally publish empty types it
  as `never[]`. The heatcheck page got a cast in today's fix wave; the other
  new pages (scoreboard/stress/matrix) use ad-hoc `as` casts — fine until a
  field goes missing.

Fix direction: pick one — (a) make every degraded shape carry all keys with
nulls (pipeline side) and encode that in real schemas, or (b) type the imports
from a hand-written `types.ts` instead of inference (site side, e.g.
`import fuel from ...json` then `fuel as Fuel`). (a) is stronger: it also fixes
the schema gap below. Related: the one-line permissive schemas
(releases/accountability/nextprint/stress/recession — untyped arrays; fuel with
no conditional requireds) mean a malformed artifact validates, deploys, and
only fails in the browser — tighten them to the backtest.schema.json standard
(array `items` + `required`).

## Risk 3 — the deployed data directory bypassed the collect→publish→validate→qa loop

State committed by last night's work (still live until the next full daily run):

- phase-3 files stamped `published_at 2026-07-11T01:40:06Z`, composites
  `01:53:28Z` — two different partial runs;
- `qa.json` (13 checks, 2026-07-10) and `sources_status.json` (12 sources)
  predate phase 3/4 entirely — nothing covers the 11 new artifacts;
- `stress.json` is empty (score null, zero indicators), `recession.json` has
  all six signals null (the 28 new FRED series had zero store rows), and
  `heatcheck.json` publishes score 54.8 off 18.8% coverage.

The next successful full run heals the files, but the loophole stays: partial/
manual runs can commit artifact sets that no qa.json describes, and
`run_daily.py` validates phase-3/composite files **after** `write_all` has put
all of them on disk — a mid-loop failure (e.g. a file missing from the
hand-maintained `schema_by_name` dict at `pipeline/run_daily.py:164` raising
KeyError, swallowed by the generic except) exits 0 with unvalidated JSON in
`site/public/data`, which the daily workflow commits and deploys.

Fix direction: validate-immediately-after-each-write (pass the schema into the
writer, mirroring the strict-writer pattern), derive the schema name from
`path.stem` everywhere (kill `schema_by_name`), and consider a qa check that
every `*.json` in the out dir shares one `published_at` run stamp.

## Also open (below the fix line, from the same review)

- Benchmark provenance: `latest_benchmarks` has no staleness/reference-month
  filter; cleveland/street/kalshi use three different obs_date conventions;
  `build_nextprint` restamps benchmark `as_of` to today (`pipeline/publish/phase3.py:17,92`).
- Grading month-adjacency: `build_accountability` + `backtest._mom` treat
  consecutive first-release rows as adjacent months; CPI 2025-10 is already
  missing in the store, so 2025-11's "actual" is a 2-month change.
- Cleveland staleness false-flag: obs_date = reference-month start vs
  `max_staleness_days: 5` → `sources_fresh` fails ~all month (config/series.json:87).
- Cleveland drift protection: no plausible-value range check, no recorded
  fixture in tests/fixtures/, bypasses `util.get_text` (CLAUDE.md scrape rule).
- CPI_PARAMS (`fuel_beta`/`rent_lag_months`/`rent_w`) still published but
  unused by `cpi_nowcast`, pinned by a critical qa check and /cpi-preview prose.
- street.py: no country filter; `estimate: null` + populated `consensus` is
  skipped; first-match can grab Core CPI.
- NFP forecasts recorded under the CPI print's reference month target an
  already-released NFP for ~2 weeks each month.
- Cleanup cluster: duplicated `_write`, 4 MoM helpers, `_month_start`/
  `_previous_month`/`_next_month` vs `official._months_back`/`util.month_first`,
  PageShell nav missing /matrix /gap /vs-bls /next-print /stress, stress.json
  embeds full value histories, backtest O(months²) `as_of` scans, CLAUDE.md
  stale counts (12→15 connectors, 14→25 published files, 213→239 tests, 6→15
  e2e routes).
