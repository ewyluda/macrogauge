# Data Center Cost Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/datacenter` — two custom input-cost inflation indexes (DC Build, DC Ops)
plus a state parity table, published as `datacenter.json` by a fourth isolated block in
the daily pipeline.

**Architecture:** New series ride existing connectors (FRED/EIA/FMP) plus one small new
QCEW CSV connector, all registered in `config/series.json` under two NEW source keys
(`EIA_STATE`, `QCEW`) for failure isolation. A new pure-stage orchestrator
`pipeline/engine/dcindex.py` composes the existing `rebase`/`gate`/`aggregate` stages
plus a new `splice_anchored()` (official backbone everywhere it exists; futures drive
only the tail past the last print). One publisher + schema, a fourth isolated
try/except in `run_daily.py` with a `datacenter_ok` QA flag, and a static site page.

**Tech Stack:** Python 3.12 (pytest), Next.js static export (ECharts via existing
`EChart` component), Playwright e2e, JSON Schema.

**Spec:** `docs/superpowers/specs/2026-07-11-datacenter-cost-index-design.md` (revised
2026-07-12). Read it before starting any task.

## Global Constraints

- **No network in tests, ever.** Connectors take `http_get`/`http_post`; tests use fixtures in `tests/fixtures/`.
- **Store is append-only**; never rewrite a committed partition; new vintages append.
- **`jsonschema.ValidationError` re-raises and fails the run** in every isolated block; generic exceptions surface via `*_ok` QA flags with rc 0.
- **`sources_status` publishes FIRST** — do not move the new block above it.
- **Weights sum to 1.0 per basket**, validated on load (`ValueError` otherwise).
- Grid start `2017-01-01` internally; **publish from `2018-01-01`**; base month `2018-01` = 100.
- Futures `max_staleness_days` = 7; PPI/CES = 45; EIA state power = 75; QCEW = 270.
- **Spike notes are authoritative for series IDs** (`docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md` after Task 1). Candidate IDs in this plan are starting points; if the spike corrected one, use the spike's value everywhere.
- Component YoY is computed at each component's OWN last observation (`aggregate.yoy_at_obs`), never at the grid end.
- A stale series carries forward — it must NEVER shift weight to other components.
- Commit style: `feat(...)`/`fix(...)`/`docs(...)`/`data(...)` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Work on a feature branch (e.g. `dc-index`); do NOT push to origin without explicit user approval (push to main = production deploy).
- **Sequencing:** Task 9 (real data commit) MUST precede Task 10 — site pages statically import `site/public/data/*.json`, so `npm run build` fails until `datacenter.json` is committed. Task 9 needs real API keys (user's local env).

---

### Task 1: Series verification spike (no pipeline code)

**Files:**
- Create: `docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md`
- Create: `tests/fixtures/qcew_industry23.csv` (trimmed from a real download)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the authoritative series-ID table + final weights (with citations) that Tasks 3 and 4 copy from; the recorded QCEW fixture Task 2's tests consume.

This task needs `FRED_API_KEY`, `EIA_API_KEY`, `FMP_API_KEY` in the environment and live
network access (it is a manual verification, not a test). If keys are unavailable, stop
and ask the user to run the commands.

- [ ] **Step 1: Verify each candidate FRED series**

For each row below, run (substituting the ID):

```bash
curl -s "https://api.stlouisfed.org/fred/series?series_id=WPU1017&api_key=$FRED_API_KEY&file_type=json" \
  | python3 -c "import json,sys; s=json.load(sys.stdin)['seriess'][0]; print(s['id'], '|', s['title'], '|', s['frequency'], '|', s['observation_start'])"
```

Acceptance per series: frequency **Monthly**, `observation_start` ≤ `2017-01-01`, title
matches the concept. If a candidate fails, search for a substitute and record it:

```bash
curl -s "https://api.stlouisfed.org/fred/series/search?search_text=SEARCH+TERMS&api_key=$FRED_API_KEY&file_type=json" \
  | python3 -c "import json,sys; [print(s['id'],'|',s['title'],'|',s['frequency'],'|',s['observation_start']) for s in json.load(sys.stdin)['seriess'][:10]]"
```

| registry code | concept | primary candidate | fallback search terms |
|---|---|---|---|
| `ces_constr_ahe` | AHE, construction ($/hr) | `CES2000000003` | "average hourly earnings construction" |
| `ppi_elec_contr` | PPI electrical contractors | `PCU238210238210` | "PPI electrical contractors" |
| `ppi_plumb_hvac` | PPI plumbing/HVAC contractors | `PCU238220238220` | "PPI plumbing heating air-conditioning contractors" |
| `ppi_steel` | PPI steel mill products | `WPU1017` | "PPI steel mill products" |
| `ppi_concrete` | PPI ready-mix concrete | `PCU327320327320` | "PPI ready-mix concrete" |
| `ppi_copper_wire` | PPI copper wire & cable | `WPU10260321` | "PPI copper wire cable"; fallback `WPU1026` (nonferrous wire & cable) |
| `ppi_alum_shapes` | PPI aluminum mill shapes | `WPU1025` | "PPI aluminum mill shapes" |
| `ppi_switchgear` | PPI switchgear & switchboard | `WPU1175` | "PPI switchgear switchboard" |
| `ppi_transformer` | PPI transformers & power regulators | `WPU1174` | "PPI transformers power regulators" |
| `ppi_genset` | PPI turbine/generator sets | `PCU333611333611` | "PPI turbine generator set" |
| `ppi_hvac_equip` | PPI AC/refrigeration & heating equip | `PCU333415333415` | "PPI air conditioning refrigeration heating equipment"; fallback `WPU1148` |
| `ppi_pumps` | PPI industrial pumps | `WPU1141` | "PPI pumps compressors" |
| `ces_dp_ahe` | AHE, data processing/hosting (NAICS 518) | `CES5051800003` | "average hourly earnings data processing hosting" |
| `ppi_mach_repair` | PPI machinery repair & maintenance | `PCU811310811310` | "PPI commercial industrial machinery repair maintenance" |

- [ ] **Step 2: Verify EIA state industrial electricity pattern**

```bash
for sid in ELEC.PRICE.US-IND.M ELEC.PRICE.CA-IND.M ELEC.PRICE.VA-IND.M; do
  curl -s "https://api.eia.gov/v2/seriesid/$sid?api_key=$EIA_API_KEY" \
    | python3 -c "import json,sys; d=json.load(sys.stdin)['response']['data']; print('$sid', d[0])"
done
```

Expected: rows with `period` (`YYYY-MM`) and a `price` (or `value`) column. Record the
value column name and latest period in the spike notes.

- [ ] **Step 3: Verify the QCEW industry-slice CSV and record the fixture**

```bash
curl -s "https://data.bls.gov/cew/data/api/2025/4/industry/23.csv" -o /tmp/qcew23.csv
head -1 /tmp/qcew23.csv                       # record the exact header
grep '"US000"' /tmp/qcew23.csv | head -3      # national rows (need own_code 5)
grep '"06000"' /tmp/qcew23.csv | head -3      # California
grep '"51000"' /tmp/qcew23.csv | head -3      # Virginia
```

Acceptance: header contains `area_fips`, `own_code`, `year`, `qtr`, `avg_wkly_wage`;
US000 and state rows exist with `own_code` 5. If 2025/4 404s, walk back a quarter.
If US000 has no own_code-5 row in the industry slice, record the contingency: fetch
`.../area/US000.csv` additionally for the national wage (Task 2 then adds one extra GET).

Build the fixture — header line + the own_code-5 rows for `US000`, `06000` (CA),
`51000` (VA), `48000` (TX) only:

```bash
{ head -1 /tmp/qcew23.csv; grep -h '"US000"\|"06000"\|"51000"\|"48000"' /tmp/qcew23.csv | grep '^"[^"]*","5"'; } \
  > tests/fixtures/qcew_industry23.csv
wc -l tests/fixtures/qcew_industry23.csv   # expect 5 lines (header + 4 rows)
```

- [ ] **Step 4: Verify FMP futures under the pipeline's own key**

```bash
curl -s "https://financialmodelingprep.com/stable/batch-quote?symbols=HGUSD,ALIUSD&apikey=$FMP_API_KEY" | python3 -m json.tool
curl -s "https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=HGUSD&from=2017-01-01&apikey=$FMP_API_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'rows, earliest', d[-1]['date'])"
```

Acceptance: both symbols quote; history reaches back at least a year (deep history is
NOT required — the anchored splice only needs overlap with recent PPI prints).

- [ ] **Step 5: Check weights against published industry breakdowns**

Web-check Turner & Townsend's data centre cost index and a CBRE/Uptime-style build-cost
breakdown. Record citations and the FINAL per-series weights (group sums per spec §3:
labor 0.30, materials 0.25, electrical 0.30, mechanical 0.15 — adjust if the citations
demand it, keeping each basket's total at 1.0). Specifically stress-test the
electrical-equipment share (hyperscale studies often put it above 30%).

- [ ] **Step 6: Write the spike notes**

Create `docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md` with: (a) the final
series table — registry code, confirmed source ID, title, observation_start, units;
(b) any substitutions and why; (c) EIA value-column finding; (d) QCEW header + the
chosen route + national-row finding; (e) FMP confirmation + earliest history date;
(f) final weights table with citations.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md tests/fixtures/qcew_industry23.csv
git commit -m "docs(dc-index): series verification spike notes + recorded QCEW fixture"
```

---

### Task 2: QCEW connector

**Files:**
- Create: `pipeline/connectors/qcew.py`
- Test: `tests/test_qcew.py`
- Uses fixture: `tests/fixtures/qcew_industry23.csv` (from Task 1)

**Interfaces:**
- Consumes: `pipeline.models.Observation`, `pipeline.connectors.fred.today_et`.
- Produces: `qcew.fetch(area_fips: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]` — one observation per (area, quarter), `series_code` = the raw `area_fips` (collect's id_map renames it), `obs_date` = quarter-first-month (`YYYY-{01,04,07,10}-01`). Task 3 wires this into `collect.FETCHERS`.

If the Task-1 fixture's header names differ from `area_fips`/`own_code`/`year`/`qtr`/
`avg_wkly_wage`, adjust the field names in both test and implementation to the recorded
header — the fixture is the contract.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_qcew.py
from pathlib import Path

import pytest

from pipeline.connectors import qcew

FIXTURE = Path(__file__).parent / "fixtures" / "qcew_industry23.csv"


class _Resp:
    def __init__(self, text, status=200):
        self.text, self._status = text, status

    def raise_for_status(self):
        if self._status != 200:
            raise RuntimeError(f"HTTP {self._status}")


def fake_get(url, timeout=None, **kw):
    assert "data.bls.gov/cew/data/api/" in url and url.endswith("/industry/23.csv")
    return _Resp(FIXTURE.read_text())


def test_fetch_filters_to_registered_areas_private_ownership():
    obs = qcew.fetch(["US000", "06000"], vintage_date="2026-07-12", http_get=fake_get)
    assert obs, "no observations parsed"
    assert {o.series_code for o in obs} == {"US000", "06000"}
    for o in obs:
        assert o.source == "QCEW" and o.route == "CSV"
        assert o.obs_date.endswith("-01")
        assert o.obs_date[5:7] in ("01", "04", "07", "10")
        assert o.value > 0


def test_recent_quarters_walks_back_across_year_boundary():
    assert qcew._recent_quarters("2026-01-15", n=3) == [(2025, 3), (2025, 4), (2026, 1)]


def test_missing_quarters_tolerated_but_all_missing_raises():
    calls = []

    def flaky_get(url, timeout=None, **kw):
        calls.append(url)
        if len(calls) <= 2:          # the two newest-walked quarters 404
            return _Resp("", status=404)
        return _Resp(FIXTURE.read_text())

    obs = qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=flaky_get)
    assert obs  # later quarters still loaded

    def dead_get(url, timeout=None, **kw):
        return _Resp("", status=404)

    with pytest.raises(RuntimeError, match="no quarter loaded"):
        qcew.fetch(["US000"], vintage_date="2026-07-12", http_get=dead_get)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_qcew.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.connectors.qcew'`

- [ ] **Step 3: Implement the connector**

```python
# pipeline/connectors/qcew.py
"""QCEW open-data CSV connector — quarterly state wages, NAICS industry slice.

https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv returns one
row per area x ownership for that quarter. We keep own_code 5 (private) rows
whose area_fips is registered, reading avg_wkly_wage; quarterly observations are
dated at the quarter's first month. Keyless. QCEW publishes with a ~5-month lag
and revises prior quarters, so each run walks the last N_QUARTERS quarters:
per-quarter failures are tolerated (the newest quarters 404 until published),
but zero loaded quarters raises — collect's isolation surfaces it. The store's
value-dedupe makes refetching unchanged quarters free.
"""
import csv
import io
from datetime import date

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

QCEW_URL = "https://data.bls.gov/cew/data/api/{year}/{qtr}/industry/{naics}.csv"
NAICS = "23"
N_QUARTERS = 4  # publication lag ~2 quarters + revision refresh headroom


def _recent_quarters(today: str, n: int = N_QUARTERS) -> list[tuple[int, int]]:
    d = date.fromisoformat(today)
    year, q = d.year, (d.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        out.append((year, q))
        q -= 1
        if q == 0:
            year, q = year - 1, 4
    return list(reversed(out))  # oldest first


def fetch(area_fips: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted = set(area_fips)
    out: list[Observation] = []
    loaded, errors = 0, []
    for year, q in _recent_quarters(vintage):
        try:
            resp = http_get(QCEW_URL.format(year=year, qtr=q, naics=NAICS),
                            timeout=120)  # industry files are large (all counties)
            resp.raise_for_status()
        except Exception as e:
            errors.append(f"{year}q{q}: {type(e).__name__}")
            continue
        loaded += 1
        for row in csv.DictReader(io.StringIO(resp.text)):
            if row["own_code"] != "5" or row["area_fips"] not in wanted:
                continue
            month = (int(row["qtr"]) - 1) * 3 + 1
            out.append(Observation(
                series_code=row["area_fips"],
                obs_date=f"{row['year']}-{month:02d}-01",
                value=float(row["avg_wkly_wage"]),
                vintage_date=vintage, source="QCEW", route="CSV"))
    if not loaded:
        raise RuntimeError(f"QCEW: no quarter loaded — {'; '.join(errors)}")
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_qcew.py -q`
Expected: 3 passed

- [ ] **Step 5: Full suite, then commit**

Run: `pytest -q` — expected: all pass, no regressions.

```bash
git add pipeline/connectors/qcew.py tests/test_qcew.py
git commit -m "feat(connectors): QCEW open-data CSV connector (NAICS-23 quarterly wages)"
```

---

### Task 3: Registry — new sources, ~120 series, collect wiring

**Files:**
- Modify: `config/series.json` (2 sources + 16 national/futures + 104 per-state entries)
- Modify: `pipeline/collect.py` (import + 2 fetchers + FETCHERS entries)
- Modify: `tests/test_registry.py` (source set, counts, fred_ids pins)
- Modify: `tests/test_run_daily.py` (fake_get QCEW branch; sources 15 → 17)

**Interfaces:**
- Consumes: `qcew.fetch` (Task 2), existing `eia.fetch`.
- Produces: registry codes every later task references — `ces_constr_ahe`, `ppi_elec_contr`, `ppi_plumb_hvac`, `ppi_steel`, `ppi_concrete`, `ppi_copper_wire`, `ppi_alum_shapes`, `ppi_switchgear`, `ppi_transformer`, `ppi_genset`, `ppi_hvac_equip`, `ppi_pumps`, `ces_dp_ahe`, `ppi_mach_repair`, `fmp_copper`, `fmp_alum`, `eia_elec_ind_us`, `eia_elec_ind_{st}` × 51, `qcew_wage23_us`, `qcew_wage23_{st}` × 51.

Use the spike-confirmed source IDs; the `source_id` values below are the plan's
candidates.

- [ ] **Step 1: Update the failing registry test first**

In `tests/test_registry.py::test_load_real_registry`:
- add `"EIA_STATE", "QCEW"` to the expected source-name set;
- `assert len(series) == 219` (was 99: +14 FRED, +2 FMP, +52 EIA_STATE, +52 QCEW);
- `assert len(fred) == 61` (was 47);
- add the 14 new pairs to the `fred_ids` dict (code → spike-confirmed source_id), e.g. `"ces_constr_ahe": "CES2000000003", "ppi_steel": "WPU1017", ...` for all 14 national FRED codes above;
- add after the fred_ids assert:

```python
    assert sources["QCEW"].secret is None and sources["QCEW"].route == "CSV"
    assert sources["EIA_STATE"].secret == "EIA_API_KEY"
    assert sum(1 for s in series if s.source == "EIA_STATE") == 52
    assert sum(1 for s in series if s.source == "QCEW") == 52
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_registry.py -q`
Expected: FAIL — source set mismatch.

- [ ] **Step 3: Add sources + national series to `config/series.json`**

In `"sources"` (after `"STREET"`):

```json
    "EIA_STATE": {"route": "API", "cadence": "monthly", "secret": "EIA_API_KEY"},
    "QCEW":     {"route": "CSV", "cadence": "quarterly"}
```

Append to `"series"` (spike IDs where corrected):

```json
    {"code": "ces_constr_ahe",  "source": "FRED", "source_id": "CES2000000003",   "name": "Avg hourly earnings, construction ($/hr)", "max_staleness_days": 45},
    {"code": "ppi_elec_contr",  "source": "FRED", "source_id": "PCU238210238210", "name": "PPI electrical contractors",               "max_staleness_days": 45},
    {"code": "ppi_plumb_hvac",  "source": "FRED", "source_id": "PCU238220238220", "name": "PPI plumbing/HVAC contractors",            "max_staleness_days": 45},
    {"code": "ppi_steel",       "source": "FRED", "source_id": "WPU1017",         "name": "PPI steel mill products",                  "max_staleness_days": 45},
    {"code": "ppi_concrete",    "source": "FRED", "source_id": "PCU327320327320", "name": "PPI ready-mix concrete",                   "max_staleness_days": 45},
    {"code": "ppi_copper_wire", "source": "FRED", "source_id": "WPU10260321",     "name": "PPI copper wire & cable",                  "max_staleness_days": 45},
    {"code": "ppi_alum_shapes", "source": "FRED", "source_id": "WPU1025",         "name": "PPI aluminum mill shapes",                 "max_staleness_days": 45},
    {"code": "ppi_switchgear",  "source": "FRED", "source_id": "WPU1175",         "name": "PPI switchgear & switchboard",             "max_staleness_days": 45},
    {"code": "ppi_transformer", "source": "FRED", "source_id": "WPU1174",         "name": "PPI transformers & power regulators",      "max_staleness_days": 45},
    {"code": "ppi_genset",      "source": "FRED", "source_id": "PCU333611333611", "name": "PPI turbine & generator sets",             "max_staleness_days": 45},
    {"code": "ppi_hvac_equip",  "source": "FRED", "source_id": "PCU333415333415", "name": "PPI AC, refrigeration & heating equip",    "max_staleness_days": 45},
    {"code": "ppi_pumps",       "source": "FRED", "source_id": "WPU1141",         "name": "PPI pumps & compressors",                  "max_staleness_days": 45},
    {"code": "ces_dp_ahe",      "source": "FRED", "source_id": "CES5051800003",   "name": "Avg hourly earnings, data processing/hosting ($/hr)", "max_staleness_days": 45},
    {"code": "ppi_mach_repair", "source": "FRED", "source_id": "PCU811310811310", "name": "PPI machinery repair & maintenance",       "max_staleness_days": 45},
    {"code": "fmp_copper",      "source": "FMP",  "source_id": "HGUSD",           "name": "Copper futures front month $/lb",          "max_staleness_days": 7},
    {"code": "fmp_alum",        "source": "FMP",  "source_id": "ALIUSD",          "name": "Aluminum futures front month $/ton",       "max_staleness_days": 7}
```

- [ ] **Step 4: Generate and paste the 104 per-state entries**

Run this snippet; paste its stdout into `"series"` after the entries from Step 3
(remove the trailing comma on the final line):

```python
# scratch: generate per-state registry entries
STATES = {"al":"01","ak":"02","az":"04","ar":"05","ca":"06","co":"08","ct":"09",
 "de":"10","dc":"11","fl":"12","ga":"13","hi":"15","id":"16","il":"17","in":"18",
 "ia":"19","ks":"20","ky":"21","la":"22","me":"23","md":"24","ma":"25","mi":"26",
 "mn":"27","ms":"28","mo":"29","mt":"30","ne":"31","nv":"32","nh":"33","nj":"34",
 "nm":"35","ny":"36","nc":"37","nd":"38","oh":"39","ok":"40","or":"41","pa":"42",
 "ri":"44","sc":"45","sd":"46","tn":"47","tx":"48","ut":"49","vt":"50","va":"51",
 "wa":"53","wv":"54","wi":"55","wy":"56"}
rows = ['    {"code": "eia_elec_ind_us", "source": "EIA_STATE", "source_id": "ELEC.PRICE.US-IND.M", "name": "Industrial electricity ¢/kWh (US)", "max_staleness_days": 75},']
for st in STATES:
    rows.append(f'    {{"code": "eia_elec_ind_{st}", "source": "EIA_STATE", "source_id": "ELEC.PRICE.{st.upper()}-IND.M", "name": "Industrial electricity ¢/kWh ({st.upper()})", "max_staleness_days": 75}},')
rows.append('    {"code": "qcew_wage23_us", "source": "QCEW", "source_id": "US000", "name": "QCEW avg weekly wage, construction (US)", "max_staleness_days": 270},')
for st, fips in STATES.items():
    rows.append(f'    {{"code": "qcew_wage23_{st}", "source": "QCEW", "source_id": "{fips}000", "name": "QCEW avg weekly wage, construction ({st.upper()})", "max_staleness_days": 270}},')
print("\n".join(rows))
```

- [ ] **Step 5: Wire the fetchers in `pipeline/collect.py`**

Add `qcew` to the connectors import list, then after `_street`:

```python
def _eia_state(subset, key, http):
    return eia.fetch([s.source_id for s in subset], key, http_get=http)


def _qcew(subset, key, http):
    return qcew.fetch([s.source_id for s in subset], http_get=http)
```

Add to `FETCHERS`: `"EIA_STATE": _eia_state, "QCEW": _qcew`. (`POST_SOURCES` unchanged
— both are GET.)

- [ ] **Step 6: Teach `tests/test_run_daily.py` the QCEW URL**

In `fake_get`, before the final `raise AssertionError`:

```python
    if "data.bls.gov/cew" in url:
        return _text(FIXTURES / "qcew_industry23.csv")
```

Also tighten the existing EIA branch — its `".W" in url` heuristic misfires on the new
state series (`ELEC.PRICE.WA-IND.M` contains `.W`), which would feed weekly gasoline
prices into WA/WV/WI/WY power series. Change:

```python
        name = "eia_weekly.json" if ".W" in url else "eia_monthly.json"
```
to
```python
        name = "eia_weekly.json" if url.endswith(".W") else "eia_monthly.json"
```

Update the source-count assertion in `test_end_to_end_all_sources`:
`assert len(status["sources"]) == 17` (was 15; EIA_STATE routes through the existing
`api.eia.gov` fake branch — no new fixture needed).

- [ ] **Step 7: Run the full suite**

Run: `pytest -q`
Expected: all pass (registry, collect, run_daily end-to-end with 17 sources). If any
other test pins a series/source count (search: `grep -rn "== 99\|== 15\|== 47" tests/`),
update that pin the same way as test_registry — do not weaken the assertion.

- [ ] **Step 8: Commit**

```bash
git add config/series.json pipeline/collect.py tests/test_registry.py tests/test_run_daily.py
git commit -m "feat(registry): DC-index series under isolated EIA_STATE/QCEW source keys"
```

---

### Task 4: DC basket config + loader

**Files:**
- Create: `config/dc_basket.json`
- Create: `pipeline/dc_basket.py`
- Test: `tests/test_dc_basket.py`

**Interfaces:**
- Consumes: registry codes from Task 3.
- Produces: `DCComponent(code, label, group, series, weight, live_proxy=None)`; `load_baskets(path=None, registry_codes=None) -> tuple[str, dict[str, list[DCComponent]]]` (base_month, `{"build": [...], "ops": [...]}`); `load_group_labels(path=None) -> dict[str, str]`; `parity_shares(baskets) -> tuple[float, float]` (w_labor, w_power). Tasks 6–8 consume all four.

Weights below are provisional; use the spike's final cited weights (each basket must
still sum to 1.0).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dc_basket.py
import json

import pytest

from pipeline import dc_basket


def test_load_real_baskets():
    base_month, baskets = dc_basket.load_baskets()
    assert base_month == "2018-01"
    assert set(baskets) == {"build", "ops"}
    for name, comps in baskets.items():
        assert abs(sum(c.weight for c in comps) - 1.0) <= 1e-9
    proxied = {c.code: c.live_proxy for c in baskets["build"] if c.live_proxy}
    assert proxied == {"copper_wire": "fmp_copper", "alum_shapes": "fmp_alum"}
    w_labor, w_power = dc_basket.parity_shares(baskets)
    assert 0 < w_labor < 1 and 0 < w_power < 1
    assert dc_basket.load_group_labels()["labor"]


def _write(tmp_path, build, ops):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops}))
    return p


