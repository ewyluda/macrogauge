# DC Grading Harness (P3b) + Unfilled-Orders Lead-Lag Study (P3c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a vintage-true grading harness that measures whether each DC escalation basis actually carried enough contingency, plus the lead-lag study that decides whether a forward model is ever attempted.

**Architecture:** A one-off ALFRED backfill loads real point-in-time vintages for all 12 DC Build components into the append-only store. A new pure engine module reconstructs the Build index as it read at each historical vintage, computes what each basis would have said, and grades it against realized escalation. A new publisher emits one artifact validated inline; a new isolated `run_daily` phase runs it. The site renders it on a new page plus a compact inline verdict on `/escalation`.

**Tech Stack:** Python 3.12 (pipeline, pytest), Next.js static export + TypeScript (site, vitest + Playwright), JSON Schema (draft 2020-12), SQLite in-memory (vintage store reads), FRED/ALFRED API.

**Spec:** `docs/superpowers/specs/2026-07-26-dc-grading-harness-design.md` — read §3 and §3.1 before writing any copy.

**Branch:** `feat/dc-grading-harness` (already created, spec committed at `fa70cc2`).

## Global Constraints

- **Never quote a shortfall rate without its counterpart leg adjacent.** Spec §3.1, §9 criterion 3. Applies to the page, the inline verdict, metadata strings, and commit messages.
- **The two scenarios (GFC, COVID peak) publish NO grading statistic** — no shortfall, MAE, bias, or `n`. Spec §5.3, §9 criterion 4.
- **HTTP is injected, never real, in tests.** Connectors take `http_get`; tests pass fakes reading `tests/fixtures/`.
- **Store rows are append-only and schema-versionless.** Never rewrite a committed partition. Fields may be added, never renamed/removed/retyped.
- **Every published file validates inline against `schemas/<stem>.schema.json`.** `jsonschema.ValidationError` must re-raise and fail the run — caught *before* the generic `Exception`. `_run_phase` already implements this; do not weaken it.
- **The new phase runs in its own isolated `try/except` with a `grades_ok` flag.** A failure must not suppress any other phase.
- **Schemas must legally allow degraded output** — nulls and empty arrays — so a `grades_ok: false` run still validates.
- **Basket weights sum to 1.0**; `config/dc_basket.json` is the source of truth for the 12 weights. Never hardcode them in the engine.
- **No hardcoded fixed-threshold claims about independent draws.** P3a spec §5.3's correction shows these go stale as the sample grows; render live values instead.
- Python: 4-space indent, type hints on public functions, docstrings explaining *why*. TypeScript: strict mode.

---

## File Structure

**Pipeline (create):**
- `scripts/backfill_dc_vintages.py` — one-off ALFRED vintage loader for the 12 Build components
- `pipeline/engine/dcgrade.py` — pure grading engine: as-of reconstruction, anchors, bases, metrics
- `pipeline/engine/dcleadlag.py` — pure cross-correlation + split-half stability
- `pipeline/engine/powergrade.py` — power-nowcast grade, extracted from the existing script
- `pipeline/publish/dc_grades.py` — the writer
- `schemas/dc_grades.schema.json`
- `tests/test_dcgrade.py`, `tests/test_dcleadlag.py`, `tests/test_powergrade.py`, `tests/test_dc_grades_publish.py`, `tests/test_backfill_dc_vintages.py`

**Pipeline (modify):**
- `config/series.json` — 3 new FRED series
- `pipeline/run_daily.py` — new `GRADES` phase
- `pipeline/publish/qa.py` — `PHASES` + `_PHASE_DONE`
- `scripts/backtest_power_yearratio.py` — delegate to `powergrade`

**Site (create):**
- `site/src/lib/dcGrades.ts`, `site/src/lib/dcGrades.test.ts`
- `site/src/app/dc-scoreboard/page.tsx`
- `site/src/components/grades/GradesClient.tsx`

**Site (modify):**
- `site/src/lib/types.ts`, `site/src/lib/nav.ts`
- `site/src/components/DcEscalationClient.tsx` — inline verdict only, keep it small
- `site/src/app/datacenter/page.tsx` — MAE from artifact
- `site/e2e/smoke.spec.ts`

**Docs (modify, Task 13):**
- `docs/plans/2026-07-24-project-controls-gaps.md`, `CLAUDE.md`, `todo.md`

---

## Task 1: ALFRED vintage backfill

**Files:**
- Create: `scripts/backfill_dc_vintages.py`
- Create: `tests/test_backfill_dc_vintages.py`

**Interfaces:**
- Consumes: `pipeline.connectors.fred.fetch_vintages(series_id, api_key, observation_start, realtime_start, http_get)`, `pipeline.registry.load_registry()`, `pipeline.store.vintage.append_vintages(observations, store_dir)`, `pipeline.dc_basket.load_baskets(registry_codes=...)`
- Produces: `build_series_entries() -> list[Series]`, `coverage(observations) -> dict[str, tuple[str, str, int]]`, `shortfalls(cov, expected_codes, min_vintages) -> list[str]`, `main(argv, http_get) -> int`

Background: `fred.fetch_vintages` returns `Observation(series_code=<FRED id>)`. The store is keyed by **registry code** (`ppi_steel`, not `WPU1017`). Skipping the remap silently creates a parallel series that the engine never reads — spec §9 risk 2. `scripts/backfill_dc_history.py:102-103` is the precedent to copy.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_backfill_dc_vintages.py
"""The backfill must remap FRED ids to registry codes and refuse to append a
partial vintage set. The store is append-only, so a half-loaded basket cannot
be undone -- validation happens BEFORE the write, never after."""
import json
from pathlib import Path

import pytest

from pipeline.models import Observation
from scripts import backfill_dc_vintages as bf


def _obs(code, obs_date, vintage, value=100.0):
    return Observation(series_code=code, obs_date=obs_date, value=value,
                       vintage_date=vintage, source="ALFRED", route="API")


def test_build_series_entries_covers_all_twelve_components():
    entries = bf.build_series_entries()
    assert len(entries) == 12
    # every entry must carry a FRED source_id distinct from its registry code
    assert all(e.source_id != e.code for e in entries)
    assert {"ppi_steel", "ces_constr_ahe"} <= {e.code for e in entries}


def test_coverage_reports_span_and_vintage_count_per_series():
    obs = [_obs("ppi_steel", "2008-01-01", "2015-03-13"),
           _obs("ppi_steel", "2008-01-01", "2016-04-14"),
           _obs("ppi_steel", "2009-01-01", "2015-03-13")]
    cov = bf.coverage(obs)
    assert cov["ppi_steel"] == ("2008-01-01", "2009-01-01", 2)


def test_shortfalls_flags_a_series_that_came_back_with_one_vintage():
    cov = {"ppi_steel": ("2008-01-01", "2026-06-01", 130),
           "ppi_concrete": ("2008-01-01", "2026-06-01", 1)}
    bad = bf.shortfalls(cov, {"ppi_steel", "ppi_concrete"}, min_vintages=50)
    assert bad == ["ppi_concrete"]


def test_shortfalls_flags_a_series_that_is_entirely_missing():
    cov = {"ppi_steel": ("2008-01-01", "2026-06-01", 130)}
    bad = bf.shortfalls(cov, {"ppi_steel", "ppi_concrete"}, min_vintages=50)
    assert bad == ["ppi_concrete"]


def test_main_refuses_to_append_when_any_series_is_short(tmp_path, monkeypatch):
    """The PR #6 trap: fred.fetch tolerates partial failure. A loop over 12
    series reintroduces it, and aggregate.headline intersects component dates,
    so one short series silently truncates the whole index."""
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None, **kw):
        calls["n"] += 1
        sid = params["series_id"]
        # every series returns a healthy vintage set except one
        n = 1 if sid == "WPU1017" else 60
        return _FakeResponse({"observations": [
            {"date": "2008-01-01", "value": "100.0",
             "realtime_start": f"2015-{(i % 12) + 1:02d}-13"}
            for i in range(n)]})

    store = tmp_path / "store"
    store.mkdir()
    with pytest.raises(SystemExit) as exc:
        bf.main(["--store", str(store)], http_get=fake_get)
    assert "ppi_steel" in str(exc.value)
    assert list(store.glob("*.jsonl")) == []   # nothing written


