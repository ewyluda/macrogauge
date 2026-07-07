# macrogauge Phase 0 — Skeleton Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the entire daily publish loop end-to-end — cron → FRED connector → vintage store → trivial engine → JSON contract → Next.js static build → Vercel deploy → commit-back — with a placeholder homepage showing one real KPI (official CPI YoY).

**Architecture:** New standalone monorepo (`~/Development/macrogauge`): `pipeline/` (Python 3.12) produces JSON into `site/public/data/`, `site/` (Next.js static export) formats it, `.github/workflows/daily.yml` runs the loop on an ET-gated cron and commits data back; Vercel Git integration deploys each push to main. The JSON contract is the only pipeline→site interface.

**Tech Stack:** Python 3.12 (requests + jsonschema only), pytest, Next.js 15 (App Router, `output: 'export'`), TypeScript, GitHub Actions, Vercel.

**Spec:** `docs/macrogauge-design.md` in the new repo (copied from notebook `docs/superpowers/specs/2026-07-07-macrogauge-design.md`). This plan implements spec §10 Phase 0. The Phase 1 plan is written after this plan executes.

## Global Constraints

- Pipeline dependencies: `requests` and `jsonschema` only (+ `pytest` dev). Everything else stdlib.
- Site: Next.js static export only — `output: 'export'`, no server runtime, no live fetches; data is imported at build time from `site/public/data/`.
- The site never computes analytics — the pipeline publishes final numbers; the browser formats.
- Every published JSON has a JSON Schema in `schemas/` and exactly one writer module; files are validated before publish.
- Publication never blocks on QA — QA results are published, not enforced.
- Vintage store is append-only JSONL partitioned by vintage month (`store/obs/YYYY-MM.jsonl`); re-published values append a new vintage row, never overwrite.
- Design tokens (hard rule): bg `#0B0F14`, card `#11161C`, border `#1E2630`, text `#E6EDF3`, muted `#8B98A5`; accents sky `#38BDF8` (ours), amber `#F59E0B` (official), red `#F87171`, emerald `#34D399`, violet `#A78BFA`; radius 10px; system font; uppercase 11px micro-labels; tabular numerals. Semantic mapping: blue = ours, amber = official.
- All dates in data are `YYYY-MM-DD` strings; scheduling decisions use ET (`America/New_York`).
- Commit messages: conventional prefixes (`feat:`, `fix:`, `chore:`, `data:`, `ci:`, `test:`, `docs:`).
- **Deviation from spec §2/§11, locked here:** data commits do NOT use `[skip ci]` — Vercel skips deployments for `[skip ci]` commits, which would kill the deploy. There is no Actions loop to guard against because `daily.yml` has no `push` trigger; `ci.yml` running on data commits is harmless (it re-validates).

---

### Task 1: Repo scaffold

**Files:**
- Create: `~/Development/macrogauge/` (git repo), `README.md`, `.gitignore`, `pyproject.toml`, `pipeline/__init__.py`, `pipeline/connectors/__init__.py`, `pipeline/store/__init__.py`, `pipeline/engine/__init__.py`, `pipeline/publish/__init__.py`, `tests/__init__.py`, `docs/macrogauge-design.md` (copied), `docs/plans/2026-07-07-phase-0-skeleton.md` (this file, copied)

**Interfaces:**
- Produces: importable `pipeline` package, installable with `pip install -e ".[dev]"`; GitHub repo `macrogauge` (private) with `main` pushed.

- [ ] **Step 1: Create the repo skeleton**

```bash
mkdir -p ~/Development/macrogauge && cd ~/Development/macrogauge
git init -b main
mkdir -p pipeline/connectors pipeline/store pipeline/engine pipeline/publish \
         tests/fixtures schemas site docs .github/workflows store/obs
touch pipeline/__init__.py pipeline/connectors/__init__.py pipeline/store/__init__.py \
      pipeline/engine/__init__.py pipeline/publish/__init__.py tests/__init__.py
cp ~/Development/notebook/docs/superpowers/specs/2026-07-07-macrogauge-design.md docs/macrogauge-design.md
mkdir -p docs/plans
cp ~/Development/notebook/docs/superpowers/plans/2026-07-07-macrogauge-phase-0-skeleton.md docs/plans/2026-07-07-phase-0-skeleton.md
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
__pycache__/
*.egg-info/
.venv/
.env
.pytest_cache/
node_modules/
site/.next/
site/out/
.vercel
.DS_Store
```

- [ ] **Step 3: Write `pyproject.toml`**

```toml
[project]
name = "macrogauge"
version = "0.1.0"
description = "Daily US inflation/macro gauge pipeline + static site"
requires-python = ">=3.12"
dependencies = ["requests>=2.32", "jsonschema>=4.23"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["pipeline*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 4: Write `README.md`**

```markdown
# macrogauge

Daily-updated US inflation/macro analytics: an independent gauge that re-prices the CPI
basket from live market data, published as a static site over pre-baked JSON.

- `pipeline/` — Python collector → vintage store → engine → JSON publisher (+ QA self-test)
- `site/` — Next.js static export; reads `site/public/data/*.json`, computes nothing
- `store/obs/` — append-only vintage observation log (JSONL, monthly partitions)
- `schemas/` — JSON Schema per published file, validated in CI and before every publish
- Design spec: `docs/macrogauge-design.md`