OK_OPS = [{"code": "power", "label": "P", "group": "power", "series": "s_p", "weight": 1.0}]


def test_bad_weight_sum_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.6}],
               OK_OPS)
    with pytest.raises(ValueError, match="weights sum"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_p"})


def test_unknown_series_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "nope", "weight": 1.0}],
               OK_OPS)
    with pytest.raises(ValueError, match="unknown series code"):
        dc_basket.load_baskets(p, registry_codes={"s_p"})


def test_duplicate_component_code_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 0.5},
                {"code": "a", "label": "A2", "group": "labor", "series": "s_b", "weight": 0.5}],
               OK_OPS)
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_baskets(p, registry_codes={"s_a", "s_b", "s_p"})
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dc_basket.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.dc_basket'`

- [ ] **Step 3: Create `config/dc_basket.json`**

```json
{
  "base_month": "2018-01",
  "group_labels": {
    "labor": "Construction labor", "materials": "Materials",
    "electrical": "Electrical equipment", "mechanical": "Mechanical / cooling",
    "power": "Power", "ops_labor": "Facilities & ops labor",
    "maintenance": "Maintenance & parts"
  },
  "build": [
    {"code": "constr_wages",           "label": "Construction wages",              "group": "labor",      "series": "ces_constr_ahe",  "weight": 0.15},
    {"code": "elec_contractors",       "label": "Electrical contractors",          "group": "labor",      "series": "ppi_elec_contr",  "weight": 0.09},
    {"code": "plumb_hvac_contractors", "label": "Plumbing/HVAC contractors",       "group": "labor",      "series": "ppi_plumb_hvac",  "weight": 0.06},
    {"code": "steel",                  "label": "Steel mill products",             "group": "materials",  "series": "ppi_steel",       "weight": 0.08},
    {"code": "concrete",               "label": "Ready-mix concrete",              "group": "materials",  "series": "ppi_concrete",    "weight": 0.06},
    {"code": "copper_wire",            "label": "Copper wire & cable",             "group": "materials",  "series": "ppi_copper_wire", "weight": 0.07, "live_proxy": "fmp_copper"},
    {"code": "alum_shapes",            "label": "Aluminum mill shapes",            "group": "materials",  "series": "ppi_alum_shapes", "weight": 0.04, "live_proxy": "fmp_alum"},
    {"code": "switchgear",             "label": "Switchgear & switchboard",        "group": "electrical", "series": "ppi_switchgear",  "weight": 0.12},
    {"code": "transformers",           "label": "Power & distribution transformers","group": "electrical","series": "ppi_transformer", "weight": 0.10},
    {"code": "generators",             "label": "Generator sets & turbines",       "group": "electrical", "series": "ppi_genset",      "weight": 0.08},
    {"code": "hvac_equip",             "label": "AC & refrigeration equipment",    "group": "mechanical", "series": "ppi_hvac_equip",  "weight": 0.10},
    {"code": "pumps",                  "label": "Industrial pumps",                "group": "mechanical", "series": "ppi_pumps",       "weight": 0.05}
  ],
  "ops": [
    {"code": "power",       "label": "Industrial electricity",        "group": "power",       "series": "eia_elec_ind_us", "weight": 0.55},
    {"code": "ops_wages",   "label": "Facilities & ops wages",        "group": "ops_labor",   "series": "ces_dp_ahe",      "weight": 0.30},
    {"code": "maintenance", "label": "Machinery repair & maintenance","group": "maintenance", "series": "ppi_mach_repair", "weight": 0.15}
  ]
}
```

