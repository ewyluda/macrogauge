# Benchmark Provenance & Phase-3/4 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining below-the-line findings from the phase-3/4 review: honest benchmark provenance (reference-month keyed, real as-of), correct street/kalshi/NFP targeting, removal of dead published parameters, one source of truth for month helpers and validated writers, and two artifact/perf cleanups.

**Architecture:** All three CPI benchmarks (cleveland, street, kalshi) converge on one store convention — `obs_date` = reference-month first, `vintage_date` = retrieval date — so `latest_benchmarks` can filter by the nowcast's reference month and carry each benchmark's real as-of into `nextprint.json`. Month arithmetic consolidates into a new `pipeline/dates.py`. Dead `CPI_PARAMS` stop being published. `stress.json` stops embedding full histories. The backtest walks vintages in one pass.

**Tech Stack:** Python 3.12 (stdlib only in pipeline), pytest, JSON Schema (draft 2020-12), Next.js static export + TypeScript on the site.

## Global Constraints

- **Store rows are immutable, append-only, never rewritten.** Old-convention benchmark rows (kalshi `obs_date`=scrape-day, street `obs_date`=release-date) stay in the store forever; readers simply stop matching them. Never rewrite a committed partition.
- **HTTP is injected, never real, in tests.** Connectors take `http_get`/`http_post`; tests pass fakes returning fixture data. Never add a test that hits the network.
- **Every published file validates against its schema inline as it lands** (`phase3._write` / `composites._write`); `jsonschema.ValidationError` must fail the run.
- **Stable artifact shapes:** degraded payloads carry every key, nulled — a differently-shaped valid artifact breaks the site's typed JSON imports (see 2026-07-11 structural-risks plan, Risk 2). Any payload-shape change updates the schema AND `site/src/lib/types.ts` in the same task.
- **TDD every task**: failing test first, watch it fail, minimal code, full `pytest -q` green before each commit. Baseline: 258 pytest, 16 vitest, 16 e2e.
- **Commit per task.** Do NOT push without the user's explicit approval (push = production deploy). `git fetch`/rebase over `data: daily publish` bot commits before any approved push.
- `test_run_daily.py` runs with the REAL wall-clock date (`fred.today_et()`); never assert benchmark VALUES end-to-end there — assert shape/keys, since fixture reference months drift out of the calendar window over time.

## Design decisions locked here (do not re-litigate in-session)

1. **Benchmark store convention:** `obs_date` = first day of the reference month the forecast covers; `vintage_date` = retrieval day. Cleveland already complies.
2. **`latest_benchmarks(conn, reference_month)`** returns `{name: {"value": float, "as_of": vintage} | None}`, matching only rows whose `obs_date == f"{reference_month}-01"` — a stale or other-month benchmark is excluded from the ensemble rather than silently blended.
3. **`nowcast_latest.json` `benchmarks` shape changes** to `{name: {value, as_of} | null}` (schema + `types.ts` updated in the same task). No site page reads `nowcast.benchmarks` directly today (only `types.ts` declares it); `nextprint.json`'s `forecasters` shape is unchanged — its `as_of` just becomes honest.
4. **NFP forecasts are recorded under NFP's own reference month** = the month after the latest released PAYEMS observation (data-derived; no NFP calendar file needed).
5. **`CPI_PARAMS` are removed, not wired in.** The model never used them; publishing them is dishonest methodology. `cpi.parameters` becomes `{}` (key kept — schema requires it), the critical `nowcast_params_published` qa check is deleted (qa total 19 → 18), and the `/cpi-preview` parameter prose line is dropped.
6. **Month helpers consolidate into `pipeline/dates.py`**; `connectors/util.month_first` becomes a re-export; `official._months_back`, `backtest.prior_month`, `models._month_start/_previous_month/_next_month`, and the two duplicated monthly-change helpers collapse onto it. `phase3._write`/`composites._write` stay as-is (they differ only by the accountability special-case and each is 6 lines; consolidation was reviewed and judged not worth the churn — note this in the commit message of Task 1 if asked).
7. **`stress.json` drops per-indicator `history` arrays** (only used to compute the percentile score, never rendered).
8. **`cpi_walk_forward` walks vintages in one pass** instead of an O(months²) `vintage.as_of` scan per release.

---

### Task 1: `pipeline/dates.py` — single source of truth for month arithmetic

