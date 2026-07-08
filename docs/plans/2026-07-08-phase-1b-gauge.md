# macrogauge Phase 1b — The Independent Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five-stage gauge engine (rebase → blend/splice → quality gate → aggregate → variants) over the vintage store, publish four new JSONs (`pulse`, `gauge_daily`, `compare`, `gaptable`), retire `pulse_lite`, and put the gauge YoY on the homepage hero row.

**Architecture:** Five pure engine modules over plain `{obs_date: value}` dicts, orchestrated by `pipeline/engine/gauge.py`; a new `config/basket.json` declares the 14 CPI components (weights, official series, live blend specs). Writers consume the orchestrator's result dict. Spec: `docs/superpowers/specs/2026-07-07-phase-1b-gauge-design.md`.

**Tech Stack:** Python 3.12 stdlib + `requests` + `jsonschema` (pytest dev). Site: existing Next.js static export + TypeScript. No new dependencies.

## Global Constraints

- Pipeline dependencies: `requests` and `jsonschema` only (+ `pytest` dev). Engine is pure stdlib.
- Vintage store: append-only JSONL; latest vintage wins on read; row-evolution policy unchanged.
- Every published JSON: exactly one writer module + one JSON Schema in `schemas/`; validated in `run_daily` before publish and by `tests/test_published_data.py` on the committed artifact. A schema-invalid payload FAILS the run (bad contract must not deploy); QA failures and connector failures never block.
- **Rounding owner:** the pipeline publishes final numbers — percentages/pp rounded 2dp, index levels 2dp, correlation 4dp; YoY always computed from unrounded indexes, then rounded. The site only formats (1dp display).
- All dates `YYYY-MM-DD`; monthly observations first-of-month; scheduling in ET.
- Tests never hit the network; engine tests use hand-computed fixtures via `vintage.append`/`load` on `tmp_path`.
- Design tokens (site task): bg `#0B0F14`, card `#11161C`, border `#1E2630`, text `#E6EDF3`, muted `#8B98A5`; sky `#38BDF8` = ours, amber `#F59E0B` = official, red `#F87171` hot, emerald `#34D399` cool, violet `#A78BFA`; tokens only via CSS vars.
- Commit messages: conventional prefixes (`feat:`, `fix:`, `test:`, `data:`, `docs:`, `ci:`, `chore:`).
- TDD integrity: run failing tests BEFORE implementing; capture the RED output into the task report at run time.
- Work from `~/Development/macrogauge`, venv active (`source .venv/bin/activate`); site work in `site/` with npm.

**Locked deviations (decided in the spec/brainstorm, implement as stated):**

1. **Rebase anchor fallback** — spec anchor is the mean of a series' Jan-2018 observations; when a series has no Jan-2018 rows (short-history fixture stores; Phase-2 late starters), anchor on the series' FIRST month instead. In production every basket series has 2017+ history, so the fallback never fires there.
2. **Gate "hold one day"** — implemented statelessly: a >5% move is held only while the spiking observation is the *just-arrived* (vintage_date == today) last observation of a live component. Tomorrow it is no longer just-arrived and passes through. Historical jumps always stand.
3. **Basket config is JSON** (`config/basket.json`), same no-new-deps deviation as the series registry.

## File Structure

```
config/basket.json                  # 14 components: weight, official series, live blend (Task 1)
pipeline/basket.py                  # load_basket() + validation (Task 1)
pipeline/engine/rebase.py           # stage 1 (Task 2)
pipeline/engine/blend.py            # stage 2: blend() + splice() (Task 3)
pipeline/engine/gate.py             # stage 3 (Task 4)
pipeline/engine/aggregate.py        # stage 4: fill_daily(), headline(), yoy() (Task 5)
pipeline/engine/variants.py         # stage 5: build_component() (Task 6)
pipeline/engine/gauge.py            # orchestrator: run() (Task 6)
pipeline/publish/pulse.py           # + schemas/pulse.schema.json (Task 7)
pipeline/publish/gauge_daily.py     # + schemas/gauge_daily.schema.json (Task 8)
pipeline/publish/compare.py         # + schemas/compare.schema.json (Task 9)
pipeline/publish/gaptable.py        # + schemas/gaptable.schema.json (Task 10)
tests/test_backfill.py              # exit criterion: tracker corr ≥ 0.95 (Task 11)
pipeline/publish/qa.py              # + 5 gauge checks (Task 12)
pipeline/run_daily.py               # rewired; pulse_lite retired (Task 13)
site/src/components/KpiCard.tsx     # optional chip prop (Task 14)
site/src/app/page.tsx               # gauge KPI card (Task 14)
DELETED: pipeline/publish/pulse_lite.py, schemas/pulse_lite.schema.json,
         tests/test_pulse_lite.py, site/public/data/pulse_lite.json (Task 13)
```

---

### Task 1: Basket config + loader

**Files:**
- Create: `config/basket.json`
- Create: `pipeline/basket.py`
- Test: `tests/test_basket.py`

**Interfaces:**
- Consumes: nothing (config + loader, mirrors `pipeline/registry.py`).
- Produces: `basket.load_basket(path: Path | None = None) -> tuple[str, list[Component]]` returning `(base_month, components)`. `Component` is a frozen dataclass: `code: str`, `label: str`, `weight: float`, `official_series: str`, `live_blend: dict[str, float] | None`, `live_variants: tuple[str, ...]`. Raises `ValueError` on duplicate codes, weights not summing to 1 (±1e-9), or `live_variants` without `live_blend`.

- [ ] **Step 1: Write the failing tests** (`tests/test_basket.py`)

```python
import json

import pytest

from pipeline import basket, registry


def test_default_basket_loads_and_is_valid():
    base_month, comps = basket.load_basket()
    assert base_month == "2018-01"
    assert len(comps) == 14
    assert sum(c.weight for c in comps) == pytest.approx(1.0, abs=1e-9)
    by_code = {c.code: c for c in comps}
    assert by_code["shelter_owned"].weight == 0.265
    assert by_code["shelter_owned"].official_series == "CUUR0000SEHC"
    assert by_code["shelter_owned"].live_variants == ("gauge",)
    assert by_code["fuel"].live_variants == ("gauge", "tracker")
    assert by_code["medical"].live_blend is None
    assert by_code["medical"].live_variants == ()


def test_official_series_exist_in_registry():
    _, comps = basket.load_basket()
    _, series = registry.load_registry()
    codes = {s.code for s in series}
    missing = [c.official_series for c in comps if c.official_series not in codes]
    assert missing == []


def test_bad_weight_sum_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "official_series": "X"},
        {"code": "b", "label": "B", "weight": 0.4, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="sum"):
        basket.load_basket(p)


def test_duplicate_code_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 0.5, "official_series": "X"},
        {"code": "a", "label": "A2", "weight": 0.5, "official_series": "Y"}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate"):
        basket.load_basket(p)


def test_live_variants_without_blend_raises(tmp_path):
    bad = {"base_month": "2018-01", "components": [
        {"code": "a", "label": "A", "weight": 1.0, "official_series": "X",
         "live_variants": ["gauge"]}]}
    p = tmp_path / "basket.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="live_blend"):
        basket.load_basket(p)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source .venv/bin/activate && pytest tests/test_basket.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.basket'`

- [ ] **Step 3: Write `config/basket.json`**

Weights are the 2026 seed weights from the master design (BLS December relative importance), Σ = 1.000. Blend specs declare Phase-2 sources (`aptlist_us`, `redfin_us`) with their design weights — the blender renormalizes over sources present in the store, so ZORI carries 100% of shelter today and Phase 2 becomes a config change.

```json
{
  "base_month": "2018-01",
  "components": [
    {"code": "shelter_owned", "label": "Shelter (owned)", "weight": 0.265,
     "official_series": "CUUR0000SEHC",
     "live_blend": {"zori_us": 0.50, "aptlist_us": 0.30, "redfin_us": 0.20},
     "live_variants": ["gauge"]},
    {"code": "other", "label": "Other goods & services", "weight": 0.185,
     "official_series": "CUUR0000SAG"},
    {"code": "food_home", "label": "Food at home", "weight": 0.082,
     "official_series": "CUUR0000SAF11"},
    {"code": "medical", "label": "Medical care", "weight": 0.081,
     "official_series": "CUUR0000SAM"},
    {"code": "shelter_rent", "label": "Rent", "weight": 0.075,
     "official_series": "CUUR0000SEHA",
     "live_blend": {"zori_us": 0.50, "aptlist_us": 0.30, "redfin_us": 0.20},
     "live_variants": ["gauge"]},
    {"code": "food_away", "label": "Food away from home", "weight": 0.057,
     "official_series": "CUUR0000SEFV"},
    {"code": "education_comm", "label": "Education & comm", "weight": 0.055,
     "official_series": "CUUR0000SAE"},
    {"code": "recreation", "label": "Recreation", "weight": 0.053,
     "official_series": "CUUR0000SAR"},
    {"code": "new_vehicles", "label": "New vehicles", "weight": 0.036,
     "official_series": "CUUR0000SETA01"},
    {"code": "fuel", "label": "Gasoline", "weight": 0.030,
     "official_series": "CUUR0000SETB01",
     "live_blend": {"eia_gasreg_w": 1.0},
     "live_variants": ["gauge", "tracker"]},
    {"code": "electricity", "label": "Electricity", "weight": 0.028,
     "official_series": "CUUR0000SEHF01",
     "live_blend": {"eia_elec_res": 1.0},
     "live_variants": ["gauge", "tracker"]},
    {"code": "apparel", "label": "Apparel", "weight": 0.025,
     "official_series": "CUUR0000SAA"},
    {"code": "used_vehicles", "label": "Used cars & trucks", "weight": 0.021,
     "official_series": "CUUR0000SETA02"},
    {"code": "nat_gas", "label": "Piped gas", "weight": 0.007,
     "official_series": "CUUR0000SEHF02",
     "live_blend": {"eia_ng_res": 1.0},
     "live_variants": ["gauge", "tracker"]}
  ]
}
```

- [ ] **Step 4: Write `pipeline/basket.py`**

