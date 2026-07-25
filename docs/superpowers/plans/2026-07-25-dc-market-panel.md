# DC Market Panel (/markets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `/markets` — construction-labor tightness (wage + headcount, vs national) for 20 real
data-center markets at county resolution, with a denominated capacity-competition column.

**Architecture:** Config-driven market roster (`config/dc_markets.json`) → county QCEW wage +
employment series → pure aggregation engine → writer with inline schema validation → static Next.js
page. Follows the `capacity` template end to end. Two connector bugs are fixed on the way in, one of
which is live in production today.

**Tech Stack:** Python 3.12 (setuptools, pytest), SQLite in-memory vintage store, jsonschema,
Next.js 15 static export, vitest (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-25-dc-market-panel-design.md`

## Global Constraints

- **HTTP is injected, never real.** Connectors take `http_get`/`http_post`; tests pass fakes reading
  `tests/fixtures/`. Never add a test that hits the network.
- **Store rows are append-only and schema-versionless.** `Observation` fields may be *added*; never
  renamed, removed, or retyped. Never rewrite a committed partition. New metrics ride as new series
  codes, not new fields.
- **Every published file validates inline against `schemas/<stem>.schema.json`.**
  `jsonschema.ValidationError` re-raises and fails the run — caught *before* the generic `Exception`.
  Schemas must legally allow degraded output (nulls, empty arrays).
- **New pipeline phases run in their own isolated `try/except` with an `*_ok` flag.** A failure must
  not suppress other phases.
- **All derived math lives in the pipeline. The site renders only.**
- **Weights and formulas get published, not hidden. Every card carries an as-of date.**
- Base month for any index is `2018-01 = 100`. Not used by this feature, but do not break it.
- Commit style is conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `config:`), matching
  `git log`.
- Run `pytest -q` from the repo root; `npm run build && npm test && npm run e2e` from `site/`.

## File Structure

**Create**
- `config/dc_markets.json` — hand-curated market roster (20 markets, 30 counties)
- `pipeline/dc_markets.py` — config loader + validation
- `pipeline/engine/dcmarkets.py` — pure aggregation (wage/emp weighting, like-for-like YoY)
- `pipeline/publish/dc_markets.py` — writer
- `schemas/dc_markets.schema.json` — published contract
- `tests/test_dc_markets_config.py`, `tests/test_dcmarkets_engine.py`, `tests/test_dc_markets_writer.py`
- `site/src/lib/dcMarkets.ts` + `site/src/lib/dcMarkets.test.ts`
- `site/src/app/markets/page.tsx`
- `site/src/components/markets/MarketsClient.tsx`

**Modify**
- `pipeline/connectors/qcew.py` — `N_QUARTERS` 5→8; emit employment
- `tests/test_qcew.py`, `tests/fixtures/qcew_industry23.csv` — county + employment coverage
- `config/series.json` — 61 new series
- `config/capacity.json` — `market` tag on ~30 `geo[]` entries
- `schemas/capacity.schema.json` — declare `market` + `when`; bound `lat`/`lng`
- `pipeline/run_daily.py` — tenth isolated phase
- `pipeline/publish/qa.py:22,24` — `PHASES` + `_PHASE_DONE`
- `tests/test_registry.py:27`, `tests/test_run_daily.py:292`, `tests/test_qa.py`,
  `tests/test_published_data.py`, `tests/test_capacity_config.py`
- `site/src/lib/types.ts`, `site/src/lib/nav.ts`, `site/e2e/smoke.spec.ts`
- `CLAUDE.md`, `todo.md`, `docs/plans/2026-07-24-project-controls-gaps.md`

**Task order is dependency order.** Tasks 1–3 (collection) must land before 5 (engine) has data;
7 (writer) before 10 (page), because the page static-imports the artifact and `npm run build` fails
without it.

---

### Task 1: QCEW connector — reach the year-ago base

`N_QUARTERS = 5` requests q0−4..q0, but the newest *published* quarter is q0−3, whose YoY base is
q0−7. The base is therefore never fetched. This is why `site/public/data/geo.json` ships
`yoy_pct: null` for **all 51 states in production right now** — a live bug this task fixes as a side
effect.

**Files:**
- Modify: `pipeline/connectors/qcew.py:28`
- Test: `tests/test_qcew.py`

**Interfaces:**
- Consumes: nothing
- Produces: `qcew.N_QUARTERS == 8`; `qcew._recent_quarters(today, n)` unchanged signature
  `(today: str, n: int = N_QUARTERS) -> list[tuple[int, int]]`, oldest first

- [ ] **Step 1: Write the failing test**

Append to `tests/test_qcew.py`:

```python
def test_window_reaches_the_year_ago_base_of_the_newest_published_quarter():
    # QCEW publishes ~2 quarters behind, so on 2026-07-25 the newest published
    # quarter is 2025q4. Its YoY base is 2024q4. A window that stops short of
    # that base can never compute a wage YoY — which is exactly why geo.json
    # shipped yoy_pct: null for all 51 states before this fix.
    window = qcew._recent_quarters("2026-07-25")
    assert (2025, 4) in window, "newest published quarter missing"
    assert (2024, 4) in window, "year-ago base missing — YoY impossible"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_qcew.py::test_window_reaches_the_year_ago_base_of_the_newest_published_quarter -q`
Expected: FAIL — `AssertionError: year-ago base missing — YoY impossible` (with `N_QUARTERS = 5` the
window is `[(2025,3),(2025,4),(2026,1),(2026,2),(2026,3)]`).

- [ ] **Step 3: Write minimal implementation**

Replace `pipeline/connectors/qcew.py:28-30`:

```python
N_QUARTERS = 8  # must span the newest PUBLISHED quarter (q0-3 at a ~2-quarter
                # lag) AND its year-ago base (q0-7), or wage YoY is
                # uncomputable — geo.json shipped yoy_pct: null for all 51
                # states until this was widened. Unpublished quarters 404 and
                # are tolerated per-quarter; refetching unchanged quarters is
                # free thanks to the store's value-dedupe.
```

- [ ] **Step 4: Run the full QCEW suite**

Run: `pytest tests/test_qcew.py -q`
Expected: PASS. Note `test_malformed_quarter_body_tolerated_but_all_malformed_raises` asserts
`len(calls) == qcew.N_QUARTERS` — it reads the constant, so it tracks the change automatically.

- [ ] **Step 5: Confirm no state-parity regression**

Run: `pytest tests/test_geo_writer.py tests/test_dcindex.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/qcew.py tests/test_qcew.py
git commit -m "fix(qcew): widen fetch window to reach the year-ago base

N_QUARTERS=5 requested q0-4..q0 while the newest published quarter is
q0-3, whose YoY base is q0-7 — so the base was never fetched and
geo.json shipped yoy_pct: null for all 51 states in production."
```

---

### Task 2: QCEW connector — emit construction employment

`month3_emplvl` is already in every row we download and is discarded. Employment is the *direct*
craft-labor-tightness measure the panel is built on. It rides as its own series code so store rows
stay append-only and schema-versionless.

**Files:**
- Modify: `pipeline/connectors/qcew.py:45-68` (`_parse_quarter`)
- Modify: `tests/fixtures/qcew_industry23.csv`
- Test: `tests/test_qcew.py`

**Interfaces:**
- Consumes: Task 1's `N_QUARTERS = 8`
- Produces: for a registered `area_fips` `F`, `_parse_quarter` emits an `Observation` with
  `series_code=F` carrying `avg_wkly_wage`, and a second with `series_code=f"{F}~emp"` carrying
  `month3_emplvl`. Both `source="QCEW"`, `route="CSV"`, `obs_date` at the quarter's first month.
  Callers request the `~emp` variant by putting `"{fips}~emp"` in `area_fips`.

- [ ] **Step 1: Add county + employment fixture rows**

Append to `tests/fixtures/qcew_industry23.csv` (Loudoun VA and Taylor TX at `agglvl_code` 74, plus a
disclosure-suppressed county). Field order matches the existing header exactly; `month3_emplvl` is
field 12 and `avg_wkly_wage` is field 16:

```csv
"51107","5","23","74","0","2025","4","",900,25980,26050,26151,7690000000,120000000,900000,2264,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",40,4.6,3600,16.1,3700,16.5,3779,16.9,900000000,13.2,10000000,9.1,50000,5.9,263,13.1
"48441","5","23","74","0","2025","4","",357,4050,4080,4106,878000000,41000000,600000,1646,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",30,9.2,780,23.9,790,24.0,801,24.2,200000000,29.5,8000000,24.2,100000,20.0,289,21.3
"41067","5","23","74","0","2025","4","N",1200,0,0,0,0,0,0,0,"N",1.00,0,0,0,0,0,0,0,"N",0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_qcew.py`:

```python
def test_emits_employment_as_its_own_series():
    # month3_emplvl rides in the same rows we already download. It becomes a
    # separate series code so store rows stay append-only and
    # schema-versionless — no Observation field is added.
    obs = qcew.fetch(["51107", "51107~emp"], vintage_date="2026-07-12",
                     http_get=fake_get)
    by_code = {o.series_code: o for o in obs}
    assert set(by_code) == {"51107", "51107~emp"}
    assert by_code["51107"].value == 2264.0        # avg_wkly_wage
    assert by_code["51107~emp"].value == 26151.0   # month3_emplvl
    assert by_code["51107~emp"].obs_date == "2025-10-01"
    assert by_code["51107~emp"].source == "QCEW"
    assert by_code["51107~emp"].route == "CSV"


def test_county_fips_flow_through_unchanged():
    # The industry endpoint returns every area in one file; area is a
    # client-side row filter with no agglvl check, so a 5-digit county FIPS
    # needs no connector change. Verified live 2026-07-25: 3,707 private
    # areas, each at exactly one agglvl_code.
    obs = qcew.fetch(["51107", "48441"], vintage_date="2026-07-12",
                     http_get=fake_get)
    assert {o.series_code for o in obs} == {"51107", "48441"}


def test_suppressed_county_yields_neither_wage_nor_employment():
    # Washington Co. OR (41067) is disclosure_code "N". A suppressed row must
    # produce no observation at all — not a 0 wage, and not a 0 headcount.
    obs = qcew.fetch(["41067", "41067~emp"], vintage_date="2026-07-12",
                     http_get=fake_get)
    assert obs == []


def test_employment_requested_alone_does_not_emit_the_wage_series():
    obs = qcew.fetch(["48441~emp"], vintage_date="2026-07-12", http_get=fake_get)
    assert {o.series_code for o in obs} == {"48441~emp"}
    assert obs[0].value == 4106.0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_qcew.py -q -k "employment or county"`
Expected: FAIL — `test_emits_employment_as_its_own_series` errors with
`AssertionError: assert {'51107'} == {'51107', '51107~emp'}`.

- [ ] **Step 4: Write the implementation**

Replace `_parse_quarter` in `pipeline/connectors/qcew.py` (lines 45-68):

```python
def _parse_quarter(text: str, wanted: set[str], vintage: str) -> list[Observation]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "own_code" not in reader.fieldnames:
        raise ValueError("unexpected CSV structure (drift?)")
    out: list[Observation] = []
    for row in reader:
        fips = row["area_fips"]
        if row["own_code"] != "5":
            continue
        wage_code, emp_code = fips, f"{fips}{EMP_SUFFIX}"
        if wage_code not in wanted and emp_code not in wanted:
            continue
        # BLS suppresses small cells by zeroing the value and setting
        # disclosure_code (e.g. "N") rather than omitting the row — a
        # suppressed 0 is not a real wage OR a real headcount, and must not be
        # ingested as one. Checked BEFORE float(): a suppressed row may carry
        # a blank field. Suppression is all-or-nothing per row, so this gates
        # both metrics.
        if row["disclosure_code"]:
            continue
        month = (int(row["qtr"]) - 1) * 3 + 1
        obs_date = f"{row['year']}-{month:02d}-01"

        def _emit(code: str, raw: str) -> None:
            value = float(raw)
            if value <= 0:
                return
            out.append(Observation(
                series_code=code, obs_date=obs_date, value=value,
                vintage_date=vintage, source="QCEW", route="CSV"))

        if wage_code in wanted:
            _emit(wage_code, row["avg_wkly_wage"])
        if emp_code in wanted:
            _emit(emp_code, row["month3_emplvl"])
    return out
```

Add the constant beside `NAICS` at `pipeline/connectors/qcew.py:27`:

```python
EMP_SUFFIX = "~emp"  # employment rides as its own series code rather than a
                     # new Observation field: store rows are append-only and
                     # schema-versionless, and collect.py's id_map is a plain
                     # string map so it needs no change.
```

- [ ] **Step 5: Update the module docstring**

Replace lines 4-6 of `pipeline/connectors/qcew.py` (`row per area x ownership ... are` through
`dropped, not ingested as a real 0.`):

```
row per area x ownership for that quarter. We keep own_code 5 (private) rows
whose area_fips is registered, reading avg_wkly_wage and month3_emplvl (the
latter under the "{fips}~emp" series code); disclosure-suppressed rows
(small-cell values BLS zeroes out and flags via disclosure_code) are dropped
whole — neither a real 0 wage nor a real 0 headcount. Area is a plain row
filter with no agglvl check, so county FIPS work with no code change.
```

- [ ] **Step 6: Run the full QCEW suite**

Run: `pytest tests/test_qcew.py -q`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 7: Run the full suite for regressions**

Run: `pytest -q`
Expected: PASS (633 tests + the 4 new ones).

- [ ] **Step 8: Commit**

```bash
git add pipeline/connectors/qcew.py tests/test_qcew.py tests/fixtures/qcew_industry23.csv
git commit -m "feat(qcew): emit construction employment alongside wages

month3_emplvl already rides in the rows we download and was discarded.
It becomes its own series code ({fips}~emp) so store rows stay
append-only and schema-versionless. Fixture gains county rows — no
county FIPS had ever flowed through this code path in a test."
```

---

### Task 3: Register the 30 market counties

**Files:**
- Modify: `config/series.json`
- Modify: `tests/test_registry.py:27`

**Interfaces:**
- Consumes: Task 2's `EMP_SUFFIX` convention
- Produces: series codes `qcew_wage23_c{fips}` and `qcew_emp23_c{fips}` for 30 counties, plus
  `qcew_emp23_us`. Registry total becomes **659** (598 + 61).

- [ ] **Step 1: Add the series entries**

Append to the QCEW block in `config/series.json`, matching the existing entry shape exactly. The
national employment baseline first:

```json
{"code": "qcew_emp23_us", "source": "QCEW", "source_id": "US000~emp",
 "name": "QCEW construction employment (US)", "max_staleness_days": 400}
```

Then, for each of the 30 counties below, **two** entries — wage and employment:

```json
{"code": "qcew_wage23_c51107", "source": "QCEW", "source_id": "51107",
 "name": "QCEW avg weekly wage, construction (Loudoun County, VA)",
 "max_staleness_days": 400},
{"code": "qcew_emp23_c51107", "source": "QCEW", "source_id": "51107~emp",
 "name": "QCEW construction employment (Loudoun County, VA)",
 "max_staleness_days": 400}
```

The 30 counties, with the names to use:

| FIPS | Name | FIPS | Name |
|---|---|---|---|
| 51107 | Loudoun County, VA | 19155 | Pottawattamie County, IA |
| 51153 | Prince William County, VA | 19153 | Polk County, IA |
| 48113 | Dallas County, TX | 19049 | Dallas County, IA |
| 48439 | Tarrant County, TX | 56021 | Laramie County, WY |
| 48139 | Ellis County, TX | 32029 | Storey County, NV |
| 17031 | Cook County, IL | 32031 | Washoe County, NV |
| 17043 | DuPage County, IL | 53025 | Grant County, WA |
| 04013 | Maricopa County, AZ | 48029 | Bexar County, TX |
| 04021 | Pinal County, AZ | 41067 | Washington County, OR |
| 13097 | Douglas County, GA | 39049 | Franklin County, OH |
| 13121 | Fulton County, GA | 39089 | Licking County, OH |
| 06085 | Santa Clara County, CA | 49035 | Salt Lake County, UT |
| 48441 | Taylor County, TX | 49049 | Utah County, UT |
| 18141 | St. Joseph County, IN | 55101 | Racine County, WI |
| 22083 | Richland Parish, LA | 47157 | Shelby County, TN |

`max_staleness_days` is 400 for every entry, matching the existing QCEW series — QCEW runs a
~7-month publication lag (freshest quarter as of 2026-07-25 is 2025Q4; 2026Q1 and Q2 both 404).

- [ ] **Step 2: Update the registry count pin**

Two pins, both in `tests/test_registry.py`:

- line 27: `assert len(series) == 598` → `assert len(series) == 659`
- line 125: `assert sum(1 for s in series if s.source == "QCEW") == 45` → `== 106`

The comment above line 125 explains that 7 disclosure-suppressed states were dropped because they can
never produce a row. Extend it to note that county series are additive and that Washington Co. OR
(41067) is registered despite being suppressed today — suppression flickers quarter to quarter, and
the market row renders an explicit unavailable state rather than disappearing.

- [ ] **Step 3: Run the registry tests**

Run: `pytest tests/test_registry.py -q`
Expected: PASS. A failure here means a duplicate `code` or a miscount — recount rather than adjusting
the pin to whatever the code produces.

- [ ] **Step 4: Verify no state-parity contamination**

Run: `pytest tests/test_dcindex.py -q`
Expected: PASS. `dcindex._by_state(conn, "qcew_wage23_")` guards on
`len(st) != 2 or not st.isalpha()` (`pipeline/engine/dcindex.py:220`), so `qcew_wage23_c51107` yields
suffix `c51107` and is correctly excluded from the 51-state parity table. **This guard is what keeps
county series out of state parity — do not weaken it.**

- [ ] **Step 5: Run the full suite**

Run: `pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add config/series.json tests/test_registry.py
git commit -m "config: register 30 DC-market counties for QCEW wage + employment

61 new series (30 counties x 2 metrics + national employment). Zero
extra HTTP cost — the connector already downloads the full nationwide
industry-23 file regardless of how many areas are registered."
```

---

### Task 4: Market roster config + loader

**Files:**
- Create: `config/dc_markets.json`
- Create: `pipeline/dc_markets.py`
- Test: `tests/test_dc_markets_config.py`

**Interfaces:**
- Consumes: Task 3's series codes
- Produces:
  - `MarketSpec` frozen dataclass with fields `key: str`, `name: str`, `counties: tuple[str, ...]`,
    `state: str`, `iso: str | None`, `grid: str | None`, `utility: str`, `note: str`
  - `load(path: Path | None = None, registry_codes: set[str] | None = None) -> tuple[MarketSpec, ...]`

**Note a deliberate departure from precedent.** `pipeline/publish/metros.py` and `geo.py` *hardcode*
their `METROS`/`STATES` lists as module constants "pinned by tests". Driving the roster from config is
a departure — so **the roster pin moves into this task's config test**.

- [ ] **Step 1: Write the config**

Create `config/dc_markets.json`. Full roster (20 markets, 30 counties). `iso` is null where the market
is not in an organized market and `grid` names the region instead; exactly one of the two is set.

```json
{
  "as_of_curated": "2026-07-25",
  "note": "Tight core counties — the counties where data centers actually are, not the MSA. Broader metro definitions dilute the signal: Northern Virginia reads +9.9% wage YoY tight vs +7.7% across the 11-county metro, because Arlington and Alexandria average in mature non-DC construction.",
  "markets": [
    {"key": "nova", "name": "Northern Virginia", "counties": ["51107", "51153"], "state": "VA", "iso": "PJM", "grid": null, "utility": "Dominion Energy Virginia", "note": "Loudoun + Prince William; Ashburn / Data Center Alley"},
    {"key": "dfw", "name": "Dallas–Fort Worth", "counties": ["48113", "48439", "48139"], "state": "TX", "iso": "ERCOT", "grid": null, "utility": "Oncor", "note": "Dallas + Tarrant + Ellis"},
    {"key": "chicago", "name": "Chicago", "counties": ["17031", "17043"], "state": "IL", "iso": "PJM", "grid": null, "utility": "ComEd", "note": "Cook + DuPage; Elk Grove Village corridor"},
    {"key": "phoenix", "name": "Phoenix", "counties": ["04013", "04021"], "state": "AZ", "iso": null, "grid": "WECC", "utility": "APS / SRP", "note": "Maricopa + Pinal (Mesa, Goodyear, Casa Grande)"},
    {"key": "atlanta", "name": "Atlanta", "counties": ["13097", "13121"], "state": "GA", "iso": null, "grid": "SERC", "utility": "Georgia Power", "note": "Douglas + Fulton (Douglasville, Atlanta)"},
    {"key": "svl", "name": "Silicon Valley", "counties": ["06085"], "state": "CA", "iso": "CAISO", "grid": null, "utility": "PG&E / Silicon Valley Power", "note": "Santa Clara"},
    {"key": "columbus", "name": "Columbus OH", "counties": ["39049", "39089"], "state": "OH", "iso": "PJM", "grid": null, "utility": "AEP Ohio", "note": "Franklin + Licking (New Albany)"},
    {"key": "slc", "name": "Salt Lake City", "counties": ["49035", "49049"], "state": "UT", "iso": null, "grid": "WECC", "utility": "Rocky Mountain Power", "note": "Salt Lake + Utah County"},
    {"key": "abilene", "name": "Abilene TX", "counties": ["48441"], "state": "TX", "iso": "ERCOT", "grid": null, "utility": "AEP Texas", "note": "Taylor County; Stargate"},
    {"key": "newcarlisle", "name": "New Carlisle IN", "counties": ["18141"], "state": "IN", "iso": "MISO", "grid": null, "utility": "AEP Indiana Michigan", "note": "St. Joseph County; AWS"},
    {"key": "mtpleasant", "name": "Mt Pleasant WI", "counties": ["55101"], "state": "WI", "iso": "MISO", "grid": null, "utility": "We Energies", "note": "Racine County; Microsoft"},
    {"key": "richland", "name": "Richland Parish LA", "counties": ["22083"], "state": "LA", "iso": "MISO", "grid": null, "utility": "Entergy Louisiana", "note": "Meta Hyperion"},
    {"key": "memphis", "name": "Memphis", "counties": ["47157"], "state": "TN", "iso": null, "grid": "TVA", "utility": "MLGW", "note": "Shelby County; xAI Colossus"},
    {"key": "councilbluffs", "name": "Council Bluffs IA", "counties": ["19155"], "state": "IA", "iso": "MISO", "grid": null, "utility": "MidAmerican Energy", "note": "Pottawattamie County"},
    {"key": "desmoines", "name": "Des Moines IA", "counties": ["19153", "19049"], "state": "IA", "iso": "MISO", "grid": null, "utility": "MidAmerican Energy", "note": "Polk + Dallas County IA (West Des Moines, Altoona)"},
    {"key": "cheyenne", "name": "Cheyenne WY", "counties": ["56021"], "state": "WY", "iso": null, "grid": "WECC", "utility": "Black Hills Energy", "note": "Laramie County"},
    {"key": "reno", "name": "Reno / Storey NV", "counties": ["32029", "32031"], "state": "NV", "iso": null, "grid": "WECC", "utility": "NV Energy", "note": "Storey + Washoe; Tahoe Reno Industrial Center"},
    {"key": "quincy", "name": "Quincy WA", "counties": ["53025"], "state": "WA", "iso": null, "grid": "WECC", "utility": "Grant County PUD", "note": "Grant County"},
    {"key": "sanantonio", "name": "San Antonio TX", "counties": ["48029"], "state": "TX", "iso": "ERCOT", "grid": null, "utility": "CPS Energy", "note": "Bexar County"},
    {"key": "hillsboro", "name": "Hillsboro OR", "counties": ["41067"], "state": "OR", "iso": null, "grid": "WECC", "utility": "Portland General Electric", "note": "Washington County — BLS disclosure-suppressed for private NAICS 23; retained so the suppression is visible rather than silently backfilled from Multnomah, which is a different labor market"}
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_dc_markets_config.py`:

```python
import json

import pytest

from pipeline import dc_markets

# The roster pin. config-driving the market list is a deliberate departure
# from metros.py/geo.py, which hardcode METROS/STATES "pinned by tests" — so
# the pin lives here instead of in a writer test.
EXPECTED_KEYS = (
    "nova", "dfw", "chicago", "phoenix", "atlanta", "svl", "columbus", "slc",
    "abilene", "newcarlisle", "mtpleasant", "richland", "memphis",
    "councilbluffs", "desmoines", "cheyenne", "reno", "quincy", "sanantonio",
    "hillsboro")


def _codes(markets):
    out = set()
    for m in markets:
        for f in m.counties:
            out |= {f"qcew_wage23_c{f}", f"qcew_emp23_c{f}"}
    return out


def test_roster_is_pinned():
    markets = dc_markets.load()
    assert tuple(m.key for m in markets) == EXPECTED_KEYS
    assert len({f for m in markets for f in m.counties}) == 30


def test_every_county_has_both_registered_series():
    markets = dc_markets.load()
    from pipeline import registry
    _, series = registry.load_registry()
    codes = {s.code for s in series}
    for m in markets:
        for f in m.counties:
            assert f"qcew_wage23_c{f}" in codes, f"{m.key}: {f} wage unregistered"
            assert f"qcew_emp23_c{f}" in codes, f"{m.key}: {f} emp unregistered"


def test_unknown_series_code_raises(tmp_path):
    raw = {"as_of_curated": "2026-07-25", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["99999"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}
    p = tmp_path / "m.json"
    p.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="unknown series code"):
        dc_markets.load(p, registry_codes=set())


def test_duplicate_keys_raise(tmp_path):
    m = {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x",
                             "markets": [m, dict(m)]}))
    with pytest.raises(ValueError, match="duplicate market key"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})


