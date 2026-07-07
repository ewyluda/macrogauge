# macrogauge Phase 1a.5 — Interim Official-Data Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the placeholder homepage into a nowflation-style official-data dashboard using the 31 series already collected — KPI hero row, color-coded CPI component table, grocery/energy/rates/markets cards, and a sources-status row — published via a new `official.json`.

**Architecture:** One new engine module extension (generic YoY/MoM summaries + nearest-365d quote YoY), one new writer (`official.json` + schema), `run_daily` wiring, then a site rebuild composing ~4 small new components with the existing design tokens. No gauge — that stays Phase 1b. This phase deliberately front-loads Phase 1c's component library.

**Tech Stack:** Existing: Python 3.12 stdlib pipeline, Next.js static export + TypeScript site.

## Global Constraints

- The site never computes analytics — the pipeline publishes final numbers (rounded 2dp for percentages); the browser only formats (1dp display for percentages, thousands separators for dollars).
- Every published JSON has a JSON Schema in `schemas/` and exactly one writer module; validated in `run_daily` before publish and by `tests/test_published_data.py` on the committed artifact.
- Design tokens (hard rule): bg `#0B0F14`, card `#11161C`, border `#1E2630`, text `#E6EDF3`, muted `#8B98A5`; accents sky `#38BDF8`, amber `#F59E0B` (official data), red `#F87171` (inflation hot / rising), emerald `#34D399` (cooling / falling), violet `#A78BFA`; radius 10px; uppercase 11px letter-spaced micro-labels; tabular numerals. Semantic: positive YoY inflation = red, negative = emerald; amber = official headline figures.
- Every figure renders with its as-of date (month or obs_date). No number without a date.
- All dates `YYYY-MM-DD`; monthly obs are first-of-month.
- Tests never hit the network; engine tests use hand-computed fixtures via `vintage.append`/`load` on `tmp_path`.
- Commit messages: conventional prefixes (`feat:`, `fix:`, `test:`, `data:`, `docs:`, `ci:`, `chore:`).
- TDD integrity: run failing tests BEFORE implementing; capture the RED output into the task report at run time.
- Work from `~/Development/macrogauge`, venv active (`source .venv/bin/activate`); site work in `site/` with npm.

## File Structure

```
pipeline/engine/official.py        # + component_summary(), latest_quote()   (Task 1)
pipeline/publish/official.py       # official.json writer + SHORT_LABELS     (Task 2)
schemas/official.schema.json       # (Task 2)
pipeline/run_daily.py              # wire writer                             (Task 3)
site/src/lib/format.ts             # + fmtSigned, fmtMoney, yoyColor         (Task 4)
site/src/components/DeltaChip.tsx  # signed pp/% pill                        (Task 4)
site/src/components/StatusPill.tsx # ok/fail micro-badge                     (Task 4)
site/src/components/Section.tsx    # uppercase section header wrapper        (Task 4)
site/src/app/page.tsx              # dashboard rebuild                       (Task 5)
```

---

### Task 1: Engine — `component_summary` + `latest_quote`

**Files:**
- Modify: `pipeline/engine/official.py`
- Test: `tests/test_official.py` (append)