Daily run: `.github/workflows/daily.yml` (8:40 AM ET weekdays) → commits data → Vercel deploys.

Local run: `FRED_API_KEY=... python -m pipeline.run_daily --store store --out site/public/data`
```

- [ ] **Step 5: Install and verify import**

```bash
cd ~/Development/macrogauge
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" -q
python -c "import pipeline; print('ok')"
```
Expected: `ok`

- [ ] **Step 6: Commit and create the GitHub repo**

```bash
git add -A
git commit -m "chore: repo scaffold — pipeline package, spec, plan"
gh repo create macrogauge --private --source . --push
```
Expected: repo pushed; `gh repo view macrogauge --json url` returns the URL.

---

### Task 2: Observation model + vintage store append

**Files:**
- Create: `pipeline/models.py`, `pipeline/store/vintage.py`
- Test: `tests/test_vintage.py`

**Interfaces:**
- Produces: `Observation(series_code, obs_date, value, vintage_date, source, route)` frozen dataclass (all `str` except `value: float`), in `pipeline.models`.
- Produces: `vintage.append(observations: list[Observation], store_dir: Path) -> int` — appends to `store_dir/obs/<vintage YYYY-MM>.jsonl`, one JSON object per line with exactly the six field names above; skips an observation if the latest stored row for its `(series_code, obs_date)` has the same `value`; returns rows written.

- [ ] **Step 1: Write the failing tests**

`tests/test_vintage.py`:
```python
import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.store import vintage


def obs(code="CPIAUCNS", date="2026-05-01", value=320.5, vintage="2026-07-07"):
    return Observation(series_code=code, obs_date=date, value=value,
                       vintage_date=vintage, source="FRED", route="API")


def test_append_writes_monthly_partition(tmp_path):
    n = vintage.append([obs()], tmp_path)
    assert n == 1
    part = tmp_path / "obs" / "2026-07.jsonl"
    assert part.exists()
    row = json.loads(part.read_text().strip())
    assert row == {"series_code": "CPIAUCNS", "obs_date": "2026-05-01",
                   "value": 320.5, "vintage_date": "2026-07-07",
                   "source": "FRED", "route": "API"}


def test_append_dedupes_same_value(tmp_path):
    vintage.append([obs()], tmp_path)
    n = vintage.append([obs(vintage="2026-07-08")], tmp_path)  # same value, new day
    assert n == 0
    lines = (tmp_path / "obs" / "2026-07.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1


def test_append_keeps_revisions(tmp_path):
    vintage.append([obs(value=320.5)], tmp_path)
    n = vintage.append([obs(value=321.0, vintage="2026-08-02")], tmp_path)
    assert n == 1
    assert (tmp_path / "obs" / "2026-08.jsonl").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_vintage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.models'`

- [ ] **Step 3: Implement `pipeline/models.py`**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Observation:
    """One value for one series, stamped with the date we learned it."""
    series_code: str
    obs_date: str      # YYYY-MM-DD the observation refers to
    value: float
    vintage_date: str  # YYYY-MM-DD we learned this value
    source: str        # e.g. "FRED"
    route: str         # e.g. "API" | "CSV" | "SCRAPE"
```

- [ ] **Step 4: Implement `pipeline/store/vintage.py` (append half)**

```python
"""Append-only vintage observation store: JSONL partitioned by vintage month.

Re-published values append a new vintage row — never overwrite. History
can't be silently rewritten; git is the audit trail.
"""
import json
from dataclasses import asdict
from pathlib import Path

from pipeline.models import Observation

OBS_SUBDIR = "obs"


def _partitions(store_dir: Path) -> list[Path]:
    d = store_dir / OBS_SUBDIR
    return sorted(d.glob("*.jsonl")) if d.exists() else []


def _latest_values(store_dir: Path) -> dict[tuple[str, str], float]:
    """Latest stored value per (series_code, obs_date), by vintage then file order."""
    latest: dict[tuple[str, str], float] = {}
    latest_vintage: dict[tuple[str, str], str] = {}
    for part in _partitions(store_dir):
        for line in part.read_text().splitlines():
            row = json.loads(line)
            key = (row["series_code"], row["obs_date"])
            if key not in latest_vintage or row["vintage_date"] >= latest_vintage[key]:
                latest_vintage[key] = row["vintage_date"]
                latest[key] = row["value"]
    return latest


def append(observations: list[Observation], store_dir: Path) -> int:
    """Append observations whose value differs from the latest stored one."""
    latest = _latest_values(store_dir)
    written = 0
    for o in observations:
        if latest.get((o.series_code, o.obs_date)) == o.value:
            continue
        part = store_dir / OBS_SUBDIR / f"{o.vintage_date[:7]}.jsonl"
        part.parent.mkdir(parents=True, exist_ok=True)
        with part.open("a") as f:
            f.write(json.dumps(asdict(o), sort_keys=True) + "\n")
        latest[(o.series_code, o.obs_date)] = o.value
        written += 1
    return written
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_vintage.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/models.py pipeline/store/vintage.py tests/test_vintage.py
git commit -m "feat: observation model + append-only vintage store"
```

---

### Task 3: Vintage store load + latest-vintage query

**Files:**
- Modify: `pipeline/store/vintage.py`
- Test: `tests/test_vintage.py` (add cases)

**Interfaces:**
- Consumes: partitions written by `vintage.append` (Task 2).
- Produces: `vintage.load(store_dir: Path) -> sqlite3.Connection` — in-memory SQLite, table `observations(series_code, obs_date, value, vintage_date, source, route)`.
- Produces: `vintage.latest(conn, series_code: str) -> list[tuple[str, float]]` — `(obs_date, value)` ascending by date, latest vintage wins per obs_date.
- Produces: `vintage.max_vintage(conn, series_code: str) -> str` — most recent vintage_date for the series.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_vintage.py`)