```python
"""Basket config — the 14 CPI components: weights, official series, live specs."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "basket.json"


@dataclass(frozen=True)
class Component:
    code: str                            # internal component id, e.g. "shelter_owned"
    label: str                           # display label (gaptable rows)
    weight: float                        # BLS relative-importance seed weight
    official_series: str                 # store series code of the official BLS index
    live_blend: dict[str, float] | None  # store series code -> design blend weight
    live_variants: tuple[str, ...]       # variants whose live blend drives this component


def load_basket(path: Path | None = None) -> tuple[str, list[Component]]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    comps = [Component(code=c["code"], label=c["label"], weight=c["weight"],
                       official_series=c["official_series"],
                       live_blend=c.get("live_blend"),
                       live_variants=tuple(c.get("live_variants", [])))
             for c in raw["components"]]
    codes = [c.code for c in comps]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"duplicate component codes: {sorted(dupes)}")
    total = sum(c.weight for c in comps)
    if abs(total - 1.0) > 1e-9:
        raise ValueError(f"basket weights sum to {total}, expected 1.0")
    for c in comps:
        if c.live_variants and not c.live_blend:
            raise ValueError(f"{c.code}: live_variants requires live_blend")
    return raw["base_month"], comps
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_basket.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add config/basket.json pipeline/basket.py tests/test_basket.py
git commit -m "feat: basket config + loader — 14 components, seed weights, live blend specs"
```

---

### Task 2: Engine stage 1 — rebase

**Files:**
- Create: `pipeline/engine/rebase.py`
- Test: `tests/test_rebase.py`

**Interfaces:**
- Consumes: plain `{obs_date: value}` dicts (from `dict(vintage.latest(conn, code))`).
- Produces: `rebase.rebase(series: dict[str, float], base_month: str = "2018-01") -> dict[str, float]` — series scaled so the mean of its base-month observations = 100; falls back to the series' first month when the base month has no observations (locked deviation 1). Raises `ValueError` on empty series or zero anchor. `rebase.BASE_MONTH = "2018-01"`.

- [ ] **Step 1: Write the failing tests** (`tests/test_rebase.py`)

```python
import pytest

from pipeline.engine import rebase


def test_monthly_anchor():
    s = {"2017-12-01": 90.0, "2018-01-01": 200.0, "2018-02-01": 210.0}
    r = rebase.rebase(s)
    assert r["2018-01-01"] == pytest.approx(100.0)
    assert r["2018-02-01"] == pytest.approx(105.0)
    assert r["2017-12-01"] == pytest.approx(45.0)  # pre-base history kept


def test_weekly_mean_anchor():
    s = {"2018-01-01": 3.0, "2018-01-08": 3.2, "2018-01-15": 3.4,
         "2018-02-05": 4.8}
    r = rebase.rebase(s)
    # anchor = mean(3.0, 3.2, 3.4) = 3.2
    assert r["2018-01-08"] == pytest.approx(100.0)
    assert r["2018-02-05"] == pytest.approx(150.0)


def test_late_start_falls_back_to_first_month():
    s = {"2025-04-01": 50.0, "2025-05-01": 55.0}
    r = rebase.rebase(s)
    assert r["2025-04-01"] == pytest.approx(100.0)
    assert r["2025-05-01"] == pytest.approx(110.0)


def test_empty_series_raises():
    with pytest.raises(ValueError):
        rebase.rebase({})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_rebase.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.engine.rebase'`

- [ ] **Step 3: Write `pipeline/engine/rebase.py`**

```python
"""Engine stage 1: index any series so its base-month mean = 100.

Rebasing makes price levels ($/gal, cents/kWh, $ rent) unitless and
comparable. Anchor = mean of the series' observations dated within the base
month (robust for weekly series). A series with no base-month rows anchors on
its FIRST month instead — late starters are spliced and re-anchored
downstream, and short-history fixture stores must still run; in production
every basket series has 2017+ history, so the fallback never fires.
"""

BASE_MONTH = "2018-01"


def rebase(series: dict[str, float], base_month: str = BASE_MONTH) -> dict[str, float]:
    if not series:
        raise ValueError("rebase: empty series")
    months = sorted({d[:7] for d in series})
    anchor_month = base_month if base_month in months else months[0]
    vals = [v for d, v in series.items() if d[:7] == anchor_month]
    anchor = sum(vals) / len(vals)
    if anchor == 0:
        raise ValueError("rebase: zero anchor value")
    return {d: v / anchor * 100 for d, v in series.items()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_rebase.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/rebase.py tests/test_rebase.py
git commit -m "feat: engine rebase — Jan-2018=100 anchor with first-month fallback"
```

---

### Task 3: Engine stage 2 — blend & splice

**Files:**
- Create: `pipeline/engine/blend.py`
- Test: `tests/test_blend.py`

**Interfaces:**
- Consumes: rebased `{obs_date: value}` dicts.
- Produces:
  - `blend.blend(sources: dict[str, dict[str, float]], weights: dict[str, float]) -> dict[str, float]` — weighted arithmetic mean on the union date grid; each source forward-fills its last value; weights renormalize over sources contributing at each date. Raises `ValueError` when every source is empty.
  - `blend.splice(official: dict[str, float], live: dict[str, float]) -> dict[str, float]` — official history strictly before the live start date `t0`; live scaled by `official_at_or_before(t0) / live(t0)` from `t0` on (scale 1.0 when no official value exists at/before `t0`). Empty `live` returns a copy of `official`.

- [ ] **Step 1: Write the failing tests** (`tests/test_blend.py`)

```python
import pytest

from pipeline.engine import blend


def test_blend_single_source_passthrough():
    z = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    out = blend.blend({"zori": z}, {"zori": 0.5, "aptlist": 0.3, "redfin": 0.2})
    assert out == {"2018-01-01": 100.0, "2018-02-01": 110.0}


def test_blend_two_sources_renormalized_weights():
    a = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    b = {"2018-01-01": 100.0, "2018-02-01": 100.0}
    out = blend.blend({"a": a, "b": b}, {"a": 0.5, "b": 0.3})
    # renormalized weights 5/8, 3/8 -> 110*0.625 + 100*0.375 = 106.25
    assert out["2018-02-01"] == pytest.approx(106.25)


def test_blend_late_source_joins_midway():
    a = {"2018-01-01": 100.0, "2018-02-01": 110.0}
    b = {"2018-02-01": 100.0}
    out = blend.blend({"a": a, "b": b}, {"a": 0.5, "b": 0.5})
    assert out["2018-01-01"] == pytest.approx(100.0)  # a alone
    assert out["2018-02-01"] == pytest.approx(105.0)  # equal-weight mean


def test_blend_all_empty_raises():
    with pytest.raises(ValueError):
        blend.blend({"a": {}, "b": {}}, {"a": 0.5, "b": 0.5})


def test_splice_scales_live_at_first_overlap():
    official = {"2017-01-01": 100.0, "2017-06-01": 104.0, "2018-01-01": 110.0}
    live = {"2017-06-01": 52.0, "2017-07-01": 54.0}
    out = blend.splice(official, live)
    # scale = official(2017-06-01) / live(2017-06-01) = 104/52 = 2.0
    assert out["2017-01-01"] == 100.0                    # official kept pre-live
    assert out["2017-06-01"] == pytest.approx(104.0)
    assert out["2017-07-01"] == pytest.approx(108.0)
    assert "2018-01-01" not in out                       # official post-t0 dropped


def test_splice_live_start_between_official_points_uses_prior():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0}
    live = {"2017-01-15": 50.0, "2017-02-15": 51.0}
    out = blend.splice(official, live)
    # official at/before 2017-01-15 -> 100.0, scale 2.0
    assert out["2017-01-15"] == pytest.approx(100.0)
    assert out["2017-02-15"] == pytest.approx(102.0)
    assert out["2017-01-01"] == 100.0
    assert "2017-02-01" not in out


def test_splice_empty_live_returns_official_copy():
    official = {"2017-01-01": 100.0}
    out = blend.splice(official, {})
    assert out == official and out is not official


def test_splice_live_predates_official_uses_scale_one():
    official = {"2018-01-01": 110.0}
    live = {"2017-06-01": 52.0, "2018-01-01": 55.0}
    out = blend.splice(official, live)
    assert out["2017-06-01"] == pytest.approx(52.0)
    assert out["2018-01-01"] == pytest.approx(55.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_blend.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.engine.blend'`

- [ ] **Step 3: Write `pipeline/engine/blend.py`**

```python
"""Engine stage 2: blend live sources; splice live data onto official history."""


def blend(sources: dict[str, dict[str, float]],
          weights: dict[str, float]) -> dict[str, float]:
    """Weighted arithmetic mean over the union date grid.

    Each source forward-fills its last value; at every date, weights
    renormalize over the sources that have contributed so far — so a basket
    declared {zori .5, aptlist .3, redfin .2} with only ZORI in the store
    rides 100% ZORI, and Phase-2 sources phase in without code changes.
    """
    avail = {n: s for n, s in sources.items() if s}
    if not avail:
        raise ValueError("blend: no sources available")
    dates = sorted(set().union(*(s.keys() for s in avail.values())))
    out: dict[str, float] = {}
    last: dict[str, float] = {}
    for d in dates:
        for n, s in avail.items():
            if d in s:
                last[n] = s[d]
        total = sum(weights[n] for n in last)
        out[d] = sum(weights[n] * v for n, v in last.items()) / total
    return out


def splice(official: dict[str, float], live: dict[str, float]) -> dict[str, float]:
    """Official history before the live start; live (scaled to match) after.

    Scale = official value at/before the live start divided by the live value
    there, so the assembled series is continuous at the splice point.
    """
    if not live:
        return dict(official)
    t0 = min(live)
    prior = [official[d] for d in sorted(official) if d <= t0]
    scale = (prior[-1] / live[t0]) if prior else 1.0
    out = {d: v for d, v in official.items() if d < t0}
    out.update({d: v * scale for d, v in live.items()})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_blend.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/blend.py tests/test_blend.py
git commit -m "feat: engine blend + splice — renormalizing blend, continuous splice"
```