**Files:**
- Create: `pipeline/dates.py`
- Create: `tests/test_dates.py`
- Modify: `pipeline/engine/official.py` (delete `_months_back`, lines 8–12)
- Modify: `pipeline/engine/backtest.py` (delete `prior_month` + `_mom` bodies)
- Modify: `pipeline/engine/nowcast/models.py` (delete `_month_start`/`_previous_month`/`_next_month`/`_monthly_changes`, lines 17–28 and 67–74)
- Modify: `pipeline/publish/phase3.py` (build_accountability's `backtest.prior_month` call)
- Modify: `pipeline/connectors/util.py` (`month_first` becomes a re-export)

**Interfaces:**
- Produces (later tasks import these): `dates.month_first(period: str) -> str`, `dates.months_back(obs_date: str, n: int) -> str`, `dates.prior_month(obs_date: str) -> str`, `dates.next_month(obs_date: str) -> str`, `dates.monthly_changes(levels: dict[str, float]) -> dict[str, float]`.

- [ ] **Step 1: Write the failing tests** (`tests/test_dates.py`, new file)

```python
import pytest

from pipeline import dates


def test_month_first():
    assert dates.month_first("2026-05") == "2026-05-01"
    assert dates.month_first("2026-05-31") == "2026-05-01"


def test_months_back_wraps_years():
    assert dates.months_back("2026-01-01", 1) == "2025-12-01"
    assert dates.months_back("2026-03-01", 12) == "2025-03-01"
    assert dates.months_back("2026-01-01", -1) == "2026-02-01"


def test_prior_and_next_month():
    assert dates.prior_month("2026-01-01") == "2025-12-01"
    assert dates.next_month("2025-12-01") == "2026-01-01"


def test_monthly_changes_skips_non_adjacent_months():
    # 2025-10 never published: 2025-11 vs 2025-09 is a 2-month change, not MoM
    levels = {"2025-08-01": 100.0, "2025-09-01": 100.5, "2025-11-01": 101.5,
              "2025-12-01": 101.7}
    out = dates.monthly_changes(levels)
    assert out["2025-09-01"] == pytest.approx(0.5)
    assert "2025-11-01" not in out
    assert out["2025-12-01"] == pytest.approx((101.7 / 101.5 - 1) * 100)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dates.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline.dates'`

- [ ] **Step 3: Create `pipeline/dates.py`**

```python
"""Month/date helpers — the single source of truth.

Consolidates the former official._months_back, backtest.prior_month,
nowcast.models._month_start/_previous_month/_next_month/_monthly_changes and
connectors.util.month_first (now a re-export). Monthly rows are YYYY-MM-01.
"""


def month_first(period: str) -> str:
    """'2026-05' or '2026-05-31' -> '2026-05-01'."""
    return f"{period[:7]}-01"


def months_back(obs_date: str, n: int) -> str:
    """First-of-month date n months before obs_date (n may be negative)."""
    year, month = int(obs_date[:4]), int(obs_date[5:7])
    total = year * 12 + (month - 1) - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}-01"


def prior_month(obs_date: str) -> str:
    return months_back(obs_date, 1)


def next_month(obs_date: str) -> str:
    return months_back(obs_date, -1)


def monthly_changes(levels: dict[str, float]) -> dict[str, float]:
    """Percent change between calendar-adjacent months only: a pair spanning
    a missing month (the never-published 2025-10 print) is a 2-month change,
    not a MoM — it must neither grade a target nor enter model inputs.
    Preserves the input's iteration order."""
    out = {}
    for month, value in levels.items():
        prior = prior_month(month)
        if levels.get(prior):
            out[month] = (value / levels[prior] - 1) * 100
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_dates.py -q` — Expected: 4 passed

- [ ] **Step 5: Rewire the four consumers** (behavior identical; existing tests are the net)

`pipeline/engine/official.py` — delete the `_months_back` function (lines 8–12) and add to imports:

```python
from pipeline.dates import months_back as _months_back
```

`pipeline/engine/backtest.py` — replace `prior_month` and `_mom` with:

```python
from pipeline.dates import monthly_changes, prior_month  # noqa: F401 (prior_month re-exported for phase3)


def _mom(rows):
    """MoM keyed by obs_date from (obs_date, value, ...) tuples — see
    dates.monthly_changes for the month-adjacency guard."""
    return monthly_changes({r[0]: r[1] for r in rows})
```

(`rows` from `first_releases`/`as_of` arrive sorted ascending and unique per obs_date, so the dict preserves chronological order — `list(_mom(...).values())[-3:]` semantics are unchanged.)

`pipeline/engine/nowcast/models.py` — delete `_month_start`, `_previous_month`, `_next_month` (lines 17–28) and `_monthly_changes` (lines 67–74); add import:

```python
from pipeline.dates import month_first, monthly_changes, next_month, prior_month
```

then rename in-body uses: `_month_start(` → `month_first(`, `_previous_month(` → `prior_month(`, `_next_month(` → `next_month(`, and in `pce_bridge` replace `cpi, pce = _monthly_changes(cpi_rows), _monthly_changes(pce_rows)` with `cpi, pce = monthly_changes(dict(cpi_rows)), monthly_changes(dict(pce_rows))`.

`pipeline/publish/phase3.py` — in `build_accountability`, `backtest.prior_month(period)` still resolves via the re-export; change it anyway to the canonical import for clarity: add `from pipeline.dates import prior_month` and use `prior_month(period)`.

`pipeline/connectors/util.py` — replace the `month_first` def with:

```python
from pipeline.dates import month_first  # noqa: F401 — re-export; connectors import from here
```

- [ ] **Step 6: Full suite**

Run: `pytest -q` — Expected: 262 passed (258 + 4 new), zero failures.

- [ ] **Step 7: Commit**

```bash
git add pipeline/dates.py tests/test_dates.py pipeline/engine/official.py \
  pipeline/engine/backtest.py pipeline/engine/nowcast/models.py \
  pipeline/publish/phase3.py pipeline/connectors/util.py
git commit -m "refactor: consolidate month helpers into pipeline/dates.py"
```

---

### Task 2: street.py — country filter, core exclusion, consensus fallback, reference-month obs_date

**Files:**
- Modify: `pipeline/connectors/street.py`
- Test: `tests/test_phase3_connectors.py` (modify `test_street_selects_monthly_cpi_consensus`, add 3)
- Modify: `tests/test_run_daily.py` (~line 28: street fixture row gains `"country": "US"`)

**Interfaces:**
- Produces: `street_cpi_mom` observations with `obs_date` = reference-month first (month before the release date), `vintage_date` = retrieval day. Task 4's `latest_benchmarks` relies on this convention.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_phase3_connectors.py`; also update the existing `test_street_selects_monthly_cpi_consensus` payload to include `"country": "US"` and assert the new obs_date)

```python
def test_street_obs_date_is_reference_month_first():
    # July-14 release covers June: obs_date = 2026-06-01 (benchmark convention)
    payload = [{"country": "US", "event": "Consumer Price Index MoM",
                "date": "2026-07-14 08:30:00", "estimate": 0.3}]
    rows = street.fetch("key", "2026-07-10",
                        http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].obs_date == "2026-06-01"
    assert rows[0].vintage_date == "2026-07-10"


def test_street_skips_core_and_foreign_rows():
    payload = [
        {"country": "GB", "event": "Consumer Price Index MoM",
         "date": "2026-07-16 07:00:00", "estimate": 0.5},
        {"country": "US", "event": "Core Consumer Price Index MoM",
         "date": "2026-07-14 08:30:00", "estimate": 0.4},
        {"country": "US", "event": "Consumer Price Index MoM",
         "date": "2026-07-14 08:30:00", "estimate": 0.3}]
    rows = street.fetch("key", "2026-07-10",
                        http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == 0.3  # not the UK 0.5 or the Core 0.4


def test_street_null_estimate_falls_back_to_consensus():
    payload = [{"country": "US", "event": "Consumer Price Index MoM",
                "date": "2026-07-14 08:30:00", "estimate": None,
                "consensus": 0.25}]
    rows = street.fetch("key", "2026-07-10",
                        http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == 0.25
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_phase3_connectors.py -q`
Expected: the 3 new tests FAIL (obs_date is the release date; UK row matches first; null estimate skipped despite consensus).

- [ ] **Step 3: Rewrite the row loop in `street.py`**

```python
from pipeline.dates import month_first, prior_month

...
    for row in response.json():
        if str(row.get("country", "")).upper() != "US":
            continue  # many countries publish a "Consumer Price Index MoM"
        name = str(row.get("event", row.get("name", ""))).lower()
        if "core" in name:
            continue  # Core CPI sits next to headline in the calendar
        if not ("consumer price index" in name and ("month" in name or "mom" in name)):
            continue
        estimate = row.get("estimate")
        if estimate is None:
            estimate = row.get("consensus")  # estimate:null + populated consensus
        if estimate is None:
            continue
        # obs_date = reference-month first: a CPI release always covers the
        # prior calendar month (shared benchmark store convention).
        reference = prior_month(month_first(row["date"][:10]))
        return [Observation("street_cpi_mom", reference, float(estimate),
                            vintage, "STREET", "API")]
    raise ValueError("no CPI monthly consensus in FMP calendar")
```

- [ ] **Step 4: Update the end-to-end fixture** — in `tests/test_run_daily.py` (~line 28) add `"country": "US"` to the economic-calendar fixture row.

- [ ] **Step 5: Full suite**

Run: `pytest -q` — Expected: all pass (262 + 3 new = 265).

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/street.py tests/test_phase3_connectors.py tests/test_run_daily.py
git commit -m "fix(connectors): street US-only headline CPI, consensus fallback, reference-month obs_date"
```

---

### Task 3: kalshi — reference-month obs_date from the event ticker

**Files:**
- Modify: `pipeline/connectors/kalshi.py`
- Test: `tests/test_phase3_connectors.py` (update 3 existing kalshi tests' payloads, add 2)
- Modify: `tests/test_run_daily.py` (~line 35: kalshi fixture market gains `event_ticker` + `close_time`)

**Interfaces:**
- Produces: `kalshi_cpi_mom` observations with `obs_date` = reference-month first parsed from `event_ticker` (`KXCPI-26JUN` → `2026-06-01`), falling back to `close_time`'s prior month (markets close on release morning; the print covers the month before). Task 4 relies on this convention.

**Open the task with a live access spike** (connector convention, spec 2a §3): `curl -s "https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXCPI&status=open&limit=3"` and confirm `event_ticker` still looks like `KXCPI-26JUL` and that the ticker month names the DATA month (close_time lands mid-following-month, on the release day). If the format drifted, adapt `TICKER_RE` before writing tests.

- [ ] **Step 1: Write the failing tests** (append; ALSO add `"event_ticker": "KXCPI-26JUL", "close_time": "2026-08-11T00:00:00Z"` to `test_kalshi_cdf_expected_value`'s and `test_kalshi_unpriced_markets_raise_cleanly`'s market rows — with strict reference-month derivation, tickerless payloads would raise)

```python
def test_kalshi_obs_date_from_event_ticker():
    payload = {"markets": [
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-26JUN", "close_time": "2026-07-14T00:00:00Z"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].obs_date == "2026-06-01"
    assert rows[0].vintage_date == "2026-07-10"


def test_kalshi_obs_date_falls_back_to_close_time():
    # unparsable ticker: close is release morning -> reference = prior month
    payload = {"markets": [
        {"floor_strike": 0.2, "last_price_dollars": "0.5",
         "event_ticker": "KXCPI-WEIRD", "close_time": "2026-07-14T00:00:00Z"}]}
    rows = kalshi.fetch(http_get=lambda *a, **k: FakeResponse(payload),
                        vintage_date="2026-07-10")
    assert rows[0].obs_date == "2026-06-01"
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_phase3_connectors.py -q`
Expected: the 2 new tests FAIL — `obs_date == "2026-07-10"` (today) under the old convention.

- [ ] **Step 3: Implement in `kalshi.py`**

Add near the top:

```python
import re

from pipeline.dates import month_first, prior_month

MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
          "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
TICKER_RE = re.compile(r"-(\d{2})([A-Z]{3})$")


def _reference_month(event_ticker: str, close_time: str | None) -> str:
    """KXCPI-26JUN names the June data month. Fallback: markets close on
    release morning, and a CPI release covers the prior calendar month."""
    m = TICKER_RE.search(event_ticker or "")
    if m and m[2] in MONTHS:
        return f"20{m[1]}-{MONTHS[m[2]]:02d}-01"
    if close_time:
        return prior_month(month_first(close_time[:10]))
    raise ValueError("cannot derive Kalshi reference month "
                     f"(ticker={event_ticker!r}, no close_time)")
```

Then change the nearest-event selection to keep the ticker, and the return:

```python
    ticker, nearest = min(events.items(),
                          key=lambda kv: min(m.get("close_time") or "9999"
                                             for m in kv[1]))
    ...
    obs_date = _reference_month(ticker,
                                min((m.get("close_time") or "9999" for m in nearest)).replace("9999", "") or None)
```

Simpler and clearer — compute once above the return:

```python
    close = min((m.get("close_time") for m in nearest if m.get("close_time")),
                default=None)
    obs_date = _reference_month(ticker, close)
    return [Observation("kalshi_cpi_mom", obs_date, expected, vintage,
                        "KALSHI", "API")]
```

- [ ] **Step 4: Update the end-to-end fixture** — `tests/test_run_daily.py` (~line 35), kalshi market row becomes:

```python
        return FakeResponse({"markets": [{"floor_strike": 0.2,
                                           "last_price_dollars": "1.0",
                                           "event_ticker": "KXCPI-26JUL",
                                           "close_time": "2026-08-11T00:00:00Z"}]})
```

- [ ] **Step 5: Full suite** — `pytest -q`, all pass (265 + 2 = 267).

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/kalshi.py tests/test_phase3_connectors.py tests/test_run_daily.py
git commit -m "fix(connectors): kalshi obs_date = reference month parsed from event ticker"
```

---

### Task 4: reference-month-filtered `latest_benchmarks` with real as-of, through nextprint

**Files:**
- Modify: `pipeline/publish/phase3.py` (`latest_benchmarks`, `build_nextprint`)
- Modify: `pipeline/engine/nowcast/models.py` (`build_latest` benchmark consumption)
- Modify: `pipeline/run_daily.py:198-201` (pass reference month)
- Modify: `schemas/nowcast_latest.schema.json` (`benchmarks` shape)
- Modify: `site/src/lib/types.ts:56` (`benchmarks` type)
- Test: `tests/test_accountability.py` (add; it already imports phase3/vintage/Observation)

**Interfaces:**
- Produces: `phase3.latest_benchmarks(conn, reference_month: str | None) -> dict[str, dict | None]` where each entry is `{"value": float, "as_of": str}` or `None`. `nowcast_latest.json` `benchmarks` carries that shape; `nextprint.json` `forecasters` shape is unchanged but benchmark `as_of` becomes the retrieval vintage instead of a restamp.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_accountability.py`)

```python
def test_latest_benchmarks_filters_to_reference_month(tmp_path: Path):
    rows = [
        # old-convention leftover (obs_date = scrape day) must NOT match
        Observation("kalshi_cpi_mom", "2026-07-10", 0.99, "2026-07-10", "KALSHI", "API"),
        # new-convention rows: June reference, retrieved on two days (latest vintage wins)
        Observation("kalshi_cpi_mom", "2026-06-01", 0.21, "2026-07-09", "KALSHI", "API"),
        Observation("kalshi_cpi_mom", "2026-06-01", 0.22, "2026-07-11", "KALSHI", "API"),
        Observation("cleveland_cpi_mom", "2026-06-01", 0.18, "2026-07-11", "CLEVELAND", "SCRAPE"),
    ]
    vintage.append(rows, tmp_path)
    out = phase3.latest_benchmarks(vintage.load(tmp_path), "2026-06")
    assert out["kalshi"] == {"value": 0.22, "as_of": "2026-07-11"}
    assert out["cleveland"] == {"value": 0.18, "as_of": "2026-07-11"}
    assert out["street"] is None  # no row for the month


def test_latest_benchmarks_none_reference_month(tmp_path: Path):
    out = phase3.latest_benchmarks(vintage.load(tmp_path), None)
    assert out == {"cleveland": None, "street": None, "kalshi": None}
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_accountability.py -q`
Expected: FAIL — `latest_benchmarks() takes 1 positional argument but 2 were given`.

- [ ] **Step 3: Replace `latest_benchmarks` in `phase3.py`**

```python
def latest_benchmarks(conn, reference_month: str | None) -> dict[str, dict | None]:
    """Benchmark forecasts FOR the nowcast's reference month, with real as-of.

    Rows are keyed obs_date = reference-month first (shared connector
    convention); anything else — old-convention leftovers, a stale prior
    month — is excluded rather than silently blended into the ensemble."""
    codes = {"cleveland": "cleveland_cpi_mom", "street": "street_cpi_mom",
             "kalshi": "kalshi_cpi_mom"}
    if reference_month is None:
        return {name: None for name in codes}
    out = {}
    for name, code in codes.items():
        row = conn.execute(
            "SELECT value, vintage_date FROM observations "
            "WHERE series_code = ? AND obs_date = ? "
            "ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (code, f"{reference_month}-01")).fetchone()
        out[name] = None if row is None else {"value": row[0], "as_of": row[1]}
    return out
```

- [ ] **Step 4: Consume the new shape in `models.build_latest`**

In the live branch replace:

```python
    benchmark_values = benchmarks or {}
    forecasts = {"macrogauge": cpi["mom_pct"], **benchmark_values}
```

with:

```python
    benchmark_values = benchmarks or {}
    forecasts = {"macrogauge": cpi["mom_pct"],
                 **{name: b["value"] for name, b in benchmark_values.items()
                    if b is not None}}
```

(The degraded branch's `"benchmarks": benchmarks or {}` needs no change — a dict of `None`s is the correct degraded shape.)

- [ ] **Step 5: Honest as-of in `build_nextprint`** — replace the benchmark comprehension:

```python
    candidates += [{"name": name.title(), "value": bench["value"],
                    "kind": "benchmark", "as_of": bench["as_of"]}
                   for name, bench in nowcast["benchmarks"].items()
                   if bench is not None]
```

- [ ] **Step 6: Wire the reference month in `run_daily.py`** (lines 198–201):

```python
        next_release = release_calendar.next_print(today)
        nowcast_payload = build_nowcast(
            conn, gauge_result, next_release,
            benchmarks=phase3.latest_benchmarks(
                conn, next_release["reference_month"] if next_release else None))
```

- [ ] **Step 7: Schema + site types.** In `schemas/nowcast_latest.schema.json` replace `"benchmarks": {"type": "object"}` with:

```json
"benchmarks": {"type": "object", "additionalProperties": {"oneOf": [
  {"type": "null"},
  {"type": "object", "required": ["value", "as_of"],
   "properties": {"value": {"type": "number"}, "as_of": {"type": "string"}}}
]}}
```

In `site/src/lib/types.ts` line 56:

```typescript
  benchmarks: Record<string, { value: number; as_of: string } | null>;
```

- [ ] **Step 8: Full verification**

Run: `pytest -q` (expect 267 + 2 = 269; `test_run_daily.py` end-to-end must stay green — benchmarks may be `None` there depending on the real date vs fixture months, which the shape tolerates) and `cd site && npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 9: Commit**

```bash
git add pipeline/publish/phase3.py pipeline/engine/nowcast/models.py pipeline/run_daily.py \
  schemas/nowcast_latest.schema.json site/src/lib/types.ts tests/test_accountability.py
git commit -m "feat(nowcast): benchmarks filtered to reference month, real as-of through nextprint"
```

---

### Task 5: NFP forecasts recorded under NFP's own reference month

**Files:**
- Modify: `pipeline/engine/nowcast/models.py` (`nfp_nowcast` return, `build_latest` nfp passthrough is unchanged)
- Modify: `pipeline/publish/phase3.py` (`record_forecasts`, `build_accountability` pending block)
- Modify: `schemas/nowcast_latest.schema.json` (`nfp` shape), `site/src/lib/types.ts:55`
- Test: `tests/test_accountability.py`, `tests/test_nowcast.py`

**Interfaces:**
- Produces: `nfp_nowcast(...)` return gains `"reference_month": "YYYY-MM"` = the month after the latest PAYEMS observation. `record_forecasts` writes `forecast_nfp_change` under that month.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_nowcast.py` (mirror its existing `nfp_nowcast` test setup for row shape):

```python
def test_nfp_nowcast_reference_month_is_month_after_latest_payroll():
    payroll = [(f"2025-{m:02d}-01", 150000.0 + 10 * m) for m in range(1, 13)]
    result = models.nfp_nowcast(payroll, [])
    assert result["reference_month"] == "2026-01"  # Dec released -> forecasting Jan
```

Append to `tests/test_accountability.py`:

```python
def test_record_forecasts_uses_nfp_own_reference_month(tmp_path: Path):
    conn = vintage.load(tmp_path)
    nowcast = {"reference_month": "2026-06", "generated_on": "2026-07-10",
               "cpi": {"mom_pct": 0.25}, "pce": {"mom_pct": 0.2},
               "nfp": {"change_thousands": 110, "reference_month": "2026-07"}}
    written = phase3.record_forecasts(nowcast, conn, tmp_path, "2026-07-10")
    assert written == 3
    row = conn.execute("SELECT obs_date FROM observations "
                       "WHERE series_code = 'forecast_nfp_change'").fetchone()
    assert row[0] == "2026-07-01"  # NFP's own month, not CPI's 2026-06
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_nowcast.py tests/test_accountability.py -q`
Expected: FAIL — `KeyError: 'reference_month'` on the nfp dict / obs_date `2026-06-01`.

- [ ] **Step 3: Implement.** In `models.nfp_nowcast` (it already computes `months = sorted(payroll)`), add to the return dict:

```python
    return {"change_thousands": round(forecast), "status": "live",
            "reference_month": next_month(months[-1])[:7],
            ...
```

In `phase3.record_forecasts`, replace the single-target-date block:

```python
    target_date = f"{nowcast['reference_month']}-01"
    values = {"forecast_cpi_mom": nowcast["cpi"]["mom_pct"],
              "forecast_pce_mom": nowcast["pce"]["mom_pct"],
              "forecast_nfp_change": (None if nowcast["nfp"] is None else
                                      nowcast["nfp"]["change_thousands"])}
    observations = [Observation(code, target_date, value, vintage_date,
                                "MACROGAUGE", "MODEL")
                    for code, value in values.items() if value is not None]
```

with per-target months (an NFP for the CPI's reference month is already
released for ~2 weeks every month — it must be graded against its OWN print):

```python
    cpi_month = f"{nowcast['reference_month']}-01"
    nfp = nowcast.get("nfp")
    entries = [("forecast_cpi_mom", cpi_month, nowcast["cpi"]["mom_pct"]),
               ("forecast_pce_mom", cpi_month, nowcast["pce"]["mom_pct"])]
    if nfp is not None:
        entries.append(("forecast_nfp_change",
                        f"{nfp['reference_month']}-01",
                        nfp["change_thousands"]))
    observations = [Observation(code, obs_date, value, vintage_date,
                                "MACROGAUGE", "MODEL")
                    for code, obs_date, value in entries if value is not None]
```

In `phase3.build_accountability`, the `pending` block's reference period for nfp:

```python
    reference = (nowcast.get("nfp") or {}).get("reference_month") \
        if target == "nfp" else nowcast.get("reference_month")
    pending = [] if forecast is None or forecast.get("status") == "unavailable" else [{
        "reference_period": reference, "badge": "LIVE",
        ...
```

- [ ] **Step 4: Schema + types.** `schemas/nowcast_latest.schema.json`:

```json
"nfp": {"oneOf": [{"type": "null"},
  {"type": "object", "required": ["change_thousands", "reference_month", "status"]}]}
```

`site/src/lib/types.ts:55`:

```typescript
  nfp: { change_thousands: number; reference_month: string } | null;
```

- [ ] **Step 5: Full suite + site** — `pytest -q` (expect 269 + 2 = 271), `cd site && npx tsc --noEmit && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add pipeline/engine/nowcast/models.py pipeline/publish/phase3.py \
  schemas/nowcast_latest.schema.json site/src/lib/types.ts \
  tests/test_nowcast.py tests/test_accountability.py
git commit -m "fix(nowcast): NFP forecasts target NFP's own reference month"
```

---

### Task 6: remove dead CPI_PARAMS from model, qa, and site

**Files:**
- Modify: `pipeline/engine/nowcast/models.py` (delete `CPI_PARAMS`, both uses)
- Modify: `pipeline/publish/qa.py` (delete the `nowcast_params_published` check, ~lines 128–132)
- Modify: `tests/test_run_daily.py:110` (`qa["total"] == 18`) and `:308` (drop the params assertion)
- Modify: `site/src/app/cpi-preview/page.tsx:15`, `site/src/lib/types.ts:46`
- Test: `tests/test_nowcast.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_nowcast.py`)

```python
def test_cpi_nowcast_publishes_no_phantom_parameters():
    # fuel_beta / rent_lag_months / rent_w were never used by the model —
    # publishing them was dishonest methodology (2026-07-11 review).
    assert not hasattr(models, "CPI_PARAMS")
```

Also update any existing test asserting `parameters` contents (grep: `grep -rn "fuel_beta" tests/` and fix each to expect `{}`).

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_nowcast.py -q` → FAIL (`CPI_PARAMS` exists).

- [ ] **Step 3: Implement.** In `models.py` delete line 14 (`CPI_PARAMS = ...`); in `cpi_nowcast`'s return and in `build_latest`'s degraded branch replace `"parameters": CPI_PARAMS` with `"parameters": {}`. In `qa.py` delete the block:

```python
            params = nowcast["cpi"].get("parameters", {})
            checks.append({"name": "nowcast_params_published", "critical": True,
                           "pass": all(k in params for k in
                                       ("fuel_beta", "rent_lag_months", "rent_w")),
                           "detail": f"parameters={params}"})
```

In `tests/test_run_daily.py`: line 110 → `assert qa["total"] == 18`; line 308: delete the `nowcast_params_published` assertion (replace with `assert "nowcast_params_published" not in checks`).

In `site/src/app/cpi-preview/page.tsx` line 15, the method line becomes:

```tsx
    <p className="method">Status: {nowcast.cpi.status.toUpperCase()}.</p>
```

In `site/src/lib/types.ts` line 46:

```typescript
    parameters: Record<string, number>;
```

- [ ] **Step 4: Full verification** — `pytest -q` (272 total: +1 new, existing counts adjusted), `cd site && npx tsc --noEmit && npm test && npm run build && npm run e2e`.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/nowcast/models.py pipeline/publish/qa.py \
  tests/test_run_daily.py tests/test_nowcast.py \
  site/src/app/cpi-preview/page.tsx site/src/lib/types.ts
git commit -m "fix(nowcast,qa,site): remove never-used CPI_PARAMS from payload, qa check, and prose"
```

---

### Task 7: stress.json stops embedding full value histories

**Files:**
- Modify: `pipeline/engine/composites.py` (`stress_index`, ~line 73)
- Modify: `schemas/stress.schema.json` (drop the `history` property)
- Test: `tests/test_composites.py` (or wherever `stress_index` is tested — `grep -rn "stress_index" tests/`)

- [ ] **Step 1: Write the failing test**

```python
def test_stress_index_rows_do_not_embed_history():
    # history is scoring input, not display data — embedding ~1800 daily
    # values per indicator bloats stress.json for zero site benefit
    indicators = [{"code": "X", "weight": 1.0, "direction": 1, "value": 5.0,
                   "as_of": "2026-07-01", "history": [1.0, 2.0, 3.0, 4.0, 5.0]}]
    result = composites.stress_index(indicators)
    assert "history" not in result["indicators"][0]
    assert result["indicators"][0]["score"] == 100.0
```

- [ ] **Step 2: Run to verify failure** — FAIL (`history` present in the row).

- [ ] **Step 3: Implement** — in `stress_index`, replace `rows.append({**item, "score": round(score, 1)})` with:

```python
        rows.append({**{k: v for k, v in item.items() if k != "history"},
                     "score": round(score, 1)})
```

In `schemas/stress.schema.json`, delete `"history":{"type":"array","items":{"type":"number"}}` from the item properties.

- [ ] **Step 4: Full suite** — `pytest -q` (273).

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/composites.py schemas/stress.schema.json tests/test_composites.py
git commit -m "fix(composites): stress.json drops embedded per-indicator histories"
```

---

### Task 8: backtest walks vintages in one pass

**Files:**
- Modify: `pipeline/engine/backtest.py` (`cpi_walk_forward`)
- Test: existing `tests/test_backtest.py` is the behavioral net (vintage-true + hole tests); add one ordering test.

- [ ] **Step 1: Write the failing-or-pinning test** (append to `tests/test_backtest.py`; with the current implementation it PASSES — it pins behavior the rewrite must preserve; that is acceptable here because the rewrite is a pure performance refactor guarded by existing+this test)

```python
def test_walk_forward_revised_values_stay_vintage_true(tmp_path: Path):
    # a revision published AFTER a release's cutoff must not leak into that
    # release's known history (the whole point of vintage-true grading)
    obs = [Observation("CPIAUCNS", f"2025-{m:02d}-01", 100.0 * (1.002 ** m),
                       f"2025-{m + 1:02d}-10", "FRED", "API") for m in range(1, 8)]
    # big revision to March, learned in August — after all July-and-earlier cutoffs
    obs.append(Observation("CPIAUCNS", "2025-03-01", 999.0, "2025-08-15", "FRED", "API"))
    vintage.append(obs, tmp_path)
    result = backtest.cpi_walk_forward(vintage.load(tmp_path))
    # every graded row's forecast was fit on pre-revision values: no forecast
    # or naive value can reflect the 999.0 level (which would produce a
    # massive MoM in the trailing window)
    for row in result["rows"]:
        assert abs(row["forecast_mom_pct"]) < 5, row
        assert abs(row["naive_mom_pct"]) < 5, row
```

- [ ] **Step 2: Run it** — `pytest tests/test_backtest.py -q` — Expected: PASS (pins current behavior).

- [ ] **Step 3: Rewrite `cpi_walk_forward`** (replace the body; `_mom`/`monthly_changes` from Task 1):

```python
def cpi_walk_forward(conn, min_history: int = 3) -> dict:
    releases = sorted(vintage.first_releases(conn, "CPIAUCNS"),
                      key=lambda r: r[2])  # walk in release order
    actual_mom = _mom(sorted(releases))
    # One pass over all vintages instead of an O(months^2) as_of scan per
    # release: rows sorted by vintage feed an incremental latest-known view.
    all_rows = conn.execute(
        "SELECT obs_date, value, vintage_date FROM observations "
        "WHERE series_code = ? ORDER BY vintage_date, rowid",
        ("CPIAUCNS",)).fetchall()
    known: dict[str, float] = {}
    rows, i = [], 0
    for obs_date, actual, release_date in releases:
        cutoff = (date.fromisoformat(release_date) - timedelta(days=1)).isoformat()
        while i < len(all_rows) and all_rows[i][2] <= cutoff:
            known[all_rows[i][0]] = all_rows[i][1]
            i += 1
        known_mom = list(monthly_changes(dict(sorted(known.items()))).values())
        if len(known_mom) < min_history or obs_date not in actual_mom:
            continue
        ours = sum(known_mom[-3:]) / 3
        naive = known_mom[-1]
        actual_change = actual_mom[obs_date]
        rows.append({"target_month": obs_date[:7], "cutoff": cutoff,
                     "release_date": release_date, "badge": "BT",
                     "forecast_mom_pct": round(ours, 2),
                     "naive_mom_pct": round(naive, 2),
                     "actual_mom_pct": round(actual_change, 2),
                     "error_pp": round(ours - actual_change, 2)})
    def mae(key):
        return (None if not rows else
                round(sum(abs(r[key] - r["actual_mom_pct"]) for r in rows) / len(rows), 3))
    return {"model": "cpi_3m_vintage_true", "rows": rows,
            "summary": {"observations": len(rows), "mae_pp": mae("forecast_mom_pct"),
                        "naive_mae_pp": mae("naive_mom_pct")}}
```

Note the row-ordering subtlety: `known` accumulates in vintage order, so it MUST be sorted by obs_date before `monthly_changes` — `[-3:]` means "last three months", not "three most recently learned".

- [ ] **Step 4: Full suite** — `pytest -q` (274) — all existing backtest tests (vintage-true, hole-skipping) must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/backtest.py tests/test_backtest.py
git commit -m "perf(backtest): single-pass vintage walk replaces per-release as_of scans"
```

---

### Task 9: wrap — real-store regeneration diff, docs, close-out

**Files:**
- Modify: `docs/plans/2026-07-11-phase-3-4-structural-risks.md` (mark below-the-line items done)
- Modify: `CLAUDE.md` (test count 258 → final)

- [ ] **Step 1: Full verification battery**

```bash
pytest -q                      # expect 274 passed
cd site && npx tsc --noEmit && npm test && npm run build && npm run e2e && cd ..
```

- [ ] **Step 2: Regenerate phase-3/4 artifacts over the real store and review the diff deliberately.** Write a scratch script that loads `store/` via `vintage.load(Path("store"))`, calls `phase3.latest_benchmarks(conn, <current reference month from release_calendar.next_print(today)>)`, `backtest.cpi_walk_forward(conn)`, and `composites builders`, and prints them next to the published `site/public/data/*.json`. Expected diffs — anything ELSE is a bug:
  - `nowcast_latest.json`: `benchmarks` entries become `{value, as_of} | null` (likely all null until the connectors run once under the new convention); `cpi.parameters` = `{}`; `nfp.reference_month` present.
  - `nextprint.json`: benchmark forecaster rows may disappear until new-convention rows accrue (first daily run repopulates them — collect runs before publish in the same run).
  - `stress.json`: indicators lose `history`; score/coverage identical.
  - `backtest.json`: byte-identical rows/summary.
  - `accountability_nfp.json`: pending row's `reference_period` = NFP's own month.
- [ ] **Step 3: Update docs** — in `docs/plans/2026-07-11-phase-3-4-structural-risks.md` mark the "Also open (below the fix line)" items implemented by this plan as done with commit hashes; bump the CLAUDE.md test count.
- [ ] **Step 4: Commit** `git add -A docs CLAUDE.md && git commit -m "docs: close out phase-3/4 below-the-line backlog"`.
- [ ] **Step 5: STOP — ask the user before pushing** (push = production deploy). On approval: `git fetch origin && git rebase origin/main && git push origin main`, then watch CI (`gh run watch`) and confirm both jobs green.

---

## Self-review notes

- **Coverage:** every remaining below-the-line item from the structural-risks plan maps to a task: benchmark provenance (Tasks 2–4), street filters (2), NFP ref-month (5), CPI_PARAMS (6), helper consolidation (1), stress histories (7), backtest O(n²) (8). The two `_write` duplicates stay by decision 6 (documented above).
- **Type consistency:** `latest_benchmarks` returns `dict[str, dict | None]` — consumed as such in `build_latest` (Task 4 Step 4) and `build_nextprint` (Task 4 Step 5); `nfp.reference_month` is produced in Task 5 Step 3 and consumed in `record_forecasts` and the schema in the same task; `dates.monthly_changes` (Task 1) is consumed by `_mom` (Task 1) and `cpi_walk_forward` (Task 8).
- **Sequencing:** Task 1 must land first (Tasks 2, 3, 8 import from `pipeline/dates`). Tasks 2–3 before 4 (the filter assumes the new obs_date convention). Tasks 5–8 are independent of each other.
