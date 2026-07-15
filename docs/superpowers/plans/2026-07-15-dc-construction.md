# DC Construction Boom Implementation Plan (Wave 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Census C30 data-center construction spending on `/datacenter` — nominal SAAR level, NSA same-month YoY, and real spend deflated by our DC Build index, per `docs/superpowers/specs/2026-07-15-dc-construction-design.md`.

**Architecture:** New keyless `CENSUS` connector (openpyxl xlsx parse, house drift protection) → two registry series → pure `construction_block` in the dcindex engine (deflation + YoY) → nullable `construction` block in `datacenter.json` (schema-pinned) → new chart + stat cards on the page.

**Tech Stack:** Python 3.12 pipeline (+ new dep openpyxl>=3.1), pytest, Next.js static site, echarts, Playwright.

## Global Constraints

- **No network in tests, ever.** Census fixtures are xlsx bytes GENERATED in-test via openpyxl — no binary blobs committed, no fetches.
- **Drift protection is a hard convention for file/scrape sources:** pinned sheet name, header row located by "Date", column located by header TEXT (never position), strict date-label regex `^[A-Z][a-z]{2}-\d{2}[pr]?$`, plausible range [50, 500000] $M, "structure drift?" ValueError on any miss.
- **Connector failure isolation:** any census error fails only the CENSUS SourceResult; never blocks the run.
- **`construction_block` returns `None` (never raises) when either Census series is absent from the store.**
- **`jsonschema.ValidationError` re-raises and fails the run** — untouched invariant.
- Real-terms values are constant 2018-01 dollars: `saar[m] / (build_index[m]/100)`, `null` where the deflator month is absent from the Build daily grid.
- Site computes nothing beyond presentation ($M→$B display division and conditional render are presentation).
- Known transient (same as wave 1): after Task 4 pins `construction` in the schema, `test_published_data` goes red on the stale committed `datacenter.json` until Task 5 regenerates it. Expected; disclosed; Task 5 immediately follows.
- Commit after every task. Do NOT push (push = deploy; user approves).
- Test pins that move this wave: `tests/test_run_daily.py:146` sources 16→17; `tests/test_registry.py` sources set + `len(series)` 240→242. FRED count (73) does NOT change.

---

### Task 1: CENSUS connector + openpyxl dependency

**Files:**
- Create: `pipeline/connectors/census.py`
- Modify: `pipeline/connectors/util.py` (add `get_bytes`), `pyproject.toml` (add openpyxl)
- Test: `tests/test_census.py` (new)

