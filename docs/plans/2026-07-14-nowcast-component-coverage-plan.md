# Nowcast Component Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lagging CPI components in the one-month nowcast get outlook-style trailing-median trend plus one-month futures-driver slices instead of contributing exactly 0.00%.

**Architecture:** Shared trend/driver math extracts from `pipeline/engine/outlook.py` into a new `pipeline/engine/signals.py`. `cpi_nowcast` gains a measured/modeled split per component: real in-target-month observation → today's intra-month math; otherwise capped trailing-median trend (+ ag-futures slice for `food_home`, Manheim slice for `used_vehicles` when lagging). Receipts disclose a `basis` per component. Design: `docs/plans/2026-07-14-nowcast-component-coverage.md`.

**Tech Stack:** Python 3.12 (stdlib only in engine), pytest, JSON Schema, Next.js static site.

## Global Constraints

- Engine stages stay pure/deterministic; no network in engine or tests (HTTP is injected; store seeded via `vintage.append`).
- Zero new config: nowcast reads existing `config/outlook.json` sections (`baseline_annual_pct`, `trailing_median_months`, `component_trend_annual_cap_pct`, `food_home.*`, `used_vehicles.*`).
- nat_gas/electricity get NO driver leg (outlook `start_month: 2` pass-through belief); wage anchor and goods-pipeline tilt excluded (12-month dynamics).
- Schema changes are additive; a schema-invalid artifact must never publish.
- A modeled MoM is never presented as an observed one (receipts + site).
- Run `pytest -q` (full suite) before every commit; repo commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Extract `pipeline/engine/signals.py` from outlook.py (pure refactor)

**Files:**
- Create: `pipeline/engine/signals.py`
- Modify: `pipeline/engine/outlook.py` (delete moved defs, import + rename call sites)
- Test: existing `tests/test_outlook.py` (unchanged — behavior must be byte-identical)

**Interfaces:**
- Consumes: nothing new.
- Produces (exact signatures later tasks import as `from pipeline.engine import signals`):
  - `signals.month_values(rows, through_month: str | None = None) -> dict[str, float]`
  - `signals.month_asof(rows, through_month: str) -> str | None`
  - `signals.adjacent_changes(levels: dict[str, float]) -> list[tuple[str, float]]`
  - `signals.median_mom(levels, window: int, fallback: float = 0.0) -> float`
  - `signals.lookback_return(rows, through_month: str, lookback_months: int) -> tuple[float | None, str | None]`
  - `signals.fresh_series(rows, code: str, staleness: dict[str, int] | None, today: str | None) -> bool`
  - `signals.weighted_signal(conn, series_weights, through_month, lookback_months, staleness=None, today=None) -> tuple[float | None, list[str], str | None]`
  - `signals.equal_signal(conn, codes, through_month, lookback_months, staleness=None, today=None) -> tuple[float | None, list[str], str | None]`
  - `signals.distributed_return(total_return_pct: float, months: int) -> float`
  - `signals.annualized(return_pct: float, months: int) -> float`
  - `signals.monthly_from_annual(annual_pct: float) -> float`
  - `signals.component_trend_levels(component: dict, through_month: str) -> dict[str, float]`

- [ ] **Step 1: Create `pipeline/engine/signals.py`**

Move the function bodies verbatim from `pipeline/engine/outlook.py` (lines 21–163 region), dropping the leading underscores. The file:

