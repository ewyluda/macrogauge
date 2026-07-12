# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Daily-updated US inflation/macro analytics: an **independent gauge that re-prices the CPI
basket from live market data**, published as a static site over pre-baked JSON. The pipeline
runs on a schedule, commits its output JSON back to the repo, and Vercel deploys the static
site. The site computes nothing — it renders `site/public/data/*.json`.

Design spec: `docs/macrogauge-design.md`. Per-phase plans: `docs/plans/`.

## Commands

```bash
# Python pipeline (repo root, Python 3.12+)
pip install -e ".[dev]"                      # setuptools; installs pytest
pytest -q                                     # full suite (258 tests)
pytest tests/test_gauge.py -q                 # one file
pytest tests/test_gauge.py::test_name -q      # one test

# Run the pipeline locally (writes JSON into the site)
FRED_API_KEY=... python -m pipeline.run_daily --store store --out site/public/data

# Site (Next.js static export, in site/)
cd site && npm ci
npm run dev        # local dev server
npm run build      # static export (must pass in CI)
npm test           # vitest — client math (since/reweight/realwage)
npm run e2e        # Playwright smoke — 16 pages render, zero console errors
```

CI (`.github/workflows/ci.yml`) runs two independent jobs on every push/PR: `pipeline` (`pytest -q`)
and `site` (`npm run build`, `npm test`, `npm run e2e`). Both must be green.

## Architecture

Data flows in one direction: **collect → store → engine → publish → validate**. The three parts
live in one repo.

### 1. Collection (`pipeline/collect.py`, `pipeline/connectors/`)
One connector module per source — 15 total: API/CSV (fred, bls, eia, fmp, treasury, zillow, pmms,
aptlist, usda, kalshi, street) and scrape (aaa, mnd, manheim, cleveland). What gets collected is driven entirely by
`config/series.json` (via `pipeline/registry.py`) — the single source of truth for series,
sources, and per-series `max_staleness_days`.

**Connector failure isolation is a hard invariant.** A broken source records an error in its
`SourceResult`, lowers freshness, and surfaces in `sources_status.json` + `qa.json` — it *never*
blocks the run. Carry-forward store semantics make a missed day harmless. Error strings are
sanitized (API keys redacted) because they get published.

**Scrape connectors (`aaa.py`, `mnd.py`, `manheim.py`) carry drift protection**, not just the
generic failure isolation above: a tight regex pinned to a recorded fixture plus a plausible-value
range check, so a redesigned source page raises a clear "structure drift?" error (caught by the
same isolation path) instead of silently ingesting garbage.

### 2. Vintage store (`store/obs/*.jsonl`, `pipeline/store/vintage.py`)
Append-only JSONL, **partitioned by vintage month** (the month we *learned* a value, not the month
it refers to). Re-published values append a new vintage row — never overwrite; git is the audit
trail. Reads take latest-vintage-wins per `(series_code, obs_date)`. On load, all partitions are
read into an in-memory SQLite DB (`vintage.load` returns the connection the engine queries).

**Row-evolution policy (`README.md`, enforced by convention):** store rows are immutable and
schema-versionless. `Observation` fields may be *added*; never renamed, removed, or retyped. Readers
default absent fields to `None` so old partitions load forever. **Never rewrite a committed partition.**

### 3. Engine (`pipeline/engine/`) — five pure stages + orchestrator
`gauge.run()` orchestrates; each stage is a pure function of dicts (no I/O, easy to test):
- `rebase.py` (stage 1) — index any series so its base-month (2018-01) mean = 100, making
  $/gal, ¢/kWh, $ rent unitless and comparable.
- `blend.py` (stage 2) — weighted mean over live sources with renormalization as sources phase in;
  `splice()` grafts scaled live data onto official history at the splice point.
- `gate.py` (stage 3) — stateless one-day quality hold: a >5% jump in the *just-arrived* last
  observation is held one day; if it persists (no longer just-arrived) it passes through.
- `aggregate.py` (stage 4) — daily forward-fill grid, Laspeyres headline over dates where every
  component has a value, 365-day YoY (`None` where the base is missing).
