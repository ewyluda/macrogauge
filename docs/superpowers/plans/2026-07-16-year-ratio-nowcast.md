# Year-Ratio Power Nowcast (Wave 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couple wholesale power to the DC Ops index like-month-to-like-month (`year_ratio` transform, damped by pass-through λ), validated by an offline backtest gate before the config flip — plus the MISO weekend fix, deepened backfill, and two wave-4 entry tasks.

**Architecture:** A new pure `splice_year_ratio` in `pipeline/engine/blend.py` slots where `splice_anchored` slots in `dcindex.run`'s component loop, selected per component by new `dc_basket` config keys. Data plumbing (MISO catch-up window, 2024-07 backfill) feeds an offline backtest script whose graded table decides whether the final commit — the config flip — happens. Publish/site changes are dormant until the flip (nowcast fields appear only when the tail is active).

**Tech Stack:** Python 3.12 pipeline (stdlib only — no new deps), pytest, JSON Schema, Next.js static site (TypeScript), vitest/Playwright already configured.

**Spec:** `docs/superpowers/specs/2026-07-16-year-ratio-nowcast-design.md` (approved 2026-07-16).

## Global Constraints

- **Run tests with `.venv/bin/pytest`** — system `python3` is 3.9 and cannot import the pipeline (PEP 604 unions). Scripts run with `.venv/bin/python`.
- Baseline: **436 passed** (`.venv/bin/pytest -q`). Every task ends with the full suite green at ≥ its predecessor's count.
- **Zero new series/sources**: registry pins stay 26 sources / 269 series. Do not touch `config/series.json`.
- **HTTP is injected, never real.** Tests pass fake `http_get`; fixtures from `tests/fixtures/` or built in-test. Never add a test that hits the network.
- **Verbatim evidence:** every RED/GREEN run is captured with `2>&1 | tee /private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/d9a85bbf-530e-4fbe-837b-90ffd983d619/scratchpad/<task>-<red|green>.log`. Reviewers run forensic checks on pytest headers/counts; report only observed numbers.
- Do NOT edit `.superpowers/sdd/progress.md` (controller-owned). Do NOT `git push` (push = production deploy; requires the user's explicit approval).
- The **config flip (Task 11) is gated** on the Task 10 backtest verdict (spec §6). Tasks 1–9 must not activate anything: `config/dc_basket.json` stays untouched until Task 11.
- Store rows are immutable; backfill appends via the normal connectors + `vintage.append` (value-dedupe makes re-runs no-ops). Never rewrite a committed partition.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Loader — `year_ratio` config keys + validation matrix + blend dedup

**Files:**
- Modify: `pipeline/dc_basket.py` (DCComponent ~line 18–31; `load_baskets` validation ~line 49–70)
- Test: `tests/test_dc_basket.py`

**Interfaces:**
- Produces: `DCComponent.live_proxy_transform: str` (default `"level"`), `DCComponent.live_proxy_passthrough: float | None` (default `None`). Task 3 reads both; Task 8 reads both in `power_block`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_dc_basket.py`:

```python
def test_year_ratio_requires_blend_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="year_ratio"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})


def test_year_ratio_requires_smooth_days_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_smooth_days"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_year_ratio_requires_passthrough_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio"}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_passthrough_without_year_ratio_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="live_proxy_passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


@pytest.mark.parametrize("lam", [0.0, -0.5, 1.5])
def test_passthrough_out_of_range_rejected(tmp_path, lam):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": lam}],
               OK_OPS)
    with pytest.raises(ValueError, match="passthrough"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_unknown_transform_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "sorcery"}],
               OK_OPS)
    with pytest.raises(ValueError, match="transform"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_duplicate_blend_codes_rejected(tmp_path):
    # wave-4 final-review entry task: dup hubs would double-weight in hub_mean
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b", "s_b"]}],
               OK_OPS)
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p", "s_h"})


def test_year_ratio_valid_config_loads(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0, "live_proxy_blend": ["s_b", "s_c"],
                 "live_proxy_smooth_days": 7,
                 "live_proxy_transform": "year_ratio",
                 "live_proxy_passthrough": 0.5}],
               OK_OPS)
    _, baskets = dc_basket.load_baskets(
        p, registry_codes={"s_a", "s_b", "s_c", "s_p", "s_h"})
    comp = baskets["build"][0]
    assert comp.live_proxy_transform == "year_ratio"
    assert comp.live_proxy_passthrough == 0.5


def test_default_transform_is_level(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a",
                 "weight": 1.0}],
               OK_OPS)
    _, baskets = dc_basket.load_baskets(p, registry_codes={"s_a", "s_p", "s_h"})
    assert baskets["build"][0].live_proxy_transform == "level"
    assert baskets["build"][0].live_proxy_passthrough is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_dc_basket.py -q 2>&1 | tee <scratchpad>/task1-red.log`
Expected: the new tests FAIL (`TypeError: DCComponent.__init__() got an unexpected keyword argument` is NOT expected — they fail because `load_baskets` silently ignores the new JSON keys, so no ValueError is raised and `live_proxy_transform` doesn't exist: `AttributeError`/`Failed: DID NOT RAISE`). Existing 13 tests still pass.

- [ ] **Step 3: Implement.** In `pipeline/dc_basket.py`, extend the dataclass:

```python
@dataclass(frozen=True)
class DCComponent:
    code: str                   # internal component id, e.g. "switchgear"
    label: str                  # display label
    group: str                  # display rollup key ("labor", "materials", ...)
    series: str                 # store series code of the monthly backbone
    weight: float               # share of its basket; each basket sums to 1.0
    live_proxy: str | None = None  # store series code of the daily proxy, if any
    live_proxy_blend: tuple[str, ...] | None = None  # multiple same-concept
        # daily proxies (e.g. wholesale power hubs), mutually exclusive with
        # live_proxy — hub_mean'd then trailing-smoothed before splicing
    live_proxy_smooth_days: int | None = None  # trailing_mean window over
        # the blended proxy; only meaningful (and only allowed) with a blend
    live_proxy_transform: str = "level"  # how the proxy meets the backbone:
        # "level" = splice_anchored; "year_ratio" = like-month coupling
        # (wave-4b spec §3) — wholesale seasonality must never enter via a
        # level splice (the wave-4 +52% incident)
    live_proxy_passthrough: float | None = None  # λ in (0, 1]: share of the
        # wholesale like-month move retail inherits; required by and
        # exclusive to "year_ratio"
```

In `load_baskets`'s per-component loop, after the existing `blend`/`smooth_days` checks (keep those), add:

```python
            transform = c.get("live_proxy_transform", "level")
            passthrough = c.get("live_proxy_passthrough")
            if transform not in ("level", "year_ratio"):
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: unknown "
                    f"live_proxy_transform {transform!r}")
            if transform == "year_ratio":
                if not blend:
                    raise ValueError(
                        f"dc_basket {name}/{c['code']}: year_ratio requires "
                        f"live_proxy_blend")
                if smooth_days is None:
                    raise ValueError(
                        f"dc_basket {name}/{c['code']}: year_ratio requires "
                        f"live_proxy_smooth_days")
                if passthrough is None:
                    raise ValueError(
                        f"dc_basket {name}/{c['code']}: year_ratio requires "
                        f"live_proxy_passthrough")
                if not 0 < passthrough <= 1:
                    raise ValueError(
                        f"dc_basket {name}/{c['code']}: live_proxy_passthrough "
                        f"{passthrough} outside (0, 1]")
            elif passthrough is not None:
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: live_proxy_passthrough "
                    f"requires live_proxy_transform=year_ratio")
            if blend and len(set(blend)) != len(blend):
                raise ValueError(
                    f"dc_basket {name}/{c['code']}: duplicate codes in "
                    f"live_proxy_blend")
