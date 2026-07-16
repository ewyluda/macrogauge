# Power Tail Implementation Plan (Wave 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smoothed wholesale nowcast tail on DC Ops' power component (CAISO SP15 + MISO Indiana Hub, 7-day trailing mean, anchored splice) + "The power bill" panel, per `docs/superpowers/specs/2026-07-15-power-tail-design.md`.

**Architecture:** Three keyless connectors (CAISO zip/CSV, MISO CSV, ICE XLSX) + Henry Hub under a new `EIA_SPOT` isolation key. `DCComponent` gains `live_proxy_blend`/`live_proxy_smooth_days`; two pure blend helpers feed the existing splice/gate/label machinery unchanged. One-time backfill from 2026-01-01 gives immediate splice overlap.

**Tech Stack:** Python 3.12 pipeline (stdlib zipfile + existing openpyxl), pytest, Next.js site.

## Global Constraints

- **No invented identifiers**: node ids, hub labels, CSV/zip column names below are candidates; Task 1's spike pins FINALS + records fixtures; controller injects finals into later dispatches (`# SPIKE-FINAL` markers).
- **No network in tests**: CAISO zip fixtures BUILT in-test (stdlib zipfile); ICE xlsx generated in-test (census pattern); MISO fixture = spike-trimmed real CSV.
- Negative daily LMP means are REAL (curtailment): plausible ranges (−100, 3000) $/MWh; tests include a negative-mean acceptance case.
- Derived values never stored: hub-mean + smoothing are pure engine transforms; raw hub prices stay auditable.
- Gate/splice/label machinery untouched downstream of the proxy construction; official prints never gated.
- MISO 404-today = skip (market calendar), any other HTTP error propagates to isolation.
- Pins that move: sources 22→26, series 265→269 (ice_ercot_north DROPPED post-spike: the hub does not exist in the ICE file — no substitute); FRED 73 untouched.
- Commit per task; `.venv/bin/pytest`. Do NOT push (user approves).

---

### Task 1: Verification spike

**Files:** Create `docs/superpowers/specs/2026-07-15-power-spike-notes.md`, `tests/fixtures/miso_da_expost.csv` (trimmed real), plus record exact CAISO CSV column names + ICE header/hub labels in the notes (their fixtures are generated in-test from the notes' shapes).

- [ ] **Step 1: CAISO.** Fetch the SingleZip URL (spec §3.1) for yesterday and today (trade dates). Record: exact CSV column names inside the zip (candidates `INTERVALSTARTTIME_GMT`, `LMP_TYPE`, `MW`), the LMP_TYPE filter value, hourly-row count, today's daily mean, whether a same-day 8:40-ET-time fetch works (DAM published prior afternoon), max request window + throttle behavior (two quick successive requests), and history depth (probe 2026-01-02). Paste a 5-row CSV excerpt into the notes (fixture is built in-test from this shape).
- [ ] **Step 2: MISO.** Fetch yesterday's `da_expost_lmp.csv`. Record: header structure (how many preamble lines), the exact Indiana Hub row label (candidate `INDIANA.HUB`), the row-type column that distinguishes LMP from MCC/MLC rows, HE column count and how DST dates render (fetch 2026-03-08's file), and a holiday/weekend 404 example. Trim the real CSV to both header lines + the Indiana Hub rows + 2 neighbor nodes → `tests/fixtures/miso_da_expost.csv`. Record the fixture's expected daily mean.
- [ ] **Step 3: ICE.** Re-fetch `ice_electric-2026.xlsx`; record exact header names (hub, trade date, wtd-avg columns), the EXACT hub labels for PJM Western Hub and ERCOT North (candidates `PJM WH Real Time Peak`, ERCOT North variant), date-cell type (datetime vs string), and current values. (Fixture generated in-test from these shapes.)
- [ ] **Step 4: Henry Hub.** Confirm `pipeline.connectors.eia.fetch(["RNGWHHD"], key)` works via the seriesid alias (read-only; project key from .env); record latest obs + how daily periods render.
- [ ] **Step 5: Notes + commit** (`docs+fixtures: power spike — final strings and recorded shapes`). Anything unfetchable → recorded, series dropped with a note.

---

### Task 2: CAISO connector

**Files:** Create `pipeline/connectors/caiso.py`; Test `tests/test_caiso.py`.