def test_malformed_fips_raises(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["511"], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="5-digit county FIPS"):
        dc_markets.load(p, registry_codes=set())


def test_empty_counties_raise(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": [], "state": "VA",
         "iso": "PJM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="non-empty counties"):
        dc_markets.load(p, registry_codes=set())


def test_exactly_one_of_iso_or_grid(tmp_path):
    # A market is either in an organized market (iso) or it isn't (grid names
    # the region). Setting both, or neither, is a curation error — and it
    # matters because the PJM capacity ladder renders off `iso`.
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJM", "grid": "WECC", "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="exactly one of iso/grid"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})


def test_unknown_iso_raises(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"as_of_curated": "x", "note": "x", "markets": [
        {"key": "k", "name": "K", "counties": ["51107"], "state": "VA",
         "iso": "PJMM", "grid": None, "utility": "U", "note": ""}]}))
    with pytest.raises(ValueError, match="unknown iso"):
        dc_markets.load(p, registry_codes={"qcew_wage23_c51107",
                                           "qcew_emp23_c51107"})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_dc_markets_config.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.dc_markets'`.

- [ ] **Step 4: Write the loader**

Create `pipeline/dc_markets.py`:

```python
"""DC market roster config — tight core counties per real data-center market.

Loader precedent: pipeline/dc_power.py. County FIPS are validated against the
registry (registry_codes injectable for tests, same pattern). A market is
either in an organized market (iso) or it is not (grid names the region);
setting both or neither is a curation error, because the PJM capacity ladder
renders off `iso`.

Markets are TIGHT — the counties where data centers actually are, not the
MSA. Metro definitions dilute the signal: Northern Virginia reads +9.9% wage
YoY tight vs +7.7% across the 11-county metro."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_markets.json"

ISOS = frozenset({"PJM", "ERCOT", "MISO", "CAISO", "SPP", "ISONE", "NYISO"})
_FIPS = re.compile(r"^\d{5}$")


@dataclass(frozen=True)
class MarketSpec:
    key: str
    name: str
    counties: tuple[str, ...]
    state: str
    iso: str | None
    grid: str | None
    utility: str
    note: str


def load(path: Path | None = None,
         registry_codes: set[str] | None = None) -> tuple[MarketSpec, ...]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}

    markets = []
    seen: set[str] = set()
    for m in raw["markets"]:
        key = m["key"]
        if key in seen:
            raise ValueError(f"dc_markets: duplicate market key {key}")
        seen.add(key)
        counties = tuple(m["counties"])
        if not counties:
            raise ValueError(f"dc_markets: {key} must have non-empty counties")
        for f in counties:
            if not _FIPS.match(f):
                raise ValueError(
                    f"dc_markets: {key} county {f!r} is not a 5-digit county FIPS")
            for code in (f"qcew_wage23_c{f}", f"qcew_emp23_c{f}"):
                if code not in registry_codes:
                    raise ValueError(f"dc_markets: unknown series code {code}")
        iso, grid = m["iso"], m["grid"]
        if bool(iso) == bool(grid):
            raise ValueError(
                f"dc_markets: {key} must set exactly one of iso/grid")
        if iso and iso not in ISOS:
            raise ValueError(f"dc_markets: {key} unknown iso {iso!r}")
        if len(m["state"]) != 2 or not m["state"].isalpha():
            raise ValueError(f"dc_markets: {key} state must be 2 letters")
        markets.append(MarketSpec(
            key=key, name=m["name"], counties=counties, state=m["state"],
            iso=iso, grid=grid, utility=m["utility"], note=m.get("note", "")))
    return tuple(markets)


def meta(path: Path | None = None) -> dict:
    """The curated-layer metadata the writer republishes verbatim."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    return {"as_of_curated": raw["as_of_curated"], "note": raw["note"]}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_dc_markets_config.py -q`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add config/dc_markets.json pipeline/dc_markets.py tests/test_dc_markets_config.py
