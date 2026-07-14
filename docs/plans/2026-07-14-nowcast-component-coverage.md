# Nowcast component coverage — design

**Date:** 2026-07-14 · **Status:** approved design, pre-implementation
**Backlog:** todo.md #4 — "Widen nowcast component coverage"

## Problem

`cpi_nowcast` (pipeline/engine/nowcast/models.py) measures each component's
intra-target-month move on the gauge variant's daily index. Ten of 14
components have no real observation inside the target month — even the
live-blended EIA utilities lag it by 1–2 months — so their windows see pure
forward-fill and contribute exactly 0.00% MoM. The published CPI Preview is
effectively a fuel-plus-shelter call, and because sticky services
(~0.45 of basket weight, trend ~0.2–0.3%/mo) read as zero, the model carries
a systematic downward bias (2026-07-13 receipt: macrogauge −0.16 vs
Cleveland −0.06).

The outlook engine (pipeline/engine/outlook.py) already solves the two
halves of this: trailing-median trend per component
(`base_mom` / `_median_mom`, stopped at each component's last real
observation) and futures→component driver shocks with pass-through knobs in
`config/outlook.json`, gated by registry staleness.

## Decisions (made with user 2026-07-14)

1. **Model = trend + driver shocks** for lagging components (not trend-only,
   not lifting outlook month-1 paths wholesale).
2. **Energy honors outlook dynamics:** nat_gas gets NO month-1 futures shock
   (outlook's `nat_gas.start_month: 2` says retail pass-through starts at
   month 2); electricity has no driver. Both ride their trailing-median
   trend, which is computed from their own EIA-driven complete-month
   history — recent EIA moves still flow in. One set of pass-through
   beliefs across outlook and nowcast.

## Model specification

For each component in the `gauge` variant at target month `T`:

- **measured** — if the component has a real observation dated inside `T`
  (its `last_obs` ≥ `T-01`): keep today's math unchanged (intra-month move,
  end clamped to `as_of`/month-end, prior-month start).
- **modeled** — otherwise:
  - **Trend leg (every modeled component):** capped trailing-median MoM
    over the component's own complete-month levels, stopped at its last
    real observation — exactly the outlook's `base_mom`:
    `trailing_median_months` (12) window, cap ±`component_trend_annual_cap_pct`
    (20%/yr, converted monthly), fallback `baseline_annual_pct` (2%/yr,
    converted monthly) when no changes are computable.
  - **Driver leg (only these mappings, only when the driver is fresh):**
    - `food_home`: ag-futures composite (equal-weight over
      `food_home.series`, `lookback_months` return) × `pass_through`
      distributed over `horizon_months` via `_distributed_return`; the
      nowcast adds **one month's slice** on top of the trend — the same
      per-month shock arithmetic as the outlook's month-1 food path.
    - `used_vehicles`: same one-month slice from `used_vehicles.*` knobs —
      applies only when the component is lagging (post the 2026-07-13
      Manheim fix it will usually be measured).
    - Explicitly NOT in the nowcast: nat_gas/electricity futures shocks
      (decision 2), wage anchor and goods-pipeline tilt (12-month ramp
      dynamics, negligible at month 1).
  - Driver freshness gates through the registry's `max_staleness_days`
    exactly as the outlook's `_fresh_series` — a dead source degrades the
    component to trend-only, never to a stale shock.

MoM of a modeled component = trend + driver slice. Headline MoM stays the
Laspeyres weight × component MoM sum; `pce_bridge`, `nfp_nowcast`, ensemble
assembly, and freeze-and-grade are untouched consumers.

## Config

**Zero new config.** The nowcast reads the existing sections of
`config/outlook.json` (`trailing_median_months`,
`component_trend_annual_cap_pct`, `baseline_annual_pct`, `food_home.*`,
`used_vehicles.*`). If a nowcast-specific knob is ever needed it gets added
then, not now.

## Code structure

- New `pipeline/engine/signals.py`: the shared driver/trend math moves out
  of outlook.py — `_month_values`, `_month_asof`, `_adjacent_changes`,
  `_median_mom`, `_lookback_return`, `_fresh_series`, `_weighted_signal`,
  `_equal_signal`, `_distributed_return`, `_annualized`,
  `_monthly_from_annual` (public names, drop the underscores). outlook.py
  imports from it; behavior byte-identical. No cross-module private imports.
- `cpi_nowcast(conn, gauge_result, target_month, config, staleness, today)`
  — new params threaded from `build_latest`, which gains
  `staleness`/`today` params from run_daily's nowcast phase (all already in
  scope at the call site; `conn` is already passed to `build_latest`).
  `config` loads from `config/outlook.json` (same `DEFAULT_CONFIG` path
  handling as outlook).
- The gauge component dict already carries `last_obs` and `daily_index` —
  no gauge changes.

## Receipts, schema, site

- Each row in `cpi.components` gains
  `"basis": "measured" | "trend" | "trend+driver"`; rows with a driver leg
  also carry `driver_mom_pct` (the one-month slice) so trend vs driver is
  auditable. A modeled MoM is never presented as an observed one.
- Schemas: `nowcast_latest` and `nextprint` component items gain `basis`
  (required, enum) and optional `driver_mom_pct` — additive, typed per the
  structural-risk-wave schema conventions.
- Site: /next-print receipts table shows a minimal "modeled" indicator on
  non-measured rows (basis in the row tooltip/tag). No other UI change.

## Grading and backtest

- `backtest.cpi_walk_forward` (`cpi_3m_vintage_true`) is a deliberately
  separate naive-adjacent model — untouched.
- LIVE freeze-and-grade rows pick up the new model from the first target
  month frozen after this ships (July 2026 print, graded mid-August). The
  2026-06 print (today) grades the old model — a clean before/after on the
  scoreboard.

## Testing

- Sticky component (e.g. `medical`) with no in-target-month obs yields its
  capped trailing median, not 0.0, and is labeled `trend`.
- `food_home` with fresh futures fixture yields trend + one-month slice
  matching the outlook's shock arithmetic for identical inputs; labeled
  `trend+driver` with `driver_mom_pct` disclosed.
- Stale ag futures (per staleness map) → `food_home` degrades to
  trend-only.
- Measured components (fuel, shelters) produce byte-identical numbers to
  the current model.
- nat_gas/electricity: modeled as `trend`, no driver leg.
- Headline MoM = Σ weight × component MoM over the receipt rows.
- Schema validation of the new fields; e2e untouched.

## Expected magnitude

Sticky services alone add roughly +0.15–0.20pp to headline MoM vs the
current model; the macrogauge line in the ensemble moves materially. This is
the intended bias fix, not drift — the receipts expose exactly where it
comes from.