- [ ] **Step 4: Implement `pipeline/dc_basket.py`**

```python
"""DC cost index basket — series-level components, display groups (spec §3).

One component per series: blend()'s renormalize-on-missing semantics is wrong
for distinct goods (a stale steel PPI must carry forward, never hand its
weight to concrete), so weights live at the series level and `group` is a
display rollup only. live_proxy marks a genuine same-concept daily proxy
(futures) grafted via splice_anchored downstream."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_basket.json"


@dataclass(frozen=True)
class DCComponent:
    code: str                   # internal component id, e.g. "switchgear"
    label: str                  # display label
    group: str                  # display rollup key ("labor", "materials", ...)
    series: str                 # store series code of the monthly backbone
    weight: float               # share of its basket; each basket sums to 1.0
    live_proxy: str | None = None  # store series code of the daily proxy, if any


def load_baskets(path: Path | None = None,
                 registry_codes: set[str] | None = None
                 ) -> tuple[str, dict[str, list[DCComponent]]]:
    """(base_month, {"build": [...], "ops": [...]}). Validates weight sums,
    duplicate codes, and that every series/live_proxy exists in the registry
    (pass registry_codes explicitly in tests)."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    baskets: dict[str, list[DCComponent]] = {}
    for name in ("build", "ops"):
        comps = [DCComponent(code=c["code"], label=c["label"], group=c["group"],
                             series=c["series"], weight=c["weight"],
                             live_proxy=c.get("live_proxy"))
                 for c in raw[name]]
        codes = [c.code for c in comps]
        dupes = {c for c in codes if codes.count(c) > 1}
        if dupes:
            raise ValueError(f"dc_basket {name}: duplicate codes {sorted(dupes)}")
        total = sum(c.weight for c in comps)
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"dc_basket {name}: weights sum to {total}, expected 1.0")
        for c in comps:
            for code in filter(None, (c.series, c.live_proxy)):
                if code not in registry_codes:
                    raise ValueError(
                        f"dc_basket {name}/{c.code}: unknown series code {code}")
        baskets[name] = comps
    return raw["base_month"], baskets


def load_group_labels(path: Path | None = None) -> dict[str, str]:
    return json.loads((path or DEFAULT_PATH).read_text())["group_labels"]


def parity_shares(baskets: dict[str, list[DCComponent]]) -> tuple[float, float]:
    """(w_labor, w_power) for the pinned parity formula (spec §6): the build
    'labor' group share and the ops 'power' group share."""
    w_labor = sum(c.weight for c in baskets["build"] if c.group == "labor")
    w_power = sum(c.weight for c in baskets["ops"] if c.group == "power")
    if not w_labor or not w_power:
        raise ValueError("parity shares: build needs a 'labor' group, ops a 'power' group")
    return w_labor, w_power
```

