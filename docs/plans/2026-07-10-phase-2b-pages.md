# Phase 2b — The Six Phase-2 Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six Phase-2 surfaces — homepage quilt + grocery-card modules and the
`/supercore`, `/my-inflation`, `/calculator`, `/real-wages` routes — plus the three small
pipeline additions they consume (grocery per-item series, 2 utility AP codes, `real_wages.json`;
published files 13 → 14).

**Architecture:** Vertical slices in the approved order (grocery → real-wages → quilt →
supercore → calculator → my-inflation), artifact-touching slices first. Pipeline changes are
additive writers/registry rows — zero engine changes. Site pages follow the two established
data patterns: server components import published JSON at build time (page.tsx precedent);
interactive client components `fetch()` from `/data/` at runtime (Treemap precedent). All
client math lives in pure `site/src/lib/` functions under vitest.

**Tech Stack:** Python 3.12 (stdlib, no new deps), pytest; Next.js 15 static export,
TypeScript, ECharts 6; NEW site devDeps: vitest (unit), @playwright/test + serve (smoke).

**Spec:** `docs/superpowers/specs/2026-07-10-phase-2b-pages-design.md`

## Global Constraints

- **TDD with verbatim evidence:** every task captures RED and GREEN test output via
  `... 2>&1 | tee /tmp/phase2b-tN-<red|green>.txt` — reviewers run forensic checks and
  independently re-run suites. Reconstructed output is a firing offense (three prior incidents).
- **No network in pytest, ever.** Connectors take `http_get`/`http_post` fakes returning
  `tests/fixtures/` data. (Dev-time access spikes and the local republish runs are not tests.)
- **The contract is the interface:** the site only formats. Browser-derived numbers
  (calculator, reweighter, raise math, spreads) compute ONLY from published JSON values.
- **run_daily ordering is load-bearing:** `sources_status` first; `jsonschema.ValidationError`
  re-raises before the generic engine-isolation `except`. New writer calls append at the END
  of the try block — never reorder existing calls. Pinned by existing tests.
- **Schema bumps that touch committed data regenerate `site/public/data/*.json` in the same
  task** (2a precedent) via a local pipeline run: `set -a; source .env; set +a; python -m
  pipeline.run_daily --store store --out site/public/data`. Commit store partitions + data
  together. Never rewrite a committed store partition — local runs append only.
- **Semantic colors are a hard rule:** sky/blue = ours, amber = official/cost, red = hot,
  emerald = better/cool, violet = alternate. One documented exception (spec §6): the
  my-inflation personal line is amber (gold) for fidelity to the original.
- **Design tokens:** use `var(--card)`, `var(--border)`, `var(--muted)`, `var(--accent-*)`;
  radius 10px; 11px uppercase letter-spaced section labels; tabular numerals. Match
  `KpiCard`/`Section` idioms — do not invent new visual language.
- **Every new surface** ends with a plain-English methodology footnote and shows as-of dates
  on every number (presentation formula, spec §7).
- **`git push` = production deploy** — only the controller pushes, with the user's explicit
  approval. Subagents never push and never edit `.superpowers/sdd/progress.md`.
- **Rebase over daily bot commits** (`data: daily publish <date>`) before any push; store
  JSONL conflicts resolve by union.
- **Access-spike facts already verified live (2026-07-10)** — use these IDs verbatim:
  BLS AP `APU000072610` (electricity $/kWh, latest 2026-05 = 0.196) and `APU000072620`
  (utility gas $/therm, latest 2026-05 = 1.677); FRED `FRBATLWGT3MMAUMHWGO` (Atlanta Fed
  Wage Growth Tracker, 3-mo MA unweighted median, %, monthly, 2017-01→2026-05, latest 3.5)
  and `CES0500000003` (Avg hourly earnings, total private, $/hr level, 2017-01→2026-06).

## File Map

**Pipeline (Tasks 1–3):**
- Modify: `pipeline/publish/grocery.py` (per-item series), `config/series.json` (+4 rows),
  `pipeline/run_daily.py` (real_wages writer call), `schemas/grocery_basket.schema.json`,
  `tests/test_grocery.py`, `tests/test_registry.py`, `tests/test_run_daily.py`,
  `tests/test_published_data.py`, `CLAUDE.md` (13 → 14 files)
- Create: `pipeline/publish/real_wages.py`, `schemas/real_wages.schema.json`,
  `tests/test_real_wages.py`

**Site (Tasks 4–9):**
- Create: `site/src/components/SparklineCard.tsx`, `site/src/components/SegmentedControl.tsx`,
  `site/src/components/QuiltHeatmap.tsx`, `site/src/components/RaiseCalculator.tsx`,
  `site/src/components/WageChart.tsx`, `site/src/components/StepChart.tsx`,
  `site/src/components/CalculatorClient.tsx`, `site/src/components/MyInflationClient.tsx`,
  `site/src/lib/heat.ts`, `site/src/lib/quiltPng.ts`, `site/src/lib/realwage.ts`,
  `site/src/lib/since.ts`, `site/src/lib/reweight.ts`,
  `site/src/app/real-wages/page.tsx`, `site/src/app/supercore/page.tsx`,
  `site/src/app/calculator/page.tsx`, `site/src/app/my-inflation/page.tsx`,
  `site/vitest.config.ts`, tests `site/src/lib/*.test.ts`
- Modify: `site/src/app/page.tsx` (2 modules), `site/src/components/PageShell.tsx` (nav),
  `site/src/components/Treemap.tsx` (import ramp from lib), `site/package.json`

**CI (Task 10):**
- Create: `site/playwright.config.ts`, `site/e2e/smoke.spec.ts`
- Modify: `.github/workflows/ci.yml` (site job), `CLAUDE.md` (commands)

---

### Task 1: grocery_basket.json carries per-item monthly series

**Files:**
- Modify: `pipeline/publish/grocery.py`, `schemas/grocery_basket.schema.json`
- Test: `tests/test_grocery.py`, `tests/test_published_data.py`

**Interfaces:**
- Consumes: `vintage.latest(conn, code) -> list[tuple[obs_date, value]]` (ascending);
  `PUBLISH_START = "2018-01-01"` from `pipeline.engine.gauge`.
- Produces: each grocery item gains
  `"series": {"months": ["2018-01-01", ...], "prices": [2.45, ...]}` — obs-date strings
  (YYYY-MM-DD, matching the item's existing `month` field format; the spec sketched
  `"2018-01"` but artifact-internal consistency wins), prices rounded 3. Task 4's
  SparklineCard reads `item.series.prices` / `item.series.months`.

- [ ] **Step 1: Write the failing test** — append to `tests/test_grocery.py`:

```python
def test_items_carry_series_from_publish_start(tmp_path):
    conn = _store_with(tmp_path, {
        "APU0000708111": {"2017-12-01": 2.40, "2018-01-01": 2.45, "2025-06-01": 2.50,
                          "2026-05-01": 3.90, "2026-06-01": 4.00}})
    payload = grocery.build(
        conn, [_series_row("APU0000708111", "Avg price: eggs, grade A, dozen")])
    s = payload["items"][0]["series"]
    # 2017-12 excluded: writers publish from 2018-01 (PUBLISH_START)
    assert s["months"] == ["2018-01-01", "2025-06-01", "2026-05-01", "2026-06-01"]
    assert s["prices"] == [2.45, 2.50, 3.90, 4.00]
    assert len(s["months"]) == len(s["prices"])
```

- [ ] **Step 2: Run to verify RED**

Run: `pytest tests/test_grocery.py::test_items_carry_series_from_publish_start -v 2>&1 | tee /tmp/phase2b-t1-red.txt`
Expected: FAIL with `KeyError: 'series'`

- [ ] **Step 3: Implement** — in `pipeline/publish/grocery.py`, add the import and extend the
  item dict:

```python
from pipeline.engine.gauge import PUBLISH_START
```

and inside `build()`, replace the `items.append({...})` call with:

```python
        rows = [(d, v) for d, v in vintage.latest(conn, s.code)
                if d >= PUBLISH_START]
        items.append({"code": s.code, "name": s.name, "month": month,
                      "price": round(price, 3),
                      "mom_pct": round(summary["mom_pct"], 2),
                      "yoy_pct": round(summary["yoy_pct"], 2),
                      "series": {"months": [d for d, _ in rows],
                                 "prices": [round(v, 3) for _, v in rows]}})
```

Update the module docstring's first line to mention the series
(`...latest computable month, plus each item's full monthly price series since 2018 —
the 2b sparkline cards render it directly.`).

- [ ] **Step 4: Run to verify GREEN**

Run: `pytest tests/test_grocery.py -v 2>&1 | tee /tmp/phase2b-t1-green.txt`
Expected: all tests PASS (existing assertions unchanged — `series` is additive)

- [ ] **Step 5: Update the schema** — in `schemas/grocery_basket.schema.json`, add `"series"`
  to the item's `required` list and add to the item's `properties`:

```json
          "series": {
            "type": "object",
            "required": ["months", "prices"],
            "additionalProperties": false,
            "properties": {
              "months": {"type": "array",
                         "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
              "prices": {"type": "array", "items": {"type": "number"}}
            }
          }
```

- [ ] **Step 6: Contract test for committed data** — append to `tests/test_published_data.py`:

```python
def test_grocery_series_aligned():
    """Sparkline arrays must align and the card price must equal the series
    value at the item's own month — a mismatch would draw a sparkline that
    contradicts the printed price."""
    grocery = json.loads((DATA / "grocery_basket.json").read_text())
    for it in grocery["items"]:
        s = it["series"]
        assert len(s["months"]) == len(s["prices"]) > 0, it["code"]
        assert s["months"] == sorted(s["months"]), it["code"]
        assert it["price"] == s["prices"][s["months"].index(it["month"])], it["code"]
```

- [ ] **Step 7: Regenerate committed data** (schema now requires `series` — same-task
  regeneration, 2a precedent):

Run: `set -a; source .env; set +a; python -m pipeline.run_daily --store store --out site/public/data 2>&1 | tail -20`
Expected: every `source <name>: ok` line, `published: .../grocery_basket.json (26 items, 0 skipped)`, `qa: ...`

Run: `pytest -q 2>&1 | tee /tmp/phase2b-t1-full.txt`
Expected: all pass (test_published_data now validates the regenerated file)

