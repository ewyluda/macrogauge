# Labor Jobs Dashboard + State My Inflation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `labor.json` + a `/labor` jobs dashboard, and add thin, honest state-level localization to `/my-inflation`.

**Architecture:** `labor.json` is a pure store→writer artifact published by a new isolated `_labor_phase` (mirrors the geography phase) and rendered by a new `/labor` page that reuses the already-published NFP nowcast + accountability. State My Inflation is site-only: `/my-inflation` imports the P2 `geo.json` and the reweighter gains an optional per-component YoY override applied to the headline/drivers snapshot.

**Tech Stack:** Python 3.12 (stdlib only in pipeline), pytest, JSON Schema draft 2020-12, Next.js static export + TypeScript, vitest, Playwright.

## Global Constraints (verbatim from the repo — every task inherits these)

- HTTP is injected, never real, in tests. No test hits the network.
- Every published file validates inline against `schemas/<stem>.schema.json`; `jsonschema.ValidationError` re-raises and **fails the run** (caught before the generic `Exception` in `_run_phase`). Schemas must legally allow degraded output (all-null blocks, empty arrays).
- Writer contract: pure `build(conn) -> dict`; `write(payload, out_dir, published_at) -> Path` writing `json.dumps({"published_at": published_at, **payload}, indent=2) + "\n"`.
- Store rows are append-only; new work is additive. Site computes nothing (render-only; client sort/format is fine). Nullable fields need hand-written casts via `site/src/lib/types.ts`.
- YoY convention: own-obs like-month via `pipeline.dates.months_back(as_of, 12)`, null if the base is absent or zero (`not base` guard for ratios). Rate year-ago change is a subtraction with a `base is None` guard, published as `delta_1y_pp` (a percentage-point delta, NOT a percent change).
- `run_daily`'s published_at stamp sweep flags any out-dir `*.json` (except `sources_status.json`/`qa.json`) whose stamp differs — new artifacts must publish every run.
- New site pages: add to `site/src/lib/nav.ts` NAV **and** `site/e2e/smoke.spec.ts` ROUTES (unique body marker) or CI fails.
- TDD every task: failing test first, watch it fail, minimal code, full `pytest -q` green before commit. **Commit per task. Never push** (push = production deploy). Current full-suite baseline on this branch: **558 pytest / 30 vitest / 25 e2e**.
- Branch: `labor-state-inflation`. Spec: `docs/superpowers/specs/2026-07-17-labor-jobs-and-state-my-inflation-design.md`.

---

## File structure

- Create `pipeline/publish/labor.py` — the labor.json writer (one responsibility: build/write the jobs artifact).
- Create `schemas/labor.schema.json` — its schema.
- Create `tests/test_labor_writer.py` — writer unit tests.
- Modify `pipeline/run_daily.py` — add `_labor_phase` + thread `labor_error` into qa.
- Modify `pipeline/publish/qa.py` — add `labor_ok` check + `labor_error` param.
- Modify `tests/test_qa.py` — count pins +1, `test_labor_ok_check`.
- Modify `tests/test_run_daily.py` — e2e assertions + isolation + schema-violation tests; qa total 21→22.
- Create `site/src/app/labor/page.tsx` — the jobs dashboard.
- Modify `site/src/lib/types.ts` — `Labor` type.
- Modify `site/src/lib/nav.ts` — `/labor` under Economy.
- Modify `site/e2e/smoke.spec.ts` — `/labor` route.
- Modify `site/src/app/real-wages/page.tsx` — footer honesty fix.
- Modify `site/src/lib/reweight.ts` — optional `overrides` param on `weightedYoY`/`contributions`.
- Modify `site/src/lib/reweight.test.ts` (or the existing reweight vitest file) — override tests.
- Modify `site/src/components/MyInflationClient.tsx` — state selector + overrides.
- Modify `site/src/app/my-inflation/page.tsx` — pass `geo.json` states in.

---

## Task 1: `labor.py` writer + schema

**Files:**
- Create: `pipeline/publish/labor.py`
- Create: `schemas/labor.schema.json`
- Test: `tests/test_labor_writer.py`

**Interfaces:**
- Produces: `labor.build(conn) -> dict`, `labor.write(payload, out_dir, published_at) -> Path`.

- [ ] **Step 1: Write the failing tests** (`tests/test_labor_writer.py`)