---

### Task 4: Engine stage 3 — quality gate

**Files:**
- Create: `pipeline/engine/gate.py`
- Test: `tests/test_gate.py`

**Interfaces:**
- Consumes: an assembled live component `{obs_date: value}` dict + `arrived_today: bool` (computed by the orchestrator from vintage dates).
- Produces: `gate.apply_gate(series: dict[str, float], arrived_today: bool, max_move: float = 0.05) -> tuple[dict[str, float], bool]` — returns `(possibly-held copy, flagged)`. Holds the LAST observation at the prior observation's value when it just arrived and moves >`max_move`. `gate.MAX_MOVE = 0.05`.

- [ ] **Step 1: Write the failing tests** (`tests/test_gate.py`)

```python
from pipeline.engine import gate


def test_holds_just_arrived_spike():
    s = {"2026-07-01": 100.0, "2026-07-02": 106.0}  # +6% > 5%
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held["2026-07-02"] == 100.0
    assert flagged is True
    assert s["2026-07-02"] == 106.0  # input not mutated


def test_passes_small_move():
    s = {"2026-07-01": 100.0, "2026-07-02": 104.9}
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held == s and flagged is False


def test_old_last_obs_passes_through():
    # spike that persisted (not just-arrived) is real — stands
    s = {"2026-07-01": 100.0, "2026-07-02": 106.0}
    held, flagged = gate.apply_gate(s, arrived_today=False)
    assert held == s and flagged is False


def test_negative_spike_held():
    s = {"2026-07-01": 100.0, "2026-07-02": 94.0}  # -6%
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held["2026-07-02"] == 100.0 and flagged is True


def test_single_obs_noop():
    s = {"2026-07-01": 100.0}
    held, flagged = gate.apply_gate(s, arrived_today=True)
    assert held == s and flagged is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_gate.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.engine.gate'`

- [ ] **Step 3: Write `pipeline/engine/gate.py`**

```python
"""Engine stage 3: >5% one-day quality gate for live components.

Stateless "hold one day": a spike is held only while it is the just-arrived
(vintage_date == today) last observation. On the next run it is no longer
just-arrived and passes through — a spike that persists was real. Historical
jumps always stand; this protects only the newest incoming point.
"""

MAX_MOVE = 0.05


def apply_gate(series: dict[str, float], arrived_today: bool,
               max_move: float = MAX_MOVE) -> tuple[dict[str, float], bool]:
    dates = sorted(series)
    if len(dates) < 2 or not arrived_today:
        return dict(series), False
    prev, last = series[dates[-2]], series[dates[-1]]
    if prev and abs(last / prev - 1) > max_move:
        held = dict(series)
        held[dates[-1]] = prev
        return held, True
    return dict(series), False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_gate.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/gate.py tests/test_gate.py
git commit -m "feat: engine quality gate — hold just-arrived >5% moves one run"
```

---

### Task 5: Engine stage 4 — daily grid, Laspeyres, YoY

**Files:**
- Create: `pipeline/engine/aggregate.py`
- Test: `tests/test_aggregate.py`

**Interfaces:**
- Consumes: component `{obs_date: value}` dicts.
- Produces:
  - `aggregate.fill_daily(series: dict[str, float], start: str, end: str) -> dict[str, float]` — forward-fill onto every calendar day from `max(start, first obs)` through `end`; never back-fills before the first observation.
  - `aggregate.headline(components: dict[str, dict[str, float]], weights: dict[str, float]) -> dict[str, float]` — Laspeyres `Σ wᵢ×componentᵢ` on dates where EVERY component has a value; weights renormalized to sum 1.
  - `aggregate.yoy(index: dict[str, float]) -> dict[str, float | None]` — `(index_t / index_{t−365d} − 1) × 100`; `None` where the base date is absent. Unrounded.

- [ ] **Step 1: Write the failing tests** (`tests/test_aggregate.py`)

```python
import pytest

from pipeline.engine import aggregate


def test_fill_daily_forward_fills():
    s = {"2026-01-01": 100.0, "2026-01-04": 103.0}
    f = aggregate.fill_daily(s, "2026-01-01", "2026-01-05")
    assert f == {"2026-01-01": 100.0, "2026-01-02": 100.0, "2026-01-03": 100.0,
                 "2026-01-04": 103.0, "2026-01-05": 103.0}


def test_fill_daily_no_backfill_before_first_obs():
    s = {"2026-01-03": 100.0}
    f = aggregate.fill_daily(s, "2026-01-01", "2026-01-04")
    assert sorted(f) == ["2026-01-03", "2026-01-04"]


def test_headline_intersection_and_renormalized_weights():
    comps = {"a": {"2026-01-01": 100.0, "2026-01-02": 110.0},
             "b": {"2026-01-02": 100.0}}
    idx = aggregate.headline(comps, {"a": 0.6, "b": 0.2})
    # only 2026-01-02 has both; weights renormalize to .75/.25
    assert idx == {"2026-01-02": pytest.approx(110 * 0.75 + 100 * 0.25)}


def test_yoy_365_day_base():
    idx = {"2025-01-01": 100.0, "2025-06-01": 101.0, "2026-01-01": 103.0}
    y = aggregate.yoy(idx)
    assert y["2026-01-01"] == pytest.approx(3.0)
    assert y["2025-01-01"] is None  # no base a year earlier
    assert y["2025-06-01"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_aggregate.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.engine.aggregate'`

- [ ] **Step 3: Write `pipeline/engine/aggregate.py`**

```python
"""Engine stage 4: daily forward-fill grid, Laspeyres aggregate, YoY."""
from datetime import date, timedelta


def fill_daily(series: dict[str, float], start: str, end: str) -> dict[str, float]:
    """Forward-fill onto every day in [max(start, first obs), end]."""
    obs = sorted(series)
    out: dict[str, float] = {}
    d = date.fromisoformat(max(start, obs[0]))
    stop = date.fromisoformat(end)
    idx, cur = 0, None
    while d <= stop:
        ds = d.isoformat()
        while idx < len(obs) and obs[idx] <= ds:
            cur = series[obs[idx]]
            idx += 1
        if cur is not None:
            out[ds] = cur
        d += timedelta(days=1)
    return out


def headline(components: dict[str, dict[str, float]],
             weights: dict[str, float]) -> dict[str, float]:
    """Laspeyres on dates where every component has a value; weights sum to 1."""
    dates = set.intersection(*(set(c) for c in components.values()))
    total = sum(weights.values())
    return {d: sum(weights[k] * components[k][d] for k in components) / total
            for d in sorted(dates)}


def yoy(index: dict[str, float]) -> dict[str, float | None]:
    """index_t / index_{t-365d} - 1, in percent; None where the base is missing."""
    out: dict[str, float | None] = {}
    for d, v in index.items():
        base = index.get((date.fromisoformat(d) - timedelta(days=365)).isoformat())
        out[d] = (v / base - 1) * 100 if base else None
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_aggregate.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/aggregate.py tests/test_aggregate.py
git commit -m "feat: engine aggregate — daily grid, Laspeyres headline, 365d YoY"
```

---

### Task 6: Variants + orchestrator

**Files:**
- Create: `pipeline/engine/variants.py`
- Create: `pipeline/engine/gauge.py`
- Test: `tests/test_gauge.py`

**Interfaces:**
- Consumes: `basket.load_basket()`, `vintage.latest/max_obs_date`, and the four stage modules (Tasks 2–5).
- Produces (writers in Tasks 7–10 depend on this exact shape):
  - `variants.VARIANTS = ("gauge", "tracker")`
  - `variants.build_component(comp: basket.Component, variant: str, official_series: dict[str, float], live_sources: dict[str, dict[str, float]]) -> tuple[dict[str, float], str]` — returns `(component index re-anchored to the base month, mode)` where mode is `"live"` or `"bls_cf"`.
  - `gauge.GRID_START = "2017-01-01"`, `gauge.PUBLISH_START = "2018-01-01"`
  - `gauge.run(conn, today: str, basket_path: Path | None = None, staleness: dict[str, int] | None = None) -> dict` returning:

```python
{"base_month": "2018-01",
 "variants": {
   "<gauge|tracker>": {
     "index": {date: float},          # daily headline index, unrounded
     "yoy":   {date: float | None},   # daily YoY %, unrounded
     "as_of": str,                    # last grid date = max component obs date
     "coverage_pct": float,           # Σ weight of fresh live components × 100
     "gate_flags": [str],             # "component@date" held today
     "components": {
       code: {"weight": float, "mode": "live" | "bls_cf",
              "yoy_pct": float | None,   # component YoY at as_of, unrounded
              "end_value": float}}}}}    # component index at as_of
```

- [ ] **Step 1: Write the failing tests** (`tests/test_gauge.py`)

Two-component mini-basket, hand-computed. Live shelter runs +6% YoY vs official +3%; fuel identical live/official at +4%. Gauge = .6×106 + .4×104 = 105.2 → 5.2% YoY; tracker = .6×103 + .4×104 = 103.4 → 3.4%. Seed vintages are older than `today` so the gate stays quiet; a separate test pins gate wiring.