def test_main_remaps_fred_ids_to_registry_codes(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    def fake_get(url, params=None, timeout=None, **kw):
        return _FakeResponse({"observations": [
            {"date": "2008-01-01", "value": "100.0",
             "realtime_start": f"2015-{(i % 12) + 1:02d}-13"}
            for i in range(60)]})

    store = tmp_path / "store"
    store.mkdir()
    assert bf.main(["--store", str(store)], http_get=fake_get) == 0
    rows = [json.loads(line) for p in store.glob("*.jsonl")
            for line in p.read_text().splitlines()]
    codes = {r["series_code"] for r in rows}
    assert "ppi_steel" in codes            # registry code
    assert "WPU1017" not in codes          # never the raw FRED id


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_backfill_dc_vintages.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.backfill_dc_vintages'`

- [ ] **Step 3: Write the script**

```python
# scripts/backfill_dc_vintages.py
"""One-off ALFRED vintage backfill for the 12 DC Build components.

    FRED_API_KEY=... python scripts/backfill_dc_vintages.py --store store

The initial DC backfill (2026-07-12/15) gave every historical observation the
same collection-day vintage, so there was no point-in-time history to walk and
the register concluded a vintage-true DC backtest was impossible before
mid-2027. ALFRED has the real release history for all 12 components -- this
loads it, which is what makes pipeline/engine/dcgrade.py possible.

Identity-deduped (vintage.append_vintages), so re-running is a no-op. The
latest-vintage-wins read view is unchanged: the daily snapshot still wins and
no published value moves. Only as_of()/first_releases() gain real history.
"""
import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline import dc_basket                             # noqa: E402
from pipeline.connectors import fred                       # noqa: E402
from pipeline.models import Observation                    # noqa: E402
from pipeline.registry import load_registry                # noqa: E402
from pipeline.store import vintage                         # noqa: E402

# A component with real ALFRED history returns >100 distinct vintages (the
# probed minimum across the 12 was 135). 50 is a floor well clear of that and
# well clear of the single-vintage failure this guard exists to catch.
MIN_VINTAGES = 50
OBSERVATION_START = "2007-01-01"
REALTIME_START = "1990-01-01"   # must predate the first release, or ALFRED
                                # clamps the earliest window and the true
                                # first-release date is lost


def build_series_entries():
    """Registry entries for the 12 DC Build components, in basket order."""
    _, baskets = load_baskets_safely()
    wanted = {c.series for c in baskets["build"]}
    _, series = load_registry()
    entries = [s for s in series if s.code in wanted]
    missing = wanted - {s.code for s in entries}
    if missing:
        sys.exit(f"series missing from registry: {sorted(missing)}")
    return entries


def load_baskets_safely():
    _, series = load_registry()
    return dc_basket.load_baskets(registry_codes={s.code for s in series})


def coverage(observations: list[Observation]) -> dict[str, tuple[str, str, int]]:
    """{series_code: (earliest obs_date, latest obs_date, distinct vintages)}."""
    out: dict[str, tuple[str, str, set]] = {}
    for o in observations:
        lo, hi, vints = out.get(o.series_code, (o.obs_date, o.obs_date, set()))
        out[o.series_code] = (min(lo, o.obs_date), max(hi, o.obs_date),
                              vints | {o.vintage_date})
    return {c: (lo, hi, len(v)) for c, (lo, hi, v) in out.items()}


def shortfalls(cov: dict[str, tuple[str, str, int]], expected_codes: set,
               min_vintages: int = MIN_VINTAGES) -> list[str]:
    """Codes that are absent or came back with too few distinct vintages.

    fred.fetch_vintages is single-series so it cannot partially fail the way
    fred.fetch does -- but a loop over 12 series reintroduces exactly that
    trap, and the store is append-only, so this must run BEFORE any write."""
    return sorted(c for c in expected_codes
                  if c not in cov or cov[c][2] < min_vintages)


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--min-vintages", type=int, default=MIN_VINTAGES)
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")

    entries = build_series_entries()
    id_map = {s.source_id: s.code for s in entries}
    obs: list[Observation] = []
    for s in entries:
        rows = fred.fetch_vintages(s.source_id, key,
                                   observation_start=OBSERVATION_START,
                                   realtime_start=REALTIME_START,
                                   http_get=http_get)
        # Remap provider id -> registry code. Skipping this writes a parallel
        # series under the FRED id that the engine never reads (spec risk 2).
        obs.extend(replace(o, series_code=id_map.get(o.series_code, o.series_code))
                   for o in rows)
        print(f"  {s.code:<26} {len(rows):>5} rows")

    cov = coverage(obs)
    bad = shortfalls(cov, set(id_map.values()), args.min_vintages)
    if bad:
        sys.exit("refusing to append -- short vintage history for: "
                 f"{bad}. The store is append-only; a partial load cannot "
                 "be undone.")

    written = vintage.append_vintages(obs, args.store)
    print(f"fetched {len(obs)} vintage rows across {len(cov)} series, "
          f"wrote {written} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_backfill_dc_vintages.py -q`
Expected: 6 passed

- [ ] **Step 5: Commit the script**

```bash
git add scripts/backfill_dc_vintages.py tests/test_backfill_dc_vintages.py
git commit -m "feat(grades): ALFRED vintage backfill for the 12 DC Build components

fred.fetch_vintages is single-series, but a 12-series loop reintroduces the
partial-failure trap PR #6 fixed. Coverage is validated before any append --
the store is append-only, so a half-loaded basket cannot be undone."
```

- [ ] **Step 6: Run the backfill for real and commit the store rows**

```bash
set -a && . ./.env && set +a
.venv/bin/python scripts/backfill_dc_vintages.py --store store
```

Expected: 12 lines of per-series row counts, then `fetched ~5400 vintage rows across 12 series, wrote <N> new`. If it exits non-zero with a shortfall list, **stop and investigate** — do not lower `--min-vintages` to force it through.

```bash
git add store/
git commit -m "data: ALFRED point-in-time vintages for the 12 DC Build components

Real release history back to 2015-03 (PPIs) and 2011-03 (CES), covering
100% of Build weight. Append-only: latest-vintage-wins is unchanged, so no
published value moves -- only as_of() gains history."
```

- [ ] **Step 7: Verify no published value moved**

```bash
.venv/bin/python -c "
from pipeline.store import vintage
conn = vintage.load(__import__('pathlib').Path('store'))
print('ppi_steel vintages:', len({r[0] for r in conn.execute(
    \"SELECT DISTINCT vintage_date FROM observations WHERE series_code='ppi_steel'\")}))
print('latest 2026-06:', dict(vintage.latest(conn,'ppi_steel')).get('2026-06-01'))
"
git status --porcelain site/public/data/
```

Expected: vintage count >100, and `git status` shows **no** changes under `site/public/data/` — the backfill must not move a published number.

---

## Task 2: As-of reconstruction and anchors

**Files:**
- Create: `pipeline/engine/dcgrade.py`
- Create: `tests/test_dcgrade.py`

**Interfaces:**
- Consumes: `pipeline.dates.months_back(obs_date, n)` (n may be negative → forward)
- Produces:
  - `load_component_versions(conn, components) -> dict[str, dict[str, list[tuple[str, float]]]]` — `{component_code: {obs_date: [(vintage_date, value), ...] sorted ascending}}`
  - `index_asof(comp_versions, vintage_date, weights, base_month=BASE_MONTH) -> dict[str, float]`
  - `anchors(comp_versions, weights, base_month=BASE_MONTH) -> list[tuple[str, dict[str, float]]]`
  - Constants `BASE_MONTH = "2008-01-01"`, `SAMPLE_START = "2007-12-01"`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dcgrade.py
"""The grading engine is a pure function of dicts -- no store, no I/O."""
import pytest

from pipeline.engine import dcgrade

W = {"a": 0.6, "b": 0.4}


def _versions():
    """Two components. 'a' revises its 2008-02 value in a later vintage."""
    return {
        "a": {"2008-01-01": [("2015-03-13", 100.0)],
              "2008-02-01": [("2015-03-13", 102.0), ("2015-04-14", 104.0)]},
        "b": {"2008-01-01": [("2015-03-13", 200.0)],
              "2008-02-01": [("2015-03-13", 210.0)]},
    }


def test_index_asof_uses_only_vintages_at_or_before_the_cutoff():
    idx = dcgrade.index_asof(_versions(), "2015-03-13", W, base_month="2008-01-01")
    # a: 102/100*100 = 102 ; b: 210/200*100 = 105
    assert idx["2008-02-01"] == pytest.approx(0.6 * 102.0 + 0.4 * 105.0)


def test_index_asof_picks_up_the_revision_at_a_later_cutoff():
    idx = dcgrade.index_asof(_versions(), "2015-04-14", W, base_month="2008-01-01")
    # a's 2008-02 is now 104 -> 104
    assert idx["2008-02-01"] == pytest.approx(0.6 * 104.0 + 0.4 * 105.0)


def test_index_asof_returns_empty_when_the_base_month_is_not_yet_known():
    v = {"a": {"2009-01-01": [("2015-03-13", 100.0)]},
         "b": {"2009-01-01": [("2015-03-13", 200.0)]}}
    assert dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01") == {}


def test_index_asof_intersects_component_dates():
    """A month only one component has must not enter the headline -- the same
    date-intersection contract aggregate.headline uses."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-03-13", 102.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)]}}
    idx = dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01")
    assert list(idx) == ["2008-01-01"]


def test_index_asof_ignores_observations_dated_after_the_cutoff():
    """A vintage published on date D can carry obs months <= D only."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2020-01-01": [("2015-03-13", 150.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2020-01-01": [("2015-03-13", 260.0)]}}
    idx = dcgrade.index_asof(v, "2015-03-13", W, base_month="2008-01-01")
    assert "2020-01-01" not in idx


def test_anchors_dedupe_by_last_observation_month():
    """Multiple ALFRED vintages can share a last-observation month. Grading
    each would inflate n and the independent-draw estimate without adding
    information (spec 5.1)."""
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-03-13", 102.0), ("2015-04-14", 104.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2008-02-01": [("2015-03-13", 210.0), ("2015-04-14", 211.0)]}}
    out = dcgrade.anchors(v, W, base_month="2008-01-01")
    assert [m for m, _ in out] == ["2008-02-01"]


def test_anchors_returns_one_entry_per_new_last_month_in_order():
    v = {"a": {"2008-01-01": [("2015-03-13", 100.0)],
               "2008-02-01": [("2015-04-14", 104.0)],
               "2008-03-01": [("2015-05-14", 106.0)]},
         "b": {"2008-01-01": [("2015-03-13", 200.0)],
               "2008-02-01": [("2015-04-14", 211.0)],
               "2008-03-01": [("2015-05-14", 214.0)]}}
    out = dcgrade.anchors(v, W, base_month="2008-01-01")
    assert [m for m, _ in out] == ["2008-01-01", "2008-02-01", "2008-03-01"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcgrade.py -q`
Expected: FAIL — `ImportError: cannot import name 'dcgrade'`

- [ ] **Step 3: Write the reconstruction**

```python
# pipeline/engine/dcgrade.py
"""Vintage-true grading of the DC escalation contingency bases.

P3a shipped five named bases and deliberately made no claim about which is
right, because nothing in the repo could grade one. This grades them.

The register and the P3a spec both state a vintage-true DC backtest is
impossible before ~mid-2027. That was inferred from the store (backfilled in
single sweeps) and is wrong: ALFRED carries real release history for all 12
Build components, so scripts/backfill_dc_vintages.py makes point-in-time
reconstruction possible back to 2015-03. See spec 2.1.

Everything here is a pure function of dicts -- no store, no I/O -- like every
other engine stage.
"""
import sqlite3

from pipeline.dates import months_back

# Rebase anchor. MUST match config/dc_basket.json's base_month and rebase.py's
# stage-1 contract. NOT immaterial, despite an earlier claim: this index is a
# Laspeyres sum of SEPARATELY REBASED components, so H_b(t) = sum w_i*I_i(t)/I_i(b)
# gives component i an effective weight of w_i/I_i(b) -- changing b reweights the
# basket and changes its growth rates. Measured: a 2008-01 base diverges from the
# published index by up to 1.0029 index points across 199 of 222 months, vs
# 0.1081 at one month for 2018-01 (spec 2.1a).
#
# This floors the earliest anchor at 2018-01, and that floor is principled: an
# index based at 2018-01 cannot be reconstructed at a vintage predating its own
# base month. The strict leg has 99 anchors, not 132.
BASE_MONTH = "2018-01-01"

# First month of the Build sample, set by the two contractor PPIs. The
# long-run basis measures from here.
SAMPLE_START = "2007-12-01"


def load_component_versions(conn: sqlite3.Connection, components
                            ) -> dict[str, dict[str, list[tuple[str, float]]]]:
    """{component_code: {obs_date: [(vintage_date, value), ...]}}, ascending.

    Keyed by the basket component code, reading the store's series code --
    DCComponent.series is the store key, DCComponent.code is the component id,
    and conflating them is a standing trap in this codebase."""
    out: dict[str, dict[str, list[tuple[str, float]]]] = {}
    for comp in components:
        rows = conn.execute(
            "SELECT obs_date, vintage_date, value FROM observations "
            "WHERE series_code = ? ORDER BY obs_date, vintage_date",
            (comp.series,)).fetchall()
        versions: dict[str, list[tuple[str, float]]] = {}
        for obs_date, vintage_date, value in rows:
            versions.setdefault(obs_date, []).append((vintage_date, value))
        out[comp.code] = versions
    return out


def index_asof(comp_versions, vintage_date: str, weights: dict[str, float],
               base_month: str = BASE_MONTH) -> dict[str, float]:
    """Laspeyres Build index using only information known by `vintage_date`.

    Returns {} when any component lacks the base month at this vintage -- an
    index missing a component is not a partial index, it is a different index.
    """
    comps: dict[str, dict[str, float]] = {}
    for code, versions in comp_versions.items():
        vals = {}
        for obs_date, rows in versions.items():
            if obs_date > vintage_date:
                continue      # a release cannot carry a future observation
            known = [v for vd, v in rows if vd <= vintage_date]
            if known:
                vals[obs_date] = known[-1]
        base = vals.get(base_month)
        if not base:
            return {}
        comps[code] = {d: v / base * 100.0 for d, v in vals.items()}
    if not comps:
        return {}
    dates = set.intersection(*(set(c) for c in comps.values()))
    return {d: sum(weights[c] * comps[c][d] for c in comps)
            for d in sorted(dates)}


def anchors(comp_versions, weights: dict[str, float],
            base_month: str = BASE_MONTH) -> list[tuple[str, dict[str, float]]]:
    """[(last_observation_month, index_as_it_read_then)], ascending.

    ONE anchor per distinct last-observation month. Several ALFRED vintages
    routinely land in the same month (a revision to an old obs does not extend
    the series); grading each would inflate n and the independent-draw
    estimate without adding information (spec 5.1). Earliest vintage reaching
    a month wins -- it is the first date a reader could have stood there."""
    vints = sorted({vd for versions in comp_versions.values()
                    for rows in versions.values() for vd, _ in rows})
    out, seen = [], set()
    for vd in vints:
        idx = index_asof(comp_versions, vd, weights, base_month)
        if not idx:
            continue
        last = max(idx)
        if last in seen:
            continue
        seen.add(last)
        out.append((last, idx))
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcgrade.py -q`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcgrade.py tests/test_dcgrade.py
git commit -m "feat(grades): vintage-true as-of reconstruction of the DC Build index

Anchors dedupe by last-observation month: several ALFRED vintages land in
the same month, and grading each would inflate the independent-draw estimate
without adding information."
```

---

## Task 3: Bases at an anchor, pinned to the published index

**Files:**
- Modify: `pipeline/engine/dcgrade.py`
- Modify: `tests/test_dcgrade.py`

**Interfaces:**
- Consumes: Task 2's `index_asof`, `anchors`, `BASE_MONTH`, `SAMPLE_START`
- Produces:
  - `annualized(index, start_month, end_month) -> float | None` — annualized % over the window
  - `ROLLING_BASES: dict[str, int | None]` — `{"long_run": None, "trailing_3yr": 36, "current_momentum": 12}`
  - `bases_at(index, anchor_month, sample_start=SAMPLE_START) -> dict[str, float | None]`

The reconstruction check is **agreement between two computations, not a pinned constant**. The three rolling bases drift every publish; hardcoding `+5.02%` would be a fresh staleness bug of exactly the kind P3a spec §5.3 documents.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_dcgrade.py
import json
from pathlib import Path

from pipeline import dc_basket, registry
from pipeline.store import vintage

REPO = Path(__file__).parent.parent


def test_annualized_is_a_ratio_over_the_window_not_a_mean_of_yoy():
    idx = {"2020-01-01": 100.0, "2023-01-01": 133.1}
    # 1.331 ** (1/3) = 1.10 exactly
    assert dcgrade.annualized(idx, "2020-01-01", "2023-01-01") == pytest.approx(10.0)


def test_annualized_returns_none_when_an_endpoint_is_missing():
    idx = {"2020-01-01": 100.0}
    assert dcgrade.annualized(idx, "2020-01-01", "2023-01-01") is None
    assert dcgrade.annualized(idx, "2019-01-01", "2020-01-01") is None


def test_annualized_returns_none_for_a_zero_length_window():
    idx = {"2020-01-01": 100.0}
    assert dcgrade.annualized(idx, "2020-01-01", "2020-01-01") is None


def test_bases_at_computes_the_three_rolling_bases_from_their_own_windows():
    idx = {dcgrade.SAMPLE_START: 100.0}
    for n in range(1, 200):
        m = months_back_forward(dcgrade.SAMPLE_START, n)
        idx[m] = 100.0 * (1.005 ** n)      # +0.5%/mo everywhere
    anchor = max(idx)
    b = dcgrade.bases_at(idx, anchor)
    # a constant monthly rate makes all three windows agree
    expected = ((1.005 ** 12) - 1) * 100
    assert b["long_run"] == pytest.approx(expected)
    assert b["trailing_3yr"] == pytest.approx(expected)
    assert b["current_momentum"] == pytest.approx(expected)


def test_bases_at_returns_none_when_the_lookback_predates_the_sample():
    idx = {"2020-01-01": 100.0, "2020-02-01": 101.0}
    b = dcgrade.bases_at(idx, "2020-02-01")
    assert b["trailing_3yr"] is None
    assert b["current_momentum"] is None


def months_back_forward(d, n):
    from pipeline.dates import months_back
    return months_back(d, -n)


def test_reconstruction_matches_the_published_build_index():
    """The harness must grade the PUBLISHED index, not a parallel one
    (spec 9 criterion 5). Compared as agreement between two computations
    rather than a pinned constant: the rolling bases drift every publish, so
    a hardcoded +5.02% would be a fresh staleness bug.

    The trailing two months are excluded: the published index splices the
    copper/aluminium live proxies there and this reconstruction is PPI-only.
    P3a spec 3.1 measured that difference at 1.241 index points in the splice
    month and 0.000 everywhere else."""
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    build = baskets["build"]
    weights = {c.code: c.weight for c in build}

    conn = vintage.load(REPO / "store")
    versions = dcgrade.load_component_versions(conn, build)
    latest = max(vd for v in versions.values() for rows in v.values()
                 for vd, _ in rows)
    idx = dcgrade.index_asof(versions, latest, weights)
    assert idx, "reconstruction produced no index"

    published = json.loads(
        (REPO / "site/public/data/datacenter.json").read_text())
    monthly = published["indexes"]["build"]["monthly"]
    pub = dict(zip(monthly["months"], monthly["index"]))

    # both are 2018-01=100 up to a constant; rescale ours onto theirs
    common = sorted(set(m[:7] for m in idx) & set(pub))[:-2]
    assert len(common) > 150, f"only {len(common)} overlapping months"
    ours = {m[:7]: v for m, v in idx.items()}
    k = pub[common[0]] / ours[common[0]]
    worst = max(abs(ours[m] * k - pub[m]) for m in common)
    assert worst < 0.05, f"reconstruction diverges by {worst:.4f} index points"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcgrade.py -q`
Expected: FAIL — `AttributeError: module 'pipeline.engine.dcgrade' has no attribute 'annualized'`

- [ ] **Step 3: Implement**

```python
# append to pipeline/engine/dcgrade.py

# Rolling bases only -- the three that are LIVE-COMPUTABLE RULES: standing at
# any anchor you could have computed them with no knowledge of the future.
# The two absolute regimes (GFC, COVID peak) are hindsight-selected windows
# and are deliberately NOT graded anywhere in this module (spec 5.3).
# {key: months of lookback; None means "from SAMPLE_START"}
ROLLING_BASES: dict[str, int | None] = {
    "long_run": None,
    "trailing_3yr": 36,
    "current_momentum": 12,
}


def annualized(index: dict[str, float], start_month: str,
               end_month: str) -> float | None:
    """Annualized % change of an index ratio over [start, end].

    An index RATIO, never a median or mean of YoY prints: only the ratio
    decomposes additively into per-component contributions, which is what
    preserves P1's bridge identity (P3a spec 5.1)."""
    a, b = index.get(start_month), index.get(end_month)
    if a is None or b is None or a <= 0:
        return None
    months = (int(end_month[:4]) - int(start_month[:4])) * 12 + \
             int(end_month[5:7]) - int(start_month[5:7])
    if months <= 0:
        return None
    return ((b / a) ** (12.0 / months) - 1) * 100.0


def bases_at(index: dict[str, float], anchor_month: str,
             sample_start: str = SAMPLE_START) -> dict[str, float | None]:
    """What each live-computable basis said at `anchor_month`."""
    out = {}
    for key, lookback in ROLLING_BASES.items():
        start = sample_start if lookback is None \
            else months_back(anchor_month, lookback)
        out[key] = annualized(index, start, anchor_month)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcgrade.py -q`
Expected: 13 passed. If `test_reconstruction_matches_the_published_build_index` fails, the backfill in Task 1 is wrong — do not loosen the tolerance.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcgrade.py tests/test_dcgrade.py
git commit -m "feat(grades): live-computable bases at each vintage-true anchor

Reconstruction is pinned by agreement against the published monthly grid, not
by a hardcoded rate -- the rolling bases drift every publish, so a constant
would be a fresh staleness bug."
```

---

## Task 4: Grading metrics

**Files:**
- Modify: `pipeline/engine/dcgrade.py`
- Modify: `tests/test_dcgrade.py`

**Interfaces:**
- Consumes: Task 3's `annualized`, `ROLLING_BASES`
- Produces:
  - `HORIZONS = (12, 24, 36, 48)`
  - `grade(anchor_bases, realized_index, horizons=HORIZONS) -> dict[str, dict[str, dict]]` — `{basis_key: {"h12": stats, ...}}` where `stats` = `{n, independent_draws, shortfall_rate_pct, mean_shortfall_pp, worst_shortfall_pp, bias_pp, mae_pp}`
  - `realized_at(realized_index, anchor_month, horizons) -> dict[str, float | None]` — `{"h12": rate, ...}`

`anchor_bases` is `[(anchor_month, {basis_key: rate | None})]`.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_dcgrade.py

def _flat_index(start="2010-01-01", n=200, monthly=1.0):
    from pipeline.dates import months_back
    return {months_back(start, -i): 100.0 * (monthly ** i) for i in range(n)}


def test_grade_reports_zero_shortfall_when_carried_matches_realized():
    """A constant-rate index: every basis carries exactly what happens."""
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    st = out["trailing_3yr"]["h12"]
    assert st["shortfall_rate_pct"] == pytest.approx(0.0)
    assert st["mae_pp"] == pytest.approx(0.0, abs=1e-9)
    assert st["worst_shortfall_pp"] == pytest.approx(0.0)


def test_grade_counts_a_shortfall_when_realized_exceeds_carried():
    """Escalation accelerates after the anchor, so every carry is short."""
    from pipeline.dates import months_back
    idx = {months_back("2010-01-01", -i): 100.0 * (1.001 ** i) for i in range(60)}
    for i in range(60, 120):                      # regime shift upward
        idx[months_back("2010-01-01", -i)] = idx[months_back("2010-01-01", -59)] \
            * (1.02 ** (i - 59))
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:59]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    st = out["current_momentum"]["h12"]
    assert st["shortfall_rate_pct"] == pytest.approx(100.0)
    assert st["bias_pp"] < 0          # carried less than realized
    assert st["mean_shortfall_pp"] > 0


def test_grade_reports_independent_draws_as_n_over_h():
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx, horizons=(12, 48))
    for basis in dcgrade.ROLLING_BASES:
        for h in (12, 48):
            st = out[basis][f"h{h}"]
            assert st["independent_draws"] == pytest.approx(st["n"] / h)