```python
def test_load_and_latest_vintage_wins(tmp_path):
    vintage.append([obs(date="2026-04-01", value=319.0),
                    obs(date="2026-05-01", value=320.5)], tmp_path)
    vintage.append([obs(date="2026-04-01", value=319.2, vintage="2026-08-02")], tmp_path)
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "CPIAUCNS") == [("2026-04-01", 319.2),
                                                ("2026-05-01", 320.5)]
    assert vintage.max_vintage(conn, "CPIAUCNS") == "2026-08-02"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_vintage.py::test_load_and_latest_vintage_wins -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'load'`

- [ ] **Step 3: Implement load/latest/max_vintage** (append to `pipeline/store/vintage.py`)

```python
import sqlite3


def load(store_dir: Path) -> sqlite3.Connection:
    """Load all partitions into an in-memory SQLite database."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE observations (
        series_code TEXT, obs_date TEXT, value REAL,
        vintage_date TEXT, source TEXT, route TEXT)""")
    conn.execute("CREATE INDEX idx_series ON observations (series_code, obs_date)")
    for part in _partitions(store_dir):
        rows = [json.loads(line) for line in part.read_text().splitlines()]
        conn.executemany(
            "INSERT INTO observations VALUES "
            "(:series_code, :obs_date, :value, :vintage_date, :source, :route)", rows)
    conn.commit()
    return conn


def latest(conn: sqlite3.Connection, series_code: str) -> list[tuple[str, float]]:
    """(obs_date, value) ascending; latest vintage wins per obs_date."""
    return conn.execute("""
        SELECT obs_date, value FROM (
            SELECT obs_date, value, ROW_NUMBER() OVER (
                PARTITION BY obs_date ORDER BY vintage_date DESC, rowid DESC) rn
            FROM observations WHERE series_code = ?)
        WHERE rn = 1 ORDER BY obs_date""", (series_code,)).fetchall()


def max_vintage(conn: sqlite3.Connection, series_code: str) -> str:
    row = conn.execute("SELECT MAX(vintage_date) FROM observations WHERE series_code = ?",
                       (series_code,)).fetchone()
    return row[0]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_vintage.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/store/vintage.py tests/test_vintage.py
git commit -m "feat: vintage store load + latest-vintage-wins query"
```

---

### Task 4: FRED connector

**Files:**
- Create: `pipeline/connectors/fred.py`, `tests/fixtures/fred_cpiaucns.json`
- Test: `tests/test_fred.py`

**Interfaces:**
- Consumes: `Observation` from `pipeline.models`.
- Produces: `fred.fetch(series_ids: list[str], api_key: str, observation_start: str = "2017-01-01", vintage_date: str | None = None, http_get=None) -> list[Observation]`. `http_get` defaults to `requests.get` (injectable for tests); `vintage_date` defaults to today in ET. Missing values (`"."`) are skipped. `source="FRED"`, `route="API"`.
- Produces: `fred.today_et() -> str` — today's date in `America/New_York` as `YYYY-MM-DD` (reused by later tasks).

- [ ] **Step 1: Write the fixture** — `tests/fixtures/fred_cpiaucns.json` (real FRED response shape):

```json
{
  "realtime_start": "2026-07-07",
  "realtime_end": "2026-07-07",
  "observation_start": "2017-01-01",
  "observation_end": "9999-12-31",
  "units": "lin",
  "count": 4,
  "observations": [
    {"realtime_start": "2026-07-07", "realtime_end": "2026-07-07", "date": "2025-04-01", "value": "312.900"},
    {"realtime_start": "2026-07-07", "realtime_end": "2026-07-07", "date": "2025-05-01", "value": "313.500"},
    {"realtime_start": "2026-07-07", "realtime_end": "2026-07-07", "date": "2026-04-01", "value": "320.100"},
    {"realtime_start": "2026-07-07", "realtime_end": "2026-07-07", "date": "2026-05-01", "value": "."}
  ]
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_fred.py`:

```python
import json
from pathlib import Path

from pipeline.connectors import fred

FIXTURE = Path(__file__).parent / "fixtures" / "fred_cpiaucns.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["series_id"] == "CPIAUCNS"
    assert params["api_key"] == "test-key"
    assert params["file_type"] == "json"
    assert params["observation_start"] == "2017-01-01"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_parses_and_skips_missing():
    obs = fred.fetch(["CPIAUCNS"], "test-key", vintage_date="2026-07-07",
                     http_get=fake_get)
    assert len(obs) == 3  # the "." row is skipped
    first = obs[0]
    assert (first.series_code, first.obs_date, first.value) == ("CPIAUCNS", "2025-04-01", 312.9)
    assert (first.vintage_date, first.source, first.route) == ("2026-07-07", "FRED", "API")


def test_today_et_format():
    assert len(fred.today_et()) == 10  # YYYY-MM-DD
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_fred.py -v`
Expected: FAIL — `ImportError: cannot import name 'fred'` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/fred.py`**

```python
"""FRED connector — https://fred.stlouisfed.org/docs/api/fred/series_observations.html"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.models import Observation

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


def today_et() -> str:
    return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


def fetch(series_ids: list[str], api_key: str, observation_start: str = "2017-01-01",
          vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sid in series_ids:
        resp = http_get(FRED_URL, params={
            "series_id": sid, "api_key": api_key, "file_type": "json",
            "observation_start": observation_start}, timeout=30)
        resp.raise_for_status()
        for row in resp.json()["observations"]:
            if row["value"] == ".":
                continue
            out.append(Observation(series_code=sid, obs_date=row["date"],
                                   value=float(row["value"]), vintage_date=vintage,
                                   source="FRED", route="API"))
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_fred.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/fred.py tests/test_fred.py tests/fixtures/fred_cpiaucns.json
git commit -m "feat: FRED connector with injectable http + recorded fixture"
```

---

### Task 5: Trivial engine — official CPI YoY

**Files:**
- Create: `pipeline/engine/official.py`
- Test: `tests/test_official.py`

**Interfaces:**
- Consumes: `vintage.load`/`vintage.latest`/`vintage.max_vintage` (Task 3).
- Produces: `official.latest_yoy(conn, series_code: str) -> dict` with keys `series_code: str`, `month: str` (obs_date of latest observation), `yoy_pct: float` (unrounded, e.g. 2.6910299...), `prev_yoy_pct: float` (prior month's YoY), `as_of: str` (max vintage_date). Raises `ValueError` if the 12-months-earlier observation is missing.

- [ ] **Step 1: Write the failing tests** — `tests/test_official.py`:

```python
import pytest

from pipeline.engine import official
from pipeline.models import Observation
from pipeline.store import vintage


def seed(tmp_path, rows):
    obs = [Observation(series_code="CPIAUCNS", obs_date=d, value=v,
                       vintage_date="2026-07-07", source="FRED", route="API")
           for d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_latest_yoy_hand_computed(tmp_path):
    conn = seed(tmp_path, [("2025-05-01", 300.0), ("2025-06-01", 301.0),
                           ("2026-05-01", 307.5), ("2026-06-01", 309.1)])
    r = official.latest_yoy(conn, "CPIAUCNS")
    assert r["series_code"] == "CPIAUCNS"
    assert r["month"] == "2026-06-01"
    assert r["yoy_pct"] == pytest.approx((309.1 / 301.0 - 1) * 100)   # 2.6910...
    assert r["prev_yoy_pct"] == pytest.approx((307.5 / 300.0 - 1) * 100)  # 2.5
    assert r["as_of"] == "2026-07-07"


def test_missing_base_month_raises(tmp_path):
    conn = seed(tmp_path, [("2026-06-01", 309.1)])
    with pytest.raises(ValueError):
        official.latest_yoy(conn, "CPIAUCNS")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_official.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 3: Implement `pipeline/engine/official.py`**

```python
"""Trivial Phase-0 engine: YoY from the latest official monthly index print."""
import sqlite3

from pipeline.store import vintage


def _months_back(obs_date: str, n: int) -> str:
    """First-of-month date n months before obs_date (FRED monthly dates are YYYY-MM-01)."""
    year, month = int(obs_date[:4]), int(obs_date[5:7])
    total = year * 12 + (month - 1) - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}-01"


def latest_yoy(conn: sqlite3.Connection, series_code: str) -> dict:
    series = dict(vintage.latest(conn, series_code))
    if not series:
        raise ValueError(f"no observations for {series_code}")
    month = max(series)

    def yoy(m: str) -> float:
        base = _months_back(m, 12)
        if base not in series:
            raise ValueError(f"missing base month {base} for {series_code}")
        return (series[m] / series[base] - 1) * 100

    prev_month = _months_back(month, 1)
    if prev_month not in series:
        raise ValueError(f"missing prior month {prev_month} for {series_code}")
    return {"series_code": series_code, "month": month, "yoy_pct": yoy(month),
            "prev_yoy_pct": yoy(prev_month),
            "as_of": vintage.max_vintage(conn, series_code)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_official.py -v`
Expected: 2 passed
(Note: the hand-computed test seeds 4 months including both bases, so `prev_month` exists; the missing-base test has neither base nor prior month and raises on the base check.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/official.py tests/test_official.py
git commit -m "feat: trivial engine — official CPI YoY with as-of vintage"
```

---

### Task 6: pulse_lite writer + JSON Schemas + validator

**Files:**
- Create: `pipeline/publish/pulse_lite.py`, `pipeline/publish/validate.py`, `schemas/pulse_lite.schema.json`, `schemas/qa.schema.json`
- Test: `tests/test_pulse_lite.py`

**Interfaces:**
- Consumes: the `latest_yoy` result dict (Task 5).
- Produces: `pulse_lite.write(cpi: dict, out_dir: Path, published_at: str) -> Path` — writes `out_dir/pulse_lite.json`: `{"published_at": ..., "official_cpi": {"series_code", "month", "yoy_pct" (rounded 2dp), "prev_yoy_pct" (rounded 2dp), "as_of"}}`.
- Produces: `validate.validate_file(json_path: Path, schema_path: Path) -> None` — raises `jsonschema.ValidationError` on mismatch.
- Produces: `schemas/pulse_lite.schema.json` and `schemas/qa.schema.json` (used by Task 7 and CI).

- [ ] **Step 1: Write the schemas**

`schemas/pulse_lite.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "pulse_lite",
  "type": "object",
  "required": ["published_at", "official_cpi"],
  "additionalProperties": false,
  "properties": {
    "published_at": {"type": "string"},
    "official_cpi": {
      "type": "object",
      "required": ["series_code", "month", "yoy_pct", "prev_yoy_pct", "as_of"],
      "additionalProperties": false,
      "properties": {
        "series_code": {"type": "string"},
        "month": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
        "yoy_pct": {"type": "number"},
        "prev_yoy_pct": {"type": "number"},
        "as_of": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
      }
    }
  }
}
```

`schemas/qa.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "qa",
  "type": "object",
  "required": ["generated_at", "passed", "total", "checks"],
  "additionalProperties": false,
  "properties": {
    "generated_at": {"type": "string"},
    "passed": {"type": "integer"},
    "total": {"type": "integer"},
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "pass", "critical", "detail"],
        "additionalProperties": false,
        "properties": {
          "name": {"type": "string"},
          "pass": {"type": "boolean"},
          "critical": {"type": "boolean"},
          "detail": {"type": "string"}
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_pulse_lite.py`:

```python
from pathlib import Path

import jsonschema
import pytest

from pipeline.publish import pulse_lite, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

CPI = {"series_code": "CPIAUCNS", "month": "2026-05-01",
       "yoy_pct": 2.691029900332226, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_write_rounds_and_validates(tmp_path):
    path = pulse_lite.write(CPI, tmp_path, published_at="2026-07-07T12:40:00Z")
    assert path == tmp_path / "pulse_lite.json"
    validate.validate_file(path, SCHEMAS / "pulse_lite.schema.json")
    import json
    data = json.loads(path.read_text())
    assert data["official_cpi"]["yoy_pct"] == 2.69
    assert data["published_at"] == "2026-07-07T12:40:00Z"


def test_validate_rejects_bad_file(tmp_path):
    bad = tmp_path / "pulse_lite.json"
    bad.write_text('{"published_at": "x"}')
    with pytest.raises(jsonschema.ValidationError):
        validate.validate_file(bad, SCHEMAS / "pulse_lite.schema.json")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_pulse_lite.py -v`
Expected: FAIL — `ImportError` (modules missing)

- [ ] **Step 4: Implement**

`pipeline/publish/validate.py`:
```python
import json
from pathlib import Path

import jsonschema


def validate_file(json_path: Path, schema_path: Path) -> None:
    """Raise jsonschema.ValidationError if json_path doesn't match schema_path."""
    jsonschema.validate(json.loads(json_path.read_text()),
                        json.loads(schema_path.read_text()))