```python
import json

import pytest

from pipeline.engine import gauge
from pipeline.models import Observation
from pipeline.store import vintage

MINI = {"base_month": "2018-01", "components": [
    {"code": "shelter", "label": "Shelter", "weight": 0.6,
     "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
     "live_variants": ["gauge"]},
    {"code": "fuel", "label": "Fuel", "weight": 0.4,
     "official_series": "OFF_FU", "live_blend": {"LIVE_FU": 1.0},
     "live_variants": ["gauge", "tracker"]}]}

ROWS = [  # (series, obs_date, value)
    ("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2019-01-01", 103.0),
    ("LIVE_SH", "2018-01-01", 50.0), ("LIVE_SH", "2019-01-01", 53.0),
    ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2019-01-01", 208.0),
    ("LIVE_FU", "2018-01-01", 10.0), ("LIVE_FU", "2019-01-01", 10.4)]

STALENESS = {"LIVE_SH": 75, "LIVE_FU": 21}


def seed(tmp_path, rows, vintage_date="2019-01-02"):
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date=vintage_date, source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(MINI))
    return vintage.load(tmp_path), bp


def test_two_variant_hand_computed(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g, t = r["variants"]["gauge"], r["variants"]["tracker"]
    assert r["base_month"] == "2018-01"
    assert g["as_of"] == "2019-01-01" and t["as_of"] == "2019-01-01"
    # 365d from 2019-01-01 lands exactly on 2018-01-01 (2018 not a leap year)
    assert g["yoy"]["2019-01-01"] == pytest.approx(5.2)
    assert t["yoy"]["2019-01-01"] == pytest.approx(3.4)
    assert g["index"]["2018-01-01"] == pytest.approx(100.0)
    assert g["yoy"]["2018-06-01"] is None  # no 365d base inside the window
    assert g["components"]["shelter"]["mode"] == "live"
    assert t["components"]["shelter"]["mode"] == "bls_cf"
    assert g["components"]["shelter"]["yoy_pct"] == pytest.approx(6.0)
    assert g["components"]["fuel"]["yoy_pct"] == pytest.approx(4.0)
    assert g["components"]["fuel"]["end_value"] == pytest.approx(104.0)
    # coverage: both live blends fresh (4 days old vs 75/21 limits)
    assert g["coverage_pct"] == pytest.approx(100.0)
    assert t["coverage_pct"] == pytest.approx(40.0)
    assert g["gate_flags"] == []


def test_stale_live_source_lowers_coverage(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-04-01", basket_path=bp, staleness=STALENESS)
    # 90 days after last obs: shelter (75d limit) and fuel (21d) both stale
    assert r["variants"]["gauge"]["coverage_pct"] == pytest.approx(0.0)
    # staleness affects coverage only — the index still publishes
    assert r["variants"]["gauge"]["yoy"]["2019-01-01"] == pytest.approx(5.2)


def test_gate_holds_spiking_arrival(tmp_path):
    # fuel's last live obs jumps +6% AND arrived today -> held at prior value
    rows = [row for row in ROWS if row[0] != "LIVE_FU"] + [
        ("LIVE_FU", "2018-01-01", 10.0), ("LIVE_FU", "2018-12-25", 10.0)]
    conn, bp = seed(tmp_path, rows)
    spike = [Observation(series_code="LIVE_FU", obs_date="2019-01-01", value=10.6,
                         vintage_date="2019-01-05", source="T", route="API")]
    vintage.append(spike, tmp_path)
    conn = vintage.load(tmp_path)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    assert g["gate_flags"] == ["fuel@2019-01-01"]
    assert g["components"]["fuel"]["end_value"] == pytest.approx(100.0)  # held


def test_missing_live_source_falls_back_to_bls_cf(tmp_path):
    rows = [row for row in ROWS if row[0] != "LIVE_SH"]
    conn, bp = seed(tmp_path, rows)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    g = r["variants"]["gauge"]
    assert g["components"]["shelter"]["mode"] == "bls_cf"
    assert g["yoy"]["2019-01-01"] == pytest.approx(0.6 * 3.0 + 0.4 * 4.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_gauge.py -v`
Expected: collection ERROR — `ModuleNotFoundError: No module named 'pipeline.engine.gauge'`

- [ ] **Step 3: Write `pipeline/engine/variants.py`**

```python
"""Engine stage 5: per-variant component construction.

gauge   — the market-rent blend drives BOTH shelter components.
tracker — official shelter dynamics; only fuel/electricity/nat_gas ride live.
Which components ride live data in which variant is config (live_variants in
config/basket.json), not code.
"""
from pipeline import basket
from pipeline.engine import blend as blend_mod
from pipeline.engine import rebase as rebase_mod

VARIANTS = ("gauge", "tracker")


def build_component(comp: basket.Component, variant: str,
                    official_series: dict[str, float],
                    live_sources: dict[str, dict[str, float]]
                    ) -> tuple[dict[str, float], str]:
    """Assemble one component's index for one variant.

    Inputs are raw store series ({obs_date: value}); output is re-anchored to
    the base month so every component shares the Laspeyres base point.
    """
    official_idx = rebase_mod.rebase(official_series)
    if variant in comp.live_variants and any(live_sources.values()):
        live = blend_mod.blend(
            {k: rebase_mod.rebase(v) for k, v in live_sources.items() if v},
            comp.live_blend)
        assembled = blend_mod.splice(official_idx, live)
        return rebase_mod.rebase(assembled), "live"
    return official_idx, "bls_cf"
```

- [ ] **Step 4: Write `pipeline/engine/gauge.py`**

```python
"""Gauge engine orchestrator: store -> five stages -> per-variant results."""
import sqlite3
from datetime import date
from pathlib import Path

from pipeline import basket as basket_mod
from pipeline.engine import aggregate, gate, variants
from pipeline.store import vintage

GRID_START = "2017-01-01"    # internal grid start: feeds 365d YoY bases for 2018
PUBLISH_START = "2018-01-01"  # writers publish from here


def _series(conn: sqlite3.Connection, code: str) -> dict[str, float]:
    return dict(vintage.latest(conn, code))


def _arrived_today(conn, codes: list[str], obs_date: str, today: str) -> bool:
    q = ",".join("?" * len(codes))
    row = conn.execute(
        f"SELECT MAX(vintage_date) FROM observations "
        f"WHERE series_code IN ({q}) AND obs_date = ?",
        (*codes, obs_date)).fetchone()
    return row[0] == today


def _fresh(conn, blend_codes, staleness: dict[str, int], today: str) -> bool:
    """A component is fresh when ANY blend source is within its staleness."""
    for code in blend_codes:
        latest_obs = vintage.max_obs_date(conn, code)
        limit = staleness.get(code)
        if latest_obs is not None and limit is not None and \
                (date.fromisoformat(today) - date.fromisoformat(latest_obs)).days <= limit:
            return True
    return False


def run(conn: sqlite3.Connection, today: str, basket_path: Path | None = None,
        staleness: dict[str, int] | None = None) -> dict:
    base_month, comps = basket_mod.load_basket(basket_path)
    staleness = staleness or {}
    weights = {c.code: c.weight for c in comps}
    out = {}
    for variant in variants.VARIANTS:
        built, modes, flags = {}, {}, []
        for comp in comps:
            official_series = _series(conn, comp.official_series)
            live_sources = ({name: _series(conn, name) for name in comp.live_blend}
                            if comp.live_blend else {})
            idx, mode = variants.build_component(comp, variant,
                                                 official_series, live_sources)
            if mode == "live":
                last = max(idx)
                arrived = _arrived_today(conn, list(comp.live_blend), last, today)
                idx, flagged = gate.apply_gate(idx, arrived)
                if flagged:
                    flags.append(f"{comp.code}@{last}")
            built[comp.code], modes[comp.code] = idx, mode
        end = max(max(c) for c in built.values())
        daily = {k: aggregate.fill_daily(c, GRID_START, end)
                 for k, c in built.items()}
        index = aggregate.headline(daily, weights)
        coverage = sum(c.weight for c in comps
                       if modes[c.code] == "live"
                       and _fresh(conn, c.live_blend, staleness, today))
        out[variant] = {
            "index": index, "yoy": aggregate.yoy(index), "as_of": end,
            "coverage_pct": coverage * 100, "gate_flags": flags,
            "components": {
                c.code: {"weight": c.weight, "mode": modes[c.code],
                         "yoy_pct": aggregate.yoy(daily[c.code]).get(end),
                         "end_value": daily[c.code][end]}
                for c in comps}}
    return {"base_month": base_month, "variants": out}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_gauge.py -v`
Expected: 4 passed

- [ ] **Step 6: Run the whole suite (no regressions)**

Run: `pytest -q`
Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add pipeline/engine/variants.py pipeline/engine/gauge.py tests/test_gauge.py
git commit -m "feat: gauge engine orchestrator — two variants over five pure stages"
```

---

### Task 7: pulse.json writer + schema

**Files:**
- Create: `pipeline/publish/pulse.py`
- Create: `schemas/pulse.schema.json`
- Test: `tests/test_pulse.py`

**Interfaces:**
- Consumes: the `gauge.run()` result shape (Task 6) and the existing `official.latest_yoy()` dict (`yoy_pct`, `prev_yoy_pct`, `month`, unrounded).
- Produces: `pulse.build(gauge_result: dict, cpi: dict) -> dict` (payload below, rounded 2dp) and `pulse.write(payload: dict, out_dir: Path, published_at: str) -> Path` writing `out_dir / "pulse.json"` with `published_at` first.

- [ ] **Step 1: Write the failing tests** (`tests/test_pulse.py`)

```python
from pathlib import Path

import pytest

from pipeline.publish import pulse, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"


def variant(yoy, as_of="2026-07-06", cov=40.5):
    return {"index": {as_of: 105.0}, "yoy": {as_of: yoy}, "as_of": as_of,
            "coverage_pct": cov, "gate_flags": [], "components": {}}


GAUGE_RESULT = {"base_month": "2018-01",
                "variants": {"gauge": variant(2.412345),
                             "tracker": variant(2.351111, cov=6.5)}}
CPI = {"series_code": "CPIAUCNS", "month": "2026-05-01",
       "yoy_pct": 2.398765, "prev_yoy_pct": 2.3, "as_of": "2026-07-06"}


def test_build_rounds_and_computes_gap():
    p = pulse.build(GAUGE_RESULT, CPI)
    assert p["gauge"] == {"yoy_pct": 2.41, "as_of": "2026-07-06",
                          "coverage_pct": 40.5}
    assert p["tracker"]["yoy_pct"] == 2.35
    assert p["official"] == {"yoy_pct": 2.4, "prev_yoy_pct": 2.3,
                             "month": "2026-05-01"}
    # gap from UNROUNDED values, then rounded: 2.412345-2.398765 = 0.01358 -> 0.01
    assert p["gap_pp"] == 0.01