- [ ] **Step 8: Commit**

```bash
git add pipeline/publish/grocery.py schemas/grocery_basket.schema.json \
  tests/test_grocery.py tests/test_published_data.py store site/public/data
git commit -m "feat: grocery_basket items carry monthly price series (2b sparkline cards)"
```

---

### Task 2: utility AP codes join the registry (electricity, piped gas)

**Files:**
- Modify: `config/series.json`, `tests/test_registry.py`

**Interfaces:**
- Consumes: BLS connector (chunked AP fetch, keyless OK, startyear 2017).
- Produces: registry codes `APU000072610` / `APU000072620`; after the local backfill run,
  `grocery_basket.json` carries 28 items including
  `{"code": "APU000072610", "name": "Avg price: electricity, kWh", ...}` and
  `{"code": "APU000072620", "name": "Avg price: utility gas, therm", ...}` with full series.
  Task 4 features them by these exact codes.

- [ ] **Step 1: RED — bump the registry count** in `tests/test_registry.py`: change
  `assert len(series) == 61` to `assert len(series) == 63`.

Run: `pytest tests/test_registry.py -v 2>&1 | tee /tmp/phase2b-t2-red.txt`
Expected: FAIL — `assert 61 == 63`

- [ ] **Step 2: Add the registry rows** — in `config/series.json`, after the last existing
  `APU...` row (keep the AP block contiguous):

```json
    {"code": "APU000072610",   "source": "BLS",      "source_id": "APU000072610",                 "name": "Avg price: electricity, kWh",        "max_staleness_days": 80},
    {"code": "APU000072620",   "source": "BLS",      "source_id": "APU000072620",                 "name": "Avg price: utility gas, therm",      "max_staleness_days": 80},
```

- [ ] **Step 3: GREEN**

Run: `pytest tests/test_registry.py tests/test_run_daily.py -v 2>&1 | tee /tmp/phase2b-t2-green.txt`
Expected: PASS. (In e2e the two new codes have no fixture rows — they join the 20 AP codes
already absent from `bls_ap_full.json` and land in grocery `skipped`; no assertion counts them.)

- [ ] **Step 4: Backfill + republish** (BLS fetches 2017→now for new codes; keyless):

Run: `set -a; source .env; set +a; python -m pipeline.run_daily --store store --out site/public/data 2>&1 | tail -20`
Expected: `published: .../grocery_basket.json (28 items, 0 skipped)`

Run: `python3 -c "import json; g=json.load(open('site/public/data/grocery_basket.json')); e=[i for i in g['items'] if i['code']=='APU000072610'][0]; print(e['price'], len(e['series']['months']))"`
Expected: `0.196` and ~101 months (2018-01 → 2026-05)

Run: `pytest -q 2>&1 | tee /tmp/phase2b-t2-full.txt` — all pass

- [ ] **Step 5: Commit**

```bash
git add config/series.json tests/test_registry.py store site/public/data
git commit -m "feat: electricity/utility-gas AP codes in registry — faithful grocery six"
```

---

### Task 3: real_wages.json — wage registry rows, writer, schema, 14th contract file

**Files:**
- Create: `pipeline/publish/real_wages.py`, `schemas/real_wages.schema.json`,
  `tests/test_real_wages.py`
- Modify: `config/series.json`, `pipeline/run_daily.py`, `tests/test_registry.py`,
  `tests/test_run_daily.py`, `tests/test_published_data.py`, `CLAUDE.md`

**Interfaces:**
- Consumes: `vintage.latest(conn, code)`; `gauge_result["variants"]["gauge"]` with
  `{"yoy": {date: pct|None}, "as_of": date}`; `PUBLISH_START`.
- Produces: `real_wages.json`:
  `{"published_at", "kpis": {"wage_growth_pct": 3.5|null, "wage_as_of": "2026-05-01"|null,
  "real_wage_growth_pct": 1.77|null}, "series": {"months": [...],
  "atlanta_wgt_yoy_pct": [...|null], "ahe_yoy_pct": [...|null]}}`.
  Task 5's page reads exactly these keys. Writer NEVER raises on missing wage data — it
  publishes null kpis + empty arrays (a new writer must not be able to take down the block).

- [ ] **Step 1: Registry rows + count.** In `tests/test_registry.py` change `== 63` to
  `== 65` (RED: `pytest tests/test_registry.py -v 2>&1 | tee /tmp/phase2b-t3-red1.txt`,
  expect `assert 63 == 65`). Then append to the FRED block of `config/series.json`:

```json
    {"code": "FRBATLWGT3MMAUMHWGO", "source": "FRED", "source_id": "FRBATLWGT3MMAUMHWGO",     "name": "Atlanta Fed wage growth (3mo MA median)", "max_staleness_days": 80},
    {"code": "CES0500000003",   "source": "FRED",     "source_id": "CES0500000003",                "name": "Avg hourly earnings, total private ($/hr)", "max_staleness_days": 80},
```

Run: `pytest tests/test_registry.py -v` — PASS.

- [ ] **Step 2: Writer tests (RED)** — create `tests/test_real_wages.py`:

```python
import pytest

from pipeline.models import Observation
from pipeline.publish import real_wages
from pipeline.store import vintage

WGT, AHE = real_wages.WGT, real_wages.AHE


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FRED", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def _gauge(yoy=1.7, as_of="2026-07-09"):
    return {"variants": {"gauge": {"yoy": {as_of: yoy}, "as_of": as_of}}}


def test_build_kpis_and_series(tmp_path):
    conn = _store_with(tmp_path, {
        WGT: {"2025-05-01": 4.0, "2026-04-01": 3.4, "2026-05-01": 3.5},
        AHE: {"2025-05-01": 30.00, "2025-06-01": 31.00, "2026-05-01": 31.50,
              "2026-06-01": 32.55}})
    p = real_wages.build(conn, _gauge(yoy=1.7))
    assert p["kpis"]["wage_growth_pct"] == 3.5
    assert p["kpis"]["wage_as_of"] == "2026-05-01"
    # hand-computed: (1.035 / 1.017 - 1) * 100 = 1.7699... -> 1.77
    assert p["kpis"]["real_wage_growth_pct"] == 1.77
    s = p["series"]
    assert s["months"] == ["2025-05-01", "2025-06-01", "2026-04-01",
                           "2026-05-01", "2026-06-01"]
    # WGT passes through; None where WGT has no obs that month
    assert s["atlanta_wgt_yoy_pct"] == [4.0, None, 3.4, 3.5, None]
    # AHE YoY hand-computed: 31.50/30.00 = +5.0, 32.55/31.00 = +5.0;
    # None where the 12-mo base is missing
    assert s["ahe_yoy_pct"] == [None, None, None, 5.0, 5.0]


def test_publish_start_filter(tmp_path):
    conn = _store_with(tmp_path, {WGT: {"2017-06-01": 3.0, "2018-02-01": 3.1}})
    p = real_wages.build(conn, _gauge())
    assert p["series"]["months"] == ["2018-02-01"]


def test_empty_store_publishes_nulls_never_raises(tmp_path):
    conn = _store_with(tmp_path, {})
    p = real_wages.build(conn, _gauge())
    assert p["kpis"] == {"wage_growth_pct": None, "wage_as_of": None,
                         "real_wage_growth_pct": None}
    assert p["series"] == {"months": [], "atlanta_wgt_yoy_pct": [],
                           "ahe_yoy_pct": []}
```

Run: `pytest tests/test_real_wages.py -v 2>&1 | tee /tmp/phase2b-t3-red2.txt`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` (module doesn't exist)

- [ ] **Step 3: Implement** — create `pipeline/publish/real_wages.py`:

```python
"""Writer for real_wages.json — wage growth vs the gauge (2b real-wages page).

Wage series pass store -> writer directly (the official.py pattern): they are
not basket components and never touch the engine. The gauge/official numbers
the page also shows come from pulse.json/compare.json — one published source
per number, nothing duplicated here. Missing wage data publishes null kpis and
empty series (a new writer must never be able to take down the publish block).
"""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.store import vintage

WGT = "FRBATLWGT3MMAUMHWGO"  # already a 12-mo growth rate (%), 3mo MA median
AHE = "CES0500000003"        # $/hr level — YoY computed here