def test_grade_skips_anchors_with_no_realized_value_at_the_horizon():
    """Anchors within h months of the sample end are not gradeable."""
    idx = _flat_index(n=60, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:]]
    out = dcgrade.grade(ab, idx, horizons=(12,))
    assert out["trailing_3yr"]["h12"]["n"] == len(ab) - 12


def test_grade_emits_no_row_for_a_horizon_with_no_gradeable_anchors():
    idx = _flat_index(n=40, monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:]]
    out = dcgrade.grade(ab, idx, horizons=(48,))
    assert out["trailing_3yr"]["h48"] is None


def test_grade_never_emits_a_scenario_key():
    """The two hindsight-selected regimes carry no grading statistic
    anywhere (spec 5.3, acceptance criterion 4)."""
    idx = _flat_index(monthly=1.005)
    ab = [(m, dcgrade.bases_at(idx, m)) for m in sorted(idx)[36:-48]]
    out = dcgrade.grade(ab, idx)
    assert set(out) == set(dcgrade.ROLLING_BASES)
    assert "gfc" not in out and "covid_peak" not in out


def test_realized_at_annualizes_forward_from_the_anchor():
    idx = _flat_index(monthly=1.005)
    m = sorted(idx)[0]
    r = dcgrade.realized_at(idx, m, (12,))
    assert r["h12"] == pytest.approx(((1.005 ** 12) - 1) * 100)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcgrade.py -q`
Expected: FAIL — `AttributeError: ... has no attribute 'grade'`

- [ ] **Step 3: Implement**

```python
# append to pipeline/engine/dcgrade.py

# Matches /escalation's 48-month delivery cap, so every horizon a reader can
# select is gradeable.
HORIZONS = (12, 24, 36, 48)


def realized_at(realized_index: dict[str, float], anchor_month: str,
                horizons=HORIZONS) -> dict[str, float | None]:
    """What escalation actually did over each horizon from `anchor_month`.

    Always the final-revision index, in BOTH legs. Only the CARRIED side needs
    to be vintage-true -- that is what the reader knew when deciding. What
    happened is what happened (spec 5.4)."""
    return {f"h{h}": annualized(realized_index, anchor_month,
                                months_back(anchor_month, -h))
            for h in horizons}


def grade(anchor_bases, realized_index: dict[str, float],
          horizons=HORIZONS) -> dict[str, dict[str, dict | None]]:
    """Grade each live-computable basis at each horizon.

    SHORTFALL RATE IS THE HEADLINE, not MAE. Measured on the real sample, the
    basis with the best MAE is the worst contingency: long_run wins symmetric
    error at every horizon and under-provisions 99% of 36-month windows. MAE
    does not care about sign; a contingency budget cares about almost nothing
    else. MAE and bias still publish, so the inversion is visible (spec 3).

    Conditional shortfall statistics are means over the SHORT windows only --
    averaging in the windows that were fine would dilute the number that
    matters."""
    out: dict[str, dict[str, dict | None]] = {}
    for basis in ROLLING_BASES:
        out[basis] = {}
        for h in horizons:
            errors, shorts = [], []
            for anchor_month, bases in anchor_bases:
                carried = bases.get(basis)
                realized = annualized(realized_index, anchor_month,
                                      months_back(anchor_month, -h))
                if carried is None or realized is None:
                    continue
                err = carried - realized      # +ve = carried more than needed
                errors.append(err)
                if err < 0:
                    shorts.append(-err)
            if not errors:
                out[basis][f"h{h}"] = None
                continue
            n = len(errors)
            out[basis][f"h{h}"] = {
                "n": n,
                "independent_draws": round(n / h, 2),
                "shortfall_rate_pct": round(len(shorts) / n * 100, 1),
                "mean_shortfall_pp": round(sum(shorts) / len(shorts), 2)
                                     if shorts else 0.0,
                "worst_shortfall_pp": round(max(shorts), 2) if shorts else 0.0,
                "bias_pp": round(sum(errors) / n, 2),
                "mae_pp": round(sum(abs(e) for e in errors) / n, 2),
            }
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcgrade.py -q`
Expected: 20 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcgrade.py tests/test_dcgrade.py
git commit -m "feat(grades): shortfall-first grading metrics

Shortfall rate leads and MAE ships beside it, because on the real sample the
best-MAE basis is the worst contingency: long_run wins symmetric error at
every horizon and under-provisions 99% of 36-month windows."
```

---

## Task 5: Both legs, scenarios, and the `build()` orchestrator

**Files:**
- Modify: `pipeline/engine/dcgrade.py`
- Modify: `tests/test_dcgrade.py`

**Interfaces:**
- Consumes: Tasks 2–4
- Produces: `build(conn, components, base_month_cfg, scenarios) -> dict` returning
  `{"as_of", "legs": {"strict": leg, "extended": leg}, "anchors": [...], "scenarios": [...], "revision_disclosure_pp"}`
  where `leg` = `{"provenance", "span": [start, end], "anchors_n", "contains_downturn", "grades"}`
- `scenarios` argument: `[{"key", "label", "start_month", "end_month"}]`

The extended leg starts at `months_back(SAMPLE_START, -36)` = **2010-12** — the trailing-3yr basis needs 36 months of history before an anchor can carry all three rolling bases.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_dcgrade.py

SCENARIOS = [
    {"key": "gfc", "label": "GFC downturn",
     "start_month": "2008-12-01", "end_month": "2011-12-01"},
    {"key": "covid_peak", "label": "COVID peak",
     "start_month": "2021-04-01", "end_month": "2023-12-01"},
]


def _built():
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    conn = vintage.load(REPO / "store")
    return dcgrade.build(conn, baskets["build"], dcgrade.BASE_MONTH, SCENARIOS)


def test_build_emits_both_legs_with_spans_and_anchor_counts():
    out = _built()
    assert set(out["legs"]) == {"strict", "extended"}
    for leg in out["legs"].values():
        assert leg["anchors_n"] > 50
        assert leg["span"][0] < leg["span"][1]
        assert leg["grades"]