git commit -m "feat: config-driven DC market roster + loader

20 markets, 30 tight core counties. Deliberate departure from
metros.py/geo.py, which hardcode their entity lists — so the roster pin
lives in the config test instead of a writer test."
```

---

### Task 5: Engine — market aggregation

Pure dict→dict, no I/O, testable directly — the same contract as the five gauge stages.

**Files:**
- Create: `pipeline/engine/dcmarkets.py`
- Test: `tests/test_dcmarkets_engine.py`

**Interfaces:**
- Consumes: `MarketSpec` from Task 4
- Produces:
  ```python
  THIN_BASE = 1500
  def market_rows(
      wage: dict[str, dict[str, float]],      # {county_fips: {obs_date: avg_wkly_wage}}
      emp: dict[str, dict[str, float]],       # {county_fips: {obs_date: month3_emplvl}}
      markets: tuple[MarketSpec, ...],
      national_wage: dict[str, float],        # {obs_date: value}
      national_emp: dict[str, float],
      thin_base: int = THIN_BASE,
  ) -> dict
  ```
  Returns `{"as_of": str|None, "base_date": str|None, "national": {...}, "markets": [...]}`.

**The two rules that make this correct:**

1. **Employment-weighted wage.** A market's wage is `sum(wage_i * emp_i) / sum(emp_i)` across its
   counties, never a simple mean — Loudoun (26k workers) must not be averaged 50/50 with a 500-worker
   county.
2. **Like-for-like county sets for YoY.** A county missing or suppressed in *either* quarter is
   excluded from *both* sides of the ratio. This mirrors `pipeline/engine/dcindex.py:192-195`, which
   already does exactly this for Louisiana's flickering state-level suppression.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_dcmarkets_engine.py`:

```python
from pipeline.dc_markets import MarketSpec
from pipeline.engine import dcmarkets

CUR, BASE = "2025-10-01", "2024-10-01"


def _mkt(key, counties, **kw):
    return MarketSpec(key=key, name=key.upper(), counties=tuple(counties),
                      state=kw.get("state", "VA"), iso=kw.get("iso", "PJM"),
                      grid=kw.get("grid"), utility="U", note="")


NAT_WAGE = {BASE: 1727.0, CUR: 1815.0}   # +5.1%
NAT_EMP = {BASE: 8117805.0, CUR: 8195199.0}  # +1.0%


def test_wage_is_employment_weighted_not_a_simple_mean():
    # Two counties, wildly different sizes. A simple mean would give 1500;
    # the employment-weighted answer is dominated by the large county.
    wage = {"51107": {CUR: 2000.0}, "51153": {CUR: 1000.0}}
    emp = {"51107": {CUR: 9000.0}, "51153": {CUR: 1000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["wage"] == 1900.0          # (2000*9000 + 1000*1000) / 10000
    assert row["emp"] == 10000


def test_yoy_uses_a_like_for_like_county_set():
    # 51153 is suppressed in the base quarter. Including it on the current
    # side only would inflate the market's apparent wage growth. It must drop
    # out of BOTH sides — mirrors dcindex.py:192-195 for Louisiana.
    wage = {"51107": {BASE: 2000.0, CUR: 2200.0},
            "51153": {CUR: 500.0}}
    emp = {"51107": {BASE: 1000.0, CUR: 1000.0},
           "51153": {CUR: 1000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["counties_used"] == 1
    assert row["counties_suppressed"] == ["51153"]
    assert row["wage"] == 2200.0                  # 51153 excluded entirely
    assert row["wage_yoy_pct"] == 10.0            # 2200/2000 - 1


def test_spread_is_market_yoy_minus_national_yoy_in_pp():
    wage = {"51107": {BASE: 2000.0, CUR: 2200.0}}
    emp = {"51107": {BASE: 1000.0, CUR: 1200.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert out["national"]["wage_yoy_pct"] == 5.1
    assert out["national"]["emp_yoy_pct"] == 1.0
    assert row["wage_yoy_pct"] == 10.0
    assert row["wage_spread_pp"] == 4.9           # 10.0 - 5.1
    assert row["emp_yoy_pct"] == 20.0
    assert row["emp_spread_pp"] == 19.0           # 20.0 - 1.0


def test_fully_suppressed_market_degrades_to_unavailable_not_zero():
    # Hillsboro's only core county is disclosure-suppressed. The row must
    # render as unavailable — never as a 0 wage or a silent drop.
    out = dcmarkets.market_rows(
        {}, {}, (_mkt("hillsboro", ["41067"], state="OR", iso=None,
                      grid="WECC"),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["available"] is False
    assert row["wage"] is None and row["wage_yoy_pct"] is None
    assert row["emp"] is None and row["emp_yoy_pct"] is None
    assert row["counties_used"] == 0
    assert row["counties_total"] == 1
    assert len(out["markets"]) == 1, "unavailable markets stay in the roster"


def test_thin_base_is_flagged():
    # Richland Parish is 563 construction workers. Its +57% wage YoY is real
    # but must never read as equally reliable to Loudoun's on a 26k base.
    wage = {"22083": {BASE: 1248.0, CUR: 1964.0},
            "51107": {BASE: 2001.0, CUR: 2264.0}}
    emp = {"22083": {BASE: 274.0, CUR: 563.0},
           "51107": {BASE: 22372.0, CUR: 26151.0}}
    out = dcmarkets.market_rows(
        wage, emp,
        (_mkt("richland", ["22083"], state="LA", iso="MISO"),
         _mkt("nova", ["51107"])),
        NAT_WAGE, NAT_EMP)
    by = {r["key"]: r for r in out["markets"]}
    assert by["richland"]["thin_base"] is True
    assert by["nova"]["thin_base"] is False


def test_county_receipts_are_published_per_market():
    wage = {"51107": {BASE: 2001.0, CUR: 2264.0},
            "51153": {BASE: 1856.0, CUR: 2061.0}}
    emp = {"51107": {BASE: 22372.0, CUR: 26151.0},
           "51153": {BASE: 9000.0, CUR: 9900.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    counties = out["markets"][0]["counties"]
    assert [c["fips"] for c in counties] == ["51107", "51153"]
    assert counties[0]["wage"] == 2264.0
    assert counties[0]["emp"] == 26151
    assert counties[0]["wage_yoy_pct"] == 13.1   # 2264/2001 - 1
    assert counties[0]["emp_yoy_pct"] == 16.9


def test_as_of_and_base_date_come_from_the_national_anchor():
    out = dcmarkets.market_rows({}, {}, (), NAT_WAGE, NAT_EMP)
    assert out["as_of"] == CUR
    assert out["base_date"] == BASE


def test_no_national_data_degrades_whole_payload():
    out = dcmarkets.market_rows({}, {}, (_mkt("nova", ["51107"]),), {}, {})
    assert out["as_of"] is None
    assert out["national"]["wage"] is None
    assert out["markets"][0]["available"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_dcmarkets_engine.py -q`
Expected: FAIL — `ImportError: cannot import name 'dcmarkets' from 'pipeline.engine'`.

- [ ] **Step 3: Write the engine**

Create `pipeline/engine/dcmarkets.py`:

```python
"""Market-resolution construction labor — pure aggregation stage.

Two rules make this correct, and both are load-bearing:

1. Wage is EMPLOYMENT-WEIGHTED across a market's counties, never a simple
   mean — Loudoun (26k construction workers) must not be averaged 50/50 with
   a 500-worker neighbour.
2. YoY uses a LIKE-FOR-LIKE county set: a county missing or disclosure-
   suppressed in either quarter is excluded from BOTH sides of the ratio,
   or composition change contaminates the rate. Same discipline as
   dcindex.py:192-195 for Louisiana's flickering state-level suppression.

Markets whose counties are all suppressed degrade to available=False and
stay in the roster — a visible hole, never a silent drop or a 0."""

from pipeline.dc_markets import MarketSpec

THIN_BASE = 1500  # construction workers; below this a YoY is real but noisy
                  # (Richland Parish is 563) and must be labelled as such


def _year_ago(obs_date: str) -> str:
    return f"{int(obs_date[:4]) - 1}{obs_date[4:]}"


def _pct(cur: float | None, base: float | None) -> float | None:
    if cur is None or not base:
        return None
    return round((cur / base - 1) * 100, 1)


def _weighted(pairs: list[tuple[float, float]]) -> float | None:
    """[(value, weight)] -> weighted mean, None if no weight."""
    den = sum(w for _, w in pairs)
    if not den:
        return None
    return sum(v * w for v, w in pairs) / den


def market_rows(wage: dict[str, dict[str, float]],
                emp: dict[str, dict[str, float]],
                markets: tuple[MarketSpec, ...],
                national_wage: dict[str, float],
                national_emp: dict[str, float],
                thin_base: int = THIN_BASE) -> dict:
    as_of = max(national_wage) if national_wage else None
    base_date = _year_ago(as_of) if as_of else None

    nat_w = national_wage.get(as_of) if as_of else None
    nat_w_base = national_wage.get(base_date) if base_date else None
    nat_e = national_emp.get(as_of) if as_of else None
    nat_e_base = national_emp.get(base_date) if base_date else None
    nat_w_yoy = _pct(nat_w, nat_w_base)
    nat_e_yoy = _pct(nat_e, nat_e_base)

    rows = []
    for m in markets:
        # like-for-like: usable only if wage AND emp exist in BOTH quarters
        usable = [f for f in m.counties
                  if as_of and wage.get(f, {}).get(as_of) is not None
                  and emp.get(f, {}).get(as_of) is not None
                  and wage.get(f, {}).get(base_date) is not None
                  and emp.get(f, {}).get(base_date) is not None]
        # a county present only in the current quarter is still "suppressed"
        # for our purposes: it cannot contribute to a like-for-like rate
        suppressed = [f for f in m.counties if f not in usable]

        row = {"key": m.key, "name": m.name, "state": m.state, "iso": m.iso,
               "grid": m.grid, "utility": m.utility, "note": m.note,
               "counties_total": len(m.counties), "counties_used": len(usable),
               "counties_suppressed": suppressed,
               "as_of": as_of, "base_date": base_date,
               "available": bool(usable), "thin_base": False,
               "wage": None, "wage_yoy_pct": None, "wage_spread_pp": None,
               "emp": None, "emp_yoy_pct": None, "emp_spread_pp": None,
               "counties": []}

        for f in usable:
            row["counties"].append({
                "fips": f,
                "wage": round(wage[f][as_of], 2),
                "emp": int(emp[f][as_of]),
                "wage_yoy_pct": _pct(wage[f][as_of], wage[f][base_date]),
                "emp_yoy_pct": _pct(emp[f][as_of], emp[f][base_date])})

        if usable:
            w_cur = _weighted([(wage[f][as_of], emp[f][as_of]) for f in usable])
            w_base = _weighted([(wage[f][base_date], emp[f][base_date])
                                for f in usable])
            e_cur = sum(emp[f][as_of] for f in usable)
            e_base = sum(emp[f][base_date] for f in usable)
            row["wage"] = round(w_cur, 2)
            row["emp"] = int(e_cur)
            row["wage_yoy_pct"] = _pct(w_cur, w_base)
            row["emp_yoy_pct"] = _pct(e_cur, e_base)
            row["thin_base"] = e_cur < thin_base
            if row["wage_yoy_pct"] is not None and nat_w_yoy is not None:
                row["wage_spread_pp"] = round(row["wage_yoy_pct"] - nat_w_yoy, 1)
            if row["emp_yoy_pct"] is not None and nat_e_yoy is not None:
                row["emp_spread_pp"] = round(row["emp_yoy_pct"] - nat_e_yoy, 1)
        rows.append(row)

    return {"as_of": as_of, "base_date": base_date,
            "national": {"wage": nat_w, "wage_yoy_pct": nat_w_yoy,
                         "emp": int(nat_e) if nat_e else None,
                         "emp_yoy_pct": nat_e_yoy, "as_of": as_of},
            "markets": rows}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcmarkets_engine.py -q`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcmarkets.py tests/test_dcmarkets_engine.py
git commit -m "feat(engine): market-resolution construction labor aggregation