```python
"""Shared trend/driver signal math for the outlook and the one-month nowcast.

Extracted verbatim from outlook.py (2026-07-14) so the nowcast can reuse the
same trailing-median trend and futures-driver arithmetic without cross-module
private imports. One set of pass-through beliefs lives in config/outlook.json;
this module is the one implementation of the math that applies them.
"""
from __future__ import annotations

import statistics
from datetime import date

from pipeline.dates import months_back, prior_month
from pipeline.store import vintage


def month_values(rows, through_month: str | None = None) -> dict[str, float]:
    """Last observation in each complete month, keyed YYYY-MM."""
    out: dict[str, tuple[str, float]] = {}
    for obs_date, value in rows:
        month = obs_date[:7]
        if through_month is not None and month > through_month:
            continue
        if month not in out or obs_date >= out[month][0]:
            out[month] = (obs_date, float(value))
    return {month: pair[1] for month, pair in sorted(out.items())}


def month_asof(rows, through_month: str) -> str | None:
    dates = [d for d, _ in rows if d[:7] <= through_month]
    return max(dates) if dates else None


def adjacent_changes(levels: dict[str, float]) -> list[tuple[str, float]]:
    out = []
    for month, value in levels.items():
        prior = prior_month(f"{month}-01")[:7]
        base = levels.get(prior)
        if base not in (None, 0):
            out.append((month, (value / base - 1) * 100))
    return out


def median_mom(levels: dict[str, float], window: int, fallback: float = 0.0) -> float:
    changes = [value for _, value in adjacent_changes(levels)[-window:]]
    return statistics.median(changes) if changes else fallback


def lookback_return(rows, through_month: str, lookback_months: int) -> tuple[float | None, str | None]:
    levels = month_values(rows, through_month)
    if not levels:
        return None, None
    end_month = max(levels)
    start_month = months_back(f"{end_month}-01", lookback_months)[:7]
    if start_month not in levels or levels[start_month] == 0:
        return None, end_month
    return (levels[end_month] / levels[start_month] - 1) * 100, end_month


def fresh_series(rows, code: str, staleness: dict[str, int] | None,
                 today: str | None) -> bool:
    """A stale driver series must not produce a forward shock: its months-old
    move already passed through actual CPI, and lookback_return anchors at
    the series' own last month, so it would be re-applied as if it just
    happened (published 'live'). Gate on the registry's max_staleness_days;
    with no gating context (unit tests, unregistered code) treat as fresh."""
    if staleness is None or today is None:
        return True
    limit = staleness.get(code)
    if limit is None:
        return True
    last = max((obs_date for obs_date, _ in rows), default=None)
    if last is None:
        return False
    return (date.fromisoformat(today) - date.fromisoformat(last)).days <= limit


def weighted_signal(conn, series_weights: dict[str, float], through_month: str,
                    lookback_months: int, staleness: dict[str, int] | None = None,
                    today: str | None = None) -> tuple[float | None, list[str], str | None]:
    available: list[tuple[str, float, float, str | None]] = []
    for code, weight in series_weights.items():
        rows = vintage.latest(conn, code)
        if not fresh_series(rows, code, staleness, today):
            continue
        value, _ = lookback_return(rows, through_month, lookback_months)
        if value is not None:
            available.append((code, weight, value, month_asof(rows, through_month)))
    if not available:
        return None, [], None
    total = sum(weight for _, weight, _, _ in available)
    signal = sum(weight * value for _, weight, value, _ in available) / total
    asof = max((date for *_, date in available if date is not None), default=None)
    return signal, [code for code, *_ in available], asof


def equal_signal(conn, codes: list[str], through_month: str,
                 lookback_months: int, staleness: dict[str, int] | None = None,
                 today: str | None = None) -> tuple[float | None, list[str], str | None]:
    return weighted_signal(conn, {code: 1.0 for code in codes},
                           through_month, lookback_months, staleness, today)


def distributed_return(total_return_pct: float, months: int) -> float:
    # A bad upstream price can never turn a component level negative.
    bounded = max(total_return_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / months) - 1) * 100


def annualized(return_pct: float, months: int) -> float:
    bounded = max(return_pct, -95.0)
    return ((1 + bounded / 100) ** (12 / months) - 1) * 100


def monthly_from_annual(annual_pct: float) -> float:
    bounded = max(annual_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / 12) - 1) * 100


def component_trend_levels(component: dict, through_month: str) -> dict[str, float]:
    # Trend estimation must stop at the component's own last real observation:
    # past it the daily grid is pure forward-fill, so every adjacent-month
    # "change" is a fabricated 0.0 that drags the trailing median toward zero
    # (the same like-month rule behind the gauge's own component YoY).
    last_real_month = component["last_obs"][:7]
    return month_values(component["daily_index"].items(),
                        min(through_month, last_real_month))
```