- [ ] **Step 5: Run tests, then full suite**

Run: `pytest tests/test_dc_basket.py -q` — expected: 4 passed.
Run: `pytest -q` — expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add config/dc_basket.json pipeline/dc_basket.py tests/test_dc_basket.py
git commit -m "feat(dc-index): series-level basket config + loader with parity shares"
```

---

### Task 5: `splice_anchored` engine stage

**Files:**
- Modify: `pipeline/engine/blend.py` (append one function)
- Test: `tests/test_blend.py` (append tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `blend.splice_anchored(official: dict[str, float], live: dict[str, float]) -> dict[str, float]` — Task 6 calls it.

- [ ] **Step 1: Write the failing tests (append to `tests/test_blend.py`)**

Match the file's existing import style (it already imports the blend module; ensure
`import pytest` is present at the top since these tests use `pytest.approx`).

```python
def test_splice_anchored_keeps_official_and_scales_tail():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0}
    live = {"2017-01-15": 50.0, "2017-02-10": 52.0, "2017-03-01": 55.0}
    out = blend.splice_anchored(official, live)
    # official values never overwritten
    assert out["2017-01-01"] == 100.0 and out["2017-02-01"] == 102.0
    # tail scaled at the LAST official obs: scale = 102 / live(2017-01-15) = 2.04
    assert out["2017-02-10"] == pytest.approx(52.0 * 2.04)
    assert out["2017-03-01"] == pytest.approx(55.0 * 2.04)
    # live points at/before the anchor never enter the output
    assert "2017-01-15" not in out


def test_splice_anchored_reanchors_on_new_print():
    official = {"2017-01-01": 100.0, "2017-02-01": 102.0, "2017-03-01": 110.0}
    live = {"2017-01-15": 50.0, "2017-02-10": 52.0, "2017-03-01": 55.0,
            "2017-03-20": 56.0}
    out = blend.splice_anchored(official, live)
    # anchor moved to 2017-03-01: scale = 110/55 = 2.0 — drift does not compound
    assert out["2017-03-01"] == 110.0
    assert out["2017-03-20"] == pytest.approx(112.0)
    assert "2017-02-10" not in out  # official backbone covers that span now


def test_splice_anchored_edges():
    official = {"2017-01-01": 100.0}
    assert blend.splice_anchored(official, {}) == official
    assert blend.splice_anchored({}, {"2017-01-02": 5.0}) == {"2017-01-02": 5.0}
    # live entirely after the anchor with no overlap: cannot scale -> official only
    assert blend.splice_anchored(official, {"2017-02-01": 55.0}) == official
    # zero at the scaling point: official only (no div-by-zero)
    assert blend.splice_anchored(official, {"2016-12-31": 0.0, "2017-02-01": 5.0}) == official
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_blend.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'splice_anchored'`

- [ ] **Step 3: Implement (append to `pipeline/engine/blend.py`)**

```python
def splice_anchored(official: dict[str, float], live: dict[str, float]) -> dict[str, float]:
    """Official everywhere it exists; live tail only AFTER the last official
    obs, scaled to be continuous there — re-anchored every run as new prints
    land.

    Contrast splice(): that anchors ONCE at the live series' first obs and
    drops official data after it — right for the gauge's independent
    re-pricing (live replaces official), wrong for a proxy that merely
    nowcasts an official backbone (DC index): raw futures are an input to a
    fabricated-product PPI, not a measure of it, so proxy volatility and
    contract-roll drift must stay confined to the ~1-2 month tail."""
    if not official:
        return dict(live)
    t0 = max(official)
    overlap = [d for d in live if d <= t0]
    if not overlap or not live[max(overlap)]:
        return dict(official)  # nothing to scale on (or zero): official only
    scale = official[t0] / live[max(overlap)]
    out = dict(official)
    out.update({d: v * scale for d, v in live.items() if d > t0})
    return out
```

- [ ] **Step 4: Run tests, full suite**

Run: `pytest tests/test_blend.py -q` — expected: all pass (existing + 3 new).
Run: `pytest -q` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/blend.py tests/test_blend.py
git commit -m "feat(engine): splice_anchored — official backbone, re-anchoring proxy tail"
```

---

### Task 6: `dcindex` engine — the two indexes

**Files:**
- Create: `pipeline/engine/dcindex.py` (indexes only; parity is Task 7)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: `dc_basket.load_baskets`, `rebase.rebase`, `blend.splice_anchored`, `gate.apply_gate`, `aggregate.{fill_daily,headline,yoy_at_obs,fill_yoy,weighted_yoy}`, `vintage.latest`.
- Produces: `dcindex.run(conn, today: str, basket_path: Path | None = None) -> dict` returning `{"base_month": str, "indexes": {"build": {...}, "ops": {...}}}` where each index dict has keys `index` (date→float), `yoy` (date→float|None), `as_of` (str), `gate_flags` (list[str]), `components` (code → `{"label","group","weight","mode","yoy_pct","last_obs"}`). Constants `GRID_START = "2017-01-01"`, `PUBLISH_START = "2018-01-01"`. Tasks 7–8 consume.

- [ ] **Step 1: Write the failing tests**

Tests use real registry codes (Task 3) so the loader's registry validation passes.

