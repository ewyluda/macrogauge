# Phase 1c — Homepage Viz + Methodology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the headline-YoY between-print sawtooth (own-end aggregation), then build the nowflation-faithful homepage viz layer (hero chart, treemap replay, gap table, PageShell) and `/methodology`, backed by two new pipeline writers (`replay.json`, `methodology.json`) and small extensions to `compare.json`/`pulse.json`.

**Architecture:** Pipeline-first: engine correction → contract extensions → new writers → republish committed data → site components over pre-baked JSON. The site computes nothing except the sanctioned treemap display transforms (spec §6.3 bounded exception). Every published file has a JSON Schema validated in `run_daily` before deploy.

**Tech Stack:** Python 3.12 + pytest (pipeline); Next.js 15 App Router `output: 'export'` + React 19 + TypeScript + ECharts (site).

**Spec:** `docs/superpowers/specs/2026-07-08-phase-1c-homepage-viz-design.md`

## Global Constraints

- **The contract is the interface**: analytics computed in the pipeline; the site only formats. One exception, verbatim from spec §6.3: the treemap client derives its five mode colorings (YoY / MoM-ann / vs-BLS / 1-day Δ / WoW Δ) from the published `index[]`/`bls_index[]` arrays.
- **Rounding owner**: pipeline publishes final rounded numbers — pct and pp at 2dp, index levels at 2dp; YoY always computed from unrounded indexes, then rounded. Site displays 1dp for percentages (`fmtPct`), 2dp for pp chips.
- **`jsonschema.ValidationError` re-raises and fails the run** — schema-invalid artifacts never deploy. Never reorder the try/except in `run_daily.py`.
- **`sources_status` publishes FIRST**. New writers go inside the strict engine block, after their inputs exist.
- **Design tokens** (hex, mirror `site/src/app/globals.css`): bg `#0B0F14`, card `#11161C`, border `#1E2630`, text `#E6EDF3`, muted `#8B98A5`, sky `#38BDF8`, amber `#F59E0B`, red `#F87171`, emerald `#34D399`, violet `#A78BFA`. Semantic: sky = ours, amber/gray-dash = official, red = hot, emerald = cool/ok, violet = alt series.
- **HTTP is injected, never real** in tests. Engine stages stay pure dict→dict.
- **Store rows are immutable**; never rewrite a committed partition.
- Python: `pytest -q` from repo root. Site: `cd site && npm run build` must pass.
- Commit messages follow the repo's `type: summary` style (`feat:`/`fix:`/`test:`/`data:`/`docs:`).
- **Numbers cited in this plan** (gauge 2.30→~3.38, gap −1.94→−0.87, weighted BLS 4.316) were computed 2026-07-08 from the committed store; they move with every daily publish. Tests must assert *relations* (ranges, invariants), not these exact values — except where a step explicitly says to record fresh evidence.

---

### Task 1: `aggregate.fill_yoy` + `aggregate.weighted_yoy`

Two pure functions: forward-fill a YoY series computed at a component's own obs dates (None = missing base, carried as None), and the weighted per-component headline YoY.

**Files:**
- Modify: `pipeline/engine/aggregate.py` (40 lines; append two functions)
- Test: `tests/test_aggregate.py` (append)

**Interfaces:**
- Consumes: nothing new (stdlib `date`/`timedelta` already imported).
- Produces: `fill_yoy(yoy_at_obs: dict[str, float | None], start: str, end: str) -> dict[str, float | None]` and `weighted_yoy(component_yoys: dict[str, dict[str, float | None]], weights: dict[str, float]) -> dict[str, float | None]`. Task 2 calls both from `gauge.run`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_aggregate.py`:

```python
def test_fill_yoy_forward_fills_and_preserves_none():
    y = {"2026-01-01": 2.0, "2026-01-04": None, "2026-01-06": 3.0}
    f = aggregate.fill_yoy(y, "2026-01-01", "2026-01-07")
    assert f == {"2026-01-01": 2.0, "2026-01-02": 2.0, "2026-01-03": 2.0,
                 "2026-01-04": None, "2026-01-05": None,
                 "2026-01-06": 3.0, "2026-01-07": 3.0}


def test_fill_yoy_no_backfill_before_first_obs():
    f = aggregate.fill_yoy({"2026-01-03": 1.0}, "2026-01-01", "2026-01-04")
    assert sorted(f) == ["2026-01-03", "2026-01-04"]


def test_weighted_yoy_intersection_and_renormalization():
    ys = {"a": {"2026-01-01": 2.0, "2026-01-02": 4.0},
          "b": {"2026-01-02": 1.0}}
    out = aggregate.weighted_yoy(ys, {"a": 0.6, "b": 0.2})
    # only 2026-01-02 shared; weights renormalize to .75/.25
    assert out == {"2026-01-02": pytest.approx(4.0 * 0.75 + 1.0 * 0.25)}


def test_weighted_yoy_none_component_makes_date_none():
    ys = {"a": {"2026-01-01": 2.0}, "b": {"2026-01-01": None}}
    assert aggregate.weighted_yoy(ys, {"a": 0.5, "b": 0.5}) == {"2026-01-01": None}


def test_weighted_yoy_empty_returns_empty():
    assert aggregate.weighted_yoy({}, {}) == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_aggregate.py -q`
Expected: 5 FAIL with `AttributeError: module 'pipeline.engine.aggregate' has no attribute 'fill_yoy'` (and `weighted_yoy`); 6 existing tests PASS.

- [ ] **Step 3: Implement** — append to `pipeline/engine/aggregate.py`:

```python
def fill_yoy(yoy_at_obs: dict[str, float | None], start: str, end: str
             ) -> dict[str, float | None]:
    """Forward-fill a YoY series computed at a component's own obs dates.

    Unlike fill_daily, None is a real value here (missing YoY base) and is
    carried forward as None — a missing base must not resurrect the prior
    observation's YoY."""
    obs = sorted(yoy_at_obs)
    out: dict[str, float | None] = {}
    d = date.fromisoformat(max(start, obs[0]))
    stop = date.fromisoformat(end)
    idx, cur, seen = 0, None, False
    while d <= stop:
        ds = d.isoformat()
        while idx < len(obs) and obs[idx] <= ds:
            cur, seen = yoy_at_obs[obs[idx]], True
            idx += 1
        if seen:
            out[ds] = cur
        d += timedelta(days=1)
    return out


def weighted_yoy(component_yoys: dict[str, dict[str, float | None]],
                 weights: dict[str, float]) -> dict[str, float | None]:
    """Headline YoY = sum(w_i * yoy_i) on dates every component covers;
    weights renormalize like headline(). None where any component is None."""
    if not component_yoys:
        return {}
    dates = set.intersection(*(set(c) for c in component_yoys.values()))
    total = sum(weights.values())
    out: dict[str, float | None] = {}
    for d in sorted(dates):
        vals = [(weights[k], c[d]) for k, c in component_yoys.items()]
        out[d] = (sum(w * v for w, v in vals) / total
                  if all(v is not None for _, v in vals) else None)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_aggregate.py -q`
Expected: all 11 PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/aggregate.py tests/test_aggregate.py
git commit -m "feat: aggregate.fill_yoy + weighted_yoy — like-month headline building blocks"
```

---

### Task 2: Headline YoY = own-end aggregation (`gauge.py`)

The Option-A fix (spec §3). Replace `out[variant]["yoy"] = aggregate.yoy(index)` with the weighted like-month component YoYs. The Laspeyres `index` and per-component `end_value` are untouched.

**Files:**
- Modify: `pipeline/engine/gauge.py:59-81` (the post-loop block in `run()`)
- Test: `tests/test_gauge.py` (append red test), `tests/test_backfill.py` (verify, no edit expected)

**Interfaces:**
- Consumes: `aggregate.fill_yoy`, `aggregate.weighted_yoy` (Task 1).
- Produces: `gauge.run(...)` result unchanged in shape — `out[variant]["yoy"]` is still `dict[str, float | None]` over daily grid dates, now computed per-component like-month. Components' `yoy_pct` semantics unchanged (own last obs). All 1b writers keep working unmodified.

- [ ] **Step 1: Write the failing test** — append to `tests/test_gauge.py`:

```python
def test_headline_yoy_no_between_print_decay(tmp_path):
    # The between-print sawtooth (spec 1c §3): sticky's last print is
    # 2018-05; the live component extends the grid to 2018-06-20. The base
    # year has a June jump (100 -> 110), so a grid-end LEVEL ratio compares
    # May-2018 against June-2017 (-2.27% headline). The headline must
    # instead carry sticky's own May-vs-May YoY (+5%) forward: +2.5%.
    mini = {"base_month": "2018-01", "components": [
        {"code": "sticky", "label": "Sticky", "weight": 0.5,
         "official_series": "OFF_ST"},
        {"code": "live", "label": "Live", "weight": 0.5,
         "official_series": "OFF_LV", "live_blend": {"LIVE_LV": 1.0},
         "live_variants": ["gauge"]}]}
    rows = [
        ("OFF_ST", "2017-01-01", 100.0), ("OFF_ST", "2017-05-01", 100.0),
        ("OFF_ST", "2017-06-01", 110.0), ("OFF_ST", "2018-01-01", 110.0),
        ("OFF_ST", "2018-05-01", 105.0),
        ("OFF_LV", "2017-01-01", 100.0), ("OFF_LV", "2018-01-01", 100.0),
        ("LIVE_LV", "2017-01-01", 50.0), ("LIVE_LV", "2018-01-01", 50.0),
        ("LIVE_LV", "2018-06-20", 50.0)]
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2018-06-21", source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    bp = tmp_path / "basket.json"
    bp.write_text(json.dumps(mini))
    conn = vintage.load(tmp_path)
    r = gauge.run(conn, today="2018-06-22", basket_path=bp,
                  staleness={"LIVE_LV": 75})
    g = r["variants"]["gauge"]
    assert g["as_of"] == "2018-06-20"
    # sticky: rebased on 2018-01 anchor 110 -> 2017-05 = 90.909,
    # 2018-05 = 95.4545 -> own YoY +5.0%, carried to grid end.
    # live: flat -> 0%. headline = .5*5 + .5*0 = 2.5
    assert g["yoy"]["2018-06-20"] == pytest.approx(2.5)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gauge.py::test_headline_yoy_no_between_print_decay -q`
