# TODO — recommended enhancements (ranked)

From the 2026-07-13 full review (all 16 pages visually tested, zero console errors;
findings root-caused against the store and pipeline).

## Highest value / analytics

1. **[DONE 2026-07-13] Seed the backtest from ALFRED.** All 112 `CPIAUCNS` rows share one
   2026-07 backfill vintage, so the vintage-true walk-forward in
   `pipeline/engine/backtest.py` produces 0 rows and the Forecast Scoreboard is empty.
   Backfill historical first-release vintages from ALFRED (FRED realtime API) into the
   store — instantly populates years of BT rows and a real MAE-vs-naive comparison.

2. **[DONE 2026-07-13] Replace the Street consensus source.** FMP's calendar carries zero
   US CPI events (verified live), so STREET was deleted outright. Cleveland's scraper now
   parses every month row in the MoM table (sliced away from the YoY table below it), so
   the current reference month stays in the ensemble until its print lands — Forecasters
   Live went 2 → 3 and connectors_ok now passes (QA 19/20).

3. **[DONE 2026-07-13] Fix the used-vehicles driver.** Root cause: the scrape wasn't
   erroring — site.manheim.com froze at the Mid-December 2025 report while Cox kept
   publishing on coxautoinc.com/insights, so the connector stayed green re-fetching
   206.0 for 7 months. Re-pointed to the Insights feed → latest "… Trends" post
   (h1-anchored parse; the <head> JSON-LD carries a stale decoy value on some months,
   and prose spaces can be &nbsp; entities — both pinned in fixtures). One-time
   `scripts/backfill_manheim.py` filled the Dec 2025–May 2026 gap (peak 215.3 in
   March); used_vehicles YoY now +0.89% off real monthly history.

4. **[DONE 2026-07-14] Widen nowcast component coverage.** Root cause: the measured-only
   model fabricated 0.00% MoM for every component without in-target-month data. Lagging
   components now ride their capped trailing-median trend plus one-month futures-driver
   slices (ag composite → food_home; Manheim when lagging), staleness-gated, sharing the
   outlook's math (new `pipeline/engine/signals.py`) and knobs. Receipts carry a `basis`
   field and the site tags modeled rows — design: docs/plans/2026-07-14-nowcast-component-coverage.md.

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