```python
# tests/test_dcindex.py
import json

import pytest

from pipeline.engine import dcindex
from pipeline.models import Observation
from pipeline.store import vintage


def make_conn(tmp_path, rows, vintages=None):
    """rows: (series_code, obs_date, value); vintages: optional per-row vintage."""
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date=(vintages or {}).get((c, d), "2026-01-01"),
                       source="T", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path / "store")
    return vintage.load(tmp_path / "store")


def write_basket(tmp_path, build, ops):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops}))
    return p


TWO_COMP_BUILD = [
    {"code": "steel", "label": "Steel", "group": "materials", "series": "ppi_steel", "weight": 0.6},
    {"code": "concrete", "label": "Concrete", "group": "materials", "series": "ppi_concrete", "weight": 0.4},
]
ONE_COMP_OPS = [
    {"code": "power", "label": "Power", "group": "power", "series": "eia_elec_ind_us", "weight": 1.0},
]
OPS_ROWS = [("eia_elec_ind_us", "2017-01-01", 10.0), ("eia_elec_ind_us", "2018-01-01", 10.5)]


def test_headline_yoy_is_weighted_own_obs_yoy(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    build = result["indexes"]["build"]
    assert build["as_of"] == "2018-01-01"
    # steel +10%, concrete +5% -> 0.6*10 + 0.4*5 = 8.0
    assert build["yoy"]["2018-01-01"] == pytest.approx(8.0)
    assert build["components"]["steel"]["yoy_pct"] == pytest.approx(10.0)
    assert build["components"]["concrete"]["yoy_pct"] == pytest.approx(5.0)
    assert build["components"]["steel"]["mode"] == "official"
    ops = result["indexes"]["ops"]
    assert ops["yoy"]["2018-01-01"] == pytest.approx(5.0)


def test_stale_series_carries_forward_no_weight_shift(tmp_path):
    # concrete stops in 2017-06; its last value must carry forward into the
    # headline at the grid end — NOT be dropped or renormalized away.
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2017-06-01", 220.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-15", basket_path=basket)
    build = result["indexes"]["build"]
    assert build["as_of"] == "2018-01-01"
    # rebase anchors concrete on 2018-01 fallback-first-month rules? No — concrete
    # has no 2018-01 obs, so rebase anchors on its FIRST month (2017-01): index
    # 2017-06 = 220/200*100 = 110, carried to 2018-01-01.
    assert build["index"]["2018-01-01"] == pytest.approx(0.6 * 100.0 + 0.4 * 110.0)
    # concrete's YoY is at its OWN last obs (2017-06-01, base missing -> None)
    assert build["components"]["concrete"]["last_obs"] == "2017-06-01"


def test_proxy_splice_and_gate(tmp_path):
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0, "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-01-01", 100.0), ("ppi_copper_wire", "2018-01-01", 100.0),
        ("fmp_copper", "2018-01-01", 50.0), ("fmp_copper", "2018-01-05", 55.0),
    ] + OPS_ROWS
    basket = write_basket(tmp_path, build, ONE_COMP_OPS)

    # (a) proxy point just arrived today and jumps 10% -> gate holds it one day
    conn = make_conn(tmp_path / "a", rows,
                     vintages={("fmp_copper", "2018-01-05"): "2018-01-05"})
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["components"]["copper_wire"]["mode"] == "official+proxy"
    assert b["index"]["2018-01-05"] == pytest.approx(100.0)  # held at prior value
    assert b["gate_flags"] == ["copper_wire@2018-01-05"]

    # (b) same data, not just-arrived -> spike passes through, spliced tail
    #     scale x rebase cancel: 100 * 55/50 = 110 exactly
    conn = make_conn(tmp_path / "b", rows)
    result = dcindex.run(conn, today="2018-01-05", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["index"]["2018-01-05"] == pytest.approx(110.0)
    assert b["gate_flags"] == []


def test_missing_series_raises_clear_error(tmp_path):
    conn = make_conn(tmp_path, OPS_ROWS)  # no build series data at all
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    with pytest.raises(ValueError):
        dcindex.run(conn, today="2018-01-15", basket_path=basket)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dcindex.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.engine.dcindex'`

- [ ] **Step 3: Implement `pipeline/engine/dcindex.py`**

```python
"""DC cost index engine: two input-cost indexes (build, ops) + state parity.

Composes the existing pure stages per component: rebase -> (anchored splice of
a futures proxy, if configured) -> gate -> aggregate. Weights live at the
series level (dc_basket): a stale component carries forward on the daily grid
and NEVER hands its weight to its neighbors. Component YoY is computed at each
component's OWN last observation (aggregate.yoy_at_obs) — the PPI components
lag 1-2 months and must compare like-month-to-like-month.

A component whose backbone series has no store rows raises (rebase's empty-
series ValueError): the run_daily datacenter block catches it and surfaces
datacenter_ok=false rather than publishing a silently mis-weighted index.
"""
import sqlite3
from pathlib import Path

from pipeline import dc_basket
from pipeline.engine import aggregate, gate, rebase
from pipeline.engine import blend as blend_mod
from pipeline.store import vintage

GRID_START = "2017-01-01"    # internal grid start: feeds 365d YoY bases for 2018
PUBLISH_START = "2018-01-01"  # writers publish from here


def _series(conn: sqlite3.Connection, code: str) -> dict[str, float]:
    return dict(vintage.latest(conn, code))


def _arrived_today(conn, code: str, obs_date: str, today: str) -> bool:
    # mirrors gauge._arrived_today for a single series (kept local: the
    # 14-component gauge engine is deliberately untouched by this feature)
    row = conn.execute(
        "SELECT MAX(vintage_date) FROM observations "
        "WHERE series_code = ? AND obs_date = ?", (code, obs_date)).fetchone()
    return row[0] == today


def run(conn: sqlite3.Connection, today: str,
        basket_path: Path | None = None) -> dict:
    base_month, baskets = dc_basket.load_baskets(basket_path)
    out = {}
    for name, comps in baskets.items():
        built, flags, modes = {}, [], {}
        for comp in comps:
            official = _series(conn, comp.series)
            idx = rebase.rebase(official, base_month)
            live = _series(conn, comp.live_proxy) if comp.live_proxy else {}
            if live:
                live_idx = rebase.rebase(live, base_month)
                idx = blend_mod.splice_anchored(idx, live_idx)
                last = max(idx)
                idx, flagged = gate.apply_gate(
                    idx, _arrived_today(conn, comp.live_proxy, last, today))
                if flagged:
                    flags.append(f"{comp.code}@{last}")
            built[comp.code] = idx
            modes[comp.code] = "official+proxy" if live else "official"
        end = min(max(max(s) for s in built.values()), today)
        daily = {k: aggregate.fill_daily(s, GRID_START, end)
                 for k, s in built.items()}
        weights = {c.code: c.weight for c in comps}
        index = aggregate.headline(daily, weights)
        own_yoy = {}
        for code, s in built.items():
            at_obs = aggregate.yoy_at_obs(s, daily[code])
            own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
        components = {}
        for c in comps:
            own_end = max(d for d in built[c.code] if d <= end)
            components[c.code] = {
                "label": c.label, "group": c.group, "weight": c.weight,
                "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "last_obs": own_end}
        out[name] = {"index": index,
                     "yoy": aggregate.weighted_yoy(own_yoy, weights),
                     "as_of": end, "gate_flags": flags, "components": components}
    return {"base_month": base_month, "indexes": out}
```

- [ ] **Step 4: Run tests, full suite**

Run: `pytest tests/test_dcindex.py -q` — expected: 4 passed.
Run: `pytest -q` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(engine): dcindex — build/ops indexes over anchored-splice components"
```

---

### Task 7: State parity

**Files:**
- Modify: `pipeline/engine/dcindex.py` (append parity functions)
- Test: `tests/test_dcindex.py` (append)

**Interfaces:**
- Consumes: `dc_basket.parity_shares`, `vintage.latest`, Task 6's module.
- Produces: `dcindex.parity_rows(power, wage, nat_power, nat_wage, w_labor, w_power) -> dict` (pure; inputs are `{state: (obs_date, value)}` dicts and `(obs_date, value) | None` nationals) and `dcindex.parity_from_store(conn, basket_path=None) -> dict`. Result shape: `{"mode": "full"|"ops_only"|"unavailable", "w_labor": float, "w_power": float, "national": {"power": {...}|None, "wage": {...}|None}, "states": [{"state","power_rel","ops_mult","power_asof","wage_rel","build_mult","wage_asof"}]}`. Task 8 consumes.

- [ ] **Step 1: Write the failing tests (append to `tests/test_dcindex.py`)**

```python
def test_parity_pinned_worked_example():
    # spec §6 pinned formula: mult = w x relative + (1 - w)
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={"ca": ("2026-01-01", 2000.0)},
        nat_power=("2026-05-01", 10.0), nat_wage=("2026-01-01", 1600.0),
        w_labor=0.30, w_power=0.55)
    assert out["mode"] == "full"
    row = out["states"][0]
    assert row["state"] == "CA"
    assert row["power_rel"] == pytest.approx(1.2)
    assert row["ops_mult"] == pytest.approx(0.55 * 1.2 + 0.45)   # 1.11
    assert row["wage_rel"] == pytest.approx(1.25)
    assert row["build_mult"] == pytest.approx(0.30 * 1.25 + 0.70)  # 1.075
    assert row["power_asof"] == "2026-05-01" and row["wage_asof"] == "2026-01-01"


def test_parity_degrades_to_ops_only_without_wages():
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={},
        nat_power=("2026-05-01", 10.0), nat_wage=None,
        w_labor=0.30, w_power=0.55)
    assert out["mode"] == "ops_only"
    row = out["states"][0]
    assert row["ops_mult"] == pytest.approx(1.11)
    assert row["wage_rel"] is None and row["build_mult"] is None


def test_parity_unavailable_without_national_power():
    out = dcindex.parity_rows(power={"ca": ("2026-05-01", 12.0)}, wage={},
                              nat_power=None, nat_wage=None,
                              w_labor=0.30, w_power=0.55)
    assert out["mode"] == "unavailable" and out["states"] == []