**Interfaces:** `caiso.fetch(source_ids, vintage_date=None, http_get=None, trade_date=None) -> list[Observation]`; `source_id` = the OASIS node (`TH_SP15_GEN-APND`); one observation per node per run, `obs_date = trade_date or today_et()`, `source="CAISO"`, `route="API"`. Exports `PLAUSIBLE = (-100.0, 3000.0)`, `ROW_RANGE = (20, 28)`.

- [ ] **Step 1: Failing tests** (fixture zip built in-test; column names/filter value are `# SPIKE-FINAL`):

```python
import csv
import io
import zipfile

import pytest

from pipeline.connectors import caiso


def _zip_bytes(rows, columns=("INTERVALSTARTTIME_GMT", "LMP_TYPE", "MW")):  # SPIKE-FINAL cols
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columns)
    w.writerows(rows)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("prc_lmp.csv", buf.getvalue())
    return zbuf.getvalue()


def _hours(values, lmp_type="LMP"):
    return [(f"2026-07-14T{h:02d}:00:00-00:00", lmp_type, v)
            for h, v in enumerate(values)]


class _R:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


def _get(content):
    return lambda url, timeout=None: _R(content)


def test_happy_path_daily_mean():
    rows = _hours([40.0] * 12 + [50.0] * 12) + _hours([999.0] * 24, "MCC")
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                      trade_date="2026-07-14", http_get=_get(_zip_bytes(rows)))
    assert len(obs) == 1
    assert obs[0].value == pytest.approx(45.0)     # MCC rows excluded
    assert obs[0].obs_date == "2026-07-14"
    assert (obs[0].source, obs[0].route) == ("CAISO", "API")


def test_negative_daily_mean_accepted():
    obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                      trade_date="2026-07-14",
                      http_get=_get(_zip_bytes(_hours([-5.0] * 24))))
    assert obs[0].value == pytest.approx(-5.0)


def test_dst_row_counts_accepted():
    for n in (23, 25):
        obs = caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                          trade_date="2026-03-08",
                          http_get=_get(_zip_bytes(_hours([30.0] * n))))
        assert obs[0].value == pytest.approx(30.0)


def test_bad_row_count_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14",
                    http_get=_get(_zip_bytes(_hours([30.0] * 5))))


def test_missing_column_is_structure_drift():
    bad = _zip_bytes(_hours([30.0] * 24), columns=("TIME", "KIND", "PRICE"))
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14", http_get=_get(bad))


def test_empty_zip_is_structure_drift():
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w"):
        pass
    with pytest.raises(ValueError, match="structure drift"):
        caiso.fetch(["TH_SP15_GEN-APND"], vintage_date="2026-07-15",
                    trade_date="2026-07-14", http_get=_get(zbuf.getvalue()))
```

- [ ] **Step 2: verify FAIL.** **Step 3: implement:**

```python
"""CAISO OASIS day-ahead LMP — SP15 trading hub, daily average.

Keyless public market data (FERC transparency). One SingleZip request per
run: a zip-of-CSV of hourly DAM LMPs for one trade date, averaged into a
single $/MWh observation. Negative daily means are real (curtailment); DST
days have 23/25 hourly rows. OASIS throttles aggressive clients — the daily
run makes exactly one request; the backfill script sleeps between windows.
"""
import csv
import io
import zipfile

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_bytes
from pipeline.models import Observation

URL = ("https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP"
       "&startdatetime={d}T07:00-0000&enddatetime={e}T07:00-0000"
       "&version=1&market_run_id=DAM&node={node}&resultformat=6")
LMP_TYPE_COL, LMP_TYPE_VAL, PRICE_COL = "LMP_TYPE", "LMP", "MW"  # SPIKE-FINAL
PLAUSIBLE = (-100.0, 3000.0)   # $/MWh daily mean; negatives are real
ROW_RANGE = (20, 28)           # hourly rows incl. DST 23/25


def _next_day(d: str) -> str:
    from datetime import date, timedelta
    return (date.fromisoformat(d) + timedelta(days=1)).isoformat()


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, trade_date: str | None = None) -> list[Observation]:
    """source_id = OASIS node id. trade_date defaults to today (DAM for
    today publishes the prior afternoon)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    day = trade_date or vintage
    out = []
    for node in source_ids:
        raw = get_bytes(URL.format(d=day.replace("-", ""),
                                   e=_next_day(day).replace("-", ""),
                                   node=node), http_get)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".csv")]
            if not names:
                raise ValueError(f"caiso {node}: zip has no CSV (structure drift?)")
            text = z.read(names[0]).decode("utf-8", "replace")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames or LMP_TYPE_COL not in reader.fieldnames \
                or PRICE_COL not in reader.fieldnames:
            raise ValueError(f"caiso {node}: columns {reader.fieldnames} lack "
                             f"{LMP_TYPE_COL}/{PRICE_COL} (structure drift?)")
        prices = [float(r[PRICE_COL]) for r in reader
                  if r.get(LMP_TYPE_COL) == LMP_TYPE_VAL]
        if not ROW_RANGE[0] <= len(prices) <= ROW_RANGE[1]:
            raise ValueError(f"caiso {node}: {len(prices)} hourly rows outside "
                             f"{ROW_RANGE} (structure drift?)")
        value = round(sum(prices) / len(prices), 4)
        if not PLAUSIBLE[0] <= value <= PLAUSIBLE[1]:
            raise ValueError(f"caiso {node}: mean {value} outside {PLAUSIBLE} "
                             "— structure drift?")
        out.append(Observation(series_code=node, obs_date=day, value=value,
                               vintage_date=vintage, source="CAISO", route="API"))
    return out
```