```

and pass the two new fields into the `DCComponent(...)` constructor call:

```python
                live_proxy_smooth_days=smooth_days,
                live_proxy_transform=transform,
                live_proxy_passthrough=passthrough))
```

Update the module docstring's last sentence to mention the transform selector (one sentence, match existing tone).

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dc_basket.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task1-green.log`
Expected: all pass; full suite ≥ 446 (436 + 10 new, one parametrized ×3).

- [ ] **Step 5: Commit**

```bash
git add pipeline/dc_basket.py tests/test_dc_basket.py
git commit -m "feat(dc): year_ratio transform config keys + loader validation matrix"
```

---

### Task 2: Engine — `splice_year_ratio` (+ the wave-4 seasonality regression test)

**Files:**
- Modify: `pipeline/engine/blend.py` (append after `trailing_mean`, ~line 123)
- Test: `tests/test_blend.py`

**Interfaces:**
- Produces: `splice_year_ratio(official: dict[str, float], live: dict[str, float], passthrough: float, tolerance_days: int = 7) -> dict[str, float]`. Task 3 calls it from `dcindex.run`; Task 7's backtest script calls it directly.
- Consumes: nothing new (stdlib `bisect`).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_blend.py`:

```python
def test_year_ratio_worked_example():
    # Hand-computed (spec §3, λ=0.5, tolerance 7d):
    # T0=2026-04-01. model(T0): official_ffill(2025-04-01)=100,
    #   W(t0)→2026-03-29=44 (3d), W(t0-365d)→2025-03-30=40 (2d)
    #   m0 = 100*(1+0.5*(44/40-1)) = 105; anchor = 110/105
    # t=2026-07-10: official_ffill(2025-07-10)=100 (ffill from 2025-04-01),
    #   W(t)=60, W(t-365d)→2025-07-08=50 (2d)
    #   model = 100*(1+0.5*(60/50-1)) = 110 → tail = 110*110/105
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-08": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert out["2025-04-01"] == 100.0 and out["2026-04-01"] == 110.0
    assert out["2026-07-10"] == pytest.approx(110.0 * 110.0 / 105.0)
    # live points at/before the anchor never enter the output
    assert "2026-03-29" not in out and "2025-03-30" not in out


def test_year_ratio_cancels_seasonality_where_level_splice_explodes():
    """The wave-4 regression pin: flat retail + a wholesale series that swings
    20→55 $/MWh every summer (the observed ~2.8x). splice_anchored maps the
    seasonal rise onto the flat tail (+175% spurious); splice_year_ratio
    compares summer to LAST summer and stays flat."""
    official = {}
    for y, m in [(y, m) for y in (2025, 2026) for m in range(1, 13)]:
        d = f"{y}-{m:02d}-01"
        if d <= "2026-04-01":
            official[d] = 100.0
    live = {}
    for y in (2025, 2026):
        for m in range(1, 13):
            for day in (1, 8, 15, 22):
                d = f"{y}-{m:02d}-{day:02d}"
                if "2025-01-01" <= d <= "2026-07-08":
                    live[d] = 55.0 if m in (6, 7, 8) else 20.0
    exploded = blend.splice_anchored(official, live)
    assert max(v for d, v in exploded.items() if d > "2026-04-01") > 200.0
    honest = blend.splice_year_ratio(official, live, passthrough=1.0)
    tail = {d: v for d, v in honest.items() if d > "2026-04-01"}
    assert tail  # the tail exists…
    for v in tail.values():
        assert v == pytest.approx(100.0)  # …and is flat: seasonality cancelled


def test_year_ratio_tolerance_skips_unbridgeable_dates():
    # W(t-365d) nearest obs is 9 days old -> that tail date is skipped
    # (never fabricate); the anchor (2d/3d gaps) is unaffected.
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-01": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert "2026-07-10" not in out            # 2025-07-10 lookup gap = 9d
    assert max(out) == "2026-04-01"


def test_year_ratio_no_anchor_returns_official_only():
    # no W obs within tolerance at/before T0 -> dormant, official untouched
    # (mirrors splice_anchored's no-overlap edge)
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2026-07-08": 50.0, "2026-07-10": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert out == official and out is not official


def test_year_ratio_lambda_zero_repeats_last_years_shape():
    # λ=0: model(t) = official_ffill(t-365d); NOT flat carry-forward —
    # the tail replays last year's official shape, anchor-scaled at T0.
    official = {"2025-04-01": 100.0, "2025-06-01": 104.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-06-05": 50.0,
            "2026-03-29": 44.0, "2026-06-05": 60.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.0000001)
    # (λ→0 limit; exact 0 is rejected by the loader, the engine accepts any λ)
    # m0 ≈ 100, anchor ≈ 1.1; t=2026-06-05: official_ffill(2025-06-05)=104
    assert out["2026-06-05"] == pytest.approx(104.0 * 1.1, rel=1e-4)


def test_year_ratio_negative_or_zero_denominator_skips():
    # negative smoothed wholesale is real (curtailment) but a ratio against
    # it is meaningless -> skip the date, keep the rest of the tail
    official = {"2025-04-01": 100.0, "2026-04-01": 110.0}
    live = {"2025-03-30": 40.0, "2025-07-08": -5.0, "2025-08-05": 50.0,
            "2026-03-29": 44.0, "2026-07-10": 60.0, "2026-08-07": 55.0}
    out = blend.splice_year_ratio(official, live, passthrough=0.5)
    assert "2026-07-10" not in out            # W(2025-07-10)→-5.0: skipped
    assert "2026-08-07" in out                # healthy neighbor still splices


def test_year_ratio_edges():
    official = {"2025-04-01": 100.0}
    assert blend.splice_year_ratio(official, {}, 0.5) == official
    assert blend.splice_year_ratio({}, {"2026-01-01": 5.0}, 0.5) == {}
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_blend.py -q 2>&1 | tee <scratchpad>/task2-red.log`
Expected: new tests ERROR with `AttributeError: module 'pipeline.engine.blend' has no attribute 'splice_year_ratio'`; the 22 existing tests pass.

- [ ] **Step 3: Implement** — append to `pipeline/engine/blend.py` (add `import bisect` to the imports at top):

```python
def _at_or_before(dates: list[str], target: str,
                  tolerance_days: int | None = None) -> str | None:
    """Latest date in sorted `dates` at/before `target`; None when none
    exists or the nearest is more than tolerance_days older than target."""
    i = bisect.bisect_right(dates, target) - 1
    if i < 0:
        return None
    d = dates[i]
    if tolerance_days is not None:
        gap = (date.fromisoformat(target) - date.fromisoformat(d)).days
        if gap > tolerance_days:
            return None
    return d


