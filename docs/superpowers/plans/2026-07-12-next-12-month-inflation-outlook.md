# Next 12-Month Inflation Outlook — Implementation Plan

**Date:** 2026-07-12  
**Model:** `macrogauge_outlook_v1`  
**Goal:** Publish a transparent, vintage-true 12-month CPI-component outlook and render it on the MacroGauge homepage after the gap table and before the inflation quilt.

## Product contract

The homepage module shows:

- the latest 25 complete months of MacroGauge YoY history;
- a 12-month central projection built by rolling all 14 component index levels;
- a realized-volatility band, explicitly labelled as such rather than as a confidence interval;
- a flat 2%-annualized component-level baseline that isolates base effects;
- the current model version, complete-month anchor, terminal forecast, driver coverage, assumptions, source dates, and fallback status;
- driver chips for fuel, new-lease rents, agricultural prices, natural gas, vehicles, wages, and the ex-energy goods pipeline.

The gray “official CPI projected” path in the reference site is excluded from v1 because its anchoring formula is not publicly disclosed.

## Model decisions

All decisions live in `config/outlook.json`, not only in prose or UI code.

1. Forecasts start after the latest complete calendar month. The current partial month never enters the anchor.
2. Component levels roll forward monthly and are aggregated with the existing 14-component CPI weights.
3. Forecast YoY is computed against actual year-ago MacroGauge index levels, preserving exact base effects.
4. The base-effect-only path compounds at `(1.02 ** (1/12)) - 1` each month.
5. The band is `central ± sigma_monthly_pp * sqrt(horizon)`. Sigma is the sample standard deviation of monthly changes in complete-month gauge YoY over a configurable trailing window.
6. Missing forward drivers never become zero shocks. Each component falls back to its own complete-month trailing median, and the artifact discloses the fallback.
7. Disclosed reference-model coefficients are retained: 85% fuel pass-through over two months, 15% agricultural pass-through over four months, and 70% used-vehicle pass-through over three months.
8. Undisclosed coefficients are MacroGauge-owned and versioned: six-month shelter half-life, 35% natural-gas pass-through over months 2–6, 25% wage-anchor blend for sticky services, and a half-strength ex-energy goods pipeline capped at ±1 percentage point per year.

## Delivery slices

### 1. Inputs and configuration

- Register FRED ex-petroleum import prices (`IREXPETCOM`).
- Register optional FMP front-month proxies for RBOB, Henry Hub, and eight agricultural contracts.
- Generalize `scripts/backfill_fmp.py`; run the new symbols once with a real FMP key before expecting those driver chips to leave fallback/partial status.
- Keep KBB ATP and GSCPI as explicit unavailable optional inputs in v1; do not scrape unstable pages merely to make the chips green.
- Add recorded connector fixtures as new routes become production inputs.

### 2. Pure forecast engine

Create `pipeline/engine/outlook.py` with pure helpers for complete-month sampling, monthly returns, robust medians, driver construction, component paths, level aggregation, exact base effects, and the volatility band.

### 3. Artifact and orchestration

- Create `pipeline/publish/outlook.py`.
- Add `schemas/outlook.schema.json` and committed `site/public/data/outlook.json`.
- Run outlook generation in its own isolated block in `pipeline/run_daily.py`.
- Add `outlook_ok` to QA so a forecast failure cannot block the gauge, next-print model, or composites.

### 4. Validation and accountability

- Unit-test every disclosed pass-through and lag.
- Assert 12 aligned forecast rows, exact year-ago denominators, `sqrt(h)` band arithmetic, complete-month-only inputs, finite output, and fallback behavior.
- Add the artifact to committed-data schema tests and end-to-end daily-run tests.
- Persist public forecast vintages in a later accountability slice once the first production forecast is locked; do not reconstruct historical forecasts from revised data.

### 5. Homepage

- Add `OutlookChart.tsx` using the existing ECharts wrapper.
- Render actual history, central path, band, and flat-2% baseline.
- Add terminal summary, coverage badge, driver chips, assumption copy, and disclaimer.
- Insert after the gap table and before the quilt.
- Preserve current in-progress homepage and responsive-style changes.

## Acceptance criteria

- `pytest -q` passes.
- `npm run build`, `npm test`, and `npm run e2e` pass from `site/`.
- A missing optional market series produces a valid fallback-labelled outlook.
- A forecast exception surfaces as `outlook_ok=false` without suppressing core artifacts.
- Every published driver exposes source codes, as-of dates, status, reading, and effect.
- The homepage is readable at desktop and mobile breakpoints and never calls live services client-side.