- [ ] **Step 2: Rewire `pipeline/engine/outlook.py`**

Delete the moved defs (`_month_values`, `_month_asof`, `_adjacent_changes`, `_median_mom`, `_lookback_return`, `_fresh_series`, `_weighted_signal`, `_equal_signal`, `_distributed_return`, `_annualized`, `_monthly_from_annual`, `_component_trend_levels`). Keep outlook-specific helpers in place (`_blend_label`, `_driver`, `_status`, `_headline_monthly`, `_validate_config`). New import block:

```python
import json
import math
import statistics
from datetime import date
from pathlib import Path

from pipeline.dates import month_first, months_back, next_month, prior_month
from pipeline.engine import signals
from pipeline.store import vintage
```

Rename every call site `_x(...)` → `signals.x(...)` for the moved names. `_headline_monthly` becomes a one-liner calling `signals.month_values(index.items(), origin_month)`. Note: `statistics` is still used by `run()` (median/stdev), `math` by sqrt/isfinite, `vintage` by driver reads — keep them. The `for code in pipe_cfg["series"]` loop has a local variable `date = signals.month_asof(...)` shadowing the `date` import — it already does this today; leave it (pure move, no drive-by fixes).

- [ ] **Step 3: Run the full suite to prove behavior identical**

Run: `python3 -m pytest -q`
Expected: `338 passed` (same count as before this task).

- [ ] **Step 4: Commit**

```bash
git add pipeline/engine/signals.py pipeline/engine/outlook.py
git commit -m "refactor(engine): extract shared trend/driver math into signals.py

Pure move (public names, no behavior change) so the nowcast can reuse the
outlook's trailing-median and pass-through arithmetic without cross-module
private imports.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `cpi_nowcast` measured/modeled split — trend leg

**Files:**
- Modify: `pipeline/engine/nowcast/models.py` (`cpi_nowcast`)
- Test: `tests/test_nowcast.py`

**Interfaces:**
- Consumes: `signals.component_trend_levels`, `signals.median_mom`, `signals.monthly_from_annual` (Task 1).
- Produces: `cpi_nowcast(gauge_result: dict, target_month: str, conn=None, config: dict | None = None, staleness: dict[str, int] | None = None, today: str | None = None) -> dict`. Component rows gain `"basis": "measured" | "trend" | "trend+driver"`; rows with a driver leg also carry `"driver_mom_pct": float`. Task 3 fills in `_driver_slice`; this task stubs it returning `None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_nowcast.py`. `TREND_CONFIG` is a module-level dict next to the existing imports:

```python
TREND_CONFIG = {"baseline_annual_pct": 2.0, "trailing_median_months": 12,
                "component_trend_annual_cap_pct": 20.0}


def _sticky_gauge(code="medical", monthly_pct=0.3, last="2026-05-28"):
    daily, level = {}, 100.0
    months = [f"2025-{m:02d}" for m in range(1, 13)] + [f"2026-{m:02d}" for m in range(1, 6)]
    for i, m in enumerate(months):
        if i:
            level *= 1 + monthly_pct / 100
        daily[f"{m}-28"] = level
    return {"variants": {"gauge": {
        "as_of": "2026-06-20", "yoy": {"2026-06-20": 3.0},
        "components": {code: {"weight": 1.0, "daily_index": daily,
                              "last_obs": last}}}}}