(SPIKE-FINAL: the URL takes `<D>T07:00-0000`..`<D+1>T07:00-0000`, but that boundary is only clean in PDT months — the connector MUST also filter rows by the CSV's `OPR_DT` column == trade date, so PST-month fetches and the Jan–Mar backfill stay correct. The spike notes carry the full 16-column header list; add the OPR_DT filter alongside the LMP_TYPE filter, and add a test where the zip carries a stray next-day OPR_DT row that must be excluded.)

- [ ] **Step 4: verify PASS (6 tests).** **Step 5: full suite.** **Step 6: commit** `feat(connectors): CAISO SP15 daily DAM LMP (keyless zip, DST-aware)`.

---

### Task 3: MISO connector

**Files:** Create `pipeline/connectors/miso.py`; Test `tests/test_miso.py`.

**Interfaces:** `miso.fetch(source_ids, vintage_date=None, http_get=None, market_date=None)`; `source_id` = the hub row label; `obs_date = market_date or yesterday-ET`; 404 → `[]` (market calendar skip); `source="MISO"`, `route="CSV"`.

- [ ] **Step 1: Failing tests** — happy path against `tests/fixtures/miso_da_expost.csv` asserting the spike's expected mean; LMP-vs-MCC row filtering; missing hub row → drift; 404 → `[]` (response fake with `status_code=404`); malformed HE cells → drift; negative mean accepted (synthetic). The response fake:

```python
class _R:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")
```

- [ ] **Step 2–3: implement** (SPIKE-FINAL: preamble is 5 lines; hub label `INDIANA.HUB` exact; the LMP/MCC/MLC discriminator is the THIRD column, header `Value`; fixture expected INDIANA.HUB LMP daily mean = 140.89 $/MWh):

```python
"""MISO day-ahead ex-post LMP — Indiana Hub, daily average.

Keyless public market report (one CSV per market day, posted next day).
Wide format: preamble lines, then node rows x HE1-HE24 (separate LMP/MCC/MLC
rows per node — only the LMP row is used). A 404 for the requested date is a
market-calendar skip (weekend/holiday), never an error; retention is ~3.5
years, so missed days beyond the window are unrecoverable here (carry-forward
makes single misses harmless)."""
```

`fetch`: build URL from `market_date or (today_et minus 1 day)`; `resp = http_get(url, timeout=60)`; `if getattr(resp, "status_code", 200) == 404: return []`; `resp.raise_for_status()`; find the row where the node cell == source_id AND the type cell is the LMP row (spike-pinned); parse all numeric HE cells, count in [20, 28] else drift; mean → range check (−100, 3000) → one Observation.

- [ ] **Step 4–6:** verify, full suite, commit `feat(connectors): MISO Indiana Hub daily DA LMP (keyless CSV, calendar-aware)`.

---

### Task 4: ICE connector

**Files:** Create `pipeline/connectors/ice.py`; Test `tests/test_ice.py`.

**Interfaces:** `ice.fetch(source_ids, vintage_date=None, http_get=None, year=None)`; `source_id` = the hub label; emits ALL trade dates in the current-year workbook per hub (value-dedupe makes refetch free); `source="ICE"`, `route="XLSX"`.

- [ ] Steps: census-pattern tests (fixture xlsx generated in-test via openpyxl: header row w/ spike-final column names, 3 hub rows incl. one negative wtd-avg, a neighbor hub as negative control, footer note row) — happy path multi-date emission, missing hub → drift, missing header → drift, out-of-range → drift, blank cells skipped; implement on the census.py template (header located by name, hub column filter by label, date cells normalized to ISO, `PLAUSIBLE = (-100.0, 3000.0)`, URL `https://www.eia.gov/electricity/wholesale/xls/ice_electric-{year}.xlsx` with `year = (vintage or today)[:4]`); full suite; commit `feat(connectors): ICE wholesale hub prices via EIA workbook (panel-only)`.

---

### Task 5: Registry + collect + fakes + pins

**Files:** Modify `config/series.json`, `pipeline/collect.py`, `tests/test_registry.py`, `tests/test_run_daily.py`.

- [ ] Pins first (FAIL): sources set += {"CAISO","MISO","ICE","EIA_SPOT"}; `len(series)` 265→269; status-row count 22→26.
- [ ] `config/series.json` sources:

```json
"CAISO": {"route": "API", "cadence": "daily"},
"MISO": {"route": "CSV", "cadence": "daily"},
"ICE": {"route": "XLSX", "cadence": "biweekly"},
"EIA_SPOT": {"route": "API", "cadence": "daily", "secret": "EIA_API_KEY"}
```

Series (labels `# SPIKE-FINAL`):

```json
{"code": "caiso_sp15_da", "source": "CAISO", "source_id": "TH_SP15_GEN-APND", "name": "CAISO SP15 day-ahead LMP, daily avg ($/MWh)", "max_staleness_days": 7},
{"code": "miso_indiana_da", "source": "MISO", "source_id": "INDIANA.HUB", "name": "MISO Indiana Hub DA ex-post LMP, daily avg ($/MWh)", "max_staleness_days": 7},
{"code": "ice_pjm_west", "source": "ICE", "source_id": "PJM WH Real Time Peak", "name": "PJM Western Hub wtd avg ($/MWh, ICE via EIA)", "max_staleness_days": 21},
{"code": "eia_henry_hub", "source": "EIA_SPOT", "source_id": "NG.RNGWHHD.D", "name": "Henry Hub natural gas spot ($/MMBtu)", "max_staleness_days": 7}
```

- [ ] `collect.py`: imports (`caiso`, `ice`, `miso` alphabetical); wrappers `_caiso/_miso/_ice` (pass `[s.source_id ...]`, `http_get=http`); FETCHERS += the three + `"EIA_SPOT": _eia` (isolation comment, STEO precedent).
- [ ] `fake_get` branches: `oasis.caiso.com` → `_BytesResponse(_caiso_zip())` (in-test zip builder, 24 rows); `docs.misoenergy.org` → miso fixture text via a status-aware `_text` (200); `eia.gov/electricity/wholesale` → `_BytesResponse(_ice_xlsx())` (in-test builder) — placed BEFORE any generic eia branch check ordering issue (the existing branch matches `api.eia.gov`, no conflict, but order defensively); RNGWHHD rides the existing `api.eia.gov` branch (monthly fixture — fine).
- [ ] Full suite green; commit `feat(registry): CAISO/MISO/ICE/EIA_SPOT sources + 5 power series`.

---

### Task 6: Engine — blend fields + pure helpers + dcindex path

**Files:** Modify `pipeline/dc_basket.py`, `pipeline/engine/blend.py`, `pipeline/engine/dcindex.py`, `config/dc_basket.json`; Tests `tests/test_dc_basket.py`, `tests/test_blend.py` (or the blend tests' home — follow the existing file), `tests/test_dcindex.py`.

**Interfaces:** `DCComponent` += `live_proxy_blend: tuple[str, ...] | None = None`, `live_proxy_smooth_days: int | None = None`; `blend.hub_mean(series_list) -> dict`; `blend.trailing_mean(series, days) -> dict`.

- [ ] **Failing tests:**
  - loader: mutual exclusion (`live_proxy` + `live_proxy_blend` → ValueError), `smooth_days` without blend → ValueError, empty blend list → ValueError, unknown blend code → ValueError, real config: ops power component has `live_proxy_blend == ("caiso_sp15_da", "miso_indiana_da")` and `live_proxy_smooth_days == 7`.
  - blend: `hub_mean` two-present mean / one-missing carries / disjoint dates union; `trailing_mean` worked example ({d1:10, d2:20, d3:30}, days=2 → {d1:10, d2:15, d3:25}), gap-shrink (missing middle day), days=1 identity.
  - dcindex: blend-component worked example — two hub series + monthly official; blend obs before the last print anchor the splice; smoothed tail extends; mode `official+proxy`; gate arrived-today via ANY blend series; dormant-blend variant (all hub obs after the print) → mode `official`.
- [ ] **Implement.** dc_basket: fields + construction (`tuple(c["live_proxy_blend"])` when present) + validations added to the §wave-1 check block; registry check covers blend codes. blend.py (add `from datetime import date, timedelta`):

```python
def hub_mean(series_list: list[dict[str, float]]) -> dict[str, float]:
    """Per-date equal-weight mean over the series that HAVE that date — one
    hub missing a day must not drop the day (same-concept sources; mirrors
    blend()'s renormalize-on-missing semantics)."""
    dates = set().union(*(set(s) for s in series_list)) if series_list else set()
    return {d: sum(s[d] for s in series_list if d in s)
               / sum(1 for s in series_list if d in s)
            for d in sorted(dates)}


def trailing_mean(series: dict[str, float], days: int) -> dict[str, float]:
    """Calendar-window trailing mean at each obs date: mean of the values at
    obs dates within [d-days+1, d] that exist. Gaps shrink the sample —
    never fabricate. days<=1 is the identity."""
    if days <= 1:
        return dict(series)
    dates = sorted(series)
    out = {}
    for d in dates:
        lo = (date.fromisoformat(d) - timedelta(days=days - 1)).isoformat()
        window = [series[x] for x in dates if lo <= x <= d]
        out[d] = sum(window) / len(window)
    return out
```

dcindex component loop — replace the `live = ...` line and the gate's arrived check:

```python
            if comp.live_proxy_blend:
                live = blend_mod.trailing_mean(
                    blend_mod.hub_mean(
                        [_series(conn, c) for c in comp.live_proxy_blend]),
                    comp.live_proxy_smooth_days or 1)
            else:
                live = _series(conn, comp.live_proxy) if comp.live_proxy else {}
```

```python
                if tail_active:
                    proxies = comp.live_proxy_blend or (comp.live_proxy,)
                    idx, flagged = gate.apply_gate(
                        idx, any(_arrived_today(conn, c, last, today)
                                 for c in proxies))
```

`config/dc_basket.json` ops power component:

```json
{"code": "power", "label": "Industrial electricity", "group": "power", "series": "eia_elec_ind_us", "weight": 0.55, "live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"], "live_proxy_smooth_days": 7}
```

- [ ] Full suite green (test_run_daily e2e: hub fixtures' obs are vintage-dated today → blend proxy DORMANT end-to-end, ops unchanged there — the live activation happens in Task 8 with the backfill). Commit `feat(dc): blended smoothed wholesale proxy machinery + ops power tail config`.

---

### Task 7: dc_power config + power block + publisher + schema

**Files:** Create `config/dc_power.json`, `pipeline/dc_power.py`; Modify `pipeline/engine/dcindex.py` (small `power_block` helper), `pipeline/publish/datacenter.py` (5th param), `schemas/datacenter.schema.json`, `pipeline/run_daily.py`; Tests `tests/test_dc_power.py`, `tests/test_datacenter_writer.py`.

- [ ] `config/dc_power.json` (capacity rows are the research-verified PJM BRA results; hand-updated after each auction):

```json
{"hubs": [
   {"code": "caiso_sp15_da", "label": "CAISO SP15 (day-ahead)"},
   {"code": "miso_indiana_da", "label": "MISO Indiana Hub (day-ahead)"},
   {"code": "ice_pjm_west", "label": "PJM Western Hub (ICE wtd avg)"}],
 "henry_hub": {"code": "eia_henry_hub", "label": "Henry Hub natural gas"},
 "capacity_auction": {
   "source": "PJM RPM Base Residual Auction results (pjm.com); hand-updated after each auction",
   "asof": "2025-12-17",
   "rows": [
     {"delivery_year": "2024/25", "price_mw_day": 28.92},
     {"delivery_year": "2025/26", "price_mw_day": 269.92},
     {"delivery_year": "2026/27", "price_mw_day": 329.17},
     {"delivery_year": "2027/28", "price_mw_day": 333.44}]}}
```

- [ ] `pipeline/dc_power.py`: loader validating hub/henry codes against the registry, capacity rows non-empty with numeric prices (BEA-shares precedent). `dcindex.power_block(conn, dc_result, cfg) -> dict | None`: per hub + henry, latest obs `(value, date)` from the store (a hub with no rows yet → row omitted); `tail.active` = ops power component mode == "official+proxy" (passed through from dc_result); returns `None` only when NO hub has data (bootstrap). Writer: `build(..., power)` 5th param, rounds 2dp, schema `power` nullable-object pinned in `required` (same pattern as `construction`). `run_daily` phase passes `dcindex.power_block(conn, dc_result, dc_power.load())`.
- [ ] Known transient (wave-2 precedent, disclosed): after the schema pin, `test_published_data` reds on the stale committed datacenter.json until Task 8's regeneration. Everything else green. Commit `feat(dc): publish power block — hubs, henry hub, capacity auction (schema-pinned)`.

---

### Task 8: Backfill + live run (CONTROLLER-EXECUTED)

- [ ] `scripts/backfill_power.py` (follow `scripts/backfill_fmp.py`'s shape): CAISO per-day `fetch(..., trade_date=d)` from 2026-01-01 with ≥5 s sleep; MISO weekday files from 2026-01-01 with ≥1 s sleep (404 skips); append via `vintage.append` (reruns no-op). Run it (~20 min, polite).
- [ ] Live `run_daily`; verify: ops power mode `official+proxy` + "as_of" ≈ today; ops headline YoY sane (compare against the pre-tail value — the tail shifts as_of, YoY change should be modest); gate flags empty or explainable; all 26 sources ok; hub values plausible vs spike numbers; `power` block populated; pytest fully green (transient resolved).
- [ ] Commit store + data + script: `data: power backfill + first spliced wholesale tail on DC Ops`.

---

### Task 9: Site — power panel + label fix + methodology

**Files:** Create `site/src/components/PowerPanel.tsx` (server component); Modify `site/src/app/datacenter/page.tsx`.

- [ ] `PowerPanel`: hub cards grid (label, `$X.XX/MWh`, as-of date — ICE cards visibly older by their dates), Henry Hub card (`$/MMBtu`), capacity-auction mini-table with source+asof note. Render inside `{dc.power && (…)}` after the construction section, heading `The power bill <span className="subtitle">wholesale hubs · capacity · fuel</span>`.
- [ ] `page.tsx` ternary: `"monthly + futures tail"` → `"monthly + live tail"`.
- [ ] Methodology append: smoothed wholesale nowcast (7-day trailing mean of SP15 + Indiana Hub, anchored to the retail print, re-anchored every print; wholesale is an input-price nowcast for a retail series — influence confined to the tail, the copper argument verbatim); ICE hubs panel-only; negative-LMP note.
- [ ] Gates: `npx tsc --noEmit && npm run build && npm test && npm run e2e` all green. Commit `feat(site): power bill panel + live-tail label on /datacenter`.

---

### Task 10: Gates + docs + final review (CONTROLLER-EXECUTED)

- [ ] Full gates clean-state; CLAUDE.md: connectors 20→23 (caiso/miso under API/CSV, ice under XLSX group wording), test count; visual verification (screenshot: power panel, ops row showing "monthly + live tail", as_of near-today KPI); final whole-branch review (most capable model) with ledger minors; STOP for push approval.

---

## Self-review notes

- **Spec coverage:** §3.1–3.4 → Tasks 2–5; §4 engine → Task 6; §5 publish → Task 7; §6 site → Task 9; §8 backfill → Task 8; correction re YoY base already in spec.
- **Type consistency:** `fetch` signatures uniform (+ per-connector date param); `DCComponent` tuple field matches loader construction and dcindex usage; `power_block`'s shape matches writer + schema + PowerPanel.
- **Known seams:** CAISO URL date format and MISO row-type column are the highest-risk pins — both spike-owned with fixture-shaped tests; the e2e keeps the blend proxy dormant (fixture vintages) so Task 6 can land before the backfill exists, mirroring wave 3a's dormant pattern.
- **Pin arithmetic:** sources 22+4=26; series 265+4=269 (ERCOT North dropped by spike).
