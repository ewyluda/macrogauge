# DC Context Layer (Wave 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the demand-side context layer to /datacenter (hand-seeded cards behind a verification spike, four new live series incl. a thin-book-tolerant Kalshi DC path) plus three backlogged pipeline quality items (component freshness flags, published group sums, raw per-state parity levels).

**Architecture:** Hand-seeds live in `config/dc_context.json` validated by `pipeline/dc_context.py` (dc_power.py precedent); live values ride the store via existing EIA/FRED connectors and a new `KALSHI_DC` isolation key that reuses the CPI connector's extracted CDF helper; everything publishes as one nullable `context` block in datacenter.json rendered by a new `ContextPanel`. The backlog folds ride the same engine/publisher/site files.

**Tech Stack:** Python 3.12 pipeline (stdlib only), pytest, JSON Schema, Next.js static site (TypeScript).

**Spec:** `docs/superpowers/specs/2026-07-16-dc-context-layer-design.md` (approved 2026-07-16).

## Global Constraints

- **Run tests with `.venv/bin/pytest`** (system `python3` is 3.9 and cannot import the pipeline). Scripts/one-offs run with `.venv/bin/python`.
- Baseline: **470 passed**. Every task ends with the full suite green at ≥ its predecessor's count.
- Registry moves **26 → 27 sources** (`KALSHI_DC`) and **269 → 273 series** (`eia_diesel`, `cpi_water`, `kalshi_dc_count`, `kalshi_dc_nuclear`) — exactly once, in Task 4. `tests/test_registry.py` pins both.
- Staleness values (deviations from the spec's draft table, precedent-matched): `eia_diesel` **21** (matches `eia_gasreg_w`, the existing weekly EIA petroleum series), `cpi_water` **80** (matches `CPIAUCNS`, and tolerates the known Oct-2025 publication gap), both Kalshi DC series **30**.
- **No hand-seeded value enters `config/dc_context.json` except from Task 1's SPIKE-FINAL notes.** The transformer card ships only if the spike confirms a primary source; otherwise the config key is `null`.
- All new schema fields are OPTIONAL (no `required` list gains anything); the currently-deployed production document must validate against the new schema (test/curl-pinned in Task 7).
- HTTP is injected in tests, never real. TDD with verbatim tee'd evidence to `/private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/d9a85bbf-530e-4fbe-837b-90ffd983d619/scratchpad/task<N>-<red|green>.log`. Reviewers run forensic checks; report only observed numbers.
- The Kalshi CPI path's output must stay byte-identical — its existing tests in `tests/test_phase3_connectors.py` are the pin and MUST NOT be modified.
- Do NOT `git push` (production deploy; user-gated). Do NOT edit `.superpowers/sdd/progress.md`. Work on main. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1 (SPIKE — live network, evidence-first): verify every hand-seeded value + pin live identifiers

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-dc-context-spike-notes.md`
- Create: `tests/fixtures/kalshi_dc_count.json`, `tests/fixtures/kalshi_dc_nuclear.json` (trimmed live payloads)

**Interfaces:**
- Produces: SPIKE-FINAL strings/values consumed by Tasks 2 (config values + citations), 3 (Kalshi market shapes + fixtures), 4 (diesel seriesid). Every downstream task treats SPIKE-FINAL as authoritative.

- [ ] **Step 1: CBRE colo card.** Fetch CBRE's public "North America Data Center Trends H2 2025" page/press release. Record: avg asking rate $/kW-mo, YoY %, vacancy %, GW under construction, exact citation string + URL + as-of. Research values to confirm/correct: $194.95 / +6.5% / 1.4% / 6.0 GW.
- [ ] **Step 2: LBNL queue card.** Fetch LBNL "Queued Up" 2025 edition summary (emp.lbl.gov). Record: GW generation queued, GW storage, data-year, citation. Research values: 1,400 / 890.
- [ ] **Step 3: T&T validator.** Fetch Turner & Townsend Data Centre Cost Index public summary. Record: per-year escalation % for every year publicly stated (2017→ if available; at minimum the latest), citation, as-of. Research value: +5.5% latest.
- [ ] **Step 4: Transformer lead time — verdict.** Search for a PRIMARY source (Wood Mackenzie report page, NEMA, DOE) publicly stating large-power-transformer lead time. Trade-press paraphrase does NOT count. Record VERDICT: `{weeks, asof, source}` or **OMIT** (config key null).
- [ ] **Step 5: Diesel seriesid.** Live-verify through the repo's own connector: `.venv/bin/python -c "from pipeline.connectors import eia; import os; print(eia.fetch(['PET.EMD_EPD2D_PTE_NUS_DPG.W'], os.environ['EIA_API_KEY'])[-3:])"` (source `.env` first). If that id 404s, probe the diesel counterpart of `PET.EMM_EPMR_PTE_NUS_DPG.W` on the v2 seriesid route and record what works + 3 recent observed values.
- [ ] **Step 6: Kalshi DC markets.** Fetch `https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXUSADATACENTERS&status=open&limit=100` and the same for `KXDATACENTER`. Record: do priced markets exist today; the ladder's floor_strike semantics (are they cumulative "above X count" binaries like KXCPI?); the binary's shape; whether `last_price_dollars` is present. Trim each payload to ≤5 markets and save as the two fixtures (real shapes, no invented fields). If a book is unpriced today, record that (the skip path is by design) and build the fixture from the market SHELLS with prices added marked as synthetic-but-shape-true.
- [ ] **Step 7: Write the spike notes** with a SPIKE-FINAL section: config-ready JSON values for colo/queue/tnt/transformer(+verdict), the working diesel seriesid, Kalshi shape findings + expected-value semantics for the count ladder. Every number verbatim from a fetch — tee raw fetch outputs into the scratchpad and cite them.
- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-dc-context-spike-notes.md tests/fixtures/kalshi_dc_count.json tests/fixtures/kalshi_dc_nuclear.json
git commit -m "docs+fixtures: dc-context spike — hand-seed values verified, kalshi/diesel identifiers pinned"
```

---

### Task 2: `dc_context` config + loader

**Files:**
- Create: `config/dc_context.json` (values VERBATIM from Task 1 SPIKE-FINAL)
- Create: `pipeline/dc_context.py`
- Test: `tests/test_dc_context.py`

**Interfaces:**
- Produces: `dc_context.load(path=None) -> ContextConfig` with fields `colo: Card`, `queue: Card`, `tnt_rows: tuple[dict,...]` (each `{"year": int, "escalation_pct": float}`), `tnt_asof: str`, `tnt_source: str`, `transformer: Card | None`; `Card` has `.fields: dict`, `.asof: str`, `.source: str`. Task 5 consumes; Task 8 calls `load()`.

- [ ] **Step 1: Write the failing tests** — create `tests/test_dc_context.py`:

```python
import json

import pytest

from pipeline import dc_context


def _write(tmp_path, overrides=None):
    raw = {
        "colo": {"rate_kw_mo": 194.95, "yoy_pct": 6.5, "vacancy_pct": 1.4,
                 "under_construction_gw": 6.0, "asof": "H2 2025", "source": "CBRE"},
        "queue": {"generation_gw": 1400, "storage_gw": 890,
                  "asof": "2025", "source": "LBNL Queued Up 2025"},
        "tnt": {"rows": [{"year": 2023, "escalation_pct": 8.0},
                          {"year": 2024, "escalation_pct": 5.5}],
                "asof": "2025", "source": "Turner & Townsend DCCI"},
        "transformer": None,
    }
    raw.update(overrides or {})
    p = tmp_path / "dc_context.json"
    p.write_text(json.dumps(raw))
    return p


def test_load_happy_path(tmp_path):
    cfg = dc_context.load(_write(tmp_path))
    assert cfg.colo.fields["rate_kw_mo"] == 194.95
    assert cfg.colo.asof == "H2 2025" and cfg.colo.source == "CBRE"
    assert cfg.queue.fields == {"generation_gw": 1400, "storage_gw": 890}
    assert [r["year"] for r in cfg.tnt_rows] == [2023, 2024]
    assert cfg.transformer is None


def test_transformer_present_loads(tmp_path):
    p = _write(tmp_path, {"transformer": {"weeks": 128, "asof": "2025-11",
                                          "source": "Wood Mackenzie"}})
    cfg = dc_context.load(p)
    assert cfg.transformer.fields == {"weeks": 128}


def test_load_real_config():
    cfg = dc_context.load()
    # every card carries provenance; values are spike-verified, not asserted here
    for card in (cfg.colo, cfg.queue):
        assert card.asof and card.source
    assert cfg.tnt_rows and cfg.tnt_asof and cfg.tnt_source


@pytest.mark.parametrize("overrides,match", [
    ({"colo": {"rate_kw_mo": "expensive", "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "x", "source": "y"}}, "numeric"),
    ({"colo": {"rate_kw_mo": 1, "yoy_pct": 1, "vacancy_pct": 1,
               "under_construction_gw": 1, "asof": "", "source": "y"}}, "non-empty"),
    ({"queue": {"generation_gw": 1400, "asof": "x", "source": "y"}}, "numeric"),
    ({"tnt": {"rows": [], "asof": "x", "source": "y"}}, "non-empty"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": 5.5},
               {"year": 2023, "escalation_pct": 8.0}],
      "asof": "x", "source": "y"}}, "ascending"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": "high"}],
      "asof": "x", "source": "y"}}, "numeric"),
    ({"tnt": {"rows": [{"year": 2024, "escalation_pct": 5.5}],
      "asof": "", "source": "y"}}, "asof"),
    ({"transformer": {"weeks": "long", "asof": "x", "source": "y"}}, "numeric"),
])
def test_garbled_config_rejected(tmp_path, overrides, match):
    with pytest.raises(ValueError, match=match):
        dc_context.load(_write(tmp_path, overrides))
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_dc_context.py -q 2>&1 | tee <scratchpad>/task2-red.log`
Expected: collection error (`ModuleNotFoundError`/`ImportError`: no `pipeline.dc_context`).

- [ ] **Step 3: Implement.** Create `pipeline/dc_context.py`:

```python
"""DC context-layer config — hand-seeded demand-side cards (spec §3).

Loader precedent: pipeline/dc_power.py. Every card carries asof + source so
staleness stays visible on-site; a typo'd or emptied config must fail loudly
at load time, never publish a blank or garbled card. The transformer card is
OPTIONAL end-to-end: it ships only when a primary source confirmed it
(spike-gated, spec §2)."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_context.json"

REQUIRED = {
    "colo": ("rate_kw_mo", "yoy_pct", "vacancy_pct", "under_construction_gw"),
    "queue": ("generation_gw", "storage_gw"),
    "transformer": ("weeks",),
}


@dataclass(frozen=True)
class Card:
    fields: dict   # the card's numeric values (REQUIRED[name] keys only)
    asof: str
    source: str


@dataclass(frozen=True)
class ContextConfig:
    colo: Card
    queue: Card
    tnt_rows: tuple[dict, ...]   # ascending {"year": int, "escalation_pct": float}
    tnt_asof: str
    tnt_source: str
    transformer: Card | None


def _card(raw: dict, name: str) -> Card:
    for key in REQUIRED[name]:
        if not isinstance(raw.get(key), (int, float)) or isinstance(raw.get(key), bool):
            raise ValueError(f"dc_context {name}: {key} must be numeric")
    for key in ("asof", "source"):
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"dc_context {name}: {key} must be a non-empty string")
    return Card(fields={k: raw[k] for k in REQUIRED[name]},
                asof=raw["asof"], source=raw["source"])


def load(path: Path | None = None) -> ContextConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    tnt = raw["tnt"]
    rows = tnt.get("rows", [])
    if not rows:
        raise ValueError("dc_context tnt: rows must be non-empty")
    years = [r.get("year") for r in rows]
    if not all(isinstance(y, int) for y in years) or years != sorted(years):
        raise ValueError("dc_context tnt: rows need ascending integer years")
    for r in rows:
        if not isinstance(r.get("escalation_pct"), (int, float)):
            raise ValueError("dc_context tnt: escalation_pct must be numeric")
    if not tnt.get("asof") or not tnt.get("source"):
        raise ValueError("dc_context tnt: asof and source required")
    transformer = raw.get("transformer")
    return ContextConfig(
        colo=_card(raw["colo"], "colo"),
        queue=_card(raw["queue"], "queue"),
        tnt_rows=tuple(rows), tnt_asof=tnt["asof"], tnt_source=tnt["source"],
        transformer=None if transformer is None else _card(transformer, "transformer"))
```

Create `config/dc_context.json` with the SPIKE-FINAL values (shape below; NUMBERS AND STRINGS COME FROM THE SPIKE NOTES, including as many T&T year-rows as the spike confirmed, and `"transformer": null` unless the spike's verdict confirmed a primary source):

```json
{"colo": {"rate_kw_mo": <SPIKE>, "yoy_pct": <SPIKE>, "vacancy_pct": <SPIKE>,
          "under_construction_gw": <SPIKE>, "asof": "<SPIKE>", "source": "<SPIKE>"},
 "queue": {"generation_gw": <SPIKE>, "storage_gw": <SPIKE>,
           "asof": "<SPIKE>", "source": "<SPIKE>"},
 "tnt": {"rows": [{"year": <SPIKE>, "escalation_pct": <SPIKE>}, …],
         "asof": "<SPIKE>", "source": "<SPIKE>"},
 "transformer": null}
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dc_context.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task2-green.log`
Expected: 11 pass in file (3 + 8 parametrized); full suite ≥ 481.

- [ ] **Step 5: Commit**

```bash
git add pipeline/dc_context.py config/dc_context.json tests/test_dc_context.py
git commit -m "feat(dc): hand-seeded context config + fail-loud loader (spike-verified values)"
```

---

### Task 3: Kalshi — extract the CDF helper + `fetch_dc` (thin-book-tolerant)

**Files:**
- Modify: `pipeline/connectors/kalshi.py`
- Test: `tests/test_phase3_connectors.py` (append only — existing kalshi tests are the CPI byte-identity pin and MUST NOT change)

**Interfaces:**
- Consumes: Task 1's fixtures + shape findings.
- Produces: `kalshi._expected_from_ladder(points: list[tuple[float, float]]) -> float` and `kalshi.fetch_dc(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]` (series_code = the ticker; collect.py's id_map remaps). Task 4 wires it.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_phase3_connectors.py` (reuse its existing `FakeResponse`):

```python
def test_kalshi_dc_ladder_expected_count():
    # hand-computed: strikes 1000/2000, probs 0.9/0.4 -> gaps [1000], tail 500
    # values [500, 1500, 2500]; masses [0.1, 0.5, 0.4]
    # E = 50 + 750 + 1000 = 1800.0
    payload = {"markets": [
        {"floor_strike": 1000, "last_price_dollars": "0.9"},
        {"floor_strike": 2000, "last_price_dollars": "0.4"}]}
    rows = kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                           http_get=lambda *a, **k: FakeResponse(payload))
    assert len(rows) == 1
    assert rows[0].value == pytest.approx(1800.0)
    assert rows[0].series_code == "KXUSADATACENTERS"
    assert rows[0].obs_date == "2026-07-16"        # fetch date, standing question
    assert (rows[0].source, rows[0].route) == ("KALSHI_DC", "API")


def test_kalshi_dc_binary_probability():
    payload = {"markets": [{"last_price_dollars": "0.61"}]}
    rows = kalshi.fetch_dc(["KXDATACENTER"], vintage_date="2026-07-16",
                           http_get=lambda *a, **k: FakeResponse(payload))
    assert rows[0].value == pytest.approx(0.61)


def test_kalshi_dc_thin_book_is_skip_not_error():
    # unpriced/empty books are EXPECTED on speculative markets: skip, never
    # raise (contrast the CPI fetch, whose books are always live)
    empty = {"markets": []}
    unpriced = {"markets": [{"floor_strike": 1000, "last_price_dollars": "0"}]}
    for payload in (empty, unpriced):
        rows = kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                               http_get=lambda *a, **k: FakeResponse(payload))
        assert rows == []


def test_kalshi_dc_one_thin_ticker_does_not_drop_the_other():
    def get(url, params=None, timeout=None):
        if params["series_ticker"] == "KXUSADATACENTERS":
            return FakeResponse({"markets": []})
        return FakeResponse({"markets": [{"last_price_dollars": "0.61"}]})
    rows = kalshi.fetch_dc(["KXUSADATACENTERS", "KXDATACENTER"],
                           vintage_date="2026-07-16", http_get=get)
    assert [r.series_code for r in rows] == ["KXDATACENTER"]


def test_kalshi_dc_implausible_count_is_structure_drift():
    payload = {"markets": [
        {"floor_strike": 900000, "last_price_dollars": "0.9"},
        {"floor_strike": 990000, "last_price_dollars": "0.4"}]}
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_dc(["KXUSADATACENTERS"], vintage_date="2026-07-16",
                        http_get=lambda *a, **k: FakeResponse(payload))


def test_kalshi_dc_fixture_shapes_parse():
    # the spike-trimmed live payloads must flow through the real code path
    import json as _json
    import pathlib
    fixtures = pathlib.Path(__file__).parent / "fixtures"
    for ticker, name in (("KXUSADATACENTERS", "kalshi_dc_count.json"),
                         ("KXDATACENTER", "kalshi_dc_nuclear.json")):
        payload = _json.loads((fixtures / name).read_text())
        rows = kalshi.fetch_dc([ticker], vintage_date="2026-07-16",
                               http_get=lambda *a, **k: FakeResponse(payload))
        assert len(rows) <= 1   # priced -> one obs; thin fixture -> zero
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_phase3_connectors.py -q 2>&1 | tee <scratchpad>/task3-red.log`
Expected: new tests ERROR (`AttributeError: module … has no attribute 'fetch_dc'`); ALL existing tests pass.

- [ ] **Step 3: Implement.** In `pipeline/connectors/kalshi.py`:

(a) extract the helper — the CPI `fetch`'s lines computing `gaps`/`tail`/`values`/`masses`/`expected` (currently ~lines 60–68) become:

```python
def _expected_from_ladder(points: list[tuple[float, float]]) -> float:
    """Expected value from cumulative "Above X" binaries: prices approximate
    the survival curve P(value > strike); bucket masses are adjacent-price
    differences valued at bracket midpoints, tails extending half a typical
    bracket past each edge."""
    strikes = [s for s, _ in points]
    probs = [p for _, p in points]
    gaps = sorted(b - a for a, b in zip(strikes, strikes[1:]))
    tail = (gaps[len(gaps) // 2] if gaps else 0.1) / 2
    values = ([strikes[0] - tail]
              + [(a + b) / 2 for a, b in zip(strikes, strikes[1:])]
              + [strikes[-1] + tail])
    masses = ([1 - probs[0]]
              + [a - b for a, b in zip(probs, probs[1:])]
              + [probs[-1]])
    return sum(v * m for v, m in zip(values, masses))
```

and the CPI fetch's expected-value line becomes `expected = round(_expected_from_ladder(points), 6)` — the arithmetic moves verbatim; the CPI comment block moves onto the helper. NOTHING else in the CPI path changes.

(b) append the DC fetch + constant:

```python
COUNT_PLAUSIBLE = (0.0, 50_000.0)   # expected US data-center count


def fetch_dc(source_ids: list[str], vintage_date: str | None = None,
             http_get=None) -> list[Observation]:
    """DC context markets (KALSHI_DC isolation key — thin books must never
    fail the core CPI row). Unlike fetch(), a ticker with no priced markets
    is a SKIP, never an error: these books are speculative, absence is
    expected, and carry-forward + a render-when-present card absorb it.
    obs_date is the fetch date — standing questions, not monthly references.
    A ladder (>=2 strike markets) yields its survival-curve expected value;
    a single priced market is read as a binary probability."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out = []
    for ticker in source_ids:
        response = http_get(URL, params={"series_ticker": ticker,
                                         "status": "open", "limit": 100},
                            timeout=30)
        response.raise_for_status()
        markets = [m for m in response.json().get("markets", [])
                   if m.get("last_price_dollars") not in (None, "")
                   and float(m["last_price_dollars"]) > 0]
        if not markets:
            continue
        laddered = [m for m in markets if m.get("floor_strike") is not None]
        if len(laddered) >= 2:
            points = sorted((float(m["floor_strike"]),
                             min(float(m["last_price_dollars"]), 1.0))
                            for m in laddered)
            value = round(_expected_from_ladder(points), 2)
            if not COUNT_PLAUSIBLE[0] < value < COUNT_PLAUSIBLE[1]:
                raise ValueError(f"kalshi_dc {ticker}: expected {value} outside "
                                 f"{COUNT_PLAUSIBLE} — structure drift?")
        else:
            value = round(min(float(markets[0]["last_price_dollars"]), 1.0), 4)
        out.append(Observation(series_code=ticker, obs_date=vintage,
                               value=value, vintage_date=vintage,
                               source="KALSHI_DC", route="API"))
    return out
```

(If Task 1's spike found the live shapes differ — e.g. the count ladder is not "above X" binaries — adjust to the SPIKE-FINAL semantics and say so in your report; the spike notes outrank this listing.)

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_phase3_connectors.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task3-green.log`
Expected: all pass, existing kalshi tests untouched and green (the byte-identity pin); full suite ≥ 487.

- [ ] **Step 5: Commit**

```bash
git add pipeline/connectors/kalshi.py tests/test_phase3_connectors.py
git commit -m "feat(kalshi): extract CDF helper + thin-book-tolerant fetch_dc for DC context markets"
```

---

### Task 4: Registry + collect wiring (27 sources / 273 series)

**Files:**
- Modify: `config/series.json`, `pipeline/collect.py`, `tests/test_registry.py`, `tests/test_run_daily.py`

**Interfaces:**
- Consumes: `kalshi.fetch_dc` (Task 3); SPIKE-FINAL diesel seriesid (Task 1).
- Produces: series codes `eia_diesel`, `cpi_water`, `kalshi_dc_count`, `kalshi_dc_nuclear` collectible by the daily run. Tasks 5/8 read them from the store.

- [ ] **Step 1: Update the registry pins first (the failing test).** In `tests/test_registry.py`: add `"KALSHI_DC"` to the sources set literal (line ~11) and bump `len(series) == 269` → `273`. Run `.venv/bin/pytest tests/test_registry.py -q 2>&1 | tee <scratchpad>/task4-red.log` — expected FAIL (registry still 26/269).

- [ ] **Step 2: Registry entries.** In `config/series.json`: sources gains

```json
"KALSHI_DC": {"route": "API", "cadence": "daily"}
```

(keyless — no `secret`, matching `KALSHI`). Series list gains (diesel `source_id` VERBATIM from SPIKE-FINAL):

```json
{"code": "eia_diesel", "source": "EIA", "source_id": "<SPIKE-FINAL diesel id>", "name": "US No 2 diesel retail $/gal (weekly)", "max_staleness_days": 21},
{"code": "cpi_water", "source": "FRED", "source_id": "CUSR0000SEHG01", "name": "CPI water & sewerage (SA)", "max_staleness_days": 80},
{"code": "kalshi_dc_count", "source": "KALSHI_DC", "source_id": "KXUSADATACENTERS", "name": "Kalshi market-implied 2026 US data-center count", "max_staleness_days": 30},
{"code": "kalshi_dc_nuclear", "source": "KALSHI_DC", "source_id": "KXDATACENTER", "name": "Kalshi P(nuclear-powered DC by 2030)", "max_staleness_days": 30}
```

- [ ] **Step 3: collect.py.** Add beside `_kalshi`:

```python
def _kalshi_dc(subset, key, http):
    return kalshi.fetch_dc([s.source_id for s in subset], http_get=http)
```

and to `FETCHERS`:

```python
            # KALSHI_DC is a separate source key only for failure isolation —
            # thin speculative DC books must never fail the core KALSHI (CPI)
            # row; fetch_dc's skip semantics differ from fetch()'s by design.
            "KALSHI_DC": _kalshi_dc,
```

- [ ] **Step 4: test_run_daily fakes.** The existing Kalshi fake matches the host substring and returns the KXCPI payload for ANY ticker — the DC tickers would silently get a CPI-shaped ladder. Branch it on the `series_ticker` param (check the fake's actual signature first — it must accept/see `params`):

```python
    if "external-api.kalshi.com" in url:
        ticker = (kwargs.get("params") or {}).get("series_ticker", "")
        if ticker == "KXUSADATACENTERS":
            return FakeResponse({"markets": [
                {"floor_strike": 1000, "last_price_dollars": "0.9"},
                {"floor_strike": 2000, "last_price_dollars": "0.4"}]})
        if ticker == "KXDATACENTER":
            return FakeResponse({"markets": [{"last_price_dollars": "0.61"}]})
        return FakeResponse({"markets": [{"floor_strike": 0.2,
                                           "last_price_dollars": "1.0",
                                           "event_ticker": "KXCPI-26JUL",
                                           "close_time": "2026-08-11T00:00:00Z"}]})
```

Extend the EIA fake with a branch for the diesel seriesid (same response shape as the existing EIA weekly series it already fakes — copy that branch's pattern with 2–3 weekly rows), and confirm the FRED fake answers `CUSR0000SEHG01` generically (extend only if it whitelists ids). Then find the run_daily test that asserts collected-source results and extend it to expect the `KALSHI_DC` row ok.

- [ ] **Step 5: Run to verify green**

Run: `.venv/bin/pytest tests/test_registry.py tests/test_run_daily.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task4-green.log`
Expected: all pass; full suite count unchanged or + any new assertions.

- [ ] **Step 6: Commit**

```bash
git add config/series.json pipeline/collect.py tests/test_registry.py tests/test_run_daily.py
git commit -m "feat(registry): KALSHI_DC source + diesel/water/kalshi-dc series (27 sources / 273 series)"
```

---

### Task 5: Engine — `context_block`

**Files:**
- Modify: `pipeline/engine/dcindex.py` (append after `power_block`; add `from pipeline import dc_context` is NOT needed — cfg is passed in)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: `dc_context.ContextConfig` (Task 2), store series (Task 4 codes), `dc_result["indexes"]["build"]["yoy"]`.
- Produces: `dcindex.context_block(conn, cfg, dc_result) -> dict` — the spec-§5 shape. Task 7 publishes it verbatim; Task 8 wires it.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_dcindex.py`:

```python
from pipeline import dc_context as dc_context_mod


def _ctx_cfg(transformer=None, tnt_rows=(({"year": 2018, "escalation_pct": 4.0}),)):
    return dc_context_mod.ContextConfig(
        colo=dc_context_mod.Card(fields={"rate_kw_mo": 194.95, "yoy_pct": 6.5,
                                          "vacancy_pct": 1.4,
                                          "under_construction_gw": 6.0},
                                 asof="H2 2025", source="CBRE"),
        queue=dc_context_mod.Card(fields={"generation_gw": 1400, "storage_gw": 890},
                                  asof="2025", source="LBNL"),
        tnt_rows=tuple(tnt_rows), tnt_asof="2025", tnt_source="T&T DCCI",
        transformer=transformer)


def test_context_block_populated(tmp_path):
    conn = make_conn(tmp_path, [
        ("eia_diesel", "2026-07-13", 4.796),
        ("cpi_water", "2017-06-01", 100.0), ("cpi_water", "2018-06-01", 104.1),
        ("kalshi_dc_count", "2026-07-16", 1800.0),
        ("kalshi_dc_nuclear", "2026-07-16", 0.61),
    ])
    # a minimal dc_result: only build.yoy is read (Dec-31 lookups)
    dc_result = {"indexes": {"build": {"yoy": {"2018-12-31": 3.456}}}}
    ctx = dcindex.context_block(conn, _ctx_cfg(), dc_result)
    assert ctx["colo"] == {"rate_kw_mo": 194.95, "yoy_pct": 6.5,
                           "vacancy_pct": 1.4, "under_construction_gw": 6.0,
                           "asof": "H2 2025", "source": "CBRE"}
    assert ctx["queue"]["generation_gw"] == 1400
    assert ctx["tnt"]["rows"] == [{"year": 2018, "escalation_pct": 4.0,
                                    "build_yoy_pct": 3.46}]
    assert ctx["transformer"] is None
    assert ctx["kalshi"] == {"dc_count_expected": 1800.0, "count_asof": "2026-07-16",
                              "nuclear_by_2030_prob": 0.61,
                              "nuclear_asof": "2026-07-16"}
    assert ctx["diesel"] == {"latest": 4.8, "asof": "2026-07-13", "unit": "$/gal"}
    assert ctx["water"] == {"yoy_pct": pytest.approx(4.1), "asof": "2018-06-01"}


def test_context_block_live_subobjects_independently_null(tmp_path):
    conn = make_conn(tmp_path, [("ppi_steel", "2018-01-01", 100.0)])  # none of ours
    dc_result = {"indexes": {"build": {"yoy": {}}}}
    ctx = dcindex.context_block(conn, _ctx_cfg(), dc_result)
    assert ctx["kalshi"] is None and ctx["diesel"] is None and ctx["water"] is None
    assert ctx["colo"]["rate_kw_mo"] == 194.95      # hand-seeds unaffected
    assert ctx["tnt"]["rows"][0]["build_yoy_pct"] is None  # no Dec-31 on grid


def test_context_block_one_kalshi_series_present(tmp_path):
    conn = make_conn(tmp_path, [("kalshi_dc_nuclear", "2026-07-16", 0.61)])
    dc_result = {"indexes": {"build": {"yoy": {}}}}
    ctx = dcindex.context_block(conn, _ctx_cfg(), dc_result)
    assert ctx["kalshi"]["dc_count_expected"] is None
    assert ctx["kalshi"]["nuclear_by_2030_prob"] == 0.61


def test_context_block_water_missing_base_is_none(tmp_path):
    conn = make_conn(tmp_path, [("cpi_water", "2018-06-01", 104.1)])  # no year-ago
    dc_result = {"indexes": {"build": {"yoy": {}}}}
    ctx = dcindex.context_block(conn, _ctx_cfg(), dc_result)
    assert ctx["water"] == {"yoy_pct": None, "asof": "2018-06-01"}


def test_context_block_transformer_passthrough(tmp_path):
    conn = make_conn(tmp_path, [("ppi_steel", "2018-01-01", 100.0)])
    cfg = _ctx_cfg(transformer=dc_context_mod.Card(
        fields={"weeks": 128}, asof="2025-11", source="Wood Mackenzie"))
    ctx = dcindex.context_block(conn, cfg, {"indexes": {"build": {"yoy": {}}}})
    assert ctx["transformer"] == {"weeks": 128, "asof": "2025-11",
                                   "source": "Wood Mackenzie"}
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_dcindex.py -q 2>&1 | tee <scratchpad>/task5-red.log`
Expected: 5 new tests ERROR (`AttributeError: … no attribute 'context_block'`); existing pass.

- [ ] **Step 3: Implement** — append to `pipeline/engine/dcindex.py`:

```python
def context_block(conn: sqlite3.Connection, cfg, dc_result: dict) -> dict:
    """Demand-side context (spec §5): hand-seeded cards pass through from
    config with their asof/source; live sub-objects read the store and are
    independently nullable — a thin Kalshi book or pre-first-collect diesel
    hides its card, never blanks the section. T&T rows gain build_yoy_pct
    (Dec-31 YoY from the already-computed build index) so the site renders
    the external-calibration table without computing anything."""
    build_yoy = dc_result["indexes"]["build"]["yoy"]
    tnt_rows = []
    for r in cfg.tnt_rows:
        v = build_yoy.get(f"{r['year']}-12-31")
        tnt_rows.append({**r, "build_yoy_pct": None if v is None else round(v, 2)})

    count = _latest_row(conn, "kalshi_dc_count")
    nuclear = _latest_row(conn, "kalshi_dc_nuclear")
    kalshi = None
    if count or nuclear:
        kalshi = {"dc_count_expected": None if not count else round(count[1], 2),
                  "count_asof": None if not count else count[0],
                  "nuclear_by_2030_prob": None if not nuclear else round(nuclear[1], 4),
                  "nuclear_asof": None if not nuclear else nuclear[0]}

    diesel_row = _latest_row(conn, "eia_diesel")
    diesel = None if not diesel_row else {"latest": round(diesel_row[1], 2),
                                           "asof": diesel_row[0], "unit": "$/gal"}

    water = None
    w = _series(conn, "cpi_water")
    if w:
        last = max(w)
        filled = aggregate.fill_daily(w, GRID_START, last)
        yoy = aggregate.yoy_at_obs(w, filled).get(last)
        water = {"yoy_pct": None if yoy is None else round(yoy, 2), "asof": last}

    return {
        "colo": {**cfg.colo.fields, "asof": cfg.colo.asof, "source": cfg.colo.source},
        "queue": {**cfg.queue.fields, "asof": cfg.queue.asof, "source": cfg.queue.source},
        "tnt": {"rows": tnt_rows, "asof": cfg.tnt_asof, "source": cfg.tnt_source},
        "transformer": (None if cfg.transformer is None else
                        {**cfg.transformer.fields, "asof": cfg.transformer.asof,
                         "source": cfg.transformer.source}),
        "kalshi": kalshi,
        "diesel": diesel,
        "water": water}
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dcindex.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task5-green.log`
Expected: all pass; full suite ≥ +5.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): context_block — hand-seed passthrough + independently-nullable live cards"
```

---

### Task 6: Engine folds — freshness flag + parity levels

**Files:**
- Modify: `pipeline/engine/dcindex.py` (`run` signature + components dict; `parity_rows`)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `run(conn, today, basket_path=None, staleness=None)` — every component entry gains `"stale": bool`; `parity_rows` state rows gain `"power_cents": float` and `"wage_level": float | None`. Task 7 publishes both; Task 8 passes the staleness map.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_dcindex.py`:

```python
def test_component_stale_flag_boundary(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    # last obs 2018-01-01; today 2018-02-15 -> age 45 days
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket,
                         staleness={"ppi_steel": 45, "ppi_concrete": 44})
    b = result["indexes"]["build"]
    assert b["components"]["steel"]["stale"] is False      # age == allowance
    assert b["components"]["concrete"]["stale"] is True    # age > allowance


def test_stale_false_without_map_or_listing(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
    ] + OPS_ROWS)
    basket = write_basket(tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS)
    r1 = dcindex.run(conn, today="2030-01-01", basket_path=basket)  # no map
    assert r1["indexes"]["build"]["components"]["steel"]["stale"] is False
    r2 = dcindex.run(conn, today="2030-01-01", basket_path=basket,
                     staleness={"unrelated_series": 5})              # unlisted
    assert r2["indexes"]["build"]["components"]["steel"]["stale"] is False


def test_parity_rows_carry_raw_levels():
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={"ca": ("2026-01-01", 2000.0)},
        nat_power=("2026-05-01", 10.0), nat_wage=("2026-01-01", 1600.0),
        w_labor=0.30, w_power=0.55)
    row = out["states"][0]
    assert row["power_cents"] == pytest.approx(12.0)
    assert row["wage_level"] == pytest.approx(2000.0)


def test_parity_wage_level_null_when_quarter_mismatch():
    out = dcindex.parity_rows(
        power={"ca": ("2026-05-01", 12.0)}, wage={"ca": ("2025-10-01", 1900.0)},
        nat_power=("2026-05-01", 10.0), nat_wage=("2026-01-01", 1600.0),
        w_labor=0.30, w_power=0.55)
    row = out["states"][0]
    assert row["power_cents"] == pytest.approx(12.0)   # power side unaffected
    assert row["wage_level"] is None                    # like-for-like rule holds
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_dcindex.py -q 2>&1 | tee <scratchpad>/task6-red.log`
Expected: 4 new tests FAIL (`TypeError: run() got an unexpected keyword argument 'staleness'` / `KeyError: 'stale'` / `KeyError: 'power_cents'`).

- [ ] **Step 3: Implement.** In `pipeline/engine/dcindex.py`:

(a) add `from datetime import date` to the imports; change the signature:

```python
def run(conn: sqlite3.Connection, today: str,
        basket_path: Path | None = None,
        staleness: dict[str, int] | None = None) -> dict:
```

(b) in the components assembly loop, compute the flag and add the key (after `implied`):

```python
            allow = (staleness or {}).get(c.series)
            age = (date.fromisoformat(today) - date.fromisoformat(own_end)).days
            components[c.code] = {
                "label": c.label, "group": c.group, "weight": c.weight,
                "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "last_obs": own_end,
                "implied_level": implied,
                # freshness signal (spec §7.1): stale when the backbone's own
                # registry allowance is exceeded; False when no map/listing so
                # existing callers and tests keep current behavior
                "stale": bool(allow is not None and age > allow)}
```

(c) in `parity_rows`, extend the row dict:

```python
        row = {"state": st.upper(), "power_rel": round(power_rel, 4),
               "ops_mult": round(w_power * power_rel + (1 - w_power), 4),
               "power_asof": p_date,
               "power_cents": round(p_val, 2),
               "wage_rel": None, "build_mult": None, "wage_asof": None,
               "wage_level": None}
```

and inside the like-for-like wage branch add `row["wage_level"] = round(w[1], 2)`.

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_dcindex.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task6-green.log`
Expected: all pass (existing dcindex/parity tests unaffected — the new keys are additive); full suite ≥ +4.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): component freshness flag + raw per-state levels in parity"
```

---

### Task 7: Publisher + schema — context, groups, stale, parity levels

**Files:**
- Modify: `pipeline/publish/datacenter.py`, `schemas/datacenter.schema.json`
- Test: `tests/test_datacenter_writer.py`

**Interfaces:**
- Consumes: `context_block` output (Task 5), `stale`/`power_cents`/`wage_level` (Task 6).
- Produces: `datacenter.build(dc_result, parity_result, source_ids, construction, power, context)` — published components gain `stale`; each index gains `groups`; top level gains `context` (verbatim passthrough). Task 8 calls with the new arg; Task 9 renders.

- [ ] **Step 1: Write the failing tests.** In `tests/test_datacenter_writer.py`:

(a) update the `DC_RESULT` fixture: every component dict gains `"stale": False` except `ops`'s power component which gets `"stale": True` (exercises the passthrough).

(b) add a `CONTEXT` fixture + assertions:

```python
CONTEXT = {
    "colo": {"rate_kw_mo": 194.95, "yoy_pct": 6.5, "vacancy_pct": 1.4,
             "under_construction_gw": 6.0, "asof": "H2 2025", "source": "CBRE"},
    "queue": {"generation_gw": 1400, "storage_gw": 890, "asof": "2025", "source": "LBNL"},
    "tnt": {"rows": [{"year": 2018, "escalation_pct": 4.0, "build_yoy_pct": 3.46}],
            "asof": "2025", "source": "T&T DCCI"},
    "transformer": None,
    "kalshi": {"dc_count_expected": 1800.0, "count_asof": "2026-07-16",
               "nuclear_by_2030_prob": 0.61, "nuclear_asof": "2026-07-16"},
    "diesel": {"latest": 4.8, "asof": "2026-07-13", "unit": "$/gal"},
    "water": {"yoy_pct": 4.1, "asof": "2018-06-01"},
}
```

(c) update every `datacenter.build(...)` call in the file to pass `CONTEXT` (or `None` in the null tests) as the new sixth argument; in `test_build_publishes_from_2018_with_contributions` add:

```python
    assert payload["context"] == CONTEXT                      # verbatim passthrough
    comps = {c["code"]: c for c in payload["indexes"]["build"]["components"]}
    assert comps["steel"]["stale"] is False
    ops_comps = {c["code"]: c for c in payload["indexes"]["ops"]["components"]}
    assert ops_comps["power"]["stale"] is True
    groups = {g["group"]: g for g in payload["indexes"]["build"]["groups"]}
    # steel 0.6 w / +5.0 yoy -> 3.0 pp; copper 0.4 w / None yoy -> group sum null
    assert groups["materials"]["weight"] == pytest.approx(1.0)
    assert groups["materials"]["contribution_pp"] is None
    ops_groups = {g["group"]: g for g in payload["indexes"]["ops"]["groups"]}
    assert ops_groups["power"]["contribution_pp"] == pytest.approx(3.0)  # 1.0 x 3.0
```

(d) add a null-context test:

```python
def test_null_context_validates(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS, None, None, None)
    assert payload["context"] is None
    path = datacenter.write(payload, tmp_path, published_at="2026-07-16T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "datacenter.schema.json")
```

(e) the schema-validation test (`test_written_file_validates_against_schema`) now exercises groups/stale/context automatically via the updated fixtures.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_datacenter_writer.py -q 2>&1 | tee <scratchpad>/task7-red.log`
Expected: FAIL (`TypeError: build() takes 5 positional arguments` / missing keys).

- [ ] **Step 3: Implement.**

(a) `pipeline/publish/datacenter.py` — signature `def build(dc_result, parity_result, source_ids, construction, power, context):`; in the per-index loop, extend each published component dict with `"stale": e["stale"]`, and after the components list build the group rollup:

```python
        by_group: dict[str, dict] = {}
        for code, e in v["components"].items():
            g = by_group.setdefault(e["group"], {"group": e["group"], "weight": 0.0,
                                                  "contribution_pp": 0.0,
                                                  "_null": False})
            g["weight"] += e["weight"]
            if e["yoy_pct"] is None:
                # a single unknowable member makes the group sum unknowable —
                # never publish a silently-partial sum
                g["_null"] = True
            else:
                g["contribution_pp"] += e["weight"] * e["yoy_pct"]
        out["indexes"][name]["groups"] = [
            {"group": g["group"], "weight": round(g["weight"], 4),
             "contribution_pp": (None if g["_null"]
                                 else round(g["contribution_pp"], 2))}
            for g in by_group.values()]
```

and at the end (beside `out["power"]`): `out["context"] = context` (rounding happened in `context_block`; parity rows flow through the existing verbatim `"parity": parity_result`).

(b) `schemas/datacenter.schema.json` — all OPTIONAL (no `required` list changes anywhere):
- `indexes.additionalProperties.properties.components.items.properties` gains `"stale": {"type": "boolean"}`;
- `indexes.additionalProperties.properties` gains

```json
"groups": {"type": "array", "items": {"type": "object",
  "required": ["group", "weight", "contribution_pp"],
  "properties": {"group": {"type": "string"}, "weight": {"type": "number"},
                  "contribution_pp": {"type": ["number", "null"]}}}}
```

- `parity.properties.states.items.properties` gains `"power_cents": {"type": "number"}` and `"wage_level": {"type": ["number", "null"]}`;
- top-level `properties` gains `context` (NOT added to the top-level `required` list):

```json
"context": {"type": ["object", "null"],
  "required": ["colo", "queue", "tnt", "transformer", "kalshi", "diesel", "water"],
  "properties": {
    "colo": {"type": "object",
      "required": ["rate_kw_mo", "yoy_pct", "vacancy_pct", "under_construction_gw", "asof", "source"],
      "properties": {"rate_kw_mo": {"type": "number"}, "yoy_pct": {"type": "number"},
                      "vacancy_pct": {"type": "number"},
                      "under_construction_gw": {"type": "number"},
                      "asof": {"type": "string"}, "source": {"type": "string"}}},
    "queue": {"type": "object",
      "required": ["generation_gw", "storage_gw", "asof", "source"],
      "properties": {"generation_gw": {"type": "number"}, "storage_gw": {"type": "number"},
                      "asof": {"type": "string"}, "source": {"type": "string"}}},
    "tnt": {"type": "object", "required": ["rows", "asof", "source"],
      "properties": {"asof": {"type": "string"}, "source": {"type": "string"},
        "rows": {"type": "array", "items": {"type": "object",
          "required": ["year", "escalation_pct", "build_yoy_pct"],
          "properties": {"year": {"type": "number"},
                          "escalation_pct": {"type": "number"},
                          "build_yoy_pct": {"type": ["number", "null"]}}}}}},
    "transformer": {"type": ["object", "null"],
      "required": ["weeks", "asof", "source"],
      "properties": {"weeks": {"type": "number"}, "asof": {"type": "string"},
                      "source": {"type": "string"}}},
    "kalshi": {"type": ["object", "null"],
      "required": ["dc_count_expected", "count_asof", "nuclear_by_2030_prob", "nuclear_asof"],
      "properties": {"dc_count_expected": {"type": ["number", "null"]},
                      "count_asof": {"type": ["string", "null"]},
                      "nuclear_by_2030_prob": {"type": ["number", "null"]},
                      "nuclear_asof": {"type": ["string", "null"]}}},
    "diesel": {"type": ["object", "null"],
      "required": ["latest", "asof", "unit"],
      "properties": {"latest": {"type": "number"}, "asof": {"type": "string"},
                      "unit": {"type": "string"}}},
    "water": {"type": ["object", "null"],
      "required": ["yoy_pct", "asof"],
      "properties": {"yoy_pct": {"type": ["number", "null"]},
                      "asof": {"type": "string"}}}}}
```

- [ ] **Step 4: Verify green + deployed-document back-compat**

Run: `.venv/bin/pytest tests/test_datacenter_writer.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task7-green.log`
Then (read-only):

```bash
curl -s https://macrogauge-cloudten.vercel.app/data/datacenter.json -o <scratchpad>/prod-dc.json
.venv/bin/python -c "
import json, jsonschema
jsonschema.validate(json.load(open('<scratchpad>/prod-dc.json')),
                    json.load(open('schemas/datacenter.schema.json')))
print('prod document validates against new schema')"
```

Expected: all pass + prod validates (it has no `context`/`stale`/`groups` keys — all optional).

- [ ] **Step 5: Commit**

```bash
git add pipeline/publish/datacenter.py schemas/datacenter.schema.json tests/test_datacenter_writer.py
git commit -m "feat(dc): publish context block, group sums, stale flags, parity levels (schema-pinned, back-compat)"
```

---

### Task 8: run_daily wiring

**Files:**
- Modify: `pipeline/run_daily.py` (import + `_datacenter_phase`, ~lines 261–276)
- Test: `tests/test_run_daily.py`

**Interfaces:**
- Consumes: everything above.
- Produces: the daily run publishes a populated `context` and stale-aware components.

- [ ] **Step 1: Write the failing test** — in `tests/test_run_daily.py`, extend the end-to-end assertions on the written `datacenter.json`:

```python
    dc = json.loads((out_dir / "datacenter.json").read_text())
    assert dc["context"] is not None
    assert dc["context"]["kalshi"]["dc_count_expected"] == pytest.approx(1800.0)
    assert dc["context"]["diesel"] is not None
    assert dc["context"]["colo"]["source"]           # hand-seed provenance present
    assert all("stale" in c for c in dc["indexes"]["build"]["components"])
    assert dc["indexes"]["build"]["groups"]
```

(place them in the existing test that already inspects `datacenter.json`; follow its local variable names.)

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_run_daily.py -q 2>&1 | tee <scratchpad>/task8-red.log`
Expected: FAIL (`KeyError: 'context'` — run_daily doesn't publish it yet).

- [ ] **Step 3: Implement.** In `pipeline/run_daily.py`: add `dc_context` to the existing `from pipeline import collect, dc_power, registry, release_calendar` import; update `_datacenter_phase`:

```python
    def _datacenter_phase():
        dc_result = dcindex.run(
            conn, today=today,
            staleness={s.code: s.max_staleness_days for s in series})
        parity_result = dcindex.parity_from_store(conn)
        construction = dcindex.construction_from_store(conn, dc_result)
        power = dcindex.power_block(conn, dc_result, dc_power.load())
        context = dcindex.context_block(conn, dc_context.load(), dc_result)
        dc_path = datacenter_json.write(
            datacenter_json.build(dc_result, parity_result,
                                  {s.code: s.source_id for s in series},
                                  construction, power, context),
            args.out, published_at=published_at)
        validate.validate_file(dc_path, SCHEMAS / "datacenter.schema.json")
        print(f"published: {dc_path}")
```

- [ ] **Step 4: Run to verify green**

Run: `.venv/bin/pytest tests/test_run_daily.py -q && .venv/bin/pytest -q 2>&1 | tee <scratchpad>/task8-green.log`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/run_daily.py tests/test_run_daily.py
git commit -m "feat(dc): wire context block + staleness map into the daily publish"
```

---

### Task 9: Site — ContextPanel, stale markers, group sums, parity levels

**Files:**
- Create: `site/src/components/ContextPanel.tsx`
- Modify: `site/src/app/datacenter/page.tsx` (ComponentTable, render insert, methodology), `site/src/components/ParityTable.tsx`

**Interfaces:**
- Consumes: Task 7's published shapes. Everything renders-when-present — the current deployed data (no `context`) must render exactly as today.

- [ ] **Step 1: Create `site/src/components/ContextPanel.tsx`:**

```tsx
import { KpiCard } from "@/components/KpiCard";
import { fmtSigned } from "@/lib/format";

export type ContextData = {
  colo: { rate_kw_mo: number; yoy_pct: number; vacancy_pct: number;
          under_construction_gw: number; asof: string; source: string };
  queue: { generation_gw: number; storage_gw: number; asof: string; source: string };
  tnt: { rows: { year: number; escalation_pct: number; build_yoy_pct: number | null }[];
         asof: string; source: string };
  transformer: { weeks: number; asof: string; source: string } | null;
  kalshi: { dc_count_expected: number | null; count_asof: string | null;
            nuclear_by_2030_prob: number | null; nuclear_asof: string | null } | null;
  diesel: { latest: number; asof: string; unit: string } | null;
  water: { yoy_pct: number | null; asof: string } | null;
};

export function ContextPanel({ context }: { context: ContextData }) {
  const { colo, queue, tnt, transformer, kalshi, diesel, water } = context;
  return (
    <>
      <h2>The bigger picture <span className="subtitle">demand, scarcity & external checks</span></h2>
      <div className="kpi-row">
        <KpiCard label="Colo asking rate" value={`$${colo.rate_kw_mo.toFixed(2)}/kW-mo`}
                 context={`${fmtSigned(colo.yoy_pct)} YoY · vacancy ${colo.vacancy_pct}% · ${colo.asof}`}
                 accent="sky" />
        <KpiCard label="Grid queue" value={`${queue.generation_gw.toLocaleString()} GW`}
                 context={`+${queue.storage_gw.toLocaleString()} GW storage queued · ${queue.asof}`}
                 accent="violet" />
        {diesel && (
          <KpiCard label="Diesel (genset fuel)" value={`$${diesel.latest.toFixed(2)}/gal`}
                   context={`US retail weekly · as of ${diesel.asof}`} accent="amber" />
        )}
        {water && water.yoy_pct != null && (
          <KpiCard label="Water & sewerage CPI" value={fmtSigned(water.yoy_pct)}
                   context={`cooling input · as of ${water.asof}`} accent="emerald" />
        )}
        {transformer && (
          <KpiCard label="Transformer lead time" value={`~${transformer.weeks} wk`}
                   context={`${transformer.source} · ${transformer.asof}`} accent="red" />
        )}
      </div>
      {kalshi && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          {kalshi.dc_count_expected != null && (
            <span className="badge badge-muted">
              market-implied 2026 US data centers: ~{Math.round(kalshi.dc_count_expected).toLocaleString()} · Kalshi · {kalshi.count_asof}
            </span>
          )}
          {kalshi.nuclear_by_2030_prob != null && (
            <span className="badge badge-muted">
              nuclear-powered DC by 2030: {(kalshi.nuclear_by_2030_prob * 100).toFixed(0)}% odds · Kalshi · {kalshi.nuclear_asof}
            </span>
          )}
        </div>
      )}
      <div className="table-card">
        <table className="data-table">
          <thead><tr><th>Year</th><th>T&T $/W escalation</th><th>Our DC Build YoY</th></tr></thead>
          <tbody>
            {tnt.rows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}</td>
                <td>{fmtSigned(r.escalation_pct)}</td>
                <td>{r.build_yoy_pct != null ? fmtSigned(r.build_yoy_pct) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="method">{tnt.source} · as of {tnt.asof} — annual external calibration for a daily index.</p>
      </div>
    </>
  );
}
```

- [ ] **Step 2: `site/src/app/datacenter/page.tsx`:**
- `Comp` type gains `stale?: boolean`; `ComponentTable` props gain `groups?: { group: string; weight: number; contribution_pp: number | null }[]`.
- Last-obs cell becomes:

```tsx
        <td>{c.last_obs}{c.stale && (
          <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 11 }}>stale</span>
        )}</td>
```

- Group header cell shows the published sums when available (never computes):

```tsx
    const sums = groups ? new Map(groups.map((g) => [g.group, g])) : null;
    // …inside the header row render:
            {GROUPS[group] ?? group}
            {sums?.get(group) && (
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {" "}· {(sums.get(group)!.weight * 100).toFixed(0)}% · {fmtPp(sums.get(group)!.contribution_pp)}
              </span>
            )}
```

- The three `ComponentTable` call sites pass `groups={build.groups as never}` etc. (typed via the Comp-file types, not `never` — match the file's existing `as` idiom for imported JSON).
- After `{power && <PowerPanel …/>}` insert:

```tsx
      {dc.context && <ContextPanel context={dc.context as ContextData} />}
```

with `import { ContextPanel, type ContextData } from "@/components/ContextPanel";`.
- Methodology paragraph: append after the power-bill sentences:

```
{" "}The bigger-picture cards are context, not index inputs: colo asking rates (CBRE),
grid-queue volumes (LBNL), and the Turner &amp; Townsend cost-per-watt escalation — an
annual external calibration shown against our daily DC Build index — are hand-updated
from their cited publications and each card carries its as-of date. Kalshi odds are
market-implied probabilities from thin books, shown only when a live quote exists.
Diesel (genset fuel) and the water &amp; sewerage CPI ride the daily pipeline.
```

- [ ] **Step 3: `site/src/components/ParityTable.tsx`:** `ParityRow` gains `power_cents?: number; wage_level?: number | null`. Header row gains `<th>Power ¢/kWh</th><th>QCEW wage</th>` after "Power rel"; body rows gain:

```tsx
            <td>{r.power_cents != null ? r.power_cents.toFixed(2) : "—"}</td>
            <td>{r.wage_level != null ? `$${r.wage_level.toLocaleString()}` : "—"}</td>
```

- [ ] **Step 4: Gates** (deployed data has no `context`/`stale`/`groups` — the page must render identically to today; e2e proves it):

```bash
cd site && npx tsc --noEmit && npm run build && npm test && npm run e2e
```

Expected: tsc clean; build 25 routes; vitest 29 passed; e2e 23 passed. Tee to `<scratchpad>/task9-gates.log`.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/ContextPanel.tsx site/src/components/ParityTable.tsx site/src/app/datacenter/page.tsx
git commit -m "feat(site): bigger-picture context panel + stale markers, group sums, parity levels"
```

---

### Task 10 (CONTROLLER): live run, close-out, final review, push gate

- [ ] **Step 1: Live pipeline run** (env from `.env`):

```bash
set -a; source .env; set +a
.venv/bin/python -m pipeline.run_daily --store store --out site/public/data \
  2>&1 | tee <scratchpad>/w5-live-run.log
```

Sanity: `datacenter.json` has non-null `context` (colo/queue/tnt populated; kalshi/diesel/water populated OR null with a matching sources_status explanation — thin Kalshi books are expected); ops/build/hardware headline YoYs unchanged vs yesterday's values (context adds nothing to any index); `sources_status.json` has a `KALSHI_DC` row; component `stale` flags plausible (spot-check one: is any component actually beyond its allowance?).

- [ ] **Step 2: Full gates:** `.venv/bin/pytest -q` + site tsc/build/vitest/e2e — all green, tee'd.
- [ ] **Step 3: Docs:** CLAUDE.md test count 470 → final; the connector-count sentence is unchanged (no new module) — verify. Commit docs + data separately (`data: first context-layer publish + kalshi/diesel/water collection`).
- [ ] **Step 4: Final whole-branch review** (fable, review-package over the whole unpushed range) with the wave's minor-roll-up list; fold or log findings per triage.
- [ ] **Step 5:** `git fetch origin`, rebase over any bot commit (store JSONL union, artifacts take newer-code side), re-run gates, then **ask the user for push approval**.

---

## Self-Review (run after writing — issues found and fixed inline)

1. **Spec coverage:** §1/§3 cards+spike → Tasks 1–2; §4 series/sources + KALSHI_DC semantics → Tasks 3–4; §5 context block/schema back-compat → Tasks 5, 7; §6 page section + T&T build_yoy_pct pipeline-side → Tasks 5 (rows), 9 (render); §7 folds → Tasks 6–7, 9; §8 testing (loader rejections, CPI byte-identity pin, thin-book skip, per-sub-object null branches, stale boundary, group null-sum, deployed-doc validation, run_daily fakes, registry pins, render-with-null-context) → embedded per task; §9 risks (asof visibility, skip semantics, primary-source rule, CPI regression pin, schema back-compat) → Tasks 1, 3, 7; §10 sequencing → task order.
2. **Placeholder scan:** `<SPIKE>`/`<SPIKE-FINAL …>` markers in Tasks 2/4 are the spike's runtime outputs — deliberate, resolved by Task 1's committed notes (wave-4 precedent), not authorable now. `<scratchpad>` = the session scratchpad path in Global Constraints.
3. **Type consistency:** `ContextConfig`/`Card` fields identical across Tasks 2/5; `context_block(conn, cfg, dc_result)` matches Task 8's call; `build(..., power, context)` arity matches Tasks 7/8; published key names (`stale`, `groups`, `power_cents`, `wage_level`, `context.*`) identical across engine (5–6), publisher/schema (7), and site types (9); `fetch_dc` signature identical in Tasks 3/4.