def test_strict_leg_is_vintage_true_and_starts_after_alfreds_ppi_vintages():
    out = _built()
    strict = out["legs"]["strict"]
    assert "vintage-true" in strict["provenance"]
    assert strict["span"][0] >= "2015-03"
    assert strict["contains_downturn"] is False


def test_extended_leg_reaches_further_back_and_holds_a_downturn():
    out = _built()
    ext, strict = out["legs"]["extended"], out["legs"]["strict"]
    assert ext["span"][0] < strict["span"][0]
    assert ext["span"][0] == "2010-12"      # SAMPLE_START + 36mo of history
    assert ext["contains_downturn"] is True
    assert ext["anchors_n"] > strict["anchors_n"]


def test_scenarios_publish_rates_and_windows_but_no_grading_statistic():
    """Spec 5.3: a grade on ~1.5 independent draws is not a measurement, and
    publishing one invites exactly the over-reading it cannot support."""
    out = _built()
    keys = {s["key"] for s in out["scenarios"]}
    assert keys == {"gfc", "covid_peak"}
    banned = {"shortfall_rate_pct", "mae_pp", "bias_pp", "n",
              "mean_shortfall_pp", "worst_shortfall_pp", "independent_draws"}
    for s in out["scenarios"]:
        assert s["hindsight_selected"] is True
        assert s["annualized_pct"] is not None
        assert not (banned & set(s)), f"scenario {s['key']} carries a grade"


def test_anchors_array_lets_a_reader_rederive_every_statistic():
    out = _built()
    assert out["anchors"]
    row = out["anchors"][0]
    assert set(row) == {"m", "leg", "bases", "realized"}
    assert set(row["bases"]) == set(dcgrade.ROLLING_BASES)
    assert set(row["realized"]) == {f"h{h}" for h in dcgrade.HORIZONS}


def test_build_publishes_the_revision_disclosure():
    """The extended leg's justification is the measured revision distortion.
    Without it the leg is just a looser standard (spec 5.2)."""
    out = _built()
    assert out["revision_disclosure_pp"] == 0.27
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcgrade.py -q`
Expected: FAIL — `AttributeError: ... has no attribute 'build'`

- [ ] **Step 3: Implement**

```python
# append to pipeline/engine/dcgrade.py

# Measured 2026-07-26 across nine historical anchors: reconstructing at a past
# vintage vs the final-revision index moves the annualized trailing-12m rate
# by at most this much. It is what makes the extended leg defensible rather
# than a looser standard, so it PUBLISHES alongside that leg (spec 2.3, 5.2).
REVISION_DISCLOSURE_PP = 0.27

_STRICT_NOTE = ("vintage-true (ALFRED as-of): each component takes its latest "
                "release known at the anchor date")
_EXTENDED_NOTE = ("final-revision throughout: deeper sample, at a measured "
                  f"{REVISION_DISCLOSURE_PP}pp maximum distortion")


# The strict leg publishes only h=12 and h=24. Corrected measurement (spec
# §2.1a) puts its independent draws at 1.78 and 1.08 for h=36 and h=48 --
# roughly ONE draw -- and a "100.0%" shortfall resting on one draw is the
# exact claim this spec's standard rejects elsewhere. Those horizons are
# carried by the extended leg alone; the strict column renders a
# "vintage-true sample too thin at this horizon" note instead of a figure.
# This is the ONLY stated exception to the paired-leg rule.
STRICT_HORIZONS = (12, 24)


def _leg(anchor_bases, realized_index, provenance, contains_downturn,
         horizons=HORIZONS):
    months = [m for m, _ in anchor_bases]
    return {
        "provenance": provenance,
        "span": [months[0][:7], months[-1][:7]] if months else [None, None],
        "anchors_n": len(months),
        "contains_downturn": contains_downturn,
        "published_horizons": list(horizons),
        "grades": grade(anchor_bases, realized_index, horizons),
    }