Employment-weighted wage; like-for-like county sets for YoY so
suppression churn can't contaminate the rate. Fully suppressed markets
degrade to available=False and stay in the roster."
```

---

### Task 6: capacity.json market tags + schema hardening

Membership by hand-assigned tag, not a radius. The coordinates cannot support a distance join: 70 of
112 entries carry `approx: true`, which `geo_note` defines as state-centroid placement, yet AMZN
Louisa Co. sits 73 mi from NoVa — a plausible county placement rather than Virginia's centroid
(~110 mi out). The flag does not tell you which coordinates to trust.

**Files:**
- Modify: `config/capacity.json` (`geo[]` entries)
- Modify: `schemas/capacity.schema.json`
- Test: `tests/test_capacity_config.py`

**Interfaces:**
- Consumes: market keys from Task 4
- Produces: optional `"market": "<key>"` on `geo[]` entries; `pipeline.capacity.load_capacity` gains
  validation that any `market` value is a known market key.

- [ ] **Step 1: Tag the geo entries**

Add `"market": "<key>"` to each `config/capacity.json` `geo[]` entry that sits in a roster market.
Untagged entries are simply not in any market — that is the correct outcome for the ~80 sites outside
these 20 markets and for the 20 non-US sites.

Assign by reading each entry's `site` string (which carries the town/county), **not** by distance.
Indicative targets from a one-off 60-mile radius probe, for sanity-checking your tagging only — the
hand assignment is authoritative and will differ:

| Market | ~sites | ~MW |
|---|---|---|
| abilene | 4 | 4,600 |
| newcarlisle | 2 | 4,125 |
| memphis | 3 | 1,800 |
| mtpleasant | 3 | 1,700 |
| columbus | 4 | 1,650 |
| dfw | 5 | 1,551 |
| richland | 1 | 1,440 |
| councilbluffs | 1 | 500 |
| phoenix | 1 | 200 |
| nova | 1 | 0 (DLR Ashburn, `mw: null`) |
| desmoines / slc / reno | 0 | 0 |

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_capacity_config.py`:

```python
def test_geo_market_tags_reference_known_markets():
    from pipeline import capacity as capacity_cfg, dc_markets, registry
    _, series = registry.load_registry()
    cfg = capacity_cfg.load_capacity(registry_codes={s.code for s in series})
    keys = {m.key for m in dc_markets.load()}
    tagged = [g for g in cfg["geo"] if g.get("market")]
    assert tagged, "no geo entries tagged to a market"
    for g in tagged:
        assert g["market"] in keys, f"{g['site']}: unknown market {g['market']}"


def test_untagged_geo_entries_are_allowed():
    # ~80 of 112 sites sit outside the 20-market roster (plus 20 non-US
    # sites). Absence of a tag is the correct outcome, not an error.
    from pipeline import capacity as capacity_cfg, registry
    _, series = registry.load_registry()
    cfg = capacity_cfg.load_capacity(registry_codes={s.code for s in series})
    assert any("market" not in g for g in cfg["geo"])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_capacity_config.py -q -k market`
Expected: FAIL — `AssertionError: no geo entries tagged to a market` if Step 1 is not yet done, or a
`KeyError`/unknown-market failure if a tag is mistyped.

- [ ] **Step 4: Add loader validation**

In `pipeline/capacity.py`'s `load_capacity`, beside the existing
`if g["t"] not in known: raise ValueError(...)` check, add:

```python
        m = g.get("market")
        if m is not None and m not in market_keys:
            raise ValueError(f"geo references unknown market {m}")
```

Resolve `market_keys` at the top of the function, injectable like `registry_codes`:

```python
def load_capacity(path: Path | None = None,
                  registry_codes: set[str] | None = None,
                  market_keys: set[str] | None = None) -> dict:
    if market_keys is None:
        from pipeline import dc_markets
        market_keys = {m.key for m in dc_markets.load(registry_codes=registry_codes)}
```

- [ ] **Step 5: Harden the schema**

In `schemas/capacity.schema.json`, under `properties.geo.items.properties`, add the two fields that
are published but undeclared, and bound the coordinates:

```json
"lat": {"type": "number", "minimum": -90, "maximum": 90},
"lng": {"type": "number", "minimum": -180, "maximum": 180},
"when": {"type": "string"},
"market": {"type": "string"}
```

`when` is published on all 112 entries today yet appears nowhere in the schema — `additionalProperties`
is unset on `geo.items`, so it defaults to true and let it through unnoticed. `lat`/`lng` were bare
`{"type": "number"}`, so a transposed or sign-flipped coordinate in 3,714 lines of hand-curated JSON
would pass CI and silently relocate a multi-GW site.

Do **not** add `when` or `market` to `required` — `market` is genuinely optional, and making `when`
required would be a separate, riskier change.

- [ ] **Step 6: Run the capacity tests**

Run: `pytest tests/test_capacity_config.py tests/test_capacity_writer.py -q`
Expected: PASS.

- [ ] **Step 7: Verify the published artifact still validates**

Run: `pytest tests/test_published_data.py -q`
Expected: PASS. If `site/public/data/capacity.json` fails the new `lat`/`lng` bounds, that is a **real
finding** — a bad coordinate already in production. Fix the coordinate in `config/capacity.json`, do
not loosen the bound.

- [ ] **Step 8: Commit**

```bash
git add config/capacity.json schemas/capacity.schema.json pipeline/capacity.py tests/test_capacity_config.py
git commit -m "feat(capacity): market tags on geo[] + schema hardening

Membership by hand-assigned tag, not a radius: 70 of 112 entries are
approx-placed and geo_note's definition of approx doesn't match the
actual coordinates, so no distance computation over them is defensible.
Also declares 'when' (published on all 112 entries but absent from the
schema) and bounds lat/lng, which accepted any number."
```

---

### Task 7: Writer + published schema

**Files:**
- Create: `pipeline/publish/dc_markets.py`
- Create: `schemas/dc_markets.schema.json`
- Test: `tests/test_dc_markets_writer.py`

**Interfaces:**
- Consumes: `dcmarkets.market_rows` (Task 5), `dc_markets.load`/`meta` (Task 4), tagged `geo[]`
  (Task 6)
- Produces:
  - `build(conn, markets, cap_cfg, meta) -> dict`
  - `write(payload: dict, out_dir: Path, published_at: str) -> Path` → `dc_markets.json`

- [ ] **Step 1: Write the schema**

Create `schemas/dc_markets.schema.json`. Every derived field is nullable because a fully suppressed
market must legally validate:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "macrogauge_dc_markets_v1",
  "type": "object",
  "required": ["published_at", "as_of", "base_date", "as_of_curated", "note",
               "national", "markets", "coverage_note"],
  "properties": {
    "published_at": {"type": "string"},
    "as_of": {"type": ["string", "null"]},
    "base_date": {"type": ["string", "null"]},
    "as_of_curated": {"type": "string"},
    "note": {"type": "string"},
    "coverage_note": {"type": "string"},
    "national": {
      "type": "object",
      "required": ["wage", "wage_yoy_pct", "emp", "emp_yoy_pct", "as_of"],
      "properties": {
        "wage": {"type": ["number", "null"]},
        "wage_yoy_pct": {"type": ["number", "null"]},
        "emp": {"type": ["integer", "null"]},
        "emp_yoy_pct": {"type": ["number", "null"]},
        "as_of": {"type": ["string", "null"]}
      }
    },
    "markets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "name", "state", "iso", "grid", "utility",
                     "available", "thin_base", "wage", "wage_yoy_pct",
                     "wage_spread_pp", "emp", "emp_yoy_pct", "emp_spread_pp",
                     "counties", "counties_total", "counties_used",
                     "counties_suppressed", "sites", "mw_disclosed",
                     "sites_mw_undisclosed"],
        "properties": {
          "key": {"type": "string"},
          "name": {"type": "string"},
          "state": {"type": "string"},
          "iso": {"type": ["string", "null"]},
          "grid": {"type": ["string", "null"]},
          "utility": {"type": "string"},
          "note": {"type": "string"},
          "as_of": {"type": ["string", "null"]},
          "base_date": {"type": ["string", "null"]},
          "available": {"type": "boolean"},
          "thin_base": {"type": "boolean"},
          "wage": {"type": ["number", "null"]},
          "wage_yoy_pct": {"type": ["number", "null"]},
          "wage_spread_pp": {"type": ["number", "null"]},
          "emp": {"type": ["integer", "null"]},
          "emp_yoy_pct": {"type": ["number", "null"]},
          "emp_spread_pp": {"type": ["number", "null"]},
          "counties_total": {"type": "integer"},
          "counties_used": {"type": "integer"},
          "counties_suppressed": {"type": "array", "items": {"type": "string"}},
          "sites": {"type": "integer"},
          "mw_disclosed": {"type": "integer"},
          "sites_mw_undisclosed": {"type": "integer"},
          "counties": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["fips", "wage", "emp", "wage_yoy_pct", "emp_yoy_pct"],
              "properties": {
                "fips": {"type": "string"},
                "wage": {"type": ["number", "null"]},
                "emp": {"type": ["integer", "null"]},
                "wage_yoy_pct": {"type": ["number", "null"]},
                "emp_yoy_pct": {"type": ["number", "null"]}
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_dc_markets_writer.py`:

```python
import json
import sqlite3
from pathlib import Path

import jsonschema

from pipeline.dc_markets import MarketSpec
from pipeline.publish import dc_markets as writer

SCHEMA = json.loads(
    (Path(__file__).parent.parent / "schemas" / "dc_markets.schema.json").read_text())

MARKETS = (
    MarketSpec(key="nova", name="Northern Virginia", counties=("51107",),
               state="VA", iso="PJM", grid=None,
               utility="Dominion Energy Virginia", note=""),
    MarketSpec(key="hillsboro", name="Hillsboro OR", counties=("41067",),
               state="OR", iso=None, grid="WECC",
               utility="Portland General Electric", note=""),
)
META = {"as_of_curated": "2026-07-25", "note": "tight core counties"}
CAP_CFG = {"geo": [
    {"t": "DLR", "site": "Ashburn", "mw": None, "st": "o", "lat": 39.0,
     "lng": -77.5, "approx": True, "when": "operating", "market": "nova"},
    {"t": "AMZN", "site": "Somewhere", "mw": 500, "st": "c", "lat": 39.1,
     "lng": -77.6, "approx": True, "when": "2027", "market": "nova"},
    {"t": "META", "site": "Elsewhere", "mw": 900, "st": "c", "lat": 33.0,
     "lng": -84.0, "approx": True, "when": "2027"},
]}


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, "
                 "value REAL, vintage_date TEXT)")
    rows = [
        ("qcew_wage23_us", "2024-10-01", 1727.0), ("qcew_wage23_us", "2025-10-01", 1815.0),
        ("qcew_emp23_us", "2024-10-01", 8117805.0), ("qcew_emp23_us", "2025-10-01", 8195199.0),
        ("qcew_wage23_c51107", "2024-10-01", 2001.0),
        ("qcew_wage23_c51107", "2025-10-01", 2264.0),
        ("qcew_emp23_c51107", "2024-10-01", 22372.0),
        ("qcew_emp23_c51107", "2025-10-01", 26151.0),
        # 41067 (Hillsboro) intentionally absent — disclosure-suppressed
    ]
    conn.executemany(
        "INSERT INTO observations VALUES (?,?,?,'2026-07-25')", rows)
    return conn


def test_payload_validates_against_schema():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)


def test_suppressed_market_still_validates_and_is_marked_unavailable():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)
    by = {m["key"]: m for m in payload["markets"]}
    assert by["hillsboro"]["available"] is False
    assert by["hillsboro"]["wage"] is None