```python
"""Tests for pipeline/publish/labor.py — labor.json jobs artifact (todo #6)."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import labor, validate
from pipeline.store import vintage

SCHEMA = Path(__file__).parent.parent / "schemas" / "labor.schema.json"


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FRED", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_payrolls_block_hand_computed(tmp_path):
    conn = _store_with(tmp_path, {"PAYEMS": {
        "2025-06-01": 159000.0, "2026-05-01": 161500.0, "2026-06-01": 161650.0}})
    p = labor.build(conn)["payrolls"]
    assert p["level_k"] == 161650
    assert p["mom_change_k"] == 150            # 161650 - 161500
    assert p["yoy_pct"] == 1.67                # (161650/159000 - 1)*100 = 1.6667
    assert p["as_of"] == "2026-06-01"


def test_unemployment_delta_not_pct(tmp_path):
    conn = _store_with(tmp_path, {"UNRATE": {"2025-06-01": 4.1, "2026-06-01": 4.34}})
    u = labor.build(conn)["unemployment"]
    assert u == {"rate": 4.3, "delta_1y_pp": 0.24, "as_of": "2026-06-01"}


def test_claims_block_4wk_avg(tmp_path):
    conn = _store_with(tmp_path, {
        "ICSA": {"2026-06-06": 220000.0, "2026-06-13": 230000.0,
                 "2026-06-20": 240000.0, "2026-06-27": 250000.0,
                 "2026-07-04": 210000.0},
        "CCSA": {"2026-06-27": 1800000.0}})
    c = labor.build(conn)["claims"]
    assert c["initial"] == 210000
    # last 4 weeks: 230k,240k,250k,210k -> avg 232500
    assert c["initial_4wk_avg"] == 232500
    assert c["continued"] == 1800000
    assert c["as_of"] == "2026-07-04"


def test_wages_block(tmp_path):
    conn = _store_with(tmp_path, {
        "CES0500000003": {"2025-06-01": 30.0, "2026-06-01": 31.2},
        "FRBATLWGT3MMAUMHWGO": {"2026-06-01": 4.3}})
    w = labor.build(conn)["wages"]
    assert w["ahe_yoy_pct"] == 4.0             # (31.2/30 - 1)*100
    assert w["atlanta_wgt_pct"] == 4.3
    assert w["as_of"] == "2026-06-01"


def test_history_tails_capped(tmp_path):
    payems = {f"{2022 + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}-01": 150000.0 + m * 100
              for m in range(1, 49)}  # 48 months -> monthly tail keeps last 36
    conn = _store_with(tmp_path, {"PAYEMS": payems,
                                  "ICSA": {f"2026-{w:02d}-01": 200000.0 + w
                                           for w in range(1, 13)}})
    h = labor.build(conn)["history"]
    assert len(h["monthly"]["months"]) == 36
    assert len(h["monthly"]["payrolls_yoy_pct"]) == 36
    assert len(h["weekly"]["dates"]) <= 52


def test_empty_store_degrades_and_validates(tmp_path):
    conn = _store_with(tmp_path, {})
    payload = labor.build(conn)
    assert payload["payrolls"]["level_k"] is None
    assert payload["unemployment"]["delta_1y_pp"] is None
    path = labor.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
    assert path.name == "labor.json"


def test_written_file_validates(tmp_path):
    conn = _store_with(tmp_path, {
        "PAYEMS": {"2025-06-01": 159000.0, "2026-06-01": 161650.0},
        "UNRATE": {"2026-06-01": 4.3}})
    payload = labor.build(conn)
    path = labor.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
    text = path.read_text()
    assert text.startswith('{\n  "published_at"')
    assert text.endswith("\n")
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_labor_writer.py -q`
Expected: FAIL — `ImportError: cannot import name 'labor'`.

- [ ] **Step 3: Write `schemas/labor.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "labor",
  "type": "object",
  "required": ["published_at", "payrolls", "unemployment", "claims", "wages", "history"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "payrolls": {
      "type": "object", "additionalProperties": false,
      "required": ["level_k", "mom_change_k", "yoy_pct", "as_of"],
      "properties": {
        "level_k": {"type": ["number", "null"]},
        "mom_change_k": {"type": ["number", "null"]},
        "yoy_pct": {"type": ["number", "null"]},
        "as_of": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    },
    "unemployment": {
      "type": "object", "additionalProperties": false,
      "required": ["rate", "delta_1y_pp", "as_of"],
      "properties": {
        "rate": {"type": ["number", "null"]},
        "delta_1y_pp": {"type": ["number", "null"]},
        "as_of": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    },
    "claims": {
      "type": "object", "additionalProperties": false,
      "required": ["initial", "initial_4wk_avg", "continued", "as_of"],
      "properties": {
        "initial": {"type": ["number", "null"]},
        "initial_4wk_avg": {"type": ["number", "null"]},
        "continued": {"type": ["number", "null"]},
        "as_of": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    },
    "wages": {
      "type": "object", "additionalProperties": false,
      "required": ["ahe_yoy_pct", "atlanta_wgt_pct", "as_of"],
      "properties": {
        "ahe_yoy_pct": {"type": ["number", "null"]},
        "atlanta_wgt_pct": {"type": ["number", "null"]},
        "as_of": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    },
    "history": {
      "type": "object", "additionalProperties": false,
      "required": ["monthly", "weekly"],
      "properties": {
        "monthly": {
          "type": "object", "additionalProperties": false,
          "required": ["months", "payrolls_yoy_pct", "unemployment_rate"],
          "properties": {
            "months": {"type": "array", "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
            "payrolls_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
            "unemployment_rate": {"type": "array", "items": {"type": ["number", "null"]}}
          }
        },
        "weekly": {
          "type": "object", "additionalProperties": false,
          "required": ["dates", "initial_claims"],
          "properties": {
            "dates": {"type": "array", "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
            "initial_claims": {"type": "array", "items": {"type": ["number", "null"]}}
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Write `pipeline/publish/labor.py`**

```python
"""Writer for labor.json — jobs-market dashboard (payrolls, unemployment, claims, wages).

Pure store -> writer (the real_wages/geo pattern): display-only, never touches the gauge
engine. Own-obs like-month YoY where computed (null if base absent or zero). Unemployment
reports a percentage-point change (delta_1y_pp), not a percent change. The NFP nowcast and
graded accountability are already published (nowcast_latest.json / accountability_nfp.json)
and are NOT duplicated here — the page imports them directly. Missing data publishes null
blocks: a new writer must never be able to take down the publish block.
"""
import json
from pathlib import Path