- `variants.py` (stage 5) — assemble each component per variant.

`official.py` is a separate, trivial engine for YoY off the latest official monthly print.

**Five variants** (`variants.VARIANTS`): `gauge` (the market-rent blend drives both shelter components; fuel, electricity and piped gas ride live EIA data), `col` (owned shelter = marginal-buyer payment: 0.80×ZHVI at the 30yr rate, MND daily/PMMS fallback; everything else rides live), `tracker` (official shelter dynamics; only fuel, electricity and piped gas ride live), `supercore` (services-ex-shelter approximation over our 14 coarse components, renormalized), and `pce` (same components under hand-seeded BEA-share weights, graded vs PCEPI).
Which component rides live data in which variant is config (`live_variants` in `config/basket.json`),
not code.

**Component YoY is computed at each component's OWN last observation, not the grid end.** Lagging
series (EIA nat gas, CPI) must compare like-month-to-like-month; a forward-filled value against a
different-month base a year ago is wrong. See the comment in `gauge.py`'s component loop — this was a
real bug. `end_value` (used only by QA) stays at grid end.

**Basket** (`config/basket.json`, loaded by `pipeline/basket.py`): 14 CPI components with Laspeyres
weights that **must sum to 1.0** (validated on load). Grid start is 2017-01 internally (feeds 2018
YoY bases); writers publish from 2018-01.

### 4. Publish (`pipeline/publish/`) + orchestration (`pipeline/run_daily.py`)
25 published files, each with a JSON Schema in `schemas/` validated inline as it lands:
`sources_status`, `pulse`, `gauge_daily`, `replay`, `quilt_months_24`, `quilt_months_48`,
`quilt_months_all`, `grocery_basket`, `compare`, `gaptable`, `methodology`, `official`,
`real_wages`, `qa`, plus phase 3 (`nowcast_latest`, `nextprint`, `releases`, `backtest`,
`fuel`, `accountability_{cpi,pce,nfp}`) and phase 4 composites (`heatcheck`, `stress`,
`recession`).
The three `quilt_months_*` files share one schema (a window-months slice of the same
month × component YoY grid), as do the three `accountability_*` files; `grocery_basket`
is BLS average-price staples.

`run_daily.py` ordering is deliberate and load-bearing:
- **`sources_status` publishes FIRST**, right after collect — a broken engine must never hide a
  broken source.
- The gauge engine, nowcast, and composites run in three ISOLATED `try/except` blocks — a failure
  in any one still publishes status + qa (exit 0, visible on-site via `engine_ok` / `nowcast_ok` /
  `composites_ok`) instead of a hard crash or suppressing the other phases.
- **`jsonschema.ValidationError` re-raises and fails the run** (caught *before* the generic
  `Exception`) — a schema-invalid artifact must never deploy. This ordering is pinned by tests.

## Testing conventions

- **HTTP is injected, never real.** Connectors take `http_get` / `http_post` params; tests pass
  fakes that return fixture data from `tests/fixtures/`. `test_run_daily.py` wires an end-to-end
  `fake_get`/`fake_post` covering every source. Never add a test that hits the network.
- Engine stages are pure dict→dict functions — test them directly, no store needed.

## Operational notes

- **Daily run** (`.github/workflows/daily.yml`): cron at 8:40 AM ET weekdays (two crons for
  EDT/EST, plus a midday backup cron), gated so scheduled runs publish at most once/day in the
  8:40–15:59 ET window — the window must out-span GitHub's cron slip (2.5–3h observed); commits
  `store/` + `site/public/data` back as `data: daily publish <date>` (the loop's heartbeat), which
  triggers the Vercel deploy.
- **`origin/main` gets a daily bot commit every morning.** Always `git fetch` / rebase before
  pushing; expect to rebase your work over `data: daily publish` commits. Store JSONL conflicts are
  resolved by *union* (keep both rows; last-seen wins on load), not by picking a side.
- The bot commits as `35318463+ewyluda@users.noreply.github.com` — Vercel Hobby blocks deploys whose
  author email doesn't match a GitHub account.
- Production: https://macrogauge-cloudten.vercel.app (behind Vercel Auth).