Expected: FAIL — computed value ≈ **−2.27**, not 2.5 (the sawtooth, reproduced).

- [ ] **Step 3: Implement** — in `pipeline/engine/gauge.py`, replace the whole block after the component-build loop (currently lines 59–80: from `end = max(...)` through the `out[variant] = {...}` assignment) with:

```python
        end = max(max(c) for c in built.values())
        daily = {k: aggregate.fill_daily(c, GRID_START, end)
                 for k, c in built.items()}
        index = aggregate.headline(daily, weights)
        # Headline YoY (Option A, 1c spec §3): each component's YoY is honest
        # only at its OWN observation dates (like-month vs like-month); the
        # last computed YoY carries forward between obs. Aggregating filled
        # LEVELS at the grid end compared a stale print against a
        # different-month base a year ago — the between-print sawtooth.
        own_yoy = {}
        for code, series_by_date in built.items():
            filled_yoy = aggregate.yoy(daily[code])
            at_obs = {d: filled_yoy[d] for d in series_by_date
                      if d in filled_yoy}
            own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
        coverage = sum(c.weight for c in comps
                       if modes[c.code] == "live"
                       and _fresh(conn, c.live_blend, staleness, today))
        components = {}
        for c in comps:
            own_end = max(built[c.code])  # this component's own last-observation
            # date, not the grid end -- lagging components (e.g. EIA natgas,
            # CPI) must compare like-month-to-like-month on their own filled
            # daily series, never a forward-filled value against a
            # different-month base a year ago.
            components[c.code] = {
                "weight": c.weight, "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "end_value": daily[c.code][end]}  # end_value stays at grid end; QA uses it
        out[variant] = {
            "index": index, "yoy": aggregate.weighted_yoy(own_yoy, weights),
            "as_of": end, "coverage_pct": coverage * 100, "gate_flags": flags,
            "components": components}
```

Notes: `yoy_pct` now reads `own_yoy[c.code].get(own_end)` — identical value to the old `aggregate.yoy(daily[c.code]).get(own_end)` (own_end is an obs date), just not recomputed. `out[variant]["yoy"]` is the only changed output.

- [ ] **Step 4: Run the full suite**

Run: `pytest -q 2>&1 | tee /tmp/task2-suite.log`
Expected: **all PASS** (113 existing + 5 from Task 1 + 1 new = 119). The 1b mini-fixtures anchor every component at exactly 100 in the base month, so ratio-of-sums == weighted-mean there; only the new decay test discriminates. If `test_backfill.py::test_tracker_corr_vs_official_2018_now` fails, STOP — the fix moved tracker corr below 0.95 on the real store; report the number, do not weaken the pin.

- [ ] **Step 5: Record fresh evidence on the committed store** (tee verbatim into the task log):

```bash
python - <<'EOF' 2>&1 | tee /tmp/task2-evidence.log
from pipeline.engine import gauge
from pipeline.publish import compare
from pipeline.store import vintage
conn = vintage.load("store")
r = gauge.run(conn, today="2099-01-01")
g = r["variants"]["gauge"]
p = compare.build(r, conn)
print("gauge yoy @", g["as_of"], "=", round(g["yoy"][g["as_of"]], 3))
print("tracker corr:", p["validation"]["tracker"]["corr"],
      "gauge corr:", p["validation"]["gauge"]["corr"])
EOF
```

Expected: gauge yoy ≈ 3.3–3.5 (was 2.30); tracker corr ≥ 0.95 (was 0.9805, expected to improve or hold).

- [ ] **Step 6: Commit**

```bash
git add pipeline/engine/gauge.py tests/test_gauge.py
git commit -m "fix: headline YoY via own-end weighted aggregation — kills between-print sawtooth"
```

---

### Task 3: `compare.json` — official core series + lead-lag stat

**Files:**
- Modify: `pipeline/publish/compare.py`, `schemas/compare.schema.json`
- Test: `tests/test_compare.py`

**Interfaces:**
- Consumes: store series `CPILFENS` (already collected); `statistics.correlation` (already imported).
- Produces: payload keys `official_core_yoy_pct: list[float | None]` and `validation.gauge.lead_lag: {best_shift_months: int, corr: float} | None`. Task 11 (HeroChart) consumes both.

- [ ] **Step 1: Write the failing tests** — in `tests/test_compare.py`, add core rows to the seed and two tests. Replace the `seed` function and append tests:

```python
CORE_ROWS = [("2017-01-01", 200.0), ("2017-02-01", 201.0), ("2017-03-01", 202.0),
             ("2018-01-01", 205.0), ("2018-02-01", 206.0), ("2018-03-01", 208.0)]
# core YoY: Jan +2.5, Feb +2.4876, Mar +2.9703


def seed(tmp_path):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v,
                       vintage_date="2018-04-01", source="FRED", route="API")
           for d, v in CPI_ROWS]
    obs += [Observation(series_code="CPILFENS", obs_date=d, value=v,
                        vintage_date="2018-04-01", source="FRED", route="API")
            for d, v in CORE_ROWS]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)
```

```python
def test_official_core_yoy_column(tmp_path):
    conn = seed(tmp_path)
    p = compare.build(RESULT, conn)
    assert p["official_core_yoy_pct"] == [2.5, 2.49, 2.97]


def test_lead_lag_reports_best_forward_shift(tmp_path):
    conn = seed(tmp_path)
    p = compare.build(RESULT, conn)
    ll = p["validation"]["gauge"]["lead_lag"]
    # gauge [2.5, 3.0, 4.0] vs official shifted +1 = [2.49, 3.47] on 2 pairs
    # -> corr exactly 1.0 (any increasing 2-point pair); k=0 corr < 1.
    assert ll == {"best_shift_months": 1, "corr": 1.0}
    assert "lead_lag" not in p["validation"]["tracker"]
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest tests/test_compare.py -q`
Expected: 2 new FAIL (KeyError `official_core_yoy_pct` / `lead_lag`); 3 existing PASS.

- [ ] **Step 3: Implement** — in `pipeline/publish/compare.py`:

Add after `_validation`:

```python
def _lead_lag(official: list[float], ours: list[float | None],
              max_shift: int = 6) -> dict | None:
    """Best Pearson corr of ours vs official shifted k months AHEAD (k=0..6).
    The gauge sees market prices before they reach the print — this is the
    hero-callout credibility stat (1c spec §5.2)."""
    best = None
    for k in range(max_shift + 1):
        pairs = [(o, official[i + k]) for i, o in enumerate(ours)
                 if o is not None and i + k < len(official)]
        if len(pairs) < 2:
            continue
        xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
        try:
            c = statistics.correlation(xs, ys)
        except statistics.StatisticsError:  # zero variance
            continue
        if best is None or c > best[1]:
            best = (k, c)
    return (None if best is None
            else {"best_shift_months": best[0], "corr": round(best[1], 4)})
```

In `build()`, after `official_col`:

```python
    core = _official_yoy(conn, "CPILFENS")
    core_col = [None if m not in core else round(core[m], 2) for m in months]
```

Add `"official_core_yoy_pct": core_col,` to the payload dict. At the end of the variant loop, after the `payload["validation"][name] = ...` line, add:

```python
        if name == "gauge":
            payload["validation"][name]["lead_lag"] = _lead_lag(
                [off[m] for m in months], raw)
```

- [ ] **Step 4: Update the schema** — `schemas/compare.schema.json`: add `"official_core_yoy_pct"` to the top-level `required` list and to `properties`:

```json
    "official_core_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
```

In `$defs.stats.properties` add (NOT in `required` — tracker omits it):