**Interfaces:**
- Consumes: `pipeline.connectors.util.get_bytes(url, http_get) -> bytes` (created here), `pipeline.connectors.fred.today_et`, `pipeline.models.Observation`.
- Produces: `census.fetch(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]` with `source_id` format `<filename>:<column header>`; Observations carry `series_code=<source_id>` (collect's id_map remaps), `source="CENSUS"`, `route="XLSX"`. Task 2 wires this into collect.

- [ ] **Step 1: Add the dependency and helper.** `pyproject.toml`:

```toml
dependencies = ["requests>=2.32", "jsonschema>=4.23", "openpyxl>=3.1"]
```

Run `.venv/bin/pip install -e ".[dev]"` (openpyxl is already present in this venv from the design session; the pyproject line is what CI needs). Append to `pipeline/connectors/util.py`:

```python
def get_bytes(url: str, http_get) -> bytes:
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.content
```

- [ ] **Step 2: Write the failing tests.** Create `tests/test_census.py`:

```python
import io

import openpyxl
import pytest

from pipeline.connectors import census


def _xlsx(sheet="Private SA",
          header=("Date", "Total", "Data center"),
          rows=(("May-26p", 1668966, 61000), ("Apr-26r", 1650000, 60000),
                ("Jan-14", 900000, 1500)),
          footer=(("",), ("The Census Bureau has reviewed this data product.",))):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(["Value of Private Construction Put in Place"])
    ws.append(["(Millions of dollars)"])
    ws.append([])
    ws.append(list(header))
    for r in rows:
        ws.append(list(r))
    for r in footer:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class _BytesResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def _get(content_by_file, calls=None):
    def http_get(url, timeout=None):
        if calls is not None:
            calls.append(url)
        fname = url.rsplit("/", 1)[1]
        return _BytesResponse(content_by_file[fname])
    return http_get


def test_happy_path_both_files_and_suffix_stripping():
    http = _get({"privsatime.xlsx": _xlsx("Private SA"),
                 "privtime.xlsx": _xlsx("Private NSA",
                                        rows=(("May-26p", 144936, 5059),
                                              ("Jan-14", 75000, 124)))})
    obs = census.fetch(["privsatime.xlsx:Data center", "privtime.xlsx:Data center"],
                       vintage_date="2026-07-15", http_get=http)
    saar = {o.obs_date: o.value for o in obs
            if o.series_code == "privsatime.xlsx:Data center"}
    nsa = {o.obs_date: o.value for o in obs
           if o.series_code == "privtime.xlsx:Data center"}
    assert saar == {"2026-05-01": 61000.0, "2026-04-01": 60000.0, "2014-01-01": 1500.0}
    assert nsa == {"2026-05-01": 5059.0, "2014-01-01": 124.0}
    assert {o.source for o in obs} == {"CENSUS"}
    assert {o.route for o in obs} == {"XLSX"}
    assert {o.vintage_date for o in obs} == {"2026-07-15"}


def test_one_get_per_distinct_file():
    calls = []
    http = _get({"privsatime.xlsx": _xlsx("Private SA",
                                          header=("Date", "Office", "Data center"),
                                          rows=(("May-26p", 107558, 61000),))},
                calls)
    census.fetch(["privsatime.xlsx:Data center", "privsatime.xlsx:Office"],
                 vintage_date="2026-07-15", http_get=http)
    assert len(calls) == 1


def test_blank_target_cells_skipped():
    http = _get({"privsatime.xlsx": _xlsx(rows=(("May-26p", 1668966, 61000),
                                                ("Dec-13", 890000, None)))})
    obs = census.fetch(["privsatime.xlsx:Data center"],
                       vintage_date="2026-07-15", http_get=http)
    assert [o.obs_date for o in obs] == ["2026-05-01"]


@pytest.mark.parametrize("kwargs,match", [
    ({"sheet": "Sheet1"}, "structure drift"),
    ({"header": ("Month", "Total", "Data center")}, "structure drift"),
    ({"header": ("Date", "Total", "Office")}, "structure drift"),
    ({"rows": (("May-26p", 1668966, 9_999_999),)}, "structure drift"),
    ({"rows": ()}, "structure drift"),
])
def test_drift_checks_raise(kwargs, match):
    http = _get({"privsatime.xlsx": _xlsx(**kwargs)})
    with pytest.raises(ValueError, match=match):
        census.fetch(["privsatime.xlsx:Data center"],
                     vintage_date="2026-07-15", http_get=http)
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/test_census.py -q`
Expected: FAIL — `cannot import name 'census'`.

- [ ] **Step 4: Create `pipeline/connectors/census.py`:**

```python
"""Census C30 'Value of Construction Put in Place' workbooks — data center column.

Census retired the EITS timeseries API (verified HTTP 302, 2026-07-15), so the
published xlsx workbooks are the only programmatic route. Each fetch carries
the full 2014->now history; vintage.append's value-dedupe means only genuine
revisions (Census p/r cycles) write new rows — an auditable revision trail.

Drift protection (house convention, xlsx dialect): pinned sheet name per file,
header row located by 'Date', target column located by header TEXT (never
position), strict date-label regex, plausible value range — any miss raises a
"structure drift?" ValueError contained by collect's isolation boundary.
"""
import io
import re
from datetime import datetime

import openpyxl
import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_bytes
from pipeline.models import Observation

BASE_URL = "https://www.census.gov/construction/c30/xlsx/"
SHEETS = {"privsatime.xlsx": "Private SA", "privtime.xlsx": "Private NSA"}
DATE_RE = re.compile(r"^[A-Z][a-z]{2}-\d{2}[pr]?$")
VALUE_RANGE = (50.0, 500_000.0)  # $M; NSA runs ~124->5,059, SAAR ~1,500->61,000


def _norm(cell) -> str:
    return " ".join(str(cell).split()) if cell is not None else ""


def _parse_date(label: str) -> str:
    # 'May-26p' / 'Apr-26r' -> '2026-05-01' (p/r are Census revision suffixes)
    return datetime.strptime(label.rstrip("pr"), "%b-%y").strftime("%Y-%m-01")


def _column(rows: list, filename: str, column: str) -> dict[str, float]:
    header_i = next((i for i, r in enumerate(rows[:8])
                     if r and _norm(r[0]) == "Date"), None)
    if header_i is None:
        raise ValueError(f"census {filename}: no 'Date' header row — structure drift?")
    header = [_norm(c).lower() for c in rows[header_i]]
    if column.lower() not in header:
        raise ValueError(f"census {filename}: no '{column}' column — structure drift?")
    col = header.index(column.lower())
    out: dict[str, float] = {}
    for r in rows[header_i + 1:]:
        label = _norm(r[0]) if r else ""
        if not DATE_RE.match(label):
            break  # footer disclosure notes end the data block
        if col < len(r) and r[col] is not None and str(r[col]).strip() != "":
            value = float(r[col])
            if not VALUE_RANGE[0] <= value <= VALUE_RANGE[1]:
                raise ValueError(
                    f"census {filename}: {column} value {value} outside plausible "
                    f"range {VALUE_RANGE} — structure drift?")
            out[_parse_date(label)] = value
    if not out:
        raise ValueError(f"census {filename}: zero data rows parsed — structure drift?")
    return out


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id format: '<filename>:<column header>'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted: dict[str, list[tuple[str, str]]] = {}
    for sid in source_ids:
        filename, column = sid.split(":", 1)
        wanted.setdefault(filename, []).append((sid, column))
    out: list[Observation] = []
    for filename, cols in wanted.items():
        wb = openpyxl.load_workbook(
            io.BytesIO(get_bytes(BASE_URL + filename, http_get)), read_only=True)
        expected = SHEETS.get(filename)
        if expected is None or expected not in wb.sheetnames:
            raise ValueError(
                f"census {filename}: expected sheet '{expected}' not found "
                f"(sheets: {wb.sheetnames}) — structure drift?")
        rows = list(wb[expected].iter_rows(values_only=True))
        for sid, column in cols:
            for obs_date, value in _column(rows, filename, column).items():
                out.append(Observation(series_code=sid, obs_date=obs_date,
                                       value=value, vintage_date=vintage,
                                       source="CENSUS", route="XLSX"))
    return out
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/test_census.py -q`
Expected: PASS (8 tests).

- [ ] **Step 6: Full suite** — `.venv/bin/pytest -q` → 359 passed (351 + 8 new: 3 tests + 5 parametrized drift cases); report the actual total.

- [ ] **Step 7: Commit**

```bash
git add pipeline/connectors/census.py pipeline/connectors/util.py pyproject.toml tests/test_census.py
git commit -m "feat(connectors): CENSUS C30 xlsx connector with drift protection (+openpyxl dep)"
```

---

### Task 2: Registry + collect wiring + test fakes

**Files:**
- Modify: `config/series.json`, `pipeline/collect.py`, `tests/test_registry.py`, `tests/test_run_daily.py`

**Interfaces:**
- Consumes: Task 1's `census.fetch`.
- Produces: registry codes `census_dc_constr_saar` / `census_dc_constr_nsa` (Task 3 reads them from the store by these names); CENSUS source key collected automatically by `collect_all`.

- [ ] **Step 1: Update the failing pins first.** `tests/test_registry.py`: add `"CENSUS"` to the sources set; `len(series)` 240 → 242. `tests/test_run_daily.py:146`: `len(status["sources"]) == 16` → `17`.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_registry.py -q`
Expected: FAIL — sources set mismatch.

- [ ] **Step 3: `config/series.json`.** Add to `"sources"` (after `"QCEW"`):

```json
"CENSUS": {"route": "XLSX", "cadence": "monthly"}
```

Append to `"series"` (after the `cpi_computers` entry):

```json
{"code": "census_dc_constr_saar", "source": "CENSUS", "source_id": "privsatime.xlsx:Data center", "name": "Data center construction spend, SAAR ($M, annual rate)", "max_staleness_days": 75},
{"code": "census_dc_constr_nsa", "source": "CENSUS", "source_id": "privtime.xlsx:Data center", "name": "Data center construction spend, NSA ($M/month)", "max_staleness_days": 75}
```

- [ ] **Step 4: `pipeline/collect.py`.** Add `census` to the connectors import at line 12 (alphabetical: after `bls,`... actual list is `(aaa, aptlist, bls, cleveland, eia, fmp, fred, kalshi, manheim, mnd, pmms, qcew, treasury, usda, zillow)` → insert `census,` after `bls,`). Add the wrapper next to `_qcew` and the FETCHERS entry:

```python
def _census(subset, key, http):
    return census.fetch([s.source_id for s in subset], http_get=http)
```

```python
            "KALSHI": _kalshi,
            # EIA_STATE is a separate source key only for failure isolation
            # and its own status row — the fetch mechanics are plain EIA.
            "EIA_STATE": _eia, "QCEW": _qcew, "CENSUS": _census}