def test_empty_store_degrades_to_valid_payload():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, "
                 "value REAL, vintage_date TEXT)")
    payload = writer.build(conn, MARKETS, CAP_CFG, META)
    jsonschema.validate({"published_at": "2026-07-25T00:00:00Z", **payload},
                        SCHEMA)
    assert payload["as_of"] is None
    assert all(m["available"] is False for m in payload["markets"])


def test_capacity_join_publishes_four_numbers_not_one():
    # A bare MW total would read as authoritative. Sites, disclosed MW, and
    # undisclosed-MW site count all publish so the denominator is visible.
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    nova = {m["key"]: m for m in payload["markets"]}["nova"]
    assert nova["sites"] == 2
    assert nova["mw_disclosed"] == 500
    assert nova["sites_mw_undisclosed"] == 1


def test_untagged_geo_entries_are_not_joined_to_any_market():
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    assert sum(m["sites"] for m in payload["markets"]) == 2  # the META site is untagged


def test_write_lands_the_file(tmp_path):
    payload = writer.build(_conn(), MARKETS, CAP_CFG, META)
    path = writer.write(payload, tmp_path, published_at="2026-07-25T00:00:00Z")
    assert path.name == "dc_markets.json"
    on_disk = json.loads(path.read_text())
    assert on_disk["published_at"] == "2026-07-25T00:00:00Z"
    jsonschema.validate(on_disk, SCHEMA)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_dc_markets_writer.py -q`
Expected: FAIL — `ImportError: cannot import name 'dc_markets' from 'pipeline.publish'`.

- [ ] **Step 4: Write the writer**

Create `pipeline/publish/dc_markets.py`:

```python
"""Writer for dc_markets.json — the /markets DC market panel.

County QCEW wage + employment (tight core counties per market) against the
national NAICS-23 baseline, plus a DENOMINATED capacity-competition column.

The capacity join publishes four numbers, never one: sites, disclosed MW,
sites whose MW is undisclosed, and (site-wide) the geo_unmapped total. A bare
MW figure would read as authoritative when capacity.json is a 29-public-
company roster covering ~40% of its own tracked MW — private operators and
hyperscaler leased space are not in it. Membership is by hand-assigned market
tag, never a coordinate radius: 70 of 112 geo entries are approx-placed and
the flag does not identify which coordinates are trustworthy.

ALL derived math lives here and in engine/dcmarkets.py; the site renders
only."""
from pathlib import Path

from pipeline.engine import dcmarkets
from pipeline.publish.util import write_json

COVERAGE_NOTE = (
    "Competition MW is drawn from the /capacity tracker: 29 public companies, "
    "hand-curated from filings. Private operators (CyrusOne, Vantage, Aligned, "
    "STACK, QTS, EdgeConneX) and hyperscaler leased space inside their shells "
    "are not tracked, and sites with undisclosed locations carry no market. "
    "Treat it as a floor on what is in flight, never a census.")


def _series(conn, code: str) -> dict[str, float]:
    """{obs_date: value} for one series, latest vintage wins."""
    rows = conn.execute(
        "SELECT obs_date, value FROM observations WHERE series_code = ? "
        "ORDER BY vintage_date", (code,)).fetchall()
    return {d: v for d, v in rows}


def build(conn, markets, cap_cfg: dict, meta: dict) -> dict:
    counties = {f for m in markets for f in m.counties}
    wage = {f: _series(conn, f"qcew_wage23_c{f}") for f in counties}
    emp = {f: _series(conn, f"qcew_emp23_c{f}") for f in counties}
    wage = {f: v for f, v in wage.items() if v}
    emp = {f: v for f, v in emp.items() if v}

    payload = dcmarkets.market_rows(
        wage, emp, markets,
        _series(conn, "qcew_wage23_us"), _series(conn, "qcew_emp23_us"))

    # capacity join by hand-assigned tag
    tagged: dict[str, list[dict]] = {}
    for g in cap_cfg["geo"]:
        key = g.get("market")
        if key:
            tagged.setdefault(key, []).append(g)
    for row in payload["markets"]:
        sites = tagged.get(row["key"], [])
        row["sites"] = len(sites)
        row["mw_disclosed"] = int(sum(g["mw"] for g in sites if g.get("mw")))
        row["sites_mw_undisclosed"] = sum(1 for g in sites if not g.get("mw"))

    return {**payload, "as_of_curated": meta["as_of_curated"],
            "note": meta["note"], "coverage_note": COVERAGE_NOTE}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "dc_markets.json")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_dc_markets_writer.py -q`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/dc_markets.py schemas/dc_markets.schema.json tests/test_dc_markets_writer.py
git commit -m "feat: publish dc_markets.json

Capacity join publishes four numbers (sites, disclosed MW, undisclosed-MW
site count, plus the site-wide unmapped total) so the denominator is
visible — capacity.json is a 29-public-company roster covering ~40% of
its own tracked MW."
```

---

### Task 8: Wire the markets phase into the daily run

This is the **tenth** isolated phase (nine `_run_phase` call sites exist today). `qa.run_checks`
cross-checks `phase_errors` against `qa.PHASES` in **both** directions, so a phase wired into
`run_daily` but missing from `PHASES` produces a failing "unknown phase" check rather than silently
reading "completed".

**Files:**
- Modify: `pipeline/run_daily.py`
- Modify: `pipeline/publish/qa.py:22,24`
- Modify: `tests/test_run_daily.py:292`, `tests/test_qa.py`, `tests/test_published_data.py`

**Interfaces:**
- Consumes: Tasks 4–7
- Produces: `markets_ok` in `qa.json`; `site/public/data/dc_markets.json` on every run

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_run_daily.py` (match the surrounding style for how `main` is invoked and how
`fake_get` is wired):

There is **no shared pipeline-runner helper** in this file — every test calls `run_daily.main(...)`
directly with the module-level `fake_get`/`fake_post`, and monkeypatches the *alias* that `run_daily`
imported (`run_daily.capacity_json`, so for us `run_daily.dc_markets_json`). qa checks are keyed
`checks["<phase>_ok"]["pass"]` and `["detail"]` — **not** `["ok"]`. Model these on
`test_capacity_failure_does_not_block_publish` (line 770) and
`test_capacity_schema_violation_fails_run` (line 791):

```python
def test_markets_failure_does_not_block_publish(tmp_path, monkeypatch):
    store, out = tmp_path / "s", tmp_path / "o"

    def boom(*args, **kwargs):
        raise RuntimeError("markets boom")

    monkeypatch.setattr(run_daily.dc_markets_json, "build", boom)
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    checks = {c["name"]: c for c in json.loads((out / "qa.json").read_text())["checks"]}
    assert checks["markets_ok"]["pass"] is False
    assert "markets boom" in checks["markets_ok"]["detail"]
    # phase isolation: the artifact is not written, and neighbours still are
    assert not (out / "dc_markets.json").exists()
    assert (out / "capacity.json").exists()
    assert (out / "qa.json").exists()


def test_markets_schema_violation_fails_run(tmp_path, monkeypatch):
    # The markets block's ValidationError re-raise must stay ahead of its
    # generic Exception handler — a schema-invalid dc_markets.json must crash
    # the run, never deploy. todo.md item 2 exists because commodities lacks
    # this pin; do not add a tenth phase without it.
    store, out = tmp_path / "s", tmp_path / "o"
    monkeypatch.setattr(run_daily.dc_markets_json, "build",
                        lambda *a, **kw: {"as_of": 123})  # wrong type, keys missing
    with pytest.raises(jsonschema.ValidationError):
        run_daily.main(["--store", str(store), "--out", str(out)],
                       http_get=fake_get, http_post=fake_post)
```

Then extend the two places in `test_end_to_end_all_sources` that enumerate artifacts and checks:
add `"dc_markets.json"` to the artifact tuple at **line 281**, add `markets_ok` to the comment and
assertions around **line 291**, bump `assert qa["total"] == 24` at **line 292** to `25`, and add
`assert checks["markets_ok"]["pass"] is True` beside the `capacity_ok` assertion at line 358.

`fake_get` already routes the QCEW URL to `tests/fixtures/qcew_industry23.csv`, which carries county
rows as of Task 2 — no new fake wiring is needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_run_daily.py -q -k markets`
Expected: FAIL — `dc_markets.json` does not exist.

- [ ] **Step 3: Wire the phase**

Add to `pipeline/run_daily.py` immediately after the `CAPACITY` phase (`_run_phase("CAPACITY", ...)`
at line ~354), following that block's shape exactly. The config load goes **inside** the closure so a
bad config edit degrades to qa instead of crashing the run:

```python
    # DC market panel (/markets page): isolated like the phases above —
    # county QCEW labor x the hand-tagged capacity roster. A bad market
    # config or a suppressed county must never touch the core gauge.
    def _markets_phase():
        registry_codes = {s.code for s in series}
        markets = dc_markets_cfg.load(registry_codes=registry_codes)
        mkt_cfg = capacity_cfg.load_capacity(registry_codes=registry_codes)
        mkt_path = dc_markets_json.write(
            dc_markets_json.build(conn, markets, mkt_cfg,
                                  dc_markets_cfg.meta()),
            args.out, published_at=published_at)
        validate.validate_file(mkt_path, SCHEMAS / "dc_markets.schema.json")
        print(f"published: {mkt_path}")

    _run_phase("MARKETS", _markets_phase, phase_errors, "markets")
```

Add the imports beside the existing capacity imports at the top of `pipeline/run_daily.py`:

```python
from pipeline import dc_markets as dc_markets_cfg
from pipeline.publish import dc_markets as dc_markets_json
```

- [ ] **Step 4: Register the phase with qa**

`pipeline/publish/qa.py:22-23`:

```python
PHASES = ("nowcast", "outlook", "composites", "datacenter", "geography",
          "labor", "commodities", "capacity", "markets")
```

`pipeline/publish/qa.py:24-31`, add to `_PHASE_DONE`:

```python
               "markets": "DC market panel completed"}
```

- [ ] **Step 5: Bump the qa total pin**

Covered by Step 1's edits to `test_end_to_end_all_sources` (line 292: `24` → `25`). Also check
`tests/test_qa.py` for its own phase-count or `PHASES` assertions and update them the same way — the
`PHASES` tuple grew from 8 to 9 entries.

- [ ] **Step 6: Add the artifact to the published-data contract**

`tests/test_published_data.py:13-28` — `CONTRACT` is a list of `(file, schema)` tuples. Append:

```python
            ("dc_markets.json", "dc_markets.schema.json")]
```

This list currently covers only **16 of 33** artifacts; without the entry, a committed-but-drifted
`dc_markets.json` would only fail on the next full pipeline run, never in CI.

- [ ] **Step 7: Run the pipeline suite**

Run: `pytest tests/test_run_daily.py tests/test_qa.py tests/test_published_data.py -q`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `pytest -q`
Expected: PASS.