from pipeline.dates import months_back, prior_month
from pipeline.store import vintage

PAYEMS = "PAYEMS"
UNRATE = "UNRATE"
ICSA = "ICSA"
CCSA = "CCSA"
AHE = "CES0500000003"       # avg hourly earnings, total private ($/hr) — YoY computed here
WGT = "FRBATLWGT3MMAUMHWGO"  # Atlanta Fed wage growth — already a 12-mo growth %
MONTHLY_TAIL = 36
WEEKLY_TAIL = 52


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _payrolls(payems):
    if not payems:
        return {"level_k": None, "mom_change_k": None, "yoy_pct": None, "as_of": None}
    as_of = max(payems)
    prior = payems.get(prior_month(as_of))
    base = payems.get(months_back(as_of, 12))
    return {"level_k": round(payems[as_of]),
            "mom_change_k": None if prior is None else round(payems[as_of] - prior),
            "yoy_pct": None if not base else round((payems[as_of] / base - 1) * 100, 2),
            "as_of": as_of}


def _unemployment(unrate):
    if not unrate:
        return {"rate": None, "delta_1y_pp": None, "as_of": None}
    as_of = max(unrate)
    base = unrate.get(months_back(as_of, 12))
    return {"rate": round(unrate[as_of], 1),
            "delta_1y_pp": None if base is None else round(unrate[as_of] - base, 2),
            "as_of": as_of}


def _claims(icsa, ccsa):
    initial = avg = i_as_of = continued = c_as_of = None
    if icsa:
        weeks = sorted(icsa)
        i_as_of = weeks[-1]
        initial = round(icsa[i_as_of])
        last4 = weeks[-4:]
        avg = round(sum(icsa[w] for w in last4) / len(last4))
    if ccsa:
        c_as_of = max(ccsa)
        continued = round(ccsa[c_as_of])
    as_of = max([d for d in (i_as_of, c_as_of) if d], default=None)
    return {"initial": initial, "initial_4wk_avg": avg,
            "continued": continued, "as_of": as_of}


def _wages(ahe, wgt):
    ahe_yoy = wgt_pct = None
    as_ofs = []
    if ahe:
        a = max(ahe)
        base = ahe.get(months_back(a, 12))
        ahe_yoy = None if not base else round((ahe[a] / base - 1) * 100, 2)
        as_ofs.append(a)
    if wgt:
        w = max(wgt)
        wgt_pct = round(wgt[w], 2)
        as_ofs.append(w)
    return {"ahe_yoy_pct": ahe_yoy, "atlanta_wgt_pct": wgt_pct,
            "as_of": max(as_ofs) if as_ofs else None}


def _history(payems, unrate, icsa):
    months = sorted(set(payems) | set(unrate))[-MONTHLY_TAIL:]

    def p_yoy(m):
        base = payems.get(months_back(m, 12))
        if m not in payems or not base:
            return None
        return round((payems[m] / base - 1) * 100, 2)

    weeks = sorted(icsa)[-WEEKLY_TAIL:]
    return {"monthly": {"months": months,
                        "payrolls_yoy_pct": [p_yoy(m) for m in months],
                        "unemployment_rate": [None if m not in unrate
                                              else round(unrate[m], 1) for m in months]},
            "weekly": {"dates": weeks,
                       "initial_claims": [round(icsa[w]) for w in weeks]}}