```

- [ ] **Step 5: `tests/test_run_daily.py` fake.** Add near the other module-level fixtures (after `FMP_QUOTES`):

```python
def _census_wb(sheet, rows):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(["Value of Private Construction Put in Place"])
    ws.append(["(Millions of dollars)"])
    ws.append([])
    ws.append(["Date", "Total", "Data center"])
    for r in rows:
        ws.append(list(r))
    ws.append(["The Census Bureau has reviewed this data product."])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_CENSUS_XLSX = {
    "privsatime.xlsx": _census_wb("Private SA", [
        ("Jun-26p", 1668966, 61000), ("Jun-25", 1500000, 45000), ("Jan-14", 900000, 1500)]),
    "privtime.xlsx": _census_wb("Private NSA", [
        ("Jun-26p", 144936, 5059), ("Jun-25", 130000, 3900), ("Jan-14", 75000, 124)]),
}


class _BytesResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass
```

Add `import io` to the file's imports if absent. Add the `fake_get` branch (before the final `raise AssertionError`):

```python
    if "census.gov/construction" in url:
        return _BytesResponse(_CENSUS_XLSX[url.rsplit("/", 1)[1]])
```

- [ ] **Step 6: Full suite**

Run: `.venv/bin/pytest -q`
Expected: PASS. The end-to-end test now collects CENSUS (17th source row in `sources_status`); nothing consumes the series yet.

- [ ] **Step 7: Commit**

```bash
git add config/series.json pipeline/collect.py tests/test_registry.py tests/test_run_daily.py
git commit -m "feat(registry): CENSUS source + 2 DC construction series wired into collect"
```

---

### Task 3: Engine — construction_block + construction_from_store

**Files:**
- Modify: `pipeline/engine/dcindex.py`
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: store codes from Task 2; `dc_result["indexes"]["build"]["index"]` (the Build daily grid dict) from `dcindex.run`.
- Produces: `construction_block(saar: dict, nsa: dict, build_index: dict) -> dict | None` and `construction_from_store(conn, dc_result) -> dict | None` returning `{"as_of","unit","latest_saar","yoy_pct","yoy_asof","vs_2014_avg","months","saar","real"}` — Task 4's writer consumes this exact shape.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_dcindex.py`):

