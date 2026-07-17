# P2 Geography + Matrix Wave — Implementation Plan

> **For agentic workers:** execute task-by-task via subagent-driven development. TDD every task
> (failing test first, watch it fail, minimal code, full `pytest -q` green before each commit).
> Commit per task. Do NOT push without the user's explicit approval (push = production deploy).

**Goal:** Unlock the geographic data the pipeline already downloads and discards (Zillow 50-metro
ZORI/ZHVI, AAA 51-state gas), add the state residential-electricity and state-unemployment
families plus ~23 national FRED measures, publish three new artifacts (`metros.json`, `geo.json`,
`matrix.json`) through a new isolated geography phase, and ship three site surfaces: /metros,
/states, and the expanded every-measure /matrix.

**Source of truth for scope:** nowflation gap-review artifact §3/§5 (P2 slice) + the 2026-07-17
six-agent scout (all series ids below LIVE-VERIFIED that day unless marked VERIFY-AT-IMPL).

## Global constraints (repo invariants — do not re-derive)

- HTTP is injected, never real, in tests. New connectors take `http_get`; tests use fixtures.
  `tests/test_run_daily.py`'s `fake_get` must cover every new source/route.
- Scrape connectors carry drift protection: tight regex pinned to a recorded fixture + plausible
  range + "structure drift?" errors.
- Store rows append-only; never rewrite partitions. New series are additive.
- Every published file validates inline against `schemas/<stem>.schema.json`;
  `jsonschema.ValidationError` fails the whole run (by design). Schemas must legally allow
  degraded output (nulls / empty arrays) — see datacenter parity `mode: "unavailable"`.
- `run_daily.py` stamp sweep: every artifact must publish every run or `single_run_stamp` qa
  check trips.
- Site computes nothing (render-only; sorting/formatting client-side is fine). Pages
  static-import `site/public/data/*.json`; nullable fields need hand-written casts via
  `site/src/lib/types.ts` (TS otherwise infers from the committed sample).
- Semantic colors: blue=ours, amber=official, red=hot/worse, green=better, purple=alt.
- Every number renders with as-of date + source + comparison anchor.
- `test_registry.py` hard-pins source set, series count (266 today), and per-source counts —
  bump the pins in the same task that adds series.
- New pages: add to `site/src/lib/nav.ts` NAV **and** `site/e2e/smoke.spec.ts` ROUTES (unique
  body marker), or CI fails.

## Locked design decisions (do not re-litigate)

1. **Metro set = top-50 msa by SizeRank** from the live Zillow CSVs (RegionIDs pinned in the
   registry; verified 2026-07-17: all 50 have gap-free ZORI+ZHVI from 2018-01). RegionID is the
   join key; RegionName format "City, ST".
2. **Series codes**: metros `zori_{region_id}` / `zhvi_{region_id}` (e.g. `zori_394913`),
   source_id `zori:{region_id}`; states `aaa_gas_{st}` (regular grade only, 51 incl. dc),
   `eia_elec_res_{st}` (51), FRED unemployment keeps FRED ids as codes (`TXUR` etc., 51 —
   VERIFY-AT-IMPL each id live via scratchpad `fred_verify.py` pattern before registering).
   Never reuse the `eia_elec_ind_` or `qcew_wage23_` prefixes.
3. **New source keys** (isolation-only, own status rows): `AAA_STATE` (scrape,
   `https://gasprices.aaa.com/state-gas-price-averages/`, `<table id="sortable">`, exactly 51
   rows or "structure drift?"), `EIA_STATE_RES` → `_eia` (precedent: STEO/EIA_SPOT). Zillow
   metros ride the existing ZILLOW source (same files, same fetch).