- [ ] **Step 9: Generate the artifact locally**

Run:

```bash
FRED_API_KEY=$FRED_API_KEY python -m pipeline.run_daily --store store --out site/public/data
```

Expected: `published: site/public/data/dc_markets.json`, exit 0. Inspect it — Northern Virginia should
show a wage near $2,031 with a positive YoY, and Hillsboro should show `"available": false`.

If `qcew_*_c*` series have no observations yet, the store has not been collected against the new
registry entries — that is expected on a first run and the phase will degrade rather than crash.
Re-run to accumulate.

- [ ] **Step 10: Commit**

```bash
git add pipeline/run_daily.py pipeline/publish/qa.py tests/ site/public/data/dc_markets.json
git commit -m "feat: wire markets phase into the daily run

Tenth isolated phase. qa.PHASES + _PHASE_DONE updated in lockstep (the
cross-check runs in both directions), qa total 24 -> 25, and
dc_markets.json added to the published-data CONTRACT list."
```

---

### Task 9: Site — client math module

vitest collects only `src/**/*.test.ts` in the node environment. There is no jsdom and no
testing-library, so **logic embedded in a `.tsx` client component is untestable** except through
Playwright. Anything worth covering lives here.

**Files:**
- Create: `site/src/lib/dcMarkets.ts`
- Test: `site/src/lib/dcMarkets.test.ts`

**Interfaces:**
- Consumes: `dc_markets.json` shape from Task 7
- Produces:
  ```ts
  export type SortKey = "name" | "wage" | "wageYoy" | "emp" | "empYoy" | "mw";
  export function sortMarkets(rows: MarketRow[], key: SortKey, desc: boolean): MarketRow[];
  export function tightness(row: MarketRow): "hot" | "warm" | "neutral" | "slack" | "na";
  export function fmtSpread(pp: number | null): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `site/src/lib/dcMarkets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fmtSpread, sortMarkets, tightness } from "./dcMarkets";
import type { MarketRow } from "./types";

const row = (over: Partial<MarketRow>): MarketRow =>
  ({
    key: "k", name: "K", state: "VA", iso: "PJM", grid: null, utility: "U",
    note: "", as_of: "2025-10-01", base_date: "2024-10-01",
    available: true, thin_base: false,
    wage: 2000, wage_yoy_pct: 5, wage_spread_pp: 0,
    emp: 10000, emp_yoy_pct: 1, emp_spread_pp: 0,
    counties: [], counties_total: 1, counties_used: 1, counties_suppressed: [],
    sites: 0, mw_disclosed: 0, sites_mw_undisclosed: 0,
    ...over,
  }) as MarketRow;