```python
def test_construction_block_deflation_yoy_and_2014_avg():
    saar = {"2014-01-01": 1500.0, "2014-07-01": 2500.0,
            "2018-01-01": 20000.0, "2019-01-01": 30000.0}
    nsa = {"2018-01-01": 1600.0, "2019-01-01": 2000.0}
    build = {"2018-01-01": 100.0, "2019-01-01": 125.0}
    out = dcindex.construction_block(saar, nsa, build)
    assert out["months"] == ["2014-01-01", "2014-07-01", "2018-01-01", "2019-01-01"]
    assert out["saar"] == [1500.0, 2500.0, 20000.0, 30000.0]
    # deflator missing for 2014 months -> null; 30000/(125/100) = 24000
    assert out["real"] == [None, None, 20000.0, pytest.approx(24000.0)]
    assert out["yoy_pct"] == pytest.approx(25.0)      # NSA 2000 vs 1600
    assert out["yoy_asof"] == "2019-01-01"
    assert out["as_of"] == "2019-01-01"
    assert out["latest_saar"] == 30000.0
    assert out["unit"] == "$M"
    assert out["vs_2014_avg"] == pytest.approx(15.0)  # 30000 / mean(1500, 2500)


def test_construction_block_yoy_none_when_base_missing():
    out = dcindex.construction_block(
        {"2018-01-01": 100.0}, {"2018-01-01": 10.0}, {"2018-01-01": 100.0})
    assert out["yoy_pct"] is None
    assert out["vs_2014_avg"] is None                 # no 2014 obs


def test_construction_block_none_on_empty_inputs():
    assert dcindex.construction_block({}, {"2018-01-01": 1.0}, {}) is None
    assert dcindex.construction_block({"2018-01-01": 1.0}, {}, {}) is None


def test_construction_from_store(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("census_dc_constr_saar", "2018-01-01", 20000.0),
        ("census_dc_constr_nsa", "2018-01-01", 1600.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    dc_result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    out = dcindex.construction_from_store(conn, dc_result)
    # both build components rebase to 100.0 at base month 2018-01 -> deflator 100
    assert out["months"] == ["2018-01-01"]
    assert out["real"] == [pytest.approx(20000.0)]


def test_construction_from_store_none_before_first_collect(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    dc_result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    assert dcindex.construction_from_store(conn, dc_result) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_dcindex.py -q -k construction`
Expected: FAIL — `AttributeError: ... 'construction_block'`.