def build(conn: sqlite3.Connection, components, base_month_cfg: str,
          scenarios: list[dict]) -> dict:
    """Both legs, the ungraded scenarios, and the re-derivable anchor array.

    Two legs by design. The strict leg is genuinely vintage-true but its
    anchors begin 2015-03 and contain the 2021-22 spike and NO downturn -- the
    same sample defect P3a's backfill fixed for the percentile band. Its
    36/48-month shortfall rates read 99% and 100%; on the extended leg they
    fall to 65.6% and 64.7%. That spread is itself the finding, and neither
    leg may be published alone (spec 3.1)."""
    weights = {c.code: c.weight for c in components}
    versions = load_component_versions(conn, components)

    latest_vintage = max(vd for v in versions.values() for rows in v.values()
                         for vd, _ in rows)
    realized = index_asof(versions, latest_vintage, weights, base_month_cfg)
    if not realized:
        return {"as_of": None, "legs": {}, "anchors": [], "scenarios": [],
                "revision_disclosure_pp": REVISION_DISCLOSURE_PP}

    strict_anchors = [(m, bases_at(idx, m))
                      for m, idx in anchors(versions, weights, base_month_cfg)]
    # Extended: the same bases read off the final-revision index. First anchor
    # is SAMPLE_START + 36 months -- trailing_3yr needs that much history.
    ext_start = months_back(SAMPLE_START, -36)
    extended_anchors = [(m, bases_at(realized, m))
                        for m in sorted(realized) if m >= ext_start]

    rows = []
    for leg_key, ab in (("strict", strict_anchors), ("extended", extended_anchors)):
        for m, bases in ab:
            rows.append({
                "m": m[:7], "leg": leg_key,
                "bases": {k: None if v is None else round(v, 3)
                          for k, v in bases.items()},
                "realized": {k: None if v is None else round(v, 3)
                             for k, v in realized_at(realized, m).items()},
            })

    return {
        "as_of": max(realized)[:7],
        "legs": {
            "strict": _leg(strict_anchors, realized, _STRICT_NOTE, False,
                           STRICT_HORIZONS),
            "extended": _leg(extended_anchors, realized, _EXTENDED_NOTE, True),
        },
        "anchors": rows,
        "scenarios": [{
            "key": s["key"], "label": s["label"],
            "start_month": s["start_month"][:7], "end_month": s["end_month"][:7],
            "annualized_pct": (lambda v: None if v is None else round(v, 2))(
                annualized(realized, s["start_month"], s["end_month"])),
            "hindsight_selected": True,
            "note": ("Window hand-picked in 2026 from realized history. "
                     "Ungradeable: selecting it required hindsight, and "
                     "restricting to anchors where the window had closed "
                     "leaves too few independent draws to measure."),
        } for s in scenarios],
        "revision_disclosure_pp": REVISION_DISCLOSURE_PP,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcgrade.py -q`
Expected: 26 passed

- [ ] **Step 5: Sanity-check the real numbers against the spec**

```bash
.venv/bin/python -c "
import json, pathlib
from pipeline import dc_basket, registry
from pipeline.engine import dcgrade
from pipeline.store import vintage
_, s = registry.load_registry()
_, b = dc_basket.load_baskets(registry_codes={x.code for x in s})
conn = vintage.load(pathlib.Path('store'))
out = dcgrade.build(conn, b['build'], dcgrade.BASE_MONTH, [
  {'key':'gfc','label':'GFC downturn','start_month':'2008-12-01','end_month':'2011-12-01'},
  {'key':'covid_peak','label':'COVID peak','start_month':'2021-04-01','end_month':'2023-12-01'}])
for k, leg in out['legs'].items():
    print(k, leg['span'], leg['anchors_n'])
    for basis in dcgrade.ROLLING_BASES:
        g = leg['grades'][basis].get('h36')
        print('  ', basis, 'h36 shortfall', g and g['shortfall_rate_pct'])
"
```

Expected, matching spec §3 and §3.1: strict span ≈ `['2015-03','2026-06']` with ~132 anchors and `long_run` h36 shortfall ≈ **99.0**; extended span `['2010-12','2026-06']` with ~187 anchors and `long_run` h36 shortfall ≈ **65.6**. **If these diverge materially, stop** — the engine disagrees with the measurements the spec was written from.

- [ ] **Step 6: Commit**

```bash
git add pipeline/engine/dcgrade.py tests/test_dcgrade.py
git commit -m "feat(grades): both legs, ungraded scenarios, re-derivable anchors

The strict leg holds no downturn and reads 99%/100% shortfall at 36/48mo;
the extended leg reads 65.6%/64.7%. That spread is the finding, so neither
leg may publish alone. Scenarios carry rates and windows but no statistic."
```

---

## Task 6: Unfilled-orders lead-lag study (P3c)

**Files:**
- Create: `pipeline/engine/dcleadlag.py`
- Create: `tests/test_dcleadlag.py`
- Modify: `config/series.json`

**Interfaces:**
- Consumes: `pipeline.publish.util.yoy_pct`, `pipeline.store.vintage.latest`
- Produces:
  - `MAPPINGS: list[dict]` — `{"series", "label", "components", "weight"}`
  - `correlate(driver_yoy, target_yoy, max_lag=24) -> list[tuple[int, float]]`
  - `study(conn, components, mappings=MAPPINGS) -> dict`

`config/series.json` FRED entry shape: `{"code","source","source_id","name","max_staleness_days"}`. `tests/test_run_daily.py`'s `fake_get` already returns a generic FRED fixture for **any** `series_id`, so no fixture change is needed — verify this in Step 5 rather than assuming it.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dcleadlag.py
"""P3c is a MEASUREMENT, not a model. No transfer coefficient is estimated
anywhere: turning a correlation into a price forecast requires an elasticity,
and fitting one on this sample is the overfit the register warns about."""
import pytest

from pipeline.engine import dcleadlag


def _series(values, start="2000-01-01"):
    from pipeline.dates import months_back
    return {months_back(start, -i): v for i, v in enumerate(values)}


def test_correlate_finds_a_planted_lead_at_the_right_lag():
    """Driver leads target by 6 months -> peak correlation at lag 6."""
    import math
    base = [math.sin(i / 6.0) for i in range(240)]
    driver = _series(base)
    target = _series([0.0] * 6 + base[:-6])
    prof = dcleadlag.correlate(driver, target, max_lag=12)
    best = max(prof, key=lambda p: p[1])
    assert best[0] == 6
    assert best[1] > 0.9


def test_correlate_returns_one_entry_per_lag_from_zero():
    prof = dcleadlag.correlate(_series([float(i) for i in range(60)]),
                               _series([float(i) for i in range(60)]),
                               max_lag=5)
    assert [lag for lag, _ in prof] == [0, 1, 2, 3, 4, 5]


def test_correlate_returns_none_correlation_when_overlap_is_too_short():
    prof = dcleadlag.correlate(_series([1.0, 2.0]), _series([1.0, 2.0]),
                               max_lag=24)
    assert all(c is None for lag, c in prof if lag > 1)


def test_correlate_handles_a_flat_series_without_dividing_by_zero():
    prof = dcleadlag.correlate(_series([5.0] * 60), _series([float(i) for i in range(60)]),
                               max_lag=6)
    assert all(c is None for _, c in prof)


def test_mappings_cover_forty_five_percent_of_build_weight():
    assert sum(m["weight"] for m in dcleadlag.MAPPINGS) == pytest.approx(0.45)
    assert {m["series"] for m in dcleadlag.MAPPINGS} == {
        "fred_uo_electrical", "fred_uo_hvac", "fred_uo_turbines"}


def test_stability_verdict_requires_agreement_across_both_halves():
    """The gate is stated before the numbers exist: consistent sign and best
    lag within +/-3 months across split halves, or it is a negative result."""
    assert dcleadlag.stable(first_lag=6, second_lag=8,
                            first_corr=0.7, second_corr=0.6) is True
    assert dcleadlag.stable(first_lag=2, second_lag=14,
                            first_corr=0.7, second_corr=0.6) is False
    assert dcleadlag.stable(first_lag=6, second_lag=7,
                            first_corr=0.7, second_corr=-0.6) is False
    assert dcleadlag.stable(first_lag=None, second_lag=6,
                            first_corr=None, second_corr=0.6) is False


def test_study_publishes_no_transfer_coefficient():
    """A correlation is not an elasticity. Nothing downstream of the lead
    structure may be published (spec 6)."""
    banned = {"beta", "elasticity", "pass_through", "coefficient", "forecast"}
    text = open("pipeline/engine/dcleadlag.py").read().lower()
    assert not any(f'"{b}"' in text or f"'{b}'" in text for b in banned)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcleadlag.py -q`
Expected: FAIL — `ImportError: cannot import name 'dcleadlag'`

- [ ] **Step 3: Add the three registry series**

Add to the `series` array in `config/series.json`, next to the other DC FRED entries:

```json
{"code": "fred_uo_electrical", "source": "FRED", "source_id": "U35CUO", "name": "Unfilled orders, electrical equipment (NSA)", "max_staleness_days": 80},
{"code": "fred_uo_hvac", "source": "FRED", "source_id": "U33HUO", "name": "Unfilled orders, ventilation/heating/AC (NSA)", "max_staleness_days": 80},
{"code": "fred_uo_turbines", "source": "FRED", "source_id": "UTGPUO", "name": "Unfilled orders, turbines & generators (NSA)", "max_staleness_days": 80}
```

NSA (`U`-prefixed), not SA: the Build components are NSA, the study compares YoY to YoY (which cancels seasonality by construction), and mixing adjustment conventions across a correlation is a silent error.

- [ ] **Step 4: Implement**

```python
# pipeline/engine/dcleadlag.py
"""P3c -- do manufacturers' unfilled orders LEAD DC input prices?

This is a measurement, not a model. It publishes lead structure and nothing
downstream of it: no transfer coefficient, no elasticity, no forecast. Turning
a correlation into a price forecast requires an estimated elasticity, and
fitting one on this sample is precisely the overfit the gap register warns
about (spec 6).

The stability gate is stated here, in code, before any number is computed: a
lead counts only if the best lag agrees in sign and within +/-3 months across
both halves of the sample. Otherwise the finding is that backlogs do not
usefully lead these prices -- and that publishes as a negative result, the
same way the year-ratio power nowcast did.
"""
import sqlite3
from statistics import fmean, pstdev

from pipeline.publish.util import yoy_pct
from pipeline.store import vintage

MAX_LAG = 24
MIN_OVERLAP = 36          # months; below this a correlation is noise
LAG_TOLERANCE = 3         # months of drift allowed between sample halves

# 0.45 of Build weight. Exact-or-near NAICS matches, at zero connector cost.
# concrete, constr_wages, elec_contractors and plumb_hvac_contractors (0.35 of
# weight) have no forward market of any kind and are out of scope.
MAPPINGS = [
    {"series": "fred_uo_electrical", "label": "Electrical equipment",
     "components": ["switchgear", "transformers"], "weight": 0.26},
    {"series": "fred_uo_hvac", "label": "Ventilation, heating & AC",
     "components": ["hvac_equip"], "weight": 0.10},
    {"series": "fred_uo_turbines", "label": "Turbines & generators",
     "components": ["generators"], "weight": 0.09},
]


def _yoy_series(obs: dict[str, float]) -> dict[str, float]:
    """{month: YoY %} -- seasonality cancels, so NSA inputs are safe."""
    return {m: y for m in obs if (y := yoy_pct(obs, m)) is not None}


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < MIN_OVERLAP:
        return None
    sx, sy = pstdev(xs), pstdev(ys)
    if not sx or not sy:
        return None
    mx, my = fmean(xs), fmean(ys)
    cov = fmean([(x - mx) * (y - my) for x, y in zip(xs, ys)])
    return cov / (sx * sy)


def correlate(driver_yoy: dict[str, float], target_yoy: dict[str, float],
              max_lag: int = MAX_LAG) -> list[tuple[int, float | None]]:
    """[(lag_months, correlation)] for lag in 0..max_lag.

    A positive lag means the driver LEADS: driver at month m-lag is paired
    with the target at month m."""
    from pipeline.dates import months_back
    out = []
    for lag in range(max_lag + 1):
        xs, ys = [], []
        for m, tv in sorted(target_yoy.items()):
            dv = driver_yoy.get(months_back(m, lag))
            if dv is not None:
                xs.append(dv)
                ys.append(tv)
        out.append((lag, _pearson(xs, ys)))
    return out


def stable(first_lag: int | None, second_lag: int | None,
           first_corr: float | None, second_corr: float | None) -> bool:
    """The gate, stated before the numbers exist.

    34 years of monthly data will produce SOME peak at SOME lag for any pair.
    A lead counts only if both halves agree in sign and the best lag drifts by
    no more than LAG_TOLERANCE months."""
    if first_lag is None or second_lag is None:
        return False
    if first_corr is None or second_corr is None:
        return False
    if (first_corr > 0) != (second_corr > 0):
        return False
    return abs(first_lag - second_lag) <= LAG_TOLERANCE


def _best(profile) -> tuple[int | None, float | None]:
    scored = [(lag, c) for lag, c in profile if c is not None]
    if not scored:
        return None, None
    lag, corr = max(scored, key=lambda p: abs(p[1]))
    return lag, round(corr, 3)


def study(conn: sqlite3.Connection, components, mappings=MAPPINGS) -> dict:
    """Per mapping: lead profile, best lag, and the split-half verdict."""
    by_code = {c.code: c for c in components}
    rows = []
    for m in mappings:
        driver = _yoy_series(dict(vintage.latest(conn, m["series"])))
        for comp_code in m["components"]:
            comp = by_code.get(comp_code)
            if comp is None:
                continue
            target = _yoy_series(dict(vintage.latest(conn, comp.series)))
            profile = correlate(driver, target)
            best_lag, best_corr = _best(profile)

            months = sorted(target)
            mid = months[len(months) // 2] if months else None
            first = correlate(driver, {k: v for k, v in target.items()
                                       if mid and k < mid})
            second = correlate(driver, {k: v for k, v in target.items()
                                        if mid and k >= mid})
            f_lag, f_corr = _best(first)
            s_lag, s_corr = _best(second)
            rows.append({
                "driver": m["series"], "driver_label": m["label"],
                "component": comp_code, "component_label": comp.label,
                "weight": comp.weight,
                "months": len(target),
                "span": [months[0][:7], months[-1][:7]] if months else [None, None],
                "best_lag_months": best_lag,
                "best_correlation": best_corr,
                "profile": [{"lag": lag, "corr": None if c is None else round(c, 3)}
                            for lag, c in profile],
                "first_half": {"best_lag_months": f_lag, "best_correlation": f_corr},
                "second_half": {"best_lag_months": s_lag, "best_correlation": s_corr},
                "stable": stable(f_lag, s_lag, f_corr, s_corr),
            })
    supported = [r for r in rows if r["stable"]]
    return {
        "mappings": rows,
        "weight_covered": round(sum(m["weight"] for m in mappings), 3),
        "weight_stable": round(sum(r["weight"] for r in supported), 3),
        "verdict": ("A stable lead was found for "
                    f"{len(supported)} of {len(rows)} mappings."
                    if supported else
                    "No mapping showed a lead stable across both halves of "
                    "the sample. Backlogs do not usefully lead these prices, "
                    "and no forward model is warranted on this evidence."),
        "gate": ("A lead counts only if the best lag agrees in sign and "
                 f"within {LAG_TOLERANCE} months across both sample halves. "
                 "Stated before the numbers were computed."),
    }
```

- [ ] **Step 5: Run tests and confirm the registry needs no new fixture**

```bash
pytest tests/test_dcleadlag.py -q
pytest tests/test_run_daily.py -q
```

Expected: `test_dcleadlag.py` 7 passed; `test_run_daily.py` still passes — its `fake_get` returns a generic FRED fixture for any `series_id`, so the three new series need no fixture. If it fails, add the series to the fake, do not remove them from the registry.

- [ ] **Step 6: Commit**

```bash
git add pipeline/engine/dcleadlag.py tests/test_dcleadlag.py config/series.json
git commit -m "feat(leadlag): unfilled-orders lead-lag study, gate stated up front

P3c scoped to a measurement. 34 years of monthly data will produce some peak
at some lag for any pair, so the split-half stability gate is written into
the engine before any number is computed. No transfer coefficient anywhere."
```

---

## Task 7: Extract the power-nowcast grade into the engine

**Files:**
- Create: `pipeline/engine/powergrade.py`
- Create: `tests/test_powergrade.py`
- Modify: `scripts/backtest_power_yearratio.py`

**Interfaces:**
- Consumes: `pipeline.engine.blend.splice_year_ratio`, `pipeline.store.vintage`
- Produces: `RETAIL`, `HUBS`, `LAMBDAS`, `SMOOTH_DAYS`, `AVAIL_LAG_DAYS`, `GRADE_DAY`, `MAX_ERR_PTS`, `month_shift(d, months)`, `grade_month(official, w_smoothed, target, lam)`, `run(conn) -> dict`

`run()` returns `{"carry_forward_mae", "best_lambda", "best_mae", "months_graded", "verdict", "as_of"}` — the numbers `datacenter/page.tsx` currently hardcodes as "8.5 vs 5.2".

- [ ] **Step 1: Write the failing test**

```python
# tests/test_powergrade.py
"""The published negative result must be a published NUMBER, not a React
string literal. It carried no as-of, was in none of the 34 artifacts, was not
schema-validated, and nothing in CI would catch it drifting (spec 7)."""
import pytest

from pipeline.engine import powergrade


def test_month_shift_moves_whole_months_in_both_directions():
    assert powergrade.month_shift("2026-07-01", -12) == "2025-07-01"
    assert powergrade.month_shift("2026-01-01", -1) == "2025-12-01"
    assert powergrade.month_shift("2025-12-01", 1) == "2026-01-01"


def test_run_reports_the_verdict_and_both_maes(monkeypatch):
    """A synthetic store where the nowcast is strictly worse than carrying
    forward -- the shipped verdict."""
    conn = _store_where_nowcast_loses()
    out = powergrade.run(conn)
    assert out["months_graded"] > 0
    assert out["carry_forward_mae"] is not None
    assert out["best_mae"] is not None
    assert out["verdict"] == "FAIL"
    assert out["best_mae"] > out["carry_forward_mae"]


def test_run_degrades_to_nulls_rather_than_raising_on_an_empty_store():
    """The schema must accept a degraded shape; the engine must produce one."""
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    out = powergrade.run(conn)
    assert out["months_graded"] == 0
    assert out["best_mae"] is None
    assert out["verdict"] == "INSUFFICIENT"


def _store_where_nowcast_loses():
    import sqlite3
    from pipeline.dates import months_back
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    rows = []
    for i in range(40):
        m = months_back("2023-01-01", -i)
        rows.append((powergrade.RETAIL, m, 8.0 + i * 0.02, m, "EIA", "API"))
    for hub in powergrade.HUBS:
        for i in range(1200):
            from datetime import date, timedelta
            d = (date(2023, 1, 1) + timedelta(days=i)).isoformat()
            # violent wholesale swings the retail series never inherits
            rows.append((hub, d, 30.0 + 25.0 * ((i // 30) % 2), d, "EIA", "API"))
    conn.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?)", rows)
    conn.commit()
    return conn
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_powergrade.py -q`
Expected: FAIL — `ImportError: cannot import name 'powergrade'`

- [ ] **Step 3: Move the script's core into the engine**

Read `scripts/backtest_power_yearratio.py` and move its constants (`RETAIL`, `HUBS`, `LAMBDAS`, `SMOOTH_DAYS`, `AVAIL_LAG_DAYS`, `GRADE_DAY`, `MAX_ERR_PTS`), `month_shift`, and `grade_month` verbatim into `pipeline/engine/powergrade.py`, then add:

```python
def run(conn) -> dict:
    """The gate result as publishable numbers.

    Same computation the script has always run; it now lives in the engine so
    the site can render it under a schema with an as-of instead of a hardcoded
    literal that nothing in CI would catch drifting (spec 7)."""
    official = dict(vintage.latest(conn, RETAIL))
    hubs = {h: dict(vintage.latest(conn, h)) for h in HUBS}
    smoothed = _smoothed_hub_mean(hubs)
    targets = [m for m in sorted(official) if month_shift(m, -12) in official]

    cf_errs, per_lambda = [], {lam: [] for lam in LAMBDAS if lam > 0}
    for target in targets:
        for lam in LAMBDAS:
            graded = grade_month(official, smoothed, target, lam)
            if graded is None:
                continue
            err, cf = graded
            if lam > 0:
                per_lambda[lam].append(abs(err))
            elif lam == 0.0:
                cf_errs.append(abs(cf))

    def mae(xs):
        return round(sum(xs) / len(xs), 3) if xs else None

    scored = {lam: mae(errs) for lam, errs in per_lambda.items() if errs}
    best_lambda = min(scored, key=scored.get) if scored else None
    return {
        "as_of": max(official) if official else None,
        "months_graded": len(cf_errs),
        "carry_forward_mae": mae(cf_errs),
        "best_lambda": best_lambda,
        "best_mae": scored.get(best_lambda),
        "verdict": _verdict(mae(cf_errs), scored.get(best_lambda)),
        "note": ("A like-month year-ratio nowcast, backtested against realized "
                 "retail prints before letting it touch the index. It lost to "
                 "simple carry-forward at every pass-through level tested, so "
                 "the ops index stays on official retail data and the "
                 "machinery ships config-gated."),
    }


def _verdict(cf: float | None, best: float | None) -> str:
    if cf is None or best is None:
        return "INSUFFICIENT"
    return "PASS" if best < cf else "FAIL"
```

Add `_smoothed_hub_mean(hubs)` implementing the same hub-mean + `SMOOTH_DAYS` trailing smoothing the script already does (lift it from the script body — do not re-derive it).

Then rewrite `scripts/backtest_power_yearratio.py` to import from `pipeline.engine.powergrade` and keep only its CLI, printing, and `sys.exit(0 if verdict == "PASS" else 2)`. The script must keep its existing exit-code contract.

- [ ] **Step 4: Run tests and confirm the script still behaves**

```bash
pytest tests/test_powergrade.py -q
.venv/bin/python scripts/backtest_power_yearratio.py --store store; echo "exit=$?"
```

Expected: 3 passed; script prints its table and exits **2** (FAIL — the shipped verdict), with `carry-forward` and `best λ` MAEs printed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/powergrade.py tests/test_powergrade.py scripts/backtest_power_yearratio.py
git commit -m "refactor(powergrade): move the power-nowcast gate into the engine

Same computation, now importable by the publisher so the site can render the
verdict under a schema with an as-of. The script keeps its CLI and exit-code
contract and delegates."
```

---

## Task 8: Publisher, schema, run_daily phase

**Files:**
- Create: `pipeline/publish/dc_grades.py`
- Create: `schemas/dc_grades.schema.json`
- Create: `tests/test_dc_grades_publish.py`
- Modify: `pipeline/run_daily.py`, `pipeline/publish/qa.py`

**Interfaces:**
- Consumes: `dcgrade.build`, `dcleadlag.study`, `powergrade.run`, `pipeline.publish.util.write_json`, `pipeline.publish.validate.validate_file`
- Produces: `SCENARIOS`, `build(conn, components) -> dict`, `write(payload, out_dir, published_at) -> Path`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dc_grades_publish.py
import json
from pathlib import Path

import jsonschema
import pytest

from pipeline import dc_basket, registry
from pipeline.publish import dc_grades, validate
from pipeline.store import vintage

REPO = Path(__file__).parent.parent
SCHEMA = REPO / "schemas" / "dc_grades.schema.json"


@pytest.fixture(scope="module")
def payload():
    _, series = registry.load_registry()
    _, baskets = dc_basket.load_baskets(registry_codes={s.code for s in series})
    conn = vintage.load(REPO / "store")
    return dc_grades.build(conn, baskets["build"])


def test_payload_validates_against_the_schema(payload, tmp_path):
    p = dc_grades.write(payload, tmp_path, published_at="2026-07-26T00:00:00Z")
    validate.validate_file(p, SCHEMA)


def test_schema_accepts_a_fully_degraded_payload(tmp_path):
    """A grades_ok:false run must still validate (global constraint)."""
    degraded = {"published_at": "2026-07-26T00:00:00Z", "as_of": None,
                "legs": {}, "anchors": [], "scenarios": [],
                "revision_disclosure_pp": 0.27,
                "leadlag": None, "power_nowcast": None}
    jsonschema.validate(degraded, json.loads(SCHEMA.read_text()))


def test_payload_carries_both_legs_and_the_revision_disclosure(payload):
    assert set(payload["legs"]) == {"strict", "extended"}
    assert payload["revision_disclosure_pp"] == 0.27


def test_payload_scenarios_carry_no_grading_statistic(payload):
    banned = {"shortfall_rate_pct", "mae_pp", "bias_pp", "n",
              "mean_shortfall_pp", "worst_shortfall_pp", "independent_draws"}
    for s in payload["scenarios"]:
        assert not (banned & set(s))


def test_payload_carries_the_power_nowcast_grade_with_an_as_of(payload):
    pn = payload["power_nowcast"]
    assert pn["as_of"]
    assert pn["verdict"] in {"PASS", "FAIL", "INSUFFICIENT"}
    assert pn["carry_forward_mae"] is not None


def test_payload_carries_the_leadlag_study_and_its_gate(payload):
    ll = payload["leadlag"]
    assert ll["gate"]
    assert ll["verdict"]
    assert ll["weight_covered"] == pytest.approx(0.45)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dc_grades_publish.py -q`
Expected: FAIL — `ImportError: cannot import name 'dc_grades'`

- [ ] **Step 3: Write the publisher**

```python
# pipeline/publish/dc_grades.py
"""Writer for dc_grades.json -- the /dc-scoreboard grading harness.

Grades the three LIVE-COMPUTABLE escalation bases against realized DC Build
escalation, on two labelled legs, plus the P3c lead-lag study and the power
nowcast's published negative result.

The two hindsight-selected regimes publish their rates and windows and NO
grading statistic. Neither leg may be rendered without the other: the strict
leg's 99%/100% shortfall rates at 36/48 months fall to 65.6%/64.7% once the
extended leg puts a downturn back in the sample, and that spread is itself the
finding (spec 3.1).

ALL derived math lives in engine/dcgrade.py, engine/dcleadlag.py and
engine/powergrade.py; the site renders only."""
from pathlib import Path

from pipeline.engine import dcgrade, dcleadlag, powergrade
from pipeline.publish.util import write_json

# Hand-set to the observed episodes, stated on-page with their bounds. They
# are not derived by a rule and this module does not pretend otherwise.
SCENARIOS = [
    {"key": "gfc", "label": "GFC downturn",
     "start_month": "2008-12-01", "end_month": "2011-12-01"},
    {"key": "covid_peak", "label": "COVID peak",
     "start_month": "2021-04-01", "end_month": "2023-12-01"},
]

PAIRED_LEGS_NOTE = (
    "Two legs, always shown together. The strict leg is vintage-true but its "
    "anchors begin 2015-03 and contain the 2021-22 spike with no downturn; "
    "the extended leg reaches back to 2010-12 on final-revision data, at a "
    "measured 0.27pp maximum distortion. Quoting either leg alone overstates "
    "how much the answer is known.")


def build(conn, components) -> dict:
    payload = dcgrade.build(conn, components, dcgrade.BASE_MONTH, SCENARIOS)
    payload["paired_legs_note"] = PAIRED_LEGS_NOTE
    payload["leadlag"] = dcleadlag.study(conn, components)
    payload["power_nowcast"] = powergrade.run(conn)
    return payload


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "dc_grades.json")
```

- [ ] **Step 4: Write the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dc_grades.json — /dc-scoreboard escalation grading harness",
  "type": "object",
  "required": ["published_at", "as_of", "legs", "anchors", "scenarios",
               "revision_disclosure_pp", "leadlag", "power_nowcast"],
  "properties": {
    "published_at": {"type": "string"},
    "as_of": {"type": ["string", "null"]},
    "paired_legs_note": {"type": "string"},
    "revision_disclosure_pp": {"type": "number"},
    "legs": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["provenance", "span", "anchors_n", "contains_downturn",
                     "grades"],
        "properties": {
          "provenance": {"type": "string"},
          "span": {"type": "array", "items": {"type": ["string", "null"]}},
          "anchors_n": {"type": "integer"},
          "contains_downturn": {"type": "boolean"},
          "grades": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "additionalProperties": {
                "type": ["object", "null"],
                "required": ["n", "independent_draws", "shortfall_rate_pct",
                             "mean_shortfall_pp", "worst_shortfall_pp",
                             "bias_pp", "mae_pp"],
                "properties": {
                  "n": {"type": "integer"},
                  "independent_draws": {"type": "number"},
                  "shortfall_rate_pct": {"type": "number"},
                  "mean_shortfall_pp": {"type": "number"},
                  "worst_shortfall_pp": {"type": "number"},
                  "bias_pp": {"type": "number"},
                  "mae_pp": {"type": "number"}
                }
              }
            }
          }
        }
      }
    },
    "anchors": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["m", "leg", "bases", "realized"],
        "properties": {
          "m": {"type": "string"},
          "leg": {"type": "string"},
          "bases": {"type": "object",
                    "additionalProperties": {"type": ["number", "null"]}},
          "realized": {"type": "object",
                       "additionalProperties": {"type": ["number", "null"]}}
        }
      }
    },
    "scenarios": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "label", "start_month", "end_month",
                     "annualized_pct", "hindsight_selected", "note"],
        "not": {"anyOf": [
          {"required": ["shortfall_rate_pct"]}, {"required": ["mae_pp"]},
          {"required": ["bias_pp"]}, {"required": ["n"]},
          {"required": ["independent_draws"]},
          {"required": ["mean_shortfall_pp"]},
          {"required": ["worst_shortfall_pp"]}
        ]},
        "properties": {
          "key": {"type": "string"},
          "label": {"type": "string"},
          "start_month": {"type": "string"},
          "end_month": {"type": "string"},
          "annualized_pct": {"type": ["number", "null"]},
          "hindsight_selected": {"const": true},
          "note": {"type": "string"}
        }
      }
    },
    "leadlag": {
      "type": ["object", "null"],
      "required": ["mappings", "weight_covered", "weight_stable", "verdict",
                   "gate"],
      "properties": {
        "weight_covered": {"type": "number"},
        "weight_stable": {"type": "number"},
        "verdict": {"type": "string"},
        "gate": {"type": "string"},
        "mappings": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["driver", "component", "best_lag_months",
                         "best_correlation", "stable", "profile"],
            "properties": {
              "driver": {"type": "string"},
              "driver_label": {"type": "string"},
              "component": {"type": "string"},
              "component_label": {"type": "string"},
              "weight": {"type": "number"},
              "months": {"type": "integer"},
              "span": {"type": "array",
                       "items": {"type": ["string", "null"]}},
              "best_lag_months": {"type": ["integer", "null"]},
              "best_correlation": {"type": ["number", "null"]},
              "stable": {"type": "boolean"},
              "first_half": {"type": "object"},
              "second_half": {"type": "object"},
              "profile": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["lag", "corr"],
                  "properties": {
                    "lag": {"type": "integer"},
                    "corr": {"type": ["number", "null"]}
                  }
                }
              }
            }
          }
        }
      }
    },
    "power_nowcast": {
      "type": ["object", "null"],
      "required": ["as_of", "months_graded", "carry_forward_mae",
                   "best_lambda", "best_mae", "verdict", "note"],
      "properties": {
        "as_of": {"type": ["string", "null"]},
        "months_graded": {"type": "integer"},
        "carry_forward_mae": {"type": ["number", "null"]},
        "best_lambda": {"type": ["number", "null"]},
        "best_mae": {"type": ["number", "null"]},
        "verdict": {"enum": ["PASS", "FAIL", "INSUFFICIENT"]},
        "note": {"type": "string"}
      }
    }
  }
}
```

- [ ] **Step 5: Wire the run_daily phase**

In `pipeline/run_daily.py`, add the import alongside the other publishers:

```python
from pipeline.publish import (..., dc_grades as dc_grades_json, ...)
```

Add the phase immediately after `_run_phase("MARKETS", ...)`:

```python
    # Escalation grading harness (/dc-scoreboard): isolated like the phases
    # above. It reads ALFRED vintages the daily run never writes, so a gap in
    # that history must degrade this artifact alone -- never the DC index.
    def _grades_phase():
        registry_codes = {s.code for s in series}
        _, baskets = dc_basket.load_baskets(registry_codes=registry_codes)
        grades_path = dc_grades_json.write(
            dc_grades_json.build(conn, baskets["build"]),
            args.out, published_at=published_at)
        validate.validate_file(grades_path, SCHEMAS / "dc_grades.schema.json")
        print(f"published: {grades_path}")

    _run_phase("GRADES", _grades_phase, phase_errors, "grades")