def test_modeled_component_uses_trailing_median_not_zero():
    # medical's last real obs is May; June has only forward-fill. The old
    # model published 0.00 -- the systematic downward bias behind todo #4.
    result = cpi_nowcast(_sticky_gauge(), "2026-06", config=TREND_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend"
    assert row["mom_pct"] == pytest.approx(0.3, abs=0.02)
    assert result["mom_pct"] == pytest.approx(0.3, abs=0.02)
    assert "driver_mom_pct" not in row


def test_modeled_trend_is_capped_and_falls_back_to_neutral():
    # +8%/mo history slams into the ±20%/yr cap (≈ +1.531%/mo)...
    hot = cpi_nowcast(_sticky_gauge(monthly_pct=8.0), "2026-06", config=TREND_CONFIG)
    from pipeline.engine import signals
    assert hot["components"][0]["mom_pct"] == pytest.approx(
        signals.monthly_from_annual(20.0), abs=1e-4)
    # ...and a single-observation history has no computable change: neutral
    # 2%/yr baseline, not frozen prices.
    lone = _sticky_gauge()
    comp = lone["variants"]["gauge"]["components"]["medical"]
    comp["daily_index"] = {"2026-05-28": 100.0}
    assert cpi_nowcast(lone, "2026-06", config=TREND_CONFIG)["components"][0][
        "mom_pct"] == pytest.approx(signals.monthly_from_annual(2.0), abs=1e-4)


def test_measured_component_math_unchanged_and_labeled():
    gauge_result = {"variants": {"gauge": {
        "as_of": "2026-07-10", "yoy": {"2026-07-10": 3.1},
        "components": {"fuel": {"weight": 1.0, "last_obs": "2026-07-10",
                                "daily_index": {"2026-05-01": 100.0,
                                                "2026-06-30": 102.0,
                                                "2026-07-10": 110.0}}}}}}
    result = cpi_nowcast(gauge_result, "2026-06", config=TREND_CONFIG)
    assert result["components"][0]["basis"] == "measured"
    assert result["components"][0]["mom_pct"] == 2.0  # same clamp as before
```

Also update the two existing fixtures for the new required `last_obs` key:
in `test_cpi_nowcast_clamps_window_to_target_month` add `"last_obs": "2026-07-10"` to the fuel component dict; in `test_cpi_nowcast_publishes_no_phantom_parameters` (line ~97) add `"last_obs"` equal to that fixture's latest daily_index date to each component dict.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python3 -m pytest tests/test_nowcast.py -q`
Expected: the three new tests FAIL (`KeyError: 'basis'` / TypeError on `config=` kwarg); existing ones pass.

- [ ] **Step 3: Implement the split in `cpi_nowcast`**

Replace the current `cpi_nowcast` in `pipeline/engine/nowcast/models.py` (keep `_pct_change`; add imports `from pipeline.engine import signals` and `import json` / `from pipeline.engine.outlook import DEFAULT_CONFIG`):

```python
def _driver_slice(code: str, conn, config: dict, through_month: str,
                  staleness: dict[str, int] | None, today: str | None) -> float | None:
    return None  # Task 3 wires food_home / used_vehicles futures slices.


def cpi_nowcast(gauge_result: dict, target_month: str, conn=None,
                config: dict | None = None,
                staleness: dict[str, int] | None = None,
                today: str | None = None) -> dict:
    """Bottom-up CPI forecast: measured intra-month moves where the target
    month has real data; capped trailing-median trend (+ one-month driver
    slice, Task 3) where it does not. Modeled rows are labeled -- a modeled
    MoM is never presented as an observed one."""
    config = config or json.loads(DEFAULT_CONFIG.read_text())
    target = month_first(target_month)
    prior = prior_month(target)
    after = next_month(target)
    variant = gauge_result["variants"]["gauge"]
    neutral = signals.monthly_from_annual(float(config["baseline_annual_pct"]))
    cap = float(config["component_trend_annual_cap_pct"])
    lo, hi = signals.monthly_from_annual(-cap), signals.monthly_from_annual(cap)
    contributions, total = [], 0.0
    for code, component in variant["components"].items():
        series = component["daily_index"]
        driver_mom = None
        if component["last_obs"] >= target:
            # Measured: never read past the target month -- once it is over,
            # later moves belong to the NEXT print, and this forecast gets
            # graded against a one-month actual.
            end = min(variant["as_of"],
                      max((d for d in series if d < after), default=max(series)))
            start = prior if prior in series else max(d for d in series if d < end)
            move = _pct_change(series, end, start) or 0.0
            basis = "measured"
        else:
            # Modeled: the component's grid is pure forward-fill inside the
            # target month; its own capped trailing-median trend replaces the
            # fabricated 0.0 (same base-rate rule as the outlook).
            levels = signals.component_trend_levels(component, prior[:7])
            move = min(hi, max(lo, signals.median_mom(
                levels, int(config["trailing_median_months"]), fallback=neutral)))
            driver_mom = _driver_slice(code, conn, config, target[:7], staleness, today)
            basis = "trend"
            if driver_mom is not None:
                move += driver_mom
                basis = "trend+driver"
        contribution = component["weight"] * move
        row = {"component": code, "mom_pct": round(move, 4),
               "weight": component["weight"],
               "contribution_pp": round(contribution, 4), "basis": basis}
        if driver_mom is not None:
            row["driver_mom_pct"] = round(driver_mom, 4)
        contributions.append(row)
        total += contribution
    latest_yoy = variant["yoy"][variant["as_of"]]
    return {"target_month": target[:7], "mom_pct": round(total, 2),
            "yoy_pct": round(latest_yoy, 2), "as_of": variant["as_of"],
            "status": "live", "parameters": {},
            "components": contributions}
```

Update `build_latest`'s call (full threading lands in Task 4; for now keep it compiling): `cpi = cpi_nowcast(gauge_result, next_release["reference_month"], conn=conn)`.

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest tests/test_nowcast.py tests/test_run_daily.py -q` then `python3 -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/nowcast/models.py tests/test_nowcast.py
git commit -m "feat(nowcast): lagging components ride trailing-median trend, not 0.00

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Driver leg — ag futures → food_home, Manheim → used_vehicles

**Files:**
- Modify: `pipeline/engine/nowcast/models.py` (`_driver_slice`)
- Test: `tests/test_nowcast.py`

**Interfaces:**
- Consumes: `signals.equal_signal`, `signals.lookback_return`, `signals.fresh_series`, `signals.distributed_return` (Task 1); `vintage.latest`/`vintage.append`/`vintage.load` (existing store API).
- Produces: `_driver_slice` returning the one-month shock slice (float) or `None`; only `food_home` and `used_vehicles` map — everything else returns `None` by design (energy honors outlook pass-through timing; wage/pipeline are 12-month dynamics).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_nowcast.py` (seeding through the real store API, same pattern as `tests/test_outlook.py`):

```python
from pipeline.engine import signals
from pipeline.models import Observation
from pipeline.store import vintage

AG_SERIES = ["fmp_corn", "fmp_wheat", "fmp_soybeans", "fmp_soybean_oil",
             "fmp_coffee", "fmp_sugar", "fmp_cocoa", "fmp_live_cattle"]
DRIVER_CONFIG = {**TREND_CONFIG,
                 "food_home": {"lookback_months": 3, "pass_through": 0.15,
                               "horizon_months": 4, "series": AG_SERIES},
                 "used_vehicles": {"series": "manheim_uvvi_m",
                                   "lookback_months": 3, "pass_through": 0.7,
                                   "horizon_months": 3}}


def _seed(store_dir, code, rows):
    vintage.append([Observation(series_code=code, obs_date=d, value=v,
                                vintage_date="2026-06-15", source="TEST",
                                route="FIXTURE")
                    for d, v in rows], store_dir)


def test_food_home_gets_one_month_futures_slice(tmp_path):
    for code in AG_SERIES:  # +3% over the 3-month lookback
        _seed(tmp_path, code, [("2026-03-10", 100.0), ("2026-06-10", 103.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="food_home"), "2026-06",
                         conn=conn, config=DRIVER_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend+driver"
    expected_slice = signals.distributed_return(3.0 * 0.15, 4)
    assert row["driver_mom_pct"] == pytest.approx(expected_slice, abs=1e-4)
    assert row["mom_pct"] == pytest.approx(0.3 + expected_slice, abs=0.03)


def test_stale_futures_degrade_food_home_to_trend_only(tmp_path):
    for code in AG_SERIES:
        _seed(tmp_path, code, [("2026-01-10", 100.0), ("2026-04-10", 103.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="food_home"), "2026-06", conn=conn,
                         config=DRIVER_CONFIG,
                         staleness={code: 7 for code in AG_SERIES},
                         today="2026-06-20")  # last obs 71 days old, limit 7
    row = result["components"][0]
    assert row["basis"] == "trend"
    assert "driver_mom_pct" not in row


def test_lagging_used_vehicles_gets_manheim_slice(tmp_path):
    _seed(tmp_path, "manheim_uvvi_m", [("2026-02-01", 200.0), ("2026-05-01", 206.0)])
    conn = vintage.load(tmp_path)
    result = cpi_nowcast(_sticky_gauge(code="used_vehicles"), "2026-06",
                         conn=conn, config=DRIVER_CONFIG)
    row = result["components"][0]
    assert row["basis"] == "trend+driver"
    assert row["driver_mom_pct"] == pytest.approx(
        signals.distributed_return(3.0 * 0.7, 3), abs=1e-4)


def test_energy_components_stay_trend_only_with_full_store(tmp_path):
    _seed(tmp_path, "fmp_natgas", [("2026-03-10", 100.0), ("2026-06-10", 112.0)])
    conn = vintage.load(tmp_path)
    for code in ("nat_gas", "electricity"):
        row = cpi_nowcast(_sticky_gauge(code=code), "2026-06", conn=conn,
                          config=DRIVER_CONFIG)["components"][0]
        assert row["basis"] == "trend"  # outlook says pass-through starts month 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_nowcast.py -q`
Expected: the three driver tests FAIL (basis stays `"trend"`, no `driver_mom_pct`); the energy test passes trivially (guards the mapping stays closed).

- [ ] **Step 3: Implement `_driver_slice`**

Replace the Task-2 stub in `pipeline/engine/nowcast/models.py`:

```python
def _driver_slice(code: str, conn, config: dict, through_month: str,
                  staleness: dict[str, int] | None, today: str | None) -> float | None:
    """One month of the outlook's futures shock for the two components whose
    pass-through starts immediately. nat_gas/electricity are deliberately
    absent (outlook start_month 2 -- retail utility pass-through lags); wage
    anchor and goods-pipeline tilt are 12-month ramps, negligible at month 1."""
    if conn is None:
        return None
    if code == "food_home" and "food_home" in config:
        cfg = config["food_home"]
        value, used, _ = signals.equal_signal(conn, cfg["series"], through_month,
                                              cfg["lookback_months"], staleness, today)
    elif code == "used_vehicles" and "used_vehicles" in config:
        cfg = config["used_vehicles"]
        rows = vintage.latest(conn, cfg["series"])
        if not signals.fresh_series(rows, cfg["series"], staleness, today):
            return None
        value, _ = signals.lookback_return(rows, through_month, cfg["lookback_months"])
    else:
        return None
    if value is None:
        return None
    return signals.distributed_return(value * cfg["pass_through"], cfg["horizon_months"])
```

(`vintage` is already imported in models.py.)

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest tests/test_nowcast.py -q` then `python3 -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/nowcast/models.py tests/test_nowcast.py
git commit -m "feat(nowcast): one-month futures slices for food_home and lagging used_vehicles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Thread config/staleness through build_latest + run_daily; schema

**Files:**
- Modify: `pipeline/engine/nowcast/models.py` (`build_latest`), `pipeline/run_daily.py:224-226`, `schemas/nowcast_latest.schema.json`
- Test: `tests/test_nowcast.py`, `tests/test_run_daily.py` (existing e2e revalidates schema inline)

**Interfaces:**
- Consumes: `cpi_nowcast(..., conn, config, staleness, today)` (Tasks 2–3).
- Produces: `build_latest(conn, gauge_result, next_release, benchmarks=None, staleness=None, today=None) -> dict` — additive kwargs; run_daily passes its existing `staleness` map and `today`.

- [ ] **Step 1: Write the failing test**

```python
def test_build_latest_threads_staleness_into_cpi_receipts(tmp_path, monkeypatch):
    captured = {}
    real = models.cpi_nowcast

    def spy(gauge_result, target_month, conn=None, config=None,
            staleness=None, today=None):
        captured.update(staleness=staleness, today=today)
        return real(gauge_result, target_month, conn=conn, config=config,
                    staleness=staleness, today=today)

    monkeypatch.setattr(models, "cpi_nowcast", spy)
    _seed(tmp_path, "CPIAUCNS", [("2026-04-01", 320.0), ("2026-05-01", 321.0)])
    _seed(tmp_path, "PCEPI", [("2026-04-01", 126.0), ("2026-05-01", 126.2)])
    _seed(tmp_path, "PAYEMS", [(f"2026-{m:02d}-01", 159000.0 + m) for m in range(1, 6)])
    _seed(tmp_path, "ICSA", [(f"2026-05-{d:02d}", 220000.0) for d in range(1, 9)])
    conn = vintage.load(tmp_path)
    result = build_latest(conn, _sticky_gauge(), {"date": "2026-07-14",
                                                  "reference_month": "2026-06"},
                          staleness={"fmp_corn": 30}, today="2026-06-20")
    assert captured == {"staleness": {"fmp_corn": 30}, "today": "2026-06-20"}
    assert result["cpi"]["components"][0]["basis"] in ("trend", "trend+driver")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_nowcast.py -q`
Expected: FAIL — `build_latest() got an unexpected keyword argument 'staleness'`.

- [ ] **Step 3: Implement threading + schema**

In `models.py`, `build_latest` signature becomes
`def build_latest(conn, gauge_result, next_release, benchmarks=None, staleness=None, today=None) -> dict:`
and the cpi line becomes:

```python
    cpi = cpi_nowcast(gauge_result, next_release["reference_month"], conn=conn,
                      staleness=staleness, today=today)
```

In `pipeline/run_daily.py` (nowcast phase, ~line 224):

```python
        nowcast_state["payload"] = payload = build_nowcast(
            conn, gauge_result, next_release,
            benchmarks=phase3.latest_benchmarks(
                conn, next_release["reference_month"] if next_release else None),
            staleness=staleness, today=today)
```

In `schemas/nowcast_latest.schema.json`, inside `$defs.forecast` add a `properties` key (keep the existing `required` list untouched):

```json
"properties": {
  "components": {
    "type": "array",
    "items": {
      "type": "object",
      "required": ["component", "mom_pct", "weight", "contribution_pp", "basis"],
      "properties": {
        "component": {"type": "string"},
        "mom_pct": {"type": "number"},
        "weight": {"type": "number"},
        "contribution_pp": {"type": "number"},
        "basis": {"enum": ["measured", "trend", "trend+driver"]},
        "driver_mom_pct": {"type": "number"}
      }
    }
  }
}
```

Note the degraded calendar-exhausted payload publishes `components: []` — valid against this. The pce forecast has no `components` key — also valid (not in `required`).

- [ ] **Step 4: Run the suite**

Run: `python3 -m pytest -q`
Expected: all pass — `test_run_daily.py`'s end-to-end run validates the new schema inline against a real payload.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/nowcast/models.py pipeline/run_daily.py schemas/nowcast_latest.schema.json tests/test_nowcast.py
git commit -m "feat(nowcast): thread staleness gating into receipts; schema pins basis field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Site — modeled badge on CPI Preview receipts

**Files:**
- Modify: `site/src/lib/types.ts:68-73`, `site/src/app/cpi-preview/page.tsx:12-14`
- Test: `cd site && npm test && npm run build && npm run e2e`

**Interfaces:**
- Consumes: `basis` / `driver_mom_pct` fields from `nowcast_latest.json` (Task 4 — the live data file must be regenerated in Task 6 before `npm run build`, which imports the JSON; until then build uses the old file, which type-checks because `basis` is typed required but the JSON import is cast via `as Nowcast`).
- Produces: nothing downstream.

- [ ] **Step 1: Update the type**

```typescript
export type NowcastComponent = {
  component: string;
  mom_pct: number;
  weight: number;
  contribution_pp: number;
  basis: "measured" | "trend" | "trend+driver";
  driver_mom_pct?: number;
};
```

- [ ] **Step 2: Update the receipts table row**

In `site/src/app/cpi-preview/page.tsx` replace the row renderer (line 13) so modeled rows carry the existing `.badge` pill, and add one sentence to the method line:

```tsx
      {nowcast.cpi.components.map((row) => <tr key={row.component}><td>{row.component}</td><td>{row.mom_pct.toFixed(2)}%{row.basis !== "measured" && <span className="badge" style={{ marginLeft: 6 }} title={row.driver_mom_pct !== undefined ? `trend + ${row.driver_mom_pct.toFixed(2)}pp futures driver` : "trailing-median trend"}>modeled</span>}</td><td>{(row.weight * 100).toFixed(1)}%</td><td>{row.contribution_pp.toFixed(3)}pp</td></tr>)}
```

And extend line 15's method note:

```tsx
    <p className="method">Status: {nowcast.cpi.status.toUpperCase()}. Rows tagged “modeled” have no observation inside the target month yet: they carry the component’s own trailing-median trend (plus a disclosed futures-driver slice where one applies) instead of a fabricated 0.00%.</p>
```

- [ ] **Step 3: Run site gates**

Run: `cd site && npm test && npm run build`
Expected: vitest 18 passed; static export succeeds (old JSON still type-casts; the fresh file lands in Task 6).

- [ ] **Step 4: Commit**

```bash
git add site/src/lib/types.ts site/src/app/cpi-preview/page.tsx
git commit -m "feat(site): CPI Preview receipts tag modeled component rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live verification, data republish, bookkeeping

**Files:**
- Modify: `todo.md` (#4 → DONE), `CLAUDE.md` (test count), `store/` + `site/public/data/` (pipeline output)

**Interfaces:**
- Consumes: everything above.
- Produces: the deployed artifact set.

- [ ] **Step 1: Run the daily pipeline against real sources**

```bash
set -a; source .env; set +a
python -m pipeline.run_daily --store store --out site/public/data
```

Expected: all 27 files publish; `qa.json` 19/20 (only the known QCEW staleness noise).

- [ ] **Step 2: Inspect the receipts (verify skill applies — drive the surface)**

```bash
python3 - <<'EOF'
import json
nc = json.load(open('site/public/data/nowcast_latest.json'))
rows = nc["cpi"]["components"]
print("mom:", nc["cpi"]["mom_pct"], "| bases:",
      {b: sum(1 for r in rows if r["basis"] == b)
       for b in ("measured", "trend", "trend+driver")})
assert all("basis" in r for r in rows)
zeroes = [r["component"] for r in rows if r["mom_pct"] == 0.0]
print("still exactly 0.00:", zeroes or "none")
EOF
```

Expected: no component pinned at exactly 0.0000 unless its trend genuinely is ~0; `food_home` shows `trend+driver` with `driver_mom_pct`; headline `mom_pct` shifted up vs the old model (~+0.15–0.20pp from sticky services). Then `cd site && npm run e2e` (16 pages, zero console errors) and eyeball `/cpi-preview` via `npm run dev` for the modeled badges.

- [ ] **Step 3: Update `todo.md` #4 to `[DONE 2026-07-14]`** with a two-line summary (root cause: measured-only model fabricated 0.00 for lagging components; fix: trend + disclosed driver slices, receipts basis field). Update `CLAUDE.md`'s pytest count to the new total from Step 1's suite runs.

- [ ] **Step 4: Commit (feat bookkeeping + data separately, repo convention)**

```bash
git add todo.md CLAUDE.md
git commit -m "docs: todo #4 done -- nowcast coverage widened

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git add store site/public/data
git commit -m "data: republish 2026-07-14 -- nowcast receipts carry basis per component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then STOP: push = deploy needs explicit user approval (SDD convention).

---

## Self-review notes

- Spec coverage: model split (T2/T3), energy exclusion (T3 test), config reuse (T2/T4), signals extraction (T1), receipts+schema (T4), site tag (T5), grading untouched (no backtest task — deliberate), live verification (T6). Backtest/`nextprint` need no changes (`nextprint.json` carries forecasters, not components — checked 2026-07-14).
- Type consistency: `cpi_nowcast(gauge_result, target_month, conn=None, config=None, staleness=None, today=None)` used identically in T2 impl, T3 tests, T4 spy.
- `last_obs` becomes a required key of nowcast component dicts — the gauge always emits it; both pre-existing fixtures are updated in T2 Step 1.