def build(conn) -> dict:
    payems, unrate = _rows(conn, PAYEMS), _rows(conn, UNRATE)
    icsa, ccsa = _rows(conn, ICSA), _rows(conn, CCSA)
    ahe, wgt = _rows(conn, AHE), _rows(conn, WGT)
    return {"payrolls": _payrolls(payems),
            "unemployment": _unemployment(unrate),
            "claims": _claims(icsa, ccsa),
            "wages": _wages(ahe, wgt),
            "history": _history(payems, unrate, icsa)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "labor.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

- [ ] **Step 5: Run tests, verify pass**

Run: `python -m pytest tests/test_labor_writer.py -q`
Expected: PASS (7 tests).

- [ ] **Step 6: Run full suite**

Run: `python -m pytest -q`
Expected: PASS (565).

- [ ] **Step 7: Commit**

```bash
git add pipeline/publish/labor.py schemas/labor.schema.json tests/test_labor_writer.py
git commit -m "feat(labor): labor.json writer + schema — payrolls/unemployment/claims/wages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: wire `_labor_phase` into run_daily + `labor_ok` QA

**Files:**
- Modify: `pipeline/run_daily.py` (import `labor as labor_json`; add `_labor_phase` after `_geography_phase`; thread `labor_error` into `qa.run_checks`; update the six→seven-phase docstring)
- Modify: `pipeline/publish/qa.py` (add `labor_error` param + `labor_ok` check after `geography_ok`)
- Modify: `tests/test_qa.py` (three count pins +1; `test_labor_ok_check`)
- Modify: `tests/test_run_daily.py` (qa total 21→22; labor.json exists+validates+stamped; isolation + schema-violation tests)

**Interfaces:**
- Consumes: `labor.build(conn)`, `labor.write(...)` from Task 1; `_run_phase(label, fn)`, `SCHEMAS`, `qa.run_checks(...)` in run_daily.

- [ ] **Step 1: Add the qa `labor_ok` check + test (failing first).** In `tests/test_qa.py`, add after `test_geography_ok_check`:

```python
def test_labor_ok_check():
    ok = qa.run_checks(None, today="2026-07-12", engine_error="x")
    names = {c["name"]: c for c in ok["checks"]}
    assert names["labor_ok"]["pass"] is True

    bad = qa.run_checks(None, today="2026-07-12", engine_error="x",
                        labor_error="RuntimeError: labor boom")
    names = {c["name"]: c for c in bad["checks"]}
    assert names["labor_ok"]["pass"] is False
    assert names["labor_ok"]["critical"] is False
    assert "labor boom" in names["labor_ok"]["detail"]
```

- [ ] **Step 2: Run it, verify fail**

Run: `python -m pytest tests/test_qa.py::test_labor_ok_check -q`
Expected: FAIL — `labor_ok` not in checks (and `labor_error` is an unexpected kwarg).

- [ ] **Step 3: Add the param + check in `pipeline/publish/qa.py`.** Add `labor_error: str | None = None,` to the `run_checks` signature (next to `geography_error`), and after the `geography_ok` append:

```python
    checks.append({"name": "labor_ok", "critical": False,
                   "pass": labor_error is None,
                   "detail": labor_error or "labor panel completed"})
```

- [ ] **Step 4: Bump the three count pins in `tests/test_qa.py`** (each +1, mirroring how `geography_ok` bumped them): `test_all_green_when_fresh` `(8, 8) -> (9, 9)`; `test_stale_headline_fails` `r["passed"] == 7 -> == 8`; `test_connector_and_freshness_checks_green` `(10, 10) -> (11, 11)`. Update the inline comment listing the always-on checks to include `labor_ok`.

- [ ] **Step 5: Run qa tests, verify pass**

Run: `python -m pytest tests/test_qa.py -q`
Expected: PASS.

- [ ] **Step 6: Wire `_labor_phase` in `pipeline/run_daily.py`.** Add `labor as labor_json` to the `from pipeline.publish import (...)` block. After the `_geography_phase` block (`_, geography_error = _run_phase("GEOGRAPHY", _geography_phase)`), add:

```python
    # Labor jobs dashboard: isolated like the phases above — pure store reads
    # (payrolls/unemployment/claims/wages), display-only, never touches the
    # core gauge.
    def _labor_phase():
        labor_path = labor_json.write(labor_json.build(conn), args.out,
                                      published_at=published_at)
        validate.validate_file(labor_path, SCHEMAS / "labor.schema.json")
        print(f"published: {labor_path}")

    _, labor_error = _run_phase("LABOR", _labor_phase)
```

Then add `labor_error=labor_error,` to the `qa.run_checks(...)` call (next to `geography_error=geography_error,`). Update the module docstring: "Six independently isolated phases" → "Seven", and add "(7) the labor jobs dashboard (surfaces via labor_ok)" to the phase list.

- [ ] **Step 7: Update `tests/test_run_daily.py` e2e.** In `test_end_to_end_all_sources`: add `"labor.json"` to the file-exists tuple; change `assert qa["total"] == 21` to `== 22` and extend its comment with `+ labor_ok`; after the geography assertions add:

```python
    assert checks["labor_ok"]["pass"] is True
    labor_out = json.loads((out / "labor.json").read_text())
    assert labor_out["published_at"] == run_stamp
    # PAYEMS rides the FRED fake (fred_cpiaucns.json for any series_id); its
    # latest fixture obs is 2026-04-01 = 320.1 -> level_k rounds to 320.
    assert labor_out["payrolls"]["level_k"] == 320
```

Add two isolation tests after `test_geography_schema_violation_fails_run`:

```python
def test_labor_failure_does_not_block_gauge_or_geography(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("labor boom")

    monkeypatch.setattr(run_daily.labor_json, "build", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert (out / "pulse.json").exists()
    assert (out / "geo.json").exists()
    assert not (out / "labor.json").exists()
    checks = {c["name"]: c for c in json.loads((out / "qa.json").read_text())["checks"]}
    assert checks["labor_ok"]["pass"] is False
    assert "labor boom" in checks["labor_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True


def test_labor_schema_violation_fails_run(tmp_path, monkeypatch):
    set_keys(monkeypatch)
    monkeypatch.setattr(run_daily.labor_json, "build",
                        lambda conn: {"payrolls": "nope"})
    store, out = tmp_path / "store", tmp_path / "out"
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
```

- [ ] **Step 8: Run the run_daily + qa tests, verify pass**

Run: `python -m pytest tests/test_run_daily.py tests/test_qa.py -q`
Expected: PASS.

- [ ] **Step 9: Full suite + commit**

Run: `python -m pytest -q` → PASS.

```bash
git add pipeline/run_daily.py pipeline/publish/qa.py tests/test_qa.py tests/test_run_daily.py
git commit -m "feat(labor): isolated _labor_phase + labor_ok qa check (qa 21->22)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: publish real `labor.json` (data snapshot for the site build)

**Files:** Modify `site/public/data/labor.json` (new), `store/` (append).

The `/labor` page static-imports `labor.json`; it must exist and be committed for `next build` to typecheck. Generate it with a real pipeline run (all keys are in `.env`).

- [ ] **Step 1: Run the pipeline**

```bash
set -a && . ./.env && set +a && python -m pipeline.run_daily --store store --out site/public/data
```
Expected: `EXIT 0`; `published: .../labor.json` in the output; qa `labor_ok` pass.

- [ ] **Step 2: Sanity-check the values**

```bash
python3 -c "import json; d=json.load(open('site/public/data/labor.json')); \
print('payrolls', d['payrolls']); print('unemployment', d['unemployment']); \
print('claims', d['claims']); print('wages', d['wages']); \
print('monthly tail', len(d['history']['monthly']['months']), 'weekly tail', len(d['history']['weekly']['dates']))"
```
Expected: payrolls ~160,000k level with a small MoM change and ~1% YoY; unemployment ~4% with a small delta; claims ~200k–250k; wages ~4% AHE + Atlanta WGT; monthly tail 36, weekly tail up to 52. If any block is unexpectedly all-null, stop and diagnose the series code before committing.

- [ ] **Step 3: Commit the data snapshot** (store + all republished data — the run rewrites every artifact with a fresh stamp)

```bash
git add store site/public/data
git commit -m "data: publish labor.json + republish with the labor phase live

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `/labor` page + `Labor` type + nav + e2e

**Files:**
- Modify: `site/src/lib/types.ts` (add `Labor`)
- Create: `site/src/app/labor/page.tsx`
- Modify: `site/src/lib/nav.ts` (Economy group)
- Modify: `site/e2e/smoke.spec.ts` (route)

**Interfaces:**
- Consumes: `labor.json` (Task 3), `nowcast_latest.json`, `accountability_nfp.json`; `KpiCard`, `EChart`, `baseOption`/`C` from `@/lib/chartTheme`, `fmtSigned`/`fmtMonth` from `@/lib/format`.

- [ ] **Step 1: Add the `Labor` type to `site/src/lib/types.ts`** (near the geography types):

```typescript
export type LaborBlock = { as_of: string | null };
export type Labor = {
  published_at: string;
  payrolls: { level_k: number | null; mom_change_k: number | null; yoy_pct: number | null; as_of: string | null };
  unemployment: { rate: number | null; delta_1y_pp: number | null; as_of: string | null };
  claims: { initial: number | null; initial_4wk_avg: number | null; continued: number | null; as_of: string | null };
  wages: { ahe_yoy_pct: number | null; atlanta_wgt_pct: number | null; as_of: string | null };
  history: {
    monthly: { months: string[]; payrolls_yoy_pct: (number | null)[]; unemployment_rate: (number | null)[] };
    weekly: { dates: string[]; initial_claims: (number | null)[] };
  };
};
```

- [ ] **Step 2: Create `site/src/app/labor/page.tsx`** (server component; marker string `the jobs market, in receipts` used by the e2e):

```tsx
import type { Metadata } from "next";
import laborJson from "../../../public/data/labor.json";
import nowcastJson from "../../../public/data/nowcast_latest.json";
import nfpJson from "../../../public/data/accountability_nfp.json";
import { KpiCard } from "@/components/KpiCard";
import { EChart } from "@/components/EChart";
import { C, baseOption } from "@/lib/chartTheme";
import { fmtSigned, fmtMonth } from "@/lib/format";
import type { Labor, Nowcast } from "@/lib/types";

const d = laborJson as Labor;
const nowcast = nowcastJson as Nowcast;
const nfp = nfpJson as { graded: { mae?: number; bias?: number } | Record<string, unknown> };

export const metadata: Metadata = {
  title: "Labor Market — payrolls, unemployment, claims, wages",
  description:
    "The US jobs market in one dashboard: nonfarm payrolls, unemployment, jobless claims and wage growth, with our NFP nowcast graded in public.",
};

const k = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const signedK = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}k`;

export default function LaborPage() {
  const m = d.history.monthly;
  const w = d.history.weekly;
  const nfpNow = nowcast.nfp;
  return (
    <div>
      <h1>
        Labor Market <span className="subtitle">the jobs market, in receipts</span>
      </h1>
      <p className="lede">
        Nonfarm payrolls, unemployment, jobless claims and wage growth — the series the pipeline
        already collects, now in one place, with our next-jobs-report nowcast graded against the
        print.
      </p>

      <div className="kpi-row">
        <KpiCard label="Payrolls (MoM)" value={signedK(d.payrolls.mom_change_k)}
          context={`${k(d.payrolls.level_k)}k total · ${d.payrolls.as_of ? fmtMonth(d.payrolls.as_of) : "—"}`} accent="sky" />
        <KpiCard label="Unemployment" value={d.unemployment.rate == null ? "—" : `${d.unemployment.rate.toFixed(1)}%`}
          context={`${d.unemployment.delta_1y_pp == null ? "—" : `${d.unemployment.delta_1y_pp > 0 ? "+" : ""}${d.unemployment.delta_1y_pp.toFixed(1)}pp`} vs 1y ago`} accent="amber" />
        <KpiCard label="Initial claims" value={k(d.claims.initial)}
          context={`${k(d.claims.initial_4wk_avg)} 4-wk avg · ${d.claims.as_of ? fmtMonth(d.claims.as_of) : "—"}`} accent="violet" />
        <KpiCard label="Wage growth" value={d.wages.atlanta_wgt_pct == null ? "—" : `${d.wages.atlanta_wgt_pct.toFixed(1)}%`}
          context={`Atlanta Fed tracker · AHE ${fmtSigned(d.wages.ahe_yoy_pct)}`} accent="emerald" />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <EChart height={300} option={{
          ...baseOption(),
          series: [
            { name: "Payrolls YoY %", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.sky,
              data: m.months.map((mo, i) => [mo, m.payrolls_yoy_pct[i]] as [string, number | null]) },
            { name: "Unemployment %", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.amber,
              data: m.months.map((mo, i) => [mo, m.unemployment_rate[i]] as [string, number | null]) },
          ],
        }} />
      </div>

      <div className="chart-card" style={{ padding: "12px 8px 4px" }}>
        <EChart height={240} option={{
          ...baseOption(),
          series: [
            { name: "Initial claims", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.violet,
              data: w.dates.map((dt, i) => [dt, w.initial_claims[i]] as [string, number | null]) },
          ],
        }} />
      </div>

      <div className="section">
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Next jobs report</h2>
        <div className="kpi-row">
          <KpiCard label="NFP nowcast" value={nfpNow ? `${signedK(nfpNow.change_thousands)}` : "—"}
            context={nfpNow ? `reference ${fmtMonth(nfpNow.reference_month)}` : "awaiting sufficient history"} accent="sky" />
        </div>
        <p className="method">
          Our nonfarm-payroll nowcast for the next report, graded in public after each print
          (see the Forecast Scoreboard). Payrolls, claims and wages: BLS/DOL/FRED, monthly and
          weekly. Unemployment shows the percentage-point change vs a year ago, not a percent change.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `/labor` to the Economy nav group** in `site/src/lib/nav.ts` — inside the Economy `items` array, after `/recession`:

```typescript
          { href: "/labor", label: "Labor Market", emoji: "💼" },
```

- [ ] **Step 4: Add the route to `site/e2e/smoke.spec.ts` ROUTES** (before the closing `];`):

```typescript
  ["/labor", "the jobs market, in receipts"],
```

- [ ] **Step 5: Build + typecheck**

Run: `cd site && npm run build`
Expected: PASS; `/labor` appears in the route list.

- [ ] **Step 6: e2e**

Run: `npm run e2e` (from `site/`)
Expected: PASS including `renders /labor without console errors`.

- [ ] **Step 7: Commit**

```bash
git add site/src/app/labor/page.tsx site/src/lib/types.ts site/src/lib/nav.ts site/e2e/smoke.spec.ts
git commit -m "feat(labor): /labor jobs dashboard page + nav + e2e

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `/real-wages` footer honesty fix

**Files:** Modify `site/src/app/real-wages/page.tsx:88`.

- [ ] **Step 1: Update the footer sentence.** Replace the text around line 88 — "AHE stands in until Phase 4's labor.json." — with a pointer to the now-live page, e.g.:

```tsx
          feedable — see the <a href="/labor">Labor Market</a> dashboard for the
          full jobs picture (payrolls, claims, wage growth).
```

Keep the surrounding JSX/prose intact; this is a one-sentence swap. (Read the current lines 80–92 first and match the existing markup.)

- [ ] **Step 2: Build**

Run: `cd site && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add site/src/app/real-wages/page.tsx
git commit -m "docs(real-wages): retire the labor.json stopgap note, link /labor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `reweight.ts` optional per-component override

**Files:**
- Modify: `site/src/lib/reweight.ts` (`weightedYoY`, `contributions`)
- Test: `site/src/lib/reweight.test.ts` (existing vitest file)

**Interfaces:**
- Produces: `weightedYoY(components, weights, i, overrides?)`, `contributions(components, weights, i, overrides?)` where `overrides?: Record<string, number>` replaces a component's YoY at index `i` when present (backward-compatible: omitted → identical to today).

- [ ] **Step 1: Write the failing vitest.** In the reweight test file, add:

```typescript
import { weightedYoY, contributions } from "@/lib/reweight";

const COMPS = [
  { code: "electricity", label: "Electricity", yoy: [5.0] },
  { code: "fuel", label: "Gasoline", yoy: [10.0] },
];
const W = { electricity: 0.5, fuel: 0.5 };

test("override replaces a component's YoY at the index", () => {
  // national: 0.5*5 + 0.5*10 = 7.5
  expect(weightedYoY(COMPS, W, 0)).toBe(7.5);
  // override electricity -> 9: 0.5*9 + 0.5*10 = 9.5
  expect(weightedYoY(COMPS, W, 0, { electricity: 9 })).toBe(9.5);
});

test("override with no matching code is a no-op", () => {
  expect(weightedYoY(COMPS, W, 0, { nope: 3 })).toBe(7.5);
});

test("override feeds through to contributions", () => {
  const c = contributions(COMPS, W, 0, { electricity: 9 }).find((x) => x.code === "electricity")!;
  expect(c.yoyPct).toBe(9);
  expect(c.pp).toBeCloseTo(4.5, 6); // 0.5 * 9
});

test("a zero override is honored (not treated as missing)", () => {
  expect(weightedYoY(COMPS, W, 0, { electricity: 0 })).toBe(5.0); // 0.5*0 + 0.5*10
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd site && npm test -- reweight` (or the file path)
Expected: FAIL — `weightedYoY` takes 3 args / override ignored.

- [ ] **Step 3: Add the optional param in `site/src/lib/reweight.ts`.** Change `weightedYoY`:

```typescript
export function weightedYoY(
  components: Comp[],
  weights: Record<string, number>,
  i: number,
  overrides?: Record<string, number>
): number | null {
  let sum = 0;
  for (const c of components) {
    const o = overrides?.[c.code];
    const v = o ?? c.yoy[i];
    if (v === null || v === undefined) return null;
    sum += (weights[c.code] ?? 0) * v;
  }
  return sum;
}
```

And `contributions`:

```typescript
export function contributions(
  components: Comp[],
  weights: Record<string, number>,
  i: number,
  overrides?: Record<string, number>
): Contribution[] {
  return components
    .map((c) => {
      const y = overrides?.[c.code] ?? c.yoy[i] ?? 0;
      return {
        code: c.code,
        label: c.label,
        pp: (weights[c.code] ?? 0) * y,
        weightPct: (weights[c.code] ?? 0) * 100,
        yoyPct: y,
      };
    })
    .sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
}
```

(`??` is nullish-coalescing, so a `0` override is kept; only `null`/`undefined` fall through.)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd site && npm test`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/reweight.ts site/src/lib/reweight.test.ts
git commit -m "feat(my-inflation): reweight.ts optional per-component YoY override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: state selector on `/my-inflation`

**Files:**
- Modify: `site/src/app/my-inflation/page.tsx` (import `geo.json`, pass `states`)
- Modify: `site/src/components/MyInflationClient.tsx` (state `<select>`, build overrides, apply to headline + drivers, coverage note, retire the Phase-4 footer line)

**Interfaces:**
- Consumes: `weightedYoY`/`contributions` with `overrides` (Task 6); `geo.json` `states[]` (`{state, name, elec_res_cents:{yoy_pct}, gas_regular:{yoy_pct}}`) from `@/lib/types` `Geo`.

- [ ] **Step 1: Pass geo states into the client** in `site/src/app/my-inflation/page.tsx`. Add `import geoJson from "../../../public/data/geo.json";` and `import type { Geo } from "@/lib/types";`, then pass `states={(geoJson as Geo).states}` to `<MyInflationClient ... />`.

- [ ] **Step 2: Add the `states` prop + selector + overrides in `MyInflationClient.tsx`.** Add to the component props: `states: Geo["states"]` (import `type { Geo }`). Add state: `const [stateSel, setStateSel] = useState("US");`. Build overrides (only the latest-index snapshot localizes — the chart stays national, per spec):

```tsx
  const overrides = useMemo(() => {
    if (stateSel === "US") return undefined;
    const st = states.find((s) => s.state === stateSel);
    if (!st) return undefined;
    const o: Record<string, number> = {};
    if (st.elec_res_cents.yoy_pct != null) o.electricity = st.elec_res_cents.yoy_pct;
    if (st.gas_regular.yoy_pct != null) o.fuel = st.gas_regular.yoy_pct;
    return Object.keys(o).length ? o : undefined;
  }, [stateSel, states]);
```

Change the headline + drivers computations to pass `overrides` (leave `personalSeries` national):

```tsx
  const mine = weightedYoY(data.components, weights, lastIdx, overrides);
  ...
  const top = mine === null ? [] : contributions(data.components, weights, lastIdx, overrides).slice(0, 5);
```

Add the selector UI above the lifestyle rows (a plain `<select>` styled to match; `SegmentedControl` is too wide for 51 options):

```tsx
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>📍 Your state</span>
        <select value={stateSel} onChange={(e) => setStateSel(e.target.value)}
          style={{ background: "var(--chip-bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", fontSize: 13 }}>
          <option value="US">National (everyone)</option>
          {states.map((s) => <option key={s.state} value={s.state}>{s.name}</option>)}
        </select>
        {overrides && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {Object.keys(overrides).length} of 14 components localized ({Object.keys(overrides).join(", ")})
            {!overrides.fuel && " · gasoline pending — state history accrues ~2027"}
          </span>
        )}
      </div>
```

Update the method footer: remove "State-level localization arrives with Phase 4." and replace with a one-liner: "State localization swaps in your state's own electricity (and, once a year of history accrues, gasoline) inflation for the headline and drivers; the chart stays national."

- [ ] **Step 3: Build + typecheck**

Run: `cd site && npm run build`
Expected: PASS.

- [ ] **Step 4: Add an e2e assertion** for the selector in `site/e2e/smoke.spec.ts` — extend the existing my-inflation coverage or add a dedicated test:

```typescript
test("my-inflation state selector localizes the headline", async ({ page }) => {
  await page.goto("/my-inflation");
  await page.waitForLoadState("networkidle");
  await page.getByRole("combobox").selectOption("TX");
  await expect(page.getByText("components localized", { exact: false })).toBeVisible();
});
```

- [ ] **Step 5: Run e2e, verify pass**

Run: `cd site && npm run e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/app/my-inflation/page.tsx site/src/components/MyInflationClient.tsx site/e2e/smoke.spec.ts
git commit -m "feat(my-inflation): state selector localizes electricity now, gas when it accrues

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: full gates + adversarial review + fixes

**Files:** as needed from findings.

- [ ] **Step 1: Run every gate**

Run: `python -m pytest -q` (expect ~570) ; `cd site && npm test` (expect 34) ; `npm run e2e` (expect 27) ; `npm run build` (pass).

- [ ] **Step 2: Adversarial review.** Review the branch diff `git diff p2-geography-wave..HEAD` across dimensions (labor writer math, run_daily/qa isolation, reweight override correctness, site null-safety) and adversarially verify each finding (default REFUTED). Use the Workflow review pattern from the P2 wave, or `/code-review high`.

- [ ] **Step 3: Fix confirmed findings** (TDD each), re-run the full gate set, commit.

- [ ] **Step 4: Tick every checkbox in this plan and report.** Summarize commits, gate results, and the unpushed state (branch `labor-state-inflation`, stacked on `p2-geography-wave`).

---

## Self-review notes (author)

- **Spec coverage:** labor.json shape (T1) ✓; isolated phase + labor_ok (T2) ✓; no nowcast/accountability duplication — page imports them (T4) ✓; /labor page + jobs-day preview + nav + e2e (T4) ✓; real-wages honesty fix (T5) ✓; reweight override (T6) ✓; state selector + electricity-live/gas-pending + headline-only localization limitation + footer retire (T7) ✓; testing (all tasks) ✓; data snapshot so the site builds (T3) ✓.
- **Type consistency:** `weightedYoY`/`contributions` 4th param `overrides?: Record<string,number>` used identically in T6 and T7; `Labor` type in T4 matches the T1 schema field-for-field; `geo.json` state fields (`elec_res_cents.yoy_pct`, `gas_regular.yoy_pct`) match the P2 `Geo` type.
- **Known limitation pinned:** state localization affects the headline + drivers snapshot only (geo.json has no state YoY history); chart stays national — stated in T7 and the page copy.
- **Verify before trusting the e2e value pin (T2):** the FRED fake serves `fred_cpiaucns.json` for every series_id, so PAYEMS/UNRATE/etc. all resolve to that fixture's latest obs (2026-04-01 = 320.1). If the fixture changes, update the `level_k == 320` pin.
