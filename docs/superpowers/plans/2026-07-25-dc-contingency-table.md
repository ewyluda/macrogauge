# P3a — DC Escalation Contingency Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/escalation` a "deliver by" input and a contingency-basis table, so a Project Controls reader gets a defensible escalation factor for their delivery window — backed by a DC Build index backfilled to 2007-12 so the sample actually contains a downturn.

**Architecture:** Pipeline work is a one-shot FRED backfill plus a grid-start change — nothing else. All contingency math is client-side, computed from `indexes.build.monthly`, which `/escalation` already loads. **No new published artifact, no new JSON Schema, no new `run_daily` phase, no `qa.PHASES` wiring, no `*_ok` flag.**

**Tech Stack:** Python 3.12 (pytest), Next.js static export (vitest + Playwright), FRED API via the existing connector.

**Spec:** `docs/superpowers/specs/2026-07-25-dc-contingency-table-design.md`

## Global Constraints

- **No forecast claim.** Every published number is a statement about what has already happened. No gate, no model, no central path.
- **HTTP is injected, never real, in tests.** Connectors and scripts take `http_get`; tests pass fakes. Never add a test that hits the network.
- **Store rows are append-only.** Never rewrite a committed partition. The backfill adds rows for earlier `obs_date`s — exactly what the store is for.
- **Bases are annualized index ratios over a stated window** — never a median or mean of YoY prints. A median cannot be decomposed additively.
- **Decompose the cumulative delta, annualize the total only.** `contrib_i = w_i · (I_i(b) − I_i(a)) / H(a)`. Annualizing per-component then weighting leaves a Jensen gap up to 0.089pp and the bridge stops summing.
- **Every basis anchors on the last complete month**, derived as `min(components[].last_obs)`, never `months[months.length - 1]` (the trailing stub).
- **Delivery-date input cap: 48 months** past the last complete month. Band horizons: min 12, max 48.
- **Spike window for overlap disclosure: `2021-04` → `2022-12`** (a stated constant).
- **No location input.** Parity multipliers are level, not rate. Unchanged from P1.
- Published **daily** arrays keep their `2018-01` start; published **monthly** arrays extend to `2007-12`.

---

## File Structure

| file | responsibility |
|---|---|
| `scripts/backfill_dc_history.py` | **new** — one-shot deep FRED fetch for the 12 Build components |
| `tests/test_backfill_dc_history.py` | **new** — injected-HTTP test for the script |
| `pipeline/engine/dcindex.py:23-24` | **modify** — `GRID_START` → `2007-12-01`, add `MONTHLY_PUBLISH_START` |
| `pipeline/publish/datacenter.py:34-44` | **modify** — monthly slice uses `MONTHLY_PUBLISH_START` |
| `tests/test_dcindex.py` | **modify** — two fixtures/comments affected by the grid move |
| `tests/test_datacenter_writer.py` | **modify** — pin the two-start-dates behaviour |
| `site/src/lib/dcEscalation.ts` | **modify** — export month helpers, add `bridgeWindow()`, add optional forward segment |
| `site/src/lib/dcEscalation.test.ts` | **modify** — cover the new surface |
| `site/src/lib/dcContingency.ts` | **new** — anchor, named bases, percentile band |
| `site/src/lib/dcContingency.test.ts` | **new** |
| `site/src/components/DcEscalationClient.tsx` | **modify** — DELIVER BY input, basis table, band |
| `site/src/app/escalation/page.tsx` | **modify** — data slice gains `componentLastObs`, methodology copy rewritten |
| `site/e2e/smoke.spec.ts` | **modify** — assertions for the forward leg |

---

## Pre-cleared risk (do not re-investigate)

The spec flagged a possible discontinuity where `PCU23821X23821X` and `PCU23822X23822X` begin at 2007-12. **Measured 2026-07-25: cleared.** Both series start at exactly `100.0` in 2007-12 — that is the BLS index base (Dec 2007 = 100), not a data artifact. Largest first-year MoM z-scores against each series' own full-sample MoM distribution are 1.60 and 3.10; the 3.10 is the +2.28% Oct-2008 commodity spike, not inception. **There is no splice at 2007-12** because the grid starts where all twelve components exist. Proceed.

---

## Task 1: One-shot DC history backfill script

**Files:**
- Create: `scripts/backfill_dc_history.py`
- Test: `tests/test_backfill_dc_history.py`

**Interfaces:**
- Consumes: `pipeline.connectors.fred.fetch(series_ids, api_key, observation_start=..., http_get=...) -> list[Observation]`; `pipeline.store.vintage.append(observations, store_dir) -> int`; `pipeline.registry.load_registry()`.
- Produces: `main(argv=None, http_get=None) -> int`. Later tasks rely on the store containing `ppi_*`/`ces_constr_ahe` rows back to 2007-12.

**Why `vintage.append` and not `append_vintages`:** we are adding *historical observations under today's vintage*, not recovering real release dates. `append` value-dedupes, so obs_dates already stored at the same value are skipped and re-running is a near-no-op. `append_vintages` is for ALFRED release history and is the wrong tool here.

**Why the internal-code remap matters:** `fred.fetch` stamps `series_code=<FRED id>` (e.g. `WPU1017`). The store keys on our internal codes (`ppi_steel`). `pipeline/collect.py:210-212` does this remap with `dataclasses.replace`; this script must do the same or the rows are invisible to the engine.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_backfill_dc_history.py
"""Injected-HTTP test for the one-shot DC history backfill."""
import json
from pathlib import Path

from scripts import backfill_dc_history
from pipeline.store import vintage


class FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def make_get(seen: list):
    def fake_get(url, params=None, timeout=None):
        seen.append(params)
        sid = params["series_id"]
        return FakeResp({"observations": [
            {"date": "2007-12-01", "value": "100.0"},
            {"date": "2008-01-01", "value": "101.0"},
            {"date": "2026-06-01", "value": "150.0"},
        ]})
    return fake_get


def test_backfill_writes_internal_codes_not_fred_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    rc = backfill_dc_history.main(
        ["--store", str(tmp_path)], http_get=make_get(seen))
    assert rc == 0

    conn = vintage.load(tmp_path)
    # internal codes, not WPU1017 / CES2000000003
    assert dict(vintage.latest(conn, "ppi_steel"))["2007-12-01"] == 100.0
    assert dict(vintage.latest(conn, "ces_constr_ahe"))["2008-01-01"] == 101.0
    assert vintage.latest(conn, "WPU1017") == []
    assert vintage.latest(conn, "CES2000000003") == []