- [ ] **Step 3: Implement** (append to `pipeline/engine/dcindex.py`):

```python
def construction_block(saar: dict[str, float], nsa: dict[str, float],
                       build_index: dict[str, float]) -> dict | None:
    """Census C30 DC construction: nominal SAAR, real SAAR (constant 2018-01
    dollars via the DC Build deflator sampled at month-firsts), and NSA
    same-month YoY. Returns None when either series is absent from the store
    (pre-first-collect / test contexts) — never raises; the page hides the
    section. Month arithmetic, not the 365-day daily grid: this series never
    joins an index basket."""
    if not saar or not nsa:
        return None
    months = sorted(saar)
    real = []
    for m in months:
        deflator = build_index.get(m)
        real.append(None if deflator is None else saar[m] / (deflator / 100.0))
    nsa_last = max(nsa)
    base = nsa.get(f"{int(nsa_last[:4]) - 1}{nsa_last[4:]}")
    y2014 = [v for m, v in saar.items() if m.startswith("2014-")]
    latest = months[-1]
    return {"as_of": latest, "unit": "$M",
            "latest_saar": saar[latest],
            "yoy_pct": None if base is None else (nsa[nsa_last] / base - 1) * 100.0,
            "yoy_asof": nsa_last,
            "vs_2014_avg": (saar[latest] / (sum(y2014) / len(y2014))
                            if y2014 else None),
            "months": months,
            "saar": [saar[m] for m in months],
            "real": real}


def construction_from_store(conn: sqlite3.Connection, dc_result: dict) -> dict | None:
    """Store-driven wrapper (parity_from_store pattern): the two Census series
    plus the Build daily grid already computed in dc_result as the deflator."""
    return construction_block(
        _series(conn, "census_dc_constr_saar"),
        _series(conn, "census_dc_constr_nsa"),
        dc_result["indexes"]["build"]["index"])
```