describe("sortMarkets", () => {
  it("sorts unavailable markets last regardless of direction", () => {
    // A suppressed market has null metrics. It must never sort into the
    // middle of the table as if it were a zero.
    const rows = [
      row({ key: "sup", available: false, wage: null, wage_yoy_pct: null }),
      row({ key: "hi", wage_yoy_pct: 20 }),
      row({ key: "lo", wage_yoy_pct: 1 }),
    ];
    expect(sortMarkets(rows, "wageYoy", true).map((r) => r.key))
      .toEqual(["hi", "lo", "sup"]);
    expect(sortMarkets(rows, "wageYoy", false).map((r) => r.key))
      .toEqual(["lo", "hi", "sup"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ key: "a", wage_yoy_pct: 1 }), row({ key: "b", wage_yoy_pct: 2 })];
    sortMarkets(rows, "wageYoy", true);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("tightness", () => {
  it("keys off the spread vs national, not the raw rate", () => {
    // +6% wage growth is slack when national is +5.1%. The panel exists to
    // make that distinction.
    expect(tightness(row({ wage_spread_pp: 8, emp_spread_pp: 10 }))).toBe("hot");
    expect(tightness(row({ wage_spread_pp: 3, emp_spread_pp: 4 }))).toBe("warm");
    expect(tightness(row({ wage_spread_pp: 0.5, emp_spread_pp: 0 }))).toBe("neutral");
    expect(tightness(row({ wage_spread_pp: -6, emp_spread_pp: -2 }))).toBe("slack");
  });

  it("returns na for an unavailable market", () => {
    expect(tightness(row({ available: false, wage_spread_pp: null, emp_spread_pp: null })))
      .toBe("na");
  });
});

describe("fmtSpread", () => {
  it("always carries an explicit sign and a pp unit", () => {
    expect(fmtSpread(4.8)).toBe("+4.8pp");
    expect(fmtSpread(-5.7)).toBe("−5.7pp");   // U+2212 minus, not hyphen
    expect(fmtSpread(0)).toBe("+0.0pp");
    expect(fmtSpread(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `site/`): `npm test -- dcMarkets`
Expected: FAIL — cannot resolve `./dcMarkets`.

- [ ] **Step 3: Write the module**

Create `site/src/lib/dcMarkets.ts`:

```ts
// Client math for /markets. Kept out of the .tsx because vitest collects
// only src/**/*.test.ts in the node env — logic inside a component is
// untestable except through Playwright.
import type { MarketRow } from "./types";

export type SortKey = "name" | "wage" | "wageYoy" | "emp" | "empYoy" | "mw";

const VALUE: Record<SortKey, (r: MarketRow) => number | string | null> = {
  name: (r) => r.name,
  wage: (r) => r.wage,
  wageYoy: (r) => r.wage_yoy_pct,
  emp: (r) => r.emp,
  empYoy: (r) => r.emp_yoy_pct,
  mw: (r) => r.mw_disclosed,
};

/** Sort a copy. Unavailable markets always sink to the bottom — a suppressed
 *  row has null metrics and must never sort as if it were a zero. */
export function sortMarkets(rows: MarketRow[], key: SortKey, desc: boolean): MarketRow[] {
  const get = VALUE[key];
  return [...rows].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const av = get(a);
    const bv = get(b);
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv)
      : (av as number) - (bv as number);
    return desc ? -cmp : cmp;
  });
}

/** Labour tightness relative to the NATIONAL rate, not the raw rate: +6%
 *  wage growth is slack when the country is running +5.1%. */
export function tightness(r: MarketRow): "hot" | "warm" | "neutral" | "slack" | "na" {
  if (!r.available || r.wage_spread_pp === null) return "na";
  const w = r.wage_spread_pp;
  const e = r.emp_spread_pp ?? 0;
  const score = w + e / 2;
  if (score >= 10) return "hot";
  if (score >= 3) return "warm";
  if (score > -3) return "neutral";
  return "slack";
}

export function fmtSpread(pp: number | null): string {
  if (pp === null) return "—";
  const sign = pp < 0 ? "−" : "+";
  return `${sign}${Math.abs(pp).toFixed(1)}pp`;
}
```

- [ ] **Step 4: Add the types**

Append to `site/src/lib/types.ts`, declaring every derived field as `| null` (TypeScript infers JSON
types from the committed sample, so a field that is null-in-practice but non-null today would
otherwise type wrong and break the day the pipeline emits a null):

```ts
export type MarketCounty = {
  fips: string;
  wage: number | null;
  emp: number | null;
  wage_yoy_pct: number | null;
  emp_yoy_pct: number | null;
};

export type MarketRow = {
  key: string;
  name: string;
  state: string;
  iso: string | null;
  grid: string | null;
  utility: string;
  note: string;
  as_of: string | null;
  base_date: string | null;
  available: boolean;
  thin_base: boolean;
  wage: number | null;
  wage_yoy_pct: number | null;
  wage_spread_pp: number | null;
  emp: number | null;
  emp_yoy_pct: number | null;
  emp_spread_pp: number | null;
  counties: MarketCounty[];
  counties_total: number;
  counties_used: number;
  counties_suppressed: string[];
  sites: number;
  mw_disclosed: number;
  sites_mw_undisclosed: number;
};

export type DcMarkets = {
  published_at: string;
  as_of: string | null;
  base_date: string | null;
  as_of_curated: string;
  note: string;
  coverage_note: string;
  national: {
    wage: number | null;
    wage_yoy_pct: number | null;
    emp: number | null;
    emp_yoy_pct: number | null;
    as_of: string | null;
  };
  markets: MarketRow[];
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `site/`): `npm test -- dcMarkets`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/dcMarkets.ts site/src/lib/dcMarkets.test.ts site/src/lib/types.ts
git commit -m "feat(site): dcMarkets client math

Tightness keys off the spread vs national, not the raw rate — +6% wage
growth is slack when the country runs +5.1%. Unavailable markets always
sort last so a suppressed row never reads as a zero."
```

---

### Task 10: Site — the /markets page

**Files:**
- Create: `site/src/app/markets/page.tsx`
- Create: `site/src/components/markets/MarketsClient.tsx`
- Modify: `site/src/lib/nav.ts`

**Interfaces:**
- Consumes: `DcMarkets`/`MarketRow` types and helpers from Task 9; `dc_markets.json` from Task 8
- Produces: route `/markets`

- [ ] **Step 1: Write the server page**

Create `site/src/app/markets/page.tsx`, following `site/src/app/capacity/page.tsx` exactly:

```tsx
import type { Metadata } from "next";
import marketsJson from "../../../public/data/dc_markets.json";
import { KpiCard } from "@/components/KpiCard";
import { MarketsClient } from "@/components/markets/MarketsClient";
import type { DcMarkets } from "@/lib/types";

const data = marketsJson as unknown as DcMarkets;
const nat = data.national;
const live = data.markets.filter((m) => m.available);
const hottest = [...live].sort(
  (a, b) => (b.wage_spread_pp ?? 0) - (a.wage_spread_pp ?? 0))[0];

export const metadata: Metadata = {
  title: `DC Market Panel: construction labor across ${live.length} data-center markets`,
  description:
    "Construction wages and headcount where the data centers actually are — county resolution, against the national rate, for 20 real DC markets.",
};

export default function Page() {
  return (
    <div>
      <h1>
        DC Market Panel <span className="subtitle">how tight is the labor where you&apos;re building?</span>
      </h1>
      <p className="lede">
        State resolution averages Loudoun with Bristol. This is{" "}
        <b>construction wages and headcount where the shovels are</b> — tight
        core counties for {data.markets.length} real data-center markets,
        measured against the national rate. Craft labor is the constraint
        nobody prices until it bites: a market adding construction workers
        twice as fast as the country is a market where your subcontractor
        coverage is thinning.
      </p>
      <div className="kpi-row">
        <KpiCard label="National construction wage"
          value={nat.wage != null ? `$${nat.wage.toLocaleString()}/wk` : "—"}
          context={nat.wage_yoy_pct != null
            ? `${nat.wage_yoy_pct > 0 ? "+" : ""}${nat.wage_yoy_pct}% YoY · private NAICS 23`
            : "awaiting first QCEW quarter"} accent="sky" />
        <KpiCard label="National headcount"
          value={nat.emp != null ? `${(nat.emp / 1e6).toFixed(2)}M` : "—"}
          context={nat.emp_yoy_pct != null
            ? `${nat.emp_yoy_pct > 0 ? "+" : ""}${nat.emp_yoy_pct}% YoY`
            : "—"} accent="amber" />
        <KpiCard label="Tightest market"
          value={hottest ? hottest.name : "—"}
          context={hottest && hottest.wage_spread_pp != null
            ? `${hottest.wage_spread_pp > 0 ? "+" : ""}${hottest.wage_spread_pp}pp wage vs national`
            : "—"} accent="violet" />
        <KpiCard label="Markets covered"
          value={`${live.length} / ${data.markets.length}`}
          context="the rest are BLS disclosure-suppressed" accent="sky" />
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
        QCEW quarter <b>{data.as_of ?? "—"}</b> vs <b>{data.base_date ?? "—"}</b>
        {" "}· roster curated <b>{data.as_of_curated}</b>. QCEW publishes ~7 months
        after quarter end — these are the freshest county wages that exist, not
        a current reading.
      </p>
      <MarketsClient data={data} />
      <p className="method">
        <b>Wage is employment-weighted</b> across each market&apos;s counties, and
        year-over-year uses a like-for-like county set: a county
        disclosure-suppressed in either quarter is excluded from both sides, so
        composition change can&apos;t contaminate the rate. Markets are{" "}
        <b>tight core counties</b> — where data centers actually are, not the
        metro area; per-county receipts expand on every row so the aggregation
        is checkable. {data.coverage_note}{" "}
        Utility and ISO are hand-curated attributes of the market, not derived.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the client component**

Create `site/src/components/markets/MarketsClient.tsx`, following
`site/src/components/capacity/CapacityClient.tsx` (`useState` for sort state, one `useMemo` that
sorts, inline-styled toggle buttons, `table.data-table` inside `.table-card`):

```tsx
"use client";
import { useMemo, useState } from "react";
import { fmtSpread, sortMarkets, type SortKey } from "@/lib/dcMarkets";
import type { DcMarkets, MarketRow } from "@/lib/types";

const COLS: [SortKey, string][] = [
  ["name", "Market"], ["wage", "Wage $/wk"], ["wageYoy", "Wage YoY"],
  ["emp", "Constr. workers"], ["empYoy", "Headcount YoY"], ["mw", "MW in flight"],
];

export function MarketsClient({ data }: { data: DcMarkets }) {
  const [key, setKey] = useState<SortKey>("wageYoy");
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(
    () => sortMarkets(data.markets, key, desc), [data.markets, key, desc]);

  const click = (k: SortKey) => {
    if (k === key) setDesc(!desc);
    else { setKey(k); setDesc(true); }
  };

  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            {COLS.map(([k, label]) => (
              <th key={k} onClick={() => click(k)} style={{ cursor: "pointer" }}>
                {label}{key === k ? (desc ? " ▾" : " ▴") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <Row key={m.key} m={m}
              open={open === m.key}
              onToggle={() => setOpen(open === m.key ? null : m.key)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ m, open, onToggle }: { m: MarketRow; open: boolean; onToggle: () => void }) {
  if (!m.available) {
    return (
      <tr>
        <td>{m.name}</td>
        <td colSpan={5} style={{ color: "var(--muted)" }}>
          not available — BLS disclosure suppression
          {m.counties_suppressed.length
            ? ` (${m.counties_suppressed.join(", ")})` : ""}
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          {m.name}{m.thin_base ? " ⚠" : ""}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.iso ?? m.grid} · {m.utility}
          </div>
        </td>
        <td>${m.wage?.toLocaleString()}</td>
        <td>{m.wage_yoy_pct}% <small>{fmtSpread(m.wage_spread_pp)}</small></td>
        <td>{m.emp?.toLocaleString()}</td>
        <td>{m.emp_yoy_pct}% <small>{fmtSpread(m.emp_spread_pp)}</small></td>
        <td>
          {m.sites === 0 ? "—" : `${m.mw_disclosed.toLocaleString()} MW`}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {m.sites} tracked site{m.sites === 1 ? "" : "s"}
            {m.sites_mw_undisclosed
              ? ` · ${m.sites_mw_undisclosed} MW undisclosed` : ""}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <table className="data-table">
              <thead>
                <tr><th>County FIPS</th><th>Wage</th><th>Wage YoY</th>
                  <th>Workers</th><th>Headcount YoY</th></tr>
              </thead>
              <tbody>
                {m.counties.map((c) => (
                  <tr key={c.fips}>
                    <td>{c.fips}</td>
                    <td>${c.wage?.toLocaleString()}</td>
                    <td>{c.wage_yoy_pct}%</td>
                    <td>{c.emp?.toLocaleString()}</td>
                    <td>{c.emp_yoy_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.thin_base && (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                ⚠ Thin base — under 1,500 construction workers. The rate is
                real but noisy; a single large project moves it.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 3: Add the nav entry**

In `site/src/lib/nav.ts`, add to the **AI Infra** group's `items`, after `/escalation`:

```ts
          { href: "/markets", label: "DC Markets", emoji: "🏗️" },
```

🏗️ is verified unique against the 25 emoji currently in use (🗺️ and 🏙️ are taken by `/states` and
`/metros`). **Nav emoji uniqueness is enforced only by human review — nothing in CI asserts it.**

- [ ] **Step 4: Build the site**

Run (from `site/`): `npm run build`
Expected: PASS, with `/markets` in the route list. A failure here usually means `dc_markets.json` is
missing from `site/public/data` — Task 8 must have committed it.

- [ ] **Step 5: Run the unit tests**

Run (from `site/`): `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/app/markets site/src/components/markets site/src/lib/nav.ts
git commit -m "feat(site): /markets DC market panel

Sortable market table with expandable per-county receipts; suppressed
markets render an explicit unavailable state rather than a zero."
```

---

### Task 11: E2E coverage, docs, and final verification

**Files:**
- Modify: `site/e2e/smoke.spec.ts`
- Modify: `CLAUDE.md`, `todo.md`, `docs/plans/2026-07-24-project-controls-gaps.md`

- [ ] **Step 1: Add the e2e route**

In `site/e2e/smoke.spec.ts`, add to `ROUTES`:

```ts
  ["/markets", "construction wages and headcount where the shovels are"],
```

The marker must be unique to the page **body**. Nav dropdown items are always in the DOM (CSS-hidden)
on every page and the footer lists every route label, so a marker like `"DC Markets"` would resolve to
a hidden nav link instead. This string comes from the `.lede` and appears nowhere else.

- [ ] **Step 2: Run the e2e suite**

Run (from `site/`): `npm run build && npm run e2e`
Expected: PASS — 28 routes, 33 tests, zero console errors.

- [ ] **Step 3: Update CLAUDE.md**

Three edits:

1. Artifact count: the file says "32 published files" but there were **33** before this feature (it
   omits `outlook.json`). It is now **34**. Fix the base number rather than propagating the error.
2. Add `dc_markets` to the published-file enumeration, described as the DC market panel.
3. Update the isolated-phase sentence from "nine ISOLATED `try/except` blocks" to **ten**, and add
   `markets_ok` to the `engine_ok / nowcast_ok / ...` list.
4. Update the test counts in the Commands block: `pytest -q` and the e2e route/test counts.

- [ ] **Step 4: Update todo.md**

Mark item 11 (P2) done in the Done section with a one-liner, and add any follow-ups this plan
deliberately left open (below).

- [ ] **Step 5: Update the gap register**

In `docs/plans/2026-07-24-project-controls-gaps.md` §P2, change **Status** to shipped with the date
and branch, and record that the register's radius join and ISO column were refuted by measurement —
pointing at the spec so the finding is not re-derived. Note that P2's original "announced MW within
~60 miles" framing is superseded.

- [ ] **Step 6: Full verification**

Run, and paste the actual output rather than asserting from memory:

```bash
pytest -q
cd site && npm run build && npm test && npm run e2e
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add site/e2e/smoke.spec.ts CLAUDE.md todo.md docs/plans/2026-07-24-project-controls-gaps.md
git commit -m "test(site): e2e for /markets + docs sync

CLAUDE.md artifact count corrected 32 -> 34 (it had omitted outlook.json)
and the isolated-phase count updated to ten."
```

---

## Follow-ups this plan deliberately leaves open

1. **`geo_note` overstates what `approx: true` means.** It says state-centroid placement, but many
   entries are town/county centroids. Correct at the next capacity schema rev — alongside todo.md
   items 5 and 21.
2. **`pipeline/publish/capacity.py:20`'s `_YEAR = re.compile(r"20(2[5-9])")` expires in 2030.**
3. **`when` is not `required` in `capacity.schema.json`** — this plan declares it but does not make it
   mandatory, which is a separate and riskier change.
4. **`qtrly_estabs` is available in the rows we download and is not ingested.** No column needs it
   yet; revisit if an establishment-count column earns its place.
5. **The power/ops columns are state-resolution and are not on the panel.** `dcindex.parity_rows()`
   is key-agnostic and could be re-resolved to market keys, but EIA industrial power has no sub-state
   series, so two markets in one state would share an identical `ops_mult`. Adding it needs the
   resolution label designed first — deferred rather than shipped mislabelled.
6. **`tests/test_published_data.py` covers only 16 of 33 artifacts.** This plan adds one; the other
   16 gaps remain.

## Self-Review Notes

- **Spec coverage:** §1 config → Task 4. §2 collection → Tasks 1–3. §3 engine → Task 5. §4 capacity
  join → Tasks 6, 7. §5 publish → Tasks 7, 8. §6 site → Tasks 9, 10. §7 testing → distributed, with
  e2e in Task 11. The spec's folded-in `lat`/`lng` bounds fix → Task 6 Step 5.
- **Deliberate deferral:** the spec's §4 mention of reusing `parity_rows()` for build/ops multipliers
  is **not** implemented — it is follow-up 5 above. The spec required the state-resolution label to be
  designed before publishing those columns, and that design work was not done. Everything else in the
  spec is covered.
- **Type consistency:** `MarketSpec` fields (Task 4) match the engine's reads (Task 5) and the writer's
  passthrough (Task 7). `MarketRow` (Task 9 types) matches the schema's `markets.items` (Task 7) field
  for field. `EMP_SUFFIX` (Task 2) is the same `~emp` used in `config/series.json` `source_id` (Task 3)
  and in the writer's `qcew_emp23_c{fips}` lookups (Task 7).
- **Counts pinned in this plan:** registry 598 → 659; qa total 24 → 25; `PHASES` 8 → 9 entries; e2e
  routes 27 → 28; published artifacts 33 → 34.