def splice_year_ratio(official: dict[str, float], live: dict[str, float],
                      passthrough: float,
                      tolerance_days: int = 7) -> dict[str, float]:
    """Official everywhere it exists; after the last print T0, a like-month
    year-ratio nowcast tail:

        model(t) = official_ffill(t-365d) * (1 + passthrough*(W(t)/W(t-365d) - 1))
        tail(t)  = model(t) * official(T0)/model(T0)

    Contrast splice_anchored(): a LEVEL splice imports the proxy's own
    seasonality into the tail — wholesale power swings ~2.8x spring→summer
    while tariff-smoothed retail is seasonally flat, which exploded ops YoY
    +6.2→+52.3% (wave-4 §10). The year ratio compares W to itself a year ago,
    so seasonality divides out by construction; `passthrough` (λ) states how
    much of the remaining like-month wholesale move retail inherits. The
    residual anchor at T0 keeps the tail continuous at the print and
    re-anchors every print — correcting one month of model error, never a
    seasonal gap.

    Never fabricate: W lookups take the nearest obs at/before the target
    within tolerance_days; official year-ago lookups forward-fill the sparse
    monthly backbone with no tolerance (monthly cadence is that series' own
    resolution). A tail date whose lookups fail — or whose W denominator or
    model value is non-positive (negative smoothed wholesale is real) — is
    skipped; when the anchor itself can't be built, official returns alone."""
    if not official or not live:
        return dict(official)
    t0 = max(official)
    off_dates, live_dates = sorted(official), sorted(live)

    def model(t: str) -> float | None:
        base_date = (date.fromisoformat(t) - timedelta(days=365)).isoformat()
        ob = _at_or_before(off_dates, base_date)
        wt = _at_or_before(live_dates, t, tolerance_days)
        wb = _at_or_before(live_dates, base_date, tolerance_days)
        if ob is None or wt is None or wb is None or live[wb] <= 0:
            return None
        return official[ob] * (1.0 + passthrough * (live[wt] / live[wb] - 1.0))

    m0 = model(t0)
    if m0 is None or m0 <= 0:
        return dict(official)
    anchor = official[t0] / m0
    out = dict(official)
    for t in live_dates:
        if t <= t0:
            continue
        m = model(t)
        if m is not None and m > 0:
            out[t] = m * anchor
    return out
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_blend.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task2-green.log`
Expected: all pass; full suite ≥ 453.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/blend.py tests/test_blend.py
git commit -m "feat(engine): splice_year_ratio — like-month wholesale coupling + wave-4 seasonality regression pin"
```

---

### Task 3: dcindex wiring — transform selection + `implied_level` passthrough

**Files:**
- Modify: `pipeline/engine/dcindex.py` (`run`, ~lines 44–98)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: `blend_mod.splice_year_ratio` (Task 2), `comp.live_proxy_transform` / `comp.live_proxy_passthrough` (Task 1).
- Produces: `dc_result["indexes"][name]["components"][code]` gains key `"implied_level"` (float | None — raw-unit nowcast level at the component's own last obs; None unless the tail is active). Task 8's `power_block` reads it.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_dcindex.py`:

```python
YR_OPS = [
    {"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us",
     "weight": 1.0, "live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"],
     "live_proxy_smooth_days": 1, "live_proxy_transform": "year_ratio",
     "live_proxy_passthrough": 0.5},
]
YR_HUB_ROWS = [(h, d, v)
               for h in ("caiso_sp15_da", "miso_indiana_da")
               for d, v in [("2016-12-30", 40.0), ("2017-12-30", 40.0),
                            ("2018-01-03", 44.0)]]


def test_year_ratio_component_worked_example(tmp_path):
    # retail flat at 10.0 (rebased idx 100 everywhere); hubs +10% like-month.
    # T0=2018-01-01: W(t0)→2017-12-30=40, W(t0-365d)→2016-12-30=40 (leap:
    # 2018-01-01-365d = 2017-01-01), official_ffill=100 → m0=100, anchor=1.
    # t=2018-01-03: W=44, W(2017-01-03)→2016-12-30=40, λ=0.5 →
    # idx = 100*(1+0.5*0.1) = 105; own-obs YoY vs filled 2017-01-03 = +5%.
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 10.0),
        ("eia_elec_ind_us", "2018-01-01", 10.0),
    ] + YR_HUB_ROWS
    basket = write_basket(tmp_path, TWO_COMP_BUILD, YR_OPS)
    conn = make_conn(tmp_path, rows)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["components"]["power"]["mode"] == "official+proxy"
    assert ops["index"]["2018-01-03"] == pytest.approx(105.0)
    assert ops["components"]["power"]["yoy_pct"] == pytest.approx(5.0)
    # implied_level: raw retail at T0 (10.0) x idx(end)/idx(T0) = 10.5 ¢/kWh
    assert ops["components"]["power"]["implied_level"] == pytest.approx(10.5)
    assert ops["gate_flags"] == []


def test_year_ratio_dormant_without_anchor_coverage(tmp_path):
    # hubs have no obs within tolerance of T0 -> official only, no tail mode
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 10.0),
        ("eia_elec_ind_us", "2018-01-01", 10.0),
        ("caiso_sp15_da", "2018-01-10", 50.0),
        ("miso_indiana_da", "2018-01-10", 52.0),
    ]
    basket = write_basket(tmp_path, TWO_COMP_BUILD, YR_OPS)
    conn = make_conn(tmp_path, rows)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["components"]["power"]["mode"] == "official"
    assert ops["components"]["power"]["implied_level"] is None
    assert max(ops["index"]) == "2018-01-01"


def test_year_ratio_tail_still_gated_on_arrival(tmp_path):
    # a just-arrived >5% smoothed-ratio move is held one day, same gate as level
    rows = BUILD_ROWS + [
        ("eia_elec_ind_us", "2017-01-01", 10.0),
        ("eia_elec_ind_us", "2018-01-01", 10.0),
    ] + [(h, d, v) for h in ("caiso_sp15_da", "miso_indiana_da")
         for d, v in [("2016-12-30", 40.0), ("2017-12-30", 40.0),
                      ("2018-01-03", 50.0)]]   # +25% ratio, λ=0.5 → +12.5%
    basket = write_basket(tmp_path, TWO_COMP_BUILD, YR_OPS)
    conn = make_conn(tmp_path, rows,
                     vintages={("caiso_sp15_da", "2018-01-03"): "2018-01-03"})
    result = dcindex.run(conn, today="2018-01-03", basket_path=basket)
    ops = result["indexes"]["ops"]
    assert ops["index"]["2018-01-03"] == pytest.approx(100.0)  # held
    assert ops["gate_flags"] == ["power@2018-01-03"]