```json
        "lead_lag": {"oneOf": [
          {"type": "null"},
          {"type": "object",
           "required": ["best_shift_months", "corr"],
           "additionalProperties": false,
           "properties": {
             "best_shift_months": {"type": "integer", "minimum": 0, "maximum": 6},
             "corr": {"type": "number", "minimum": -1, "maximum": 1}}}]}
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_compare.py tests/test_run_daily.py -q`
Expected: all PASS (the e2e's lax FRED fake feeds every FRED series id the same fixture, so CPILFENS resolves).

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/compare.py schemas/compare.schema.json tests/test_compare.py
git commit -m "feat: compare.json — official core YoY column + gauge lead-lag stat"
```

---

### Task 4: Release calendar + `pulse.next_print`

**Files:**
- Create: `config/release_calendar.json`, `pipeline/release_calendar.py`
- Modify: `pipeline/publish/pulse.py`, `schemas/pulse.schema.json`, `pipeline/run_daily.py:73-74`
- Test: Create `tests/test_release_calendar.py`; modify `tests/test_pulse.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `release_calendar.next_print(today: str, path: Path | None = None) -> dict | None` returning `{"date": "YYYY-MM-DD", "reference_month": "YYYY-MM"}`; `pulse.build(gauge_result, cpi, next_print=None)` gains a keyword arg; `pulse.json` gains nullable `next_print`. Task 12 (GapTable) consumes it.

- [ ] **Step 1: Fetch the real BLS CPI schedule.** WebFetch `https://www.bls.gov/schedule/news_release/cpi.htm` and collect every remaining 2026 release plus all published 2027 dates. Sanity anchor: the **2026-06 reference month releases 2026-07-14** (verified against the nowflation homepage capture). If the fetch fails, STOP and ask the user for the dates — do not invent them.

- [ ] **Step 2: Write the config** — `config/release_calendar.json` (entries below are format examples; use the fetched dates, keep ascending order):

```json
{
  "cpi": [
    {"release_date": "2026-07-14", "reference_month": "2026-06"},
    {"release_date": "2026-08-12", "reference_month": "2026-07"}
  ]
}
```

- [ ] **Step 3: Write the failing tests** — `tests/test_release_calendar.py`:

```python
import json

from pipeline import release_calendar


def cfg(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(json.dumps({"cpi": [
        {"release_date": "2026-07-14", "reference_month": "2026-06"},
        {"release_date": "2026-08-12", "reference_month": "2026-07"}]}))
    return p


def test_before_a_release_returns_it(tmp_path):
    assert release_calendar.next_print("2026-07-01", cfg(tmp_path)) == \
        {"date": "2026-07-14", "reference_month": "2026-06"}


def test_on_release_day_still_returns_it(tmp_path):
    assert release_calendar.next_print("2026-07-14", cfg(tmp_path))["date"] == "2026-07-14"


def test_after_release_rolls_to_next(tmp_path):
    assert release_calendar.next_print("2026-07-15", cfg(tmp_path))["reference_month"] == "2026-07"


def test_exhausted_calendar_returns_none(tmp_path):
    assert release_calendar.next_print("2027-01-01", cfg(tmp_path)) is None


def test_default_config_loads_and_is_sorted():
    raw = json.loads(release_calendar.DEFAULT_PATH.read_text())
    dates = [e["release_date"] for e in raw["cpi"]]
    assert dates == sorted(dates) and len(dates) >= 6
```

- [ ] **Step 4: Run to verify failure**

Run: `pytest tests/test_release_calendar.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.release_calendar'`.

- [ ] **Step 5: Implement** — `pipeline/release_calendar.py`:

```python
"""BLS CPI release calendar — static config, refreshed by hand once a year.

A date column for the gap table (1c spec §7), not a nowcast; nextprint.json
(countdown, who's-where) stays Phase 3."""
import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "release_calendar.json"


def next_print(today: str, path: Path | None = None) -> dict | None:
    """First CPI release on/after today; None once the calendar is exhausted."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    for entry in sorted(raw["cpi"], key=lambda e: e["release_date"]):
        if entry["release_date"] >= today:
            return {"date": entry["release_date"],
                    "reference_month": entry["reference_month"]}
    return None
```

- [ ] **Step 6: Extend pulse.** In `pipeline/publish/pulse.py`, change `build` signature and return:

```python
def build(gauge_result: dict, cpi: dict, next_print: dict | None = None) -> dict:
```

and add `"next_print": next_print,` to the returned dict (after `"gap_pp"`). In `tests/test_pulse.py` update both `pulse.build(GAUGE_RESULT, CPI)` calls to `pulse.build(GAUGE_RESULT, CPI, next_print={"date": "2026-07-14", "reference_month": "2026-06"})` and add to `test_build_rounds_and_computes_gap`:

```python
    assert p["next_print"] == {"date": "2026-07-14", "reference_month": "2026-06"}
```

Add a null-tolerance test:

```python
def test_next_print_none_is_published_as_null(tmp_path):
    payload = pulse.build(GAUGE_RESULT, CPI, next_print=None)
    assert payload["next_print"] is None
    path = pulse.write(payload, tmp_path, published_at="2026-07-08T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "pulse.schema.json")
```

- [ ] **Step 7: Update the schema** — `schemas/pulse.schema.json`: add `"next_print"` to `required` and to `properties`:

```json
    "next_print": {"oneOf": [
      {"type": "null"},
      {"type": "object",
       "required": ["date", "reference_month"],
       "additionalProperties": false,
       "properties": {
         "date": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
         "reference_month": {"type": "string", "pattern": "^\\d{4}-\\d{2}$"}}}]}
```

- [ ] **Step 8: Wire into run_daily.** In `pipeline/run_daily.py`: add `from pipeline import release_calendar` to the `from pipeline import ...` import line (keep alphabetical: `from pipeline import basket as basket_mod`, then `from pipeline import collect, registry, release_calendar`). Change line 73:

```python
        pulse_path = pulse.write(
            pulse.build(gauge_result, cpi,
                        next_print=release_calendar.next_print(today)),
            args.out, published_at=published_at)
```

- [ ] **Step 9: Run tests**

Run: `pytest tests/test_release_calendar.py tests/test_pulse.py tests/test_run_daily.py -q`
Expected: all PASS. (The e2e uses the real DEFAULT config; `next_print` may legitimately be null if run after the calendar's horizon — the schema allows it.)

- [ ] **Step 10: Commit**

```bash
git add config/release_calendar.json pipeline/release_calendar.py pipeline/publish/pulse.py schemas/pulse.schema.json pipeline/run_daily.py tests/test_release_calendar.py tests/test_pulse.py
git commit -m "feat: BLS release calendar config -> pulse.next_print for the gap table"
```

---

### Task 5: Engine exposure — per-component daily index arrays

`gauge.run()` already builds each component's filled daily index and (inside `variants.build_component`) the rebased official index; expose both so the replay writer can publish them. No new math.

**Files:**
- Modify: `pipeline/engine/variants.py:15-31`, `pipeline/engine/gauge.py` (`run()` loop)
- Test: `tests/test_gauge.py` (append)

**Interfaces:**
- Consumes: existing stage functions.
- Produces: `variants.build_component(...) -> tuple[dict, str, dict]` (adds `official_idx` third); each `out[variant]["components"][code]` gains `"daily_index": dict[str, float]` (filled, GRID_START→end) and `"official_daily_index": dict[str, float]` (official series rebased + filled). Task 6 (replay writer) consumes them.

- [ ] **Step 1: Write the failing test** — append to `tests/test_gauge.py`:

```python
def test_components_expose_daily_index_arrays(tmp_path):
    conn, bp = seed(tmp_path, ROWS)
    r = gauge.run(conn, today="2019-01-05", basket_path=bp, staleness=STALENESS)
    fuel = r["variants"]["gauge"]["components"]["fuel"]
    # ours: LIVE_FU 10 -> 10.4 rebased = 100 -> 104, filled daily
    assert fuel["daily_index"]["2018-01-01"] == pytest.approx(100.0)
    assert fuel["daily_index"]["2018-06-15"] == pytest.approx(100.0)  # filled
    assert fuel["daily_index"]["2019-01-01"] == pytest.approx(104.0)
    # official: OFF_FU 200 -> 208 rebased = 100 -> 104
    assert fuel["official_daily_index"]["2019-01-01"] == pytest.approx(104.0)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_gauge.py::test_components_expose_daily_index_arrays -q`
Expected: FAIL with `KeyError: 'daily_index'`.

- [ ] **Step 3: Implement.** In `pipeline/engine/variants.py`, change `build_component`'s return type hint to `tuple[dict[str, float], str, dict[str, float]]` and both returns:

```python
        return rebase_mod.rebase(assembled), "live", official_idx
    return official_idx, "bls_cf", official_idx
```

In `pipeline/engine/gauge.py` `run()`: change the unpack to

```python
            idx, mode, official_idx = variants.build_component(
                comp, variant, official_series, live_sources)
```

collect `official_rebased[comp.code] = official_idx` in the loop (initialize `official_rebased = {}` beside `built, modes, flags`), and after `daily = {...}` add:

```python
        official_daily = {k: aggregate.fill_daily(v, GRID_START, end)
                          for k, v in official_rebased.items()}
```

then extend each `components[c.code]` dict with:

```python
                "daily_index": daily[c.code],
                "official_daily_index": official_daily[c.code],
```

- [ ] **Step 4: Run the full suite**

Run: `pytest -q`
Expected: all PASS (writers read only known keys; extra keys are inert).

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/variants.py pipeline/engine/gauge.py tests/test_gauge.py
git commit -m "feat: expose per-component daily index + official daily index on gauge result"
```

---

### Task 6: `replay.json` writer + schema

**Files:**
- Create: `pipeline/publish/replay.py`, `schemas/replay.schema.json`
- Modify: `pipeline/run_daily.py` (wire after gauge_daily; hoist `load_basket`), `tests/test_run_daily.py:76-77`, `tests/test_published_data.py:12-18`
- Test: Create `tests/test_replay.py`

**Interfaces:**
- Consumes: `daily_index`/`official_daily_index` (Task 5); `basket.load_basket()` comps for labels/weights.
- Produces: `replay.build(gauge_result, comps) -> dict`, `replay.write(payload, out_dir, published_at) -> Path` publishing `{published_at, rebase, dates[], components[{code,label,weight,mode,index[],bls_index[]}]}`. Task 13 (Treemap) fetches it at runtime.

- [ ] **Step 1: Write the failing tests** — `tests/test_replay.py`:

```python
from pathlib import Path

from pipeline import basket
from pipeline.publish import replay, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

COMP = basket.Component(code="fuel", label="Gasoline", weight=1.0,
                        official_series="OFF_FU", live_blend={"L": 1.0},
                        live_variants=("gauge",))

RESULT = {"base_month": "2018-01", "variants": {"gauge": {
    "index": {"2017-12-31": 99.5, "2018-01-01": 100.0, "2018-01-02": 100.5},
    "yoy": {}, "as_of": "2018-01-02", "coverage_pct": 100.0, "gate_flags": [],
    "components": {"fuel": {
        "weight": 1.0, "mode": "live", "yoy_pct": 2.0, "end_value": 100.5,
        "daily_index": {"2017-12-31": 99.456, "2018-01-01": 100.004,
                        "2018-01-02": 100.456},
        "official_daily_index": {"2017-12-31": 99.0, "2018-01-01": 100.0,
                                 "2018-01-02": 100.111}}}}}}


def test_build_clips_rounds_and_pairs_arrays():
    p = replay.build(RESULT, [COMP])
    assert p["rebase"] == "2018-01=100"
    assert p["dates"] == ["2018-01-01", "2018-01-02"]  # 2017 clipped
    c = p["components"][0]
    assert c["code"] == "fuel" and c["label"] == "Gasoline"
    assert c["index"] == [100.0, 100.46]
    assert c["bls_index"] == [100.0, 100.11]
    assert len(c["index"]) == len(c["bls_index"]) == len(p["dates"])


def test_write_is_compact_and_validates(tmp_path):
    path = replay.write(replay.build(RESULT, [COMP]), tmp_path,
                        published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "replay.json"
    assert '": ' not in path.read_text()  # compact separators, no indent
    validate.validate_file(path, SCHEMAS / "replay.schema.json")
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_replay.py -q`
Expected: FAIL with `ImportError: cannot import name 'replay'`.

- [ ] **Step 3: Implement** — `pipeline/publish/replay.py`:

```python
"""Writer for replay.json — per-component daily indexes for the treemap replay.

Compact JSON (no indent): ~14 components x ~3.1k daily points x 2 arrays.
The five treemap modes (YoY / MoM-ann / vs-BLS / 1-day / WoW) are client-side
display transforms of these two index arrays — the deliberate, bounded
exception to "the site only formats" (1c spec §6.3)."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START


def build(gauge_result: dict, comps) -> dict:
    g = gauge_result["variants"]["gauge"]
    dates = [d for d in sorted(g["index"]) if d >= PUBLISH_START]
    components = []
    for comp in comps:
        e = g["components"][comp.code]
        components.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "index": [round(e["daily_index"][d], 2) for d in dates],
            "bls_index": [round(e["official_daily_index"][d], 2)
                          for d in dates]})
    return {"rebase": f"{gauge_result['base_month']}=100",
            "dates": dates, "components": components}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "replay.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               separators=(",", ":")) + "\n")
    return path
```

- [ ] **Step 4: Write the schema** — `schemas/replay.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "replay",
  "type": "object",
  "required": ["published_at", "rebase", "dates", "components"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "rebase": {"type": "string"},
    "dates": {"type": "array",
              "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "label", "weight", "mode", "index", "bls_index"],
        "additionalProperties": false,
        "properties": {
          "code": {"type": "string"},
          "label": {"type": "string"},
          "weight": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
          "mode": {"enum": ["live", "bls_cf"]},
          "index": {"type": "array", "items": {"type": "number"}},
          "bls_index": {"type": "array", "items": {"type": "number"}}
        }
      }
    }
  }
}
```

- [ ] **Step 5: Wire into run_daily.** In `pipeline/run_daily.py`: add `replay` to the publish import tuple. Move the `_, comps = basket_mod.load_basket()` line (currently line 93) UP, to just before the `pulse_path = ...` block. After the `gd_path` block add:

```python
        replay_path = replay.write(replay.build(gauge_result, comps), args.out,
                                   published_at=published_at)
        validate.validate_file(replay_path, SCHEMAS / "replay.schema.json")
        print(f"published: {replay_path}")
```

- [ ] **Step 6: Extend the e2e + contract tests.** In `tests/test_run_daily.py:76`, change the files tuple to `("gauge_daily.json", "compare.json", "gaptable.json", "replay.json")`. In `tests/test_published_data.py` CONTRACT list add `("replay.json", "replay.schema.json"),`.

- [ ] **Step 7: Run tests**

Run: `pytest tests/test_replay.py tests/test_run_daily.py tests/test_published_data.py -q`
Expected: all PASS (`replay.json` not yet committed → published-data param skips).

- [ ] **Step 8: Commit**

```bash
git add pipeline/publish/replay.py schemas/replay.schema.json pipeline/run_daily.py tests/test_replay.py tests/test_run_daily.py tests/test_published_data.py
git commit -m "feat: replay.json writer + schema — daily ours/BLS indexes per component"
```

---

### Task 7: `methodology.json` writer + schema

**Files:**
- Create: `pipeline/publish/methodology.py`, `schemas/methodology.schema.json`
- Modify: `pipeline/engine/gauge.py` (add `ENGINE_VERSION = "1.0"` constant beside `GRID_START`), `pipeline/run_daily.py` (assign `gaptable_payload`, wire writer), `tests/test_run_daily.py`, `tests/test_published_data.py`
- Test: Create `tests/test_methodology.py`

**Interfaces:**
- Consumes: `gauge_result` (incl. Task 2/5 fields), store `conn`, registry `sources`/`series`, basket `comps`, `compare_payload["validation"]`, `gaptable_payload`, `cpi`, `today`.
- Produces: `methodology.build(gauge_result, conn, sources, series, comps, validation, gaptable_payload, cpi, today) -> dict`; `methodology.write(...) -> Path`. Payload blocks: `stats`, `stages`, `basket`, `freshness`, `inventory`, `validation` (incl. `bls_reconstruction`), `variants`, `limitations`. Task 14 (methodology page) consumes all of them.

- [ ] **Step 1: Write the failing tests** — `tests/test_methodology.py`:

```python
from pathlib import Path

from pipeline import basket, registry
from pipeline.models import Observation
from pipeline.publish import methodology, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"

SOURCES = {"T": registry.Source(name="T", route="API", cadence="monthly",
                                secret=None, secret_optional=False)}
SERIES = [registry.Series(code="OFF_FU", source="T", source_id="x",
                          name="Official fuel", max_staleness_days=80),
          registry.Series(code="NEVER", source="T", source_id="y",
                          name="Never seen", max_staleness_days=10)]
COMPS = [basket.Component(code="fuel", label="Gasoline", weight=1.0,
                          official_series="OFF_FU", live_blend={"L": 1.0},
                          live_variants=("gauge",))]
RESULT = {"base_month": "2018-01", "variants": {
    "gauge": {"index": {}, "yoy": {}, "as_of": "2018-06-01",
              "coverage_pct": 40.456, "gate_flags": [],
              "components": {"fuel": {"weight": 1.0, "mode": "live",
                                      "yoy_pct": 2.345, "end_value": 101.0}}},
    "tracker": {"index": {}, "yoy": {}, "as_of": "2018-06-01",
                "coverage_pct": 6.5, "gate_flags": [], "components": {}}}}
VALIDATION = {"gauge": {"corr": 0.94, "mean_abs_gap_pp": 0.79,
                        "window": "2018-01..2018-06",
                        "lead_lag": {"best_shift_months": 3, "corr": 0.95}},
              "tracker": {"corr": 0.98, "mean_abs_gap_pp": 0.39,
                          "window": "2018-01..2018-06"}}
GAPTABLE = {"rows": [{"component": "fuel", "weight": 1.0, "bls_yoy_pct": 3.0}]}
CPI = {"month": "2018-05-01", "yoy_pct": 2.9876, "prev_yoy_pct": 2.9}


def seed(tmp_path):
    vintage.append([Observation(series_code="OFF_FU", obs_date="2018-05-01",
                                value=100.0, vintage_date="2018-06-01",
                                source="T", route="API")], tmp_path)
    return vintage.load(tmp_path)


def test_build_stats_inventory_and_reconstruction(tmp_path):
    conn = seed(tmp_path)
    p = methodology.build(RESULT, conn, SOURCES, SERIES, COMPS, VALIDATION,
                          GAPTABLE, CPI, today="2018-06-02")
    assert p["stats"] == {"series_count": 2, "obs_count": 1, "source_count": 1,
                          "tracker_corr": 0.98, "live_coverage_pct": 40.46,
                          "engine_version": "1.0", "rebase": "2018-01=100"}
    assert [s["n"] for s in p["stages"]] == [1, 2, 3, 4, 5]
    assert p["basket"] == [{"code": "fuel", "label": "Gasoline", "weight": 1.0,
                            "mode": "live", "live_sources": ["L"],
                            "official_series": "OFF_FU", "yoy_pct": 2.35}]
    assert p["freshness"] == {"fresh_count": 1, "total": 2}
    never = [r for r in p["inventory"] if r["code"] == "NEVER"][0]
    assert never["fresh"] is False and never["latest_obs"] is None
    assert p["validation"]["bls_reconstruction"] == {
        "weighted_bls_yoy_pct": 3.0, "official_yoy_pct": 2.99}
    assert len(p["limitations"]) >= 3


def test_write_validates_against_schema(tmp_path):
    conn = seed(tmp_path)
    p = methodology.build(RESULT, conn, SOURCES, SERIES, COMPS, VALIDATION,
                          GAPTABLE, CPI, today="2018-06-02")
    path = methodology.write(p, tmp_path, published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "methodology.json"
    validate.validate_file(path, SCHEMAS / "methodology.schema.json")
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_methodology.py -q`
Expected: FAIL with `ImportError: cannot import name 'methodology'`.

- [ ] **Step 3: Add the version constant.** In `pipeline/engine/gauge.py`, under `PUBLISH_START` add:

```python
ENGINE_VERSION = "1.0"           # bumped on methodology-changing engine math
```

- [ ] **Step 4: Implement** — `pipeline/publish/methodology.py`:

```python
"""Writer for methodology.json — generated docs; never hand-written.

Everything derives from config + the store + live validation stats so the
methodology page cannot drift from code (1c spec §8). STAGES prose and
LIMITATIONS are the two hand-authored blocks, kept here so review catches
drift when the engine changes."""
import json
from datetime import date
from pathlib import Path

from pipeline.engine.gauge import ENGINE_VERSION
from pipeline.store import vintage

STAGES = [
    {"n": 1, "name": "Rebase",
     "description": "Every series is indexed so its base-month mean = 100, "
                    "making $/gal, cents/kWh and $ rent unitless and comparable.",
     "formula": "idx_t = 100 * value_t / mean(value | month = base)"},
    {"n": 2, "name": "Blend & splice",
     "description": "Volatile components ride live market data grafted onto "
                    "official BLS history at the splice point; weights "
                    "renormalize as sources phase in.",
     "formula": None},
    {"n": 3, "name": "Quality gate",
     "description": "A live component moving more than 5% in one day is held "
                    "at its prior value for one day; if the move persists it "
                    "passes through. Publication never blocks.",
     "formula": None},
    {"n": 4, "name": "Aggregate",
     "description": "Laspeyres headline over the daily grid; headline YoY is "
                    "the weighted sum of each component's like-month YoY at "
                    "its own last observation, carried forward between prints.",
     "formula": "headline_yoy(d) = sum_i w_i * yoy_i(d)"},
    {"n": 5, "name": "Variants",
     "description": "Each published cut assembles the same components with a "
                    "different live/official mix; which component rides live "
                    "data is config, not code.",
     "formula": None},
]

LIMITATIONS = [
    "Components without a live source carry the latest official BLS print "
    "forward between releases (labeled BLS-CF); their between-print YoY is "
    "the last print's, not a nowcast.",
    "Live coverage is a minority of basket weight today; the coverage "
    "percentage is published on every card rather than hidden.",
    "Fuel diverges from BLS by construction: pump-price YoY vs the CPI "
    "gasoline index methodology.",
    "Component YoY is computed at each component's own last observation "
    "(like month vs like month), so lagging series compare honestly at the "
    "cost of timeliness.",
]

VARIANTS = {
    "gauge": "CPI-comparable: the market-rent blend drives both shelter "
             "components; fuel, electricity and piped gas ride live EIA data.",
    "tracker": "Official shelter dynamics; only fuel, electricity and piped "
               "gas ride live — built to re-track the print.",
}


def build(gauge_result: dict, conn, sources: dict, series: list, comps,
          validation: dict, gaptable_payload: dict, cpi: dict,
          today: str) -> dict:
    g = gauge_result["variants"]["gauge"]
    obs_count = conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    inventory, fresh_count = [], 0
    for s in series:
        latest = vintage.max_obs_date(conn, s.code)
        fresh = (latest is not None
                 and (date.fromisoformat(today)
                      - date.fromisoformat(latest)).days <= s.max_staleness_days)
        fresh_count += fresh
        inventory.append({"code": s.code, "name": s.name, "source": s.source,
                          "route": sources[s.source].route,
                          "cadence": sources[s.source].cadence,
                          "latest_obs": latest, "fresh": fresh})
    basket_rows = []
    for comp in comps:
        e = g["components"][comp.code]
        basket_rows.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "live_sources": sorted(comp.live_blend) if comp.live_blend else [],
            "official_series": comp.official_series,
            "yoy_pct": None if e["yoy_pct"] is None else round(e["yoy_pct"], 2)})
    weighted_bls = sum(r["weight"] * r["bls_yoy_pct"]
                       for r in gaptable_payload["rows"])
    return {
        "stats": {"series_count": len(series), "obs_count": obs_count,
                  "source_count": len(sources),
                  "tracker_corr": validation["tracker"]["corr"],
                  "live_coverage_pct": round(g["coverage_pct"], 2),
                  "engine_version": ENGINE_VERSION,
                  "rebase": f"{gauge_result['base_month']}=100"},
        "stages": STAGES,
        "basket": basket_rows,
        "freshness": {"fresh_count": fresh_count, "total": len(series)},
        "inventory": inventory,
        "validation": {**validation,
                       "bls_reconstruction": {
                           "weighted_bls_yoy_pct": round(weighted_bls, 2),
                           "official_yoy_pct": round(cpi["yoy_pct"], 2)}},
        "variants": VARIANTS,
        "limitations": LIMITATIONS,
    }


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "methodology.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 5: Write the schema** — `schemas/methodology.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "methodology",
  "type": "object",
  "required": ["published_at", "stats", "stages", "basket", "freshness",
               "inventory", "validation", "variants", "limitations"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "stats": {
      "type": "object",
      "required": ["series_count", "obs_count", "source_count", "tracker_corr",
                   "live_coverage_pct", "engine_version", "rebase"],
      "additionalProperties": false,
      "properties": {
        "series_count": {"type": "integer", "minimum": 1},
        "obs_count": {"type": "integer", "minimum": 1},
        "source_count": {"type": "integer", "minimum": 1},
        "tracker_corr": {"type": ["number", "null"], "minimum": -1, "maximum": 1},
        "live_coverage_pct": {"type": "number", "minimum": 0, "maximum": 100},
        "engine_version": {"type": "string"},
        "rebase": {"type": "string"}
      }
    },
    "stages": {
      "type": "array", "minItems": 5, "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["n", "name", "description", "formula"],
        "additionalProperties": false,
        "properties": {
          "n": {"type": "integer"},
          "name": {"type": "string"},
          "description": {"type": "string"},
          "formula": {"type": ["string", "null"]}
        }
      }
    },
    "basket": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "label", "weight", "mode", "live_sources",
                     "official_series", "yoy_pct"],
        "additionalProperties": false,
        "properties": {
          "code": {"type": "string"},
          "label": {"type": "string"},
          "weight": {"type": "number"},
          "mode": {"enum": ["live", "bls_cf"]},
          "live_sources": {"type": "array", "items": {"type": "string"}},
          "official_series": {"type": "string"},
          "yoy_pct": {"type": ["number", "null"]}
        }
      }
    },
    "freshness": {
      "type": "object",
      "required": ["fresh_count", "total"],
      "additionalProperties": false,
      "properties": {
        "fresh_count": {"type": "integer", "minimum": 0},
        "total": {"type": "integer", "minimum": 1}
      }
    },
    "inventory": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "name", "source", "route", "cadence",
                     "latest_obs", "fresh"],
        "additionalProperties": false,
        "properties": {
          "code": {"type": "string"},
          "name": {"type": "string"},
          "source": {"type": "string"},
          "route": {"type": "string"},
          "cadence": {"type": "string"},
          "latest_obs": {"type": ["string", "null"]},
          "fresh": {"type": "boolean"}
        }
      }
    },
    "validation": {"type": "object"},
    "variants": {
      "type": "object",
      "additionalProperties": {"type": "string"}
    },
    "limitations": {"type": "array", "minItems": 1, "items": {"type": "string"}}
  }
}
```

- [ ] **Step 6: Wire into run_daily.** In `pipeline/run_daily.py`: add `methodology` to the publish import tuple. Replace the gaptable block (lines 94-99) with an assigned-payload version and append the methodology write:

```python
        gaptable_payload = gaptable.build(gauge_result, conn, comps,
                                          official_month=cpi["month"])
        gt_path = gaptable.write(gaptable_payload, args.out,
                                 published_at=published_at)
        validate.validate_file(gt_path, SCHEMAS / "gaptable.schema.json")
        print(f"published: {gt_path}")

        meth_path = methodology.write(
            methodology.build(gauge_result, conn, sources, series, comps,
                              compare_payload["validation"], gaptable_payload,
                              cpi, today),
            args.out, published_at=published_at)
        validate.validate_file(meth_path, SCHEMAS / "methodology.schema.json")
        print(f"published: {meth_path}")
```

- [ ] **Step 7: Extend the e2e + contract tests.** `tests/test_run_daily.py:76` files tuple gains `"methodology.json"`. `tests/test_published_data.py` CONTRACT gains `("methodology.json", "methodology.schema.json"),`.

- [ ] **Step 8: Run the full suite**

Run: `pytest -q`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add pipeline/publish/methodology.py schemas/methodology.schema.json pipeline/engine/gauge.py pipeline/run_daily.py tests/test_methodology.py tests/test_run_daily.py tests/test_published_data.py
git commit -m "feat: methodology.json writer + schema — generated docs, never hand-written"
```

---

### Task 8: Republish committed data

The site build (Tasks 11–14) imports `methodology.json`/fetches `replay.json` from `site/public/data/` — they must exist in the repo before the site tasks.

**Files:**
- Modify (generated): `site/public/data/*.json`, `store/obs/*.jsonl`

**Interfaces:**
- Consumes: everything from Tasks 1–7; real API keys (`FRED_API_KEY` required; `EIA_API_KEY`, `FMP_API_KEY` expected; `BLS_API_KEY` optional).
- Produces: all nine published JSONs regenerated with the corrected headline + new contracts.

- [ ] **Step 1: Check keys.** `echo ${FRED_API_KEY:+set}` — if unset, STOP and ask the user to export the keys (or run the command themselves via `! FRED_API_KEY=... python -m pipeline.run_daily --store store --out site/public/data`). Do not skip this task: the site tasks depend on the published files.

- [ ] **Step 2: Fetch/rebase first** (the daily bot commits every morning):

```bash
git fetch origin && git rebase origin/main
```

Resolve any `store/obs/*.jsonl` conflicts by UNION (keep both sides' rows).

- [ ] **Step 3: Run the pipeline**

Run: `python -m pipeline.run_daily --store store --out site/public/data 2>&1 | tee /tmp/task8-publish.log`
Expected: rc 0; nine `published:` lines including `replay.json` and `methodology.json`; gauge YoY printed ≈ 3.3–3.5.

- [ ] **Step 4: Validate committed data**

Run: `pytest tests/test_published_data.py tests/test_backfill.py -q`
Expected: all PASS (9 contract files validate; pulse gap self-consistent; tracker corr pinned).

- [ ] **Step 5: Commit**

```bash
git add store site/public/data
git commit -m "data: republish — own-end headline YoY + replay/methodology/core/next-print contracts"
```

---

### Task 9: `fmtPp` + `PageShell` + layout integration

**Files:**
- Create: `site/src/components/PageShell.tsx`
- Modify: `site/src/lib/format.ts`, `site/src/app/layout.tsx`, `site/src/app/page.tsx:68-98` (header block)

**Interfaces:**
- Consumes: `pulse.json`, `qa.json` (existing), `StatusPill`, `fmtPct`.
- Produces: `PageShell({children})` — the shared shell every route renders inside; `fmtPp(pp: number | null): string` ("+0.30pp"/"−0.87pp"/"—"). Tasks 11–14 use both.

- [ ] **Step 1: Add `fmtPp`** to `site/src/lib/format.ts`:

```ts
/** +0.30pp / −0.87pp / — (2dp, for gap chips) */
export function fmtPp(pp: number | null): string {
  if (pp === null || pp === undefined) return "—";
  const s = pp > 0 ? "+" : pp < 0 ? "−" : "";
  return `${s}${Math.abs(pp).toFixed(2)}pp`;
}
```

- [ ] **Step 2: Create `site/src/components/PageShell.tsx`** (server component):

```tsx
import Link from "next/link";
import pulse from "../../public/data/pulse.json";
import qa from "../../public/data/qa.json";
import { StatusPill } from "./StatusPill";
import { fmtPct } from "@/lib/format";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
          paddingBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <Link href="/" style={{ textDecoration: "none", color: "var(--text)" }}>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "0.14em" }}>
              MACROGAUGE
            </span>
          </Link>
          <nav style={{ display: "flex", gap: 14, fontSize: 13 }}>
            <Link href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Home
            </Link>
            <Link
              href="/methodology"
              style={{ color: "var(--muted)", textDecoration: "none" }}
            >
              Methodology
            </Link>
          </nav>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(52, 211, 153, 0.35)",
              background: "rgba(52, 211, 153, 0.1)",
              borderRadius: 999,
              padding: "3px 12px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--accent-emerald)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "var(--accent-emerald)",
              }}
            />
            MACROGAUGE {fmtPct(pulse.gauge.yoy_pct)}
          </span>
          <StatusPill
            ok={qa.passed === qa.total}
            label={`Self-test ${qa.passed}/${qa.total}`}
          />
        </div>
      </header>
      {children}
    </main>
  );
}
```

- [ ] **Step 3: Wrap the layout.** In `site/src/app/layout.tsx`, import and wrap:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "macrogauge",
  description: "Daily US inflation & macro analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: De-duplicate the homepage header.** In `site/src/app/page.tsx`: change the root element from `<main style={{ maxWidth: 1200, ... }}>` to a plain `<div>` (the shell owns the container), and replace the whole `<header>...</header>` block (lines 70–98) with:

```tsx
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 16 }}>
        daily US inflation &amp; macro · published {pulse.published_at} ·
        independent gauge + official data
      </div>
```

Remove the now-unused `StatusPill` import if nothing else in the file uses it (the Sources section still uses it — keep it).

- [ ] **Step 5: Build**

Run: `cd site && npm run build`
Expected: exit 0; both `/` and (later) route pages render inside the shell.

- [ ] **Step 6: Commit**

```bash
git add site/src/components/PageShell.tsx site/src/lib/format.ts site/src/app/layout.tsx site/src/app/page.tsx
git commit -m "feat: PageShell nav — logo, live gauge pill, methodology link; fmtPp"
```

---

### Task 10: ECharts + `EChart` wrapper + chart theme

**Files:**
- Create: `site/src/components/EChart.tsx`, `site/src/lib/chartTheme.ts`
- Modify: `site/package.json` (via npm)

**Interfaces:**
- Consumes: `echarts` npm package (modular `echarts/core`).
- Produces: `EChart({ option, height? }): JSX` client component (init in `useEffect` → SSG-safe; resizes with window; disposes on unmount); `chartTheme.C` (token hexes), `chartTheme.NBER_RECESSIONS`, `chartTheme.baseOption()`. Tasks 11 + 13 consume all three.

- [ ] **Step 1: Install**

Run: `cd site && npm install echarts`
Expected: `echarts` lands in `dependencies`.

- [ ] **Step 2: Create `site/src/lib/chartTheme.ts`**:

```ts
// Canvas can't read CSS custom properties — these hexes MIRROR globals.css.
// If a token changes there, change it here.
export const C = {
  bg: "#0B0F14",
  card: "#11161C",
  border: "#1E2630",
  text: "#E6EDF3",
  muted: "#8B98A5",
  sky: "#38BDF8",
  amber: "#F59E0B",
  red: "#F87171",
  emerald: "#34D399",
  violet: "#A78BFA",
} as const;

/** NBER recessions inside the 2018→now window (peak month → trough month). */
export const NBER_RECESSIONS: [string, string][] = [["2020-02-01", "2020-04-30"]];

/** Shared dark chart chrome: thin lines, sparse gridlines, dark tooltip. */
export function baseOption() {
  return {
    backgroundColor: "transparent",
    textStyle: { color: C.muted, fontSize: 11 },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: C.card,
      borderColor: C.border,
      textStyle: { color: C.text, fontSize: 12 },
      valueFormatter: (v: unknown) =>
        typeof v === "number" ? `${v.toFixed(2)}%` : "—",
    },
    legend: {
      top: 0,
      textStyle: { color: C.muted, fontSize: 12 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: {
      type: "time" as const,
      axisLine: { lineStyle: { color: C.border } },
      axisLabel: { color: C.muted },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { color: C.muted, formatter: "{value}%" },
      splitLine: { lineStyle: { color: C.border } },
    },
  };
}
```

- [ ] **Step 3: Create `site/src/components/EChart.tsx`**:

```tsx
"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, TreemapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

/** Thin ECharts wrapper: init on mount (client-only — SSG renders an empty
 *  div), setOption on change, resize with the window, dispose on unmount. */
export function EChart({
  option,
  height = 320,
}: {
  option: Record<string, unknown>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
```

- [ ] **Step 4: Build**

Run: `cd site && npm run build`
Expected: exit 0 (components exist but are unused — tree-shaken, no page change).

- [ ] **Step 5: Commit**

```bash
git add site/package.json site/package-lock.json site/src/components/EChart.tsx site/src/lib/chartTheme.ts
git commit -m "feat: ECharts infra — modular wrapper component + shared dark chart theme"
```

---

### Task 11: HeroChart + homepage wiring + lead-lag callout

**Files:**
- Create: `site/src/components/HeroChart.tsx`
- Modify: `site/src/app/page.tsx` (imports + new Section after the KPI row)

**Interfaces:**
- Consumes: `EChart`, `chartTheme` (Task 10); `gauge_daily.json` variants; `compare.json` months/official/core/validation (Task 3 fields).
- Produces: `HeroChart({dates, gauge, tracker, months, official, core})` client component. Page passes build-time-imported JSON.

- [ ] **Step 1: Create `site/src/components/HeroChart.tsx`**:

```tsx
"use client";
import { EChart } from "./EChart";
import { C, NBER_RECESSIONS, baseOption } from "@/lib/chartTheme";

type Pt = [string, number];

function pair(xs: string[], ys: (number | null)[]): Pt[] {
  const out: Pt[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y !== null && y !== undefined) out.push([x, y]);
  });
  return out;
}

export function HeroChart({
  dates,
  gauge,
  tracker,
  months,
  official,
  core,
}: {
  dates: string[];
  gauge: (number | null)[];
  tracker: (number | null)[];
  months: string[];
  official: (number | null)[];
  core: (number | null)[];
}) {
  const option = {
    ...baseOption(),
    series: [
      {
        name: "Macrogauge (CPI-comparable)",
        type: "line",
        data: pair(dates, gauge),
        showSymbol: false,
        lineStyle: { width: 2, color: C.sky },
        itemStyle: { color: C.sky },
        markArea: {
          silent: true,
          itemStyle: { color: "rgba(139, 152, 165, 0.08)" },
          data: NBER_RECESSIONS.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
        },
      },
      {
        name: "CPI-Tracker",
        type: "line",
        data: pair(dates, tracker),
        showSymbol: false,
        lineStyle: { width: 1.5, color: C.violet },
        itemStyle: { color: C.violet },
      },
      {
        name: "Official CPI",
        type: "line",
        step: "end",
        data: pair(months, official),
        showSymbol: false,
        lineStyle: { width: 1.5, type: "dashed", color: C.muted },
        itemStyle: { color: C.muted },
      },
      {
        name: "Official Core",
        type: "line",
        step: "end",
        data: pair(months, core),
        showSymbol: false,
        lineStyle: { width: 1.5, type: "dashed", color: "#5B6873" },
        itemStyle: { color: "#5B6873" },
      },
    ],
  };
  return <EChart option={option} height={340} />;
}
```

- [ ] **Step 2: Wire into the homepage.** In `site/src/app/page.tsx` add imports:

```tsx
import gaugeDaily from "../../public/data/gauge_daily.json";
import compare from "../../public/data/compare.json";
import { HeroChart } from "@/components/HeroChart";
```

Insert directly after the KPI-card `<div>` (before the "Official CPI components" Section):

```tsx
      <Section title="Macrogauge vs official — YoY since 2018">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <HeroChart
            dates={gaugeDaily.variants.gauge.dates}
            gauge={gaugeDaily.variants.gauge.yoy_pct}
            tracker={gaugeDaily.variants.tracker.yoy_pct}
            months={compare.months}
            official={compare.official_yoy_pct}
            core={compare.official_core_yoy_pct}
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          {compare.validation.gauge.lead_lag ? (
            <>
              <span style={{ color: "var(--accent-sky)", fontWeight: 600 }}>
                LEAD-LAG:
              </span>{" "}
              gauge today correlates {compare.validation.gauge.lead_lag.corr}{" "}
              with official CPI{" "}
              {compare.validation.gauge.lead_lag.best_shift_months} month
              {compare.validation.gauge.lead_lag.best_shift_months === 1
                ? ""
                : "s"}{" "}
              ahead ·{" "}
            </>
          ) : null}
          CPI-TRACKER {fmtPct(pulse.tracker.yoy_pct)} — built to re-track the
          print · {pulse.gauge.coverage_pct.toFixed(0)}% of basket weight rides
          live data
        </div>
      </Section>
```

TypeScript note: the JSON import types `official_yoy_pct` as `number[]` and nullable columns as `(number | null)[]` automatically; if `tsc` complains about `lead_lag` being possibly absent on the tracker variant type, access it only via `compare.validation.gauge`.

- [ ] **Step 3: Build + eyeball**

Run: `cd site && npm run build`
Expected: exit 0. Then `npm run dev`, open `http://localhost:3000` — hero renders 4 series, legend chips on top, recession band in 2020, no console errors, **no sawtooth on the sky line near the right edge**.

- [ ] **Step 4: Commit**

```bash
git add site/src/components/HeroChart.tsx site/src/app/page.tsx
git commit -m "feat: hero chart — daily gauge/tracker vs official + core, lead-lag callout"
```

---

### Task 12: Gap tables — variant-level + component decomposition + link row

**Files:**
- Create: `site/src/components/GapTable.tsx`, `site/src/components/GapDecomposition.tsx`
- Modify: `site/src/app/page.tsx` (two Sections after the hero Section)

**Interfaces:**
- Consumes: `pulse.json` (incl. `next_print`, Task 4), `compare.json` validation, `gaptable.json`, `gauge_daily.json` last index; `fmtPp`, `fmtMonth`, `fmtPct`, `DeltaChip` patterns.
- Produces: `GapTable({rows, nextPrint, cumulativePct})`, `GapDecomposition({rows, asOf, officialMonth, totalGapPp})` server components.

- [ ] **Step 1: Create `site/src/components/GapTable.tsx`**:

```tsx
import Link from "next/link";
import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 500,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  borderBottom: "1px solid var(--border)",
};

export type GapRow = {
  index: string;
  sub: string;
  oursYoy: number;
  oursAsOf: string;
  officialYoy: number;
  officialMonth: string;
};

export function GapTable({
  rows,
  nextPrint,
  cumulativePct,
}: {
  rows: GapRow[];
  nextPrint: { date: string; reference_month: string } | null;
  cumulativePct: number;
}) {
  return (
    <div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <thead>
            <tr>
              <th style={th}>Index</th>
              <th style={{ ...th, textAlign: "right" }}>Macrogauge YoY</th>
              <th style={{ ...th, textAlign: "right" }}>Latest official YoY</th>
              <th style={{ ...th, textAlign: "right" }}>Gap</th>
              <th style={{ ...th, textAlign: "right" }}>Next print</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gap = r.oursYoy - r.officialYoy;
              return (
                <tr key={r.index}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{r.index}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.sub}</div>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span style={{ color: "var(--accent-sky)", fontWeight: 600 }}>
                      {fmtPct(r.oursYoy)}
                    </span>{" "}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.oursAsOf}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {fmtPct(r.officialYoy)}{" "}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {fmtMonth(r.officialMonth)}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background:
                          gap < 0 ? "rgba(56, 189, 248, 0.15)" : "rgba(248, 113, 113, 0.15)",
                        border: `1px solid ${gap < 0 ? "rgba(56, 189, 248, 0.35)" : "rgba(248, 113, 113, 0.35)"}`,
                        color: gap < 0 ? "var(--accent-sky)" : "var(--accent-red)",
                        borderRadius: 999,
                        padding: "1px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {fmtPp(gap)}
                    </span>
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      color: "var(--accent-amber)",
                      fontSize: 13,
                    }}
                  >
                    {nextPrint
                      ? `${fmtMonth(`${nextPrint.reference_month}-01`)} · ${nextPrint.date}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Link
          href="/methodology"
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            borderRadius: 999,
            padding: "3px 12px",
            fontSize: 12,
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          How the methodology works →
        </Link>
        <span
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            borderRadius: 999,
            padding: "3px 12px",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Prices are up{" "}
          <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
            {cumulativePct.toFixed(1)}%
          </span>{" "}
          since Jan 2018
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `site/src/components/GapDecomposition.tsx`**:

```tsx
import { fmtMonth, fmtPp, fmtSigned, yoyColor } from "@/lib/format";

const th: React.CSSProperties = {
  textAlign: "right",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 500,
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 13,
  textAlign: "right",
  borderBottom: "1px solid var(--border)",
  fontVariantNumeric: "tabular-nums",
};

type Row = {
  component: string;
  label: string;
  weight: number;
  mode: string;
  ours_yoy_pct: number | null;
  bls_yoy_pct: number;
  gap_pp: number | null;
  contribution_pp: number | null;
};

export function GapDecomposition({
  rows,
  asOf,
  officialMonth,
  totalGapPp,
}: {
  rows: Row[];
  asOf: string;
  officialMonth: string;
  totalGapPp: number;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Component</th>
            <th style={th}>Weight</th>
            <th style={{ ...th, textAlign: "center" }}>Mode</th>
            <th style={th}>Ours YoY</th>
            <th style={th}>BLS YoY ({fmtMonth(officialMonth)})</th>
            <th style={th}>Gap</th>
            <th style={th}>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component}>
              <td style={{ ...td, textAlign: "left", fontSize: 14 }}>{r.label}</td>
              <td style={td}>{(r.weight * 100).toFixed(1)}%</td>
              <td style={{ ...td, textAlign: "center" }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    padding: "1px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    color:
                      r.mode === "live" ? "var(--accent-emerald)" : "var(--muted)",
                  }}
                >
                  {r.mode === "live" ? "LIVE" : "BLS-CF"}
                </span>
              </td>
              <td style={{ ...td, color: "var(--accent-sky)", fontWeight: 600 }}>
                {fmtSigned(r.ours_yoy_pct)}
              </td>
              <td style={td}>{fmtSigned(r.bls_yoy_pct)}</td>
              <td style={{ ...td, color: yoyColor(r.gap_pp) }}>{fmtPp(r.gap_pp)}</td>
              <td style={{ ...td, color: yoyColor(r.contribution_pp) }}>
                {fmtPp(r.contribution_pp)}
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
              Total gap vs official
            </td>
            <td style={td} colSpan={5} />
            <td style={{ ...td, fontWeight: 700, color: yoyColor(totalGapPp) }}>
              {fmtPp(totalGapPp)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px" }}>
        gap contribution = weight × (ours − BLS) · ours as of {asOf} · BLS-CF rows
        carry the official print, so their gap is 0 by construction
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the homepage.** In `site/src/app/page.tsx` add imports:

```tsx
import gaptable from "../../public/data/gaptable.json";
import { GapTable } from "@/components/GapTable";
import { GapDecomposition } from "@/components/GapDecomposition";
```

After the hero Section insert (treemap Section from Task 13 will slot between them later):

```tsx
      <Section title="Component gap decomposition — ours vs BLS">
        <GapDecomposition
          rows={gaptable.rows}
          asOf={gaptable.as_of}
          officialMonth={gaptable.official_month}
          totalGapPp={gaptable.total_gap_pp}
        />
      </Section>

      <Section title="Macrogauge vs official — gap table">
        <GapTable
          rows={[
            {
              index: "US CPI",
              sub: "daily gauge",
              oursYoy: pulse.gauge.yoy_pct,
              oursAsOf: pulse.gauge.as_of,
              officialYoy: pulse.official.yoy_pct,
              officialMonth: pulse.official.month,
            },
            {
              index: "CPI-Tracker",
              sub: "official shelter dynamics",
              oursYoy: pulse.tracker.yoy_pct,
              oursAsOf: pulse.tracker.as_of,
              officialYoy: pulse.official.yoy_pct,
              officialMonth: pulse.official.month,
            },
          ]}
          nextPrint={pulse.next_print}
          cumulativePct={
            gaugeDaily.variants.gauge.index[
              gaugeDaily.variants.gauge.index.length - 1
            ] - 100
          }
        />
      </Section>
```

- [ ] **Step 4: Build + eyeball**

Run: `cd site && npm run build`
Expected: exit 0. Dev-server check: both tables render, gap chips blue (negative), NEXT PRINT amber, decomposition pills LIVE/BLS-CF, link row navigates (methodology 404s until Task 14 — expected).

- [ ] **Step 5: Commit**

```bash
git add site/src/components/GapTable.tsx site/src/components/GapDecomposition.tsx site/src/app/page.tsx
git commit -m "feat: gap tables — variant cuts w/ next-print + component decomposition"
```

---

### Task 13: Basket treemap — replay scrubber, five modes

**Files:**
- Create: `site/src/components/Treemap.tsx`
- Modify: `site/src/app/page.tsx` (Section between hero and decomposition)

**Interfaces:**
- Consumes: `EChart`, `chartTheme.C`; runtime `fetch("/data/replay.json")` (Task 6 shape).
- Produces: `Treemap()` self-contained client component (fetches its own data — lazy, non-blocking).

- [ ] **Step 1: Create `site/src/components/Treemap.tsx`**:

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EChart } from "./EChart";
import { C } from "@/lib/chartTheme";

type Replay = {
  rebase: string;
  dates: string[];
  components: {
    code: string;
    label: string;
    weight: number;
    mode: string;
    index: number[];
    bls_index: number[];
  }[];
};

const MODES = [
  { key: "yoy", label: "YoY", domain: [-2, 6] },
  { key: "mom_ann", label: "MoM ann.", domain: [-2, 6] },
  { key: "vs_bls", label: "vs BLS", domain: [-3, 3] },
  { key: "d1", label: "1-Day Δ", domain: [-0.5, 0.5] },
  { key: "wow", label: "WoW Δ", domain: [-1, 1] },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

// blue → slate → amber → red, nowflation's -2%→6% ramp normalized to t∈[0,1]
const STOPS: [number, [number, number, number]][] = [
  [0.0, [37, 99, 235]],   // blue
  [0.25, [71, 85, 105]],  // slate ≈ 0
  [0.62, [217, 119, 6]],  // amber
  [1.0, [220, 38, 38]],   // red
];

function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (x - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(220,38,38)`;
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** mode value for component c at daily position i (arrays are a contiguous
 *  daily grid, so offsets are positions, not date math) */
function modeValue(
  c: Replay["components"][number],
  i: number,
  mode: ModeKey
): number | null {
  const ix = c.index;
  switch (mode) {
    case "yoy":
      return i >= 365 ? pct(ix[i], ix[i - 365]) : null;
    case "mom_ann":
      return i >= 30 ? (Math.pow(ix[i] / ix[i - 30], 12) - 1) * 100 : null;
    case "vs_bls": {
      if (i < 365) return null;
      return pct(ix[i], ix[i - 365]) - pct(c.bls_index[i], c.bls_index[i - 365]);
    }
    case "d1":
      return i >= 1 ? pct(ix[i], ix[i - 1]) : null;
    case "wow":
      return i >= 7 ? pct(ix[i], ix[i - 7]) : null;
  }
}

export function Treemap() {
  const [data, setData] = useState<Replay | null>(null);
  const [mode, setMode] = useState<ModeKey>("yoy");
  const [pos, setPos] = useState(-1); // month index; -1 = latest (set on load)
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/data/replay.json")
      .then((r) => r.json())
      .then((d: Replay) => setData(d))
      .catch(() => setData(null));
  }, []);

  // last daily position of each month — the scrubber steps months
  const monthEnds = useMemo(() => {
    if (!data) return [] as { month: string; i: number }[];
    const out: { month: string; i: number }[] = [];
    data.dates.forEach((d, i) => {
      const m = d.slice(0, 7);
      if (out.length && out[out.length - 1].month === m) out[out.length - 1].i = i;
      else out.push({ month: m, i });
    });
    return out;
  }, [data]);

  const at = pos === -1 ? monthEnds.length - 1 : pos;

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setPos((p) => {
        const cur = p === -1 ? 0 : p;
        if (cur >= monthEnds.length - 1) {
          setPlaying(false);
          return monthEnds.length - 1;
        }
        return cur + 1;
      });
    }, 250);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, monthEnds.length]);

  if (!data || !monthEnds.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading basket replay…
      </div>
    );
  }

  const { domain } = MODES.find((m) => m.key === mode)!;
  const frame = monthEnds[at];
  const values = data.components.map((c) => ({
    c,
    v: modeValue(c, frame.i, mode),
  }));
  const oursHeadline = values.every((x) => x.v !== null && mode === "yoy")
    ? values.reduce((s, x) => s + x.c.weight * (x.v as number), 0)
    : null;
  const blsHeadline =
    mode === "yoy" && frame.i >= 365
      ? data.components.reduce(
          (s, c) => s + c.weight * pct(c.bls_index[frame.i], c.bls_index[frame.i - 365]),
          0
        )
      : null;

  const option = {
    tooltip: {
      backgroundColor: C.card,
      borderColor: C.border,
      textStyle: { color: C.text, fontSize: 12 },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false as const,
        breadcrumb: { show: false },
        itemStyle: { borderColor: C.bg, borderWidth: 2, gapWidth: 2 },
        label: {
          color: "#fff",
          fontSize: 12,
          formatter: (p: { name: string }) => p.name,
        },
        data: values.map(({ c, v }) => ({
          name: `${c.label}\n${v === null ? "—" : `${v.toFixed(1)}%`}`,
          value: c.weight,
          itemStyle: {
            color:
              v === null
                ? "#2a3542"
                : ramp((v - domain[0]) / (domain[1] - domain[0])),
          },
        })),
      },
    ],
  };

  const chip = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
    background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
    color: active ? "var(--accent-sky)" : "var(--muted)",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            style={chip(mode === m.key)}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <EChart option={option} height={420} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
        <button style={chip(playing)} onClick={() => setPlaying(!playing)}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={monthEnds.length - 1}
          value={at}
          onChange={(e) => {
            setPlaying(false);
            setPos(Number(e.target.value));
          }}
          style={{ flex: 1, accentColor: "#38BDF8" }}
        />
        <span
          style={{
            color: "var(--accent-sky)",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {frame.month}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 6,
        }}
      >
        <span>tile area = basket weight · drag to replay 2018 → now</span>
        <span>
          Ours {oursHeadline === null ? "—" : `${oursHeadline.toFixed(2)}%`} · BLS{" "}
          {blsHeadline === null ? "—" : `${blsHeadline.toFixed(2)}%`}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the homepage.** In `site/src/app/page.tsx`, add `import { Treemap } from "@/components/Treemap";` and insert between the hero Section and the decomposition Section:

```tsx
      <Section title="Basket treemap — every component, replay 2018 → now">
        <Treemap />
      </Section>
```

- [ ] **Step 3: Build + exercise**

Run: `cd site && npm run build`
Expected: exit 0. Dev server: treemap loads after paint (lazy fetch), all 5 mode chips switch coloring, ▶ Play sweeps 2018→now, scrubber drags, footer shows Ours/BLS at the frame. Note: the treemap's `mom_ann`/`d1`/`wow` values on BLS-CF components are flat between prints by construction — expected, they carry the official print.

- [ ] **Step 4: Commit**

```bash
git add site/src/components/Treemap.tsx site/src/app/page.tsx
git commit -m "feat: basket treemap — five modes + play/scrub replay over replay.json"
```

---

### Task 14: `/methodology` page

**Files:**
- Create: `site/src/app/methodology/page.tsx`, `site/src/components/MethodologyInventory.tsx`

**Interfaces:**
- Consumes: `methodology.json` (Task 7 shape), `Section`, `fmtPct`/`fmtSigned`.
- Produces: the static `/methodology` route rendering the seven anatomy sections (spec §8).

- [ ] **Step 1: Create `site/src/components/MethodologyInventory.tsx`** (client — source filter chips):

```tsx
"use client";
import { useState } from "react";

type Row = {
  code: string;
  name: string;
  source: string;
  route: string;
  cadence: string;
  latest_obs: string | null;
  fresh: boolean;
};

export function MethodologyInventory({ rows }: { rows: Row[] }) {
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();
  const [filter, setFilter] = useState<string | null>(null);
  const shown = filter ? rows.filter((r) => r.source === filter) : rows;
  const chip = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
    background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
    color: active ? "var(--accent-sky)" : "var(--muted)",
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 12,
    cursor: "pointer",
  });
  const td: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button style={chip(filter === null)} onClick={() => setFilter(null)}>
          All ({rows.length})
        </button>
        {sources.map((s) => (
          <button key={s} style={chip(filter === s)} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
      </div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {shown.map((r) => (
              <tr key={r.code}>
                <td style={{ ...td, width: 14 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: r.fresh
                        ? "var(--accent-emerald)"
                        : "var(--accent-red)",
                    }}
                  />
                </td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {r.code}
                </td>
                <td style={td}>{r.name}</td>
                <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                  {r.source} · {r.route} · {r.cadence}
                </td>
                <td style={{ ...td, textAlign: "right", color: "var(--muted)", fontSize: 12 }}>
                  {r.latest_obs ?? "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `site/src/app/methodology/page.tsx`**:

```tsx
import methodology from "../../../public/data/methodology.json";
import { Section } from "@/components/Section";
import { MethodologyInventory } from "@/components/MethodologyInventory";
import { fmtSigned } from "@/lib/format";

const statChip: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 16px",
  minWidth: 130,
};
const td: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  borderBottom: "1px solid var(--border)",
  fontVariantNumeric: "tabular-nums",
};

export default function Methodology() {
  const s = methodology.stats;
  const v = methodology.validation as Record<
    string,
    { corr: number | null; mean_abs_gap_pp: number | null; window?: string }
  > & {
    bls_reconstruction: { weighted_bls_yoy_pct: number; official_yoy_pct: number };
  };
  const stats: [string, string][] = [
    ["Series", String(s.series_count)],
    ["Observations", s.obs_count.toLocaleString("en-US")],
    ["Sources", String(s.source_count)],
    ["Tracker corr", s.tracker_corr === null ? "—" : String(s.tracker_corr)],
    ["Live coverage", `${s.live_coverage_pct.toFixed(1)}%`],
    ["Engine", `v${s.engine_version} · ${s.rebase}`],
  ];
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Methodology{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          generated from config + live validation — never hand-written
        </span>
      </h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        {stats.map(([label, value]) => (
          <div key={label} style={statChip}>
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
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <Section title="How the gauge is built — five stages">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {methodology.stages.map((st) => (
            <div key={st.n} style={statChip}>
              <div style={{ color: "var(--accent-sky)", fontWeight: 700 }}>
                {st.n}. {st.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                {st.description}
              </div>
              {st.formula ? (
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    marginTop: 8,
                    color: "var(--accent-amber)",
                  }}
                >
                  {st.formula}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="The basket — 14 components">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {methodology.basket.map((b) => (
                <tr key={b.code}>
                  <td style={{ ...td, width: "30%" }}>{b.label}</td>
                  <td style={{ ...td, width: "25%" }}>
                    <div
                      style={{
                        background: "var(--accent-sky)",
                        opacity: 0.75,
                        height: 8,
                        borderRadius: 4,
                        width: `${Math.max(2, b.weight * 300)}px`,
                      }}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {(b.weight * 100).toFixed(1)}%
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        padding: "1px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        color: b.mode === "live" ? "var(--accent-emerald)" : "var(--muted)",
                      }}
                    >
                      {b.mode === "live" ? "LIVE" : "BLS-CF"}
                    </span>
                  </td>
                  <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>
                    {b.live_sources.length ? b.live_sources.join(" + ") : b.official_series}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtSigned(b.yoy_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Feed freshness">
        <div
          style={{
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.3)",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 14,
          }}
        >
          <span style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>
            {methodology.freshness.fresh_count} of {methodology.freshness.total}
          </span>{" "}
          series fresh within their staleness windows (
          {((methodology.freshness.fresh_count / methodology.freshness.total) * 100).toFixed(1)}
          %)
        </div>
      </Section>

      <Section title="Series inventory">
        <MethodologyInventory rows={methodology.inventory} />
      </Section>

      <Section title="Validation vs official CPI">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(["gauge", "tracker"] as const).map((name) => (
            <div key={name} style={statChip}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {name} · {v[name].window ?? ""}
              </div>
              <div style={{ fontSize: 15, marginTop: 4 }}>
                corr <b>{v[name].corr ?? "—"}</b> · mean abs gap{" "}
                <b>{v[name].mean_abs_gap_pp ?? "—"}pp</b>
              </div>
            </div>
          ))}
          <div style={statChip}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              BLS reconstruction check
            </div>
            <div style={{ fontSize: 15, marginTop: 4 }}>
              Σ wᵢ × BLS YoYᵢ = <b>{v.bls_reconstruction.weighted_bls_yoy_pct}%</b> vs
              official <b>{v.bls_reconstruction.official_yoy_pct}%</b>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Variants">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(methodology.variants).map(([name, desc]) => (
            <div key={name} style={{ ...statChip, flex: "1 1 300px" }}>
              <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{desc}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Limitations — read these">
        <ul style={{ margin: 0, paddingLeft: 20, color: "var(--muted)", fontSize: 14 }}>
          {methodology.limitations.map((l, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              {l}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Build + eyeball**

Run: `cd site && npm run build`
Expected: exit 0, `/methodology` in the export. Dev server: all seven sections render; inventory filter chips work; nav link from the shell reaches it.

- [ ] **Step 4: Commit**

```bash
git add site/src/app/methodology/page.tsx site/src/components/MethodologyInventory.tsx
git commit -m "feat: /methodology — stats chips, stage cards, basket, freshness, inventory, validation, limitations"
```

---

### Task 15: Final verification sweep

**Files:** none (verification only; fix-forward anything found).

- [ ] **Step 1: Full pipeline suite**

Run: `pytest -q 2>&1 | tee /tmp/task15-pytest.log`
Expected: 0 failures (~135 tests: 113 base + ~22 added).

- [ ] **Step 2: Site build + lint**

Run: `cd site && npm run build && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Browser smoke.** `npm run dev`; load `/` and `/methodology`. Checklist: hero has 4 series + legend + recession band and the sky line is sawtooth-free at the right edge; treemap plays through all 5 modes; gap chips + NEXT PRINT + link row correct; methodology sections populated with live numbers; zero console errors on both pages.

- [ ] **Step 4: Verify exit criteria against the spec** (`docs/superpowers/specs/2026-07-08-phase-1c-homepage-viz-design.md` §11) — walk each bullet, confirm or fix.

- [ ] **Step 5: Wrap up.** `git log --oneline origin/main..HEAD` — confirm the task commits are all present and the tree is clean (`git status`). Report the branch state to the user; pushing (→ Vercel deploy) is the user's call.

---

## Self-Review Notes (already applied)

- **Spec coverage:** §3→Tasks 1-2, §4→Tasks 9-10, §5→Tasks 3+11, §6→Tasks 5-6+13, §7→Tasks 4+12, §8→Tasks 7+14, §9→woven through, §10 ordering preserved, §11→Task 15.
- **Type consistency:** `gauge.run` result keys (`daily_index`, `official_daily_index`, `yoy`) named identically in Tasks 2/5/6/7; `replay.json` fields (`index`, `bls_index`, `dates`) identical in Tasks 6/13; `pulse.next_print` shape identical in Tasks 4/12; `methodology.json` blocks identical in Tasks 7/14.
- **Known cited-number caveat:** all real-store numbers drift daily; tests assert relations, evidence steps record fresh values.