def test_parity_from_store_discovers_states(tmp_path):
    conn = make_conn(tmp_path, [
        ("eia_elec_ind_us", "2026-05-01", 10.0),
        ("eia_elec_ind_ca", "2026-05-01", 12.0),
        ("eia_elec_ind_va", "2026-04-01", 8.0),
        ("qcew_wage23_us", "2026-01-01", 1600.0),
        ("qcew_wage23_ca", "2026-01-01", 2000.0),
    ])
    # explicit tmp basket with known parity shares: w_labor 0.30, w_power 0.55
    build = [
        {"code": "labor", "label": "L", "group": "labor", "series": "ces_constr_ahe", "weight": 0.30},
        {"code": "rest", "label": "R", "group": "materials", "series": "ppi_steel", "weight": 0.70},
    ]
    ops = [
        {"code": "power", "label": "P", "group": "power", "series": "eia_elec_ind_us", "weight": 0.55},
        {"code": "ops_wages", "label": "W", "group": "ops_labor", "series": "ces_dp_ahe", "weight": 0.45},
    ]
    basket = write_basket(tmp_path, build, ops)
    out = dcindex.parity_from_store(conn, basket_path=basket)
    assert out["mode"] == "full"
    by_state = {r["state"]: r for r in out["states"]}
    assert set(by_state) == {"CA", "VA"}
    assert by_state["CA"]["build_mult"] == pytest.approx(1.075)     # 0.30 x 1.25 + 0.70
    assert by_state["VA"]["ops_mult"] == pytest.approx(0.55 * 0.8 + 0.45)
    assert by_state["VA"]["build_mult"] is None  # no VA wage row
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dcindex.py -q`
Expected: new tests FAIL — `AttributeError: ... no attribute 'parity_rows'`

- [ ] **Step 3: Implement (append to `pipeline/engine/dcindex.py`)**

```python
def parity_rows(power: dict[str, tuple[str, float]],
                wage: dict[str, tuple[str, float]],
                nat_power: tuple[str, float] | None,
                nat_wage: tuple[str, float] | None,
                w_labor: float, w_power: float) -> dict:
    """Pinned parity formula (spec §6): mult = w x state_relative + (1 - w).
    Inputs that don't vary by state are pinned at relative 1.0. Pure function;
    inputs are {state: (obs_date, value)} plus national (obs_date, value)."""
    national = {
        "power": None if not nat_power else {"value": nat_power[1], "as_of": nat_power[0]},
        "wage": None if not nat_wage else {"value": nat_wage[1], "as_of": nat_wage[0]}}
    base = {"w_labor": w_labor, "w_power": w_power, "national": national}
    if not nat_power or not nat_power[1]:
        return {"mode": "unavailable", "states": [], **base}
    mode = "full" if nat_wage and nat_wage[1] and wage else "ops_only"
    states = []
    for st in sorted(power):
        p_date, p_val = power[st]
        power_rel = p_val / nat_power[1]
        row = {"state": st.upper(), "power_rel": round(power_rel, 4),
               "ops_mult": round(w_power * power_rel + (1 - w_power), 4),
               "power_asof": p_date,
               "wage_rel": None, "build_mult": None, "wage_asof": None}
        w = wage.get(st)
        if w and nat_wage and nat_wage[1]:
            wage_rel = w[1] / nat_wage[1]
            row["wage_rel"] = round(wage_rel, 4)
            row["build_mult"] = round(w_labor * wage_rel + (1 - w_labor), 4)
            row["wage_asof"] = w[0]
        states.append(row)
    return {"mode": mode, "states": states, **base}


def _latest_row(conn, code: str) -> tuple[str, float] | None:
    rows = vintage.latest(conn, code)
    return rows[-1] if rows else None


def _by_state(conn, prefix: str) -> dict[str, tuple[str, float]]:
    codes = [r[0] for r in conn.execute(
        "SELECT DISTINCT series_code FROM observations WHERE series_code LIKE ?",
        (prefix + "%",))]
    out = {}
    for code in codes:
        st = code[len(prefix):]
        if st == "us":
            continue
        row = _latest_row(conn, code)
        if row:
            out[st] = row
    return out


def parity_from_store(conn: sqlite3.Connection,
                      basket_path: Path | None = None) -> dict:
    """Store-driven parity: states are discovered from what actually exists in
    the store (a missing state degrades to a missing row, never an error)."""
    _, baskets = dc_basket.load_baskets(basket_path)
    w_labor, w_power = dc_basket.parity_shares(baskets)
    return parity_rows(_by_state(conn, "eia_elec_ind_"),
                       _by_state(conn, "qcew_wage23_"),
                       _latest_row(conn, "eia_elec_ind_us"),
                       _latest_row(conn, "qcew_wage23_us"),
                       w_labor, w_power)
```

- [ ] **Step 4: Run tests, full suite**

Run: `pytest tests/test_dcindex.py -q` — expected: 8 passed.
Run: `pytest -q` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(engine): state parity — pinned formula, store-driven discovery, ops-only degrade"
```

---

### Task 8: Publisher, schema, run_daily block, QA flag

**Files:**
- Create: `pipeline/publish/datacenter.py`
- Create: `schemas/datacenter.schema.json`
- Modify: `pipeline/run_daily.py` (import + fourth isolated block + qa call)
- Modify: `pipeline/publish/qa.py` (`datacenter_error` param + check)
- Test: create `tests/test_datacenter_writer.py`; modify `tests/test_qa.py`, `tests/test_run_daily.py`

**Interfaces:**
- Consumes: `dcindex.run`, `dcindex.parity_from_store`, `dc_basket.load_group_labels`, `validate.validate_file`.
- Produces: `datacenter.build(dc_result: dict, parity_result: dict) -> dict`; `datacenter.write(payload, out_dir: Path, published_at: str) -> Path` (writes `datacenter.json`); QA check named `datacenter_ok` (critical False). Published-file count 25 → 26.

- [ ] **Step 1: Write the failing writer test**

```python
# tests/test_datacenter_writer.py
import json
from pathlib import Path

from pipeline.publish import datacenter, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

DC_RESULT = {
    "base_month": "2018-01",
    "indexes": {
        "build": {
            "index": {"2017-06-01": 99.0, "2018-01-01": 100.0, "2018-06-01": 104.0},
            "yoy": {"2017-06-01": None, "2018-01-01": 2.0, "2018-06-01": 4.0},
            "as_of": "2018-06-01", "gate_flags": [],
            "components": {
                "steel": {"label": "Steel", "group": "materials", "weight": 0.6,
                          "mode": "official", "yoy_pct": 5.0, "last_obs": "2018-06-01"},
                "copper_wire": {"label": "Copper", "group": "materials", "weight": 0.4,
                                "mode": "official+proxy", "yoy_pct": None,
                                "last_obs": "2018-06-01"}}},
        "ops": {
            "index": {"2018-01-01": 100.0}, "yoy": {"2018-01-01": None},
            "as_of": "2018-01-01", "gate_flags": ["power@2018-01-01"],
            "components": {
                "power": {"label": "Power", "group": "power", "weight": 1.0,
                          "mode": "official", "yoy_pct": 3.0, "last_obs": "2018-01-01"}}},
    }}
PARITY = {"mode": "ops_only", "w_labor": 0.3, "w_power": 0.55,
          "national": {"power": {"value": 10.0, "as_of": "2026-05-01"}, "wage": None},
          "states": [{"state": "CA", "power_rel": 1.2, "ops_mult": 1.11,
                      "power_asof": "2026-05-01", "wage_rel": None,
                      "build_mult": None, "wage_asof": None}]}


def test_build_publishes_from_2018_with_contributions():
    payload = datacenter.build(DC_RESULT, PARITY)
    b = payload["indexes"]["build"]
    assert b["dates"][0] == "2018-01-01"          # 2017 grid is internal only
    assert b["headline_yoy_pct"] == 4.0
    comps = {c["code"]: c for c in b["components"]}
    assert comps["steel"]["contribution_pp"] == 3.0        # 0.6 x 5.0
    assert comps["copper_wire"]["contribution_pp"] is None
    assert payload["parity"]["mode"] == "ops_only"
    assert payload["group_labels"]["materials"] == "Materials"


def test_written_file_validates_against_schema(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY)
    path = datacenter.write(payload, tmp_path, published_at="2026-07-12T12:00:00Z")
    assert path.name == "datacenter.json"
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
    assert json.loads(path.read_text())["published_at"] == "2026-07-12T12:00:00Z"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_datacenter_writer.py -q`
Expected: FAIL — `ImportError: cannot import name 'datacenter'`

- [ ] **Step 3: Implement writer + schema**

```python
# pipeline/publish/datacenter.py
"""Writer for datacenter.json — DC Build/Ops cost indexes + state parity."""
import json
from pathlib import Path

from pipeline import dc_basket
from pipeline.engine.dcindex import PUBLISH_START


def build(dc_result: dict, parity_result: dict) -> dict:
    out = {"rebase": f"{dc_result['base_month']}=100",
           "group_labels": dc_basket.load_group_labels(),
           "indexes": {}, "parity": parity_result}
    for name, v in dc_result["indexes"].items():
        dates = [d for d in sorted(v["index"]) if d >= PUBLISH_START]
        headline = v["yoy"].get(v["as_of"])
        out["indexes"][name] = {
            "as_of": v["as_of"],
            "headline_yoy_pct": None if headline is None else round(headline, 2),
            "gate_flags": v["gate_flags"],
            "dates": dates,
            "index": [round(v["index"][d], 2) for d in dates],
            "yoy_pct": [None if v["yoy"][d] is None else round(v["yoy"][d], 2)
                        for d in dates],
            "components": [
                {"code": code, "label": e["label"], "group": e["group"],
                 "weight": e["weight"], "mode": e["mode"],
                 "last_obs": e["last_obs"],
                 "yoy_pct": None if e["yoy_pct"] is None else round(e["yoy_pct"], 2),
                 "contribution_pp": None if e["yoy_pct"] is None
                     else round(e["weight"] * e["yoy_pct"], 2)}
                for code, e in v["components"].items()]}
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "datacenter.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
```

`schemas/datacenter.schema.json` (single line is fine, matching repo style; shown
expanded for review):