def test_level_components_unchanged_report_no_implied_level(tmp_path):
    # copper's level-splice behavior is untouched; implied_level exists on
    # every component entry and is populated for an active level tail too
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0, "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-01-01", 100.0), ("ppi_copper_wire", "2018-01-01", 100.0),
        ("fmp_copper", "2018-01-01", 50.0), ("fmp_copper", "2018-01-05", 55.0),
    ] + OPS_ROWS
    basket = write_basket(tmp_path, build, ONE_COMP_OPS,
                          hardware=[{"code": "hw", "label": "HW", "group": "compute",
                                     "series": "ppi_copper_wire", "weight": 1.0}])
    conn = make_conn(tmp_path, rows)
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["index"]["2018-01-05"] == pytest.approx(110.0)   # unchanged math
    assert b["components"]["copper_wire"]["implied_level"] == pytest.approx(110.0)
    # ops power rides official only -> None
    assert result["indexes"]["ops"]["components"]["power"]["implied_level"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_dcindex.py -q 2>&1 | tee <scratchpad>/task3-red.log`
Expected: 4 new tests FAIL (`KeyError: 'implied_level'` / wrong index values because year_ratio config currently routes through the level splice). All existing tests pass (Task 1 made the config keys loadable).

- [ ] **Step 3: Implement.** In `pipeline/engine/dcindex.py` `run()`:

(a) keep a handle on the raw official series — change the top of the component loop:

```python
        built, flags, modes, officials = {}, [], {}, {}
        for comp in comps:
            official = _series(conn, comp.series)
            officials[comp.code] = official
```

(b) replace the `if live:` splice block (currently `live_idx = rebase...; idx = splice_anchored(...)` after `official_end = max(idx)`) with transform selection:

```python
            tail_active = False
            if live:
                official_end = max(idx)
                if comp.live_proxy_transform == "year_ratio":
                    # the ratio W(t)/W(t-365d) is scale-invariant: W stays
                    # raw, no rebase — rebasing would change nothing but
                    # obscure the audit trail
                    idx = blend_mod.splice_year_ratio(
                        idx, live, comp.live_proxy_passthrough)
                else:
                    live_idx = rebase.rebase(live, base_month)
                    idx = blend_mod.splice_anchored(idx, live_idx)
                last = max(idx)
                tail_active = last > official_end
```

(everything below — the gate comment and `if tail_active:` gate application — is unchanged.)

(c) in the `components` assembly loop, compute the implied raw-unit level:

```python
        for c in comps:
            own_end = max(d for d in built[c.code] if d <= end)
            implied = None
            if modes[c.code] == "official+proxy":
                raw = officials[c.code]
                t0 = max(raw)
                s = built[c.code]
                if s.get(t0):
                    # tail nowcast restated in the backbone's own units:
                    # raw(T0) x idx(own_end)/idx(T0) — power_block publishes
                    # it as implied ¢/kWh (spec §8)
                    implied = raw[t0] * s[own_end] / s[t0]
            components[c.code] = {
                "label": c.label, "group": c.group, "weight": c.weight,
                "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "last_obs": own_end,
                "implied_level": implied}
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dcindex.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task3-green.log`
Expected: all pass; full suite ≥ 457. (`pipeline/publish/datacenter.py` builds its component dicts field-by-field, so the extra engine key publishes nothing yet — pinned again in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): dcindex year_ratio wiring + implied_level on components"
```

---

### Task 4: MISO catch-up window — weekend market days finally get fetched

**Files:**
- Modify: `pipeline/connectors/miso.py`
- Test: `tests/test_miso.py`

**Interfaces:**
- Produces: `miso.fetch(source_ids, vintage_date=None, http_get=None, market_date=None)` — same signature; NEW behavior: `market_date=None` fetches a 4-day window ending yesterday-ET (oldest first) instead of a single day. Explicit `market_date` fetches exactly that day (backfill path unchanged).
- Consumes: nothing new. `collect._miso` needs no change (it passes no `market_date`).

**Context for the implementer:** the store is missing ALL 56 Saturdays/Sundays since 2026-01-01. MISO's DA market runs every day (the connector docstring says so); the holes come from (a) the weekday-only bot never running on the days Fri/Sat files appear and (b) the backfill script's weekday skip (fixed in Task 5). With a 4-day window, Monday's run covers Thu–Sun. `vintage.append`'s value-dedupe makes the 3 re-fetched days no-ops.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_miso.py`:

```python
def test_default_window_fetches_last_four_days_oldest_first(monkeypatch):
    # Monday 8:40 ET: the weekday-only bot must catch up Thu..Sun market
    # days (Fri/Sat files appear on days the bot never runs).
    urls = []
    def get(url, timeout=None):
        urls.append(url)
        return _R(_csv([_row("INDIANA.HUB", "LMP", [10.0] * 24)]))
    monkeypatch.setattr(miso, "today_et", lambda: "2026-07-13")  # a Monday
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-13", http_get=get)
    days = [u.rsplit("/", 1)[1][:8] for u in urls]
    assert days == ["20260709", "20260710", "20260711", "20260712"]
    assert [o.obs_date for o in obs] == [
        "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"]
    assert all(o.value == pytest.approx(10.0) for o in obs)


def test_window_404_day_skipped_others_land(monkeypatch):
    def get(url, timeout=None):
        if "20260711" in url:
            return _R("", status_code=404)
        return _R(_csv([_row("INDIANA.HUB", "LMP", [10.0] * 24)]))
    monkeypatch.setattr(miso, "today_et", lambda: "2026-07-13")
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-13", http_get=get)
    assert [o.obs_date for o in obs] == [
        "2026-07-09", "2026-07-10", "2026-07-12"]


def test_explicit_market_date_fetches_exactly_one_day():
    urls = []
    def get(url, timeout=None):
        urls.append(url)
        return _R(_csv([_row("INDIANA.HUB", "LMP", [10.0] * 24)]))
    obs = miso.fetch(["INDIANA.HUB"], vintage_date="2026-07-15",
                     market_date="2026-07-14", http_get=get)
    assert len(urls) == 1 and "20260714" in urls[0]
    assert [o.obs_date for o in obs] == ["2026-07-14"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_miso.py -q 2>&1 | tee <scratchpad>/task4-red.log`
Expected: the two window tests FAIL (only one URL fetched); the explicit-date test passes already (it pins the contract Task 5 relies on). All 7 existing tests pass.

- [ ] **Step 3: Implement.** In `pipeline/connectors/miso.py`, add a constant near `ROW_RANGE`:

```python
CATCHUP_DAYS = 4   # default window: yesterday back 4 market days, so the
                   # weekday-only 8:40 ET bot picks up Fri/Sat/Sun files on
                   # Monday — value-dedupe makes the 3 re-fetches no-ops
```

Refactor `fetch` — hoist the existing single-day body (from `url = URL.format(...)` through the `out` loop) into a private helper, then loop:

```python
def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, market_date: str | None = None) -> list[Observation]:
    """source_id = the exact hub label in the Node column (e.g. INDIANA.HUB).

    market_date=None fetches a CATCHUP_DAYS window ending yesterday-ET
    (oldest first): today's file is posted the evening before, so yesterday
    is the newest reliably-available date, and the window heals the weekend
    market days a weekday-only schedule never lands on. An explicit
    market_date fetches exactly that day (the backfill path)."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    if market_date:
        days = [market_date]
    else:
        anchor = date.fromisoformat(today_et())
        days = [(anchor - timedelta(days=k)).isoformat()
                for k in range(CATCHUP_DAYS, 0, -1)]
    out: list[Observation] = []
    for day in days:
        out.extend(_fetch_day(source_ids, day, vintage, http_get))
    return out


def _fetch_day(source_ids: list[str], day: str, vintage: str,
               http_get) -> list[Observation]:
    url = URL.format(d=day.replace("-", ""))
    resp = http_get(url, timeout=60)
    if getattr(resp, "status_code", 200) == 404:
        return []
    resp.raise_for_status()
    # …(the existing parse/validate/Observation body, verbatim, using
    # `day` and `vintage`)…
```

Delete `_yesterday_et()` (now inlined via the window). Keep every drift check byte-identical.

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_miso.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task4-green.log`
Expected: 10 pass in the file; full suite ≥ 460. (`tests/test_run_daily.py` wires a fake for the MISO URL prefix — the window means up to 4 requests hit that fake; if its fake asserts a single specific date, extend the fake to answer any `YYYYMMDD_da_expost_lmp.csv` date. Check before assuming.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/connectors/miso.py tests/test_miso.py
git commit -m "fix(miso): 4-day catch-up window — weekend market days were never fetched"
```

---

### Task 5: Backfill script — weekends included, 2024-07 depth, source selection

**Files:**
- Modify: `scripts/backfill_power.py`

**Interfaces:**
- Produces: CLI flags `--to-date YYYY-MM-DD` (default: yesterday) and `--sources caiso,miso` (default both). MISO weekday skip removed. Task 6 runs it.
- Consumes: `miso.fetch(..., market_date=ds)` single-day contract (pinned by Task 4's `test_explicit_market_date_fetches_exactly_one_day`).

House precedent: scripts are controller-executed with tee'd logs, not unit-tested — the connectors they call are the tested surface. No test file for this task; the full suite still runs as the regression gate.

- [ ] **Step 1: Implement.** In `scripts/backfill_power.py`:

(a) argparse additions after `--from-date`:

```python
    parser.add_argument("--to-date", default=None,
                        help="last market date to fetch (default: yesterday)")
    parser.add_argument("--sources", default="caiso,miso",
                        help="comma list: caiso,miso (weekend repair = miso only)")
```

(b) replace `end = date.today() - timedelta(days=1)` with:

```python
    end = (date.fromisoformat(args.to_date) if args.to_date
           else date.today() - timedelta(days=1))
    wanted = {s.strip() for s in args.sources.split(",")}
```

(c) guard the CAISO block with `if "caiso" in wanted:` and replace the MISO block's weekday condition — the diff:

```python
        # MISO's DA market runs every day, weekends included; a 404 inside
        # fetch is the only calendar signal (the old weekday skip here is
        # what punched the 56 Sat/Sun holes the store carried into wave 4b)
        if "miso" in wanted:
            try:
                obs = miso.fetch(list(miso_map), market_date=ds)
```

(sleep lines stay inside their respective guards; keep the `caiso_map`/`miso_map` construction unconditional.)

(d) update the module docstring: usage now shows the two runs Task 6 executes, and the "Scope" paragraph gains one sentence: "Wave 4b deepens the window to 2024-07-01 — the year-ratio transform needs W(t−365d), and the backtest gate (spec §6) grades ~10 realized prints."

- [ ] **Step 2: Sanity-run help + full suite**

Run: `.venv/bin/python scripts/backfill_power.py --help && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task5-green.log`
Expected: help shows the new flags; suite count unchanged from Task 4.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill_power.py
git commit -m "feat(scripts): power backfill — weekends included, --to-date/--sources for 2024-07 depth"
```

---

### Task 6 (CONTROLLER, not a subagent): execute the backfill + commit the data

**Files:**
- Modify (data only): `store/obs/2026-07.jsonl` (all rows land in the current vintage partition)

- [ ] **Step 1: Deep backfill 2024-07-01 → 2025-12-31** (both sources; ~550 MISO files at ≥1 s + ~549 CAISO windows at ≥5 s ≈ 60–70 min — run in background):

```bash
.venv/bin/python scripts/backfill_power.py --store store \
  --from-date 2024-07-01 --to-date 2025-12-31 \
  2>&1 | tee <scratchpad>/backfill-deep.log
```

- [ ] **Step 2: MISO weekend repair 2026-01-01 → yesterday** (MISO only; weekday re-fetches dedupe to no-ops):

```bash
.venv/bin/python scripts/backfill_power.py --store store \
  --from-date 2026-01-01 --sources miso \
  2>&1 | tee <scratchpad>/backfill-weekend-repair.log
```

- [ ] **Step 3: Verify coverage** (the same probe used in design exploration):

```bash
for s in caiso_sp15_da miso_indiana_da; do echo "== $s"; \
grep -h "\"$s\"" store/obs/*.jsonl | .venv/bin/python -c "
import sys, json
rows = {json.loads(l)['obs_date'] for l in sys.stdin}
dates = sorted(rows)
print(len(rows), dates[0], '..', dates[-1])
"; done
```

Expected: both series start 2024-07-01; MISO's count within a few days of CAISO's (weekend holes gone; scattered single-day gaps from source-side misses are acceptable — the transform's tolerance handles them). Investigate before committing if either series is missing >2% of days in any month (retention edge or throttling — rerun the window; a persistent hole gets recorded in the spec §10 notes).

- [ ] **Step 4: Commit the data**

```bash
git add store/obs
git commit -m "data: power hub backfill to 2024-07 (weekends included) + MISO weekend repair"
```

---

### Task 7: Backtest harness + grading-math unit tests

**Files:**
- Create: `scripts/backtest_power_yearratio.py`
- Test: `tests/test_backtest_power.py`

**Interfaces:**
- Consumes: `blend.splice_year_ratio` (Task 2), `blend.hub_mean`/`trailing_mean`, `vintage.load`/`latest`.
- Produces: importable `grade_month(official, w_smoothed, target, lam) -> tuple[float, float] | None` and `month_shift(d, months) -> str`; CLI `--store` printing the per-λ table + §6 verdict. Task 10 runs it.

- [ ] **Step 1: Write the failing tests** — create `tests/test_backtest_power.py`:

```python
"""Grading math for the wave-4b backtest gate (spec §6) — this script
decides a production config flip, so its arithmetic is test-pinned."""
import importlib.util
import pathlib

import pytest

_spec = importlib.util.spec_from_file_location(
    "backtest_power_yearratio",
    pathlib.Path(__file__).parent.parent / "scripts" / "backtest_power_yearratio.py")
bt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt)

# Hand-computed fixture (grading t = 2026-02-15, retail cutoff t-75d =
# 2025-12-02 → T0 = 2025-11-01):
#   anchor: W(T0)→2025-10-30=30, W(T0-365d)→2024-10-30=30,
#           official_ffill(2024-11-01)=10.0 → m0 = 10.0, anchor = 1.0
#   tail 2026-02-10: W=36, W(2025-02-10)→2025-02-08=30,
#           official_ffill(2025-02-10)=10.0, λ=0.5 → nowcast = 11.0
#   realized 2026-02 = 10.4, base 2025-02 = 10.0
#   err = (11.0-10.4)/10.0*100 = +6.0 YoY pts
#   carry-forward = (10.0-10.4)/10.0*100 = -4.0 YoY pts
OFFICIAL = {"2024-11-01": 10.0, "2025-02-01": 10.0,
            "2025-11-01": 10.0, "2026-02-01": 10.4}
W = {"2024-10-30": 30.0, "2025-02-08": 30.0,
     "2025-10-30": 30.0, "2026-02-10": 36.0}


def test_month_shift():
    assert bt.month_shift("2026-02-01", -12) == "2025-02-01"
    assert bt.month_shift("2025-01-01", -12) == "2024-01-01"


def test_grade_month_hand_computed():
    err, cf = bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5)
    assert err == pytest.approx(6.0)
    assert cf == pytest.approx(-4.0)


def test_grade_month_masks_wholesale_after_grading_date():
    # an obs after the grading date (t = 2026-02-15) must not exist yet
    w = {**W, "2026-02-20": 999.0}
    assert bt.grade_month(OFFICIAL, w, "2026-02-01", lam=0.5) == \
        pytest.approx(bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5))


def test_grade_month_honors_retail_availability_lag():
    # a print inside the 75d embargo (2026-01-01 print, cutoff 2025-12-02)
    # must not become the anchor, however tempting
    official = {**OFFICIAL, "2026-01-01": 20.0}
    assert bt.grade_month(official, W, "2026-02-01", lam=0.5) == \
        pytest.approx(bt.grade_month(OFFICIAL, W, "2026-02-01", lam=0.5))


def test_grade_month_missing_coverage_returns_none():
    # no W near the anchor -> ungraded month, never a zero-filled row
    w = {"2026-02-10": 36.0}
    assert bt.grade_month(OFFICIAL, w, "2026-02-01", lam=0.5) is None
    # target or base month missing from official -> ungraded
    assert bt.grade_month({"2025-02-01": 10.0}, W, "2026-02-01", lam=0.5) is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_backtest_power.py -q 2>&1 | tee <scratchpad>/task7-red.log`
Expected: collection error — the script file doesn't exist.

- [ ] **Step 3: Implement** — create `scripts/backtest_power_yearratio.py`:

```python
"""Offline backtest gate for the wave-4b year-ratio power nowcast (spec §6).

    .venv/bin/python scripts/backtest_power_yearratio.py --store store

Replays deployment honestly for each gradeable retail print month M: the
nowcast at mid-month M uses only wholesale obs <= that date, anchored on the
newest retail print available then (AVAIL_LAG_DAYS embargo, replicating the
~75-day publication lag). Errors are in YoY points against the realized
print. Flip condition (spec §6): the selected λ>0 must beat BOTH naive
baselines (carry-forward AND λ=0) on MAE with max |err| <= 3.0 YoY pts.
Results land in the spec's §10; this script publishes nothing."""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.engine import blend                          # noqa: E402
from pipeline.store import vintage                         # noqa: E402

RETAIL = "eia_elec_ind_us"
HUBS = ("caiso_sp15_da", "miso_indiana_da")
LAMBDAS = (0.0, 0.25, 0.5, 0.75, 1.0)
SMOOTH_DAYS = 7
AVAIL_LAG_DAYS = 75   # retail print for month M appears ~75d after month start
GRADE_DAY = 15        # grade the tail value a reader saw mid-month
MAX_ERR_PTS = 3.0     # spec §6(b)


def month_shift(d: str, months: int) -> str:
    y, m = int(d[:4]), int(d[5:7]) + months
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}-01"