- [ ] **Step 4: Run to verify pass** — `.venv/bin/pytest tests/test_dcindex.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): construction_block — nominal/real SAAR + NSA YoY (pure, nullable)"
```

---

### Task 4: Publisher + schema + run_daily wiring

**Files:**
- Modify: `pipeline/publish/datacenter.py`, `schemas/datacenter.schema.json`, `pipeline/run_daily.py`
- Test: `tests/test_datacenter_writer.py`

**Interfaces:**
- Consumes: Task 3's block shape.
- Produces: `datacenter.build(dc_result, parity_result, source_ids, construction)` — **fourth positional parameter** (`dict | None`). Published `construction` rounds all dollar values and ratios to 1 dp, preserves nulls.

- [ ] **Step 1: Write the failing tests.** In `tests/test_datacenter_writer.py` add after `SOURCE_IDS`:

```python
CONSTRUCTION = {"as_of": "2026-05-01", "unit": "$M",
                "latest_saar": 61000.04, "yoy_pct": 30.239, "yoy_asof": "2026-05-01",
                "vs_2014_avg": 39.812,
                "months": ["2014-01-01", "2026-05-01"],
                "saar": [1500.0, 61000.04], "real": [None, 41200.049]}
```

Update both existing tests to pass `CONSTRUCTION` as the fourth arg and add assertions to the first:

```python
    c = payload["construction"]
    assert c["latest_saar"] == 61000.0 and c["yoy_pct"] == 30.2
    assert c["vs_2014_avg"] == 39.8
    assert c["real"] == [None, 41200.0]
    assert len(c["months"]) == len(c["saar"]) == len(c["real"])
```

Add a null-block test:

```python
def test_null_construction_validates(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, None)
    assert payload["construction"] is None
    path = datacenter.write(payload, tmp_path, published_at="2026-07-15T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
```

- [ ] **Step 2: Run to verify failure** — `.venv/bin/pytest tests/test_datacenter_writer.py -q` → FAIL (build() takes 3 args).

- [ ] **Step 3: Writer.** `pipeline/publish/datacenter.py` — signature `def build(dc_result: dict, parity_result: dict, source_ids: dict[str, str], construction: dict | None) -> dict:` and before `return out`:

```python
    out["construction"] = None if construction is None else {
        "as_of": construction["as_of"], "unit": construction["unit"],
        "latest_saar": round(construction["latest_saar"], 1),
        "yoy_pct": (None if construction["yoy_pct"] is None
                    else round(construction["yoy_pct"], 1)),
        "yoy_asof": construction["yoy_asof"],
        "vs_2014_avg": (None if construction["vs_2014_avg"] is None
                        else round(construction["vs_2014_avg"], 1)),
        "months": construction["months"],
        "saar": [round(v, 1) for v in construction["saar"]],
        "real": [None if v is None else round(v, 1) for v in construction["real"]]}
```

- [ ] **Step 4: Schema.** Top-level `required` gains `"construction"`; add to `properties`:

```json
"construction": {"type": ["object", "null"], "required": ["as_of", "unit", "latest_saar", "yoy_pct", "yoy_asof", "vs_2014_avg", "months", "saar", "real"], "properties": {"as_of": {"type": "string"}, "unit": {"type": "string"}, "latest_saar": {"type": "number"}, "yoy_pct": {"type": ["number", "null"]}, "yoy_asof": {"type": "string"}, "vs_2014_avg": {"type": ["number", "null"]}, "months": {"type": "array", "items": {"type": "string"}}, "saar": {"type": "array", "items": {"type": "number"}}, "real": {"type": "array", "items": {"type": ["number", "null"]}}}}
```

- [ ] **Step 5: run_daily.** In `_datacenter_phase`:

```python
        dc_result = dcindex.run(conn, today=today)
        parity_result = dcindex.parity_from_store(conn)
        construction = dcindex.construction_from_store(conn, dc_result)
        dc_path = datacenter_json.write(
            datacenter_json.build(dc_result, parity_result,
                                  {s.code: s.source_id for s in series},
                                  construction),
            args.out, published_at=published_at)
```

- [ ] **Step 6: Full suite.** `.venv/bin/pytest -q` — expected: everything green EXCEPT `test_published_data.py::…[datacenter.json…]` (stale committed file lacks `construction`; the known wave-1-style transient, resolved by Task 5). Any OTHER failure: stop and investigate.

- [ ] **Step 7: Commit**

```bash
git add pipeline/publish/datacenter.py schemas/datacenter.schema.json pipeline/run_daily.py tests/test_datacenter_writer.py
git commit -m "feat(dc): publish nullable construction block in datacenter.json (schema-pinned)"
```

---

### Task 5: Regenerate real data (CONTROLLER-EXECUTED — live pipeline run)

- [ ] Step 1: `set -a; source .env; set +a && .venv/bin/python -m pipeline.run_daily --store store --out site/public/data` — exit 0; CENSUS row appears in sources_status with ok=true (a CENSUS failure here = stop and inspect, do not proceed with a null block).
- [ ] Step 2: Sanity: `construction.months[0] == "2014-01-01"`, latest SAAR in the ~$55–70B/yr ($M 55000–70000) range, NSA YoY positive double-digit, `vs_2014_avg` ≈ 35–45, real null before 2017 and non-null for recent months, qa datacenter_ok pass, `pytest -q` fully green again.
- [ ] Step 3: `git add store site/public/data && git commit -m "data: local publish with DC construction block"`.

---

### Task 6: Site — DcConstructionChart + stat cards + methodology

**Files:**
- Create: `site/src/components/DcConstructionChart.tsx`
- Modify: `site/src/app/datacenter/page.tsx`

**Interfaces:**
- Consumes: `dc.construction` from the regenerated JSON (non-null at build time after Task 5).
- Produces: `DcConstructionChart({ months, saar, real })`, client component.

- [ ] **Step 1: Create `site/src/components/DcConstructionChart.tsx`** (modeled on DcIndexChart; no mode toggle — two lines share one $B axis):

```tsx
"use client";
import { useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

function pair(months: string[], vals: (number | null)[]): [string, number | null][] {
  return months.map((m, i) => [m, vals[i]] as [string, number | null]);
}

export function DcConstructionChart({ months, saar, real }: {
  months: string[]; saar: number[]; real: (number | null)[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const option = useMemo(() => {
    const base = baseOption();
    return {
      ...base,
      // values arrive in $M; display in $B — presentation-only division
      tooltip: {
        ...base.tooltip,
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? `$${(v / 1000).toFixed(1)}B/yr` : "—",
      },
      yAxis: {
        ...base.yAxis,
        scale: true,
        axisLabel: { color: C.muted, formatter: (v: number) => `$${v / 1000}B` },
      },
      series: [
        { name: "Nominal (SAAR)", type: "line", showSymbol: false,
          data: pair(months, saar),
          lineStyle: { width: 2, color: C.sky }, itemStyle: { color: C.sky } },
        { name: "Real, 2018-01 $ (DC Build deflator)", type: "line", showSymbol: false,
          data: pair(months, real),
          lineStyle: { width: 2, color: C.amber }, itemStyle: { color: C.amber } },
      ],
    };
  }, [months, saar, real]);

  const exportPng = () => {
    const dom = wrapRef.current?.firstElementChild;
    const chart =
      dom instanceof HTMLElement ? echarts.getInstanceByDom(dom) : undefined;
    if (!chart) {
      console.warn("DC construction PNG export: chart instance not found");
      return;
    }
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: C.bg });
    const a = document.createElement("a");
    a.href = url;
    a.download = "macrogauge-dc-construction.png";
    a.click();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "12px 0 4px" }}>
        <button onClick={exportPng}
                style={{ border: "1px solid var(--border)", background: "var(--chip-bg)",
                         color: "var(--muted)", borderRadius: 999, padding: "2px 12px",
                         fontSize: 12, cursor: "pointer" }}>
          ⬇ Export PNG
        </button>
      </div>
      <div ref={wrapRef}>
        <EChart option={option} height={320} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the page.** In `site/src/app/datacenter/page.tsx`: import `{ DcConstructionChart }`; add `const construction = dc.construction;` after the `hardware` const; insert between `<HardwareGapPanel …/>` and the `State cost parity` h2:

```tsx
      {construction && (
        <>
          <h2>The construction boom <span className="subtitle">Census C30 · US data-center construction spend</span></h2>
          <div className="kpi-row">
            <KpiCard label="Construction spend" value={`$${(construction.latest_saar / 1000).toFixed(1)}B/yr`}
                     context={`seasonally adjusted annual rate · as of ${construction.as_of}`} accent="sky" />
            <KpiCard label="Spend YoY" value={fmtSigned(construction.yoy_pct)}
                     context={`NSA, same month a year ago · as of ${construction.yoy_asof}`} accent="red" />
            <KpiCard label="vs 2014 average" value={`×${construction.vs_2014_avg.toFixed(1)}`}
                     context="latest annualized rate vs the 2014 average" accent="violet" />
          </div>
          <DcConstructionChart months={construction.months} saar={construction.saar}
                               real={construction.real} />
        </>
      )}