```json
{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
 "required": ["published_at", "rebase", "group_labels", "indexes", "parity"],
 "properties": {
  "published_at": {"type": "string"},
  "rebase": {"type": "string"},
  "group_labels": {"type": "object"},
  "indexes": {"type": "object", "required": ["build", "ops"],
   "additionalProperties": {"type": "object",
    "required": ["as_of", "headline_yoy_pct", "gate_flags", "dates", "index", "yoy_pct", "components"],
    "properties": {
     "as_of": {"type": "string"},
     "headline_yoy_pct": {"type": ["number", "null"]},
     "gate_flags": {"type": "array", "items": {"type": "string"}},
     "dates": {"type": "array", "items": {"type": "string"}},
     "index": {"type": "array", "items": {"type": "number"}},
     "yoy_pct": {"type": "array", "items": {"type": ["number", "null"]}},
     "components": {"type": "array", "items": {"type": "object",
      "required": ["code", "label", "group", "weight", "mode", "last_obs", "yoy_pct", "contribution_pp"],
      "properties": {
       "code": {"type": "string"}, "label": {"type": "string"},
       "group": {"type": "string"}, "weight": {"type": "number"},
       "mode": {"type": "string", "enum": ["official", "official+proxy"]},
       "last_obs": {"type": "string"},
       "yoy_pct": {"type": ["number", "null"]},
       "contribution_pp": {"type": ["number", "null"]}}}}}}},
  "parity": {"type": "object", "required": ["mode", "states"],
   "properties": {
    "mode": {"type": "string", "enum": ["full", "ops_only", "unavailable"]},
    "w_labor": {"type": "number"}, "w_power": {"type": "number"},
    "national": {"type": "object"},
    "states": {"type": "array", "items": {"type": "object",
     "required": ["state", "power_rel", "ops_mult", "power_asof", "wage_rel", "build_mult", "wage_asof"],
     "properties": {
      "state": {"type": "string"},
      "power_rel": {"type": "number"}, "ops_mult": {"type": "number"},
      "power_asof": {"type": "string"},
      "wage_rel": {"type": ["number", "null"]},
      "build_mult": {"type": ["number", "null"]},
      "wage_asof": {"type": ["string", "null"]}}}}}}}}
```

Run: `pytest tests/test_datacenter_writer.py -q` — expected: 2 passed.

- [ ] **Step 4: QA flag — failing test first**

Append to `tests/test_qa.py` (mirror the existing nowcast_ok/composites_ok tests'
style — call `qa.run_checks` the way neighboring tests in that file do):

```python
def test_datacenter_ok_check():
    ok = qa.run_checks(None, today="2026-07-12", engine_error="x")
    names = {c["name"]: c for c in ok["checks"]}
    assert names["datacenter_ok"]["pass"] is True

    bad = qa.run_checks(None, today="2026-07-12", engine_error="x",
                        datacenter_error="RuntimeError: dc boom")
    names = {c["name"]: c for c in bad["checks"]}
    assert names["datacenter_ok"]["pass"] is False
    assert names["datacenter_ok"]["critical"] is False
    assert "dc boom" in names["datacenter_ok"]["detail"]
```

Run: `pytest tests/test_qa.py -q` — expected: FAIL (unexpected keyword `datacenter_error`).

Then in `pipeline/publish/qa.py`: add `datacenter_error: str | None = None` to
`run_checks`'s signature, and directly after the `composites_ok` append:

```python
    checks.append({"name": "datacenter_ok", "critical": False,
                   "pass": datacenter_error is None,
                   "detail": datacenter_error or "datacenter completed"})
```

Run: `pytest tests/test_qa.py -q` — expected: all pass.

- [ ] **Step 5: Wire the fourth isolated block in `pipeline/run_daily.py`**

Imports: add `from pipeline.engine import dcindex` and extend the publish import list
with `datacenter as datacenter_json` (keep alphabetical grouping). Insert AFTER the
composites block and BEFORE the `if nowcast_payload is not None:` line:

```python
    # DC cost index (datacenter page): isolated like the three blocks above —
    # a broken PPI/QCEW/state-power series must never touch the core gauge.
    datacenter_error = None
    try:
        dc_result = dcindex.run(conn, today=today)
        parity_result = dcindex.parity_from_store(conn)
        dc_path = datacenter_json.write(
            datacenter_json.build(dc_result, parity_result),
            args.out, published_at=published_at)
        validate.validate_file(dc_path, SCHEMAS / "datacenter.schema.json")
        print(f"published: {dc_path}")
    except jsonschema.ValidationError:
        raise  # contract violation must fail the run — never deploy invalid JSON
    except Exception as e:  # datacenter isolation: never blocks gauge/nowcast/composites
        datacenter_error = f"{type(e).__name__}: {e}"
        print(f"DATACENTER FAILED — {datacenter_error}")
```

Pass `datacenter_error=datacenter_error` in the `qa.run_checks(...)` call. Update the
module docstring's "Three independently isolated try/except blocks" sentence to
"Four" and add `(4) the DC cost index (surfaces via datacenter_ok)`.

- [ ] **Step 6: run_daily tests**

In `tests/test_run_daily.py`:
- add `"datacenter.json"` to the artifact list in `test_end_to_end_all_sources`;
- update `assert qa["total"] == 18` → `19` and extend its comment with `+ datacenter_ok`;
- append a new isolation test:

```python
def test_datacenter_failure_does_not_block_other_blocks(tmp_path, monkeypatch):
    set_keys(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("dc boom")

    monkeypatch.setattr(run_daily.dcindex, "run", boom)
    store, out = tmp_path / "store", tmp_path / "out"
    rc = run_daily.main(["--store", str(store), "--out", str(out)],
                        http_get=fake_get, http_post=fake_post)
    assert rc == 0
    assert not (out / "datacenter.json").exists()
    qa_data = json.loads((out / "qa.json").read_text())
    checks = {c["name"]: c for c in qa_data["checks"]}
    assert checks["datacenter_ok"]["pass"] is False and "dc boom" in checks["datacenter_ok"]["detail"]
    assert checks["engine_ok"]["pass"] is True
    assert (out / "heatcheck.json").exists() and (out / "pulse.json").exists()
```

- [ ] **Step 7: Full suite**

Run: `pytest -q`
Expected: all pass — including the end-to-end run now publishing `datacenter.json` from
fixture data (fixture-fed proxies have no quotes, so proxy components run in
`official` mode there; the splice/gate paths are covered by Task 5/6 unit tests).

- [ ] **Step 8: Update CLAUDE.md counts (code half)**

