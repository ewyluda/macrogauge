# TODO — recommended enhancements (ranked)

From the 2026-07-13 full review (all 16 pages visually tested, zero console errors;
findings root-caused against the store and pipeline).

## Highest value / analytics

1. **[IN PROGRESS] Seed the backtest from ALFRED.** All 112 `CPIAUCNS` rows share one
   2026-07 backfill vintage, so the vintage-true walk-forward in
   `pipeline/engine/backtest.py` produces 0 rows and the Forecast Scoreboard is empty.
   Backfill historical first-release vintages from ALFRED (FRED realtime API) into the
   store — instantly populates years of BT rows and a real MAE-vs-naive comparison.

2. **Replace the Street consensus source.** FMP's economic calendar no longer carries a
   CPI monthly consensus (`street_cpi_mom` never seen; STREET connector fails every run).
   Best candidate: scrape the Cleveland Fed nowcast page's *next*-month row too — one
   scrape, two benchmark rows, also fixes Cleveland dropping out of the ensemble in the
   week before a print (its current-month row rolls forward before our reference month does).

3. **Fix the used-vehicles driver.** Manheim scrape dead 224 days; `used_vehicles` live
   blend is 100% `manheim_uvvi_m` with carry-forward, so its LIVE badge (+1.6% vs BLS
   −2.0%, +3.63pp gap contribution) rides 7-month-old data. Repair the scrape, swap to a
   live alternative (Black Book weekly / CarGurus index), or demote to BLS-CF.

4. **Widen nowcast component coverage.** CPI Preview receipts are 0.00% MoM for 11 of 14
   components — the ensemble is effectively a fuel-plus-shelter call. Reuse the outlook
   model's driver paths (USDA futures → food-at-home, EIA → electricity/nat-gas) for the
   one-month nowcast.

## Product / coverage (phase 5 candidates)

5. **Exports:** headline/components CSV, `feed.xml` RSS daily brief, open-data page
   documenting all 26 published JSONs (already sketched in docs/macrogauge-design.md §6/§8).

6. **Land on-site promises:** `labor.json` (real-wages footer: "AHE stands in until Phase
   4's labor.json") and state-level My Inflation (QCEW wage + EIA state power multipliers
   already ingested for the DC index).

7. **Scoreboard empty/degraded state copy** explaining vintage-true grading — even after
   ALFRED seeding, the BT vs LIVE distinction deserves one sentence on-page.

## Hygiene (quick wins)

8. **Add a favicon** to `site/src/app` — kills the only console error on the site (404 on
   every page load).

9. **daily.yml:** add weekday gate (bot published on Sunday 07-12) and bump
   `actions/checkout` / `actions/setup-node` off the deprecated Node 20 runtime.

10. **Silence expected staleness noise:** the 8 disclosure-suppressed QCEW states and
    never-seen series read as failures in `sources_status` — mark them expected-absent so
    real regressions stand out.