def test_backfill_requests_deep_observation_start(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert seen, "no HTTP calls made"
    assert all(p["observation_start"] == "2007-12-01" for p in seen)


def test_backfill_covers_all_twelve_build_components(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    seen: list = []
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get(seen))
    assert {p["series_id"] for p in seen} == {
        "CES2000000003", "PCU23821X23821X", "PCU23822X23822X", "WPU1017",
        "PCU327320327320", "WPU10260314", "WPU102501", "WPU1175", "WPU1174",
        "PCU333611333611", "PCU333415333415", "WPU1141"}


def test_backfill_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    before = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    backfill_dc_history.main(["--store", str(tmp_path)], http_get=make_get([]))
    after = sorted(p.read_text() for p in (tmp_path / "obs").glob("*.jsonl"))
    assert before == after, "re-running the backfill must be a no-op"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pytest tests/test_backfill_dc_history.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.backfill_dc_history'`

- [ ] **Step 3: Write the script**

```python
# scripts/backfill_dc_history.py
"""One-time deep-history backfill for the DC Build index components.

The original DC backfill fetched from 2017-01-01, which left the Build index
with 102 usable months — a sample containing exactly one month of negative
YoY and no construction downturn at all. Every horizon-matched percentile
band computed on it collapsed with horizon, because 100% of 48-month windows
contained the 2021-22 spike.

All twelve Build components are FRED series and ten of them reach back
decades; the binding constraints are the two contractor PPIs, which begin at
2007-12 (their BLS index base, Dec 2007 = 100). Fetching from there gives a
common span of 222 months spanning the GFC collapse as well as the COVID
spike. Run locally with FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_dc_history.py --store store

Appends under today's vintage via vintage.append, which value-dedupes, so
re-running is a no-op. Ops and Hardware components are deliberately NOT
backfilled — this is a Build-index change (spec §7).
"""
import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

from pipeline import dc_basket
from pipeline.connectors import fred
from pipeline.registry import load_registry
from pipeline.store import vintage

OBSERVATION_START = "2007-12-01"


def build_series_codes(basket_path: Path | None = None) -> list[str]:
    """Internal series codes backing the Build index, in basket order."""
    _, baskets = dc_basket.load_baskets(basket_path)
    return [c.series for c in baskets["build"]]


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--observation-start", default=OBSERVATION_START)
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")

    wanted = set(build_series_codes())
    # load_registry() returns (sources, series) — a TUPLE, not a list. Iterating
    # it directly silently yields the sources dict and blows up downstream.
    _, registry = load_registry()
    entries = [s for s in registry if s.code in wanted]
    missing = wanted - {s.code for s in entries}
    if missing:
        sys.exit(f"series missing from registry: {sorted(missing)}")
    non_fred = [s.code for s in entries if s.source != "FRED"]
    if non_fred:
        sys.exit(f"not FRED-sourced, cannot backfill here: {sorted(non_fred)}")

    obs = fred.fetch([s.source_id for s in entries], key,
                     observation_start=args.observation_start,
                     http_get=http_get)
    # fred.fetch stamps the FRED id; the store keys on our internal code.
    # Same remap as pipeline/collect.py:210-212.
    id_map = {s.source_id: s.code for s in entries}
    obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
           for o in obs]
    written = vintage.append(obs, args.store)
    print(f"fetched {len(obs)} rows across {len(entries)} series, "
          f"wrote {written} new (from {args.observation_start})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_backfill_dc_history.py -q`
Expected: PASS (4 tests)

- [ ] **Step 5: Confirm the import path matches the existing precedent**

`tests/test_backfill_alfred_script.py:6` already does `from scripts import backfill_alfred`, so `scripts` is importable as-is — the new test uses the same form and needs no packaging change.

Run: `python -c "from scripts import backfill_dc_history; print('ok')"`
Expected: `ok`.

- [ ] **Step 6: Run the full Python suite for regressions**

Run: `pytest -q`
Expected: all pass, 4 more than before.

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill_dc_history.py tests/test_backfill_dc_history.py
git commit -m "feat(dc): one-shot backfill script for deep Build-component history"
```

---

## Task 2: Deepen the DC grid and publish the monthly arrays from 2007-12

**Files:**
- Modify: `pipeline/engine/dcindex.py:23-24`
- Modify: `pipeline/publish/datacenter.py:5`, `:34-44`
- Modify: `tests/test_dcindex.py:77`, `:271-281`
- Test: `tests/test_datacenter_writer.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `dcindex.GRID_START == "2007-12-01"`, `dcindex.MONTHLY_PUBLISH_START == "2007-12"`, `dcindex.PUBLISH_START == "2018-01-01"` (unchanged). `datacenter.json` `indexes.*.monthly.months` now starts at each index's own data start; `indexes.*.dates` unchanged at 2018-01.

**Why this is safe, verified:** `aggregate.fill_daily` starts at `max(start, first_obs)` (`aggregate.py:9`), so a component whose data begins 2017-01 still begins 2017-01 under an earlier `GRID_START`. `aggregate.headline` intersects component dates (`aggregate.py:28`), so each index's headline starts where *all* its components exist. **Ops and Hardware are therefore unchanged automatically** — their store data still starts 2017-01 — with no per-index config needed.

**Why the monthly slice needs its own constant:** `pipeline/publish/datacenter.py:38` currently reuses `PUBLISH_START[:7]` for the monthly slice. That constant must keep gating the *daily* arrays at 2018-01 (payload: the Build daily `dates` array is 3,127 points and would roughly double). Only the monthly arrays extend.

**Schema:** no change. `schemas/datacenter.schema.json`'s `monthly` block constrains types only — no `minItems`, no length coupling. Longer arrays validate as-is. Do not edit it.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dcindex.py — append to the file
def test_grid_start_predates_publish_start_so_monthly_can_run_deeper(tmp_path):
    """The daily grid runs from 2007-12 internally; writers slice it two ways."""
    assert dcindex.GRID_START == "2007-12-01"
    assert dcindex.MONTHLY_PUBLISH_START == "2007-12"
    assert dcindex.PUBLISH_START == "2018-01-01"


def test_index_start_is_data_determined_not_grid_determined(tmp_path):
    """A component whose data starts late must not back-fill to GRID_START —
    fill_daily clamps to max(start, first obs), so moving GRID_START earlier
    leaves an index whose inputs start in 2017 exactly where it was."""
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    assert result["indexes"]["build"]["monthly"]["months"][0] == "2017-01"


def test_index_start_follows_deeper_data_when_present(tmp_path):
    """With components that reach back before 2017, the grid actually uses them."""
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2010-01-01", 80.0), ("ppi_steel", "2017-01-01", 100.0),
        ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2010-01-01", 160.0), ("ppi_concrete", "2017-01-01", 200.0),
        ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    assert result["indexes"]["build"]["monthly"]["months"][0] == "2010-01"
```

```python
# tests/test_datacenter_writer.py — append to the file
def test_monthly_publishes_deeper_than_daily(tmp_path):
    """Daily arrays stay at 2018-01 for payload; monthly runs to the data start."""
    dc_result = _dc_result_with_monthly_from("2010-01")   # see helper note below
    out = datacenter.build(dc_result, _parity(), {}, None, None, None)
    build = out["indexes"]["build"]
    assert build["dates"][0] >= "2018-01-01"
    assert build["monthly"]["months"][0] == "2010-01"
    assert len(build["monthly"]["index"]) == len(build["monthly"]["months"])
    for code, vals in build["monthly"]["components"].items():
        assert len(vals) == len(build["monthly"]["months"]), code
```

> **Helper note:** `tests/test_datacenter_writer.py` already builds `dc_result` fixtures for its 8 existing tests. Reuse whatever fixture builder is already in that file rather than inventing `_dc_result_with_monthly_from` — read the file first and extend its existing helper to take a start month. Do not add a second fixture style.

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest tests/test_dcindex.py::test_grid_start_predates_publish_start_so_monthly_can_run_deeper tests/test_dcindex.py::test_index_start_follows_deeper_data_when_present -q`
Expected: FAIL — `AttributeError: module 'pipeline.engine.dcindex' has no attribute 'MONTHLY_PUBLISH_START'` and an assertion failure on `"2010-01"`.

- [ ] **Step 3: Move the grid start and add the monthly publish constant**

In `pipeline/engine/dcindex.py`, replace lines 23-24:

```python
# The daily grid starts where the DEEPEST component reaches; fill_daily clamps
# each component to max(GRID_START, its own first obs) and headline() intersects
# component dates, so each index's real start is data-determined. Build reaches
# 2007-12 (the two contractor PPIs' BLS base month); Ops and Hardware still
# start 2017-01 because that is where their store data starts.
GRID_START = "2007-12-01"
PUBLISH_START = "2018-01-01"       # writers publish DAILY arrays from here
MONTHLY_PUBLISH_START = "2007-12"  # ...and MONTHLY arrays from here
```

- [ ] **Step 4: Slice the monthly arrays on the new constant**

In `pipeline/publish/datacenter.py`, change line 5:

```python
from pipeline.engine.dcindex import MONTHLY_PUBLISH_START, PUBLISH_START
```

and replace lines 34-38's comment + `keep`:

```python
        # Monthly grid for /escalation. Sliced on MONTHLY_PUBLISH_START, not
        # PUBLISH_START: the contingency table needs the deep history (222
        # months for Build, spanning the GFC downturn), while the DAILY arrays
        # stay at 2018-01 because Build's daily grid is ~3,100 points and
        # doubling it would double a 575KB artifact for no reader benefit.
        # 4dp keeps the Laspeyres identity within 0.01 index points across 12
        # components — the bridge tolerance.
        mo = v["monthly"]
        keep = [i for i, m in enumerate(mo["months"]) if m >= MONTHLY_PUBLISH_START]
```

- [ ] **Step 5: Fix the one test whose fixture relied on the old grid start**

`tests/test_dcindex.py::test_component_with_no_grid_observations_raises_named_error` (around line 271) uses steel obs at `2015-01-01` and `2016-06-01` because they predated the old `GRID_START` of 2017-01-01. Under the new start they are inside the grid and the test stops testing anything. Move them earlier and say why:

```python
def test_component_with_no_grid_observations_raises_named_error(tmp_path):
    # every steel obs predates GRID_START (2007-12-01): the daily grid only
    # carries the stale value forward, so there is no obs ON the grid to
    # compute YoY at — must raise a clear error naming the component, not a
    # bare IndexError.
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2004-01-01", 100.0), ("ppi_steel", "2005-06-01", 105.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    with pytest.raises(ValueError, match="steel"):
        dcindex.run(conn, today="2018-01-15", basket_path=basket)
```

- [ ] **Step 6: Fix the now-misleading comment**

`tests/test_dcindex.py:77` reads `assert mo["months"][0] == "2017-01"  # GRID_START; publisher filters later`. The assertion is still correct (the fixture's data starts 2017-01) but the reason is not. Change the comment to:

```python
    assert mo["months"][0] == "2017-01"   # this fixture's data start, not GRID_START
```

- [ ] **Step 7: Run the affected suites**

Run: `pytest tests/test_dcindex.py tests/test_datacenter_writer.py -q`
Expected: PASS, including the 4 new tests.

- [ ] **Step 8: Run the full suite**

Run: `pytest -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add pipeline/engine/dcindex.py pipeline/publish/datacenter.py tests/test_dcindex.py tests/test_datacenter_writer.py
git commit -m "feat(dc): deepen the DC grid to 2007-12; publish monthly arrays from there"
```

---

## Task 3: Run the backfill, regenerate, and prove nothing published moved

**Files:**
- Modify: `store/obs/*.jsonl` (append-only, via the script)
- Modify: `site/public/data/*.json` (regenerated)
- Create: `docs/superpowers/plans/2026-07-25-dc-contingency-measurements.md`

**Interfaces:**
- Consumes: Task 1's script, Task 2's constants.
- Produces: a `datacenter.json` whose `indexes.build.monthly` has ~222 months, and a recorded measurement file the site tasks and the spec's acceptance criteria check against.

**This task is a verification gate.** If step 4 shows any pre-existing published monthly value moving (other than live-proxy splice months), STOP and report — do not proceed to the site work.

- [ ] **Step 1: Snapshot the current published index for comparison**

```bash
python3 -c "
import json
m=json.load(open('site/public/data/datacenter.json'))['indexes']['build']['monthly']
json.dump(dict(zip(m['months'], m['index'])), open('/tmp/build_monthly_before.json','w'))
print(f'snapshotted {len(m[\"months\"])} months')
"
```

- [ ] **Step 2: Run the backfill**

```bash
FRED_API_KEY=$FRED_API_KEY python scripts/backfill_dc_history.py --store store
```
Expected: prints `fetched ~2700 rows across 12 series, wrote ~1300 new (from 2007-12-01)`. The exact counts will differ; what matters is that `wrote` is well over 1000 (roughly 120 new months × 12 series minus what already existed).

- [ ] **Step 3: Regenerate the published artifacts**

```bash
FRED_API_KEY=$FRED_API_KEY python -m pipeline.run_daily --store store --out site/public/data
```
Expected: exit 0.

- [ ] **Step 4: Prove no previously-published monthly value moved**

```bash
python3 -c "
import json
before=json.load(open('/tmp/build_monthly_before.json'))
m=json.load(open('site/public/data/datacenter.json'))['indexes']['build']['monthly']
after=dict(zip(m['months'], m['index']))
moved=[(k, before[k], after[k]) for k in before if k in after and abs(before[k]-after[k])>1e-9]
print(f'months before {len(before)} -> after {len(after)}')
print(f'first month: {m[\"months\"][0]}')
print(f'moved: {len(moved)}')
for k,b,a in moved[:10]: print(f'  {k}: {b} -> {a}  ({a-b:+.4f})')
"
```
Expected: `months before 103 -> after ~222`, `first month: 2007-12`, and **`moved: 0`**, or only months where a live proxy splices (the trailing one or two). Any other movement is a STOP condition.

- [ ] **Step 5: Verify the Laspeyres identity still holds on the deep grid**

```bash
python3 -c "
import json
d=json.load(open('site/public/data/datacenter.json'))
b=d['indexes']['build']; m=b['monthly']
W={c['code']: c['weight'] for c in b['components']}
worst=0.0
for i,mm in enumerate(m['months']):
    r=sum(W[c]*m['components'][c][i] for c in W)
    worst=max(worst, abs(r-m['index'][i]))
print(f'max Laspeyres residual across {len(m[\"months\"])} months: {worst:.6f} index pts')
assert worst < 0.01, 'identity broken'
print('OK')
"
```
Expected: residual well under 0.01, prints `OK`.

- [ ] **Step 6: Record the measured numbers the site tasks and spec depend on**

```bash
python3 - <<'PY' | tee docs/superpowers/plans/2026-07-25-dc-contingency-measurements.md
import json, statistics as st
d=json.load(open('site/public/data/datacenter.json'))
b=d['indexes']['build']; m=b['monthly']
months, idx = m['months'], m['index']
last_complete = min(c['last_obs'] for c in b['components'])[:7]
a = max(i for i,mm in enumerate(months) if mm <= last_complete)
print("# P3a measured reference values\n")
print(f"Generated from datacenter.json published_at {d['published_at']}.\n")
print(f"- monthly months: {len(months)}  ({months[0]} -> {months[-1]})")
print(f"- last complete month (min of components[].last_obs): {last_complete} (index {a})")
yoy=[(idx[i+12]/idx[i]-1)*100 for i in range(a-11)]
print(f"- YoY months: {len(yoy)}  min {min(yoy):+.2f}  max {max(yoy):+.2f}")
print(f"- negative months: {sum(1 for v in yoy if v<0)} ({100*sum(1 for v in yoy if v<0)/len(yoy):.0f}%)")
print(f"- median {st.median(yoy):+.2f}  mean {st.mean(yoy):+.2f}\n")
def ann(i,j):
    n=j-i
    return ((idx[j]/idx[i])**(12.0/n)-1)*100, (idx[j]/idx[i]-1)*100, n
def at(mm):
    c=[i for i,x in enumerate(months) if x<=mm]
    return c[-1] if c else None
print("## Named bases\n")
print("| basis | window | months | annualized | cumulative |")
print("|---|---|---|---|---|")
for label, i, j in [("Long-run", 0, a), ("Downturn (GFC)", at("2008-12"), at("2011-12")),
                    ("Trailing 3yr", a-36, a), ("Current momentum", a-12, a),
                    ("Peak (COVID)", at("2021-04"), at("2023-12"))]:
    if i is None or j is None or i<0 or j<=i: print(f"| {label} | UNAVAILABLE | | | |"); continue
    A,C,n=ann(i,j)
    print(f"| {label} | {months[i]} → {months[j]} | {n} | {A:+.2f}% | {C:+.2f}% |")
print("\n## Percentile band (annualized %)\n")
print("| h | windows | indep | p10 | p25 | p50 | p75 | p90 | spike overlap |")
print("|---|---|---|---|---|---|---|---|---|")
def pct(s,p):
    if len(s)==1: return s[0]
    pos=(p/100)*(len(s)-1); lo=int(pos//1); hi=min(lo+1,len(s)-1)
    return s[lo]+(pos-lo)*(s[hi]-s[lo])
for h in (12,24,36,48):
    w=[i for i in range(a-h+1)]
    r=sorted(((idx[i+h]/idx[i])**(12.0/h)-1)*100 for i in w)
    ov=sum(1 for i in w if months[i]<="2022-12" and months[i+h]>="2021-04")
    print(f"| {h} | {len(w)} | {len(w)/h:.1f} | {pct(r,10):+.2f} | {pct(r,25):+.2f} | "
          f"{pct(r,50):+.2f} | {pct(r,75):+.2f} | {pct(r,90):+.2f} | {100*ov/len(w):.0f}% |")
PY
```
Expected: a table close to the spec's §3.2 figures. Small differences are expected and fine — the spec's numbers came from a raw-FRED reconstruction that skips the live-proxy splice. **These are now the authoritative numbers.**

- [ ] **Step 7: Verify the payload did not balloon**

```bash
python3 -c "
import json
d=json.load(open('site/public/data/datacenter.json'))
for k in ('build','ops','hardware'):
    v=d['indexes'][k]
    print(f'{k}: daily {len(v[\"dates\"])} pts, monthly {len(v[\"monthly\"][\"months\"])} months, '
          f'monthly block {len(json.dumps(v[\"monthly\"]))/1024:.1f} KB')
print(f'whole file {len(json.dumps(d))/1024:.1f} KB')
"
```
Expected: Build daily stays ~3,100 points (**not** ~6,800); Build monthly ~222 months / ~30KB; whole file ~320KB re-serialized. If the daily count doubled, Step 4 of Task 2 was not applied.

- [ ] **Step 8: Run the full Python suite**

Run: `pytest -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add store site/public/data docs/superpowers/plans/2026-07-25-dc-contingency-measurements.md
git commit -m "data: backfill DC Build components to 2007-12 and regenerate

Adds the GFC construction downturn to the sample. Previously-published
monthly values are unchanged; only earlier history is prepended."
```

---

## Task 4: `dcContingency.ts` — anchor month and named bases

**Files:**
- Modify: `site/src/lib/dcEscalation.ts:20-29` (export the two month helpers)
- Create: `site/src/lib/dcContingency.ts`
- Test: `site/src/lib/dcContingency.test.ts`

**Interfaces:**
- Consumes: `monthDiff(a, b): number` and `monthIndexAtOrBefore(months, target): number` — exported from `dcEscalation.ts` in Step 1.
- Produces:
  - `lastCompleteMonth(months: string[], componentLastObs: string[]): string | null`
  - `type BasisDef = { key: string; label: string; kind: "rolling" | "absolute"; lookbackMonths?: number | null; startMonth?: string; endMonth?: string; note: string }`
  - `type Basis = { key; label; kind; note; startMonth: string; endMonth: string; months: number; cumulativePct: number; annualizedPct: number }`
  - `BASES: BasisDef[]`
  - `bases(months: string[], index: number[], anchorMonth: string): Basis[]`

- [ ] **Step 1: Export the month helpers from `dcEscalation.ts`**

Change `dcEscalation.ts:13` and `:20-22` — add `export` and update the stale comment:

```ts
/** Whole months between two "YYYY-MM" strings. */
export function monthDiff(a: string, b: string): number {
```

```ts
/** Index of the nearest month at or before `target`; -1 if target predates the series.
 *  Shared with dcContingency.ts, which resolves the same "YYYY-MM" grid. */
export function monthIndexAtOrBefore(months: string[], target: string): number {
```

- [ ] **Step 2: Write the failing test**

```ts
// site/src/lib/dcContingency.test.ts
import { describe, expect, it } from "vitest";
import { BASES, bases, lastCompleteMonth } from "./dcContingency";

// A 4-year monthly grid compounding at exactly 5%/yr from 100.
// 2022-01 .. 2026-01 inclusive = 49 months.
const MONTHS: string[] = [];
const INDEX: number[] = [];
for (let k = 0; k <= 48; k++) {
  const y = 2022 + Math.floor(k / 12);
  const mo = (k % 12) + 1;
  MONTHS.push(`${y}-${String(mo).padStart(2, "0")}`);
  INDEX.push(100 * Math.pow(1.05, k / 12));
}

describe("lastCompleteMonth", () => {
  it("takes the minimum component last_obs, not the last grid month", () => {
    // copper is daily and runs ahead; the PPIs stop at June
    expect(
      lastCompleteMonth(MONTHS, ["2026-01-20", "2025-12-01", "2025-12-01"])
    ).toBe("2025-12");
  });

  it("clamps to a month that actually exists in the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2030-06-01"])).toBe("2026-01");
  });

  it("returns null when the cap predates the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2019-01-01"])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(lastCompleteMonth([], ["2025-01-01"])).toBeNull();
    expect(lastCompleteMonth(MONTHS, [])).toBeNull();
  });
});

describe("bases", () => {
  it("computes the annualized ratio, not a median of YoY prints", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const momentum = out.find((b) => b.key === "momentum")!;
    expect(momentum.months).toBe(12);
    expect(momentum.annualizedPct).toBeCloseTo(5.0, 6);
    expect(momentum.cumulativePct).toBeCloseTo(5.0, 6);
  });

  it("annualizes a multi-year window correctly", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const t3 = out.find((b) => b.key === "trailing3y")!;
    expect(t3.months).toBe(36);
    expect(t3.annualizedPct).toBeCloseTo(5.0, 6);
    expect(t3.cumulativePct).toBeCloseTo(15.7625, 3); // 1.05^3 - 1
  });

  it("runs long-run from the first month in the sample", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const lr = out.find((b) => b.key === "longrun")!;
    expect(lr.startMonth).toBe("2022-01");
    expect(lr.endMonth).toBe("2026-01");
    expect(lr.months).toBe(48);
    expect(lr.annualizedPct).toBeCloseTo(5.0, 6);
  });

  it("omits absolute bases whose window predates the sample", () => {
    // This grid starts 2022-01. Both absolute windows begin before it
    // (2008-12 and 2021-04), so monthIndexAtOrBefore returns -1 for each
    // start and both are omitted rather than silently clamped forward.
    const keys = bases(MONTHS, INDEX, "2026-01").map((b) => b.key);
    expect(keys).not.toContain("gfc");
    expect(keys).not.toContain("covid");
    expect(keys).toEqual(["longrun", "trailing3y", "momentum"]);
  });

  it("omits a rolling basis whose lookback predates the sample", () => {
    const shortMonths = MONTHS.slice(0, 6);
    const shortIndex = INDEX.slice(0, 6);
    const keys = bases(shortMonths, shortIndex, "2022-06").map((b) => b.key);
    expect(keys).not.toContain("trailing3y");
    expect(keys).not.toContain("momentum");
  });

  it("anchors on the month given, not the end of the grid", () => {
    const out = bases(MONTHS, INDEX, "2025-01");
    expect(out.every((b) => b.endMonth <= "2025-01")).toBe(true);
  });

  it("emits nothing rather than a zero-length window at the sample start", () => {
    // anchor == months[0]: longrun's window would be 2022-01 -> 2022-01 (j <= i),
    // both rolling lookbacks go negative, both absolutes predate the grid.
    const out = bases(MONTHS, INDEX, "2022-01");
    expect(out).toEqual([]);
  });

  it("declares two absolute bases whose windows are fixed constants", () => {
    const abs = BASES.filter((b) => b.kind === "absolute");
    expect(abs.map((b) => b.key).sort()).toEqual(["covid", "gfc"]);
    expect(abs.every((b) => !!b.startMonth && !!b.endMonth)).toBe(true);
  });
});
```

> Note on the `covid` expectation above: with a grid starting 2022-01, `monthIndexAtOrBefore(MONTHS, "2021-04")` returns -1, so `covid` is omitted too. **Correct the test to `expect(keys).not.toContain("covid")` if that is what the implementation yields** — run it and match reality rather than forcing the implementation to satisfy a guess. The behaviour that matters and must not change: an absolute basis whose window is not fully inside the sample is omitted, never silently clamped.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd site && npx vitest run src/lib/dcContingency.test.ts`
Expected: FAIL — cannot resolve `./dcContingency`.

- [ ] **Step 4: Write the module**

```ts
// site/src/lib/dcContingency.ts
/** Contingency bases for the DC escalation calculator.
 *
 *  This module makes NO forecast. Every value is an annualized ratio of the
 *  published DC Build index over a stated historical window — a claim about
 *  what has already happened, which the reader can re-derive by hand from
 *  datacenter.json. That is what lets /escalation project a delivery window
 *  without asserting which regime will obtain.
 *
 *  A basis is defined as an annualized INDEX RATIO, never a median or mean of
 *  YoY prints. The distinction is load-bearing: on the live grid the trailing
 *  3yr median of YoY readings is +3.45% while the annualized ratio is +4.76%,
 *  and only the ratio decomposes additively into per-component contributions
 *  (see bridgeWindow in dcEscalation.ts).
 */
import { monthDiff, monthIndexAtOrBefore } from "./dcEscalation";

export type BasisKind = "rolling" | "absolute";

export type BasisDef = {
  key: string;
  label: string;
  kind: BasisKind;
  /** rolling only: months back from the anchor; null means "from the first month". */
  lookbackMonths?: number | null;
  /** absolute only: a fixed historical episode. */
  startMonth?: string;
  endMonth?: string;
  note: string;
};

export type Basis = {
  key: string;
  label: string;
  kind: BasisKind;
  note: string;
  startMonth: string;
  endMonth: string;
  months: number;
  cumulativePct: number;
  annualizedPct: number;
};

/** The two absolute windows are hand-set to observed episodes and are stated
 *  on-page with their bounds. They are not derived by a rule, and their values
 *  must not move between publishes — pinned in dcContingency.test.ts. */
export const BASES: BasisDef[] = [
  {
    key: "longrun",
    label: "Long-run",
    kind: "rolling",
    lookbackMonths: null,
    note: "every month in the sample",
  },
  {
    key: "gfc",
    label: "Downturn regime (GFC)",
    kind: "absolute",
    startMonth: "2008-12",
    endMonth: "2011-12",
    note: "the post-crisis construction downturn",
  },
  {
    key: "trailing3y",
    label: "Trailing 3yr",
    kind: "rolling",
    lookbackMonths: 36,
    note: "the last three complete years",
  },
  {
    key: "momentum",
    label: "Current momentum",
    kind: "rolling",
    lookbackMonths: 12,
    note: "carry the latest 12-month rate — the naive answer",
  },
  {
    key: "covid",
    label: "Peak regime (COVID)",
    kind: "absolute",
    startMonth: "2021-04",
    endMonth: "2023-12",
    note: "the 2021–23 spike",
  },
];

/** The last month every component actually covers.
 *
 *  NOT months[months.length - 1]. The published grid's trailing month is a
 *  partial stub: dcindex takes max() over component end dates, so the grid
 *  runs past the last date most of the basket had data, and only the two
 *  live-proxy components (8.5% of weight) move in it. Anchoring a RATE there
 *  reads a two-component move as a basket move.
 *
 *  min(components[].last_obs) is exactly right: the PPI backbones sit at the
 *  last monthly print while copper/aluminium run daily, so the min tracks the
 *  monthly cadence and advances only when a real print lands. */
export function lastCompleteMonth(
  months: string[],
  componentLastObs: string[]
): string | null {
  if (!months.length || !componentLastObs.length) return null;
  const cap = componentLastObs
    .reduce((a, b) => (a < b ? a : b))
    .slice(0, 7);
  const i = monthIndexAtOrBefore(months, cap);
  return i < 0 ? null : months[i];
}

function resolve(
  def: BasisDef,
  months: string[],
  anchorMonth: string
): { start: string; end: string } | null {
  if (def.kind === "absolute") {
    if (!def.startMonth || !def.endMonth) return null;
    return { start: def.startMonth, end: def.endMonth };
  }
  if (def.lookbackMonths == null) return { start: months[0], end: anchorMonth };
  const anchorIdx = monthIndexAtOrBefore(months, anchorMonth);
  const startIdx = anchorIdx - def.lookbackMonths;
  if (anchorIdx < 0 || startIdx < 0) return null;
  return { start: months[startIdx], end: months[anchorIdx] };
}

/** Resolve every basis against the grid. A basis whose window is not fully
 *  inside the sample is OMITTED, never clamped — a "trailing 3yr" computed
 *  over 14 available months would be a different statistic wearing the same
 *  label. */
export function bases(
  months: string[],
  index: number[],
  anchorMonth: string
): Basis[] {
  const out: Basis[] = [];
  for (const def of BASES) {
    const w = resolve(def, months, anchorMonth);
    if (!w) continue;
    const i = monthIndexAtOrBefore(months, w.start);
    const j = monthIndexAtOrBefore(months, w.end);
    if (i < 0 || j < 0 || j <= i) continue;
    if (months[i] !== w.start && def.kind === "absolute") continue;
    if (months[j] > anchorMonth) continue;
    const ratio = index[j] / index[i];
    const n = monthDiff(months[i], months[j]);
    out.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      note: def.note,
      startMonth: months[i],
      endMonth: months[j],
      months: n,
      cumulativePct: (ratio - 1) * 100,
      annualizedPct: (Math.pow(ratio, 12 / n) - 1) * 100,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd site && npx vitest run src/lib/dcContingency.test.ts src/lib/dcEscalation.test.ts`
Expected: PASS. If the `covid` expectation in Step 2 fails, correct the test to match the omission behaviour (see the note there) — do not change the implementation to clamp.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/dcContingency.ts site/src/lib/dcContingency.test.ts site/src/lib/dcEscalation.ts
git commit -m "feat(site): dcContingency bases and last-complete-month anchor"
```

---

## Task 5: `dcContingency.ts` — horizon-matched percentile band

**Files:**
- Modify: `site/src/lib/dcContingency.ts`
- Test: `site/src/lib/dcContingency.test.ts`

**Interfaces:**
- Consumes: `monthIndexAtOrBefore` from `dcEscalation.ts`.
- Produces:
  - `MIN_HORIZON_MONTHS = 12`, `MAX_HORIZON_MONTHS = 48`, `SPIKE_START = "2021-04"`, `SPIKE_END = "2022-12"`
  - `type Band = { horizonMonths; windows; independentDraws; spikeOverlapPct; p10; p25; p50; p75; p90; sampleStartMonth; sampleEndMonth }`
  - `band(months: string[], index: number[], horizonMonths: number, anchorMonth: string): Band | null`

- [ ] **Step 1: Write the failing test**

**Merge the import, do not add a second one.** `dcContingency.test.ts` already imports from `./dcContingency` (Task 4 Step 2). Extend that existing statement to:

```ts
import {
  band,
  BASES,
  bases,
  lastCompleteMonth,
  MAX_HORIZON_MONTHS,
  MIN_HORIZON_MONTHS,
} from "./dcContingency";
```

Then append the new describe block:

```ts
// append to site/src/lib/dcContingency.test.ts
describe("band", () => {
  it("returns the constant rate for a constant-growth grid", () => {
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.p10).toBeCloseTo(5.0, 6);
    expect(b.p50).toBeCloseTo(5.0, 6);
    expect(b.p90).toBeCloseTo(5.0, 6);
  });

  it("counts windows and independent draws", () => {
    // 49 months, anchor at index 48, h=12 -> windows i=0..36 inclusive = 37
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.windows).toBe(37);
    expect(b.independentDraws).toBeCloseTo(37 / 12, 6);
  });

  it("reports the sample span it actually used", () => {
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.sampleStartMonth).toBe("2022-01");
    expect(b.sampleEndMonth).toBe("2026-01");
  });

  it("interpolates percentiles linearly, matching the reference method", () => {
    // 17 CONTIGUOUS months (2020-01..2021-05) engineered to give exactly five
    // 12-month windows with rates 0,1,2,3,4% — so p50 = 2 and p10 = 0.4 by hand.
    // The grid MUST be contiguous monthly: band() steps by array position, which
    // is only equal to calendar months because dcindex emits one entry per month
    // with no gaps.
    const m = [
      "2020-01", "2020-02", "2020-03", "2020-04", "2020-05", "2020-06",
      "2020-07", "2020-08", "2020-09", "2020-10", "2020-11", "2020-12",
      "2021-01", "2021-02", "2021-03", "2021-04", "2021-05",
    ];
    const i = [
      100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100,
      100, 101, 102, 103, 104,
    ];
    const b = band(m, i, 12, "2021-05")!;
    expect(b.windows).toBe(5);
    expect(b.p10).toBeCloseTo(0.4, 6);
    expect(b.p50).toBeCloseTo(2.0, 6);
    expect(b.p90).toBeCloseTo(3.6, 6);
  });

  it("returns null when the horizon exceeds the sample", () => {
    expect(band(MONTHS, INDEX, 60, "2026-01")).toBeNull();
  });

  it("returns null when fewer than two windows exist", () => {
    const m = ["2024-01", "2025-01"];
    const i = [100, 105];
    expect(band(m, i, 12, "2025-01")).toBeNull();
  });

  it("anchors on the month given, never past it", () => {
    const b = band(MONTHS, INDEX, 12, "2024-01")!;
    expect(b.sampleEndMonth).toBe("2024-01");
    expect(b.windows).toBe(13); // i = 0..12
  });

  it("reports spike overlap as a share of contributing windows", () => {
    // grid starts 2022-01, so every window touches the 2021-04..2022-12 spike
    // window until it clears 2022-12
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.spikeOverlapPct).toBeGreaterThan(0);
    expect(b.spikeOverlapPct).toBeLessThanOrEqual(100);
  });

  it("exposes the horizon bounds the UI caps on", () => {
    expect(MIN_HORIZON_MONTHS).toBe(12);
    expect(MAX_HORIZON_MONTHS).toBe(48);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && npx vitest run src/lib/dcContingency.test.ts`
Expected: FAIL — `band is not exported`.

- [ ] **Step 3: Implement `band`**

Append to `site/src/lib/dcContingency.ts`:

```ts
/** Band horizons. The cap is applied to the delivery-date INPUT, not just the
 *  band, so every basis and band the reader sees covers the same window.
 *  48 months is where the sample stops supporting a distribution: at h=48 it
 *  gives ~174 windows but only ~3.6 independent draws, and beyond that the
 *  count falls under 3. */
export const MIN_HORIZON_MONTHS = 12;
export const MAX_HORIZON_MONTHS = 48;

/** The 2021-23 escalation spike, as a stated constant. Published alongside every
 *  band so the reader knows how much of the sample is one episode. */
export const SPIKE_START = "2021-04";
export const SPIKE_END = "2022-12";

export type Band = {
  horizonMonths: number;
  windows: number;
  /** (windows / horizon) — how many NON-overlapping windows the sample could
   *  have supported. Published because overlapping windows make a small sample
   *  look like a large one. */
  independentDraws: number;
  spikeOverlapPct: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sampleStartMonth: string;
  sampleEndMonth: string;
};

/** Linear-interpolated percentile on (n-1), matching numpy's default and
 *  Python's statistics.quantiles(method="inclusive") — the method used to
 *  produce the reference figures in the measurements doc. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return lo === hi ? sorted[lo] : sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** Empirical distribution of realized annualized escalation over windows of
 *  exactly `horizonMonths`, ending at or before `anchorMonth`.
 *
 *  ASSUMES A CONTIGUOUS MONTHLY GRID — one entry per calendar month, no gaps —
 *  because it steps by array position (`index[i + horizonMonths]`) rather than
 *  by calendar arithmetic. That holds by construction: dcindex builds the
 *  monthly grid by bucketing every day of the daily index into its month
 *  (pipeline/engine/dcindex.py:99-108), so every month between the first and
 *  last has exactly one entry. `bases()`'s rolling lookback relies on the same
 *  property.
 *
 *  Horizon-matched deliberately: it is a literal statement the reader can
 *  check ("of the N realized 36-month windows since 2007-12, the median was
 *  X"), and it imposes no distributional assumption. The cost is that n falls
 *  as the horizon grows, which is why `windows` and `independentDraws` are
 *  part of the return value rather than an implementation detail. */
export function band(
  months: string[],
  index: number[],
  horizonMonths: number,
  anchorMonth: string
): Band | null {
  const anchorIdx = monthIndexAtOrBefore(months, anchorMonth);
  if (anchorIdx < 0 || horizonMonths <= 0) return null;
  const rates: number[] = [];
  let overlap = 0;
  for (let i = 0; i + horizonMonths <= anchorIdx; i++) {
    const j = i + horizonMonths;
    rates.push((Math.pow(index[j] / index[i], 12 / horizonMonths) - 1) * 100);
    if (months[i] <= SPIKE_END && months[j] >= SPIKE_START) overlap++;
  }
  if (rates.length < 2) return null;
  const sorted = [...rates].sort((a, b) => a - b);
  return {
    horizonMonths,
    windows: rates.length,
    independentDraws: rates.length / horizonMonths,
    spikeOverlapPct: (100 * overlap) / rates.length,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    sampleStartMonth: months[0],
    sampleEndMonth: months[anchorIdx],
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd site && npx vitest run src/lib/dcContingency.test.ts`
Expected: PASS. The `windows` counts in the test assume `i + h <= anchorIdx`; if the off-by-one differs, fix **the test** to match the loop and re-derive the expected count by hand — do not loosen the assertion.

- [ ] **Step 5: Cross-check the module against the pipeline reference numbers**

```bash
cd site && npx vitest run src/lib/dcContingency.test.ts && cd .. && python3 - <<'PY'
import json, subprocess
d=json.load(open('site/public/data/datacenter.json'))
b=d['indexes']['build']; m=b['monthly']
last=min(c['last_obs'] for c in b['components'])[:7]
print(f"anchor should be {last}; compare the h=12/24/36/48 rows the site renders "
      f"against docs/superpowers/plans/2026-07-25-dc-contingency-measurements.md")
PY
```
Expected: the doc from Task 3 Step 6 and the module agree. This is a manual read-across, not an automated assertion — record any mismatch before continuing.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/dcContingency.ts site/src/lib/dcContingency.test.ts
git commit -m "feat(site): horizon-matched percentile band with sample disclosure"
```

---

## Task 6: `dcEscalation.ts` — windowed bridge and the forward segment

**Files:**
- Modify: `site/src/lib/dcEscalation.ts`
- Test: `site/src/lib/dcEscalation.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `bridgeWindow(months, componentIndex, components, baseMonth, endMonth, baseCost): BridgeRow[]`
  - `bridge(...)` unchanged in signature, now delegating to `bridgeWindow`
  - `type ForwardSegment = { fromMonth; deliveryMonth; monthsAhead; annualizedPct; factor; pct }`
  - `escalate(months, index, baseMonth, baseCost, forward?)` — `EscalationResult` gains `forward: ForwardSegment | null`, `totalFactor`, `totalPct`, `totalCost`

**Backward compatibility is a hard requirement:** every existing call site passes 4 arguments and every existing test in `dcEscalation.test.ts` must pass **unchanged**. Do not modify existing assertions.

- [ ] **Step 1: Write the failing test**

**Merge the import, do not add a second one.** `dcEscalation.test.ts:2` already reads `import { escalate, bridge } from "./dcEscalation";`. Extend it to:

```ts
import {
  bridge,
  bridgeWindow,
  escalate,
  monthDiff,
  monthIndexAtOrBefore,
} from "./dcEscalation";
```

Then append the new describe blocks:

```ts
// append to site/src/lib/dcEscalation.test.ts
describe("bridgeWindow", () => {
  it("decomposes an arbitrary window, not just to the grid end", () => {
    const rows = bridgeWindow(
      B_MONTHS, B_COMPONENT_INDEX, B_COMPONENTS, "2024-03", "2025-03", 1_000_000
    );
    const total = rows.reduce((s, r) => s + r.contributionPp, 0);
    const headlineBase = B_COMPONENTS.reduce(
      (a, c) => a + c.weight * B_COMPONENT_INDEX[c.code][0], 0);
    const headlineEnd = B_COMPONENTS.reduce(
      (a, c) => a + c.weight * B_COMPONENT_INDEX[c.code][1], 0);
    expect(total).toBeCloseTo((headlineEnd / headlineBase - 1) * 100, 10);
  });

  it("is what bridge() delegates to", () => {
    const viaBridge = bridge(B_MONTHS, B_COMPONENT_INDEX, B_COMPONENTS, "2024-03", 1000);
    const viaWindow = bridgeWindow(
      B_MONTHS, B_COMPONENT_INDEX, B_COMPONENTS, "2024-03",
      B_MONTHS[B_MONTHS.length - 1], 1000);
    expect(viaWindow).toEqual(viaBridge);
  });

  it("returns [] for an end month before the base", () => {
    expect(bridgeWindow(
      B_MONTHS, B_COMPONENT_INDEX, B_COMPONENTS, "2026-03", "2024-03", 1000
    )).toEqual([]);
  });
});

describe("escalate with a forward segment", () => {
  it("is unchanged when no forward is supplied", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 9_000_000)!;
    expect(r.forward).toBeNull();
    expect(r.totalCost).toBeCloseTo(r.escalatedCost, 6);
    expect(r.totalPct).toBeCloseTo(r.pct, 10);
    expect(r.totalFactor).toBeCloseTo(1 + r.pct / 100, 10);
  });

  it("compounds the forward leg from the historical end month", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2028-03",
      annualizedPct: 5,
    })!;
    expect(r.forward!.fromMonth).toBe("2026-03");
    expect(r.forward!.monthsAhead).toBe(24);
    expect(r.forward!.factor).toBeCloseTo(1.1025, 6);   // 1.05^2
    expect(r.forward!.pct).toBeCloseTo(10.25, 6);
    // total = historical 1.1449 x forward 1.1025
    expect(r.totalFactor).toBeCloseTo(1.1449 * 1.1025, 6);
    expect(r.totalCost).toBeCloseTo(1_000_000 * 1.1449 * 1.1025, 2);
  });

  it("handles a negative carry rate", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2027-03",
      annualizedPct: -3,
    })!;
    expect(r.forward!.factor).toBeCloseTo(0.97, 6);
    expect(r.totalFactor).toBeLessThan(1.1449);
  });

  it("ignores a delivery month at or before the historical end", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 1_000_000, {
      deliveryMonth: "2026-03",
      annualizedPct: 5,
    })!;
    expect(r.forward).toBeNull();
    expect(r.totalCost).toBeCloseTo(r.escalatedCost, 6);
  });
});

describe("month helpers are exported for dcContingency", () => {
  it("monthDiff counts whole months", () => {
    expect(monthDiff("2024-03", "2026-03")).toBe(24);
    expect(monthDiff("2026-03", "2024-03")).toBe(-24);
  });
  it("monthIndexAtOrBefore finds the nearest earlier month", () => {
    expect(monthIndexAtOrBefore(MONTHS, "2025-11")).toBe(1);
    expect(monthIndexAtOrBefore(MONTHS, "2024-02")).toBe(-1);
  });
});
```

> The bridge tests reference `B_COMPONENT_INDEX`, `B_COMPONENTS`, `B_MONTHS` — these fixtures already exist in `dcEscalation.test.ts` (from line ~40). Read the file and use the existing names exactly; do not redefine them.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && npx vitest run src/lib/dcEscalation.test.ts`
Expected: FAIL — `bridgeWindow is not exported`.

- [ ] **Step 3: Add `bridgeWindow` and delegate `bridge` to it**

In `dcEscalation.ts`, rename the existing `bridge` body into `bridgeWindow` with an `endMonth` parameter, keeping the entire existing doc comment (it explains the denominator subtlety and is load-bearing), and add:

```ts
export function bridgeWindow(
  months: string[],
  componentIndex: Record<string, number[]>,
  components: BridgeComponent[],
  baseMonth: string,
  endMonth: string,
  baseCost: number
): BridgeRow[] {
  const i = monthIndexAtOrBefore(months, baseMonth);
  const last = monthIndexAtOrBefore(months, endMonth);
  if (i < 0 || last < 0 || last <= i) return [];
  const headlineBase = components.reduce(
    (acc, c) => acc + c.weight * componentIndex[c.code][i],
    0
  );
  if (headlineBase === 0) return [];
  return components
    .map((c) => {
      const series = componentIndex[c.code];
      const delta = series[last] - series[i];
      return {
        ...c,
        componentPct: (series[last] / series[i] - 1) * 100,
        componentBaseIndex: series[i],
        componentEndIndex: series[last],
        contributionPp: (100 * c.weight * delta) / headlineBase,
        contributionCost: (baseCost * c.weight * delta) / headlineBase,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));
}

/** Decompose to the end of the published grid. Thin wrapper over bridgeWindow —
 *  P1's original entry point, kept so existing call sites are untouched. */
export function bridge(
  months: string[],
  componentIndex: Record<string, number[]>,
  components: BridgeComponent[],
  baseMonth: string,
  baseCost: number
): BridgeRow[] {
  return bridgeWindow(months, componentIndex, components, baseMonth,
                      months[months.length - 1], baseCost);
}
```

> **Behaviour note:** the original `bridge` returned `[]` only when `i < 0`; `bridgeWindow` also returns `[]` when `last <= i`. For `bridge()` that changes one case — base month == last month now yields `[]` instead of a row set of all-zero contributions. Check `dcEscalation.test.ts` for an existing assertion on that case; if one exists, keep the old behaviour by special-casing `last === i` to fall through rather than return `[]`.

- [ ] **Step 4: Add the forward segment to `escalate`**

Replace the `EscalationResult` type and `escalate` function:

```ts
export type ForwardSegment = {
  /** Always the historical leg's end month — the two segments are contiguous. */
  fromMonth: string;
  deliveryMonth: string;
  monthsAhead: number;
  /** The basis rate the reader chose to carry. */
  annualizedPct: number;
  factor: number;
  pct: number;
};

export type EscalationResult = {
  baseMonth: string;
  endMonth: string;
  monthsElapsed: number;
  baseIndex: number;
  endIndex: number;
  pct: number;
  annualizedPct: number;
  escalatedCost: number;
  deltaCost: number;
  /** null unless the caller supplied a forward leg. */
  forward: ForwardSegment | null;
  /** Historical ratio x forward factor. Equals 1 + pct/100 when forward is null. */
  totalFactor: number;
  totalPct: number;
  totalCost: number;
};

/** Escalate a base cost by the index ratio. Unit-agnostic — the caller's $/MW,
 *  total project $, or any other denomination all ride the same ratio.
 *
 *  The optional `forward` leg compounds a chosen annual rate from the END of
 *  the measured history to a delivery month. The two segments are contiguous
 *  by construction (forward.fromMonth === endMonth), so nothing is double
 *  counted and nothing is skipped. The rate is the caller's choice of basis —
 *  this function asserts nothing about which regime will obtain. */
export function escalate(
  months: string[],
  index: number[],
  baseMonth: string,
  baseCost: number,
  forward?: { deliveryMonth: string; annualizedPct: number } | null
): EscalationResult | null {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return null;
  // months/index are always equal length — the monthly grid publishes them
  // together and pins it at publish time (tests/test_datacenter_writer.py).
  // Deriving `last` from `months` here matches bridgeWindow()'s convention.
  const last = months.length - 1;
  const ratio = index[last] / index[i];
  const monthsElapsed = monthDiff(months[i], months[last]);

  let fwd: ForwardSegment | null = null;
  if (forward) {
    const monthsAhead = monthDiff(months[last], forward.deliveryMonth);
    if (monthsAhead > 0) {
      const factor = Math.pow(1 + forward.annualizedPct / 100, monthsAhead / 12);
      fwd = {
        fromMonth: months[last],
        deliveryMonth: forward.deliveryMonth,
        monthsAhead,
        annualizedPct: forward.annualizedPct,
        factor,
        pct: (factor - 1) * 100,
      };
    }
  }
  const totalFactor = ratio * (fwd ? fwd.factor : 1);

  return {
    baseMonth: months[i],
    endMonth: months[last],
    monthsElapsed,
    baseIndex: index[i],
    endIndex: index[last],
    pct: (ratio - 1) * 100,
    annualizedPct: monthsElapsed > 0 ? (Math.pow(ratio, 12 / monthsElapsed) - 1) * 100 : 0,
    escalatedCost: baseCost * ratio,
    deltaCost: baseCost * (ratio - 1),
    forward: fwd,
    totalFactor,
    totalPct: (totalFactor - 1) * 100,
    totalCost: baseCost * totalFactor,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd site && npx vitest run src/lib/dcEscalation.test.ts`
Expected: PASS — **all pre-existing tests unchanged**, plus the new ones.

- [ ] **Step 6: Run the whole vitest suite**

Run: `cd site && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/dcEscalation.ts site/src/lib/dcEscalation.test.ts
git commit -m "feat(site): windowed bridge + optional forward segment on escalate()"
```

---

## Task 7: Client UI — DELIVER BY input, basis table, band

**Files:**
- Modify: `site/src/components/DcEscalationClient.tsx`

**Interfaces:**
- Consumes: `bases`, `band`, `lastCompleteMonth`, `MAX_HORIZON_MONTHS`, `MIN_HORIZON_MONTHS` from `@/lib/dcContingency`; `escalate`, `bridgeWindow`, `monthDiff`, `type BridgeComponent` from `@/lib/dcEscalation`; `EscalationData` gains `componentLastObs: string[]` (supplied by Task 8). `Basis` and `Band` are consumed via inference — do **not** add explicit type imports for them, they would trip `no-unused-vars`.
- Produces: the rendered forward leg. No exports change except the `EscalationData` type.

- [ ] **Step 1: Extend the data type and add state**

At the top of `DcEscalationClient.tsx`, add `componentLastObs` to `EscalationData`:

```ts
export type EscalationData = {
  months: string[];
  index: number[];
  componentIndex: Record<string, number[]>;
  components: BridgeComponent[];
  /** Per-component last_obs, for deriving the last COMPLETE month — the
   *  published grid's trailing month is a partial stub. */
  componentLastObs: string[];
  asOf: string;
  rebase: string;
};
```

Update the imports:

```ts
import { bridgeWindow, escalate, monthDiff, type BridgeComponent } from "@/lib/dcEscalation";
import {
  band,
  bases,
  lastCompleteMonth,
  MAX_HORIZON_MONTHS,
  MIN_HORIZON_MONTHS,
} from "@/lib/dcContingency";
```

Add state and derived values after the existing `baseCost` state (around line 30):

```ts
  const anchor = lastCompleteMonth(data.months, data.componentLastObs);
  // Cap the input at MAX_HORIZON_MONTHS past the month the forward leg actually
  // STARTS from (lastMonth, the grid end) — not past `anchor`. Anchoring the cap
  // on `anchor` would allow a 49-month carry whenever the grid carries a partial
  // trailing month, so the on-page "we cap at 48 months" claim would be false by
  // one. This is a deliberate one-month tightening of the spec's phrasing.
  const maxDelivery = addMonths(lastMonth, MAX_HORIZON_MONTHS);
  const [deliveryMonth, setDeliveryMonth] = useState("");
  const [basisKey, setBasisKey] = useState("trailing3y");

  const basisRows = anchor ? bases(data.months, data.index, anchor) : [];
  const chosen = basisRows.find((b) => b.key === basisKey) ?? basisRows[0] ?? null;

  const deliveryValid =
    !!deliveryMonth && !!anchor &&
    deliveryMonth > lastMonth && deliveryMonth <= maxDelivery;
  const horizon = deliveryValid ? monthDiff(lastMonth, deliveryMonth) : 0;

  const result = escalate(
    data.months, data.index, baseMonth, baseCost,
    deliveryValid && chosen
      ? { deliveryMonth, annualizedPct: chosen.annualizedPct }
      : null
  );

  const bandRow =
    deliveryValid && anchor && horizon >= MIN_HORIZON_MONTHS
      ? band(data.months, data.index, Math.min(horizon, MAX_HORIZON_MONTHS), anchor)
      : null;
```

Add the month helper near `usd` (top of file):

```ts
/** "2026-06" + 48 -> "2030-06". Local to the UI's input cap. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
```

Replace the existing `bridge(...)` call with the windowed form so the historical bridge is unaffected:

```ts
  const rows = bridgeWindow(
    data.months, data.componentIndex, data.components,
    baseMonth, lastMonth, baseCost
  );
```

- [ ] **Step 2: Add the DELIVER BY input as a third child of the existing control row**

Insert after the BASE COST `<label>` (currently ends at line 112), before the trailing `<span>`:

```tsx
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          DELIVER BY{" "}
          <input
            type="month"
            min={lastMonth}
            max={maxDelivery}
            value={deliveryMonth}
            onChange={(e) => setDeliveryMonth(e.target.value)}
            style={input}
          />
        </label>
        {anchor && (
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            CARRY{" "}
            <select
              value={chosen?.key ?? ""}
              onChange={(e) => setBasisKey(e.target.value)}
              style={input}
              disabled={!deliveryValid}
            >
              {basisRows.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} · {b.annualizedPct >= 0 ? "+" : ""}
                  {b.annualizedPct.toFixed(2)}%/yr
                </option>
              ))}
            </select>
          </label>
        )}
```

- [ ] **Step 3: Add an out-of-range message**

After the existing `{result && !validBaseCost && (...)}` block:

```tsx
      {deliveryMonth && !deliveryValid && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          Pick a delivery month after {lastMonth} and no later than {maxDelivery}.
          We cap the forward leg at {MAX_HORIZON_MONTHS} months because that is
          where the realized sample stops supporting a range — beyond it there
          are fewer than three independent windows to draw on.
        </div>
      )}
```

- [ ] **Step 4: Add a forward KPI card**

Inside the `{result && validBaseCost && (...)}` block, after the four existing `KpiCard`s:

```tsx
            {result.forward && chosen && (
              <KpiCard
                label={`Escalated to ${result.forward.deliveryMonth}`}
                value={usd(result.totalCost)}
                context={`${result.monthsElapsed}mo measured + ${result.forward.monthsAhead}mo carried at ${chosen.annualizedPct.toFixed(2)}%/yr (${chosen.label})`}
                accent="violet"
                chip={
                  bandRow ? (
                    <span
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontSize: 11,
                      }}
                    >
                      p10–p90 {bandRow.p10.toFixed(1)}–{bandRow.p90.toFixed(1)}%/yr
                    </span>
                  ) : null
                }
              />
            )}
```

- [ ] **Step 5: Add the contingency basis table**

After the existing "What drove it" `table-card` div, still inside the `result && validBaseCost` block:

```tsx
          {anchor && basisRows.length > 0 && (
            <div className="table-card" style={{ marginTop: 16 }}>
              <h2>
                What you could carry{" "}
                <span className="subtitle">
                  realized regimes, measured to {anchor} — not a forecast
                </span>
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Basis</th>
                    <th>Window</th>
                    <th>Annualized</th>
                    <th>Cumulative</th>
                    {deliveryValid && <th>Your {horizon}mo factor</th>}
                  </tr>
                </thead>
                <tbody>
                  {basisRows.map((b) => (
                    <tr
                      key={b.key}
                      style={
                        b.key === chosen?.key
                          ? { background: "var(--bg)", fontWeight: 600 }
                          : undefined
                      }
                    >
                      <td>
                        {b.label}
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.note}</div>
                      </td>
                      <td>
                        {b.startMonth} → {b.endMonth}{" "}
                        <span style={{ color: "var(--muted)" }}>({b.months}mo)</span>
                      </td>
                      <td>{fmtSigned(b.annualizedPct)}/yr</td>
                      <td>{fmtSigned(b.cumulativePct)}</td>
                      {deliveryValid && (
                        <td>
                          ×
                          {Math.pow(1 + b.annualizedPct / 100, horizon / 12).toFixed(4)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {bandRow && (
                <div
                  style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px" }}
                >
                  Across every realized {bandRow.horizonMonths}-month window since{" "}
                  {bandRow.sampleStartMonth}, annualized DC Build escalation ran{" "}
                  <strong>
                    {bandRow.p10.toFixed(2)}% (p10) → {bandRow.p50.toFixed(2)}% (p50) →{" "}
                    {bandRow.p90.toFixed(2)}% (p90)
                  </strong>
                  . That is {bandRow.windows} overlapping windows —{" "}
                  <strong>≈{bandRow.independentDraws.toFixed(1)} independent</strong>{" "}
                  draws — and {bandRow.spikeOverlapPct.toFixed(0)}% of them touch the
                  2021–22 spike. It is a range of what has happened, not a probability
                  distribution over what will.
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 6: Build and eyeball**

Run: `cd site && npm run build`
Expected: build succeeds with no type errors.

Run: `cd site && npm run dev` then open `http://localhost:3000/escalation`, set DELIVER BY to a month ~30 months out, and confirm: the fifth KPI card appears, the basis table highlights the selected row, the band sentence renders with a plausible independent-draw count, and clearing DELIVER BY returns the page to its P1 appearance.

- [ ] **Step 7: Commit**

```bash
git add site/src/components/DcEscalationClient.tsx
git commit -m "feat(site): deliver-by input, contingency basis table and realized band"
```

---

## Task 8: Page data slice and the methodology rewrite

**Files:**
- Modify: `site/src/app/escalation/page.tsx`

**Interfaces:**
- Consumes: `EscalationData` from Task 7.
- Produces: `componentLastObs` supplied to the client; corrected page copy.

**The copy change is a correctness requirement, not polish.** `page.tsx:69-73` currently asserts "This is history, not a forecast: it measures what input prices have already done, and stops at the last print." Once the page projects to a delivery month that is **false as written**. The replacement must keep the underlying claim true: the bases are realized regimes the reader chooses to carry, not a prediction of which one obtains.

- [ ] **Step 1: Add `componentLastObs` to the data slice**

Change the `data` object (lines 19-31):

```ts
const data: EscalationData = {
  months: build.monthly.months,
  index: build.monthly.index,
  componentIndex: build.monthly.components,
  components: build.components.map((c) => ({
    code: c.code,
    label: c.label,
    group: c.group,
    weight: c.weight,
  })),
  // Per-component last_obs: the client derives the last COMPLETE month from
  // min() of these, because the grid's trailing month is a partial stub in
  // which only the two live-proxy components move.
  componentLastObs: build.components.map((c) => c.last_obs),
  asOf: build.as_of,
  rebase: dc.rebase,
};
```

- [ ] **Step 2: Update the payload comment**

Line 17-18 says "the monthly grid, not the 3,124-point daily series — so the page ships ~14.2KB". The monthly grid is now ~222 months. Change to:

```ts
// Slice only what the calculator needs — the monthly grid (222 months back to
// 2007-12, ~31KB), not the ~3,100-point daily series — so the page ships a
// fraction of the ~575KB artifact.
```

- [ ] **Step 3: Rewrite the closing methodology sentences**

Replace lines 69-73 (`{" "}This is history, not a forecast: ... /datacenter</a>.`) with:

```tsx
          {" "}The measured leg is history: it stops at the last print. The{" "}
          <em>deliver by</em> leg is not a forecast either — it carries a rate you
          choose from regimes that have actually occurred (the long-run average, the
          post-2008 downturn, the last three years, the latest twelve months, or the
          2021–23 spike), each shown with the exact window it was measured over. We
          do not predict which regime will obtain, and we publish no central path.
          The realized band underneath the table is a count of what happened across
          overlapping historical windows of the same length as yours, reported with
          the number of independent draws behind it — small enough, over a sample
          containing one downturn and one spike, that it should be read as a range
          of precedents rather than a probability. Component sources and weights are
          documented on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a>.
```

- [ ] **Step 4: Verify the no-forecast claim is now true as written**

Read the whole methodology block top to bottom. Confirm no remaining sentence asserts the page stops at the last print, and no sentence claims a prediction. This is a manual gate — record that it was done.

- [ ] **Step 5: Build**

Run: `cd site && npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add site/src/app/escalation/page.tsx
git commit -m "feat(site): supply component last_obs and rewrite the escalation method copy"
```

---

## Task 9: e2e coverage and full-stack verification

**Files:**
- Modify: `site/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: e2e assertions for the forward leg.

- [ ] **Step 1: Write the failing e2e tests**

Append to `site/e2e/smoke.spec.ts`:

```ts
test("escalation calculator projects forward when a delivery month is set", async ({
  page,
}) => {
  await page.goto("/escalation");
  await expect(page.getByText("Total escalation")).toBeVisible();

  // no forward leg until a delivery month is chosen
  await expect(page.getByText("What you could carry")).toHaveCount(0);

  const deliver = page.locator('input[type="month"]').nth(1);
  const max = await deliver.getAttribute("max");
  expect(max).toBeTruthy();
  await deliver.fill(max!);

  await expect(page.getByText("What you could carry")).toBeVisible();
  await expect(page.getByText(/independent/)).toBeVisible();
  await expect(page.getByText(/Escalated to /).last()).toBeVisible();
});

test("escalation calculator refuses a delivery month past the cap", async ({ page }) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  await deliver.fill("2099-01");
  await expect(
    page.getByText(/Pick a delivery month after/)
  ).toBeVisible();
});

test("escalation basis table lists a downturn regime", async ({ page }) => {
  await page.goto("/escalation");
  const deliver = page.locator('input[type="month"]').nth(1);
  const max = await deliver.getAttribute("max");
  await deliver.fill(max!);
  // the 2008-12 -> 2011-12 window only resolves because of the deep backfill
  await expect(page.getByText("Downturn regime (GFC)")).toBeVisible();
});
```

- [ ] **Step 2: Run them to verify they fail against a stale build**

Run: `cd site && npm run build && npm run e2e -- -g "escalation"`
Expected: the three new tests pass if Tasks 7-8 landed. If "Downturn regime (GFC)" is missing, the backfill from Task 3 did not reach the site's `datacenter.json` — go back and check.

- [ ] **Step 3: Update the route copy assertion if needed**

`smoke.spec.ts:33` asserts `/escalation` contains "the math is a ratio, so the unit is yours" — that string is unchanged by this work, so the entry stays. Confirm it still passes.

- [ ] **Step 4: Full-stack verification**

Run each and confirm green, capturing the output:

```bash
pytest -q
cd site && npm run build && npm test && npm run e2e
```

Expected: Python suite all pass; site build succeeds; vitest all pass; Playwright 33+ tests pass with zero console errors.

- [ ] **Step 5: Verify the spec's acceptance criteria one by one**

Walk `docs/superpowers/specs/2026-07-25-dc-contingency-table-design.md` §9 and confirm each of the nine criteria. In particular:
- **(1) hand-reproducibility** — pick one basis and one band percentile off the rendered page and re-derive both from `site/public/data/datacenter.json` with a throwaway script. Both must match to display precision.
- **(2) bridge sums to ≤1e-4 pp** — verified by `dcEscalation.test.ts`.
- **(6) absolute bases pinned** — verified by `dcContingency.test.ts`.
- **(7) anchor excludes the stub** — verified by `dcContingency.test.ts`; also confirm on-page that the basis table says "measured to <last complete month>", not the grid's trailing month.

- [ ] **Step 6: Commit**

```bash
git add site/e2e/smoke.spec.ts
git commit -m "test(site): e2e coverage for the escalation forward leg"
```

- [ ] **Step 7: Update the gap register**

In `docs/plans/2026-07-24-project-controls-gaps.md`, change the P3 entry's status line to record that P3a shipped and that P3b/P3c remain, and point at both the spec and this plan. Note explicitly that the register's "8.5% forward-driver coverage" and "87.5% CPI coverage" figures were corrected by recon (spec §2.1) so a future reader does not re-derive them.

```bash
git add docs/plans/2026-07-24-project-controls-gaps.md
git commit -m "docs(register): P3a shipped; record the recon corrections to P3"
```

---

## Self-review notes

**Spec coverage.** §3 backfill → Tasks 1-3. §4.1 pipeline changes → Task 2 (all four rows; `config/series.json` correctly needs no change). §4.2 site modules → Tasks 4-7. §5.1 named bases → Task 4. §5.2 bridge identity → Task 6. §5.3 band + §5.3.1 edge cases → Tasks 5, 7. §5.4 anchoring → Task 4 (`lastCompleteMonth`). §6 copy → Task 8. §9 acceptance → Task 9 Step 5. §8 risk 1 pre-cleared above; risks 2-5 covered by Task 4's anchor, Task 5's disclosure, Task 3 Step 7's payload check, and Task 3 Step 4's invariance gate.

**Two deliberate deviations from the spec, both narrowing risk:**
1. The spec proposed making `GRID_START` per-index. Reading `aggregate.py:9,28` showed that is unnecessary — `fill_daily` clamps to each component's own first observation and `headline()` intersects component dates, so a single earlier `GRID_START` leaves Ops and Hardware untouched automatically. Fewer moving parts, same outcome.
2. The spec said "`escalate()` gains an optional forward segment." Implemented as an optional 5th parameter defaulting to absent, so all existing 4-argument call sites and every existing test are byte-identical in behaviour.

**Known follow-ups deliberately left open:** the stale hardcoded power-nowcast MAE string (`datacenter/page.tsx:211-220`, spec §2.1 item 5) belongs to P3b and is not touched here. Ops and Hardware keep their 2017-01 start.