def test_write_validates_against_schema(tmp_path):
    payload = pulse.build(GAUGE_RESULT, CPI)
    path = pulse.write(payload, tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "pulse.json"
    validate.validate_file(path, SCHEMAS / "pulse.schema.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulse.py -v`
Expected: collection ERROR — `ImportError: cannot import name 'pulse'`

- [ ] **Step 3: Write `pipeline/publish/pulse.py`**

```python
"""Writer for pulse.json — the homepage KPI feed (gauge + official headline)."""
import json
from pathlib import Path


def build(gauge_result: dict, cpi: dict) -> dict:
    def block(v):
        return {"yoy_pct": round(v["yoy"][v["as_of"]], 2), "as_of": v["as_of"],
                "coverage_pct": round(v["coverage_pct"], 2)}

    g = gauge_result["variants"]["gauge"]
    return {"gauge": block(g),
            "tracker": block(gauge_result["variants"]["tracker"]),
            "official": {"yoy_pct": round(cpi["yoy_pct"], 2),
                         "prev_yoy_pct": round(cpi["prev_yoy_pct"], 2),
                         "month": cpi["month"]},
            "gap_pp": round(g["yoy"][g["as_of"]] - cpi["yoy_pct"], 2)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pulse.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 4: Write `schemas/pulse.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "pulse",
  "type": "object",
  "required": ["published_at", "gauge", "tracker", "official", "gap_pp"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "gauge": {"$ref": "#/$defs/variant"},
    "tracker": {"$ref": "#/$defs/variant"},
    "official": {
      "type": "object",
      "required": ["yoy_pct", "prev_yoy_pct", "month"],
      "additionalProperties": false,
      "properties": {
        "yoy_pct": {"type": "number"},
        "prev_yoy_pct": {"type": "number"},
        "month": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    },
    "gap_pp": {"type": "number"}
  },
  "$defs": {
    "variant": {
      "type": "object",
      "required": ["yoy_pct", "as_of", "coverage_pct"],
      "additionalProperties": false,
      "properties": {
        "yoy_pct": {"type": "number"},
        "as_of": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
        "coverage_pct": {"type": "number", "minimum": 0, "maximum": 100}
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_pulse.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/pulse.py schemas/pulse.schema.json tests/test_pulse.py
git commit -m "feat: pulse.json writer + schema — gauge/tracker/official KPI feed"
```

---

### Task 8: gauge_daily.json writer + schema

**Files:**
- Create: `pipeline/publish/gauge_daily.py`
- Create: `schemas/gauge_daily.schema.json`
- Test: `tests/test_gauge_daily.py`

**Interfaces:**
- Consumes: `gauge.run()` result; `gauge.PUBLISH_START`.
- Produces: `gauge_daily.build(gauge_result: dict) -> dict` — columnar `dates`/`index`/`yoy_pct` per variant from `PUBLISH_START` on, index 2dp, yoy 2dp-or-null; `gauge_daily.write(payload, out_dir, published_at) -> Path`.

- [ ] **Step 1: Write the failing tests** (`tests/test_gauge_daily.py`)

```python
from pathlib import Path

from pipeline.publish import gauge_daily, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"


def variant():
    return {"index": {"2017-12-31": 99.881, "2018-01-01": 100.004,
                      "2018-01-02": 100.126},
            "yoy": {"2017-12-31": None, "2018-01-01": 2.4567,
                    "2018-01-02": None},
            "as_of": "2018-01-02", "coverage_pct": 40.5, "gate_flags": [],
            "components": {}}


RESULT = {"base_month": "2018-01",
          "variants": {"gauge": variant(), "tracker": variant()}}


def test_build_clips_to_publish_start_and_rounds():
    p = gauge_daily.build(RESULT)
    g = p["variants"]["gauge"]
    assert p["rebase"] == "2018-01=100"
    assert g["dates"] == ["2018-01-01", "2018-01-02"]  # 2017 clipped
    assert g["index"] == [100.0, 100.13]
    assert g["yoy_pct"] == [2.46, None]
    assert len(g["dates"]) == len(g["index"]) == len(g["yoy_pct"])


def test_write_validates_against_schema(tmp_path):
    path = gauge_daily.write(gauge_daily.build(RESULT), tmp_path,
                             published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "gauge_daily.json"
    validate.validate_file(path, SCHEMAS / "gauge_daily.schema.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_gauge_daily.py -v`
Expected: collection ERROR — `ImportError: cannot import name 'gauge_daily'`

- [ ] **Step 3: Write `pipeline/publish/gauge_daily.py`**

```python
"""Writer for gauge_daily.json — daily index + YoY per variant (1c hero chart)."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START


def build(gauge_result: dict) -> dict:
    out = {"rebase": f"{gauge_result['base_month']}=100", "variants": {}}
    for name, v in gauge_result["variants"].items():
        dates = [d for d in sorted(v["index"]) if d >= PUBLISH_START]
        out["variants"][name] = {
            "dates": dates,
            "index": [round(v["index"][d], 2) for d in dates],
            "yoy_pct": [None if v["yoy"][d] is None else round(v["yoy"][d], 2)
                        for d in dates]}
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "gauge_daily.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 4: Write `schemas/gauge_daily.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "gauge_daily",
  "type": "object",
  "required": ["published_at", "rebase", "variants"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "rebase": {"type": "string"},
    "variants": {
      "type": "object",
      "required": ["gauge", "tracker"],
      "additionalProperties": false,
      "properties": {
        "gauge": {"$ref": "#/$defs/series"},
        "tracker": {"$ref": "#/$defs/series"}
      }
    }
  },
  "$defs": {
    "series": {
      "type": "object",
      "required": ["dates", "index", "yoy_pct"],
      "additionalProperties": false,
      "properties": {
        "dates": {"type": "array",
                  "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
        "index": {"type": "array", "items": {"type": "number"}},
        "yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}}
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_gauge_daily.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/gauge_daily.py schemas/gauge_daily.schema.json tests/test_gauge_daily.py
git commit -m "feat: gauge_daily.json writer + schema — columnar daily series per variant"
```

---

### Task 9: compare.json writer + schema

**Files:**
- Create: `pipeline/publish/compare.py`
- Create: `schemas/compare.schema.json`
- Test: `tests/test_compare.py`

**Interfaces:**
- Consumes: `gauge.run()` result; store conn (for official CPIAUCNS monthly YoY); `gauge.PUBLISH_START`.
- Produces: `compare.build(gauge_result: dict, conn) -> dict` — months are first-of-month dates ≥ `PUBLISH_START` where official CPI YoY exists; per-variant arrays sample the daily YoY at those dates (null where absent); `validation` per variant: `corr` (Pearson, 4dp, null when <2 pairs or zero variance), `mean_abs_gap_pp` (2dp, null when no pairs), `window` (`"YYYY-MM..YYYY-MM"`). `compare.write(payload, out_dir, published_at) -> Path`.

- [ ] **Step 1: Write the failing tests** (`tests/test_compare.py`)

```python
from pathlib import Path

import pytest

from pipeline.models import Observation
from pipeline.publish import compare, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

# Official CPI: 2018 YoYs computable for Jan/Feb/Mar (bases in 2017)
CPI_ROWS = [("2017-01-01", 100.0), ("2017-02-01", 100.5), ("2017-03-01", 101.0),
            ("2018-01-01", 102.0), ("2018-02-01", 103.0), ("2018-03-01", 104.5)]
# official YoY: Jan +2.0, Feb +2.487..., Mar +3.465...


def seed(tmp_path):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v,
                       vintage_date="2018-04-01", source="FRED", route="API")
           for d, v in CPI_ROWS]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def variant(yoy_by_month):
    dates = sorted(yoy_by_month)
    return {"index": {d: 100.0 for d in dates}, "yoy": dict(yoy_by_month),
            "as_of": dates[-1], "coverage_pct": 40.0, "gate_flags": [],
            "components": {}}


RESULT = {"base_month": "2018-01", "variants": {
    "gauge": variant({"2018-01-01": 2.5, "2018-02-01": 3.0, "2018-03-01": 4.0}),
    "tracker": variant({"2018-01-01": 2.1, "2018-02-01": 2.6, "2018-03-01": 3.4})}}


def test_build_months_arrays_and_validation(tmp_path):
    conn = seed(tmp_path)
    p = compare.build(RESULT, conn)
    assert p["months"] == ["2018-01-01", "2018-02-01", "2018-03-01"]
    assert p["official_yoy_pct"][0] == 2.0
    assert p["gauge_yoy_pct"] == [2.5, 3.0, 4.0]
    assert p["tracker_yoy_pct"] == [2.1, 2.6, 3.4]
    v = p["validation"]["tracker"]
    assert v["window"] == "2018-01..2018-03"
    assert v["corr"] is not None and 0.9 <= v["corr"] <= 1.0
    # official YoY: Feb 103/100.5-1 = 2.4876%, Mar 104.5/101-1 = 3.4653%
    # gaps: |2.1-2.0|, |2.6-2.4876|, |3.4-3.4653| -> mean 0.0926 -> 0.09
    assert v["mean_abs_gap_pp"] == 0.09


def test_missing_month_is_null_and_short_window_corr_null(tmp_path):
    conn = seed(tmp_path)
    result = {"base_month": "2018-01", "variants": {
        "gauge": variant({"2018-01-01": 2.5}),
        "tracker": variant({"2018-01-01": 2.1})}}
    p = compare.build(result, conn)
    assert p["gauge_yoy_pct"] == [2.5, None, None]
    assert p["validation"]["gauge"]["corr"] is None  # one pair — no correlation


def test_write_validates_against_schema(tmp_path):
    conn = seed(tmp_path)
    path = compare.write(compare.build(RESULT, conn), tmp_path,
                         published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "compare.json"
    validate.validate_file(path, SCHEMAS / "compare.schema.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_compare.py -v`
Expected: collection ERROR — `ImportError: cannot import name 'compare'`

- [ ] **Step 3: Write `pipeline/publish/compare.py`**

```python
"""Writer for compare.json — monthly ours-vs-official YoY + validation stats.

The validation block carries the Phase-1 exit criterion (tracker Pearson corr
vs official >= 0.95 on the 2018-now backfill); 1c's methodology page reads it
from here.
"""
import json
import statistics
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.store import vintage


def _official_yoy(conn, code: str = "CPIAUCNS") -> dict[str, float]:
    series = dict(vintage.latest(conn, code))
    out = {}
    for m, v in series.items():
        base = f"{int(m[:4]) - 1:04d}-{m[5:7]}-01"
        if base in series:
            out[m] = (v / series[base] - 1) * 100
    return out


def _validation(official: list[float], ours: list[float | None]) -> dict:
    pairs = [(o, s) for o, s in zip(official, ours) if s is not None]
    corr = mag = None
    if pairs:
        xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
        mag = round(sum(abs(x - y) for x, y in zip(xs, ys)) / len(xs), 2)
        if len(pairs) >= 2:
            try:
                corr = round(statistics.correlation(xs, ys), 4)
            except statistics.StatisticsError:  # zero variance
                corr = None
    return {"corr": corr, "mean_abs_gap_pp": mag}


def build(gauge_result: dict, conn) -> dict:
    off = _official_yoy(conn)
    months = [m for m in sorted(off) if m >= PUBLISH_START]
    official_col = [round(off[m], 2) for m in months]
    payload = {"months": months, "official_yoy_pct": official_col,
               "validation": {}}
    window = f"{months[0][:7]}..{months[-1][:7]}" if months else ""
    for name, v in gauge_result["variants"].items():
        raw = [v["yoy"].get(m) for m in months]
        payload[f"{name}_yoy_pct"] = [None if x is None else round(x, 2)
                                      for x in raw]
        payload["validation"][name] = {
            **_validation([off[m] for m in months], raw), "window": window}
    return payload


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "compare.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 4: Write `schemas/compare.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "compare",
  "type": "object",
  "required": ["published_at", "months", "official_yoy_pct",
               "gauge_yoy_pct", "tracker_yoy_pct", "validation"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "months": {"type": "array",
               "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
    "official_yoy_pct": {"type": "array", "items": {"type": "number"}},
    "gauge_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
    "tracker_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
    "validation": {
      "type": "object",
      "required": ["gauge", "tracker"],
      "additionalProperties": false,
      "properties": {
        "gauge": {"$ref": "#/$defs/stats"},
        "tracker": {"$ref": "#/$defs/stats"}
      }
    }
  },
  "$defs": {
    "stats": {
      "type": "object",
      "required": ["corr", "mean_abs_gap_pp", "window"],
      "additionalProperties": false,
      "properties": {
        "corr": {"type": ["number", "null"], "minimum": -1, "maximum": 1},
        "mean_abs_gap_pp": {"type": ["number", "null"]},
        "window": {"type": "string"}
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_compare.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/compare.py schemas/compare.schema.json tests/test_compare.py
git commit -m "feat: compare.json writer + schema — monthly YoY grid + Pearson validation"
```

---

### Task 10: gaptable.json writer + schema

**Files:**
- Create: `pipeline/publish/gaptable.py`
- Create: `schemas/gaptable.schema.json`
- Test: `tests/test_gaptable.py`

**Interfaces:**
- Consumes: `gauge.run()` result (gauge variant `components` incl. `yoy_pct`/`mode`/`weight`), store conn + `official.component_summary` for BLS YoY, the basket `Component` list, and the official CPI month string.
- Produces: `gaptable.build(gauge_result: dict, conn, comps: list[Component], official_month: str) -> dict` — one row per component (sorted by |contribution| desc), `total_gap_pp` = Σ contribution; `gaptable.write(payload, out_dir, published_at) -> Path`.

- [ ] **Step 1: Write the failing tests** (`tests/test_gaptable.py`)

```python
import json
from pathlib import Path

import pytest

from pipeline import basket
from pipeline.models import Observation
from pipeline.publish import gaptable, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

MINI = {"base_month": "2018-01", "components": [
    {"code": "shelter", "label": "Shelter", "weight": 0.6,
     "official_series": "OFF_SH", "live_blend": {"LIVE_SH": 1.0},
     "live_variants": ["gauge"]},
    {"code": "fuel", "label": "Fuel", "weight": 0.4,
     "official_series": "OFF_FU"}]}

# official series need month & 12m/1m-prior rows for component_summary
OFF_ROWS = [("OFF_SH", "2018-01-01", 100.0), ("OFF_SH", "2018-12-01", 102.8),
            ("OFF_SH", "2019-01-01", 103.0),  # BLS shelter YoY = +3.0
            ("OFF_FU", "2018-01-01", 200.0), ("OFF_FU", "2018-12-01", 207.0),
            ("OFF_FU", "2019-01-01", 208.0)]  # BLS fuel YoY = +4.0


def seed(tmp_path):
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2019-01-02", source="T", route="API")
           for c, d, v in OFF_ROWS]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(MINI))
    _, comps = basket.load_basket(bp)
    return vintage.load(tmp_path), comps


RESULT = {"base_month": "2018-01", "variants": {
    "gauge": {"index": {}, "yoy": {}, "as_of": "2019-01-05",
              "coverage_pct": 60.0, "gate_flags": [],
              "components": {
                  "shelter": {"weight": 0.6, "mode": "live",
                              "yoy_pct": 6.04321, "end_value": 106.0},
                  "fuel": {"weight": 0.4, "mode": "bls_cf",
                           "yoy_pct": 4.0, "end_value": 104.0}}},
    "tracker": {"index": {}, "yoy": {}, "as_of": "2019-01-05",
                "coverage_pct": 0.0, "gate_flags": [], "components": {}}}}


def test_build_rows_and_contributions(tmp_path):
    conn, comps = seed(tmp_path)
    p = gaptable.build(RESULT, conn, comps, official_month="2019-01-01")
    assert p["as_of"] == "2019-01-05"
    assert p["official_month"] == "2019-01-01"
    assert len(p["rows"]) == 2
    shelter = p["rows"][0]  # biggest |contribution| first
    assert shelter["component"] == "shelter"
    assert shelter["mode"] == "live"
    assert shelter["ours_yoy_pct"] == 6.04
    assert shelter["bls_yoy_pct"] == 3.0
    # gap/contribution from UNROUNDED inputs: 6.04321-3.0=3.04321, x0.6=1.82593
    assert shelter["gap_pp"] == 3.04
    assert shelter["contribution_pp"] == 1.83
    fuel = p["rows"][1]
    assert fuel["gap_pp"] == 0.0 and fuel["contribution_pp"] == 0.0
    assert p["total_gap_pp"] == 1.83


def test_write_validates_against_schema(tmp_path):
    conn, comps = seed(tmp_path)
    path = gaptable.write(
        gaptable.build(RESULT, conn, comps, official_month="2019-01-01"),
        tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "gaptable.json"
    validate.validate_file(path, SCHEMAS / "gaptable.schema.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_gaptable.py -v`
Expected: collection ERROR — `ImportError: cannot import name 'gaptable'`

- [ ] **Step 3: Write `pipeline/publish/gaptable.py`**

```python
"""Writer for gaptable.json — per-component gap decomposition (gauge variant).

gap contribution_i = weight_i x (our YoY_i - BLS YoY_i). Ours is as of the
daily-grid end; BLS is at the latest official print month — being ahead of
the print is the point, and both carry their as-of.
"""
import json
from pathlib import Path

from pipeline.engine import official as official_engine


def _round(x, nd=2):
    return None if x is None else round(x, nd)


def build(gauge_result: dict, conn, comps, official_month: str) -> dict:
    g = gauge_result["variants"]["gauge"]
    rows, total = [], 0.0
    for comp in comps:
        entry = g["components"][comp.code]
        ours = entry["yoy_pct"]
        bls = official_engine.component_summary(conn, comp.official_series)["yoy_pct"]
        gap = None if ours is None else ours - bls
        contribution = None if gap is None else comp.weight * gap
        total += contribution or 0.0
        rows.append({"component": comp.code, "label": comp.label,
                     "weight": comp.weight, "mode": entry["mode"],
                     "ours_yoy_pct": _round(ours), "bls_yoy_pct": round(bls, 2),
                     "gap_pp": _round(gap),
                     "contribution_pp": _round(contribution)})
    rows.sort(key=lambda r: abs(r["contribution_pp"] or 0), reverse=True)
    return {"as_of": g["as_of"], "official_month": official_month,
            "rows": rows, "total_gap_pp": round(total, 2)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "gaptable.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 4: Write `schemas/gaptable.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "gaptable",
  "type": "object",
  "required": ["published_at", "as_of", "official_month", "rows", "total_gap_pp"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "as_of": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
    "official_month": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["component", "label", "weight", "mode", "ours_yoy_pct",
                     "bls_yoy_pct", "gap_pp", "contribution_pp"],
        "additionalProperties": false,
        "properties": {
          "component": {"type": "string"},
          "label": {"type": "string"},
          "weight": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
          "mode": {"enum": ["live", "bls_cf"]},
          "ours_yoy_pct": {"type": ["number", "null"]},
          "bls_yoy_pct": {"type": "number"},
          "gap_pp": {"type": ["number", "null"]},
          "contribution_pp": {"type": ["number", "null"]}
        }
      }
    },
    "total_gap_pp": {"type": "number"}
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_gaptable.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/gaptable.py schemas/gaptable.schema.json tests/test_gaptable.py
git commit -m "feat: gaptable.json writer + schema — per-component gap decomposition"
```

---

### Task 11: Backfill exit-criterion test

**Files:**
- Test: `tests/test_backfill.py`

**Interfaces:**
- Consumes: the real committed `store/` (in-repo, no network), `gauge.run()`, `compare.build()`.
- Produces: the Phase-1 exit criterion as a pinned test — the phase cannot be called done while this is red.

**IMPORTANT:** This test runs the full engine over the real store. If the tracker correlation comes back below 0.95, that is a genuine investigation task (weights, splice, YoY alignment — something is wrong), NOT a threshold to loosen. Stop and debug; do not edit the assertion.

- [ ] **Step 1: Write the test** (`tests/test_backfill.py`)

```python
"""Phase-1 exit criterion: the tracker re-tracks official CPI on the
committed 2018-now store (design doc §10: corr >= 0.95)."""
from pathlib import Path

from pipeline.engine import gauge
from pipeline.publish import compare
from pipeline.store import vintage

ROOT = Path(__file__).parent.parent


def test_tracker_corr_vs_official_2018_now():
    conn = vintage.load(ROOT / "store")
    # far-future 'today': no obs can be just-arrived, staleness irrelevant here
    result = gauge.run(conn, today="2099-01-01")
    v = compare.build(result, conn)["validation"]["tracker"]
    assert v["corr"] is not None, "no overlapping months — engine misaligned"
    assert v["corr"] >= 0.95, f"tracker corr {v['corr']} < 0.95 ({v['window']})"


def test_gauge_backfill_sane():
    conn = vintage.load(ROOT / "store")
    result = gauge.run(conn, today="2099-01-01")
    g = result["variants"]["gauge"]
    yoy = g["yoy"][g["as_of"]]
    assert yoy is not None and -5.0 < yoy < 15.0, yoy
    assert min(g["index"]) <= "2018-01-01"  # grid reaches the base year
```

- [ ] **Step 2: Run the test — this is the moment of truth**

Run: `pytest tests/test_backfill.py -v`
Expected: 2 passed. Print the achieved correlation for the record:

```bash
python3 - <<'EOF'
from pathlib import Path
from pipeline.engine import gauge
from pipeline.publish import compare
from pipeline.store import vintage
conn = vintage.load(Path("store"))
r = gauge.run(conn, today="2099-01-01")
p = compare.build(r, conn)
print("validation:", p["validation"])
EOF
```
Expected: tracker corr ≥ 0.95 over a window ending 2026-05. Record the numbers in the task report.

If RED: debug per the IMPORTANT note above (check component YoY vs official component YoY one by one via `compare.build`'s arrays) before touching anything else.

- [ ] **Step 3: Commit**

```bash
git add tests/test_backfill.py
git commit -m "test: pin Phase-1 exit criterion — tracker corr >= 0.95 on committed store"
```

---

### Task 12: QA growth — five gauge checks

**Files:**
- Modify: `pipeline/publish/qa.py`
- Test: `tests/test_qa.py` (append)

**Interfaces:**
- Consumes: existing `qa.run_checks(cpi, today, source_results, freshness)` signature and check-dict shape (`name`/`critical`/`pass`/`detail`); `schemas/qa.schema.json` already fits any check list (no schema change).
- Produces: `qa.run_checks(..., gauge: dict | None = None)` — when `gauge` is provided, appends 5 checks: `gauge_current` (critical, as_of ≤ 7d old), `gauge_components_present` (critical; gate flags ride in the detail), `basket_weights_sum` (critical, |Σ−1| ≤ 1e-9), `gauge_coverage` (non-critical, ≥ 35), `tracker_corr` (non-critical, ≥ 0.95). The `gauge` dict keys: `as_of: str`, `coverage_pct: float`, `null_components: list[str]`, `gate_flags: list[str]`, `weights_sum: float`, `tracker_corr: float | None`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_qa.py`)

```python
GAUGE_OK = {"as_of": "2026-07-06", "coverage_pct": 40.5,
            "null_components": [], "gate_flags": [], "weights_sum": 1.0,
            "tracker_corr": 0.98}


def test_gauge_checks_all_pass():
    r = qa.run_checks(CPI, today="2026-07-08", gauge=GAUGE_OK)
    names = [c["name"] for c in r["checks"]]
    for n in ("gauge_current", "gauge_components_present",
              "basket_weights_sum", "gauge_coverage", "tracker_corr"):
        assert n in names
    gauge_checks = [c for c in r["checks"] if c["name"].startswith(("gauge", "basket", "tracker"))]
    assert all(c["pass"] for c in gauge_checks)


def test_gauge_stale_as_of_fails_critical():
    r = qa.run_checks(CPI, today="2026-07-20", gauge=GAUGE_OK)  # 14d old
    check = [c for c in r["checks"] if c["name"] == "gauge_current"][0]
    assert check["pass"] is False and check["critical"] is True


def test_gauge_gate_flags_surface_in_detail_without_failing():
    g = dict(GAUGE_OK, gate_flags=["fuel@2026-07-06"])
    r = qa.run_checks(CPI, today="2026-07-08", gauge=g)
    check = [c for c in r["checks"] if c["name"] == "gauge_components_present"][0]
    assert check["pass"] is True
    assert "fuel@2026-07-06" in check["detail"]


def test_gauge_low_coverage_and_null_corr_fail_noncritical():
    g = dict(GAUGE_OK, coverage_pct=20.0, tracker_corr=None)
    r = qa.run_checks(CPI, today="2026-07-08", gauge=g)
    cov = [c for c in r["checks"] if c["name"] == "gauge_coverage"][0]
    corr = [c for c in r["checks"] if c["name"] == "tracker_corr"][0]
    assert cov["pass"] is False and cov["critical"] is False
    assert corr["pass"] is False and corr["critical"] is False


def test_no_gauge_arg_keeps_existing_checks_only():
    r = qa.run_checks(CPI, today="2026-07-08")
    assert not any(c["name"].startswith(("gauge", "basket", "tracker"))
                   for c in r["checks"])
```

Note: reuse the existing `CPI` constant already defined at the top of `tests/test_qa.py`; if the existing tests name it differently, match that name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_qa.py -v`
Expected: new tests FAIL with `TypeError: run_checks() got an unexpected keyword argument 'gauge'`; existing tests still pass.

- [ ] **Step 3: Extend `pipeline/publish/qa.py`**

Add to the signature: `gauge: dict | None = None`. Append inside `run_checks`, after the `freshness` block, before the return:

```python
    if gauge is not None:
        gauge_age = (date.fromisoformat(today)
                     - date.fromisoformat(gauge["as_of"])).days
        checks.append({"name": "gauge_current", "critical": True,
                       "pass": gauge_age <= 7,
                       "detail": f"gauge as-of {gauge['as_of']} is "
                                 f"{gauge_age}d old (limit 7)"})
        missing, gated = gauge["null_components"], gauge["gate_flags"]
        checks.append({"name": "gauge_components_present", "critical": True,
                       "pass": not missing,
                       "detail": ("all components present at grid end"
                                  if not missing
                                  else f"missing — {', '.join(missing)}")
                                 + (f"; gated today — {', '.join(gated)}"
                                    if gated else "")})
        checks.append({"name": "basket_weights_sum", "critical": True,
                       "pass": abs(gauge["weights_sum"] - 1.0) <= 1e-9,
                       "detail": f"sum(weights) = {gauge['weights_sum']}"})
        checks.append({"name": "gauge_coverage", "critical": False,
                       "pass": gauge["coverage_pct"] >= 35.0,
                       "detail": f"gauge live coverage "
                                 f"{gauge['coverage_pct']}% (floor 35%)"})
        corr = gauge["tracker_corr"]
        checks.append({"name": "tracker_corr", "critical": False,
                       "pass": corr is not None and corr >= 0.95,
                       "detail": f"tracker monthly-YoY corr vs official = "
                                 f"{corr} (floor 0.95)"})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_qa.py -v`
Expected: all passed (old + 5 new)

- [ ] **Step 5: Commit**

```bash
git add pipeline/publish/qa.py tests/test_qa.py
git commit -m "feat: qa gauge checks — currency, components, weights, coverage, corr"
```

---

### Task 13: run_daily rewire + pulse_lite retirement + publish

**Files:**
- Modify: `pipeline/run_daily.py`
- Modify: `tests/test_run_daily.py`
- Modify: `tests/test_published_data.py`
- Delete: `pipeline/publish/pulse_lite.py`, `schemas/pulse_lite.schema.json`, `tests/test_pulse_lite.py`, `site/public/data/pulse_lite.json`
- Modify: `README.md` (published-files list, if it enumerates them)
- Create (by running the pipeline): `site/public/data/{pulse,gauge_daily,compare,gaptable}.json`

**Interfaces:**
- Consumes: everything from Tasks 1–12.
- Produces: `run_daily` publishing seven files (official, pulse, gauge_daily, compare, gaptable, sources_status, qa), each schema-validated before publish. `pulse_lite` gone.

- [ ] **Step 1: Update the tests first** (`tests/test_run_daily.py` and `tests/test_published_data.py`)

In `tests/test_run_daily.py::test_end_to_end_all_sources`, replace the `pulse_lite` assertions and qa total:

```python
    pulse = json.loads((out / "pulse.json").read_text())
    assert pulse["official"]["month"] == "2026-04-01"
    assert isinstance(pulse["gauge"]["yoy_pct"], float)
    assert isinstance(pulse["gap_pp"], float)
    for name in ("gauge_daily.json", "compare.json", "gaptable.json"):
        assert (out / name).exists(), name
    status = json.loads((out / "sources_status.json").read_text())
    assert len(status["sources"]) == 7
    assert all(s["ok"] for s in status["sources"])
    qa = json.loads((out / "qa.json").read_text())
    assert qa["total"] == 9  # 4 existing + 5 gauge checks
    official = json.loads((out / "official.json").read_text())
    assert len(official["components"]) == 14
    assert len(official["quotes"]) == 13
```

(Do not assert `qa["passed"]` — with short fixture history, `tracker_corr` legitimately fails in this test.)

In `tests/test_published_data.py`, replace the CONTRACT list and add the cross-file sanity test:

```python
CONTRACT = [("pulse.json", "pulse.schema.json"),
            ("gauge_daily.json", "gauge_daily.schema.json"),
            ("compare.json", "compare.schema.json"),
            ("gaptable.json", "gaptable.schema.json"),
            ("qa.json", "qa.schema.json"),
            ("sources_status.json", "sources_status.schema.json"),
            ("official.json", "official.schema.json")]


def test_pulse_gap_consistent():
    import json
    path = DATA / "pulse.json"
    if not path.exists():
        pytest.skip("pulse.json not published yet")
    pulse = json.loads(path.read_text())
    expected = pulse["gauge"]["yoy_pct"] - pulse["official"]["yoy_pct"]
    assert abs(pulse["gap_pp"] - expected) <= 0.011  # rounding tolerance
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_run_daily.py tests/test_published_data.py -v`
Expected: `test_end_to_end_all_sources` FAILS (`pulse.json` not written); published-data tests skip the four new files (not yet published).

- [ ] **Step 3: Rewire `pipeline/run_daily.py`**

Replace the imports and the publish block (`cpi = ...` through the qa print) with:

```python
import argparse
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pipeline import basket as basket_mod
from pipeline import collect, registry
from pipeline.connectors import fred
from pipeline.engine import gauge as gauge_engine
from pipeline.engine import official
from pipeline.publish import official as official_json
from pipeline.publish import (compare, gaptable, gauge_daily, pulse, qa,
                              sources_status, validate)
from pipeline.store import vintage
```

and, after the existing `conn = vintage.load(args.store)` line:

```python
    cpi = official.latest_yoy(conn, "CPIAUCNS")
    today = fred.today_et()
    staleness = {s.code: s.max_staleness_days for s in series}
    gauge_result = gauge_engine.run(conn, today=today, staleness=staleness)

    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pulse_path = pulse.write(pulse.build(gauge_result, cpi), args.out,
                             published_at=published_at)
    validate.validate_file(pulse_path, SCHEMAS / "pulse.schema.json")
    g = gauge_result["variants"]["gauge"]
    print(f"published: {pulse_path} (gauge YoY "
          f"{round(g['yoy'][g['as_of']], 2)}%, official "
          f"{round(cpi['yoy_pct'], 2)}%, coverage {round(g['coverage_pct'])}%)")

    gd_path = gauge_daily.write(gauge_daily.build(gauge_result), args.out,
                                published_at=published_at)
    validate.validate_file(gd_path, SCHEMAS / "gauge_daily.schema.json")
    print(f"published: {gd_path}")

    compare_payload = compare.build(gauge_result, conn)
    cmp_path = compare.write(compare_payload, args.out,
                             published_at=published_at)
    validate.validate_file(cmp_path, SCHEMAS / "compare.schema.json")
    print(f"published: {cmp_path} "
          f"(tracker corr {compare_payload['validation']['tracker']['corr']})")

    _, comps = basket_mod.load_basket()
    gt_path = gaptable.write(
        gaptable.build(gauge_result, conn, comps, official_month=cpi["month"]),
        args.out, published_at=published_at)
    validate.validate_file(gt_path, SCHEMAS / "gaptable.schema.json")
    print(f"published: {gt_path}")

    official_path = official_json.write(official_json.build(conn, series),
                                        args.out, published_at=published_at)
    validate.validate_file(official_path, SCHEMAS / "official.schema.json")
    print(f"published: {official_path}")

    status = sources_status.build(results, sources, series, conn)
    status_path = sources_status.write(status, args.out)
    validate.validate_file(status_path, SCHEMAS / "sources_status.schema.json")
    print(f"published: {status_path}")

    freshness = [{"code": s.code, "latest_obs": vintage.max_obs_date(conn, s.code),
                  "limit_days": s.max_staleness_days} for s in series]
    gauge_qa = {"as_of": g["as_of"], "coverage_pct": g["coverage_pct"],
                "null_components": [
                    c for c, e in g["components"].items()
                    if e["end_value"] is None
                    or not math.isfinite(e["end_value"])],
                "gate_flags": g["gate_flags"],
                "weights_sum": sum(e["weight"]
                                   for e in g["components"].values()),
                "tracker_corr":
                    compare_payload["validation"]["tracker"]["corr"]}
    qa_path = qa.write(qa.run_checks(cpi, today=today, source_results=results,
                                     freshness=freshness, gauge=gauge_qa),
                       args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0
```

- [ ] **Step 4: Retire pulse_lite**

```bash
git rm pipeline/publish/pulse_lite.py schemas/pulse_lite.schema.json \
       tests/test_pulse_lite.py site/public/data/pulse_lite.json
```

- [ ] **Step 5: Run the full suite**

Run: `pytest -q`
Expected: all passing (run_daily end-to-end now writes all seven files from fixtures; published-data tests still skip the not-yet-committed new artifacts).

- [ ] **Step 6: Publish for real (local run with real keys)**

```bash
cd ~/Development/macrogauge && source .venv/bin/activate \
  && set -a && source .env && set +a \
  && python -m pipeline.run_daily --store store --out site/public/data
```
Expected: seven `published:`/`qa:` lines, no validation errors; the pulse line shows a plausible gauge YoY and ~40% coverage; the compare line shows tracker corr ≥ 0.95.

- [ ] **Step 7: Re-run the suite against the real artifacts**

Run: `pytest -q`
Expected: all passing — `test_published_data` now validates all seven committed files, `test_pulse_gap_consistent` runs, `test_backfill` still green.

- [ ] **Step 8: Update README published-files list** (only if `README.md` enumerates published JSONs — check first; add pulse/gauge_daily/compare/gaptable, drop pulse_lite).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: publish gauge JSONs — pulse/gauge_daily/compare/gaptable live; retire pulse_lite"
```

---

### Task 14: Homepage KPI swap

**Files:**
- Modify: `site/src/components/KpiCard.tsx` (optional `chip` prop)
- Modify: `site/src/app/page.tsx`

**Interfaces:**
- Consumes: `site/public/data/pulse.json` (Task 13 artifact), existing `KpiCard`/`DeltaChip`/`StatusPill`, `fmtPct` from `@/lib/format`.
- Produces: gauge KPI card first in the hero row (sky accent = ours), gap DeltaChip, coverage subtitle; updated header/footer copy. No new components.

- [ ] **Step 1: Extend `KpiCard` with an optional chip slot**

```tsx
import type { ReactNode } from "react";

const ACCENTS = {
  sky: "var(--accent-sky)",
  amber: "var(--accent-amber)",
  red: "var(--accent-red)",
  emerald: "var(--accent-emerald)",
  violet: "var(--accent-violet)",
} as const;

export type Accent = keyof typeof ACCENTS;

export function KpiCard({
  label,
  value,
  context,
  accent = "sky",
  chip,
}: {
  label: string;
  value: string;
  context: string;
  accent?: Accent;
  chip?: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        minWidth: 220,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: ACCENTS[accent],
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
        {chip ? <span style={{ marginRight: 8 }}>{chip}</span> : null}
        {context}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `site/src/app/page.tsx`**

Add the import at the top with the other data imports:

```tsx
import pulse from "../../public/data/pulse.json";
```

In the header, change the subtitle line and add a gauge StatusPill before the CPI one:

```tsx
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            published {pulse.published_at} · independent gauge + official data
          </div>
```

```tsx
          <StatusPill ok={true} label={`Gauge ${fmtPct(pulse.gauge.yoy_pct)}`} />
          <StatusPill ok={true} label={`CPI ${fmtPct(cpi.yoy_pct)}`} />
```

Insert the gauge KpiCard as the FIRST card in the hero row (before "Official CPI · YoY"):

```tsx
        <KpiCard
          label="Macrogauge · YoY"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`${pulse.gauge.coverage_pct.toFixed(0)}% live weight · as of ${pulse.gauge.as_of}`}
          accent="sky"
          chip={<DeltaChip value={pulse.gap_pp} prefix="vs official" />}
        />
```

Replace the footer sentence "The independent macrogauge index arrives in phase 1b." with:

```tsx
          All figures from official/public sources (BLS, FRED, EIA, Zillow, Freddie
          Mac, U.S. Treasury, FMP) — collected daily, published with as-of dates. The
          independent macrogauge index re-prices the CPI basket daily from live
          market and public data ({pulse.gauge.coverage_pct.toFixed(0)}% of basket
          weight today; the rest carries official BLS values forward between
          prints).
```

- [ ] **Step 3: Build + verify**

```bash
cd ~/Development/macrogauge/site && npm run build \
  && grep -c "Macrogauge" out/index.html \
  && grep -c "vs official" out/index.html
```
Expected: build succeeds; both greps ≥ 1.

- [ ] **Step 4: Serve for the controller's visual check**

```bash
python3 -m http.server 3402 -d out &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3402/
kill %1
```
Expected: 200. (The controller takes the screenshot after this task: sky gauge card first, amber official second, gap chip readable, coverage honest.)

- [ ] **Step 5: Commit**

```bash
cd ~/Development/macrogauge
git add site/src/components/KpiCard.tsx site/src/app/page.tsx
git commit -m "feat: gauge KPI on homepage hero — sky accent, gap chip, honest coverage"
```

---

### Task 15: Ship + verify production

**Files:** none (push + deploy verification)

- [ ] **Step 1:** `git push` → CI green (`gh run list --workflow ci --limit 1` until completed/success) → Vercel deploy for HEAD reaches success (GitHub deployments API).
- [ ] **Step 2:** Controller eyeballs production against the design tokens + this plan's layout (gauge card, gap chip, coverage, footer copy).
- [ ] **Step 3:** Confirm the next scheduled daily run publishes all seven files unattended (check the workflow run + committed artifacts the following morning — no workflow file changes were needed).

## Self-review notes (completed)

- **Spec coverage:** stages 1–5 → Tasks 2–6; basket config → Task 1; four writers + schemas → Tasks 7–10; exit criterion → Task 11 (+ QA check Task 12); pulse_lite retirement + wiring → Task 13; KPI swap → Task 14; exit criteria 1/3/4 verified in Tasks 13–15.
- **Type consistency:** `gauge.run()` result shape in Task 6 Interfaces matches every writer's consumption (`yoy[as_of]`, `coverage_pct`, `components[code].{weight,mode,yoy_pct,end_value}`, `gate_flags`, `base_month`); `Component` fields in Task 1 match Tasks 6 and 10 usage; `pulse.build` uses `official.latest_yoy` dict keys exactly as produced by the existing engine.
- **Fixture-store safety:** the end-to-end run_daily test works because rebase falls back to first-month anchors (deviation 1), `compare` returns null corr on short windows (schema nullable), and no test asserts `qa["passed"]`.
- **Leap-year note:** 365d YoY lands exactly on the prior-year date for non-leap spans; hand-computed tests use 2018/2019 and 2025/2026 (both non-leap spans).