```

- [ ] **Step 3: Methodology.** Append inside the existing `<p className="method">`, after the wave-1 hardware text (before `</p>`):

```tsx
        {" "}Construction-boom data is Census C30 value-in-place for data centers (monthly,
        ~2-month lag; no FRED mirror exists — we parse Census&apos;s published workbook). The
        level chart is Census&apos;s seasonally adjusted annual rate; YoY is computed on NSA
        actuals same-month-a-year-ago; the real line deflates nominal spend by our DC Build
        index to constant 2018-01 dollars — a series that requires a DC-specific input-cost
        deflator to exist.
```

- [ ] **Step 4: Gates** — `cd site && npx tsc --noEmit && npm run build && npm test && npm run e2e` → all green (e2e stays 23; zero console errors on /datacenter).

- [ ] **Step 5: Commit**

```bash
git add site/src/components/DcConstructionChart.tsx site/src/app/datacenter/page.tsx
git commit -m "feat(site): construction boom section — Census SAAR + real (DC Build deflator)"
```

---

### Task 7: Final gates, visual verify, docs (CONTROLLER-EXECUTED)

- [ ] Step 1: full gates from clean state (`pytest -q`; site build/test/e2e).
- [ ] Step 2: `CLAUDE.md` updates: connector count "15 total" → "16 total" and add `census` to the API/CSV connector list; sources phrasing if counted; test-count string to the new pytest total.
- [ ] Step 3: visual verification on the static export (serve `site/out`, screenshot /datacenter): construction section present with three stat cards, two-line chart (real line starts 2017, sits below nominal and diverges as build costs inflate), console clean.
- [ ] Step 4: commit docs; final whole-branch review (most capable model) with ledger minors; STOP for push approval.

---

## Self-review notes

- **Spec coverage:** §3/§4 connector+registry → Tasks 1–2; §5 engine → Task 3; §6 publish/schema → Task 4; §7 site → Task 6; §8 tests → embedded; nullable bootstrap → Tasks 3/4 null tests; data-before-site ordering hazard → Task 5.
- **Type consistency:** `build(dc_result, parity_result, source_ids, construction)` matches Task 4 tests/writer/run_daily; `construction_block` shape keys match writer, schema, and page fields; `DcConstructionChart` props match the page call.
- **Pin arithmetic:** sources 16→17 (one new source), series 240→242 (two new), FRED count untouched at 73.
- **Known transient** (Task 4→5) disclosed in Global Constraints this time, unlike wave 1 where it surprised the implementer.