```

`pipeline/publish/pulse_lite.py`:
```python
"""Writer for pulse_lite.json — Phase 0's single daily-state file."""
import json
from pathlib import Path


def write(cpi: dict, out_dir: Path, published_at: str) -> Path:
    payload = {
        "published_at": published_at,
        "official_cpi": {
            "series_code": cpi["series_code"],
            "month": cpi["month"],
            "yoy_pct": round(cpi["yoy_pct"], 2),
            "prev_yoy_pct": round(cpi["prev_yoy_pct"], 2),
            "as_of": cpi["as_of"],
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pulse_lite.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_pulse_lite.py -v`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/pulse_lite.py pipeline/publish/validate.py schemas/ tests/test_pulse_lite.py
git commit -m "feat: pulse_lite writer + JSON schemas + validator"
```

---

### Task 7: QA self-test v0

**Files:**
- Create: `pipeline/publish/qa.py`
- Test: `tests/test_qa.py`

**Interfaces:**
- Consumes: the `latest_yoy` result dict (Task 5); `schemas/qa.schema.json` (Task 6).
- Produces: `qa.run_checks(cpi: dict, today: str) -> dict` — `{"generated_at": today, "passed": int, "total": int, "checks": [{"name", "pass", "critical", "detail"}]}` with two checks: `headline_current` (latest month within 75 days of `today`, critical) and `yoy_finite` (yoy_pct and prev_yoy_pct are finite numbers, critical).
- Produces: `qa.write(result: dict, out_dir: Path) -> Path` — writes `out_dir/qa.json`.

- [ ] **Step 1: Write the failing tests** — `tests/test_qa.py`:

```python
from pathlib import Path

from pipeline.publish import qa, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

FRESH = {"series_code": "CPIAUCNS", "month": "2026-05-01",
         "yoy_pct": 2.69, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_all_green_when_fresh():
    r = qa.run_checks(FRESH, today="2026-07-07")
    assert (r["passed"], r["total"]) == (2, 2)
    assert all(c["pass"] for c in r["checks"])


def test_stale_headline_fails():
    r = qa.run_checks(FRESH, today="2026-10-01")  # 153 days after 2026-05-01
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["headline_current"]["pass"] is False
    assert r["passed"] == 1


def test_nan_yoy_fails():
    r = qa.run_checks({**FRESH, "yoy_pct": float("nan")}, today="2026-07-07")
    by_name = {c["name"]: c for c in r["checks"]}
    assert by_name["yoy_finite"]["pass"] is False


def test_write_validates_against_schema(tmp_path):
    path = qa.write(qa.run_checks(FRESH, today="2026-07-07"), tmp_path)
    validate.validate_file(path, SCHEMAS / "qa.schema.json")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_qa.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 3: Implement `pipeline/publish/qa.py`**

```python
"""QA self-test v0 — results are published, never block publication."""
import json
import math
from datetime import date
from pathlib import Path

STALE_DAYS = 75  # a monthly CPI print should never be older than this


def run_checks(cpi: dict, today: str) -> dict:
    age = (date.fromisoformat(today) - date.fromisoformat(cpi["month"])).days
    checks = [
        {"name": "headline_current", "critical": True,
         "pass": age <= STALE_DAYS,
         "detail": f"latest official month {cpi['month']} is {age}d old (limit {STALE_DAYS})"},
        {"name": "yoy_finite", "critical": True,
         "pass": math.isfinite(cpi["yoy_pct"]) and math.isfinite(cpi["prev_yoy_pct"]),
         "detail": f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"},
    ]
    return {"generated_at": today, "passed": sum(c["pass"] for c in checks),
            "total": len(checks), "checks": checks}


def write(result: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "qa.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    return path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_qa.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/publish/qa.py tests/test_qa.py
git commit -m "feat: QA self-test v0 — freshness + finiteness checks"
```

---

### Task 8: run_daily orchestrator + seed data

**Files:**
- Create: `pipeline/run_daily.py`
- Test: `tests/test_run_daily.py`, `tests/test_published_data.py`
- Create (generated): `site/public/data/pulse_lite.json`, `site/public/data/qa.json`, `store/obs/2026-07.jsonl`

**Interfaces:**
- Consumes: everything from Tasks 2–7 (exact signatures as specified there).
- Produces: `python -m pipeline.run_daily --store <dir> --out <dir>` CLI (env `FRED_API_KEY` required); `run_daily.main(argv=None, http_get=None) -> int`. Writes and validates `pulse_lite.json` + `qa.json`; prints one summary line per artifact.
- Produces: committed seed data so CI and the site build have real numbers before the first scheduled run.

- [ ] **Step 1: Write the failing integration test** — `tests/test_run_daily.py`:

```python
import json
from pathlib import Path

from pipeline import run_daily
from tests.test_fred import fake_get  # reuses the recorded fixture


def test_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)], http_get=fake_get)
    assert rc == 0
    pulse = json.loads((out / "pulse_lite.json").read_text())
    # fixture: 2026-04-01=320.100 vs 2025-04-01=312.900 -> 2.30%
    assert pulse["official_cpi"]["month"] == "2026-04-01"
    assert pulse["official_cpi"]["yoy_pct"] == 2.3
    qa = json.loads((out / "qa.json").read_text())
    assert qa["total"] == 2
    assert (store / "obs").exists()
```

And `tests/test_published_data.py` (guards the committed seed data forever):

```python
"""Validate committed published data against schemas — runs in CI on every push."""
from pathlib import Path

import pytest

from pipeline.publish import validate

ROOT = Path(__file__).parent.parent
DATA = ROOT / "site" / "public" / "data"
SCHEMAS = ROOT / "schemas"

CONTRACT = [("pulse_lite.json", "pulse_lite.schema.json"),
            ("qa.json", "qa.schema.json")]


@pytest.mark.parametrize("data_file,schema_file", CONTRACT)
def test_published_file_matches_schema(data_file, schema_file):
    path = DATA / data_file
    if not path.exists():
        pytest.skip(f"{data_file} not published yet")
    validate.validate_file(path, SCHEMAS / schema_file)
```

- [ ] **Step 2: Run tests to verify the integration test fails**

Run: `pytest tests/test_run_daily.py -v`
Expected: FAIL — `ImportError` (module missing). (`test_published_data.py` skips — nothing published yet.)

- [ ] **Step 3: Implement `pipeline/run_daily.py`**

```python
"""Daily publish run: collect -> store -> engine -> write JSONs -> validate.

Failures in this Phase-0 version abort the run (single source). From Phase 1,
per-connector failures are isolated and lower coverage instead.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pipeline.connectors import fred
from pipeline.engine import official
from pipeline.publish import pulse_lite, qa, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"
SERIES = ["CPIAUCNS"]  # official CPI-U NSA — headline YoY as printed


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser(description="macrogauge daily publish run")
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    api_key = os.environ["FRED_API_KEY"]
    observations = fred.fetch(SERIES, api_key, http_get=http_get)
    written = vintage.append(observations, args.store)
    print(f"store: {len(observations)} fetched, {written} new rows")

    conn = vintage.load(args.store)
    cpi = official.latest_yoy(conn, "CPIAUCNS")

    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pulse_path = pulse_lite.write(cpi, args.out, published_at=published_at)
    validate.validate_file(pulse_path, SCHEMAS / "pulse_lite.schema.json")
    print(f"published: {pulse_path} (CPI YoY {round(cpi['yoy_pct'], 2)}%, month {cpi['month']})")

    qa_path = qa.write(qa.run_checks(cpi, today=fred.today_et()), args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest -q`
Expected: all tests pass (published-data tests skip)

- [ ] **Step 5: Get a FRED API key if not already held** (user action — free, instant):
https://fredaccount.stlouisfed.org/apikeys → create key. Keep it out of the repo.

- [ ] **Step 6: Live seed run** (real key, real data):

```bash
cd ~/Development/macrogauge
FRED_API_KEY=<your-key> python -m pipeline.run_daily --store store --out site/public/data
cat site/public/data/pulse_lite.json
pytest tests/test_published_data.py -v
```
Expected: pulse_lite.json shows the current official CPI YoY (sanity-check the number against the last CPI print); published-data tests now run and pass.

- [ ] **Step 7: Commit (code + seed data)**

```bash
git add pipeline/run_daily.py tests/test_run_daily.py tests/test_published_data.py \
        site/public/data/ store/obs/
git commit -m "feat: run_daily orchestrator + first published seed data"
```

---

### Task 9: Next.js site — tokens, KpiCard, homepage

**Files:**
- Create: `site/package.json`, `site/next.config.ts`, `site/tsconfig.json`, `site/src/app/layout.tsx`, `site/src/app/page.tsx`, `site/src/app/globals.css`, `site/src/components/KpiCard.tsx`, `site/src/lib/format.ts`
- Create (generated): `site/package-lock.json`

**Interfaces:**
- Consumes: `site/public/data/pulse_lite.json` (Task 8 shape) and `qa.json`, imported at build time.
- Produces: `npm run build` in `site/` emits `site/out/` static export; homepage renders one amber KPI card (official CPI YoY) + QA badge line.

- [ ] **Step 1: Write the site config files**

`site/package.json`:
```json
{
  "name": "macrogauge-site",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5"
  }
}
```

`site/next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
```

`site/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Write the design tokens** — `site/src/app/globals.css`:

```css
:root {
  --bg: #0B0F14;
  --card: #11161C;
  --border: #1E2630;
  --text: #E6EDF3;
  --muted: #8B98A5;
  --accent-sky: #38BDF8;
  --accent-amber: #F59E0B;
  --accent-red: #F87171;
  --accent-emerald: #34D399;
  --accent-violet: #A78BFA;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif;
}
```

- [ ] **Step 3: Write layout, components, page**

`site/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "macrogauge",
  description: "Daily US inflation & macro analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`site/src/components/KpiCard.tsx`:
```tsx
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
}: {
  label: string;
  value: string;
  context: string;
  accent?: Accent;
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
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{context}</div>
    </div>
  );
}
```

`site/src/lib/format.ts`:
```ts
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-05-01" -> "May 2026" */
export function fmtMonth(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

/** 2.69 -> "2.7%" (one decimal, as prints are quoted) */
export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
```

`site/src/app/page.tsx`:
```tsx
import pulse from "../../public/data/pulse_lite.json";
import qa from "../../public/data/qa.json";
import { KpiCard } from "@/components/KpiCard";
import { fmtMonth, fmtPct } from "@/lib/format";

export default function Home() {
  const cpi = pulse.official_cpi;
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
        macrogauge{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          daily US inflation &amp; macro — phase 0 skeleton
        </span>
      </h1>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        published {pulse.published_at} · SELF-TEST {qa.passed}/{qa.total}{" "}
        {qa.passed === qa.total ? "✓" : "✗"}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <KpiCard
          label="Official CPI · YoY"
          value={fmtPct(cpi.yoy_pct)}
          context={`${fmtMonth(cpi.month)} print · prev ${fmtPct(cpi.prev_yoy_pct)} · as of ${cpi.as_of}`}
          accent="amber"
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Install and build**

```bash
cd ~/Development/macrogauge/site
npm install
npm run build
```
Expected: build succeeds, `out/index.html` created.

- [ ] **Step 5: Verify the KPI rendered into static HTML**

```bash
grep -o "Official CPI" out/index.html && grep -o "SELF-TEST 2/2" out/index.html
```
Expected: both strings found.

- [ ] **Step 6: Eyeball it**

```bash
npx serve out  # or: python3 -m http.server -d out 8080
```
Open http://localhost:3000 (or :8080) — dark page, one amber KPI card with the current CPI YoY, month, prev, and as-of date. Ctrl-C when done.

- [ ] **Step 7: Commit**

```bash
cd ~/Development/macrogauge
git add site/
git commit -m "feat: Next.js static site — tokens, KpiCard, phase-0 homepage"
```

---

### Task 10: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: pytest suite (Tasks 2–8), site build (Task 9).
- Produces: green `ci` check on every push/PR to `main`.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]" -q
      - run: pytest -q

  site:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: site/package-lock.json
      - run: npm ci
        working-directory: site
      - run: npm run build
        working-directory: site
```

- [ ] **Step 2: Commit, push, verify**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pytest + schema guard + site build on every push"
git push
gh run watch --exit-status
```
Expected: both jobs green. (The schema guard is `tests/test_published_data.py`, which now runs against the committed seed data.)

---

### Task 11: Daily publish workflow

**Files:**
- Create: `.github/workflows/daily.yml`

**Interfaces:**
- Consumes: `python -m pipeline.run_daily` CLI (Task 8); repo secret `FRED_API_KEY`.
- Produces: scheduled runs at 8:40 AM ET weekdays (dual UTC crons + in-job ET gate) that run the pipeline and commit refreshed `store/` + `site/public/data/` to `main`. The push triggers Vercel's deploy (Task 12) and `ci.yml` (harmless re-validation). No `[skip ci]` — see Global Constraints.

- [ ] **Step 1: Set the repo secret** (user action if key not in shell env):

```bash
gh secret set FRED_API_KEY
```
(paste the key when prompted; verify with `gh secret list`)

- [ ] **Step 2: Write `.github/workflows/daily.yml`**

```yaml
name: daily
on:
  schedule:
    - cron: "40 12 * * 1-5" # 8:40 ET during EDT
    - cron: "40 13 * * 1-5" # 8:40 ET during EST
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: daily
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Gate — only the cron matching current ET offset proceeds
        id: gate
        run: |
          if [ "${{ github.event_name }}" = "schedule" ] && \
             [ "$(TZ=America/New_York date +%H%M)" != "0840" ] && \
             [ "$(TZ=America/New_York date +%H)" != "08" ]; then
            echo "run=false" >> "$GITHUB_OUTPUT"
          else
            echo "run=true" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/checkout@v4
        if: steps.gate.outputs.run == 'true'
      - uses: actions/setup-python@v5
        if: steps.gate.outputs.run == 'true'
        with:
          python-version: "3.12"
      - name: Run pipeline
        if: steps.gate.outputs.run == 'true'
        env:
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
        run: |
          pip install -e . -q
          python -m pipeline.run_daily --store store --out site/public/data
      - name: Commit data back
        if: steps.gate.outputs.run == 'true'
        run: |
          git config user.name "macrogauge-bot"
          git config user.email "bot@users.noreply.github.com"
          git add store site/public/data
          if git diff --cached --quiet; then
            echo "no data changes"
          else
            git commit -m "data: daily publish $(TZ=America/New_York date '+%Y-%m-%d %H:%M ET')"
            git push
          fi
```

- [ ] **Step 3: Commit, push, dispatch a manual run**

```bash
git add .github/workflows/daily.yml
git commit -m "ci: daily publish workflow — ET-gated cron + data commit-back"
git push
gh workflow run daily
sleep 20 && gh run watch --exit-status
```
Expected: run green. If official data hasn't changed since the seed run, the log says "no data changes" — that's correct behavior.

- [ ] **Step 4: Verify a data commit lands when data changes**

```bash
git pull --rebase
git log --oneline -3
```
Expected: either a `data: daily publish …` commit from the bot (if anything changed) or clean history. Either way the workflow is proven; real change arrives with the next CPI print or Phase 1's daily series.

---

### Task 12: Vercel deploy + loop verification

**Files:**
- None in-repo (Vercel dashboard configuration + `README.md` note)

**Interfaces:**
- Consumes: pushes to `main` (Tasks 10–11).
- Produces: production URL serving the static export; every push to `main` (including bot data commits) redeploys.

- [ ] **Step 1: Connect the repo to Vercel** (user action, one-time):
1. https://vercel.com/new → Import `macrogauge` from GitHub.
2. **Root Directory: `site`** (critical). Framework preset: Next.js (auto-detected; `output: 'export'` is read from next.config.ts).
3. No environment variables needed (the site reads committed JSON — previews correctly reuse last committed data, per spec §12.3).
4. Deploy.

- [ ] **Step 2: Verify production**

Open the assigned `*.vercel.app` URL: dark homepage, amber "OFFICIAL CPI · YOY" card with current values and `SELF-TEST 2/2 ✓`.

- [ ] **Step 3: Prove the full loop once, end-to-end**

```bash
gh workflow run daily && sleep 20 && gh run watch --exit-status
```
If a data commit was pushed, confirm a new Vercel deployment appears (dashboard or `vercel ls` if linked) and the site's `published (timestamp)` line advanced. If no data changed, edit nothing — the loop is proven by Task 11's manual run + this deploy check on the next real change.

- [ ] **Step 4: Record the URL + exit criterion in README**

Append to `README.md`:
```markdown
## Status

- Production: <vercel URL>
- Phase 0 exit: daily workflow green on schedule 3 consecutive weekdays (check
  `gh run list --workflow daily` after three trading days).
```

```bash
git add README.md
git commit -m "docs: production URL + phase-0 exit criterion"
git push
```

- [ ] **Step 5: Monitor (spans 3 days — do not block on it)**
After three weekdays: `gh run list --workflow daily --limit 6` shows scheduled runs green (one skipped-gate run per day is expected — the wrong-DST-offset cron). Phase 0 exit met → write the Phase 1 plan.

---

## Self-review notes (completed)

- **Spec coverage (Phase 0 scope, spec §10 row 0):** repo scaffold ✓ (T1), CI ✓ (T10), cron → connector → store → engine → JSON → build → deploy → commit-back ✓ (T4→T2/3→T5→T6→T9→T12→T11), placeholder homepage with 1 real KPI ✓ (T9), 3-day green exit ✓ (T12 step 5). Store JSONL/vintage rules from §3 ✓ (T2/T3). Schema-per-file + one-writer-per-file from §6 ✓ (T6/T7). Tokens from §7 ✓ (T9).
- **Type consistency:** `latest_yoy` dict keys (`series_code/month/yoy_pct/prev_yoy_pct/as_of`) match `pulse_lite.write` reads, the schema, and `page.tsx` field access ✓. `fake_get` reused across T4/T8 ✓.
- **Known deviation:** no `[skip ci]` on data commits (documented in Global Constraints; spec §2/§11 to be amended when Phase 0 lands).
- **Deliberately deferred to Phase 1:** per-connector failure isolation (noted in T8 docstring), coverage scoring, `sources_status.json`, ECharts, PageShell.