4. **FRED national adds (23)**: MEDCPIM158SFRBCLE, TRMMEANCPIM158SFRBCLE, CORESTICKM159SFRBATL,
   PCETRIM12M159SFRBDAL (80d); T10YIE (10d), MICH (80d); DGS1MO/3MO/6MO/1/2/5/10/30 (10d);
   BAMLH0A0HYM2 (10d); DTWEXBGS (15d); GDPNOW (120d — obs_date = quarter start, revisions
   accrue as vintages); WALCL, WTREGEN (15d); RRPONTSYD (10d); EXHOSLUSM495S (80d — rolling
   ~13mo window, YoY often impossible: nullable); USSTHPI (210d); RIFLPBCIANM60NM (150d).
   {ST}UR + eia res states 80d/150d; aaa states 4d; zillow metros 75d.
5. **FRED throttle**: `fred.fetch` sleeps ~0.45s between series ONLY when `http_get is None`
   (real requests) — FRED caps at 120 req/min and the batch grows 74→148. Injected fakes never
   sleep (test pins this by monkeypatching `time.sleep` to raise).
6. **Artifacts** (design-doc §6 names): `metros.json` (metro ZORI/ZHVI KPIs + 24-month YoY
   tails), `geo.json` (51-state rows: gas, elec res/ind, qcew wage, unemployment — each
   `{value, as_of, yoy_pct|null}`-shaped, plus `name`), `matrix.json` (grouped national measure
   rows: UNDERLYING / PIPELINE (PPIACO, IREXPETCOM — already in store) / EXPECTATIONS (T5YIE,
   T10YIE, MICH); each row `{code, label, value, unit, as_of, cadence}` — values verbatim from
   the store, units differ by row and are rendered as-is). All fields nullable; artifacts carry
   state/metro display names so the site needs no name map.
7. **YoY convention**: own-obs like-month YoY (value at latest obs vs obs 12 months earlier,
   `null` if base missing) — the same rule the gauge component loop uses. AAA state series have
   no history until they accrue (ships `yoy_pct: null` for ~a year — acceptable, USDA
   precedent).
8. **New isolated phase** `_geography_phase` in run_daily (after datacenter), feeding
   `geography_error` → `geography_ok` qa check; qa.py + qa.schema.json updated in the same task.
9. **Site pages**: `/metros` (leaderboard: rank by ZORI YoY, sparkline 24mo tails, ZHVI columns),
   `/states` (generalize StateTileMap's TILE_POS grid into metric-agnostic props or a sibling
   component; toggles gas/elec-res/elec-ind/wage/unemployment; ranked table below; nulls grey),
   `/matrix` expansion (grouped OURS (pulse/compare) / OFFICIAL (official.json) / NOWCASTS
   (existing imports) / UNDERLYING+PIPELINE+EXPECTATIONS (matrix.json)). Nav: States + Metros
   under Economy; matrix stays in Forecasts.
10. **Nothing touches the basket or gauge engine.** All new series are display-only. dcindex
    prefix scans are guarded; codes above avoid its prefixes.

## Tasks (sequential — shared files: series.json, collect.py, run_daily.py, qa.py, nav.ts)

- [x] **T1 fred-adds**: throttle + 23 national ids + registry pins bump. Tests: throttle
  no-sleep pin; registry counts. (fred.py, config/series.json, test_registry.py)
- [x] **T2 state-unemployment**: live-verify 51 {ST}UR ids (script, dev-time network OK),
  register (FRED source, 80d), bump pins.
- [x] **T3 zillow-metros**: connector parses subset-aware (US + registered RegionIDs across
  both files; restructure the early-return loop), 100 metro series registered, fixtures grow
  metro rows (registered + one unregistered msa to prove filtering), test_run_daily fake serves
  the fixture, pins bump.
- [x] **T4 aaa-states**: `aaa.fetch_states` + AAA_STATE source + 51 series; NEW recorded fixture
  `tests/fixtures/aaa_states.html` (trimmed live page: sortable table + the national banner to
  pin non-cross-matching); test_run_daily fake splits on `/state-gas-price-averages/`; drift =
  row-count != 51 or price outside (1.5, 7.0).
