# macrogauge Phase 1a — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the pipeline from 1 source/1 series to 7 sources/31 series with per-connector failure isolation, a series registry as single source of truth, a published `sources_status.json`, and a QA layer that watches connector health and per-series freshness.

**Architecture:** A JSON series registry (`config/series.json`) declares every source and series; `pipeline/collect.py` fans out to one connector module per source, isolating failures (a broken source records an error and lowers freshness — it never blocks the run); the store absorbs everything append-only. `run_daily` publishes `pulse_lite.json` (unchanged), plus new `sources_status.json` and a grown `qa.json`. Engine/variants/homepage come in Plans 1b/1c.

**Tech Stack:** Python 3.12 stdlib + `requests` + `jsonschema` (pytest dev). No new dependencies — the registry is JSON, not YAML, for exactly this reason (spec §2 shows `series.yaml`; JSON is the locked deviation, keeping the no-new-deps constraint).

**Phase-1 entry decisions from the Phase-0 final review, implemented here:** store row-evolution policy (Task 1); per-connector failure isolation before connector #2 (Task 9); QA staleness 75→80 days (Task 11); `FRED_API_KEY` empty-string guard (Task 12). The rounding-owner decision lands in Plan 1b with the contract work.

## Global Constraints

- Pipeline dependencies: `requests` and `jsonschema` only (+ `pytest` dev). Everything else stdlib.
- Vintage store: append-only JSONL partitioned by vintage month (`store/obs/YYYY-MM.jsonl`); re-published values append a new vintage row, never overwrite; latest vintage wins on read.
- **Row-evolution policy (locked in Task 1):** store rows are immutable and schema-versionless. New `Observation` fields may be ADDED; fields are never renamed, removed, or retyped. Readers supply defaults for fields absent in old rows (`load()` inserts `None`). A field's meaning never changes.
- Every published JSON has a JSON Schema in `schemas/` and exactly one writer module; files validated before publish (in `run_daily`, before the workflow's commit step).
- Publication never blocks on QA or on a failed connector — failures surface in `sources_status.json` and `qa.json`, and stale series simply carry forward in the store.
- All dates in data are `YYYY-MM-DD` strings; monthly observations are first-of-month (`YYYY-MM-01`); vintage/scheduling decisions use ET (`America/New_York`).
- Internal series codes are filename-safe (`[a-z0-9_]+` or the provider's own uppercase id when it is already safe, e.g. `CPIAUCNS`, `APU0000708111`); provider ids with unsafe characters (EIA dots) map to internal codes in the registry.
- Tests never hit the network: every connector takes `http_get=None` (defaults to `requests.get`) and is tested against recorded fixtures in `tests/fixtures/`.
- Commit messages: conventional prefixes (`feat:`, `fix:`, `chore:`, `data:`, `ci:`, `test:`, `docs:`).
- Repo git identity is already set (`Eric Wyluda <35318463+ewyluda@users.noreply.github.com>`) — do not change it; Vercel blocks unmatched authors.
- Work from `~/Development/macrogauge` with the venv active: `source .venv/bin/activate`.

## File Structure

```
config/series.json                 # registry: 7 sources, 31 series (Task 2)
pipeline/registry.py               # load_registry() + validation (Task 2)
pipeline/connectors/util.py        # month_first(), get_text() shared helpers (Task 3)
pipeline/connectors/bls.py         # BLS v2 API (Task 3)
pipeline/connectors/eia.py         # EIA v2 seriesid API (Task 4)
pipeline/connectors/zillow.py      # ZORI + ZHVI research CSVs (Task 5)
pipeline/connectors/pmms.py        # Freddie Mac PMMS history CSV (Task 6)
pipeline/connectors/treasury.py    # FiscalData debt-to-penny (Task 7)
pipeline/connectors/fmp.py         # FMP stable quote (Task 8)
pipeline/collect.py                # SourceResult + collect_all() isolation harness (Task 9)
pipeline/publish/sources_status.py # sources_status.json writer (Task 10)
schemas/sources_status.schema.json # (Task 10)
pipeline/publish/qa.py             # grown: connector + freshness checks (Task 11)
pipeline/store/vintage.py          # tolerant load(), max_obs_date() (Task 1)
pipeline/run_daily.py              # rewired to registry + collect_all (Task 12)
.github/workflows/daily.yml        # new secrets in env (Task 12)
```

---

### Task 1: Store row-evolution policy — tolerant `load()` + `max_obs_date()`

**Files:**
- Modify: `pipeline/store/vintage.py`
- Modify: `README.md` (policy section)
- Test: `tests/test_vintage.py` (add cases)

**Interfaces:**
- Consumes: existing `load()`/`latest()`/`max_vintage()` and the `observations` table.
- Produces: `load()` tolerates JSONL rows missing not-yet-invented fields (absent → `NULL`), per the row-evolution policy. `vintage.max_obs_date(conn, series_code: str) -> str | None` — most recent obs_date for a series, `None` if the series has no rows (unlike `max_vintage`, which raises: freshness checks want "never seen" as a value, not an error).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_vintage.py`)

```python
def test_load_tolerates_rows_missing_future_fields(tmp_path):
    part = tmp_path / "obs" / "2026-07.jsonl"
    part.parent.mkdir(parents=True)
    part.write_text(
        '{"series_code": "OLD", "obs_date": "2026-05-01", "value": 1.5,'
        ' "vintage_date": "2026-07-07"}\n')  # no source/route — legacy row
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "OLD") == [("2026-05-01", 1.5)]
    row = conn.execute("SELECT source, route FROM observations").fetchone()
    assert row == (None, None)


def test_max_obs_date(tmp_path):
    vintage.append([obs(date="2026-04-01"), obs(date="2026-05-01")], tmp_path)
    conn = vintage.load(tmp_path)
    assert vintage.max_obs_date(conn, "CPIAUCNS") == "2026-05-01"
    assert vintage.max_obs_date(conn, "NO_SUCH_SERIES") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_vintage.py -v -k "future_fields or max_obs_date"`
Expected: FAIL — the legacy-row test raises `sqlite3.ProgrammingError` (missing bind key); the other, `AttributeError: no attribute 'max_obs_date'`

- [ ] **Step 3: Implement** — in `pipeline/store/vintage.py`:

Replace the `executemany` block inside `load()` with a defaulted-row version:

```python
COLUMNS = ("series_code", "obs_date", "value", "vintage_date", "source", "route")
```
(place at module level, under `OBS_SUBDIR`), then inside `load()`:

```python
    for part in _partitions(store_dir):
        rows = [{c: row.get(c) for c in COLUMNS}
                for row in (json.loads(line) for line in part.read_text().splitlines())]
        conn.executemany(
            "INSERT INTO observations VALUES "
            "(:series_code, :obs_date, :value, :vintage_date, :source, :route)", rows)
```

Add at the end of the file:

```python
def max_obs_date(conn: sqlite3.Connection, series_code: str) -> str | None:
    """Most recent obs_date for a series; None when the series has no rows.

    Unlike max_vintage (raises for unknown series), freshness checks treat
    'never seen' as a reportable value, not an error.
    """
    row = conn.execute("SELECT MAX(obs_date) FROM observations WHERE series_code = ?",
                       (series_code,)).fetchone()
    return row[0]
```

Extend the module docstring's first paragraph with the policy:

```python
"""Append-only vintage observation store: JSONL partitioned by vintage month.

Re-published values append a new vintage row — never overwrite. History
can't be silently rewritten; git is the audit trail.

Row-evolution policy: rows are immutable and schema-versionless. New fields
may be ADDED to Observation; fields are never renamed, removed, or retyped,
and their meaning never changes. Readers default absent fields to None, so
partitions written by any past version load forever.
"""
```

- [ ] **Step 4: Add the policy to `README.md`** (after the bullet list at the top):

```markdown
**Store row-evolution policy:** `store/obs/*.jsonl` rows are immutable and
schema-versionless. New `Observation` fields may be added; fields are never
renamed, removed, or retyped. Readers default absent fields (old partitions
load forever). Never rewrite a committed partition.
```

- [ ] **Step 5: Run the full suite**

Run: `pytest -q`
Expected: all pass (18 prior + 2 new = 20)

- [ ] **Step 6: Commit**

```bash
git add pipeline/store/vintage.py tests/test_vintage.py README.md
git commit -m "feat: store row-evolution policy — tolerant load + max_obs_date"
```

---

### Task 2: Series registry — `config/series.json` + `pipeline/registry.py`

**Files:**
- Create: `config/series.json`, `pipeline/registry.py`
- Test: `tests/test_registry.py`

**Interfaces:**
- Produces: `registry.load_registry(path: Path | None = None) -> tuple[dict[str, Source], list[Series]]` where `Source(name: str, route: str, cadence: str, secret: str | None, secret_optional: bool)` and `Series(code: str, source: str, source_id: str, name: str, max_staleness_days: int)` are frozen dataclasses. Default path is `config/series.json` at repo root. Raises `ValueError` on duplicate codes or a series referencing an unknown source.
- Produces: the registry contents below — Tasks 3-12 and Plan 1b consume these exact codes.

- [ ] **Step 1: Write `config/series.json`**

```json
{
  "sources": {
    "FRED":     {"route": "API", "cadence": "monthly", "secret": "FRED_API_KEY"},
    "BLS":      {"route": "API", "cadence": "monthly", "secret": "BLS_API_KEY", "secret_optional": true},
    "EIA":      {"route": "API", "cadence": "monthly", "secret": "EIA_API_KEY"},
    "FMP":      {"route": "API", "cadence": "daily",   "secret": "FMP_API_KEY"},
    "TREASURY": {"route": "API", "cadence": "daily"},
    "ZILLOW":   {"route": "CSV", "cadence": "monthly"},
    "PMMS":     {"route": "CSV", "cadence": "weekly"}
  },
  "series": [
    {"code": "CPIAUCNS",        "source": "FRED",     "source_id": "CPIAUCNS",                     "name": "CPI-U all items (NSA)",              "max_staleness_days": 80},
    {"code": "CPILFENS",        "source": "FRED",     "source_id": "CPILFENS",                     "name": "CPI-U core, ex food & energy (NSA)", "max_staleness_days": 80},
    {"code": "CUUR0000SAF11",   "source": "FRED",     "source_id": "CUUR0000SAF11",                "name": "CPI food at home (NSA)",             "max_staleness_days": 80},
    {"code": "CUUR0000SEFV",    "source": "FRED",     "source_id": "CUUR0000SEFV",                 "name": "CPI food away from home (NSA)",      "max_staleness_days": 80},
    {"code": "CUUR0000SAM",     "source": "FRED",     "source_id": "CUUR0000SAM",                  "name": "CPI medical care (NSA)",             "max_staleness_days": 80},
    {"code": "CUUR0000SAA",     "source": "FRED",     "source_id": "CUUR0000SAA",                  "name": "CPI apparel (NSA)",                  "max_staleness_days": 80},
    {"code": "CUUR0000SAR",     "source": "FRED",     "source_id": "CUUR0000SAR",                  "name": "CPI recreation (NSA)",               "max_staleness_days": 80},
    {"code": "CUUR0000SAE",     "source": "FRED",     "source_id": "CUUR0000SAE",                  "name": "CPI education & communication (NSA)","max_staleness_days": 80},
    {"code": "CUUR0000SAG",     "source": "FRED",     "source_id": "CUUR0000SAG",                  "name": "CPI other goods & services (NSA)",   "max_staleness_days": 80},
    {"code": "CUUR0000SETA01",  "source": "FRED",     "source_id": "CUUR0000SETA01",               "name": "CPI new vehicles (NSA)",             "max_staleness_days": 80},
    {"code": "CUUR0000SETA02",  "source": "FRED",     "source_id": "CUUR0000SETA02",               "name": "CPI used cars & trucks (NSA)",       "max_staleness_days": 80},
    {"code": "CUUR0000SEHA",    "source": "FRED",     "source_id": "CUUR0000SEHA",                 "name": "CPI rent of primary residence (NSA)","max_staleness_days": 80},
    {"code": "CUUR0000SEHC",    "source": "FRED",     "source_id": "CUUR0000SEHC",                 "name": "CPI owners' equivalent rent (NSA)",  "max_staleness_days": 80},
    {"code": "CUUR0000SEHF01",  "source": "FRED",     "source_id": "CUUR0000SEHF01",               "name": "CPI electricity (NSA)",              "max_staleness_days": 80},
    {"code": "CUUR0000SEHF02",  "source": "FRED",     "source_id": "CUUR0000SEHF02",               "name": "CPI utility piped gas (NSA)",        "max_staleness_days": 80},
    {"code": "CUUR0000SETB01",  "source": "FRED",     "source_id": "CUUR0000SETB01",               "name": "CPI gasoline all types (NSA)",       "max_staleness_days": 80},
    {"code": "APU0000708111",   "source": "BLS",      "source_id": "APU0000708111",                "name": "Avg price: eggs, grade A, dozen",    "max_staleness_days": 80},
    {"code": "APU0000709112",   "source": "BLS",      "source_id": "APU0000709112",                "name": "Avg price: milk, whole, gallon",     "max_staleness_days": 80},
    {"code": "APU0000702111",   "source": "BLS",      "source_id": "APU0000702111",                "name": "Avg price: bread, white, lb",        "max_staleness_days": 80},
    {"code": "APU0000703112",   "source": "BLS",      "source_id": "APU0000703112",                "name": "Avg price: ground chuck, lb",        "max_staleness_days": 80},
    {"code": "APU0000706111",   "source": "BLS",      "source_id": "APU0000706111",                "name": "Avg price: chicken, whole, lb",      "max_staleness_days": 80},
    {"code": "APU0000711211",   "source": "BLS",      "source_id": "APU0000711211",                "name": "Avg price: bananas, lb",             "max_staleness_days": 80},
    {"code": "eia_elec_res",    "source": "EIA",      "source_id": "ELEC.PRICE.US-RES.M",          "name": "Residential electricity ¢/kWh (US)", "max_staleness_days": 95},
    {"code": "eia_ng_res",      "source": "EIA",      "source_id": "NG.N3010US3.M",                "name": "Residential natural gas $/Mcf (US)", "max_staleness_days": 95},
    {"code": "eia_gasreg_w",    "source": "EIA",      "source_id": "PET.EMM_EPMR_PTE_NUS_DPG.W",   "name": "US regular gasoline retail $/gal (weekly)", "max_staleness_days": 21},
    {"code": "fmp_gold",        "source": "FMP",      "source_id": "GCUSD",                        "name": "Gold futures front month $/oz",      "max_staleness_days": 7},
    {"code": "fmp_wti",         "source": "FMP",      "source_id": "CLUSD",                        "name": "WTI crude front month $/bbl",        "max_staleness_days": 7},
    {"code": "fiscal_debt_total","source": "TREASURY","source_id": "debt_to_penny",                "name": "Total public debt outstanding $",    "max_staleness_days": 10},
    {"code": "zori_us",         "source": "ZILLOW",   "source_id": "zori",                         "name": "Zillow Observed Rent Index (US)",    "max_staleness_days": 75},
    {"code": "zhvi_us",         "source": "ZILLOW",   "source_id": "zhvi",                         "name": "Zillow Home Value Index (US)",       "max_staleness_days": 75},
    {"code": "pmms_30yr",       "source": "PMMS",     "source_id": "pmms30",                       "name": "Freddie Mac 30yr fixed mortgage %",  "max_staleness_days": 21}
  ]
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_registry.py`:

```python
import json
from pathlib import Path

import pytest

from pipeline import registry


def test_load_real_registry():
    sources, series = registry.load_registry()
    assert set(sources) == {"FRED", "BLS", "EIA", "FMP", "TREASURY", "ZILLOW", "PMMS"}
    assert len(series) == 31
    assert sources["BLS"].secret_optional is True
    assert sources["TREASURY"].secret is None
    codes = [s.code for s in series]
    assert len(codes) == len(set(codes))
    fred = [s for s in series if s.source == "FRED"]
    assert len(fred) == 16


def test_duplicate_code_rejected(tmp_path):
    bad = {"sources": {"X": {"route": "API", "cadence": "daily"}},
           "series": [
               {"code": "a", "source": "X", "source_id": "1", "name": "a", "max_staleness_days": 7},
               {"code": "a", "source": "X", "source_id": "2", "name": "a2", "max_staleness_days": 7}]}
    p = tmp_path / "series.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate"):
        registry.load_registry(p)


def test_unknown_source_rejected(tmp_path):
    bad = {"sources": {"X": {"route": "API", "cadence": "daily"}},
           "series": [{"code": "a", "source": "NOPE", "source_id": "1", "name": "a",
                       "max_staleness_days": 7}]}
    p = tmp_path / "series.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="unknown source"):
        registry.load_registry(p)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_registry.py -v`
Expected: FAIL — `ImportError: cannot import name 'registry'`

- [ ] **Step 4: Implement `pipeline/registry.py`**

```python
"""Series registry — the single source of truth for what the pipeline collects."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "series.json"


@dataclass(frozen=True)
class Source:
    name: str
    route: str            # "API" | "CSV" | "SCRAPE"
    cadence: str          # human-readable: "daily" | "weekly" | "monthly"
    secret: str | None    # env var holding the API key, if any
    secret_optional: bool


@dataclass(frozen=True)
class Series:
    code: str             # internal, filename-safe
    source: str           # key into sources
    source_id: str        # provider-side identifier
    name: str
    max_staleness_days: int


def load_registry(path: Path | None = None) -> tuple[dict[str, Source], list[Series]]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    sources = {n: Source(name=n, route=s["route"], cadence=s["cadence"],
                         secret=s.get("secret"),
                         secret_optional=s.get("secret_optional", False))
               for n, s in raw["sources"].items()}
    series = [Series(code=s["code"], source=s["source"], source_id=s["source_id"],
                     name=s["name"], max_staleness_days=s["max_staleness_days"])
              for s in raw["series"]]
    codes = [s.code for s in series]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"duplicate series codes: {sorted(dupes)}")
    for s in series:
        if s.source not in sources:
            raise ValueError(f"series {s.code} references unknown source {s.source}")
    return sources, series
```

- [ ] **Step 5: Run tests, then the full suite**

Run: `pytest tests/test_registry.py -v && pytest -q`
Expected: 3 pass; full suite green

- [ ] **Step 6: Commit**

```bash
git add config/series.json pipeline/registry.py tests/test_registry.py
git commit -m "feat: series registry — 7 sources, 31 series, validated loader"
```

---

### Task 3: Shared connector utils + BLS connector

**Files:**
- Create: `pipeline/connectors/util.py`, `pipeline/connectors/bls.py`, `tests/fixtures/bls_ap.json`
- Test: `tests/test_bls.py` (also covers util)

**Interfaces:**
- Produces: `util.month_first(period: str) -> str` — `"2026-05"` → `"2026-05-01"`, `"2026-05-31"` → `"2026-05-01"` (any `YYYY-MM...` string).
- Produces: `util.get_text(url: str, http_get) -> str` — GET with `timeout=60`, `raise_for_status()`, returns `resp.text` (used by the CSV connectors).
- Produces: `bls.fetch(series_ids: list[str], api_key: str | None, start_year: str = "2017", http_get=None) -> list[Observation]` — series_code = the BLS series id; monthly rows only (period `M01`-`M12`; `M13` annual rows skipped); `source="BLS"`, `route="API"`, vintage = today ET.

- [ ] **Step 1: Write the fixture** — `tests/fixtures/bls_ap.json` (real BLS v2 response shape):

```json
{
  "status": "REQUEST_SUCCEEDED",
  "responseTime": 120,
  "message": [],
  "Results": {
    "series": [
      {
        "seriesID": "APU0000708111",
        "data": [
          {"year": "2026", "period": "M05", "periodName": "May", "value": "4.126"},
          {"year": "2026", "period": "M04", "periodName": "April", "value": "4.055"},
          {"year": "2025", "period": "M13", "periodName": "Annual", "value": "3.999"}
        ]
      },
      {
        "seriesID": "APU0000709112",
        "data": [
          {"year": "2026", "period": "M05", "periodName": "May", "value": "4.312"}
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_bls.py`:

```python
import json
from pathlib import Path

from pipeline.connectors import bls, util

FIXTURE = Path(__file__).parent / "fixtures" / "bls_ap.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
        self.text = json.dumps(payload)

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_post(url, json=None, timeout=None):
    assert "api.bls.gov" in url
    assert json["seriesid"] == ["APU0000708111", "APU0000709112"]
    assert json["startyear"] == "2017"
    assert json.get("registrationkey") == "bls-key"
    import json as j
    return FakeResponse(j.loads(FIXTURE.read_text()))


def test_month_first():
    assert util.month_first("2026-05") == "2026-05-01"
    assert util.month_first("2026-05-31") == "2026-05-01"


def test_fetch_parses_and_skips_annual():
    obs = bls.fetch(["APU0000708111", "APU0000709112"], "bls-key",
                    vintage_date="2026-07-07", http_post=fake_post)
    assert len(obs) == 3  # M13 skipped
    eggs = [o for o in obs if o.series_code == "APU0000708111"]
    assert [(o.obs_date, o.value) for o in eggs] == [("2026-05-01", 4.126),
                                                     ("2026-04-01", 4.055)]
    assert obs[0].source == "BLS" and obs[0].route == "API"


def test_fetch_omits_key_when_none():
    def post_no_key(url, json=None, timeout=None):
        assert "registrationkey" not in json
        import json as j
        return FakeResponse(j.loads(FIXTURE.read_text()))
    obs = bls.fetch(["APU0000708111", "APU0000709112"], None,
                    vintage_date="2026-07-07", http_post=post_no_key)
    assert len(obs) == 3
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_bls.py -v`
Expected: FAIL — `ImportError` (modules missing)

- [ ] **Step 4: Implement**

`pipeline/connectors/util.py`:
```python
"""Shared connector helpers."""


def month_first(period: str) -> str:
    """'2026-05' or '2026-05-31' -> '2026-05-01' (monthly obs are first-of-month)."""
    return f"{period[:7]}-01"


def get_text(url: str, http_get) -> str:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.text
```

`pipeline/connectors/bls.py`:
```python
"""BLS connector — https://www.bls.gov/developers/api_signature_v2.htm

Keyless works (25 req/day); a free registration key raises the limit.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def fetch(series_ids: list[str], api_key: str | None, start_year: str = "2017",
          vintage_date: str | None = None, http_post=None) -> list[Observation]:
    http_post = http_post or requests.post
    vintage = vintage_date or today_et()
    payload = {"seriesid": series_ids, "startyear": start_year,
               "endyear": today_et()[:4]}
    if api_key:
        payload["registrationkey"] = api_key
    resp = http_post(BLS_URL, json=payload, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    for s in resp.json()["Results"]["series"]:
        for row in s["data"]:
            if not row["period"].startswith("M") or row["period"] == "M13":
                continue
            out.append(Observation(
                series_code=s["seriesID"],
                obs_date=f"{row['year']}-{row['period'][1:]}-01",
                value=float(row["value"]), vintage_date=vintage,
                source="BLS", route="API"))
    return out
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_bls.py -v && pytest -q`
Expected: 3 pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/util.py pipeline/connectors/bls.py tests/test_bls.py tests/fixtures/bls_ap.json
git commit -m "feat: BLS connector + shared month_first/get_text utils"
```

---

### Task 4: EIA connector

**Files:**
- Create: `pipeline/connectors/eia.py`, `tests/fixtures/eia_monthly.json`, `tests/fixtures/eia_weekly.json`
- Test: `tests/test_eia.py`

**Interfaces:**
- Consumes: `util.month_first`, `fred.today_et`, `Observation`.
- Produces: `eia.fetch(series_ids: list[str], api_key: str, vintage_date=None, http_get=None) -> list[Observation]` — uses EIA's v2 seriesid compatibility endpoint; series_code = the EIA series id (collect_all remaps to internal codes); monthly periods (`YYYY-MM`) normalized to first-of-month, weekly/daily periods (`YYYY-MM-DD`) kept as-is; `source="EIA"`, `route="API"`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/eia_monthly.json`:
```json
{
  "response": {
    "total": 2,
    "data": [
      {"period": "2026-05", "value": 17.45},
      {"period": "2026-04", "value": 17.21}
    ]
  }
}
```

`tests/fixtures/eia_weekly.json`:
```json
{
  "response": {
    "total": 2,
    "data": [
      {"period": "2026-06-29", "value": 3.412},
      {"period": "2026-06-22", "value": 3.388}
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_eia.py`:

```python
import json
from pathlib import Path

from pipeline.connectors import eia

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["api_key"] == "eia-key"
    if "ELEC.PRICE.US-RES.M" in url:
        return FakeResponse(json.loads((FIXTURES / "eia_monthly.json").read_text()))
    if "PET.EMM_EPMR_PTE_NUS_DPG.W" in url:
        return FakeResponse(json.loads((FIXTURES / "eia_weekly.json").read_text()))
    raise AssertionError(f"unexpected url {url}")


def test_fetch_normalizes_monthly_and_keeps_weekly():
    obs = eia.fetch(["ELEC.PRICE.US-RES.M", "PET.EMM_EPMR_PTE_NUS_DPG.W"], "eia-key",
                    vintage_date="2026-07-07", http_get=fake_get)
    monthly = [o for o in obs if o.series_code == "ELEC.PRICE.US-RES.M"]
    weekly = [o for o in obs if o.series_code == "PET.EMM_EPMR_PTE_NUS_DPG.W"]
    assert [(o.obs_date, o.value) for o in monthly] == [("2026-05-01", 17.45),
                                                        ("2026-04-01", 17.21)]
    assert [(o.obs_date, o.value) for o in weekly] == [("2026-06-29", 3.412),
                                                       ("2026-06-22", 3.388)]
    assert obs[0].source == "EIA" and obs[0].route == "API"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_eia.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/eia.py`**

```python
"""EIA connector — v2 seriesid compatibility route.

https://api.eia.gov/v2/seriesid/<SERIES_ID>?api_key=... returns
response.data[] rows of {period, value}. Monthly periods are 'YYYY-MM',
weekly/daily are 'YYYY-MM-DD'.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import month_first
from pipeline.models import Observation

EIA_URL = "https://api.eia.gov/v2/seriesid/{sid}"


def fetch(series_ids: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    for sid in series_ids:
        resp = http_get(EIA_URL.format(sid=sid), params={"api_key": api_key}, timeout=60)
        resp.raise_for_status()
        for row in resp.json()["response"]["data"]:
            if row["value"] is None:
                continue
            period = str(row["period"])
            obs_date = period if len(period) == 10 else month_first(period)
            out.append(Observation(series_code=sid, obs_date=obs_date,
                                   value=float(row["value"]), vintage_date=vintage,
                                   source="EIA", route="API"))
    return out
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_eia.py -v && pytest -q`
Expected: pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/eia.py tests/test_eia.py tests/fixtures/eia_monthly.json tests/fixtures/eia_weekly.json
git commit -m "feat: EIA connector — seriesid route, monthly + weekly periods"
```

---

### Task 5: Zillow connector (ZORI + ZHVI)

**Files:**
- Create: `pipeline/connectors/zillow.py`, `tests/fixtures/zillow_zori.csv`, `tests/fixtures/zillow_zhvi.csv`
- Test: `tests/test_zillow.py`

**Interfaces:**
- Consumes: `util.get_text`, `util.month_first`, `fred.today_et`.
- Produces: `zillow.fetch(vintage_date=None, http_get=None) -> list[Observation]` — downloads the two national research CSVs, extracts the `RegionName == "United States"` row, emits series codes `zori_us` and `zhvi_us` directly (no remap needed), monthly obs from 2017-01 onward, `source="ZILLOW"`, `route="CSV"`. Module constants `ZORI_URL` / `ZHVI_URL` hold the download URLs (they occasionally move — keeping them as constants makes the fix a one-liner).

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/zillow_zori.csv`:
```csv
RegionID,SizeRank,RegionName,RegionType,StateName,2016-12-31,2017-01-31,2026-05-31
102001,0,United States,country,,1388.9,1400.1,2105.7
394913,1,"New York, NY",msa,NY,2380.0,2400.0,3300.2
```

`tests/fixtures/zillow_zhvi.csv`:
```csv
RegionID,SizeRank,RegionName,RegionType,StateName,2017-01-31,2026-05-31
102001,0,United States,country,,196000.0,361500.0
394913,1,"New York, NY",msa,NY,430000.0,660000.0
```

- [ ] **Step 2: Write the failing tests** — `tests/test_zillow.py`:

```python
from pathlib import Path

from pipeline.connectors import zillow

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def fake_get(url, timeout=None):
    if url == zillow.ZORI_URL:
        return FakeResponse((FIXTURES / "zillow_zori.csv").read_text())
    if url == zillow.ZHVI_URL:
        return FakeResponse((FIXTURES / "zillow_zhvi.csv").read_text())
    raise AssertionError(f"unexpected url {url}")


def test_fetch_us_row_only_since_2017():
    obs = zillow.fetch(vintage_date="2026-07-07", http_get=fake_get)
    zori = [o for o in obs if o.series_code == "zori_us"]
    zhvi = [o for o in obs if o.series_code == "zhvi_us"]
    # 2016-12 column is before the 2017-01-01 start and must be excluded
    assert [(o.obs_date, o.value) for o in zori] == [("2017-01-01", 1400.1),
                                                     ("2026-05-01", 2105.7)]
    assert [(o.obs_date, o.value) for o in zhvi] == [("2017-01-01", 196000.0),
                                                     ("2026-05-01", 361500.0)]
    assert zori[0].source == "ZILLOW" and zori[0].route == "CSV"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_zillow.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/zillow.py`**

```python
"""Zillow research CSVs — https://www.zillow.com/research/data/

National ZORI (rent index) and ZHVI (home value index). The files are wide:
one row per region, one column per month-end date. We keep only the
United States row. URLs move occasionally — they live in constants so the
fix is a one-liner (the QA connector check catches the breakage).
"""
import csv
import io

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text, month_first
from pipeline.models import Observation

ZORI_URL = ("https://files.zillowstatic.com/research/public_csvs/zori/"
            "Metro_zori_uc_sfrcondomfr_sm_month.csv")
ZHVI_URL = ("https://files.zillowstatic.com/research/public_csvs/zhvi/"
            "Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")
START = "2017-01-01"


def _us_series(csv_text: str, code: str, vintage: str) -> list[Observation]:
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        if row["RegionName"] != "United States":
            continue
        out = []
        for col, val in row.items():
            if len(col) == 10 and col[4] == "-" and val not in (None, ""):
                obs_date = month_first(col)
                if obs_date >= START:
                    out.append(Observation(series_code=code, obs_date=obs_date,
                                           value=float(val), vintage_date=vintage,
                                           source="ZILLOW", route="CSV"))
        return out
    raise ValueError(f"United States row not found for {code}")


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    return (_us_series(get_text(ZORI_URL, http_get), "zori_us", vintage)
            + _us_series(get_text(ZHVI_URL, http_get), "zhvi_us", vintage))
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_zillow.py -v && pytest -q`
Expected: pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/zillow.py tests/test_zillow.py tests/fixtures/zillow_zori.csv tests/fixtures/zillow_zhvi.csv
git commit -m "feat: Zillow connector — national ZORI + ZHVI from research CSVs"
```

---

### Task 6: PMMS connector

**Files:**
- Create: `pipeline/connectors/pmms.py`, `tests/fixtures/pmms.csv`
- Test: `tests/test_pmms.py`

**Interfaces:**
- Consumes: `util.get_text`, `fred.today_et`.
- Produces: `pmms.fetch(vintage_date=None, http_get=None) -> list[Observation]` — weekly 30yr rate, series code `pmms_30yr`, dates converted `MM/DD/YYYY` → ISO, rows before 2017-01-01 and rows with blank rate skipped, `source="PMMS"`, `route="CSV"`. Constant `PMMS_URL`.

- [ ] **Step 1: Write the fixture** — `tests/fixtures/pmms.csv`:

```csv
date,pmms30,pmms15
12/29/2016,4.32,3.55
01/05/2017,4.20,3.44
07/02/2026,6.31,5.62
07/09/2026,,
```

- [ ] **Step 2: Write the failing tests** — `tests/test_pmms.py`:

```python
from pathlib import Path

from pipeline.connectors import pmms

FIXTURE = Path(__file__).parent / "fixtures" / "pmms.csv"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def fake_get(url, timeout=None):
    assert url == pmms.PMMS_URL
    return FakeResponse(FIXTURE.read_text())


def test_fetch_weekly_30yr_iso_dates():
    obs = pmms.fetch(vintage_date="2026-07-07", http_get=fake_get)
    assert [(o.obs_date, o.value) for o in obs] == [("2017-01-05", 4.20),
                                                    ("2026-07-02", 6.31)]
    assert obs[0].series_code == "pmms_30yr"
    assert obs[0].source == "PMMS" and obs[0].route == "CSV"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_pmms.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/pmms.py`**

```python
"""Freddie Mac PMMS weekly mortgage survey — history CSV.

Weekly 30yr fixed average. Primary daily-rate source (MND scrape) arrives in
Phase 2; PMMS is the durable fallback per spec §5.
"""
import csv
import io
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

PMMS_URL = "https://www.freddiemac.com/pmms/docs/PMMS_history.csv"
START = "2017-01-01"


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    reader = csv.DictReader(io.StringIO(get_text(PMMS_URL, http_get)))
    for row in reader:
        rate = (row.get("pmms30") or "").strip()
        if not rate:
            continue
        obs_date = datetime.strptime(row["date"].strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
        if obs_date < START:
            continue
        out.append(Observation(series_code="pmms_30yr", obs_date=obs_date,
                               value=float(rate), vintage_date=vintage,
                               source="PMMS", route="CSV"))
    return out
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_pmms.py -v && pytest -q`
Expected: pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/pmms.py tests/test_pmms.py tests/fixtures/pmms.csv
git commit -m "feat: PMMS connector — weekly 30yr mortgage rate"
```

---

### Task 7: Treasury FiscalData connector

**Files:**
- Create: `pipeline/connectors/treasury.py`, `tests/fixtures/treasury_debt.json`
- Test: `tests/test_treasury.py`

**Interfaces:**
- Consumes: `fred.today_et`.
- Produces: `treasury.fetch(vintage_date=None, http_get=None) -> list[Observation]` — daily total public debt from the keyless Debt to the Penny API, series code `fiscal_debt_total`, `source="TREASURY"`, `route="API"`.

- [ ] **Step 1: Write the fixture** — `tests/fixtures/treasury_debt.json`:

```json
{
  "data": [
    {"record_date": "2026-07-02", "tot_pub_debt_out_amt": "38712345678901.23"},
    {"record_date": "2026-07-01", "tot_pub_debt_out_amt": "38709876543210.99"}
  ],
  "meta": {"count": 2}
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_treasury.py`:

```python
import json
from pathlib import Path

from pipeline.connectors import treasury

FIXTURE = Path(__file__).parent / "fixtures" / "treasury_debt.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert "debt_to_penny" in url
    assert params["filter"] == "record_date:gte:2017-01-01"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_daily_debt():
    obs = treasury.fetch(vintage_date="2026-07-07", http_get=fake_get)
    assert [(o.obs_date, o.value) for o in obs] == [
        ("2026-07-02", 38712345678901.23),
        ("2026-07-01", 38709876543210.99)]
    assert obs[0].series_code == "fiscal_debt_total"
    assert obs[0].source == "TREASURY" and obs[0].route == "API"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_treasury.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/treasury.py`**

```python
"""Treasury FiscalData — Debt to the Penny (keyless, no rate limit drama).

https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

DEBT_URL = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
            "/v2/accounting/od/debt_to_penny")


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(DEBT_URL, params={
        "fields": "record_date,tot_pub_debt_out_amt",
        "filter": "record_date:gte:2017-01-01",
        "sort": "-record_date",
        "page[size]": "10000"}, timeout=60)
    resp.raise_for_status()
    return [Observation(series_code="fiscal_debt_total", obs_date=row["record_date"],
                        value=float(row["tot_pub_debt_out_amt"]), vintage_date=vintage,
                        source="TREASURY", route="API")
            for row in resp.json()["data"]]
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_treasury.py -v && pytest -q`
Expected: pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/treasury.py tests/test_treasury.py tests/fixtures/treasury_debt.json
git commit -m "feat: Treasury connector — daily debt to the penny"
```

---

### Task 8: FMP connector

**Files:**
- Create: `pipeline/connectors/fmp.py`, `tests/fixtures/fmp_quote.json`
- Test: `tests/test_fmp.py`

**Interfaces:**
- Consumes: `Observation`; `zoneinfo` for ET.
- Produces: `fmp.fetch(symbols: list[str], api_key: str, vintage_date=None, http_get=None) -> list[Observation]` — one quote per symbol from FMP's stable quote endpoint; series_code = the symbol (collect_all remaps `GCUSD`→`fmp_gold`, `CLUSD`→`fmp_wti`); obs_date derived from the quote's epoch `timestamp` in ET (deterministic, testable); `source="FMP"`, `route="API"`.

- [ ] **Step 1: Write the fixture** — `tests/fixtures/fmp_quote.json`:

```json
[
  {"symbol": "GCUSD", "price": 3412.5, "timestamp": 1783440000},
  {"symbol": "CLUSD", "price": 71.85, "timestamp": 1783440000}
]
```

- [ ] **Step 2: Write the failing tests** — `tests/test_fmp.py`:

```python
import json
from pathlib import Path

from pipeline.connectors import fmp

FIXTURE = Path(__file__).parent / "fixtures" / "fmp_quote.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_get(url, params=None, timeout=None):
    assert params["apikey"] == "fmp-key"
    assert params["symbol"] == "GCUSD,CLUSD"
    return FakeResponse(json.loads(FIXTURE.read_text()))


def test_fetch_quotes_dated_from_timestamp():
    obs = fmp.fetch(["GCUSD", "CLUSD"], "fmp-key", vintage_date="2026-07-07",
                    http_get=fake_get)
    # 1783440000 = 2026-07-07 12:00:00 UTC = 08:00 ET
    assert [(o.series_code, o.obs_date, o.value) for o in obs] == [
        ("GCUSD", "2026-07-07", 3412.5),
        ("CLUSD", "2026-07-07", 71.85)]
    assert obs[0].source == "FMP" and obs[0].route == "API"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_fmp.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/connectors/fmp.py`**

```python
"""FMP connector — batch quote for futures proxies (gold, WTI).

Phase 3 grows this to the economic calendar + street consensus.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

QUOTE_URL = "https://financialmodelingprep.com/stable/quote"


def fetch(symbols: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(QUOTE_URL, params={"symbol": ",".join(symbols),
                                       "apikey": api_key}, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    for row in resp.json():
        obs_date = datetime.fromtimestamp(
            row["timestamp"], ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
        out.append(Observation(series_code=row["symbol"], obs_date=obs_date,
                               value=float(row["price"]), vintage_date=vintage,
                               source="FMP", route="API"))
    return out
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_fmp.py -v && pytest -q`
Expected: pass; suite green

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/fmp.py tests/test_fmp.py tests/fixtures/fmp_quote.json
git commit -m "feat: FMP connector — gold + WTI batch quote"
```

---

### Task 9: `collect_all` — per-connector failure isolation

**Files:**
- Create: `pipeline/collect.py`
- Test: `tests/test_collect.py`

**Interfaces:**
- Consumes: all connectors (Tasks 3-8 + existing `fred.fetch`), `registry.Source`/`registry.Series`, `vintage.append`.
- Produces: `collect.SourceResult` frozen dataclass: `source: str, ok: bool, fetched: int, new_rows: int, error: str | None, finished_at: str` (`finished_at` = UTC ISO `%Y-%m-%dT%H:%M:%SZ`).
- Produces: `collect.collect_all(sources: dict[str, Source], series: list[Series], secrets: dict[str, str], store_dir: Path, http_get=None, http_post=None) -> list[SourceResult]` — one result per source that has series; a raising connector or missing required secret yields `ok=False` with the error string and NEVER prevents other sources from fetching and appending; provider series ids are remapped to internal registry codes before append.
- Produces: `collect.FETCHERS: dict[str, callable]` — source name → adapter; tests may monkeypatch it.

- [ ] **Step 1: Write the failing tests** — `tests/test_collect.py`:

```python
import pytest

from pipeline import collect
from pipeline.models import Observation
from pipeline.registry import Series, Source
from pipeline.store import vintage


def src(name, secret=None, optional=False):
    return Source(name=name, route="API", cadence="daily", secret=secret,
                  secret_optional=optional)


def ser(code, source, source_id=None):
    return Series(code=code, source=source, source_id=source_id or code,
                  name=code, max_staleness_days=7)


def ok_fetcher(subset, key, http):
    return [Observation(series_code=s.source_id, obs_date="2026-07-01", value=1.0,
                        vintage_date="2026-07-07", source=s.source, route="API")
            for s in subset]


def boom_fetcher(subset, key, http):
    raise RuntimeError("connector exploded")


def test_isolation_one_source_fails_others_append(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher, "B": boom_fetcher})
    sources = {"A": src("A"), "B": src("B")}
    series = [ser("a1", "A"), ser("b1", "B")]
    results = collect.collect_all(sources, series, {}, tmp_path)
    by = {r.source: r for r in results}
    assert by["A"].ok and by["A"].new_rows == 1
    assert not by["B"].ok and "connector exploded" in by["B"].error
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "a1") == [("2026-07-01", 1.0)]


def test_missing_required_secret_is_error_not_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A", secret="A_KEY")}
    results = collect.collect_all(sources, [ser("a1", "A")], {"A_KEY": ""}, tmp_path)
    assert not results[0].ok and "missing secret A_KEY" in results[0].error


def test_optional_secret_proceeds_when_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A", secret="A_KEY", optional=True)}
    results = collect.collect_all(sources, [ser("a1", "A")], {}, tmp_path)
    assert results[0].ok and results[0].new_rows == 1


def test_provider_ids_remapped_to_internal_codes(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A")}
    results = collect.collect_all(sources, [ser("nice_code", "A", "UGLY.ID")],
                                  {}, tmp_path)
    assert results[0].ok
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "nice_code") == [("2026-07-01", 1.0)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_collect.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 3: Implement `pipeline/collect.py`**

```python
"""Fan-out collection with per-connector failure isolation.

A broken source records an error in its SourceResult (surfaced via
sources_status.json and QA) and lowers freshness — it never blocks the run.
The store's carry-forward semantics make a missed day harmless.
"""
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from pipeline.connectors import bls, eia, fmp, fred, pmms, treasury, zillow
from pipeline.registry import Series, Source
from pipeline.store import vintage


@dataclass(frozen=True)
class SourceResult:
    source: str
    ok: bool
    fetched: int
    new_rows: int
    error: str | None
    finished_at: str  # UTC ISO


def _fred(subset, key, http):
    return fred.fetch([s.source_id for s in subset], key, http_get=http)


def _bls(subset, key, http):
    return bls.fetch([s.source_id for s in subset], key or None, http_post=http)


def _eia(subset, key, http):
    return eia.fetch([s.source_id for s in subset], key, http_get=http)


def _fmp(subset, key, http):
    return fmp.fetch([s.source_id for s in subset], key, http_get=http)


def _treasury(subset, key, http):
    return treasury.fetch(http_get=http)


def _zillow(subset, key, http):
    return zillow.fetch(http_get=http)


def _pmms(subset, key, http):
    return pmms.fetch(http_get=http)


FETCHERS = {"FRED": _fred, "BLS": _bls, "EIA": _eia, "FMP": _fmp,
            "TREASURY": _treasury, "ZILLOW": _zillow, "PMMS": _pmms}

# BLS posts; everything else gets. collect_all passes the right client through.
POST_SOURCES = {"BLS"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def collect_all(sources: dict[str, Source], series: list[Series],
                secrets: dict[str, str], store_dir: Path,
                http_get=None, http_post=None) -> list[SourceResult]:
    results: list[SourceResult] = []
    for name, source in sources.items():
        subset = [s for s in series if s.source == name]
        if not subset:
            continue
        key = secrets.get(source.secret, "") if source.secret else ""
        if source.secret and not key and not source.secret_optional:
            results.append(SourceResult(name, False, 0, 0,
                                        f"missing secret {source.secret}", _now()))
            continue
        http = http_post if name in POST_SOURCES else http_get
        try:
            obs = FETCHERS[name](subset, key, http)
            id_map = {s.source_id: s.code for s in subset}
            obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
                   for o in obs]
            new = vintage.append(obs, store_dir)
            results.append(SourceResult(name, True, len(obs), new, None, _now()))
        except Exception as e:  # isolation boundary: any connector error is contained
            results.append(SourceResult(name, False, 0, 0,
                                        f"{type(e).__name__}: {e}", _now()))
    return results
```

- [ ] **Step 4: Run tests, then full suite**

Run: `pytest tests/test_collect.py -v && pytest -q`
Expected: 4 pass; suite green

- [ ] **Step 5: Commit**

```bash
git add pipeline/collect.py tests/test_collect.py
git commit -m "feat: collect_all — per-connector failure isolation + code remap"
```

---

### Task 10: `sources_status.json` writer + schema

**Files:**
- Create: `pipeline/publish/sources_status.py`, `schemas/sources_status.schema.json`
- Test: `tests/test_sources_status.py`
- Modify: `tests/test_published_data.py` (add to CONTRACT)

**Interfaces:**
- Consumes: `SourceResult` (Task 9), `Source`/`Series` (Task 2), `vintage.max_obs_date` (Task 1).
- Produces: `sources_status.build(results: list[SourceResult], sources: dict[str, Source], series: list[Series], conn) -> dict` — `{"generated_at": ..., "sources": [{"name", "route", "cadence", "ok", "fetched", "new_rows", "error", "finished_at", "series_count", "latest_obs"}]}` sorted by name; `latest_obs` = max obs_date across the source's series (None if none).
- Produces: `sources_status.write(status: dict, out_dir: Path) -> Path` → `out_dir/sources_status.json`.

- [ ] **Step 1: Write the schema** — `schemas/sources_status.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "sources_status",
  "type": "object",
  "required": ["generated_at", "sources"],
  "additionalProperties": false,
  "properties": {
    "generated_at": {"type": "string"},
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "route", "cadence", "ok", "fetched", "new_rows",
                     "error", "finished_at", "series_count", "latest_obs"],
        "additionalProperties": false,
        "properties": {
          "name": {"type": "string"},
          "route": {"type": "string"},
          "cadence": {"type": "string"},
          "ok": {"type": "boolean"},
          "fetched": {"type": "integer"},
          "new_rows": {"type": "integer"},
          "error": {"type": ["string", "null"]},
          "finished_at": {"type": "string"},
          "series_count": {"type": "integer"},
          "latest_obs": {"type": ["string", "null"]}
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/test_sources_status.py`:

```python
from pathlib import Path

from pipeline.collect import SourceResult
from pipeline.models import Observation
from pipeline.publish import sources_status, validate
from pipeline.registry import Series, Source
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def test_build_and_write(tmp_path):
    vintage.append([Observation("a1", "2026-07-01", 1.0, "2026-07-07", "A", "API")],
                   tmp_path)
    conn = vintage.load(tmp_path)
    sources = {"A": Source("A", "API", "daily", None, False),
               "B": Source("B", "CSV", "weekly", None, False)}
    series = [Series("a1", "A", "a1", "a one", 7),
              Series("b1", "B", "b1", "b one", 21)]
    results = [
        SourceResult("A", True, 1, 1, None, "2026-07-07T12:41:00Z"),
        SourceResult("B", False, 0, 0, "HTTPError: 503", "2026-07-07T12:41:02Z"),
    ]
    status = sources_status.build(results, sources, series, conn)
    by = {s["name"]: s for s in status["sources"]}
    assert by["A"]["ok"] is True and by["A"]["latest_obs"] == "2026-07-01"
    assert by["B"]["ok"] is False and by["B"]["error"] == "HTTPError: 503"
    assert by["B"]["latest_obs"] is None
    assert by["A"]["series_count"] == 1

    path = sources_status.write(status, tmp_path / "out")
    validate.validate_file(path, SCHEMAS / "sources_status.schema.json")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_sources_status.py -v`
Expected: FAIL — `ImportError` (module missing)

- [ ] **Step 4: Implement `pipeline/publish/sources_status.py`**

```python
"""Writer for sources_status.json — per-connector health, in public."""
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from pipeline.store import vintage


def build(results, sources, series, conn) -> dict:
    by_source: dict[str, list] = {}
    for s in series:
        by_source.setdefault(s.source, []).append(s)
    rows = []
    for r in sorted(results, key=lambda r: r.source):
        src = sources[r.source]
        codes = [s.code for s in by_source.get(r.source, [])]
        latest = [d for d in (vintage.max_obs_date(conn, c) for c in codes)
                  if d is not None]
        rows.append({"name": r.source, "route": src.route, "cadence": src.cadence,
                     **{k: v for k, v in asdict(r).items() if k != "source"},
                     "series_count": len(codes),
                     "latest_obs": max(latest) if latest else None})
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": rows}


def write(status: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "sources_status.json"
    path.write_text(json.dumps(status, indent=2) + "\n")
    return path
```

- [ ] **Step 5: Add the file to the published-data contract guard** — in `tests/test_published_data.py`, extend `CONTRACT`:

```python
CONTRACT = [("pulse_lite.json", "pulse_lite.schema.json"),
            ("qa.json", "qa.schema.json"),
            ("sources_status.json", "sources_status.schema.json")]
```

- [ ] **Step 6: Run tests, then full suite**

Run: `pytest tests/test_sources_status.py tests/test_published_data.py -v && pytest -q`
Expected: pass (the sources_status contract row skips until Task 12's live run publishes it); suite green

- [ ] **Step 7: Commit**

```bash
git add pipeline/publish/sources_status.py schemas/sources_status.schema.json tests/test_sources_status.py tests/test_published_data.py
git commit -m "feat: sources_status writer + schema — connector health in public"
```

---

### Task 11: QA v1 — connector + freshness checks, staleness 80d

**Files:**
- Modify: `pipeline/publish/qa.py`
- Test: `tests/test_qa.py` (extend)

**Interfaces:**
- Consumes: `SourceResult` (Task 9).
- Produces: `qa.run_checks(cpi: dict, today: str, source_results: list | None = None, freshness: list[dict] | None = None) -> dict` — same return shape as before (validates against the existing `qa.schema.json`). New checks appended when args provided: `connectors_ok` (critical False — pass iff every SourceResult.ok; detail lists failures) and `sources_fresh` (critical False — freshness rows are `{"code": str, "latest_obs": str | None, "limit_days": int}`; a row is stale when `latest_obs` is None or older than `limit_days` before `today`; detail lists stale codes). `STALE_DAYS` becomes 80 (final-review calibration: 75 had ~1 day of headroom before a normal CPI release).
- Existing 2-arg calls keep working (`total` stays 2 when the new args are omitted).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_qa.py`)

```python
from pipeline.collect import SourceResult


def _res(name, ok, err=None):
    return SourceResult(name, ok, 1 if ok else 0, 0, err, "2026-07-07T12:41:00Z")


def test_connector_and_freshness_checks_green():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      source_results=[_res("FRED", True), _res("EIA", True)],
                      freshness=[{"code": "CPIAUCNS", "latest_obs": "2026-05-01",
                                  "limit_days": 80}])
    assert (r["passed"], r["total"]) == (4, 4)


def test_connector_failure_flagged_not_critical():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      source_results=[_res("FRED", True),
                                      _res("EIA", False, "HTTPError: 503")])
    by = {c["name"]: c for c in r["checks"]}
    assert by["connectors_ok"]["pass"] is False
    assert by["connectors_ok"]["critical"] is False
    assert "EIA" in by["connectors_ok"]["detail"]


def test_stale_and_never_seen_series_flagged():
    r = qa.run_checks(FRESH, today="2026-07-07",
                      freshness=[
                          {"code": "fresh1", "latest_obs": "2026-07-01", "limit_days": 7},
                          {"code": "stale1", "latest_obs": "2026-05-01", "limit_days": 21},
                          {"code": "never1", "latest_obs": None, "limit_days": 7}])
    by = {c["name"]: c for c in r["checks"]}
    assert by["sources_fresh"]["pass"] is False
    assert "stale1" in by["sources_fresh"]["detail"]
    assert "never1" in by["sources_fresh"]["detail"]
    assert "fresh1" not in by["sources_fresh"]["detail"]


def test_stale_days_is_80():
    assert qa.STALE_DAYS == 80
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_qa.py -v`
Expected: new tests FAIL (`TypeError: unexpected keyword argument` / STALE_DAYS 75); the 4 original tests still pass

- [ ] **Step 3: Implement** — replace `pipeline/publish/qa.py`'s `STALE_DAYS` and `run_checks` with:

```python
STALE_DAYS = 80  # ~1 CPI cycle + release slip headroom (final-review calibration)


def run_checks(cpi: dict, today: str, source_results: list | None = None,
               freshness: list[dict] | None = None) -> dict:
    age = (date.fromisoformat(today) - date.fromisoformat(cpi["month"])).days
    checks = [
        {"name": "headline_current", "critical": True,
         "pass": age <= STALE_DAYS,
         "detail": f"latest official month {cpi['month']} is {age}d old (limit {STALE_DAYS})"},
        {"name": "yoy_finite", "critical": True,
         "pass": math.isfinite(cpi["yoy_pct"]) and math.isfinite(cpi["prev_yoy_pct"]),
         "detail": f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"},
    ]
    if source_results is not None:
        failed = [f"{r.source}: {r.error}" for r in source_results if not r.ok]
        checks.append({"name": "connectors_ok", "critical": False,
                       "pass": not failed,
                       "detail": (f"{len(source_results) - len(failed)}"
                                  f"/{len(source_results)} ok"
                                  + (f"; failed — {'; '.join(failed)}" if failed else ""))})
    if freshness is not None:
        stale = []
        for row in freshness:
            if row["latest_obs"] is None:
                stale.append(f"{row['code']} (never seen)")
                continue
            days = (date.fromisoformat(today) - date.fromisoformat(row["latest_obs"])).days
            if days > row["limit_days"]:
                stale.append(f"{row['code']} ({days}d > {row['limit_days']}d)")
        checks.append({"name": "sources_fresh", "critical": False,
                       "pass": not stale,
                       "detail": (f"{len(freshness) - len(stale)}/{len(freshness)} fresh"
                                  + (f"; stale — {', '.join(stale)}" if stale else ""))})
    return {"generated_at": today, "passed": sum(c["pass"] for c in checks),
            "total": len(checks), "checks": checks}
```

(Keep the module docstring, imports, and `write()` unchanged.)

- [ ] **Step 4: Run tests, then full suite**

Run: `pytest tests/test_qa.py -v && pytest -q`
Expected: 8 qa tests pass; suite green

- [ ] **Step 5: Commit**

```bash
git add pipeline/publish/qa.py tests/test_qa.py
git commit -m "feat: QA v1 — connector + per-series freshness checks, staleness 80d"
```

---

### Task 12: Rewire `run_daily` + secrets + live seed run

**Files:**
- Modify: `pipeline/run_daily.py`, `.github/workflows/daily.yml`
- Test: `tests/test_run_daily.py` (rewrite the integration test)
- Create (generated): refreshed `site/public/data/*.json`, new store partitions

**Interfaces:**
- Consumes: everything from Tasks 1-11, exact signatures as specified there.
- Produces: `run_daily.main(argv=None, http_get=None, http_post=None) -> int` — loads the registry, collects all sources (isolated), publishes `pulse_lite.json` (unchanged shape), `sources_status.json`, and `qa.json` (4 checks), validates each, prints one line per source + one per artifact. Exits with a clean `SystemExit("FRED_API_KEY not set")` when the var is missing **or empty** (Actions passes unset secrets as `""`). Connector failures do NOT fail the run.

- [ ] **Step 1: Rewrite the integration test** — replace `tests/test_run_daily.py` with:

```python
import json
from pathlib import Path

import pytest

from pipeline import run_daily
from tests.test_bls import fake_post as bls_fake_post
from tests.test_fred import FakeResponse, fake_get as fred_fake_get

FIXTURES = Path(__file__).parent / "fixtures"


def fake_get(url, params=None, timeout=None):
    if "api.stlouisfed.org" in url:
        return fred_fake_get(url, params=params, timeout=timeout)
    if "api.eia.gov" in url:
        name = "eia_weekly.json" if ".W" in url else "eia_monthly.json"
        return FakeResponse(json.loads((FIXTURES / name).read_text()))
    if "financialmodelingprep.com" in url:
        return FakeResponse(json.loads((FIXTURES / "fmp_quote.json").read_text()))
    if "fiscaldata.treasury.gov" in url:
        return FakeResponse(json.loads((FIXTURES / "treasury_debt.json").read_text()))
    if "zillowstatic.com" in url:
        name = "zillow_zori.csv" if "zori" in url else "zillow_zhvi.csv"
        return _text(FIXTURES / name)
    if "freddiemac.com" in url:
        return _text(FIXTURES / "pmms.csv")
    raise AssertionError(f"unexpected url {url}")


class _TextResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _text(path):
    return _TextResponse(path.read_text())


def fake_post(url, json=None, timeout=None):
    class R:
        def raise_for_status(self):
            pass

        def json(self):
            import json as j
            return j.loads((FIXTURES / "bls_ap.json").read_text())
    return R()


def set_keys(monkeypatch):
    for k in ("FRED_API_KEY", "EIA_API_KEY", "BLS_API_KEY", "FMP_API_KEY"):
        monkeypatch.setenv(k, "test-key")


def test_end_to_end_all_sources(tmp_path, monkeypatch):
    set_keys(monkeypatch)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    pulse = json.loads((out / "pulse_lite.json").read_text())
    assert pulse["official_cpi"]["month"] == "2026-04-01"
    status = json.loads((out / "sources_status.json").read_text())
    assert len(status["sources"]) == 7
    assert all(s["ok"] for s in status["sources"])
    qa = json.loads((out / "qa.json").read_text())
    assert qa["total"] == 4


def test_one_source_down_still_publishes(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def get_with_eia_down(url, params=None, timeout=None):
        if "api.eia.gov" in url:
            raise RuntimeError("EIA 503")
        return fake_get(url, params=params, timeout=timeout)

    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=get_with_eia_down, http_post=fake_post)
    assert rc == 0  # publication never blocks
    status = json.loads((out / "sources_status.json").read_text())
    eia_row = [s for s in status["sources"] if s["name"] == "EIA"][0]
    assert eia_row["ok"] is False


def test_missing_fred_key_clean_exit(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "")  # Actions passes unset secrets as ""
    with pytest.raises(SystemExit, match="FRED_API_KEY"):
        run_daily.main(["--store", str(tmp_path / "s"), "--out", str(tmp_path / "o")])
```

Notes for the implementer: the BLS fixture `fake_post` in `tests/test_bls.py` asserts on its exact payload — this file defines its own laxer `fake_post` instead. The fixture-driven FRED data ends at month 2026-04, hence the pulse assertion.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_run_daily.py -v`
Expected: FAIL — `TypeError: main() got an unexpected keyword argument 'http_post'` (and missing behaviors)

- [ ] **Step 3: Rewrite `pipeline/run_daily.py`**

```python
"""Daily publish run: collect (isolated) -> store -> engine -> publish -> validate.

Connector failures never block publication — they surface in
sources_status.json and qa.json, and stale series carry forward.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pipeline import collect, registry
from pipeline.connectors import fred
from pipeline.engine import official
from pipeline.publish import pulse_lite, qa, sources_status, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def main(argv=None, http_get=None, http_post=None) -> int:
    parser = argparse.ArgumentParser(description="macrogauge daily publish run")
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    if not os.environ.get("FRED_API_KEY"):
        sys.exit("FRED_API_KEY not set (empty or missing env var)")

    sources, series = registry.load_registry()
    secrets = {src.secret: os.environ.get(src.secret, "")
               for src in sources.values() if src.secret}

    results = collect.collect_all(sources, series, secrets, args.store,
                                  http_get=http_get, http_post=http_post)
    for r in results:
        print(f"source {r.source}: "
              + (f"ok, {r.fetched} fetched, {r.new_rows} new" if r.ok
                 else f"FAILED — {r.error}"))

    conn = vintage.load(args.store)
    cpi = official.latest_yoy(conn, "CPIAUCNS")

    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pulse_path = pulse_lite.write(cpi, args.out, published_at=published_at)
    validate.validate_file(pulse_path, SCHEMAS / "pulse_lite.schema.json")
    print(f"published: {pulse_path} (CPI YoY {round(cpi['yoy_pct'], 2)}%, month {cpi['month']})")

    status = sources_status.build(results, sources, series, conn)
    status_path = sources_status.write(status, args.out)
    validate.validate_file(status_path, SCHEMAS / "sources_status.schema.json")
    print(f"published: {status_path}")

    freshness = [{"code": s.code, "latest_obs": vintage.max_obs_date(conn, s.code),
                  "limit_days": s.max_staleness_days} for s in series]
    qa_path = qa.write(qa.run_checks(cpi, today=fred.today_et(),
                                     source_results=results, freshness=freshness),
                       args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests, then full suite**

Run: `pytest tests/test_run_daily.py -v && pytest -q`
Expected: 3 pass; suite green

- [ ] **Step 5: Obtain and store the new API keys** (user actions where a key doesn't exist yet):
- **EIA** (required): free instant key at https://www.eia.gov/opendata/register.php
- **BLS** (optional but recommended): https://data.bls.gov/registrationEngine/
- **FMP** (required): the user's existing FMP account → dashboard → API key
- Append each to `~/Development/macrogauge/.env` (`EIA_API_KEY=...`, `BLS_API_KEY=...`, `FMP_API_KEY=...`) — never commit or print them
- Set repo secrets: `cd ~/Development/macrogauge && for k in EIA_API_KEY BLS_API_KEY FMP_API_KEY; do gh secret set $k --body "$(grep "^$k=" .env | cut -d= -f2-)"; done && gh secret list`

- [ ] **Step 6: Add the secrets to `.github/workflows/daily.yml`** — in the "Run pipeline" step, extend `env`:

```yaml
        env:
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          EIA_API_KEY: ${{ secrets.EIA_API_KEY }}
          BLS_API_KEY: ${{ secrets.BLS_API_KEY }}
          FMP_API_KEY: ${{ secrets.FMP_API_KEY }}
```

- [ ] **Step 7: Live seed run** (real keys, all 7 sources):

```bash
cd ~/Development/macrogauge && export $(grep -v '^#' .env | xargs) \
  && python -m pipeline.run_daily --store store --out site/public/data
cat site/public/data/sources_status.json
pytest tests/test_published_data.py -v
```
Expected: 7 "source … ok" lines (a failure in any single source is acceptable IF its error is visibly environmental — report it rather than hiding it); `sources_status.json` shows per-source health; published-data guards pass. Sanity-check a couple of values (ZORI ~$2k rent, debt ~$38T, gold in $3-4k range).

- [ ] **Step 8: Commit code + data, push, dispatch once**

```bash
git add pipeline/run_daily.py .github/workflows/daily.yml tests/test_run_daily.py \
        site/public/data/ store/obs/
git commit -m "feat: run_daily v2 — registry-driven collection, 7 sources, status + QA v1"
git push
gh workflow run daily
sleep 20 && gh run list --workflow daily --limit 1 --json status,conclusion
```
Expected: workflow completes green (poll until `"status":"completed","conclusion":"success"`); the bot's data commit follows and Vercel deploys it.

---

## Self-review notes (completed)

- **Spec coverage (Plan 1a slice):** registry ✓ (T2, JSON deviation locked in header), 7 connectors ✓ (T3-T8 + existing FRED), isolation ✓ (T9), sources_status ✓ (T10), QA growth ✓ (T11), rewire + secrets ✓ (T12). Final-review entry tasks: row-evolution ✓ (T1), isolation-before-connector-2 ✓ (T9 precedes nothing that adds engine load), staleness 80d ✓ (T11), env guard ✓ (T12). Rounding owner intentionally deferred to Plan 1b (stated in header). Engine stages/variants/homepage → Plans 1b/1c.
- **Type consistency:** `SourceResult` fields match `sources_status.build`'s `asdict` spread and the schema's required list ✓; `Series.max_staleness_days` flows into freshness rows' `limit_days` ✓; `bls.fetch` takes `http_post` (POST API) and `collect_all` routes it via `POST_SOURCES` ✓; `qa.run_checks` stays backward-compatible with Phase-0 calls ✓ (existing tests untouched); `run_daily` passes `http_post` through (test_bls's strict `fake_post` not reused — noted in T12 Step 1).
- **Placeholder scan:** clean — every step carries complete code/fixtures/commands.
- **Known risks stated in-plan:** Zillow CSV URLs move (constants + QA catch it); FRED `CUUR…` ids are verified live by the T12 seed run (a bad id fails only that source, visibly); EIA seriesid compat route returns `{response:{data:[…]}}` — fixture matches that shape.