def build(conn, gauge_result) -> dict:
    wgt = dict(vintage.latest(conn, WGT))
    ahe = dict(vintage.latest(conn, AHE))
    ahe_yoy = {}
    for m, v in ahe.items():
        base = f"{int(m[:4]) - 1:04d}-{m[5:7]}-01"
        if base in ahe:
            ahe_yoy[m] = (v / ahe[base] - 1) * 100
    months = sorted(m for m in set(wgt) | set(ahe_yoy) if m >= PUBLISH_START)
    wage_months = [m for m in months if m in wgt]
    latest = wage_months[-1] if wage_months else None
    g = gauge_result["variants"]["gauge"]
    gauge_yoy = g["yoy"].get(g["as_of"])
    real = None
    if latest is not None and gauge_yoy is not None:
        real = ((1 + wgt[latest] / 100) / (1 + gauge_yoy / 100) - 1) * 100
    return {"kpis": {
                "wage_growth_pct": None if latest is None else round(wgt[latest], 2),
                "wage_as_of": latest,
                "real_wage_growth_pct": None if real is None else round(real, 2)},
            "series": {
                "months": months,
                "atlanta_wgt_yoy_pct": [None if m not in wgt else round(wgt[m], 2)
                                        for m in months],
                "ahe_yoy_pct": [None if m not in ahe_yoy else round(ahe_yoy[m], 2)
                                for m in months]}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "real_wages.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

Run: `pytest tests/test_real_wages.py -v 2>&1 | tee /tmp/phase2b-t3-green.txt` — PASS.

- [ ] **Step 4: Schema** — create `schemas/real_wages.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "real_wages",
  "type": "object",
  "required": ["published_at", "kpis", "series"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "kpis": {
      "type": "object",
      "required": ["wage_growth_pct", "wage_as_of", "real_wage_growth_pct"],
      "additionalProperties": false,
      "properties": {
        "wage_growth_pct": {"type": ["number", "null"]},
        "wage_as_of": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
        "real_wage_growth_pct": {"type": ["number", "null"]}
      }
    },
    "series": {
      "type": "object",
      "required": ["months", "atlanta_wgt_yoy_pct", "ahe_yoy_pct"],
      "additionalProperties": false,
      "properties": {
        "months": {"type": "array",
                   "items": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}},
        "atlanta_wgt_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
        "ahe_yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}}
      }
    }
  }
}
```

- [ ] **Step 5: Wire into run_daily** — in `pipeline/run_daily.py`, add `real_wages` to the
  `from pipeline.publish import (...)` tuple, and append AT THE END of the try block (after
  the `official_path` block, before `gauge_qa = ...`):

```python
        rw_path = real_wages.write(real_wages.build(conn, gauge_result),
                                   args.out, published_at=published_at)
        validate.validate_file(rw_path, SCHEMAS / "real_wages.schema.json")
        print(f"published: {rw_path}")
```

- [ ] **Step 6: Contract tests.** In `tests/test_run_daily.py` add `"real_wages.json"` to the
  files-exist tuple in `test_end_to_end_all_sources`. In `tests/test_published_data.py` append
  `("real_wages.json", "real_wages.schema.json")` to `CONTRACT`.

Run: `pytest tests/test_run_daily.py tests/test_published_data.py -v 2>&1 | tee /tmp/phase2b-t3-contract.txt`
Expected: test_run_daily PASSES (lax FRED fake feeds the wage ids CPI fixture data — values
are nonsense but structurally valid); test_published_data `real_wages` param FAILS
(file not yet committed) — fixed by Step 7.

- [ ] **Step 7: Backfill + republish** (FRED fetches both wage series 2017→now):

Run: `set -a; source .env; set +a; python -m pipeline.run_daily --store store --out site/public/data 2>&1 | tail -20`
Expected: `published: .../real_wages.json` line appears after official.json.

Run: `python3 -c "import json; r=json.load(open('site/public/data/real_wages.json')); print(r['kpis'], len(r['series']['months']))"`
Expected: `wage_growth_pct` 3.5, `wage_as_of` 2026-05-01, `real_wage_growth_pct` ≈ 0.4–0.5
(3.5% wage vs gauge ~3.05%), ~102 months.

Run: `pytest -q 2>&1 | tee /tmp/phase2b-t3-full.txt` — all pass.

- [ ] **Step 8: CLAUDE.md ripple** — in the Publish section change "13 published files" to
  "14 published files" and add `real_wages` to the file list (after `official`).

- [ ] **Step 9: Commit**

```bash
git add pipeline/publish/real_wages.py schemas/real_wages.schema.json \
  tests/test_real_wages.py config/series.json pipeline/run_daily.py \
  tests/test_registry.py tests/test_run_daily.py tests/test_published_data.py \
  CLAUDE.md store site/public/data
git commit -m "feat: real_wages.json — Atlanta Fed WGT + AHE via FRED, 14th contract file"
```

---

### Task 4: homepage grocery module — SparklineCard + featured six

**Files:**
- Create: `site/src/components/SparklineCard.tsx`
- Modify: `site/src/app/page.tsx`

**Interfaces:**
- Consumes: `grocery_basket.json` items with `series.months`/`series.prices` (Task 1/2).
- Produces: `SparklineCard({label, price, yoyPct, asOf, prices})` — reusable card with
  inline-SVG sparkline (no hooks, server-renderable).

- [ ] **Step 1: SparklineCard** — create `site/src/components/SparklineCard.tsx`:

```tsx
import { DeltaChip } from "./DeltaChip";

/** Grocery/price card: name, big price, blue sparkline, YoY chip, as-of.
 *  Pure SVG — no hooks, renders statically at build time. */
export function SparklineCard({
  label,
  price,
  yoyPct,
  asOf,
  prices,
}: {
  label: string;
  price: string;
  yoyPct: number;
  asOf: string;
  prices: number[];
}) {
  const w = 170;
  const h = 36;
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const pts = prices
    .map(
      (p, i) =>
        `${((i / Math.max(prices.length - 1, 1)) * w).toFixed(1)},` +
        `${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`
    )
    .join(" ");
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        minWidth: 190,
        flex: "1 1 190px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <DeltaChip value={yoyPct} />
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          margin: "2px 0 4px",
        }}
      >
        {price}
      </div>
      <svg width={w} height={h} style={{ display: "block", maxWidth: "100%" }}>
        <polyline
          points={pts}
          fill="none"
          stroke="var(--accent-sky)"
          strokeWidth={1.5}
        />
      </svg>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{asOf}</div>
    </div>
  );
}
```

- [ ] **Step 2: Homepage module** — in `site/src/app/page.tsx`, add imports:

```tsx
import grocery from "../../public/data/grocery_basket.json";
import { SparklineCard } from "@/components/SparklineCard";
```

add the featured constant next to `GROUP_TITLES`:

```tsx
// faithful six (original homepage row); the other items stay published-but-
// unfeatured until the Phase 5 cart page
const FEATURED_GROCERY: [string, string][] = [
  ["APU0000708111", "Eggs (dozen)"],
  ["APU0000709112", "Milk (gallon)"],
  ["APU0000703112", "Ground beef (lb)"],
  ["APU0000702111", "Bread (lb)"],
  ["APU000072610", "Electricity (kWh)"],
  ["APU000072620", "Utility gas (therm)"],
];
```

and insert this Section immediately BEFORE `<Section title="Sources">`:

```tsx
      <Section title="Grocery basket — BLS average prices">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {FEATURED_GROCERY.map(([code, label]) => {
            const item = grocery.items.find((i) => i.code === code);
            if (!item) return null; // graceful before a code's first collect
            return (
              <SparklineCard
                key={code}
                label={label}
                price={`$${item.price.toFixed(2)}`}
                yoyPct={item.yoy_pct}
                asOf={fmtMonth(item.month)}
                prices={item.series.prices}
              />
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          BLS average prices (AP series), monthly, national city average — as of{" "}
          {grocery.as_of ? fmtMonth(grocery.as_of) : "—"}. Sparkline = full monthly
          history since 2018.
        </div>
      </Section>
```

- [ ] **Step 3: Verify build**

Run: `cd site && npm run build 2>&1 | tail -5 && npm run lint`
Expected: build succeeds, no lint errors. Confirm price renders as `$0.20` for electricity:
`grep -o "Electricity (kWh)" out/index.html | head -1` → match found.

- [ ] **Step 4: Commit**

```bash
git add site/src/components/SparklineCard.tsx site/src/app/page.tsx
git commit -m "feat(site): homepage grocery module — faithful six sparkline cards"
```

---

### Task 5: /real-wages page + vitest infra + raise math

**Files:**
- Create: `site/vitest.config.ts`, `site/src/lib/realwage.ts`, `site/src/lib/realwage.test.ts`,
  `site/src/components/RaiseCalculator.tsx`, `site/src/components/WageChart.tsx`,
  `site/src/app/real-wages/page.tsx`
- Modify: `site/package.json`, `site/src/components/PageShell.tsx`

**Interfaces:**
- Consumes: `real_wages.json` (Task 3 shape), `pulse.json` (`gauge.yoy_pct`,
  `official.yoy_pct`), `compare.json` (`months`, `gauge_yoy_pct`).
- Produces: `realRaisePct(raisePct: number, inflationPct: number): number`;
  vitest infra (`npm test`) that Tasks 8/9 extend.

- [ ] **Step 1: vitest infra.** In `site/`: `npm install -D vitest` (accept the resolved ^3
  version). Add to `site/package.json` scripts: `"test": "vitest run"`. Create
  `site/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] **Step 2: RED** — create `site/src/lib/realwage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { realRaisePct } from "./realwage";

describe("realRaisePct", () => {
  // original-site fixture: 4.0% raise vs 1.70% gauge -> +2.26% real
  it("matches the original's published example", () => {
    expect(realRaisePct(4.0, 1.7)).toBeCloseTo(2.26, 2);
  });
  // wage 3.5 vs gauge 1.7 -> +1.77 (the pipeline KPI's own formula)
  it("agrees with the pipeline real_wage_growth_pct formula", () => {
    expect(realRaisePct(3.5, 1.7)).toBeCloseTo(1.77, 2);
  });
  it("goes negative when inflation outruns the raise", () => {
    expect(realRaisePct(4.0, 4.25)).toBeCloseTo(-0.24, 2);
  });
  it("is 0 when raise equals inflation", () => {
    expect(realRaisePct(3.0, 3.0)).toBe(0);
  });
});
```

Run: `cd site && npm test 2>&1 | tee /tmp/phase2b-t5-red.txt`
Expected: FAIL — cannot resolve `./realwage`

- [ ] **Step 3: Implement** — create `site/src/lib/realwage.ts`:

```ts
/** real = (1 + raise) / (1 + inflation) − 1, in percent terms.
 *  The exact formula printed on the page and used by the pipeline KPI. */
export function realRaisePct(raisePct: number, inflationPct: number): number {
  return ((1 + raisePct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
```

Run: `npm test 2>&1 | tee /tmp/phase2b-t5-green.txt` — PASS.

- [ ] **Step 4: RaiseCalculator** — create `site/src/components/RaiseCalculator.tsx`:

```tsx
"use client";
import { useState } from "react";
import { realRaisePct } from "@/lib/realwage";
import { fmtPp } from "@/lib/format";

function ResultChip({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 0 ? "var(--accent-emerald)" : "var(--accent-red)";
  return (
    <div
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 16px",
        minWidth: 210,
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
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
        {pct >= 0 ? "+" : "−"}
        {Math.abs(pct).toFixed(2)}% real
      </div>
    </div>
  );
}

export function RaiseCalculator({
  gaugeYoy,
  officialYoy,
}: {
  gaugeYoy: number;
  officialYoy: number;
}) {
  const [raise, setRaise] = useState(4.0);
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent-emerald)",
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        Your raise, in real terms
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          My raise this year:{" "}
          <input
            type="number"
            step={0.1}
            value={raise}
            onChange={(e) => setRaise(Number(e.target.value))}
            style={{
              width: 70,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              fontVariantNumeric: "tabular-nums",
            }}
          />{" "}
          %
        </label>
        <ResultChip
          label="vs today's prices (macrogauge)"
          pct={realRaisePct(raise, gaugeYoy)}
        />
        <ResultChip label="vs official CPI" pct={realRaisePct(raise, officialYoy)} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Real change = (1 + raise) ÷ (1 + inflation) − 1 · gauge{" "}
        {fmtPp(gaugeYoy - officialYoy)} vs official
      </div>
    </div>
  );
}
```

- [ ] **Step 5: WageChart** — create `site/src/components/WageChart.tsx`:

```tsx
"use client";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

/** Wages vs inflation — WGT (emerald), AHE (violet), gauge (amber, area). */
export function WageChart({
  months,
  wgt,
  ahe,
  gaugeMonths,
  gaugeYoy,
}: {
  months: string[];
  wgt: (number | null)[];
  ahe: (number | null)[];
  gaugeMonths: string[];
  gaugeYoy: (number | null)[];
}) {
  const pair = (ms: string[], vs: (number | null)[]) =>
    ms.map((m, i) => [m, vs[i]] as [string, number | null]);
  const option = {
    ...baseOption(),
    series: [
      {
        name: "Atlanta Fed wage growth",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.emerald, data: pair(months, wgt),
      },
      {
        name: "Avg hourly earnings YoY",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.violet, data: pair(months, ahe),
      },
      {
        name: "Macrogauge YoY",
        type: "line", showSymbol: false, lineStyle: { width: 1.5 },
        color: C.amber, areaStyle: { opacity: 0.12 },
        data: pair(gaugeMonths, gaugeYoy),
      },
    ],
  };
  return <EChart option={option} height={340} />;
}
```

- [ ] **Step 6: The page** — create `site/src/app/real-wages/page.tsx`:

```tsx
import type { Metadata } from "next";
import realWages from "../../../public/data/real_wages.json";
import pulse from "../../../public/data/pulse.json";
import compare from "../../../public/data/compare.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { RaiseCalculator } from "@/components/RaiseCalculator";
import { WageChart } from "@/components/WageChart";
import { fmtMonth, fmtPct } from "@/lib/format";

export const metadata: Metadata = { title: "Real Wage Tracker — macrogauge" };

export default function RealWages() {
  const k = realWages.kpis;
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Real Wage Tracker{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          wage growth vs the daily inflation gauge — and a calculator for your own raise
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Wage growth (Atlanta Fed)"
          value={k.wage_growth_pct === null ? "—" : fmtPct(k.wage_growth_pct)}
          context={`median, 3mo MA · as of ${k.wage_as_of ? fmtMonth(k.wage_as_of) : "—"}`}
          accent="emerald"
        />
        <KpiCard
          label="Inflation right now"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`macrogauge, daily · as of ${pulse.gauge.as_of}`}
          accent="amber"
        />
        <KpiCard
          label="Real wage growth"
          value={k.real_wage_growth_pct === null ? "—" : fmtPct(k.real_wage_growth_pct)}
          context="typical wage growth minus today's inflation"
          accent={
            k.real_wage_growth_pct !== null && k.real_wage_growth_pct < 0
              ? "red"
              : "emerald"
          }
        />
      </div>

      <Section title="Your raise, in real terms">
        <RaiseCalculator
          gaugeYoy={pulse.gauge.yoy_pct}
          officialYoy={pulse.official.yoy_pct}
        />
      </Section>

      <Section title="Wages vs inflation — when green is above amber, paychecks are winning">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <WageChart
            months={realWages.series.months}
            wgt={realWages.series.atlanta_wgt_yoy_pct}
            ahe={realWages.series.ahe_yoy_pct}
            gaugeMonths={compare.months}
            gaugeYoy={compare.gauge_yoy_pct}
          />
        </div>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Sources: Atlanta Fed Wage Growth Tracker (unweighted median, 3-month moving
          average, same-person wages; FRED FRBATLWGT3MMAUMHWGO), BLS Average Hourly
          Earnings, total private (YoY computed in the pipeline; FRED CES0500000003),
          and the macrogauge daily gauge. Real change = (1 + raise) ÷ (1 + inflation) − 1.
          The original site&apos;s second wage line (Indeed posted wages) is not publicly
          feedable — AHE stands in until Phase 4&apos;s labor.json.
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 7: Nav link** — in `site/src/components/PageShell.tsx`, inside the `<nav>`,
  after the Home link add:

```tsx
            <Link href="/real-wages" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Real Wages
            </Link>
```

(Nav order once all tasks land: Home · Supercore · My Inflation · Calculator · Real Wages ·
Methodology — each page task inserts its own link in this order.)

- [ ] **Step 8: Verify** — `npm test && npm run build && npm run lint` all green.
  Confirm baked numbers: `grep -o "Real Wage Tracker" out/real-wages.html | head -1` matches.

- [ ] **Step 9: Commit**

```bash
git add site/vitest.config.ts site/package.json site/package-lock.json \
  site/src/lib/realwage.ts site/src/lib/realwage.test.ts \
  site/src/components/RaiseCalculator.tsx site/src/components/WageChart.tsx \
  site/src/app/real-wages/page.tsx site/src/components/PageShell.tsx
git commit -m "feat(site): /real-wages — WGT/AHE vs gauge, raise calculator; vitest infra"
```

---

### Task 6: homepage quilt module — heat lib, SegmentedControl, QuiltHeatmap, PNG export

**Files:**
- Create: `site/src/lib/heat.ts`, `site/src/lib/quiltPng.ts`,
  `site/src/components/SegmentedControl.tsx`, `site/src/components/QuiltHeatmap.tsx`
- Modify: `site/src/components/Treemap.tsx`, `site/src/app/page.tsx`

**Interfaces:**
- Consumes: `quilt_months_{24,48,all}.json` (`months: ["2024-08", ...]`,
  `components[].{label, ours_yoy_pct, official_yoy_pct}`), `compare.json` headline arrays.
- Produces: `heatColor(v: number | null, domain?: [number, number]): string` — THE shared
  cell-color function (Treemap, quilt DOM grid, and PNG canvas all call it; export cannot
  drift from display). `SegmentedControl<K>({options, value, onChange})` reused by Task 9.

- [ ] **Step 1: Extract the heat ramp** — create `site/src/lib/heat.ts` by MOVING
  `STOPS`/`ramp` verbatim out of `Treemap.tsx` and adding `heatColor`:

```ts
// blue → slate → amber → red, nowflation's -2%→6% ramp normalized to t∈[0,1].
// Single source of truth: Treemap tiles, QuiltHeatmap cells and the PNG
// exporter all color through here.
export const STOPS: [number, [number, number, number]][] = [
  [0.0, [37, 99, 235]],   // blue
  [0.25, [71, 85, 105]],  // slate ≈ 0
  [0.62, [217, 119, 6]],  // amber
  [1.0, [220, 38, 38]],   // red
];

export function ramp(t: number): string {
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

export const EMPTY_CELL = "#2a3542";

export function heatColor(v: number | null, domain: [number, number] = [-2, 6]): string {
  return v === null ? EMPTY_CELL : ramp((v - domain[0]) / (domain[1] - domain[0]));
}
```

In `Treemap.tsx`: delete the local `STOPS`/`ramp`, add `import { ramp } from "@/lib/heat";`.
Run: `npm run build` — green (pure move, no behavior change).

- [ ] **Step 2: SegmentedControl** — create `site/src/components/SegmentedControl.tsx`:

```tsx
"use client";

/** Chip-style segmented control (Treemap-chip idiom, generalized). */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "var(--border)"}`,
              background: active ? "rgba(56,189,248,0.12)" : "var(--chip-bg)",
              color: active ? "var(--accent-sky)" : "var(--muted)",
              borderRadius: 999,
              padding: "2px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: PNG exporter** — create `site/src/lib/quiltPng.ts`:

```ts
import { heatColor } from "./heat";

export type QuiltRow = { label: string; values: (number | null)[] };

/** Render the quilt to a fixed 1920×1080 canvas and trigger a download.
 *  Colors via heatColor — the same function the DOM grid uses, so the
 *  export cannot drift from the display. */
export function exportQuiltPng(
  months: string[],
  componentRows: QuiltRow[],
  headlineRows: QuiltRow[],
  asOf: string
): void {
  const W = 1920;
  const H = 1080;
  const left = 230;
  const top = 90;
  const bottom = 60;
  const gap = 14; // visual gap between component grid and headline rows
  const nRows = componentRows.length + headlineRows.length;
  const cellW = (W - left - 20) / months.length;
  const cellH = (H - top - bottom - gap) / nRows;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0B0F14";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#E6EDF3";
  ctx.font = "bold 28px ui-sans-serif, system-ui";
  ctx.fillText("MACROGAUGE — INFLATION QUILT", 24, 44);
  ctx.fillStyle = "#8B98A5";
  ctx.font = "16px ui-sans-serif, system-ui";
  ctx.fillText(`component YoY %, every month · as of ${asOf}`, 24, 70);

  const drawRow = (row: QuiltRow, y: number) => {
    ctx.fillStyle = "#8B98A5";
    ctx.font = "13px ui-sans-serif, system-ui";
    ctx.textAlign = "right";
    ctx.fillText(row.label, left - 8, y + cellH / 2 + 4);
    ctx.textAlign = "center";
    row.values.forEach((v, i) => {
      const x = left + i * cellW;
      ctx.fillStyle = heatColor(v);
      ctx.fillRect(x, y, cellW - 1, cellH - 1);
      if (v !== null && cellW >= 30) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "11px ui-sans-serif, system-ui";
        ctx.fillText(v.toFixed(1), x + cellW / 2, y + cellH / 2 + 4);
      }
    });
    ctx.textAlign = "left";
  };

  componentRows.forEach((r, ri) => drawRow(r, top + ri * cellH));
  const hTop = top + componentRows.length * cellH + gap;
  headlineRows.forEach((r, ri) => drawRow(r, hTop + ri * cellH));

  // month labels: at most ~24, evenly thinned
  const step = Math.max(1, Math.ceil(months.length / 24));
  ctx.fillStyle = "#8B98A5";
  ctx.font = "12px ui-sans-serif, system-ui";
  months.forEach((m, i) => {
    if (i % step !== 0) return;
    ctx.save();
    ctx.translate(left + i * cellW + cellW / 2, H - bottom + 34);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(m, 0, 0);
    ctx.restore();
  });

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `macrogauge-quilt-${asOf}.png`;
  a.click();
}
```

- [ ] **Step 4: QuiltHeatmap** — create `site/src/components/QuiltHeatmap.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { heatColor } from "@/lib/heat";
import { exportQuiltPng, type QuiltRow } from "@/lib/quiltPng";

type Quilt = {
  published_at: string;
  months: string[]; // "YYYY-MM"
  components: {
    code: string;
    label: string;
    weight: number;
    ours_yoy_pct: (number | null)[];
    official_yoy_pct: (number | null)[];
  }[];
};
type Compare = {
  months: string[]; // "YYYY-MM-01"
  official_yoy_pct: (number | null)[];
  official_core_yoy_pct: (number | null)[];
  gauge_yoy_pct: (number | null)[];
  col_yoy_pct: (number | null)[];
  tracker_yoy_pct: (number | null)[];
};

const WINDOWS = [
  { key: "24", label: "24M" },
  { key: "48", label: "48M" },
  { key: "all", label: "FULL HISTORY" },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

const HEADLINES: [string, keyof Compare][] = [
  ["OURS: CPI-Comparable", "gauge_yoy_pct"],
  ["OURS: Cost of Living", "col_yoy_pct"],
  ["OURS: CPI-Tracker", "tracker_yoy_pct"],
  ["BLS: CPI YoY", "official_yoy_pct"],
  ["BLS: Core CPI YoY", "official_core_yoy_pct"],
];

/** BLS trailing months where the print lags stay null — rendered empty,
 *  never forward-filled. */
function headlineRows(months: string[], compare: Compare): QuiltRow[] {
  return HEADLINES.map(([label, key]) => ({
    label,
    values: months.map((m) => {
      const i = compare.months.findIndex((cm) => cm.slice(0, 7) === m);
      return i === -1 ? null : (compare[key][i] as number | null);
    }),
  }));
}

function Cell({ v }: { v: number | null }) {
  return (
    <td
      style={{
        background: heatColor(v),
        minWidth: 42,
        height: 26,
        textAlign: "center",
        fontSize: 10.5,
        fontVariantNumeric: "tabular-nums",
        color: "rgba(255,255,255,0.92)",
        border: "1px solid var(--bg)",
      }}
    >
      {v === null ? "" : v.toFixed(2)}
    </td>
  );
}

export function QuiltHeatmap() {
  const [win, setWin] = useState<WindowKey>("24");
  const [cache, setCache] = useState<Partial<Record<WindowKey, Quilt>>>({});
  const [compare, setCompare] = useState<Compare | null>(null);

  useEffect(() => {
    fetch("/data/compare.json")
      .then((r) => r.json())
      .then(setCompare)
      .catch(() => setCompare(null));
  }, []);

  useEffect(() => {
    if (cache[win]) return;
    fetch(`/data/quilt_months_${win}.json`)
      .then((r) => r.json())
      .then((q: Quilt) => setCache((c) => ({ ...c, [win]: q })))
      .catch(() => {});
  }, [win, cache]);

  const quilt = cache[win];
  if (!quilt || !compare) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading inflation quilt…
      </div>
    );
  }

  // rows ordered by basket weight, heaviest first (shelter rows on top)
  const comps = [...quilt.components].sort((a, b) => b.weight - a.weight);
  const compRows: QuiltRow[] = comps.map((c) => ({
    label: c.label,
    values: c.ours_yoy_pct,
  }));
  const hRows = headlineRows(quilt.months, compare);
  const asOf = quilt.months[quilt.months.length - 1];

  const labelTd: React.CSSProperties = {
    position: "sticky",
    left: 0,
    background: "var(--card)",
    textAlign: "right",
    fontSize: 12,
    color: "var(--muted)",
    padding: "0 8px",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <SegmentedControl options={WINDOWS} value={win} onChange={setWin} />
        <button
          onClick={() => exportQuiltPng(quilt.months, compRows, hRows, asOf)}
          style={{
            border: "1px solid var(--border)",
            background: "var(--chip-bg)",
            color: "var(--muted)",
            borderRadius: 999,
            padding: "2px 12px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ⬇ Export 1920×1080 PNG
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {compRows.map((r) => (
              <tr key={r.label}>
                <td style={labelTd}>{r.label}</td>
                {r.values.map((v, i) => (
                  <Cell key={quilt.months[i]} v={v} />
                ))}
              </tr>
            ))}
            <tr style={{ height: 10 }}>
              <td colSpan={quilt.months.length + 1} />
            </tr>
            {hRows.map((r) => (
              <tr key={r.label}>
                <td style={{ ...labelTd, fontWeight: 600 }}>{r.label}</td>
                {r.values.map((v, i) => (
                  <Cell key={quilt.months[i]} v={v} />
                ))}
              </tr>
            ))}
            <tr>
              <td style={labelTd} />
              {quilt.months.map((m, i) => (
                <td
                  key={m}
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    textAlign: "center",
                    padding: "4px 0",
                  }}
                >
                  {i % Math.max(1, Math.ceil(quilt.months.length / 26)) === 0
                    ? m
                    : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        Cell = our component YoY that month (own-observation, like-month honest) ·
        headline rows from compare.json · empty BLS cells = print not yet released ·
        colors: −2% blue → +6% red, same scale as the treemap.
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Homepage insertion** — in `site/src/app/page.tsx`, add
  `import { QuiltHeatmap } from "@/components/QuiltHeatmap";` and insert AFTER the
  gap-table `</Section>` (before the Official-CPI-components Section):

```tsx
      <Section title="Inflation quilt — every component, every month">
        <QuiltHeatmap />
      </Section>
```

- [ ] **Step 6: Verify** — `npm run build && npm run lint && npm test` green.
  Manual check: `npm run dev`, open `/`, toggle 24M/48M/FULL, click export — a
  1920×1080 PNG downloads whose cells match the on-screen grid (spot-check one hot and
  one negative cell).

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/heat.ts site/src/lib/quiltPng.ts \
  site/src/components/SegmentedControl.tsx site/src/components/QuiltHeatmap.tsx \
  site/src/components/Treemap.tsx site/src/app/page.tsx
git commit -m "feat(site): homepage inflation quilt — shared heat ramp, PNG export"
```

---

### Task 7: /supercore page

**Files:**
- Create: `site/src/app/supercore/page.tsx`, `site/src/components/StepChart.tsx`
- Modify: `site/src/components/PageShell.tsx` (nav: Supercore link FIRST after Home)

**Interfaces:**
- Consumes: `gauge_daily.json` `variants.supercore.{dates, yoy_pct}`; `pulse.json`.
- Produces: standalone page; no new lib functions.

- [ ] **Step 1: StepChart** — create `site/src/components/StepChart.tsx`:

```tsx
"use client";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

/** Daily step line (amber, light area) with a dashed 2% reference. */
export function StepChart({
  dates,
  values,
  refLine,
  refLabel,
}: {
  dates: string[];
  values: (number | null)[];
  refLine: number;
  refLabel: string;
}) {
  const option = {
    ...baseOption(),
    legend: { show: false },
    series: [
      {
        name: "Supercore YoY",
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { width: 1.5 },
        color: C.amber,
        areaStyle: { opacity: 0.12 },
        data: dates.map((d, i) => [d, values[i]] as [string, number | null]),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: C.muted },
          label: { color: C.muted, formatter: refLabel, position: "insideEndTop" },
          data: [{ yAxis: refLine }],
        },
      },
    ],
  };
  return <EChart option={option} height={340} />;
}
```

- [ ] **Step 2: The page** — create `site/src/app/supercore/page.tsx`:

```tsx
import type { Metadata } from "next";
import gaugeDaily from "../../../public/data/gauge_daily.json";
import pulse from "../../../public/data/pulse.json";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StepChart } from "@/components/StepChart";
import { fmtPct, fmtPp } from "@/lib/format";

export const metadata: Metadata = { title: "Supercore Services — macrogauge" };

export default function Supercore() {
  const sc = gaugeDaily.variants.supercore;
  // latest non-null supercore YoY and its own date — never the raw grid end
  let last = sc.yoy_pct.length - 1;
  while (last >= 0 && sc.yoy_pct[last] === null) last--;
  const scYoy = sc.yoy_pct[last] as number;
  const scAsOf = sc.dates[last];
  const spread = scYoy - pulse.gauge.yoy_pct;

  // chart from 2019: the original's window; earlier months render tightly anyway
  const from = sc.dates.findIndex((d) => d >= "2019-01-01");
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        Supercore Services{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          the Fed&apos;s favorite cut — services inflation ex-shelter, tracked daily
        </span>
      </h1>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Supercore YoY (today)"
          value={fmtPct(scYoy)}
          context={`as of ${scAsOf}`}
          accent="amber"
        />
        <KpiCard
          label="Headline macrogauge"
          value={fmtPct(pulse.gauge.yoy_pct)}
          context={`the full-basket gauge · as of ${pulse.gauge.as_of}`}
          accent="sky"
        />
        <KpiCard
          label="Spread"
          value={fmtPp(spread)}
          context="supercore minus headline — sticky-services pressure"
          accent={spread > 0 ? "red" : "emerald"}
        />
      </div>

      <Section title="Supercore YoY — daily, since 2019">
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 8px 4px",
          }}
        >
          <StepChart
            dates={sc.dates.slice(from)}
            values={sc.yoy_pct.slice(from)}
            refLine={2}
            refLabel="Fed 2% (core PCE target)"
          />
        </div>
      </Section>

      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Weighted average of our service components — medical care, education &amp;
          communication, recreation, and other goods &amp; services — with weights
          renormalized; excludes shelter, goods, food-at-home, energy and vehicles
          (config: supercore_components in basket.json). Why it matters: goods prices
          swing with supply chains and energy with OPEC — supercore is the wage-driven
          core the Fed watches to judge whether inflation is entrenched. Grades against
          core CPI; see <a href="/methodology" style={{ color: "var(--accent-sky)" }}>
          methodology</a> for validation stats.
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Nav** — in `PageShell.tsx` add the Supercore link between Home and
  Real Wages (target order: Home · Supercore · My Inflation · Calculator · Real Wages ·
  Methodology).

- [ ] **Step 4: Verify** — `npm run build && npm run lint && npm test`. Reconciliation
  spot-check: print the source value with
  `python3 -c "import json; sc=json.load(open('site/public/data/gauge_daily.json'))['variants']['supercore']; ys=[y for y in sc['yoy_pct'] if y is not None]; print(ys[-1])"`,
  then open `/supercore` in `npm run dev` and confirm the Supercore KPI shows exactly
  that value (1dp-formatted). The Playwright smoke (Task 10) pins rendering thereafter.

- [ ] **Step 5: Commit**

```bash
git add site/src/app/supercore/page.tsx site/src/components/StepChart.tsx \
  site/src/components/PageShell.tsx
git commit -m "feat(site): /supercore — 3 KPIs, daily step chart, explainer"
```

---

### Task 8: /calculator page + since-date math

**Files:**
- Create: `site/src/lib/since.ts`, `site/src/lib/since.test.ts`,
  `site/src/components/CalculatorClient.tsx`, `site/src/app/calculator/page.tsx`
- Modify: `site/src/components/PageShell.tsx` (nav: Calculator link)

**Interfaces:**
- Consumes: `gauge_daily.json` `variants.gauge.{dates, index}` via runtime fetch
  (Treemap pattern — keeps the 5-variant file out of the JS bundle).
- Produces: `sinceStats(dates, index, since, amount) -> SinceStats | null`.

- [ ] **Step 1: RED** — create `site/src/lib/since.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sinceStats } from "./since";

// fixture straight from the original site's screenshot: $100 since 2020-01-01,
// index 100 -> 127.79 over 2378 days (2020-01-01 -> 2026-07-06)
const DATES = ["2020-01-01", "2026-07-06"];
const INDEX = [100, 127.79];

describe("sinceStats", () => {
  it("reproduces the original's published example", () => {
    const s = sinceStats(DATES, INDEX, "2020-01-01", 100)!;
    expect(s.days).toBe(2378);
    expect(s.pctSince).toBeCloseTo(27.79, 2);
    expect(s.thenNow).toBeCloseTo(127.79, 2);
    expect(s.buys).toBeCloseTo(78.25, 2);          // 100 / 1.2779
    expect(s.annualizedPct).toBeCloseTo(3.84, 2);  // 1.2779^(365/2378) - 1
  });
  it("uses the nearest observation at or before the date", () => {
    const s = sinceStats(["2020-01-01", "2020-01-05"], [100, 110], "2020-01-03", 50)!;
    expect(s.startDate).toBe("2020-01-01");
    expect(s.thenNow).toBeCloseTo(55, 4);
  });
  it("returns null before the series starts", () => {
    expect(sinceStats(DATES, INDEX, "2019-12-31", 100)).toBeNull();
  });
});
```

Run: `npm test 2>&1 | tee /tmp/phase2b-t8-red.txt` — FAIL (module missing).

- [ ] **Step 2: Implement** — create `site/src/lib/since.ts`:

```ts
export type SinceStats = {
  startDate: string;
  days: number;
  pctSince: number;
  thenNow: number;
  buys: number;
  annualizedPct: number;
};

/** Since-date math over the daily gauge index. Uses the nearest observation
 *  at or before `since`; null if `since` predates the series. */
export function sinceStats(
  dates: string[],
  index: number[],
  since: string,
  amount: number
): SinceStats | null {
  let i = -1;
  for (let j = 0; j < dates.length; j++) {
    if (dates[j] <= since) i = j;
    else break;
  }
  if (i < 0) return null;
  const last = index.length - 1;
  const ratio = index[last] / index[i];
  const days = Math.round(
    (Date.parse(dates[last]) - Date.parse(dates[i])) / 86400000
  );
  return {
    startDate: dates[i],
    days,
    pctSince: (ratio - 1) * 100,
    thenNow: amount * ratio,
    buys: amount / ratio,
    annualizedPct: days > 0 ? (Math.pow(ratio, 365 / days) - 1) * 100 : 0,
  };
}
```

Run: `npm test 2>&1 | tee /tmp/phase2b-t8-green.txt` — PASS.

- [ ] **Step 3: CalculatorClient** — create `site/src/components/CalculatorClient.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { EChart } from "./EChart";
import { KpiCard } from "./KpiCard";
import { C, baseOption } from "@/lib/chartTheme";
import { sinceStats } from "@/lib/since";

type GaugeDaily = {
  variants: { gauge: { dates: string[]; index: number[] } };
};

export function CalculatorClient() {
  const [data, setData] = useState<GaugeDaily | null>(null);
  const [since, setSince] = useState("2020-01-01");
  const [amount, setAmount] = useState(100);

  useEffect(() => {
    fetch("/data/gauge_daily.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading daily gauge index…
      </div>
    );
  }
  const { dates, index } = data.variants.gauge;
  const s = sinceStats(dates, index, since, amount);
  const from = s ? dates.indexOf(s.startDate) : 0;
  const input: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          SINCE{" "}
          <input
            type="date"
            min={dates[0]}
            max={dates[dates.length - 1]}
            value={since}
            onChange={(e) => setSince(e.target.value)}
            style={input}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          AMOUNT ($){" "}
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ ...input, width: 90 }}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          try: lease signing day, your last raise, your kid&apos;s birthday
        </span>
      </div>

      {s && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <KpiCard
              label={`Prices since ${s.startDate}`}
              value={`${s.pctSince >= 0 ? "+" : "−"}${Math.abs(s.pctSince).toFixed(2)}%`}
              context={`through ${dates[dates.length - 1]} — updated with every publish`}
              accent={s.pctSince >= 0 ? "red" : "emerald"}
            />
            <KpiCard
              label={`$${amount} then costs now`}
              value={`$${s.thenNow.toFixed(2)}`}
              context="same basket, today's prices"
              accent="amber"
            />
            <KpiCard
              label={`$${amount} now buys what this bought`}
              value={`$${s.buys.toFixed(2)}`}
              context="purchasing power remaining"
              accent="sky"
            />
            <KpiCard
              label="Annualized rate over the period"
              value={`${s.annualizedPct.toFixed(2)}%/yr`}
              context={`${s.days} days`}
              accent="violet"
            />
          </div>
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "12px 8px 4px",
              marginTop: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted)",
                padding: "0 8px",
              }}
            >
              The price level since {s.startDate} (Jan 2018 = 100)
            </div>
            <EChart
              option={{
                ...baseOption(),
                legend: { show: false },
                series: [
                  {
                    name: "Gauge index",
                    type: "line",
                    showSymbol: false,
                    lineStyle: { width: 1.5 },
                    color: C.sky,
                    data: dates
                      .slice(from)
                      .map((d, i) => [d, index[from + i]] as [string, number]),
                  },
                ],
                yAxis: {
                  ...baseOption().yAxis,
                  axisLabel: { color: C.muted },
                  scale: true,
                },
              }}
              height={340}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: The page** — create `site/src/app/calculator/page.tsx`:

```tsx
import type { Metadata } from "next";
import { Section } from "@/components/Section";
import { CalculatorClient } from "@/components/CalculatorClient";

export const metadata: Metadata = { title: "The Since-Date Calculator — macrogauge" };

export default function Calculator() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        The Since-Date Calculator{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          what inflation has done since any date — computed from the daily gauge, not
          last quarter&apos;s CPI
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <CalculatorClient />
      </div>
      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Powered by the macrogauge daily index (market prices, Jan 2018 = 100) from
          gauge_daily.json. Official-CPI calculators can only answer in whole months,
          two months late. Annualized rate = ratio^(365/days) − 1. See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>methodology</a>{" "}
          for sources and the gauge&apos;s public track record.
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 5: Nav** — add the Calculator link to `PageShell.tsx` (order per Task 5 note).

- [ ] **Step 6: Verify** — `npm test && npm run build && npm run lint` green.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/since.ts site/src/lib/since.test.ts \
  site/src/components/CalculatorClient.tsx site/src/app/calculator/page.tsx \
  site/src/components/PageShell.tsx
git commit -m "feat(site): /calculator — since-date math over the daily gauge index"
```

---

### Task 9: /my-inflation — reweighter lib + page

**Files:**
- Create: `site/src/lib/reweight.ts`, `site/src/lib/reweight.test.ts`,
  `site/src/components/MyInflationClient.tsx`, `site/src/app/my-inflation/page.tsx`
- Modify: `site/src/components/PageShell.tsx` (nav: My Inflation link)

**Interfaces:**
- Consumes: `replay.json` (`dates`, `components[].{code,label,weight,yoy}` — own-obs YoY,
  the engine's Option A series) via runtime fetch; `compare.json` + `pulse.json` build-time.
- Produces: `applyAnswers`, `renormalize`, `weightedYoY`, `contributions`,
  `DEFAULT_ANSWERS`, `MULTIPLIER_NOTES` (printed in the footer).

- [ ] **Step 1: RED** — create `site/src/lib/reweight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import replay from "../../public/data/replay.json";
import compare from "../../public/data/compare.json";
import {
  DEFAULT_ANSWERS,
  applyAnswers,
  contributions,
  renormalize,
  weightedYoY,
  type Answers,
} from "./reweight";

const NEUTRAL: Answers = {
  housing: "own_mortgage", // still reallocates; neutrality is tested via renormalize path
  driving: "average",
  eating: "average",
  healthcare: "average",
  tuition: "no",
};

const COMPS = [
  { code: "a", label: "A", weight: 0.6, yoy: [2.0, 3.0] },
  { code: "b", label: "B", weight: 0.4, yoy: [5.0, null] },
];

describe("weightedYoY", () => {
  it("hand-computed weighted own-obs YoY", () => {
    // 0.6*2.0 + 0.4*5.0 = 3.2
    expect(weightedYoY(COMPS, { a: 0.6, b: 0.4 }, 0)).toBeCloseTo(3.2, 10);
  });
  it("null if any component is null at that date", () => {
    expect(weightedYoY(COMPS, { a: 0.6, b: 0.4 }, 1)).toBeNull();
  });
});

describe("applyAnswers", () => {
  const base = [
    { code: "shelter_owned", label: "", weight: 0.265, yoy: [] },
    { code: "shelter_rent", label: "", weight: 0.075, yoy: [] },
    { code: "fuel", label: "", weight: 0.03, yoy: [] },
    { code: "used_vehicles", label: "", weight: 0.021, yoy: [] },
    { code: "new_vehicles", label: "", weight: 0.036, yoy: [] },
    { code: "food_away", label: "", weight: 0.057, yoy: [] },
    { code: "food_home", label: "", weight: 0.082, yoy: [] },
    { code: "medical", label: "", weight: 0.081, yoy: [] },
    { code: "education_comm", label: "", weight: 0.055, yoy: [] },
  ];
  it("renter: full shelter weight to rent", () => {
    const w = applyAnswers(base, { ...NEUTRAL, housing: "rent" });
    expect(w.shelter_rent).toBeCloseTo(0.34, 10);
    expect(w.shelter_owned).toBe(0);
  });
  it("paid-off owner keeps 35% of ownership costs", () => {
    const w = applyAnswers(base, { ...NEUTRAL, housing: "own_paidoff" });
    expect(w.shelter_owned).toBeCloseTo(0.34 * 0.35, 10);
    expect(w.shelter_rent).toBe(0);
  });
  it("don't-drive zeroes fuel and both vehicle components", () => {
    const w = applyAnswers(base, { ...NEUTRAL, driving: "none" });
    expect(w.fuel).toBe(0);
    expect(w.used_vehicles).toBe(0);
    expect(w.new_vehicles).toBe(0);
  });
  it("tuition-no scales education_comm to 0.6x", () => {
    const w = applyAnswers(base, NEUTRAL);
    expect(w.education_comm).toBeCloseTo(0.055 * 0.6, 10);
  });
});

describe("renormalize", () => {
  it("sums to 1 after zeroing", () => {
    const w = renormalize({ a: 0.5, b: 0, c: 0.25 });
    expect(w.a + w.b + w.c).toBeCloseTo(1, 10);
    expect(w.a).toBeCloseTo(2 / 3, 10);
  });
});

describe("engine invariant (spec §6, verified against live data)", () => {
  it("base weights reproduce published gauge YoY at every compare month", () => {
    // With the published weights untouched (no answers applied), the client's
    // weighted own-obs YoY IS the engine's Option A headline. Tolerance 0.02:
    // component yoy values are rounded to 2dp in replay.json (±0.005 weighted)
    // and compare rounds again (±0.005).
    const comps = replay.components as {
      code: string; label: string; weight: number; yoy: (number | null)[];
    }[];
    const w = renormalize(
      Object.fromEntries(comps.map((c) => [c.code, c.weight]))
    );
    let checked = 0;
    compare.months.forEach((m: string, mi: number) => {
      const g = compare.gauge_yoy_pct[mi];
      const di = (replay.dates as string[]).indexOf(m);
      if (g === null || di === -1) return;
      const mine = weightedYoY(comps, w, di);
      if (mine === null) return;
      expect(Math.abs(mine - g)).toBeLessThanOrEqual(0.02);
      checked++;
    });
    expect(checked).toBeGreaterThan(90); // ~100 months of real coverage
  });
});

describe("contributions", () => {
  it("sums to the personal rate (Option A property)", () => {
    const w = { a: 0.6, b: 0.4 };
    const list = contributions(COMPS, w, 0);
    const total = list.reduce((s, c) => s + c.pp, 0);
    expect(total).toBeCloseTo(weightedYoY(COMPS, w, 0)!, 10);
    expect(list[0].code).toBe("b"); // 0.4*5=2.0 > 0.6*2=1.2
  });
});
```

Run: `npm test 2>&1 | tee /tmp/phase2b-t9-red.txt` — FAIL (module missing).

- [ ] **Step 2: Implement** — create `site/src/lib/reweight.ts`:

```ts
/** My-inflation reweighter — pure math over replay.json's published data.
 *
 *  Personal YoY(t) = Σ wᵢ × component_own_yoyᵢ(t): the engine's own headline
 *  construction (Option A, weighted own-obs YoYs — the 1c sawtooth fix),
 *  applied to reweighted published weights. Never an index-ratio
 *  recomputation. Multipliers below are printed verbatim on the page. */

export type Answers = {
  housing: "rent" | "own_mortgage" | "own_paidoff";
  driving: "none" | "average" | "heavy";
  eating: "cook" | "average" | "out";
  healthcare: "light" | "average" | "heavy";
  tuition: "no" | "yes";
};

export const DEFAULT_ANSWERS: Answers = {
  housing: "rent",
  driving: "average",
  eating: "average",
  healthcare: "average",
  tuition: "no",
};

export type Comp = {
  code: string;
  label: string;
  weight: number;
  yoy: (number | null)[];
};

/** Scale published weights by the answers (NOT yet renormalized). */
export function applyAnswers(
  components: { code: string; weight: number }[],
  a: Answers
): Record<string, number> {
  const w: Record<string, number> = {};
  for (const c of components) w[c.code] = c.weight;
  const shelter = (w.shelter_owned ?? 0) + (w.shelter_rent ?? 0);
  if (a.housing === "rent") {
    w.shelter_rent = shelter;
    w.shelter_owned = 0;
  } else if (a.housing === "own_mortgage") {
    w.shelter_owned = shelter;
    w.shelter_rent = 0;
  } else {
    w.shelter_owned = shelter * 0.35; // taxes/insurance/upkeep remain
    w.shelter_rent = 0;
  }
  const m: Record<string, number> = {};
  if (a.driving === "none") {
    m.fuel = 0; m.used_vehicles = 0; m.new_vehicles = 0;
  } else if (a.driving === "heavy") {
    m.fuel = 2.5; m.used_vehicles = 1.5; m.new_vehicles = 1.5;
  }
  if (a.eating === "cook") { m.food_away = 0.4; m.food_home = 1.4; }
  else if (a.eating === "out") { m.food_away = 2; m.food_home = 0.7; }
  if (a.healthcare === "light") m.medical = 0.5;
  else if (a.healthcare === "heavy") m.medical = 2;
  m.education_comm = a.tuition === "yes" ? 2.5 : 0.6;
  for (const k of Object.keys(m)) if (w[k] !== undefined) w[k] *= m[k];
  return w;
}

export function renormalize(w: Record<string, number>): Record<string, number> {
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
}

/** Σ wᵢ × yoyᵢ at daily position i; null if any weighted component is null. */
export function weightedYoY(
  components: Comp[],
  weights: Record<string, number>,
  i: number
): number | null {
  let sum = 0;
  for (const c of components) {
    const v = c.yoy[i];
    if (v === null || v === undefined) return null;
    sum += (weights[c.code] ?? 0) * v;
  }
  return sum;
}

export type Contribution = {
  code: string;
  label: string;
  pp: number;
  weightPct: number;
  yoyPct: number;
};

/** Per-component contribution at position i, biggest drivers first.
 *  Sums exactly to weightedYoY (Option A property). */
export function contributions(
  components: Comp[],
  weights: Record<string, number>,
  i: number
): Contribution[] {
  return components
    .map((c) => ({
      code: c.code,
      label: c.label,
      pp: (weights[c.code] ?? 0) * (c.yoy[i] ?? 0),
      weightPct: (weights[c.code] ?? 0) * 100,
      yoyPct: c.yoy[i] ?? 0,
    }))
    .sort((a, b) => b.pp - a.pp);
}

/** Printed verbatim in the page footer — honesty about the approximation. */
export const MULTIPLIER_NOTES = [
  "Housing: renters get the full shelter weight as rent; owners w/ mortgage as owned; paid-off owners keep 35% of ownership costs (taxes, insurance, upkeep)",
  "Driving: don't drive → fuel ×0, vehicles ×0 · heavy commuter → fuel ×2.5, vehicles ×1.5",
  "Eating out: mostly cook → food-away ×0.4, food-at-home ×1.4 · eat out a lot → food-away ×2, food-at-home ×0.7",
  "Healthcare: light ×0.5 · heavy ×2 (medical care)",
  "Tuition: no → education & comm ×0.6 · yes → ×2.5",
];
```

Run: `npm test 2>&1 | tee /tmp/phase2b-t9-green.txt` — ALL PASS including the invariant.

- [ ] **Step 3: MyInflationClient** — create `site/src/components/MyInflationClient.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { EChart } from "./EChart";
import { SegmentedControl } from "./SegmentedControl";
import { C, baseOption } from "@/lib/chartTheme";
import { heatColor } from "@/lib/heat";
import { fmtPct } from "@/lib/format";
import {
  DEFAULT_ANSWERS,
  MULTIPLIER_NOTES,
  applyAnswers,
  contributions,
  renormalize,
  weightedYoY,
  type Answers,
  type Comp,
} from "@/lib/reweight";

type Replay = { dates: string[]; components: Comp[] };

const ROWS: {
  key: keyof Answers;
  label: string;
  options: readonly { key: string; label: string }[];
}[] = [
  { key: "housing", label: "🏠 Housing",
    options: [
      { key: "rent", label: "I rent" },
      { key: "own_mortgage", label: "Own w/ mortgage" },
      { key: "own_paidoff", label: "Own, paid off" },
    ] },
  { key: "driving", label: "🚗 Driving",
    options: [
      { key: "none", label: "Don't drive" },
      { key: "average", label: "Average miles" },
      { key: "heavy", label: "Heavy commuter" },
    ] },
  { key: "eating", label: "🍽 Eating out",
    options: [
      { key: "cook", label: "Mostly cook" },
      { key: "average", label: "Average" },
      { key: "out", label: "Eat out a lot" },
    ] },
  { key: "healthcare", label: "🩺 Healthcare use",
    options: [
      { key: "light", label: "Light" },
      { key: "average", label: "Average" },
      { key: "heavy", label: "Heavy" },
    ] },
  { key: "tuition", label: "🎓 Paying tuition",
    options: [
      { key: "no", label: "No" },
      { key: "yes", label: "Yes" },
    ] },
];

export function MyInflationClient({
  compareMonths,
  compareGauge,
  gaugeYoy,
  gaugeAsOf,
}: {
  compareMonths: string[];
  compareGauge: (number | null)[];
  gaugeYoy: number;
  gaugeAsOf: string;
}) {
  const [data, setData] = useState<Replay | null>(null);
  const [answers, setAnswers] = useState<Answers>(DEFAULT_ANSWERS);

  useEffect(() => {
    fetch("/data/replay.json")
      .then((r) => r.json())
      .then((d: Replay) => setData(d))
      .catch(() => setData(null));
  }, []);

  const weights = useMemo(
    () => (data ? renormalize(applyAnswers(data.components, answers)) : null),
    [data, answers]
  );

  if (!data || !weights) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
        loading component data…
      </div>
    );
  }

  const lastIdx = data.dates.length - 1;
  const mine = weightedYoY(data.components, weights, lastIdx);
  const diff = mine === null ? null : mine - gaugeYoy;

  const personalSeries = compareMonths.map((m) => {
    const di = data.dates.indexOf(m);
    return [m, di === -1 ? null : weightedYoY(data.components, weights, di)] as [
      string,
      number | null,
    ];
  });
  const top = contributions(data.components, weights, lastIdx).slice(0, 5);
  const maxPp = Math.max(...top.map((t) => Math.abs(t.pp)), 0.01);

  return (
    <div>
      <div style={{ display: "grid", gap: 10 }}>
        {ROWS.map((row) => (
          <div
            key={row.key}
            style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>
              {row.label}
            </span>
            <SegmentedControl
              options={row.options}
              value={answers[row.key]}
              // computed-key spread widens the field type to string — cast back
              onChange={(k) => setAnswers((a) => ({ ...a, [row.key]: k }) as Answers)}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          marginTop: 16,
          display: "flex",
          gap: 28,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Your inflation rate
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: "var(--accent-amber)", fontVariantNumeric: "tabular-nums" }}>
            {mine === null ? "—" : fmtPct(mine)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Macrogauge (everyone)
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--accent-sky)", fontVariantNumeric: "tabular-nums" }}>
            {fmtPct(gaugeYoy)}
          </div>
        </div>
        {diff !== null && (
          <div style={{ fontSize: 14 }}>
            Your basket is running{" "}
            <span
              style={{
                fontWeight: 700,
                color: diff > 0 ? "var(--accent-red)" : "var(--accent-emerald)",
              }}
            >
              {Math.abs(diff).toFixed(2)}pp {diff > 0 ? "hotter" : "cooler"}
            </span>{" "}
            than the average consumer&apos;s · as of {gaugeAsOf}
          </div>
        )}
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 8px 4px",
          marginTop: 16,
        }}
      >
        <EChart
          option={{
            ...baseOption(),
            series: [
              {
                name: "MY inflation",
                type: "line", showSymbol: false, lineStyle: { width: 1.5 },
                color: C.amber, data: personalSeries,
              },
              {
                name: "Macrogauge (everyone)",
                type: "line", showSymbol: false, lineStyle: { width: 1.5 },
                color: C.sky,
                data: compareMonths.map(
                  (m, i) => [m, compareGauge[i]] as [string, number | null]
                ),
              },
            ],
          }}
          height={340}
        />
      </div>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          marginTop: 16,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
          What&apos;s driving your number
        </div>
        {top.map((t) => (
          <div
            key={t.code}
            style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 0", fontSize: 13 }}
          >
            <span style={{ minWidth: 140 }}>{t.label}</span>
            <span
              style={{
                height: 6,
                width: `${(Math.abs(t.pp) / maxPp) * 120}px`,
                background: heatColor(t.yoyPct),
                borderRadius: 3,
              }}
            />
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {t.pp.toFixed(2)}pp · {t.weightPct.toFixed(0)}% of your basket at{" "}
              {t.yoyPct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        Method: the published basket weights are scaled by your answers, renormalized to
        100%, and applied to the same published component data behind the treemap
        (own-observation YoY — the gauge&apos;s own construction). Simple, transparent,
        and honest about being an approximation. Multipliers: {MULTIPLIER_NOTES.join(" · ")}.
        State-level localization arrives with Phase 4.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The page** — create `site/src/app/my-inflation/page.tsx`:

```tsx
import type { Metadata } from "next";
import compare from "../../../public/data/compare.json";
import pulse from "../../../public/data/pulse.json";
import { MyInflationClient } from "@/components/MyInflationClient";

export const metadata: Metadata = { title: "My Inflation — macrogauge" };

export default function MyInflation() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        My Inflation{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          the official basket isn&apos;t your basket — reweight it to your life
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <MyInflationClient
          compareMonths={compare.months}
          compareGauge={compare.gauge_yoy_pct}
          gaugeYoy={pulse.gauge.yoy_pct}
          gaugeAsOf={pulse.gauge.as_of}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Nav** — add the My Inflation link to `PageShell.tsx` (order per Task 5 note).

- [ ] **Step 6: Verify** — `npm test && npm run build && npm run lint` green. Manual:
  defaults show YOUR rate ≠ gauge (renter persona); flipping Housing to "Own w/ mortgage"
  with everything else Average moves YOUR rate close to (not exactly) the gauge — tuition-no
  ×0.6 keeps it off; that's by design and printed in the footer.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/reweight.ts site/src/lib/reweight.test.ts \
  site/src/components/MyInflationClient.tsx site/src/app/my-inflation/page.tsx \
  site/src/components/PageShell.tsx
git commit -m "feat(site): /my-inflation — Option A reweighter with engine invariant test"
```

---

### Task 10: Playwright smoke + CI wiring + CLAUDE.md commands

**Files:**
- Create: `site/playwright.config.ts`, `site/e2e/smoke.spec.ts`
- Modify: `site/package.json`, `.github/workflows/ci.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: the built static export in `site/out/` (client fetches hit `/data/*.json`
  copied from `public/`).
- Produces: `npm run e2e` — six-page render + zero-console-error gate, in CI.

- [ ] **Step 1: Install.** In `site/`: `npm install -D @playwright/test serve`, then
  `npx playwright install chromium`. Add scripts to `site/package.json`:
  `"e2e": "playwright test"`.

- [ ] **Step 2: Config** — create `site/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npx serve -l 4173 out",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Smoke spec** — create `site/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// (route, text that proves the page's own content rendered)
const ROUTES: [string, string][] = [
  ["/", "Inflation quilt — every component, every month"],
  ["/methodology", "generated from config + live validation"],
  ["/supercore", "Supercore Services"],
  ["/my-inflation", "the official basket isn"],
  ["/calculator", "The Since-Date Calculator"],
  ["/real-wages", "Real Wage Tracker"],
];

for (const [path, text] of ROUTES) {
  test(`renders ${path} without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(path);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await page.waitForLoadState("networkidle"); // let /data fetches land
    expect(errors).toEqual([]);
  });
}

test("quilt module renders month cells and grocery cards render prices", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("OURS: CPI-Comparable")).toBeVisible();
  await expect(page.getByText("Eggs (dozen)")).toBeVisible();
});
```

- [ ] **Step 4: Local RED→GREEN.** RED first with a deliberately unbuilt site:
  `rm -rf out && npm run e2e 2>&1 | tee /tmp/phase2b-t10-red.txt` (webServer fails or
  pages 404). Then `npm run build && npm run e2e 2>&1 | tee /tmp/phase2b-t10-green.txt` —
  7 tests pass.

- [ ] **Step 5: CI** — in `.github/workflows/ci.yml`, append to the `site` job after the
  build step:

```yaml
      - run: npm test
        working-directory: site
      - run: npx playwright install --with-deps chromium
        working-directory: site
      - run: npm run e2e
        working-directory: site
```

- [ ] **Step 6: CLAUDE.md commands** — in the site commands block add:

```bash
npm test           # vitest — client math (since/reweight/realwage)
npm run e2e        # Playwright smoke — 6 pages render, zero console errors
```

- [ ] **Step 7: Commit**

```bash
git add site/playwright.config.ts site/e2e/smoke.spec.ts site/package.json \
  site/package-lock.json .github/workflows/ci.yml CLAUDE.md
git commit -m "test(site): Playwright smoke across all six pages + vitest in CI"
```

---

### Task 11: Close-out — exit-criteria verification and ship gate

**Files:**
- Modify: `.superpowers/sdd/progress.md` (CONTROLLER ONLY — subagents never touch it)

- [ ] **Step 1: Full verification battery**

```bash
pytest -q                       # pipeline: all green
cd site && npm run build && npm run lint && npm test && npm run e2e
```

All green, verbatim outputs teed to `/tmp/phase2b-t11-*.txt`.

- [ ] **Step 2: Reconciliation spot-checks (exit criterion 1)** — run and eyeball:

```bash
python3 - <<'EOF'
import json
d = lambda f: json.load(open(f'site/public/data/{f}'))
gd, pulse, rw, gr = d('gauge_daily.json'), d('pulse.json'), d('real_wages.json'), d('grocery_basket.json')
sc = gd['variants']['supercore']
ys = [y for y in sc['yoy_pct'] if y is not None]
print('supercore KPI       :', ys[-1])
print('gauge/pulse         :', pulse['gauge']['yoy_pct'], pulse['gauge']['as_of'])
k = rw['kpis']; w, g = k['wage_growth_pct'], pulse['gauge']['yoy_pct']
print('real wage formula ok:', k['real_wage_growth_pct'],
      round(((1+w/100)/(1+g/100)-1)*100, 2))
for it in gr['items'][:3]:
    assert it['price'] == it['series']['prices'][it['series']['months'].index(it['month'])]
print('grocery card=series : ok')
EOF
```

Expected: real-wage formula check prints two equal numbers; no assertion errors. Compare
each printed value against the rendered pages in `npm run dev`.

- [ ] **Step 3: Update the ledger** — append to `.superpowers/sdd/progress.md`:
  `Phase 2b COMPLETE <date> — six surfaces live (quilt + grocery homepage modules;
  /supercore /my-inflation /calculator /real-wages), real_wages.json (14 files),
  vitest + Playwright in CI.`

- [ ] **Step 4: Ship gate (user approval REQUIRED).** `git fetch origin && git rebase
  origin/main` (expect `data: daily publish` bot commits; store conflicts resolve by
  union). Present the branch summary to the user; push ONLY on their explicit approval —
  push = production deploy.

- [ ] **Step 5: Exit criterion 4 — watch the next unattended daily run** publish
  `real_wages.json` + 28-item `grocery_basket.json` cleanly (bot commit lands, QA green,
  Vercel deploy READY). This is a next-morning check, not a same-day step.