- [x] **T5 eia-state-res**: EIA_STATE_RES source key → `_eia`, 51 `eia_elec_res_{st}` series
  (`ELEC.PRICE.{ST}-RES.M`, 150d), pins bump. Config-mostly.
- [x] **T6 publish-metros**: `pipeline/publish/metros.py` (METROS const list of (region_id,
  name) in SizeRank order; consistency test vs registry codes; build(conn)/write;
  `schemas/metros.schema.json`; degraded = empty metros array legal).
- [x] **T7 publish-geo**: `pipeline/publish/geo.py` (STATES const with names incl. dc;
  rows join aaa_gas/eia res/eia ind/qcew wage/UR by state; national block; nullable
  everywhere; `schemas/geo.schema.json`).
- [x] **T8 publish-matrix**: `pipeline/publish/matrix.py` + `schemas/matrix.schema.json`
  (grouped rows per decision 6).
- [x] **T9 geography-phase**: `_geography_phase` in run_daily + `geography_ok` in qa.py +
  qa.schema.json; ordering pinned by tests (status-first, ValidationError re-raise unchanged);
  test_run_daily e2e asserts the three artifacts land + validate.
- [x] **T10 local-run**: real pipeline run (`FRED_API_KEY=... python -m pipeline.run_daily
  --store store --out site/public/data`) to land real artifacts for the site build. Inspect
  geo/metros/matrix values for sanity (TX gas ≈ $3.57, NY ZORI YoY plausible, matrix rows
  populated). Commit store + data.
- [x] **T11 site-metros**: /metros page + nav + e2e + types cast.
- [x] **T12 site-states**: /states page (tile map generalization) + nav + e2e.
- [x] **T13 site-matrix**: /matrix expansion (marker string in e2e may need updating).
- [x] **T14 gates+review**: full `pytest -q`, `npm test`, `npm run e2e`, `npm run build`,
  multi-angle code review of the whole wave diff, fix findings, final commit.

## Reference facts for implementers (from the 2026-07-17 scout — trust these)

- zillow.py:27 discards `RegionName != "United States"`; :37 early-returns inside the row loop.
  Meta columns both files: `RegionID,SizeRank,RegionName,RegionType,StateName`; metro rows
  `RegionType == "msa"`; US row RegionID 102001. ZORI 733 msas (2015-01→), ZHVI 894 (2000-01→);
  live top-50 IDs/names in scratchpad `zori_live.csv` (session c954e515).
- AAA state page: `<table id="sortable" class="sortable-table">`; row =
  `<tr><td><a href="https://gasprices.aaa.com?state=AK">Alaska</a></td><td class="regular"
  style="display: table-cell;">$4.6780 </td>...` (trailing space in td, style attr on regular);
  td classes regular/mid_grade/premium/diesel; full state names in the anchor, abbrev in href;
  national banner ALSO present on this page (scope parsing to the table). Live copy saved at
  scratchpad `aaa_states.html`.
- EIA v2: `https://api.eia.gov/v2/seriesid/ELEC.PRICE.TX-RES.M` verified (price col, cents/kWh,
  latest 2026-04). eia.py already handles the `price` column.
- FRED "." placeholder rows exist (CORESTICK first row etc.) — `fred.fetch` already skips them.
- QCEW registry covers 44 states (ak/dc/ma/mo/ri/sd/vt permanently disclosure-suppressed) —
  geo.json wage fields null for those.
- StateTileMap.tsx: TILE_POS 8×11 grid (lines 29-42) is the reusable core; MetricKey/METRICS
  hardcoded to parity fields — generalize via props, keep datacenter usage working.
- matrix page today: 20-line stub importing nowcast_latest.json + ForecastHero (nextprint.json).
  pulse.json: gauge/tracker/official/gap_pp/tracker_gap_pp/next_print(nullable).
- Writer contract: `build(...) -> dict` pure; `write(payload, out_dir, published_at)` writes
  `{"published_at": ..., **payload}`; validate inline right after write in the phase fn.