```

Update the module docstring's numbered phase list to include `(11) the escalation grading harness (surfaces via grades_ok)`, and change "ten ISOLATED try/except blocks" to "eleven".

In `pipeline/publish/qa.py`, extend both:

```python
PHASES = ("nowcast", "outlook", "composites", "datacenter", "geography",
          "labor", "commodities", "capacity", "markets", "grades")
_PHASE_DONE = {..., "grades": "escalation grading harness completed"}
```

- [ ] **Step 6: Run the full pipeline suite**

```bash
pytest tests/test_dc_grades_publish.py -q && pytest -q
```

Expected: 6 passed, then the full suite green (was 696; now ~740 with the new tests). `qa` cross-checks `phase_errors` against `qa.PHASES` in both directions, so a missed entry fails loudly.

- [ ] **Step 7: Generate the artifact and eyeball it**

```bash
set -a && . ./.env && set +a
.venv/bin/python -m pipeline.run_daily --store store --out site/public/data
ls -la site/public/data/dc_grades.json
.venv/bin/python -c "
import json; d=json.load(open('site/public/data/dc_grades.json'))
print('as_of', d['as_of'], '| anchors', len(d['anchors']))
for k,l in d['legs'].items(): print(k, l['span'], l['anchors_n'])
print('leadlag:', d['leadlag']['verdict'])
print('power:', d['power_nowcast']['verdict'],
      d['power_nowcast']['carry_forward_mae'], d['power_nowcast']['best_mae'])
"
```

Expected: `GRADES` prints `published:`, the file exists, and the printed spans match Task 5 Step 5. Note the lead-lag verdict — **it is a real result either way** and Task 10's copy must reflect what it actually says.

- [ ] **Step 8: Commit**

```bash
git add pipeline/publish/dc_grades.py schemas/dc_grades.schema.json \
        tests/test_dc_grades_publish.py pipeline/run_daily.py \
        pipeline/publish/qa.py site/public/data/dc_grades.json
git commit -m "feat(grades): publish dc_grades.json from an isolated phase