def grade_month(official: dict[str, float], w_smoothed: dict[str, float],
                target: str, lam: float) -> tuple[float, float] | None:
    """(nowcast_err, carry_forward_err) in YoY points for print month
    `target`, or None when coverage is missing. Both errors share the
    realized YoY's base month, so err = (estimate - realized)/base * 100."""
    t = target[:8] + f"{GRADE_DAY:02d}"
    cutoff = (date.fromisoformat(t) - timedelta(days=AVAIL_LAG_DAYS)).isoformat()
    off_asof = {d: v for d, v in official.items() if d <= cutoff}
    live_asof = {d: v for d, v in w_smoothed.items() if d <= t}
    base_m = month_shift(target, -12)
    if target not in official or base_m not in official or not off_asof:
        return None
    spliced = blend.splice_year_ratio(off_asof, live_asof, lam)
    t0 = max(off_asof)
    tail_dates = [d for d in spliced if t0 < d <= t]
    if not tail_dates:
        return None
    base, realized = official[base_m], official[target]
    err = (spliced[max(tail_dates)] - realized) / base * 100.0
    cf = (off_asof[t0] - realized) / base * 100.0
    return err, cf


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--first-target", default="2025-07-01")
    args = parser.parse_args(argv)

    conn = vintage.load(args.store)
    official = dict(vintage.latest(conn, RETAIL))
    w = blend.trailing_mean(
        blend.hub_mean([dict(vintage.latest(conn, h)) for h in HUBS]),
        SMOOTH_DAYS)
    targets = [d for d in sorted(official) if d >= args.first_target]

    rows, mae, mx = {}, {}, {}
    for lam in LAMBDAS:
        graded = {m: grade_month(official, w, m, lam) for m in targets}
        graded = {m: g for m, g in graded.items() if g is not None}
        if not graded:
            print(f"lambda={lam}: no gradeable months", file=sys.stderr)
            continue
        rows[lam] = graded
        errs = [abs(g[0]) for g in graded.values()]
        mae[lam], mx[lam] = sum(errs) / len(errs), max(errs)
    if not rows:
        print("no gradeable months at all — check backfill coverage",
              file=sys.stderr)
        return 1

    any_lam = next(iter(rows))
    cfs = [abs(g[1]) for g in rows[any_lam].values()]
    cf_mae = sum(cfs) / len(cfs)

    print("| month | realized_yoy_base | " +
          " | ".join(f"err λ={lam}" for lam in rows) + " | err carry-fwd |")
    print("|---|---|" + "---|" * (len(rows) + 1))
    for m in sorted(rows[any_lam]):
        cells = " | ".join(f"{rows[lam][m][0]:+.2f}" if m in rows[lam] else "—"
                           for lam in rows)
        print(f"| {m} | {official[m]:.2f} | {cells} "
              f"| {rows[any_lam][m][1]:+.2f} |")
    print(f"\ncarry-forward MAE: {cf_mae:.3f} pts over {len(cfs)} months")
    for lam in rows:
        print(f"lambda={lam}: MAE {mae[lam]:.3f}, max|err| {mx[lam]:.3f}, "
              f"n={len(rows[lam])}")

    best = min((lam for lam in rows if lam > 0), key=lambda x: mae[x])
    ok = mae[best] < cf_mae and mae[best] < mae.get(0.0, float("inf")) \
        and mx[best] <= MAX_ERR_PTS
    print(f"\nselected lambda={best} -> "
          f"{'PASS: flip approved' if ok else 'FAIL: do not flip'} "
          f"(spec §6: beat carry-fwd {cf_mae:.3f} and λ=0 "
          f"{mae.get(0.0, float('nan')):.3f}; max|err| <= {MAX_ERR_PTS})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_backtest_power.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task7-green.log`
Expected: 5 pass in the file; full suite ≥ 465.

- [ ] **Step 5: Commit**

```bash
git add scripts/backtest_power_yearratio.py tests/test_backtest_power.py
git commit -m "feat(scripts): year-ratio backtest harness — grading math test-pinned"
```

---

### Task 8: Publish — tail nowcast fields + capacity `multiple`/`years_span` + schema

**Files:**
- Modify: `pipeline/engine/dcindex.py` (`power_block`, ~lines 233–265)
- Modify: `schemas/datacenter.schema.json` (`properties.power`)
- Test: `tests/test_dcindex.py`, `tests/test_datacenter_writer.py`

**Interfaces:**
- Consumes: `components["power"]["implied_level"/"yoy_pct"/"last_obs"]` (Task 3), `power_comp.live_proxy_transform`/`live_proxy_passthrough` (Task 1).
- Produces: `power["tail"]` gains `transform` (str), `passthrough` (float), `nowcast` `{implied_cents_kwh: float|None, yoy_pct: float|None, asof: str}` — ONLY when active; `power["capacity_auction"]` gains `multiple` (float|None) and `years_span` (int|None) always. Task 9 renders both.

- [ ] **Step 1: Write the failing tests.** In `tests/test_dcindex.py`, update/extend the power_block section:

Update `test_power_block_shape_with_partial_hub_data`: change its `ops` basket entry to include `"live_proxy_transform": "year_ratio", "live_proxy_passthrough": 0.5`, change its `dc_result` stub to

```python
    dc_result = {"indexes": {"ops": {"components": {"power": {
        "mode": "official+proxy", "implied_level": 8.913,
        "yoy_pct": 4.267, "last_obs": "2026-07-14"}}}}}
```

and change the tail assertion to:

```python
    assert block["tail"] == {
        "active": True, "smooth_days": 7,
        "hubs": ["caiso_sp15_da", "miso_indiana_da"],
        "transform": "year_ratio", "passthrough": 0.5,
        "nowcast": {"implied_cents_kwh": 8.91, "yoy_pct": 4.27,
                    "asof": "2026-07-14"}}
    assert block["capacity_auction"]["multiple"] is None   # single row
    assert block["capacity_auction"]["years_span"] is None
    assert block["capacity_auction"]["rows"] == CAP["rows"]
```

Add two new tests:

```python
def test_power_block_inactive_tail_shape_unchanged(tmp_path):
    # Option-B byte-identity: an inactive tail must publish EXACTLY the
    # wave-4 shape — no transform/passthrough/nowcast keys leak in.
    conn = make_conn(tmp_path, [("caiso_sp15_da", "2026-07-14", 44.7)])
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    dc_result = {"indexes": {"ops": {"components": {"power": {
        "mode": "official", "implied_level": None,
        "yoy_pct": 3.0, "last_obs": "2026-04-01"}}}}}
    block = dcindex.power_block(conn, dc_result, _power_cfg(), basket_path=basket)
    assert block["tail"] == {"active": False, "smooth_days": None, "hubs": []}


def test_power_block_capacity_story_math(tmp_path):
    # entry task: the multiple/years_span math moves out of PowerPanel.tsx
    conn = make_conn(tmp_path, [("caiso_sp15_da", "2026-07-14", 44.7)])
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    cfg = dc_power.PowerConfig(
        hubs=(dc_power.HubSpec(code="caiso_sp15_da", label="CAISO"),),
        henry_hub=dc_power.HubSpec(code="eia_henry_hub", label="HH"),
        capacity_auction={"source": "PJM", "asof": "2025-12-17", "rows": [
            {"delivery_year": "2024/25", "price_mw_day": 28.92},
            {"delivery_year": "2027/28", "price_mw_day": 333.44}]})
    dc_result = {"indexes": {"ops": {"components": {"power": {
        "mode": "official", "implied_level": None,
        "yoy_pct": None, "last_obs": "2026-04-01"}}}}}
    block = dcindex.power_block(conn, dc_result, cfg, basket_path=basket)
    cap = block["capacity_auction"]
    assert cap["multiple"] == pytest.approx(11.5)     # 333.44/28.92 → 1dp
    assert cap["years_span"] == 3                     # 2027 - 2024
```

Also update `test_power_block_tail_active_is_pure_passthrough` (the parametrized mode test): its stub must carry the fields the active branch now reads —

```python
    dc_result = {"indexes": {"ops": {"components": {"power": {
        "mode": mode, "implied_level": None,
        "yoy_pct": None, "last_obs": "2026-04-01"}}}}}
```

(assertion stays `block["tail"]["active"] is expected` — the passthrough-verbatim pin is unchanged).

In `tests/test_datacenter_writer.py`: extend the `POWER` fixture's `tail` to the active shape (add `"transform": "year_ratio", "passthrough": 0.5, "nowcast": {"implied_cents_kwh": 8.91, "yoy_pct": 4.27, "asof": "2026-07-14"}`) and its `capacity_auction` to include `"multiple": 9.3, "years_span": 1`; in `test_build_publishes_from_2018_with_contributions` assert they pass through verbatim (`p["tail"]["nowcast"]["implied_cents_kwh"] == 8.91`). Extend `test_power_deferred_tail_validates`'s power dict so `capacity_auction` carries `"multiple": None, "years_span": None` and keep its tail assertion byte-identical — it validates the fail-path publish shape against the new schema.

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/pytest tests/test_dcindex.py tests/test_datacenter_writer.py -q 2>&1 | tee <scratchpad>/task8-red.log`
Expected: the updated shape assertions FAIL (missing keys). Schema validation failures for the nowcast fields are also expected until Step 3's schema edit.

- [ ] **Step 3: Implement.**

(a) `pipeline/engine/dcindex.py` `power_block` — replace the final `return` block:

```python
    _, baskets = dc_basket.load_baskets(basket_path)
    power_comp = next(c for c in baskets["ops"] if c.code == "power")
    entry = dc_result["indexes"]["ops"]["components"]["power"]
    active = entry["mode"] == "official+proxy"
    tail = {"active": active,
            "smooth_days": power_comp.live_proxy_smooth_days,
            "hubs": list(power_comp.live_proxy_blend or ())}
    if active:
        # single source of truth: yoy/asof/implied come from the engine run
        # verbatim (rounded here for publish) — never recomputed
        tail["transform"] = power_comp.live_proxy_transform
        tail["passthrough"] = power_comp.live_proxy_passthrough
        tail["nowcast"] = {
            "implied_cents_kwh": (None if entry["implied_level"] is None
                                  else round(entry["implied_level"], 2)),
            "yoy_pct": (None if entry["yoy_pct"] is None
                        else round(entry["yoy_pct"], 2)),
            "asof": entry["last_obs"]}
    cap_rows = cfg.capacity_auction["rows"]
    multiple = years_span = None
    if len(cap_rows) >= 2:
        first, final = cap_rows[0], cap_rows[-1]
        if first["price_mw_day"] > 0:
            multiple = round(final["price_mw_day"] / first["price_mw_day"], 1)
        years_span = (int(final["delivery_year"][:4])
                      - int(first["delivery_year"][:4]))
    return {"tail": tail,
            "hubs": hub_rows,
            "henry_hub": henry,
            "capacity_auction": {**cfg.capacity_auction,
                                 "multiple": multiple,
                                 "years_span": years_span}}
```

Also update the `power_block` docstring's tail sentence: nowcast fields appear only when the ops power mode is `official+proxy`; capacity story math lives here so the site computes nothing.

(b) `schemas/datacenter.schema.json` — inside `properties.power.properties`:
- `tail.properties` gains (do NOT extend `tail.required`):

```json
"transform": {"type": "string", "enum": ["level", "year_ratio"]},
"passthrough": {"type": ["number", "null"]},
"nowcast": {"type": "object",
            "required": ["implied_cents_kwh", "yoy_pct", "asof"],
            "properties": {"implied_cents_kwh": {"type": ["number", "null"]},
                           "yoy_pct": {"type": ["number", "null"]},
                           "asof": {"type": "string"}}}
```

- `capacity_auction.properties` gains (NOT added to its `required` — the currently-deployed document must keep validating):

```json
"multiple": {"type": ["number", "null"]},
"years_span": {"type": ["number", "null"]}
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dcindex.py tests/test_datacenter_writer.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task8-green.log`
Expected: all pass; full suite ≥ 467. Also verify the deployed inactive document still validates:

```bash
curl -s https://macrogauge-cloudten.vercel.app/data/datacenter.json -o <scratchpad>/prod-dc.json
.venv/bin/python -c "
import json, jsonschema
jsonschema.validate(json.load(open('<scratchpad>/prod-dc.json')),
                    json.load(open('schemas/datacenter.schema.json')))
print('prod document validates against new schema')"
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py schemas/datacenter.schema.json tests/test_dcindex.py tests/test_datacenter_writer.py
git commit -m "feat(dc): power tail nowcast fields + capacity multiple/years_span (schema-pinned)"
```

---

### Task 9: Site — nowcast card + published capacity story (client math deleted)

**Files:**
- Modify: `site/src/components/PowerPanel.tsx`

**Interfaces:**
- Consumes: Task 8's published shapes. The nowcast card renders ONLY when `power.tail.nowcast` exists — dormant until the Task 11 flip deploys.
- Produces: nothing downstream.

- [ ] **Step 1: Implement.** In `site/src/components/PowerPanel.tsx`:

(a) extend the types:

```tsx
export type PowerData = {
  tail: {
    active: boolean; smooth_days: number | null; hubs: string[];
    transform?: string; passthrough?: number | null;
    nowcast?: { implied_cents_kwh: number | null; yoy_pct: number | null; asof: string };
  };
  hubs: PowerHub[];
  henry_hub: PowerHub | null;
  capacity_auction: {
    source: string;
    asof: string;
    rows: PowerCapacityRow[];
    multiple?: number | null;
    years_span?: number | null;
  };
};
```

(b) add `import { fmtSigned } from "@/lib/format";` and delete the client `multiple`/`yearsSpan` computation (lines 33–44: `const rows = …` stays, `first`/`last`/`multiple`/`yearsSpan` consts go). Replace the story-line condition with published fields:

```tsx
        <p className="method">
          {capacity_auction.source} · as of {capacity_auction.asof}
          {capacity_auction.multiple != null && capacity_auction.years_span != null && (
            <>
              {" "}
              — PJM capacity clearing prices rose ~{Math.floor(capacity_auction.multiple)}× from{" "}
              {rows[0].delivery_year} to {rows[rows.length - 1].delivery_year} (
              {capacity_auction.years_span} years).
            </>
          )}
        </p>
```

(c) append the nowcast card inside the existing `kpi-row` div, after the Henry Hub card:

```tsx
        {power.tail.nowcast && (
          <KpiCard
            label="Wholesale-implied industrial rate"
            value={
              power.tail.nowcast.implied_cents_kwh != null
                ? `${power.tail.nowcast.implied_cents_kwh.toFixed(2)}¢/kWh`
                : "—"
            }
            context={`like-month nowcast ${fmtSigned(power.tail.nowcast.yoy_pct)} YoY · as of ${power.tail.nowcast.asof}`}
            accent="red"
          />
        )}
```

- [ ] **Step 2: Gates** (no new vitest — this task deletes client math rather than adding any; the lib suites and e2e cover the render):

```bash
cd site && npx tsc --noEmit && npm run build && npm test && npm run e2e
```

Expected: tsc clean; build exports 25 routes; vitest 29 passed; e2e 23 passed (count unchanged — no new routes).

- [ ] **Step 3: Commit**

```bash
git add site/src/components/PowerPanel.tsx
git commit -m "feat(site): wholesale-implied nowcast card + published capacity story fields"
```

---

### Task 10 (CONTROLLER): run the backtest, record §10, take the flip decision

- [ ] **Step 1: λ seed provenance.** Look up the generation/purchased-power share of the US industrial retail rate (EIA Electric Power Annual, revenue/expenditure composition — WebFetch `https://www.eia.gov/electricity/annual/`; the utility operating-expense tables). Record the citation + derived seed value. If the lookup is inconclusive within ~15 minutes, proceed with the candidate grid alone and say so in §10 — the grid {0.25…1.0} brackets any plausible share.

- [ ] **Step 2: Run the backtest:**

```bash
.venv/bin/python scripts/backtest_power_yearratio.py --store store \
  2>&1 | tee <scratchpad>/backtest-results.log
```

- [ ] **Step 3: Record §10 in the spec** (`docs/superpowers/specs/2026-07-16-year-ratio-nowcast-design.md`): paste the per-λ table, MAE/max rows, carry-forward baseline, seed provenance from Step 1, the selected λ, and the PASS/FAIL verdict. Update the spec's Status line with the outcome. Commit:

```bash
git add docs/superpowers/specs/2026-07-16-year-ratio-nowcast-design.md
git commit -m "docs: record year-ratio backtest results in spec §10"
```

- [ ] **Step 4: Branch.** PASS → Task 11. FAIL → Task 11-alt. Either way, surface the table to the user before the final task — the flip is the whole point of the wave; the user should see the evidence even though the gate is mechanical.

---

### Task 11 (CONTROLLER, gated on Task 10 PASS): config flip + live sanity + close-out

**Files:**
- Modify: `config/dc_basket.json`, `tests/test_dc_basket.py` (real-config assertions), `site/src/app/datacenter/page.tsx` (methodology), `CLAUDE.md` (test count), `store/` + `site/public/data/` (live run outputs)

- [ ] **Step 1: Flip the config.** In `config/dc_basket.json`, the ops power component becomes (λ from Task 10):

```json
{"code": "power", "label": "Industrial electricity", "group": "power", "series": "eia_elec_ind_us", "weight": 0.55,
 "live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"],
 "live_proxy_smooth_days": 7,
 "live_proxy_transform": "year_ratio",
 "live_proxy_passthrough": <selected λ>}
```

- [ ] **Step 2: Update the real-config pin.** In `tests/test_dc_basket.py::test_load_real_baskets`, replace the Option-B block (the comment + `power.live_proxy is None` + `power.live_proxy_blend is None` assertions) with:

```python
    # wave-4b: the year-ratio nowcast tail (backtest-gated, spec §10) —
    # like-month coupling, never a level splice (the wave-4 +52% incident)
    power = next(c for c in baskets["ops"] if c.code == "power")
    assert power.live_proxy is None
    assert power.live_proxy_blend == ("caiso_sp15_da", "miso_indiana_da")
    assert power.live_proxy_smooth_days == 7
    assert power.live_proxy_transform == "year_ratio"
    assert 0 < power.live_proxy_passthrough <= 1
```

- [ ] **Step 3: Live run + sanity check:**

```bash
FRED_API_KEY=... .venv/bin/python -m pipeline.run_daily --store store --out site/public/data \
  2>&1 | tee <scratchpad>/flip-live-run.log
.venv/bin/python -c "
import json
dc = json.load(open('site/public/data/datacenter.json'))
ops = dc['indexes']['ops']
print('ops headline_yoy_pct:', ops['headline_yoy_pct'])
print('power component:', {k: v for k, v in
      next(c for c in ops['components'] if c['code'] == 'power').items()
      if k in ('mode', 'yoy_pct', 'last_obs')})
print('tail:', dc['power']['tail'])"
```

**Sanity gate (spec §12):** the ops headline move off the 6.22% no-tail baseline must be explainable as ≈ 0.55 × (power component's YoY change), and the power YoY change must be ≈ λ × wholesale like-month YoY (the backtest table says what that is). A surprise on the scale of wave 4 (tens of points) → STOP, revert the config commit, record in spec §10, report to the user.

- [ ] **Step 4: Methodology copy.** In `site/src/app/datacenter/page.tsx`, replace the final sentence of the power-bill methodology paragraph ("A like-month year-ratio nowcast is the planned honest coupling.") with (numbers from Task 10):

```
The ops power component now carries that coupling: retail a year ago × (1 + λ·(wholesale
like-month ratio − 1)) with λ=<value> (<seed provenance>), anchored at the latest print —
wholesale seasonality cancels by construction, and the pass-through share states how much
of the wholesale move retail inherits. Validated against <N> realized prints before
activation: MAE <x> YoY pts vs <y> for no-tail carry-forward.
```

- [ ] **Step 5: Full gates:**

```bash
.venv/bin/pytest -q 2>&1 | tee <scratchpad>/task11-gates.log
cd site && npx tsc --noEmit && npm run build && npm test && npm run e2e
```

Expected: pytest ≥ 467 all green; build/vitest(29)/e2e(23) green.

- [ ] **Step 6: Close-out.** Update `CLAUDE.md`'s test count (`pytest -q  # full suite (<final count> tests)`). Commit flip + data separately:

```bash
git add config/dc_basket.json tests/test_dc_basket.py site/src/app/datacenter/page.tsx CLAUDE.md
git commit -m "feat(dc): activate year-ratio power tail (λ=<value>) — backtest-gated (spec §10)"
git add store site/public/data
git commit -m "data: first year-ratio tail publish + backfill vintages"
```

Then: `git fetch origin` and rebase over the daily bot commit if one landed (store JSONL conflicts resolve by union). **Ask the user for push approval** — push = production deploy.

### Task 11-alt (CONTROLLER, on Task 10 FAIL): honest no-flip close-out

- [ ] Do NOT touch `config/dc_basket.json`. In `site/src/app/datacenter/page.tsx`, replace the same final sentence with: "A like-month year-ratio nowcast was built and backtested against <N> realized prints; it did not beat carry-forward (MAE <x> vs <y> YoY pts), so the index stays official-only — the machinery ships config-gated for when more wholesale history accumulates." Update `CLAUDE.md` test count. Full gates (Step 5 above), commit `docs+site: year-ratio backtest fail recorded — index stays official-only`, rebase, ask about push.

---

## Self-Review (run after writing — issues found and fixed inline)

1. **Spec coverage:** §1 scope → Tasks 1–9; §3/§4 transform → Task 2; §5 config/loader → Tasks 1, 11; §6 backtest gate → Tasks 7, 10; §7 plumbing → Tasks 4–6; §8 publish/site → Tasks 8–9, 11 Step 4; §9 testing (incl. the regression pin, backtest unit tests, inactive byte-identity, schema branches) → embedded per task; §10 recording → Task 10; §11 risks → tolerance/skip tests (Task 2), coverage probe (Task 6), sanity gate (Task 11); §12 sequencing → task order + gating.
2. **Placeholder scan:** `<selected λ>`/`<value>`/`<N>` in Tasks 10–11 are runtime-determined by the backtest — deliberate, resolved by Task 10's recorded table, not authorable now. `FRED_API_KEY=...` comes from the user's `.env`. `<scratchpad>` = the session scratchpad path given in Global Constraints.
3. **Type consistency:** `splice_year_ratio(official, live, passthrough, tolerance_days=7)` used identically in Tasks 2, 3, 7; `implied_level` produced in Task 3(c), consumed in Task 8(a) and stubbed in Task 8 tests; `live_proxy_transform`/`live_proxy_passthrough` field names identical across Tasks 1, 3, 8, 11; `grade_month` returns `(err, cf) | None` in both Task 7 code and tests.