**Interfaces:**
- Consumes: `vintage.latest(conn, code)`, `vintage.max_vintage(conn, code)`, `_months_back` (existing).
- Produces: `official.component_summary(conn, code) -> dict` — `{"code": str, "month": str, "yoy_pct": float, "mom_pct": float}` for a monthly index series (unrounded); raises `ValueError` when the 12-months-back base or prior month is missing.
- Produces: `official.latest_quote(conn, code) -> dict` — `{"code": str, "latest": float, "obs_date": str, "yoy_pct": float | None}` for any-cadence value series: `yoy_pct` compares the latest value to the nearest observation at or before (obs_date − 365d), `None` when no base exists within 60 days before that target (unrounded).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_official.py`; the file's existing `seed()` helper seeds series `CPIAUCNS` — add a generic variant)

```python
def seed_code(tmp_path, code, rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-07", source="T", route="API")
           for d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_component_summary_hand_computed(tmp_path):
    conn = seed_code(tmp_path, "COMP", [
        ("2025-05-01", 200.0), ("2026-04-01", 205.0), ("2026-05-01", 206.0)])
    r = official.component_summary(conn, "COMP")
    assert r["code"] == "COMP" and r["month"] == "2026-05-01"
    assert r["yoy_pct"] == pytest.approx((206.0 / 200.0 - 1) * 100)  # 3.0
    assert r["mom_pct"] == pytest.approx((206.0 / 205.0 - 1) * 100)  # 0.4878...


def test_component_summary_missing_base_raises(tmp_path):
    conn = seed_code(tmp_path, "COMP2", [("2026-04-01", 205.0), ("2026-05-01", 206.0)])
    with pytest.raises(ValueError):
        official.component_summary(conn, "COMP2")


def test_latest_quote_weekly_series(tmp_path):
    conn = seed_code(tmp_path, "GAS", [
        ("2025-06-30", 3.20), ("2025-07-07", 3.25), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS")
    assert (r["latest"], r["obs_date"]) == (3.40, "2026-06-29")
    # target base date = 2026-06-29 - 365d = 2025-06-29; nearest at/before = 2025-06-30? NO —
    # 2025-06-30 is AFTER 2025-06-29, so nearest at/before within 60d... none earlier exists?
    # 2025-06-30 > target, 2025-07-07 > target -> no base at/before target -> yoy None
    assert r["yoy_pct"] is None


def test_latest_quote_base_found(tmp_path):
    conn = seed_code(tmp_path, "GAS2", [
        ("2025-06-20", 3.20), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS2")
    # target 2025-06-29; nearest at/before = 2025-06-20 (9d gap, within 60d)
    assert r["yoy_pct"] == pytest.approx((3.40 / 3.20 - 1) * 100)  # 6.25


def test_latest_quote_stale_base_is_none(tmp_path):
    conn = seed_code(tmp_path, "GAS3", [
        ("2025-03-01", 3.00), ("2026-06-29", 3.40)])
    r = official.latest_quote(conn, "GAS3")
    assert r["yoy_pct"] is None  # base 115d before target — outside 60d tolerance
```

- [ ] **Step 2: Run to verify RED**

Run: `pytest tests/test_official.py -v -k "component_summary or latest_quote"`
Expected: FAIL — `AttributeError` (functions missing). Note: `Observation` must be imported in the test file already (it is, via the existing `seed()`); `pytest` too.

- [ ] **Step 3: Implement** (append to `pipeline/engine/official.py`)

```python
from datetime import date, timedelta

QUOTE_BASE_TOLERANCE_DAYS = 60  # a YoY base older than this before target is meaningless


def component_summary(conn: sqlite3.Connection, series_code: str) -> dict:
    """YoY + MoM for a monthly index series (unrounded)."""
    series = dict(vintage.latest(conn, series_code))
    if not series:
        raise ValueError(f"no observations for {series_code}")
    month = max(series)
    base, prev = _months_back(month, 12), _months_back(month, 1)
    if base not in series or prev not in series:
        raise ValueError(f"missing base/prior month for {series_code}")
    return {"code": series_code, "month": month,
            "yoy_pct": (series[month] / series[base] - 1) * 100,
            "mom_pct": (series[month] / series[prev] - 1) * 100}


def latest_quote(conn: sqlite3.Connection, series_code: str) -> dict:
    """Latest value of any-cadence series + YoY vs the nearest obs <= 365d ago."""
    rows = vintage.latest(conn, series_code)
    if not rows:
        raise ValueError(f"no observations for {series_code}")
    obs_date, latest = rows[-1]
    target = (date.fromisoformat(obs_date) - timedelta(days=365)).isoformat()
    base = [(d, v) for d, v in rows if d <= target]
    yoy = None
    if base:
        base_date, base_val = base[-1]
        gap = (date.fromisoformat(target) - date.fromisoformat(base_date)).days
        if gap <= QUOTE_BASE_TOLERANCE_DAYS and base_val:
            yoy = (latest / base_val - 1) * 100
    return {"code": series_code, "latest": latest, "obs_date": obs_date, "yoy_pct": yoy}
```

- [ ] **Step 4: GREEN + full suite**

Run: `pytest tests/test_official.py -v && pytest -q`
Expected: all pass (45 + 5 new = 50)

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/official.py tests/test_official.py
git commit -m "feat: engine component_summary + latest_quote for official dashboard"
```

---

### Task 2: `official.json` writer + schema

**Files:**
- Create: `pipeline/publish/official.py`, `schemas/official.schema.json`
- Test: `tests/test_official_writer.py`

**Interfaces:**
- Consumes: `component_summary`/`latest_quote`/`latest_yoy` (Task 1 + existing), `registry.Series` (for label fallback), `validate.validate_file`.
- Produces: `official.build(conn, series: list) -> dict` and `official.write(payload: dict, out_dir: Path, published_at: str) -> Path` in `pipeline/publish/official.py` (module name shadows the engine module only by filename — imports are `from pipeline.publish import official as official_pub` where needed; inside `run_daily` import as `official_json`).
- Produces file shape (percentages rounded 2dp, dollars 2dp/0dp as noted):

```json
{
  "published_at": "...",
  "headline": {
    "cpi":  {"month": "...", "yoy_pct": 4.25, "prev_yoy_pct": 3.81},
    "core": {"month": "...", "yoy_pct": 0.0,  "prev_yoy_pct": 0.0}
  },
  "components": [{"code","label","month","yoy_pct","mom_pct"} × 14],
  "quotes": [{"code","label","group","unit","latest","obs_date","yoy_pct"|null} × 12]
}
```
- Groups/membership (exact): `grocery` = the 6 AP series; `energy` = eia_gasreg_w ($/gal), eia_elec_res (¢/kWh), eia_ng_res ($/Mcf); `rates` = pmms_30yr (%); `markets` = fmp_gold ($/oz), fmp_wti ($/bbl); `fiscal` = fiscal_debt_total ($).
- The 14 `components` are the CUUR series (16 FRED minus CPIAUCNS/CPILFENS which are headline).

- [ ] **Step 1: Write the schema** — `schemas/official.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "official",
  "type": "object",
  "required": ["published_at", "headline", "components", "quotes"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "headline": {
      "type": "object",
      "required": ["cpi", "core"],
      "additionalProperties": false,
      "properties": {
        "cpi": {"$ref": "#/$defs/headline_row"},
        "core": {"$ref": "#/$defs/headline_row"}
      }
    },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "label", "month", "yoy_pct", "mom_pct"],
        "additionalProperties": false,
        "properties": {
          "code": {"type": "string"}, "label": {"type": "string"},
          "month": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
          "yoy_pct": {"type": "number"}, "mom_pct": {"type": "number"}
        }
      }
    },
    "quotes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "label", "group", "unit", "latest", "obs_date", "yoy_pct"],
        "additionalProperties": false,
        "properties": {
          "code": {"type": "string"}, "label": {"type": "string"},
          "group": {"enum": ["grocery", "energy", "rates", "markets", "fiscal"]},
          "unit": {"type": "string"},
          "latest": {"type": "number"},
          "obs_date": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
          "yoy_pct": {"type": ["number", "null"]}
        }
      }
    }
  },
  "$defs": {
    "headline_row": {
      "type": "object",
      "required": ["month", "yoy_pct", "prev_yoy_pct"],
      "additionalProperties": false,
      "properties": {
        "month": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
        "yoy_pct": {"type": "number"}, "prev_yoy_pct": {"type": "number"}
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test** — `tests/test_official_writer.py`:

```python
import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import official as official_pub
from pipeline.publish import validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def seed_full(tmp_path):
    """Minimal 13-month histories for every registry series so build() succeeds."""
    _, series = load_registry()
    obs = []
    months = [f"2025-{m:02d}-01" for m in range(5, 13)] + \
             [f"2026-{m:02d}-01" for m in range(1, 6)]
    for s in series:
        if s.code in ("fmp_gold", "fmp_wti", "fiscal_debt_total",
                      "pmms_30yr", "eia_gasreg_w"):
            obs += [Observation(s.code, "2025-06-20", 100.0, "2026-07-07", s.source, "API"),
                    Observation(s.code, "2026-06-29", 110.0, "2026-07-07", s.source, "API")]
        else:
            obs += [Observation(s.code, m, 200.0 + i, "2026-07-07", s.source, "API")
                    for i, m in enumerate(months)]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_build_and_write_validates(tmp_path):
    conn = seed_full(tmp_path)
    _, series = load_registry()
    payload = official_pub.build(conn, series)
    assert len(payload["components"]) == 14
    assert len(payload["quotes"]) == 12
    groups = {q["group"] for q in payload["quotes"]}
    assert groups == {"grocery", "energy", "rates", "markets", "fiscal"}
    q = {q["code"]: q for q in payload["quotes"]}
    assert q["fmp_gold"]["yoy_pct"] == 10.0  # 110/100 - 1
    assert payload["headline"]["cpi"]["month"] == "2026-05-01"
    path = official_pub.write(payload, tmp_path / "out", "2026-07-07T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "official.schema.json")
    data = json.loads(path.read_text())
    assert data["published_at"] == "2026-07-07T12:00:00Z"
```

- [ ] **Step 3: RED**

Run: `pytest tests/test_official_writer.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/publish/official.py`**

```python
"""Writer for official.json — the interim dashboard's data (no gauge yet)."""
import json
from pathlib import Path

from pipeline.engine import official as engine

HEADLINE = ("CPIAUCNS", "CPILFENS")

SHORT_LABELS = {
    "CUUR0000SAF11": "Food at home", "CUUR0000SEFV": "Food away from home",
    "CUUR0000SAM": "Medical care", "CUUR0000SAA": "Apparel",
    "CUUR0000SAR": "Recreation", "CUUR0000SAE": "Education & comm",
    "CUUR0000SAG": "Other goods & services", "CUUR0000SETA01": "New vehicles",
    "CUUR0000SETA02": "Used cars & trucks", "CUUR0000SEHA": "Rent",
    "CUUR0000SEHC": "Owners' equiv. rent", "CUUR0000SEHF01": "Electricity (CPI)",
    "CUUR0000SEHF02": "Piped gas (CPI)", "CUUR0000SETB01": "Gasoline (CPI)",
}

QUOTES = {  # code -> (label, group, unit)
    "APU0000708111": ("Eggs, dozen", "grocery", "$"),
    "APU0000709112": ("Milk, gallon", "grocery", "$"),
    "APU0000702111": ("Bread, lb", "grocery", "$"),
    "APU0000703112": ("Ground chuck, lb", "grocery", "$"),
    "APU0000706111": ("Chicken, lb", "grocery", "$"),
    "APU0000711211": ("Bananas, lb", "grocery", "$"),
    "eia_gasreg_w": ("Gas, regular", "energy", "$/gal"),
    "eia_elec_res": ("Electricity", "energy", "¢/kWh"),
    "eia_ng_res": ("Natural gas", "energy", "$/Mcf"),
    "pmms_30yr": ("30yr mortgage", "rates", "%"),
    "fmp_gold": ("Gold", "markets", "$/oz"),
    "fmp_wti": ("WTI crude", "markets", "$/bbl"),
    "fiscal_debt_total": ("Total public debt", "fiscal", "$"),
}
# fiscal_debt_total makes 13 QUOTES entries; the schema count of 12 excludes none —
# see build(): all 13 rows publish; the writer test counts 12 grocery/energy/rates/markets
# plus fiscal via group set. (Task 2 Step 2 asserts len == 12 for the NON-headline,
# NON-component quotes only if debt is excluded — it is NOT: assert len == 13.)


def _round(x, nd=2):
    return None if x is None else round(x, nd)


def build(conn, series) -> dict:
    def headline_row(code):
        r = engine.latest_yoy(conn, code)
        return {"month": r["month"], "yoy_pct": round(r["yoy_pct"], 2),
                "prev_yoy_pct": round(r["prev_yoy_pct"], 2)}

    components = []
    for code, label in SHORT_LABELS.items():
        c = engine.component_summary(conn, code)
        components.append({"code": code, "label": label, "month": c["month"],
                           "yoy_pct": round(c["yoy_pct"], 2),
                           "mom_pct": round(c["mom_pct"], 2)})
    components.sort(key=lambda c: c["yoy_pct"], reverse=True)

    quotes = []
    for code, (label, group, unit) in QUOTES.items():
        q = engine.latest_quote(conn, code)
        quotes.append({"code": code, "label": label, "group": group, "unit": unit,
                       "latest": round(q["latest"], 2), "obs_date": q["obs_date"],
                       "yoy_pct": _round(q["yoy_pct"])})

    return {"headline": {"cpi": headline_row("CPIAUCNS"),
                         "core": headline_row("CPILFENS")},
            "components": components, "quotes": quotes}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "official.json"
    path.write_text(json.dumps({"published_at": published_at, **payload}, indent=2) + "\n")
    return path
```

**Correction locked here (self-review):** `QUOTES` has 13 entries (6 grocery + 3 energy + 1 rates + 2 markets + 1 fiscal). Task 2 Step 2's test must assert `len(payload["quotes"]) == 13`, not 12 — use 13 in the test. The stray comment block in the code above is NOT to be copied into the implementation (drop everything from `# fiscal_debt_total makes...` through `assert len == 13.)`).

- [ ] **Step 5: GREEN + full suite** (with the 13 correction applied in the test)

Run: `pytest tests/test_official_writer.py -v && pytest -q`
Expected: pass

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/official.py schemas/official.schema.json tests/test_official_writer.py
git commit -m "feat: official.json writer + schema — interim dashboard data"
```

---

### Task 3: Wire into `run_daily` + publish live

**Files:**
- Modify: `pipeline/run_daily.py`, `tests/test_published_data.py`, `tests/test_run_daily.py`
- Create (generated): `site/public/data/official.json`

**Interfaces:**
- Consumes: Task 2's writer; existing run_daily structure.
- Produces: `run_daily` publishes + validates `official.json` after `pulse_lite.json`; CONTRACT row added; the live artifact committed.

- [ ] **Step 1: Failing test updates** — in `tests/test_run_daily.py::test_end_to_end_all_sources`, append after the qa assertions:

```python
    official = json.loads((out / "official.json").read_text())
    assert len(official["components"]) == 14
    assert len(official["quotes"]) == 13
```

In `tests/test_published_data.py`, extend CONTRACT:

```python
CONTRACT = [("pulse_lite.json", "pulse_lite.schema.json"),
            ("qa.json", "qa.schema.json"),
            ("sources_status.json", "sources_status.schema.json"),
            ("official.json", "official.schema.json")]
```

Run: `pytest tests/test_run_daily.py -v` → RED (official.json not written).
Note: the integration test's FRED fixture only carries CPIAUCNS-shaped data — check what the registry-driven collection actually stores for the other 15 FRED codes under the fake: the lax fake returns the same fixture for every FRED id, so every CUUR code gets the same 6-row history (fixture has 2025-03..2026-04 rows) — `component_summary` needs latest, prior month, and 12-back base: fixture rows 2026-04 (latest), 2026-03 (prev), 2025-04 (base), 2025-03 (prev's base) all exist → succeeds. AP/BLS codes get the bls fixture (M05/M04 2026 + base?) — bls fixture has only 3 usable rows (2026-05, 2026-04 per series) — NO 2025 base → `latest_quote` (used for AP groceries) returns yoy None — fine (nullable). EIA/FMP/Zillow/PMMS/Treasury fixtures similar: latest_quote tolerates missing bases. So build() must succeed with yoy_pct None on thin fixtures — it does.

- [ ] **Step 2: Implement** — in `pipeline/run_daily.py`, import `from pipeline.publish import official as official_json` and after the pulse block add:

```python
    official_path = official_json.write(official_json.build(conn, series), args.out,
                                        published_at=published_at)
    validate.validate_file(official_path, SCHEMAS / "official.schema.json")
    print(f"published: {official_path}")
```

- [ ] **Step 3: GREEN + full suite**

Run: `pytest -q`
Expected: all pass

- [ ] **Step 4: Live publish**

```bash
cd ~/Development/macrogauge && export $(grep -v '^#' .env | xargs) \
  && python -m pipeline.run_daily --store store --out site/public/data
python3 -c "import json; d=json.load(open('site/public/data/official.json')); print(len(d['components']), 'components;', len(d['quotes']), 'quotes'); [print(f\"{c['label']:24s} {c['yoy_pct']:+.1f}%\") for c in d['components'][:5]]"
pytest tests/test_published_data.py -v
```
Expected: 14 components / 13 quotes with plausible YoY values; contract tests pass. Sanity-check 2-3 components against the recent CPI print narrative (shelter positive, used cars whatever it is — just confirm they're single-digit magnitudes).

- [ ] **Step 5: Commit (code + data)**

```bash
git add pipeline/run_daily.py tests/test_run_daily.py tests/test_published_data.py \
        site/public/data/ store/obs/
git commit -m "feat: publish official.json — interim dashboard data live"
```

---

### Task 4: Site components — DeltaChip, StatusPill, Section + format helpers

**Files:**
- Modify: `site/src/lib/format.ts`
- Create: `site/src/components/DeltaChip.tsx`, `site/src/components/StatusPill.tsx`, `site/src/components/Section.tsx`

**Interfaces:**
- Produces (format.ts additions): `fmtSigned(pct: number | null): string` (`+3.1%` / `−1.2%` / `—` for null, 1dp); `fmtMoney(v: number, unit: string): string` (`$4.13`, `$4,141`, `¢17.4` style: `$` unit → 2dp under 100 / 0dp with thousands separators at ≥100; `%` → 2dp + `%`; other units → 1-2dp + unit suffix); `yoyColor(pct: number | null): string` — `var(--accent-red)` when > 0.05, `var(--accent-emerald)` when < −0.05, `var(--muted)` otherwise/null.
- Produces: `DeltaChip({value, prefix?})` — small pill, dark bg, signed value colored by `yoyColor`; `StatusPill({ok, label})` — uppercase micro-badge, emerald dot/border when ok, red when not; `Section({title, children})` — 11px uppercase letter-spaced muted header + block.

- [ ] **Step 1: Implement** (site has no unit-test rig — verification is the Task 5 build + visual check; keep these exact)

Append to `site/src/lib/format.ts`:

```ts
/** +3.1% / −1.2% / — (1dp) */
export function fmtSigned(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const s = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${s}${Math.abs(pct).toFixed(1)}%`;
}

/** $4.13 · $4,141 · 17.4¢/kWh · 6.31% — display-only formatting */
export function fmtMoney(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "$") {
    return v >= 100
      ? `$${Math.round(v).toLocaleString("en-US")}`
      : `$${v.toFixed(2)}`;
  }
  return `${v.toFixed(2)} ${unit}`;
}

/** semantic: inflation hot = red, cooling = emerald, flat/unknown = muted */
export function yoyColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "var(--muted)";
  if (pct > 0.05) return "var(--accent-red)";
  if (pct < -0.05) return "var(--accent-emerald)";
  return "var(--muted)";
}
```

`site/src/components/DeltaChip.tsx`:

```tsx
import { fmtSigned, yoyColor } from "@/lib/format";

export function DeltaChip({ value, prefix }: { value: number | null; prefix?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        background: "rgba(139, 152, 165, 0.08)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        color: yoyColor(value),
        whiteSpace: "nowrap",
      }}
    >
      {prefix ? `${prefix} ` : ""}
      {fmtSigned(value)}
    </span>
  );
}
```

`site/src/components/StatusPill.tsx`:

```tsx
export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const color = ok ? "var(--accent-emerald)" : "var(--accent-red)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}
```

`site/src/components/Section.tsx`:

```tsx
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 32 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck via build** (page not rebuilt yet — components are unused; Next tree-shakes but tsc still checks)

Run: `cd site && npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/format.ts site/src/components/
git commit -m "feat: DeltaChip, StatusPill, Section + display format helpers"
```

---

### Task 5: Homepage rebuild

**Files:**
- Modify: `site/src/app/page.tsx`

**Interfaces:**
- Consumes: `official.json` (Task 3 shape), `qa.json`, `sources_status.json`, `pulse_lite.json`; components from Task 4 + existing `KpiCard`.

- [ ] **Step 1: Replace `site/src/app/page.tsx`**

```tsx
import official from "../../public/data/official.json";
import qa from "../../public/data/qa.json";
import status from "../../public/data/sources_status.json";
import { KpiCard } from "@/components/KpiCard";
import { DeltaChip } from "@/components/DeltaChip";
import { StatusPill } from "@/components/StatusPill";
import { Section } from "@/components/Section";
import { fmtMonth, fmtPct, fmtSigned, fmtMoney, yoyColor } from "@/lib/format";

const GROUP_TITLES: Record<string, string> = {
  grocery: "Grocery basket",
  energy: "Energy",
  rates: "Rates",
  markets: "Markets",
  fiscal: "Fiscal",
};

function QuoteCard({ q }: { q: (typeof official.quotes)[number] }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        flex: "1 1 150px",
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
        {q.label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          margin: "2px 0",
        }}
      >
        {fmtMoney(q.latest, q.unit)}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <DeltaChip value={q.yoy_pct} prefix="YoY" />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{q.obs_date}</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { cpi, core } = official.headline;
  const gas = official.quotes.find((q) => q.code === "eia_gasreg_w")!;
  const mortgage = official.quotes.find((q) => q.code === "pmms_30yr")!;
  const gold = official.quotes.find((q) => q.code === "fmp_gold")!;
  const debt = official.quotes.find((q) => q.code === "fiscal_debt_total")!;
  const groups = ["grocery", "energy", "rates", "markets", "fiscal"] as const;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
            macrogauge{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
              daily US inflation &amp; macro
            </span>
          </h1>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            published {official.published_at} · official data · gauge coming in phase 1b
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <StatusPill ok={true} label={`CPI ${fmtPct(cpi.yoy_pct)}`} />
          <StatusPill
            ok={qa.passed === qa.total}
            label={`Self-test ${qa.passed}/${qa.total}`}
          />
        </div>
      </header>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)}`}
          accent="amber"
        />
        <KpiCard
          label="Core CPI · YoY"
          value={fmtPct(core.yoy_pct)}
          context={`${fmtMonth(core.month)} print · prev ${fmtPct(core.prev_yoy_pct)}`}
          accent="amber"
        />
        <KpiCard
          label="Gas · regular"
          value={fmtMoney(gas.latest, gas.unit)}
          context={`${fmtSigned(gas.yoy_pct)} YoY · wk of ${gas.obs_date}`}
          accent="sky"
        />
        <KpiCard
          label="30yr mortgage"
          value={fmtMoney(mortgage.latest, mortgage.unit)}
          context={`${fmtSigned(mortgage.yoy_pct)} YoY · ${mortgage.obs_date}`}
          accent="sky"
        />
        <KpiCard
          label="Gold"
          value={fmtMoney(gold.latest, gold.unit)}
          context={`${fmtSigned(gold.yoy_pct)} YoY · ${gold.obs_date}`}
          accent="violet"
        />
        <KpiCard
          label="Public debt"
          value={`$${(debt.latest / 1e12).toFixed(2)}T`}
          context={`${fmtSigned(debt.yoy_pct)} YoY · ${debt.obs_date}`}
          accent="violet"
        />
      </div>

      <Section title={`Official CPI components — YoY (${fmtMonth(cpi.month)} print)`}>
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
                {["Component", "YoY", "MoM"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? "left" : "right",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      fontWeight: 500,
                      padding: "10px 16px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {official.components.map((c) => (
                <tr key={c.code}>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {c.label}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "right",
                      color: yoyColor(c.yoy_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.yoy_pct)}
                  </td>
                  <td
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      textAlign: "right",
                      color: yoyColor(c.mom_pct),
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {fmtSigned(c.mom_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {groups.map((g) => (
        <Section key={g} title={GROUP_TITLES[g]}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {official.quotes
              .filter((q) => q.group === g)
              .map((q) => (
                <QuoteCard key={q.code} q={q} />
              ))}
          </div>
        </Section>
      ))}

      <Section title="Sources">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.sources.map((s) => (
            <StatusPill
              key={s.name}
              ok={s.ok}
              label={`${s.name} · ${s.latest_obs ?? "never"}`}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          All figures from official/public sources (BLS, FRED, EIA, Zillow, Freddie
          Mac, U.S. Treasury, FMP) — collected daily, published with as-of dates. The
          independent macrogauge index arrives in phase 1b.
        </div>
      </Section>
    </main>
  );
}
```

- [ ] **Step 2: Build + verify**

```bash
cd ~/Development/macrogauge/site && npm run build \
  && grep -c "Official CPI components" out/index.html \
  && grep -o "Grocery basket" out/index.html | head -1
```
Expected: build succeeds; both greps hit.

- [ ] **Step 3: Serve for the controller's visual check**

```bash
python3 -m http.server 3402 -d out &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3402/
kill %1
```
Expected: 200. (The controller takes the screenshot after this task.)

- [ ] **Step 4: Commit**

```bash
cd ~/Development/macrogauge
git add site/src/app/page.tsx
git commit -m "feat: interim official-data dashboard homepage"
```

---

### Task 6: Ship + verify production

**Files:** none (push + deploy verification)

- [ ] **Step 1:** `git push` → CI green (`gh run list --workflow ci --limit 1` until completed/success) → Vercel deploy for HEAD reaches success (GitHub deployments API).
- [ ] **Step 2:** Controller eyeballs production (screenshot) against the design tokens + this plan's layout.
- [ ] **Step 3:** Ledger the phase.

## Self-review notes (completed)

- Quote count: 13 (6+3+1+2+1) — Task 2 Step 2 and Task 3 Step 1 tests both assert 13; the writer code block's stray explanatory comment is marked DO-NOT-COPY.
- Type consistency: `official.components[].{code,label,month,yoy_pct,mom_pct}` matches page.tsx accesses; `quotes[].{code,label,group,unit,latest,obs_date,yoy_pct}` matches QuoteCard + finds; nullable `yoy_pct` handled by `fmtSigned(null) → "—"` and `yoyColor(null) → muted`.
- Engine names: writer imports `pipeline.engine.official as engine`; run_daily imports writer as `official_json` — no module shadowing at import sites.
- Thin-fixture integration path traced (Task 3 Step 1 note): component_summary succeeds on the shared FRED fixture; latest_quote returns None YoY on baseless fixtures — schema allows null.
- `fmtPct` (existing, 1dp) reused for headline; `toLocaleString` only in fmtMoney (client-safe, static render deterministic for en-US).