In `CLAUDE.md`: "25 published files" → "26 published files" and add `datacenter` to the
phase list text (e.g. "... and phase 4 composites (`heatcheck`, `stress`, `recession`),
plus the DC cost index (`datacenter`)"); "One connector module per source — 15 total"
→ "16 total" adding `qcew` to the API/CSV list; "three ISOLATED `try/except` blocks" →
"four ISOLATED `try/except` blocks" and mention `datacenter_ok`.

- [ ] **Step 9: Commit**

```bash
git add pipeline/publish/datacenter.py schemas/datacenter.schema.json pipeline/run_daily.py \
        pipeline/publish/qa.py tests/test_datacenter_writer.py tests/test_qa.py \
        tests/test_run_daily.py CLAUDE.md
git commit -m "feat(publish): datacenter.json — fourth isolated block with datacenter_ok QA flag"
```

---

### Task 9: Futures backfill + first real publish (NEEDS USER KEYS)

**Files:**
- Modify: `scripts/backfill_fmp.py` (symbols argument)
- Modify: `tests/test_published_data.py` (CONTRACT entry)
- Data: `store/obs/*.jsonl`, `site/public/data/*.json` (regenerated)

**Interfaces:**
- Consumes: everything above; the user's real `FRED_API_KEY`, `EIA_API_KEY`, `FMP_API_KEY`, `USDA_API_KEY` (and optional `BLS_API_KEY`).
- Produces: committed `site/public/data/datacenter.json` that Task 10's static import needs.

This task hits real networks and commits data. If the keys aren't available in this
session's environment, stop and ask the user to run Steps 2–3 and paste the output.

- [ ] **Step 1: Generalize the backfill script**

In `scripts/backfill_fmp.py`: extend the id map and add a `--symbols` argument.
Replace the hardcoded fetch/id_map lines with:

```python
ID_MAP = {"GCUSD": "fmp_gold", "CLUSD": "fmp_wti",
          "HGUSD": "fmp_copper", "ALIUSD": "fmp_alum"}
```

```python
    parser.add_argument("--symbols", nargs="+", required=True, choices=sorted(ID_MAP))
    parser.add_argument("--from-date", default="2017-01-01")
```

```python
    obs = fmp.fetch_history(args.symbols, key, from_date=args.from_date)
    from dataclasses import replace
    obs = [replace(o, series_code=ID_MAP[o.series_code]) for o in obs]
```

Update the module docstring's example command to include `--symbols`. Run `pytest -q`
(the script has no test coverage; the suite must stay green).

- [ ] **Step 2: Run the backfill**

```bash
FMP_API_KEY=<real> python scripts/backfill_fmp.py --store store --symbols HGUSD ALIUSD
```

Expected: `fetched ~4800, wrote ~4800 new rows` (two symbols × ~2,400 trading days).

- [ ] **Step 3: Run the full pipeline locally**

```bash
git fetch origin && git rebase origin/main   # expect daily bot commits; store conflicts resolve by UNION
FRED_API_KEY=<real> EIA_API_KEY=<real> FMP_API_KEY=<real> USDA_API_KEY=<real> \
  python -m pipeline.run_daily --store store --out site/public/data
```

Expected output includes `published: site/public/data/datacenter.json` and
`qa: site/public/data/qa.json`. Then sanity-check:

```bash
python3 -c "
import json; d = json.load(open('site/public/data/datacenter.json'))
b, o, p = d['indexes']['build'], d['indexes']['ops'], d['parity']
print('build yoy', b['headline_yoy_pct'], 'ops yoy', o['headline_yoy_pct'])
print('parity mode', p['mode'], 'states', len(p['states']))
assert len(p['states']) >= 45 and p['mode'] in ('full', 'ops_only')
assert isinstance(b['headline_yoy_pct'], float) and isinstance(o['headline_yoy_pct'], float)
print('OK')"
```

If `datacenter_ok` is false in `qa.json`, STOP: read the detail, fix the root cause
(most likely a series ID the spike missed), re-run. Do not commit a failing artifact.

- [ ] **Step 4: Add the published-data contract entry**

In `tests/test_published_data.py`, append to `CONTRACT`:

```python
            ("datacenter.json", "datacenter.schema.json"),
```

Run: `pytest tests/test_published_data.py -q` — expected: all pass (validates the
freshly committed file).

- [ ] **Step 5: Full suite, then commit the data**

Run: `pytest -q` — expected: all pass.

```bash
git add store site/public/data scripts/backfill_fmp.py tests/test_published_data.py
git commit -m "data(dc-index): copper/aluminum futures backfill + first datacenter publish"
```

---

### Task 10: Site page, nav, e2e

**Files:**
- Create: `site/src/app/datacenter/page.tsx`
- Create: `site/src/components/DcIndexChart.tsx`
- Create: `site/src/components/ParityTable.tsx`
- Modify: `site/src/components/PageShell.tsx` (nav link)
- Modify: `site/e2e/smoke.spec.ts` (route entry)
- Modify: `CLAUDE.md` ("16 pages" → "17 pages")

**Interfaces:**
- Consumes: committed `site/public/data/datacenter.json` (Task 9); existing `KpiCard`, `EChart`, `chartTheme` (`C`, `baseOption`), global CSS classes `kpi-row`, `table-card`, `data-table`, `method`, `subtitle`.
- Produces: route `/datacenter`; e2e marker text "Data Center Cost Index".

- [ ] **Step 1: Chart component**

```tsx
// site/src/components/DcIndexChart.tsx
"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

function pair(dates: string[], vals: number[]): [string, number][] {
  return dates.map((d, i) => [d, vals[i]] as [string, number]);
}

export function DcIndexChart({
  buildDates, buildIndex, opsDates, opsIndex,
}: {
  buildDates: string[]; buildIndex: number[];
  opsDates: string[]; opsIndex: number[];
}) {
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        { name: "DC Build", type: "line", showSymbol: false,
          data: pair(buildDates, buildIndex),
          lineStyle: { width: 2, color: C.sky }, itemStyle: { color: C.sky } },
        { name: "DC Ops", type: "line", showSymbol: false,
          data: pair(opsDates, opsIndex),
          lineStyle: { width: 2, color: C.violet }, itemStyle: { color: C.violet } },
      ],
    }),
    [buildDates, buildIndex, opsDates, opsIndex],
  );
  return <EChart option={option} height={340} />;
}
```

- [ ] **Step 2: Sortable parity table component**

```tsx
// site/src/components/ParityTable.tsx
"use client";
import { useState } from "react";

export type ParityRow = {
  state: string; power_rel: number; ops_mult: number; power_asof: string;
  wage_rel: number | null; build_mult: number | null; wage_asof: string | null;
};

type Key = "state" | "build_mult" | "ops_mult";

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

export function ParityTable({ states, mode }: { states: ParityRow[]; mode: string }) {
  const [key, setKey] = useState<Key>("ops_mult");
  const [asc, setAsc] = useState(false);
  const rows = [...states].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return asc ? cmp : -cmp;
  });
  const th = (label: string, k: Key) => (
    <th style={{ cursor: "pointer" }}
        onClick={() => (k === key ? setAsc(!asc) : (setKey(k), setAsc(false)))}>
      {label}{key === k ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );
  return (
    <div className="table-card">
      <table className="data-table">
        <thead><tr>
          {th("State", "state")}{th("Build ×", "build_mult")}{th("Ops ×", "ops_mult")}
          <th>Wage rel</th><th>Power rel</th><th>Wage as-of</th><th>Power as-of</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.state}>
            <td>{r.state}</td><td>{fmt(r.build_mult)}</td><td>{fmt(r.ops_mult)}</td>
            <td>{fmt(r.wage_rel)}</td><td>{fmt(r.power_rel)}</td>
            <td>{r.wage_asof ?? "—"}</td><td>{r.power_asof}</td>
          </tr>
        ))}</tbody>
      </table>
      {mode === "ops_only" ? (
        <p className="method">Build parity unavailable this run (QCEW wages missing) — showing power-driven ops parity only.</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: The page**

```tsx
// site/src/app/datacenter/page.tsx
import dc from "../../../public/data/datacenter.json";
import { KpiCard } from "@/components/KpiCard";
import { DcIndexChart } from "@/components/DcIndexChart";
import { ParityTable, type ParityRow } from "@/components/ParityTable";

type Comp = {
  code: string; label: string; group: string; weight: number; mode: string;
  last_obs: string; yoy_pct: number | null; contribution_pp: number | null;
};

const GROUPS = dc.group_labels as Record<string, string>;

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function ComponentTable({ title, comps }: { title: string; comps: Comp[] }) {
  const max = Math.max(...comps.map((c) => Math.abs(c.contribution_pp ?? 0)), 0.01);
  return (
    <div className="table-card">
      <h2>{title}</h2>
      <table className="data-table">
        <thead><tr><th>Component</th><th>Group</th><th>Weight</th><th>YoY</th><th>Contribution</th><th>Data</th><th>Last obs</th></tr></thead>
        <tbody>{comps.map((c) => (
          <tr key={c.code}>
            <td>{c.label}</td>
            <td>{GROUPS[c.group] ?? c.group}</td>
            <td>{(c.weight * 100).toFixed(0)}%</td>
            <td>{fmtPct(c.yoy_pct)}</td>
            <td>
              <span style={{ display: "inline-block", verticalAlign: "middle",
                             height: 8, borderRadius: 2,
                             width: `${(Math.abs(c.contribution_pp ?? 0) / max) * 90}px`,
                             background: (c.contribution_pp ?? 0) >= 0 ? "var(--accent-red)" : "var(--accent-emerald)" }} />
              <span style={{ marginLeft: 6 }}>{c.contribution_pp == null ? "—" : `${c.contribution_pp.toFixed(2)}pp`}</span>
            </td>
            <td>{c.mode === "official+proxy" ? "monthly + futures tail" : "monthly official"}</td>
            <td>{c.last_obs}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Datacenter() {
  const build = dc.indexes.build;
  const ops = dc.indexes.ops;
  return (
    <div>
      <h1>Data Center Cost Index <span className="subtitle">facility build & operating input costs — no official DC PPI exists</span></h1>
      <div className="kpi-row">
        <KpiCard label="DC Build YoY" value={fmtPct(build.headline_yoy_pct)}
                 context={`construction input costs · as of ${build.as_of}`} accent="sky" />
        <KpiCard label="DC Ops YoY" value={fmtPct(ops.headline_yoy_pct)}
                 context={`operating input costs · as of ${ops.as_of}`} accent="violet" />
      </div>
      <DcIndexChart buildDates={build.dates} buildIndex={build.index}
                    opsDates={ops.dates} opsIndex={ops.index} />
      <ComponentTable title="DC Build components" comps={build.components as Comp[]} />
      <ComponentTable title="DC Ops components" comps={ops.components as Comp[]} />
      <h2>State cost parity <span className="subtitle">multipliers vs national average</span></h2>
      <ParityTable states={dc.parity.states as ParityRow[]} mode={dc.parity.mode} />
      <p className="method">
        Input-price indexes (2018-01 = 100), not turnkey build quotes: each component is an
        official PPI/CES/EIA series weighted by published industry cost breakdowns (facility
        only — no servers/GPUs; IT hardware indexes are hedonically adjusted and would mislead
        in the GPU era). Copper and aluminum components carry a live futures tail spliced onto
        the PPI at the last print and re-anchored every print, so futures never overwrite
        official history. Parity multipliers pin nationally-priced inputs at 1.0:
        build = {dc.parity.w_labor} × state construction wage relative (QCEW NAICS-23) + {(1 - dc.parity.w_labor).toFixed(2)};
        ops = {dc.parity.w_power} × state industrial power relative (EIA) + {(1 - dc.parity.w_power).toFixed(2)}.
        Weight citations in the methodology page pattern; sources refresh monthly (power, PPI, CES) and quarterly (QCEW, ~2-quarter lag).
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Nav + e2e**

In `site/src/components/PageShell.tsx`, after the `Recession` link:

```tsx
            <Link href="/datacenter" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Data Centers
            </Link>
```

In `site/e2e/smoke.spec.ts` ROUTES, after the `/recession` entry:

```ts
  ["/datacenter", "Data Center Cost Index"],
```

In `CLAUDE.md`: "Playwright smoke — 16 pages render" → "17 pages render".

- [ ] **Step 5: Build + test the site**

```bash
cd site && npm run build && npm test && npm run e2e
```

Expected: static export succeeds with the new `/datacenter` route listed; vitest passes
(no new client math); Playwright reports all tests passing (was 16, now 17).

- [ ] **Step 6: Commit**

```bash
git add site/src/app/datacenter site/src/components/DcIndexChart.tsx \
        site/src/components/ParityTable.tsx site/src/components/PageShell.tsx \
        site/e2e/smoke.spec.ts CLAUDE.md
git commit -m "feat(site): /datacenter — build/ops cost indexes + state parity table"
```

---

## Completion

After Task 10: run `pytest -q` and `cd site && npm run build && npm test && npm run e2e`
one final time. Then STOP and present the branch to the user for review — pushing to
`main` deploys to production and requires explicit approval. Remember to
`git fetch && git rebase origin/main` first (daily bot commits land every morning;
store JSONL conflicts resolve by union — keep both sides' rows).