Schema forbids any grading statistic under a scenario, so the spec's
rules-vs-scenarios separation is enforced by validation rather than by
convention."
```

---

## Task 9: Site types and the `dcGrades` lib

**Files:**
- Create: `site/src/lib/dcGrades.ts`, `site/src/lib/dcGrades.test.ts`
- Modify: `site/src/lib/types.ts`

**Interfaces:**
- Produces:
  - Types `GradeStat`, `Leg`, `DcGrades`, `LegKey = "strict" | "extended"`
  - `horizonKey(months: number): string`
  - `nearestHorizon(months: number): number`
  - `pairedShortfall(data, basis, months): { strict: number | null; extended: number | null }`
  - `formatPairedVerdict(basis, months, pair): string`

`pairedShortfall` returns **both** legs by construction — there is no single-leg accessor, so the global constraint cannot be violated by a caller.

- [ ] **Step 1: Write the failing tests**

```ts
// site/src/lib/dcGrades.test.ts
import { describe, expect, it } from "vitest";
import {
  formatPairedVerdict, horizonKey, nearestHorizon, pairedShortfall,
} from "./dcGrades";
import type { DcGrades } from "./types";

const data = {
  published_at: "2026-07-26T00:00:00Z",
  as_of: "2026-06",
  revision_disclosure_pp: 0.27,
  paired_legs_note: "…",
  anchors: [],
  scenarios: [],
  leadlag: null,
  power_nowcast: null,
  legs: {
    strict: {
      provenance: "vintage-true", span: ["2015-03", "2026-06"],
      anchors_n: 132, contains_downturn: false,
      grades: {
        long_run: { h12: stat(66.9), h24: stat(79.8), h36: stat(99.0), h48: stat(100) },
        trailing_3yr: { h12: stat(52.9), h24: stat(61.5), h36: stat(77.3), h48: stat(88.2) },
        current_momentum: { h12: stat(59.5), h24: stat(64.2), h36: stat(70.1), h48: stat(82.4) },
      },
    },
    extended: {
      provenance: "final-revision", span: ["2010-12", "2026-06"],
      anchors_n: 187, contains_downturn: true,
      grades: {
        long_run: { h12: stat(48.6), h24: stat(55.2), h36: stat(65.6), h48: stat(64.7) },
        trailing_3yr: { h12: stat(42.3), h24: stat(42.9), h36: stat(56.3), h48: stat(66.2) },
        current_momentum: { h12: stat(53.1), h24: stat(54.6), h36: stat(56.3), h48: stat(70.5) },
      },
    },
  },
} as unknown as DcGrades;

function stat(shortfall: number) {
  return {
    n: 100, independent_draws: 8.3, shortfall_rate_pct: shortfall,
    mean_shortfall_pp: 4, worst_shortfall_pp: 12, bias_pp: -1, mae_pp: 3,
  };
}

describe("horizonKey / nearestHorizon", () => {
  it("maps months onto the published horizon buckets", () => {
    expect(horizonKey(12)).toBe("h12");
    expect(horizonKey(48)).toBe("h48");
  });

  it("snaps an arbitrary delivery window to the nearest graded horizon", () => {
    expect(nearestHorizon(1)).toBe(12);
    expect(nearestHorizon(17)).toBe(12);
    expect(nearestHorizon(19)).toBe(24);
    expect(nearestHorizon(40)).toBe(36);
    expect(nearestHorizon(60)).toBe(48);
  });
});

describe("pairedShortfall", () => {
  it("always returns both legs, never one", () => {
    const p = pairedShortfall(data, "long_run", 36);
    expect(p).toEqual({ strict: 99.0, extended: 65.6 });
  });

  it("returns nulls rather than throwing when a leg is missing", () => {
    const bare = { ...data, legs: {} } as unknown as DcGrades;
    expect(pairedShortfall(bare, "long_run", 36))
      .toEqual({ strict: null, extended: null });
  });

  it("returns nulls when the horizon has no gradeable anchors", () => {
    const thin = {
      ...data,
      legs: { ...data.legs, strict: { ...data.legs.strict,
        grades: { ...data.legs.strict.grades,
          long_run: { ...data.legs.strict.grades.long_run, h48: null } } } },
    } as unknown as DcGrades;
    expect(pairedShortfall(thin, "long_run", 48).strict).toBeNull();
  });
});

describe("formatPairedVerdict", () => {
  it("names both legs in one sentence", () => {
    const s = formatPairedVerdict("long_run", 36,
      { strict: 99.0, extended: 65.6 });
    expect(s).toContain("99.0%");
    expect(s).toContain("65.6%");
    expect(s).toContain("36-month");
  });

  it("says so plainly when neither leg can be graded", () => {
    expect(formatPairedVerdict("long_run", 36, { strict: null, extended: null }))
      .toBe("Not gradeable at a 36-month horizon on either sample.");
  });

  it("never renders one leg alone", () => {
    const s = formatPairedVerdict("long_run", 36, { strict: 99.0, extended: null });
    expect(s).toContain("99.0%");
    expect(s).toContain("not gradeable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd site && npx vitest run src/lib/dcGrades.test.ts`
Expected: FAIL — cannot resolve `./dcGrades`

- [ ] **Step 3: Add the types**

Append to `site/src/lib/types.ts`:

```ts
export type GradeStat = {
  n: number;
  independent_draws: number;
  shortfall_rate_pct: number;
  mean_shortfall_pp: number;
  worst_shortfall_pp: number;
  bias_pp: number;
  mae_pp: number;
};

export type Leg = {
  provenance: string;
  span: [string | null, string | null];
  anchors_n: number;
  contains_downturn: boolean;
  grades: Record<string, Record<string, GradeStat | null>>;
};

export type LeadLagMapping = {
  driver: string; driver_label: string;
  component: string; component_label: string;
  weight: number; months: number; span: [string | null, string | null];
  best_lag_months: number | null; best_correlation: number | null;
  stable: boolean;
  first_half: { best_lag_months: number | null; best_correlation: number | null };
  second_half: { best_lag_months: number | null; best_correlation: number | null };
  profile: { lag: number; corr: number | null }[];
};

export type DcGrades = {
  published_at: string;
  as_of: string | null;
  paired_legs_note: string;
  revision_disclosure_pp: number;
  legs: Record<string, Leg>;
  anchors: {
    m: string; leg: string;
    bases: Record<string, number | null>;
    realized: Record<string, number | null>;
  }[];
  scenarios: {
    key: string; label: string; start_month: string; end_month: string;
    annualized_pct: number | null; hindsight_selected: true; note: string;
  }[];
  leadlag: {
    mappings: LeadLagMapping[];
    weight_covered: number; weight_stable: number;
    verdict: string; gate: string;
  } | null;
  power_nowcast: {
    as_of: string | null; months_graded: number;
    carry_forward_mae: number | null; best_lambda: number | null;
    best_mae: number | null; verdict: "PASS" | "FAIL" | "INSUFFICIENT";
    note: string;
  } | null;
};
```

- [ ] **Step 4: Implement the lib**

```ts
// site/src/lib/dcGrades.ts
/** Reading helpers for the escalation grading harness (dc_grades.json).
 *
 *  There is deliberately NO single-leg accessor. The strict leg's 36- and
 *  48-month shortfall rates read 99% and 100%; on the extended leg the same
 *  rows read 65.6% and 64.7%. That spread is the finding — how much the answer
 *  depends on whether your sample contains a downturn — so every accessor here
 *  returns BOTH legs and every formatter names both. A caller cannot render
 *  one alone without writing new code to do it.
 */
import type { DcGrades } from "./types";

export type LegKey = "strict" | "extended";
export type PairedShortfall = { strict: number | null; extended: number | null };

/** The horizons the harness grades, matching /escalation's 48-month cap. */
export const HORIZONS = [12, 24, 36, 48] as const;

export const BASIS_LABELS: Record<string, string> = {
  long_run: "Long-run",
  trailing_3yr: "Trailing 3yr",
  current_momentum: "Current momentum",
};

export function horizonKey(months: number): string {
  return `h${months}`;
}

/** Snap an arbitrary delivery window onto the nearest graded horizon.
 *  Ties round down — claiming the longer horizon's grade for a shorter
 *  window would borrow a thinner sample than the reader actually faces. */
export function nearestHorizon(months: number): number {
  let best = HORIZONS[0];
  let bestGap = Math.abs(months - best);
  for (const h of HORIZONS) {
    const gap = Math.abs(months - h);
    if (gap < bestGap) {
      best = h;
      bestGap = gap;
    }
  }
  return best;
}

export function pairedShortfall(
  data: DcGrades, basis: string, months: number,
): PairedShortfall {
  const key = horizonKey(nearestHorizon(months));
  const read = (leg: LegKey) =>
    data.legs?.[leg]?.grades?.[basis]?.[key]?.shortfall_rate_pct ?? null;
  return { strict: read("strict"), extended: read("extended") };
}

export function formatPairedVerdict(
  basis: string, months: number, pair: PairedShortfall,
): string {
  const h = nearestHorizon(months);
  const label = BASIS_LABELS[basis] ?? basis;
  if (pair.strict === null && pair.extended === null) {
    return `Not gradeable at a ${h}-month horizon on either sample.`;
  }
  const part = (v: number | null) =>
    v === null ? "not gradeable" : `${v.toFixed(1)}%`;
  return (
    `${label} under-provisioned ${part(pair.strict)} of ${h}-month windows ` +
    `on the vintage-true sample and ${part(pair.extended)} on the deeper ` +
    `sample that includes a downturn.`
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd site && npx vitest run src/lib/dcGrades.test.ts`
Expected: 8 passed

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/dcGrades.ts site/src/lib/dcGrades.test.ts site/src/lib/types.ts
git commit -m "feat(site): dcGrades lib with no single-leg accessor

pairedShortfall returns both legs by construction, so the paired-legs rule
cannot be violated by a caller reaching for a convenient one-leg helper."
```

---

## Task 10: The `/dc-scoreboard` page

**Files:**
- Create: `site/src/app/dc-scoreboard/page.tsx`, `site/src/components/grades/GradesClient.tsx`
- Modify: `site/src/lib/nav.ts`

**Interfaces:**
- Consumes: Task 9's `DcGrades`, `BASIS_LABELS`, `HORIZONS`, `formatPairedVerdict`; `KpiCard`

Follow `site/src/app/markets/page.tsx`: import the JSON at module scope, cast through `unknown` to the type, compute metadata from it, and keep the page a server component with a small client child.

- [ ] **Step 1: Write the page**

Content requirements — each is a spec obligation, not a suggestion:

1. **Lede** naming the wedge: these are the bases `/escalation` offers, graded against what escalation actually did.
2. **Paired grading table**: rows = the three rolling bases × the four horizons; columns = shortfall rate **strict and extended side by side**, then mean/worst shortfall, bias, MAE. Render `data.paired_legs_note` above it.
3. **The inversion, stated in prose**, from the rendered numbers — best MAE ≠ best contingency — with the §3.1 caveat that it attenuates on the deeper sample. Do **not** hardcode "99%"; read it from the artifact.
4. **Independent draws rendered live per row**, with plain language that the 48-month row is the weakest. No hardcoded threshold claim.
5. **Scenario section**, visually separate, showing key/label/window/annualized rate/`note`, and stating the windows were hindsight-selected and are therefore ungradeable. No statistics.
6. **Lead-lag section**: `verdict`, `gate`, and a per-mapping table (driver, component, weight, best lag, correlation, split-half lags, `stable`). If `weight_stable` is 0, say plainly that backlogs did not show a stable lead and that no forward model is warranted — a negative result published as one.
7. **Methodology block**: ALFRED provenance, the 2015-03 vintage floor, `revision_disclosure_pp`, the rebase-cancels note, and anchor dedupe.

```tsx
// site/src/app/dc-scoreboard/page.tsx
import type { Metadata } from "next";
import gradesJson from "../../../public/data/dc_grades.json";
import { GradesClient } from "@/components/grades/GradesClient";
import type { DcGrades } from "@/lib/types";

const data = gradesJson as unknown as DcGrades;
const strict = data.legs?.strict;
const extended = data.legs?.extended;

export const metadata: Metadata = {
  title: "DC Escalation Scoreboard: did each contingency basis carry enough?",
  description:
    "Every escalation basis on /escalation, graded against what DC build costs actually did — vintage-true, on two labelled samples.",
};

export default function Page() {
  return (
    <div>
      <h1>
        DC Escalation Scoreboard{" "}
        <span className="subtitle">did the basis you carried hold?</span>
      </h1>
      <p className="lede">
        <b>/escalation offers five bases. This grades the three that are
        rules.</b> For every month we can reconstruct what the DC Build index
        actually read at the time, we compute what each basis would have told
        you to carry, carry it, and compare against what escalation actually
        did. The metric is the one a capital program is judged on — did you
        carry enough — not the one a forecaster reaches for.
      </p>
      <GradesClient data={data} />
    </div>
  );
}
```

Write `GradesClient.tsx` rendering requirements 2–7 above. Keep it a presentational component: all math already happened in the pipeline, and the only derivation allowed here is formatting.

- [ ] **Step 2: Add the nav entry**

In `site/src/lib/nav.ts`, add to the `AI Infra` group's `items`, after `/escalation`:

```ts
{ href: "/dc-scoreboard", label: "Escalation Grades", emoji: "🎯" },
```

- [ ] **Step 3: Build and check for console errors**

```bash
cd site && npm run build
```

Expected: build succeeds and `/dc-scoreboard` appears in the route list as a static export.

- [ ] **Step 4: Verify the paired-legs rule holds in the rendered output**

```bash
cd site && npx playwright test --grep "dc-scoreboard" || true
grep -c "shortfall" src/components/grades/GradesClient.tsx
```

Then read `GradesClient.tsx` once end-to-end and confirm every shortfall figure has its counterpart leg in the same row or sentence. This is a **manual gate**; there is no lint rule for it.

- [ ] **Step 5: Commit**

```bash
git add site/src/app/dc-scoreboard site/src/components/grades site/src/lib/nav.ts
git commit -m "feat(site): /dc-scoreboard renders the grading harness

Every shortfall figure renders with its counterpart leg. Scenarios render
rates and windows only. Independent draws render live rather than against a
hardcoded threshold, which would go stale as the sample grows."
```

---

## Task 11: Inline verdict on `/escalation`

**Files:**
- Modify: `site/src/components/DcEscalationClient.tsx`

**Interfaces:**
- Consumes: Task 9's `pairedShortfall`, `formatPairedVerdict`; `DcGrades`

The component is already 450 lines. This adds a **small** block — the verdict sentence plus a link — and nothing else. Do not move grading logic into it.

- [ ] **Step 1: Write the failing e2e test**

```ts
// append to site/e2e/smoke.spec.ts
test("escalation shows a paired-leg grade for the selected basis", async ({
  page,
}) => {
  await page.goto("/escalation");
  await expect(page.getByText("Total escalation")).toBeVisible();

  // set a delivery month far enough out to have a forward leg
  const delivery = page.locator('input[type="month"]').last();
  await delivery.fill("2029-06");
  await delivery.blur();

  // the verdict must name BOTH samples — never one alone
  const verdict = page.getByTestId("basis-grade");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("vintage-true sample");
  await expect(verdict).toContainText("deeper sample");
  await expect(page.getByRole("link", { name: /how each basis has held up/i }))
    .toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && npx playwright test --grep "paired-leg grade"`
Expected: FAIL — `basis-grade` testid not found

- [ ] **Step 3: Implement**

Pass `grades` into `DcEscalationClient` from `site/src/app/escalation/page.tsx` (import `dc_grades.json` there the same way `datacenter.json` is imported), then render beside the CARRY control:

```tsx
{grades && deliveryMonths > 0 && (
  <p className="note" data-testid="basis-grade">
    {formatPairedVerdict(
      selectedBasisKey, deliveryMonths,
      pairedShortfall(grades, selectedBasisKey, deliveryMonths))}{" "}
    <a href="/dc-scoreboard">See how each basis has held up →</a>
  </p>
)}
```

`selectedBasisKey` must map the component's existing basis key onto `dcGrades`'s keys (`long_run`, `trailing_3yr`, `current_momentum`). If the reader has selected one of the two **scenarios**, render the ungradeable note instead of a verdict — scenarios have no grade:

```tsx
{grades && deliveryMonths > 0 && isScenario(selectedBasisKey) && (
  <p className="note" data-testid="basis-grade">
    This is a hindsight-selected historical episode, not a rule — it carries
    no grade. <a href="/dc-scoreboard">See the bases that do →</a>
  </p>
)}
```

- [ ] **Step 4: Run the tests**

```bash
cd site && npm test && npx playwright test --grep "paired-leg grade"
```

Expected: vitest green, the new e2e test passes.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/DcEscalationClient.tsx site/src/app/escalation/page.tsx site/e2e/smoke.spec.ts
git commit -m "feat(escalation): inline paired-leg grade at the basis picker

Selecting a scenario renders the ungradeable note rather than a verdict —
the two hindsight-selected episodes carry no grade anywhere."
```

---

## Task 12: Render the power-nowcast MAE from the artifact

**Files:**
- Modify: `site/src/app/datacenter/page.tsx:211-220`

**Interfaces:**
- Consumes: `DcGrades["power_nowcast"]`

The literal to remove is `best MAE 8.5 vs 5.2 YoY pts` at line 217. A live re-run reads carry-forward 4.778 / best λ=0.25 MAE 8.452 — verdict unchanged, number one print stale. **Retyping the correct literal would only reset the staleness clock.**

- [ ] **Step 1: Write the failing test**

```ts
// append to site/e2e/smoke.spec.ts
test("datacenter renders the power-nowcast grade from the artifact", async ({
  page,
}) => {
  await page.goto("/datacenter");
  const method = page.getByText(/like-month year-ratio nowcast/);
  await expect(method).toBeVisible();
  // the stale hardcoded pair must be gone
  await expect(page.getByText("best MAE 8.5 vs 5.2 YoY pts")).toHaveCount(0);
  // and the live figures must be present with an as-of
  await expect(page.getByTestId("power-nowcast-grade")).toContainText("MAE");
  await expect(page.getByTestId("power-nowcast-grade")).toContainText("as of");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && npx playwright test --grep "power-nowcast grade"`
Expected: FAIL — the stale string is still present

- [ ] **Step 3: Implement**

Import `dc_grades.json` in `site/src/app/datacenter/page.tsx` alongside `datacenter.json`, then replace the hardcoded clause:

```tsx
const pn = (gradesJson as unknown as DcGrades).power_nowcast;
```

```tsx
{" "}and backtested it against realized retail prints before letting it touch
the index: <span data-testid="power-nowcast-grade">
  it lost to simple carry-forward at every pass-through level tested
  {pn && pn.best_mae != null && pn.carry_forward_mae != null
    ? ` (best MAE ${pn.best_mae} vs ${pn.carry_forward_mae} YoY pts over ${pn.months_graded} months, as of ${pn.as_of})`
    : ""}
</span>, so the ops index stays on official retail data and the machinery
ships config-gated.
```

Keep the surrounding prose byte-identical apart from this clause — `site/e2e/smoke.spec.ts` asserts against neighbouring phrases.

- [ ] **Step 4: Run the tests**

```bash
cd site && npm run build && npx playwright test --grep "power-nowcast grade"
```

Expected: build clean, test passes, no stale literal anywhere:

```bash
rg -n "8\.5 vs 5\.2" site/src/ && echo "STALE LITERAL STILL PRESENT" || echo "clean"
```

- [ ] **Step 5: Commit**

```bash
git add site/src/app/datacenter/page.tsx site/e2e/smoke.spec.ts
git commit -m "fix(datacenter): render the power-nowcast grade from the artifact

The literal carried no as-of, was in none of the published JSONs, was not
schema-validated, and nothing in CI would catch it drifting. It is now a
published number under a schema. Verdict unchanged."
```

---

## Task 13: Full green, e2e route, and register corrections

**Files:**
- Modify: `site/e2e/smoke.spec.ts`, `CLAUDE.md`, `todo.md`
- Modify: `docs/plans/2026-07-24-project-controls-gaps.md`
- Modify: `docs/superpowers/specs/2026-07-25-dc-contingency-table-design.md`

- [ ] **Step 1: Add `/dc-scoreboard` to the e2e route table**

In `site/e2e/smoke.spec.ts`'s route list (near `["/markets", ...]` at line 34):

```ts
["/dc-scoreboard", "did the basis you carried hold?"],
```

- [ ] **Step 2: Run every suite**

```bash
pytest -q
cd site && npm test && npm run build && npm run e2e
```

Expected: pytest green (~740), vitest green, build clean, e2e green with **zero console errors** across 29 routes / 41 tests. Fix anything red before proceeding — do not carry a failure into the docs step.

- [ ] **Step 3: Correct the register**

In `docs/plans/2026-07-24-project-controls-gaps.md`, under the P3 entry's "SECOND CORRECTION" block, **replace** bullet 4 (`A vintage-true DC backtest is impossible before roughly mid-2027`) with:

```markdown
- **⚠ THIRD CORRECTION (P3b recon, verified 2026-07-26 —
  `docs/superpowers/specs/2026-07-26-dc-grading-harness-design.md` §2.1).
  The "vintage-true backtest impossible before mid-2027" claim above is
  REFUTED and must not be re-derived.** It was inferred from the store,
  which was backfilled in single sweeps — but ALFRED carries real release
  history for all 12 Build components (weight 1.000), and
  `fred.fetch_vintages` already existed. Vintage-true reconstruction runs
  back to **2015-03**, giving 132 anchors. The real constraint is sample
  depth: **10.08 independent draws at h=12, but 2.69 at h=36 and 1.77 at
  h=48** — so a forward model is gradeable at one year and not at the
  horizons a 2029 energization budgets against, and anchors accrue at only
  ~1/month. Revision distortion measured at ±0.27pp on the annualized rate.
```

Update the P3 status line to record P3b as shipped and P3c as scoped-to-measurement, and update "Suggested build order" so the next reader starts at P4 or P7.

- [ ] **Step 4: Annotate the P3a spec rather than editing it**

In `docs/superpowers/specs/2026-07-25-dc-contingency-table-design.md` §2.1, append to item 4 (do **not** rewrite the original text — that document handles its own corrections by annotation):

```markdown
   **Correction, 2026-07-26 (P3b recon):** this item is refuted. ALFRED has
   real vintages for all 12 Build components, so vintage-true reconstruction
   works back to 2015-03 and P3b's grading harness ships on it. The claim was
   true of the *store*, not of the *available data*. See
   `docs/superpowers/specs/2026-07-26-dc-grading-harness-design.md` §2.1.
```

- [ ] **Step 5: Update `CLAUDE.md` and `todo.md`**

In `CLAUDE.md`:
- Published-file count 34 → **35**, adding `dc_grades` to the list.
- "ten ISOLATED try/except blocks" → **eleven**, adding `grades_ok`.
- Connector/series counts if the three new FRED series change any stated total.
- Test count in the Commands block to whatever `pytest -q` actually reports.

In `todo.md`, mark the P3b register item done and reword the P3c item to reflect that it is now a measurement whose verdict is published.

- [ ] **Step 6: Final verification and commit**

```bash
pytest -q && cd site && npm test && npm run build && npm run e2e && cd ..
git add -A
git commit -m "docs(p3b): correct the register's refuted vintage premise

The 'impossible before mid-2027' claim was true of the store, not of the
available data. Replaced with the measured constraint: gradeable at h=12
on 10.08 independent draws, not gradeable at h=36-48 on 2.69 and 1.77."
git push -u origin feat/dc-grading-harness
```

**Do not merge without approval.** Push triggers a Vercel preview only; production deploys from `main`.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2.1 ALFRED vintages exist | 1 |
| §2.2 sample-depth constraint | 5, 10 (rendered live), 13 (register) |
| §2.3 ±0.27pp revision disclosure | 5, 8 (schema), 10 |
| §3 shortfall-first metrics | 4 |
| §3.1 both legs, never alone | 5, 8, 9, 10, 11 |
| §4.1 backfill script + guard | 1 |
| §4.1 `dcgrade.py` | 2, 3, 4, 5 |
| §4.1 publisher, schema, phase, qa | 8 |
| §4.1 three NSA registry series | 6 |
| §4.2 `/dc-scoreboard`, lib, inline verdict | 9, 10, 11 |
| §5.1 rebase cancels, anchor dedupe | 2, 3 |
| §5.2 two legs, 2010-12 extended start | 5 |
| §5.3 scenarios ungraded | 5, 8 (schema `not`), 10, 11 |
| §5.4 metrics, realized always final | 4 |
| §5.5 payload shape | 5, 8 |
| §6 lead-lag + split-half gate | 6 |
| §7 stale MAE string | 7, 12 |
| §9 risks 1–6 | 1 (r2), 2 (r3), 5 (r1), 6 (r5), 10 (r4), 8 (r6) |
| §10 acceptance 1–10 | 5, 8, 9, 10, 11, 12, 13 |
| §11 invariants | 1, 6, 8, 13 |
| §12 register corrections | 13 |

**Gaps found and closed during review:**
- Acceptance criterion 5 (reconstruction pin) had no task; added as Task 3's `test_reconstruction_matches_the_published_build_index`, written as agreement between two computations rather than a pinned constant so it cannot go stale.
- Risk 3 (anchor double-counting) had no test; added Task 2's `test_anchors_dedupe_by_last_observation_month`.
- Spec §11 says to extend `test_run_daily.py`'s `fake_get`; the existing fake already returns a generic FRED fixture for any `series_id`, so Task 6 Step 5 **verifies** rather than assumes, and says what to do if it fails.

**Type consistency:** `bases_at` → `{basis_key: float | None}` consumed by `grade` as `anchor_bases: [(month, dict)]` (Tasks 3→4→5); `pairedShortfall` → `{strict, extended}` consumed by `formatPairedVerdict` (Task 9) and `DcEscalationClient` (Task 11); `powergrade.run()` keys match the schema's `power_nowcast` block (Tasks 7→8) and the page's reads (Task 12); basis keys `long_run` / `trailing_3yr` / `current_momentum` are identical in `ROLLING_BASES`, the schema, `BASIS_LABELS`, and the tests.
