# /capacity — Neocloud + Hyperscaler Capacity Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An independent `/capacity` page on macrogauge — the notebook neocloud tracker reimplemented natively and expanded to hyperscalers, with hand-curated MW in `config/capacity.json` and market caps repriced daily via FMP.

**Architecture:** Hand-curated layer (`config/capacity.json`, loader `pipeline/capacity.py`) × daily FMP equity quotes (new `FMP_EQ` source, `fmp.fetch_equity`) → merged by a new publish writer (`pipeline/publish/capacity.py`, 9th isolated run_daily phase, `capacity_ok`) → `site/public/data/capacity.json` → static `/capacity` page (server shell + client view components). All derived analytics (EV, EV/MW, %energized, coverage, cohort totals, timeline quarters) are computed pipeline-side; the site renders only.

**Tech Stack:** Python 3.12 pipeline (requests-injected connectors, jsonschema, pytest), Next.js static export (React 19, TSX, inline SVG — no chart libs), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-21-capacity-tracker-design.md` — read it first; it pins every semantic decision.

## Global Constraints

- Branch: `capacity-tracker` off `main`. Commit per task. **Never push** (push = production deploy; needs explicit user approval).
- **No test ever hits the network.** Connectors take `http_get`/`http_post` fakes returning fixture data.
- Python tests: `.venv/bin/python -m pytest -q` (bare `pytest` is not on PATH in this shell).
- Site: `cd site && npm run build` must pass; e2e route table grows 25 → 26.
- `jsonschema.ValidationError` must re-raise and fail the run in every phase; all other phase errors are contained (existing `_run_phase` contract — do not alter it).
- `sources_status` publishes FIRST — do not move it.
- Role enum: `neocloud | landlord | operator | hyperscaler | exploratory`. Cohorts: **neocloud** = neocloud+landlord+operator+exploratory, **hyperscaler** = hyperscaler. Weighted MW = `op + 0.5·con + 0.25·plan`. EV = `cap + nd`. `ev_per_mw` ($M/MW) is **null** for role `hyperscaler` and for `private` rows.
- Market cap series store **$B, rounded 2dp**. Plausibility guards: `0 < px < 100_000`, `0 < cap_b < 10_000`.
- The notebook file `~/Development/notebook/public-equity/neocloud-capacity-tracker.html` is read-only source material — never modify it.
- Task 10 (research data for new companies) is **gated on user verification** — do not merge/publish new-company numbers without sign-off.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/ericwyluda/Development/macrogauge
git checkout -b capacity-tracker main
```

---

### Task 1: `fmp.fetch_equity` connector

**Files:**
- Modify: `pipeline/connectors/fmp.py`
- Create: `tests/fixtures/fmp_equity_quote.json`
- Test: `tests/test_fmp.py`

**Interfaces:**
- Produces: `fmp.fetch_equity(source_ids: list[str], api_key: str, vintage_date: str | None = None, http_get=None) -> list[Observation]`. `source_ids` are `"SYM:px"` / `"SYM:cap"` strings (these are the registry `source_id`s; `collect_all`'s id_map remaps them to `fmp_px_*`/`fmp_cap_*` codes). One batch-quote call for the unique symbols. Emits `Observation(series_code="SYM:px", value=price)` and `Observation(series_code="SYM:cap", value=marketCap/1e9 rounded 2dp)`, `source="FMP_EQ"`, `route="API"`. Implausible values and symbols missing from the response become per-item errors emitted via `warn_partial("FMP_EQ", errors)` — never an exception.

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/fmp_equity_quote.json`:

```json
[
  {"symbol": "MSFT", "price": 512.3, "marketCap": 3807000000000, "timestamp": 1783440000},
  {"symbol": "CRWV", "price": 72.91, "marketCap": 39780000000, "timestamp": 1783440000},
  {"symbol": "JUNK", "price": -3.0, "marketCap": 0, "timestamp": 1783440000}
]
```

(`1783440000` = 2026-07-07 08:00 ET — same timestamp the existing FMP fixture uses.)

- [ ] **Step 2: Write the failing tests** (append to `tests/test_fmp.py`)

```python
EQUITY_FIXTURE = Path(__file__).parent / "fixtures" / "fmp_equity_quote.json"


def fake_equity_get(url, params=None, timeout=None):
    assert "batch-quote" in url
    assert params["apikey"] == "fmp-key"
    return FakeResponse(json.loads(EQUITY_FIXTURE.read_text()))


def test_fetch_equity_emits_px_and_cap_rows():
    obs = fmp.fetch_equity(["MSFT:px", "MSFT:cap", "CRWV:cap"], "fmp-key",
                           vintage_date="2026-07-21", http_get=fake_equity_get)
    got = {(o.series_code): o.value for o in obs}
    assert got == {"MSFT:px": 512.3, "MSFT:cap": 3807.0, "CRWV:cap": 39.78}
    assert all(o.source == "FMP_EQ" and o.route == "API" for o in obs)
    assert obs[0].obs_date == "2026-07-07"


def test_fetch_equity_partial_warns_on_implausible_and_missing():
    import pytest
    from pipeline.connectors.util import PartialFetchWarning
    with pytest.warns(PartialFetchWarning) as caught:
        obs = fmp.fetch_equity(["JUNK:px", "JUNK:cap", "GONE:cap"], "fmp-key",
                               http_get=fake_equity_get)
    assert obs == []
    msg = str(caught[0].message)
    assert "JUNK:px" in msg and "JUNK:cap" in msg and "GONE" in msg


def test_fetch_equity_requests_each_symbol_once():
    calls = []

    def spy_get(url, params=None, timeout=None):
        calls.append(params["symbols"])
        return FakeResponse(json.loads(EQUITY_FIXTURE.read_text()))

    fmp.fetch_equity(["MSFT:px", "MSFT:cap"], "fmp-key", http_get=spy_get)
    assert calls == ["MSFT"]
```

- [ ] **Step 3: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_fmp.py -q`
Expected: 3 FAIL with `AttributeError: module 'pipeline.connectors.fmp' has no attribute 'fetch_equity'`

- [ ] **Step 4: Implement** (append to `pipeline/connectors/fmp.py`; add `from pipeline.connectors.util import warn_partial` to its imports)

```python
# Plausibility rails for the /capacity equity batch — a corrupted response
# (unit change, zeroed marketCap) is skipped per-item, not ingested.
PX_MAX = 100_000.0
CAP_MAX_B = 10_000.0  # $10T


def fetch_equity(source_ids: list[str], api_key: str,
                 vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """Equity price + market cap for /capacity. source_ids are "SYM:px" /
    "SYM:cap" (collect_all remaps to fmp_px_* / fmp_cap_*). Cap lands in $B.
    Implausible or missing quotes surface via warn_partial — one bad ticker
    never drops the batch."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    wanted = set(source_ids)
    symbols = sorted({sid.split(":", 1)[0] for sid in source_ids})
    resp = http_get(QUOTE_URL, params={"symbols": ",".join(symbols),
                                       "apikey": api_key}, timeout=60)
    resp.raise_for_status()
    out: list[Observation] = []
    errors: list[tuple[str, Exception]] = []
    seen: set[str] = set()
    for row in resp.json():
        sym = row.get("symbol")
        seen.add(sym)
        obs_date = datetime.fromtimestamp(
            row["timestamp"], ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
        if f"{sym}:px" in wanted:
            px = row.get("price")
            if isinstance(px, (int, float)) and 0 < px < PX_MAX:
                out.append(Observation(series_code=f"{sym}:px", obs_date=obs_date,
                                       value=float(px), vintage_date=vintage,
                                       source="FMP_EQ", route="API"))
            else:
                errors.append((f"{sym}:px", ValueError(f"implausible price {px!r}")))
        if f"{sym}:cap" in wanted:
            cap_b = (row.get("marketCap") or 0) / 1e9
            if 0 < cap_b < CAP_MAX_B:
                out.append(Observation(series_code=f"{sym}:cap", obs_date=obs_date,
                                       value=round(cap_b, 2), vintage_date=vintage,
                                       source="FMP_EQ", route="API"))
            else:
                errors.append((f"{sym}:cap",
                               ValueError(f"implausible marketCap {row.get('marketCap')!r}")))
    errors.extend((s, ValueError("no quote in batch response"))
                  for s in symbols if s not in seen)
    warn_partial("FMP_EQ", errors)
    return out
```

- [ ] **Step 5: Run tests**

Run: `.venv/bin/python -m pytest tests/test_fmp.py -q`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add pipeline/connectors/fmp.py tests/test_fmp.py tests/fixtures/fmp_equity_quote.json
git commit -m "feat(connectors): fmp.fetch_equity — px + market cap with per-item isolation"
```

---

### Task 2: Registry + collect wiring for FMP_EQ

**Files:**
- Modify: `config/series.json` (sources + 56 series)
- Modify: `pipeline/collect.py` (fetcher + FETCHERS entry)
- Test: `tests/test_run_daily.py` (fake equity quotes, source-count pin 29→30, store assertions)

**Interfaces:**
- Consumes: `fmp.fetch_equity` from Task 1.
- Produces: registry series `fmp_px_<stem>` / `fmp_cap_<stem>` with `source_id` `"<TICKER>:px"` / `"<TICKER>:cap"`, source `FMP_EQ`, for these 28 tickers (stem = lowercase ticker): CRWV, ORCL, NBIS, APLD, CORZ, GLXY, WULF, HUT, CIFR, IREN, KEEL, RIOT, BTDR, WYFI, BTBT, MARA, DOCN, AKAM, MSFT, AMZN, GOOGL, META, BABA, TCEHY, BIDU, EQIX, DLR, NVDA. Later tasks read store codes `fmp_cap_msft` etc.

- [ ] **Step 1: Add the source and series to `config/series.json`**

Add to the `"sources"` object (after `"FMP"`):

```json
"FMP_EQ": {"route": "API", "cadence": "daily", "secret": "FMP_API_KEY"}
```

Then generate the 56 series entries with this one-off (writes valid JSON back, preserving key order):

```bash
.venv/bin/python - <<'EOF'
import json
from pathlib import Path

P = Path("config/series.json")
cfg = json.loads(P.read_text())
TICKERS = [
    ("CRWV", "CoreWeave"), ("ORCL", "Oracle"), ("NBIS", "Nebius"),
    ("APLD", "Applied Digital"), ("CORZ", "Core Scientific"),
    ("GLXY", "Galaxy Digital"), ("WULF", "TeraWulf"), ("HUT", "Hut 8"),
    ("CIFR", "Cipher Mining"), ("IREN", "IREN"), ("KEEL", "Keel Infrastructure"),
    ("RIOT", "Riot Platforms"), ("BTDR", "Bitdeer"), ("WYFI", "WhiteFiber"),
    ("BTBT", "Bit Digital"), ("MARA", "MARA Holdings"), ("DOCN", "DigitalOcean"),
    ("AKAM", "Akamai"), ("MSFT", "Microsoft"), ("AMZN", "Amazon"),
    ("GOOGL", "Alphabet"), ("META", "Meta"), ("BABA", "Alibaba"),
    ("TCEHY", "Tencent"), ("BIDU", "Baidu"), ("EQIX", "Equinix"),
    ("DLR", "Digital Realty"), ("NVDA", "Nvidia"),
]
existing = {s["code"] for s in cfg["series"]}
for sym, name in TICKERS:
    stem = sym.lower()
    for kind, sid, label in (("px", f"{sym}:px", f"{name} share price $"),
                             ("cap", f"{sym}:cap", f"{name} market cap $B")):
        code = f"fmp_{kind}_{stem}"
        assert code not in existing, code
        cfg["series"].append({"code": code, "source": "FMP_EQ", "source_id": sid,
                              "name": label, "max_staleness_days": 7})
P.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
print("series now:", len(cfg["series"]))
EOF
```

Expected output: `series now: 598` (542 + 56).

- [ ] **Step 2: Wire the fetcher in `pipeline/collect.py`**

Add after `_fmp`:

```python
def _fmp_eq(subset, key, http):
    return fmp.fetch_equity([s.source_id for s in subset], key, http_get=http)
```

Add to `FETCHERS` (after the `"FMP"` entry):

```python
            # FMP_EQ is a separate source key for failure isolation and its
            # own status row — a broken equity batch (/capacity tracker) must
            # never take down the commodity-futures FMP row (or vice versa).
            "FMP_EQ": _fmp_eq,
```

- [ ] **Step 3: Extend the run_daily e2e fake (RED first)**

In `tests/test_run_daily.py`, add below `FMP_QUOTES` — realistic (px, cap $B) pairs; all 28 so the batch has no partial warnings:

```python
# Equity quotes for the FMP_EQ /capacity batch: (price $, market cap $B).
FMP_EQUITY = {
    "CRWV": (72.91, 39.78), "ORCL": (192.64, 554.0), "NBIS": (170.0, 41.2),
    "APLD": (30.0, 8.1), "CORZ": (18.0, 6.7), "GLXY": (20.0, 7.4),
    "WULF": (22.0, 8.9), "HUT": (60.0, 11.1), "CIFR": (10.0, 7.3),
    "IREN": (55.0, 12.4), "KEEL": (4.0, 2.4), "RIOT": (23.0, 7.6),
    "BTDR": (14.0, 2.9), "WYFI": (25.0, 1.0), "BTBT": (3.0, 0.6),
    "MARA": (14.0, 4.6), "DOCN": (130.0, 12.2), "AKAM": (115.0, 17.3),
    "MSFT": (505.0, 3750.0), "AMZN": (230.0, 2400.0), "GOOGL": (185.0, 2250.0),
    "META": (720.0, 1820.0), "BABA": (110.0, 262.0), "TCEHY": (62.0, 570.0),
    "BIDU": (90.0, 31.0), "EQIX": (780.0, 76.0), "DLR": (160.0, 54.0),
    "NVDA": (170.0, 4150.0),
}
```

Replace the `financialmodelingprep.com` branch of the fake with:

```python
    if "financialmodelingprep.com" in url:
        requested = (params or {}).get("symbols", "").split(",")
        rows = []
        for s in requested:
            if s in FMP_QUOTES:
                rows.append({"symbol": s, "price": FMP_QUOTES[s],
                             "timestamp": 1783440000})
            elif s in FMP_EQUITY:
                px, cap_b = FMP_EQUITY[s]
                rows.append({"symbol": s, "price": px, "marketCap": cap_b * 1e9,
                             "timestamp": 1783440000})
        return FakeResponse(rows)
```

Update the pins/assertions in the main e2e test:
- `assert len(status["sources"]) == 29` → `== 30`
- After the existing per-code FMP store assertions add:

```python
    # FMP_EQ equity batch: cap lands in $B under the remapped internal codes.
    assert vintage.latest(conn, "fmp_cap_msft")[-1][1] == pytest.approx(3750.0)
    assert vintage.latest(conn, "fmp_px_crwv")[-1][1] == pytest.approx(72.91)
    assert vintage.latest(conn, "fmp_cap_nvda")[-1][1] == pytest.approx(4150.0)
```

- [ ] **Step 4: Run the e2e**

Run: `.venv/bin/python -m pytest tests/test_run_daily.py -q`
Expected: PASS (the qa `total == 23` pin is untouched — the capacity phase doesn't exist yet). If any other test pins source counts, fix those pins in the same spirit.

- [ ] **Step 5: Full suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add config/series.json pipeline/collect.py tests/test_run_daily.py
git commit -m "feat(collect): FMP_EQ source — 28 tickers x (px,cap) for /capacity"
```

---

### Task 3: `config/capacity.json` seed + loader `pipeline/capacity.py`

**Files:**
- Create: `scripts/port_neocloud_config.py`, `config/capacity.json`, `pipeline/capacity.py`
- Test: `tests/test_capacity_config.py`

**Interfaces:**
- Produces: `pipeline.capacity.load_capacity(path: Path | None = None, registry_codes: set[str] | None = None) -> dict` (raises `ValueError` on any invariant break), constants `ROLES`, `NEOCLOUD_ROLES`, helpers `cap_series(ticker) -> str`, `px_series(ticker) -> str`. Config dict keys: `schema_version, as_of_curated, note, basis, companies, tenants, geo, geo_unmapped, geo_note`. Company keys: `t, n, role, dupe, private, valuation_b, confidence, op, con, plan, pipe, nd, ndflag, bk, flag, dom, econ, sites, src` (some optional/null).

- [ ] **Step 1: Write the port script** — `scripts/port_neocloud_config.py`:

```python
"""One-off: port the notebook tracker's embedded NEO blob into config/capacity.json.

Drops the render-time valuation snapshot (px/cap/baseline — the pipeline's job
now), re-roles ORCL benchmark -> hyperscaler, and adds the private/valuation_b/
confidence fields the /capacity spec introduces. Kept for provenance."""
import json
import re
from pathlib import Path

SRC = Path.home() / "Development/notebook/public-equity/neocloud-capacity-tracker.html"
DST = Path(__file__).parent.parent / "config" / "capacity.json"

html = SRC.read_text()
blob = json.loads(re.search(r"/\*NEO-DATA-START\*/(.*?)/\*NEO-DATA-END\*/",
                            html, re.S).group(1))

companies = []
for c in blob["companies"]:
    c = dict(c)
    c.pop("px", None)
    c.pop("cap", None)
    if c["t"] == "ORCL":
        c["role"] = "hyperscaler"
        c["dupe"] = None
    c["private"] = False
    c["valuation_b"] = None
    c["confidence"] = "filed"
    companies.append(c)

out = {"schema_version": 1,
       "as_of_curated": blob["as_of"],
       "note": blob["note"],
       "basis": blob["basis"],
       "companies": companies,
       "tenants": blob["tenants"],
       "geo": blob["geo"],
       "geo_unmapped": blob["geo_unmapped"],
       "geo_note": blob["geo_note"]}
DST.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {DST}: {len(companies)} companies, {len(out['tenants'])} tenant edges, "
      f"{len(out['geo'])} geo sites")
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/python scripts/port_neocloud_config.py`
Expected: `wrote .../config/capacity.json: 18 companies, 25 tenant edges, 49 geo sites`

Spot-check: `python3 -c "import json; d=json.load(open('config/capacity.json')); orcl=[c for c in d['companies'] if c['t']=='ORCL'][0]; print(orcl['role'], orcl['dupe'], 'px' in orcl)"` → `hyperscaler None False`

- [ ] **Step 3: Write the failing loader tests** — `tests/test_capacity_config.py`:

```python
import json
from pathlib import Path

import pytest

from pipeline import capacity


def test_real_config_loads_and_orcl_is_hyperscaler():
    cfg = capacity.load_capacity()
    assert len(cfg["companies"]) == 18
    orcl = next(c for c in cfg["companies"] if c["t"] == "ORCL")
    assert orcl["role"] == "hyperscaler" and orcl["dupe"] is None
    assert all("px" not in c and "cap" not in c for c in cfg["companies"])


def _mini(tmp_path, **overrides):
    base = {"schema_version": 1, "as_of_curated": "2026-07-21", "note": "n",
            "basis": {}, "tenants": [], "geo": [], "geo_unmapped": [],
            "geo_note": "g",
            "companies": [{"t": "AAA", "n": "Aaa", "role": "neocloud",
                           "dupe": None, "private": False, "valuation_b": None,
                           "confidence": "filed", "op": 1, "con": 2, "plan": 3,
                           "nd": 0.5, "bk": None, "econ": {}, "sites": [],
                           "src": []}]}
    base.update(overrides)
    p = tmp_path / "capacity.json"
    p.write_text(json.dumps(base))
    return p


def test_duplicate_ticker_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"].append(dict(cfg["companies"][0]))
    p = tmp_path / "dup.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="duplicate"):
        capacity.load_capacity(p)


def test_bad_role_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["role"] = "benchmark"  # retired role
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="role"):
        capacity.load_capacity(p)


def test_negative_mw_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["op"] = -5
    p = tmp_path / "neg.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="op"):
        capacity.load_capacity(p)


def test_private_without_valuation_raises(tmp_path):
    cfg = json.loads(_mini(tmp_path).read_text())
    cfg["companies"][0]["private"] = True
    p = tmp_path / "priv.json"
    p.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="valuation_b"):
        capacity.load_capacity(p)


def test_unknown_tenant_or_geo_ticker_raises(tmp_path):
    p = _mini(tmp_path, tenants=[["Someone", "ZZZ", 100, "terms"]])
    with pytest.raises(ValueError, match="ZZZ"):
        capacity.load_capacity(p)


def test_registry_cross_check(tmp_path):
    p = _mini(tmp_path)
    with pytest.raises(ValueError, match="fmp_cap"):
        capacity.load_capacity(p, registry_codes={"something_else"})
    capacity.load_capacity(p, registry_codes={"fmp_cap_aaa", "fmp_px_aaa"})


def test_real_config_passes_registry_cross_check():
    from pipeline import registry
    _, series = registry.load_registry()
    capacity.load_capacity(registry_codes={s.code for s in series})
```

- [ ] **Step 4: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_capacity_config.py -q`
Expected: FAIL with `ModuleNotFoundError`/`ImportError` (no `pipeline.capacity`).

- [ ] **Step 5: Implement** — `pipeline/capacity.py`:

```python
"""Capacity tracker config — the hand-curated MW layer for /capacity.

MW numbers are curated from filings (no API exists for them); the daily FMP_EQ
batch reprices the valuation side. Spec:
docs/superpowers/specs/2026-07-21-capacity-tracker-design.md."""
import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "capacity.json"

ROLES = {"neocloud", "landlord", "operator", "hyperscaler", "exploratory"}
# Cohort split for the page's toggle: everything non-hyperscaler is the
# sellable-MW cohort the original tracker covered.
NEOCLOUD_ROLES = {"neocloud", "landlord", "operator", "exploratory"}


def cap_series(ticker: str) -> str:
    return f"fmp_cap_{ticker.lower()}"


def px_series(ticker: str) -> str:
    return f"fmp_px_{ticker.lower()}"


def load_capacity(path: Path | None = None,
                  registry_codes: set[str] | None = None) -> dict:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    comps = raw["companies"]
    tickers = [c["t"] for c in comps]
    dupes = {t for t in tickers if tickers.count(t) > 1}
    if dupes:
        raise ValueError(f"duplicate capacity tickers: {sorted(dupes)}")
    for c in comps:
        if c["role"] not in ROLES:
            raise ValueError(f"{c['t']}: unknown role {c['role']!r}")
        for k in ("op", "con", "plan"):
            v = c[k]
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
                raise ValueError(f"{c['t']}: {k} must be a non-negative number, got {v!r}")
        if c["private"] and not c.get("valuation_b"):
            raise ValueError(f"{c['t']}: private row requires valuation_b")
        if c.get("confidence") not in ("filed", "estimate"):
            raise ValueError(f"{c['t']}: confidence must be filed|estimate")
    known = set(tickers)
    for tn in raw["tenants"]:
        if tn[1] not in known:
            raise ValueError(f"tenants references unknown ticker {tn[1]}")
    for g in list(raw["geo"]) + list(raw["geo_unmapped"]):
        if g["t"] not in known:
            raise ValueError(f"geo references unknown ticker {g['t']}")
    if registry_codes is not None:
        missing = [c["t"] for c in comps if not c["private"]
                   and cap_series(c["t"]) not in registry_codes]
        if missing:
            raise ValueError(f"no fmp_cap_* series registered for: {missing}")
    return raw
```

- [ ] **Step 6: Run tests**

Run: `.venv/bin/python -m pytest tests/test_capacity_config.py -q`
Expected: all PASS (the registry cross-check test passes because Task 2 registered all 18 ported tickers).

- [ ] **Step 7: Commit**

```bash
git add scripts/port_neocloud_config.py config/capacity.json pipeline/capacity.py tests/test_capacity_config.py
git commit -m "feat(capacity): hand-curated config ported from notebook tracker + validating loader"
```

---

### Task 4: Publisher `pipeline/publish/capacity.py` + schema

**Files:**
- Create: `pipeline/publish/capacity.py`, `schemas/capacity.schema.json`
- Test: `tests/test_capacity_writer.py`

**Interfaces:**
- Consumes: `vintage.latest(conn, code) -> list[(obs_date, value)]`, `pipeline.capacity.{cap_series, px_series}`, config dict from Task 3, `pipeline.publish.util.write_json`.
- Produces: `build(conn, cfg) -> dict`, `write(payload, out_dir: Path, published_at: str) -> Path` (writes `capacity.json`), `parse_quarter(when: str | None) -> int | None` (quarter ordinal `year*4 + q-1`), `_quarter_label(o) -> "2026Q3"`. Payload shape (all consumed by Task 6+ site types):

```jsonc
{
  "published_at": "...", "as_of_curated": "...", "priced_date": "..."|null,
  "note": "...", "basis": {...},
  "companies": [{ ...config fields..., "cap": num|null, "px": num|null,
    "priced_date": str|null, "stale": bool, "ev": num|null, "wmw": num,
    "ev_per_mw": num|null, "pct_energized": num|null, "coverage": num|null }],
  "cohorts": {"all"|"neocloud"|"hyperscaler": {"companies": n, "op": mw, "con": mw, "plan": mw}},
  "timeline": {"all"|"neocloud"|"hyperscaler": {"base_mw": n,
    "points": [{"q": "2026Q3", "add_mw": n, "cum_mw": n}],
    "milestones": {"2026Q3": [["CRWV", "site", mw], ...]}}},
  "tenants": [...], "geo": [...], "geo_unmapped": [...], "geo_note": "...",
  "reference": {"nvda_cap_b": num|null, "cohort_ev_b": num|null}
}
```

- [ ] **Step 1: Write the failing tests** — `tests/test_capacity_writer.py`:

```python
import json
from pathlib import Path

import jsonschema
import pytest

from pipeline.models import Observation
from pipeline.publish import capacity as writer
from pipeline.store import vintage

SCHEMA = json.loads((Path(__file__).parent.parent / "schemas"
                     / "capacity.schema.json").read_text())


def _cfg(companies):
    return {"schema_version": 1, "as_of_curated": "2026-07-21", "note": "n",
            "basis": {"ev": "cap + net debt"}, "companies": companies,
            "tenants": [], "geo": [], "geo_unmapped": [], "geo_note": "g"}


def _co(**kw):
    base = {"t": "AAA", "n": "Aaa Corp", "role": "neocloud", "dupe": None,
            "private": False, "valuation_b": None, "confidence": "filed",
            "op": 100, "con": 200, "plan": 400, "pipe": None, "nd": 10.0,
            "ndflag": None, "bk": 50.0, "flag": None, "dom": None,
            "econ": {}, "sites": [], "src": []}
    base.update(kw)
    return base


def _conn(tmp_path, rows):
    tmp_path.mkdir(parents=True, exist_ok=True)  # empty-store case
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2026-07-21", source="FMP_EQ", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_public_row_derived_math(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0),
                            ("fmp_px_aaa", "2026-07-20", 12.5)])
    out = writer.build(conn, _cfg([_co()]))
    row = out["companies"][0]
    assert row["cap"] == 90.0 and row["px"] == 12.5
    assert row["priced_date"] == "2026-07-20" and row["stale"] is False
    assert row["ev"] == 100.0                      # 90 + 10 nd
    assert row["wmw"] == 300.0                     # 100 + 0.5*200 + 0.25*400
    assert row["ev_per_mw"] == pytest.approx(333.3)  # 100*1000/300, $M/MW 1dp
    assert row["pct_energized"] == pytest.approx(14.3)  # 100/700
    assert row["coverage"] == 0.5                  # 50/100
    assert out["priced_date"] == "2026-07-20"


def test_hyperscaler_and_private_suppress_ev_per_mw(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_hhh", "2026-07-20", 3000.0)])
    cfg = _cfg([_co(t="HHH", role="hyperscaler"),
                _co(t="PPP", private=True, valuation_b=200.0)])
    rows = {r["t"]: r for r in writer.build(conn, cfg)["companies"]}
    assert rows["HHH"]["ev"] == 3010.0 and rows["HHH"]["ev_per_mw"] is None
    assert rows["PPP"]["cap"] is None and rows["PPP"]["ev"] is None
    assert rows["PPP"]["ev_per_mw"] is None
    assert rows["PPP"]["valuation_b"] == 200.0
    assert rows["PPP"]["stale"] is False           # private is never "stale"


def test_missing_cap_degrades_not_drops(tmp_path):
    conn = _conn(tmp_path, [])
    row = writer.build(conn, _cfg([_co()]))["companies"][0]
    assert row["cap"] is None and row["stale"] is True
    assert row["ev"] is None and row["ev_per_mw"] is None and row["coverage"] is None
    assert row["pct_energized"] is not None        # MW math never needs a quote


def test_cohort_totals_dedupe_and_split(tmp_path):
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(t="AAA", op=100, con=0, plan=0),
                _co(t="BBB", op=50, con=0, plan=0, dupe="tenant"),
                _co(t="HHH", op=900, con=0, plan=0, role="hyperscaler")])
    cohorts = writer.build(conn, cfg)["cohorts"]
    assert cohorts["neocloud"] == {"companies": 2, "op": 100, "con": 0, "plan": 0}
    assert cohorts["hyperscaler"] == {"companies": 1, "op": 900, "con": 0, "plan": 0}
    assert cohorts["all"] == {"companies": 3, "op": 1000, "con": 0, "plan": 0}


@pytest.mark.parametrize("when,expected", [
    ("Q3 2026", 2026 * 4 + 2),
    ("phased from 2026", 2026 * 4 + 3),      # bare year -> Q4
    ("early 2027", 2027 * 4 + 0),
    ("majority H2 2026 (Sep)", 2026 * 4 + 2),
    ("mid-2026", 2026 * 4 + 1),
    ("operating", None),
    (None, None),
])
def test_parse_quarter(when, expected):
    assert writer.parse_quarter(when) == expected


def test_timeline_cumulative_from_construction_sites(tmp_path):
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(op=100, sites=[["S1", 50, "c", "Q3 2026"],
                                   ["S2", 30, "c", "Q3 2026"],
                                   ["S3", 20, "c", "2027 Q1"],
                                   ["S4", 99, "p", "Q3 2026"],      # planned: excluded
                                   ["S5", 99, "c", "undated"]])])   # unparseable: excluded
    tl = writer.build(conn, cfg)["timeline"]["all"]
    assert tl["base_mw"] == 100
    assert tl["points"][0] == {"q": "2026Q2", "add_mw": 0, "cum_mw": 100}
    qmap = {p["q"]: p for p in tl["points"]}
    assert qmap["2026Q3"]["add_mw"] == 80 and qmap["2026Q3"]["cum_mw"] == 180
    assert qmap["2027Q1"]["cum_mw"] == 200
    assert tl["milestones"]["2026Q3"] == [["AAA", "S1", 50], ["AAA", "S2", 30]]


def test_reference_block(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_nvda", "2026-07-20", 4150.0),
                            ("fmp_cap_aaa", "2026-07-20", 90.0)])
    out = writer.build(conn, _cfg([_co()]))
    assert out["reference"] == {"nvda_cap_b": 4150.0, "cohort_ev_b": 100.0}


def test_write_validates_against_schema(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0)])
    payload = writer.build(conn, _cfg([_co()]))
    path = writer.write(payload, tmp_path, "2026-07-21T12:00:00Z")
    jsonschema.validate(json.loads(path.read_text()), SCHEMA)
    # degraded payload (empty store) must validate too
    conn2 = _conn(tmp_path / "empty", [])
    p2 = writer.write(writer.build(conn2, _cfg([_co()])), tmp_path, "2026-07-21T12:00:00Z")
    jsonschema.validate(json.loads(p2.read_text()), SCHEMA)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_capacity_writer.py -q`
Expected: FAIL — `ImportError` (no `pipeline.publish.capacity`, no schema file).

- [ ] **Step 3: Implement the writer** — `pipeline/publish/capacity.py`:

```python
"""Writer for capacity.json — the /capacity AI-megawatts tracker.

Hand-curated MW layer (config/capacity.json) x daily FMP_EQ market caps from
the store. ALL derived analytics live here (the site renders only): EV = cap +
net debt; weighted MW = op + 0.5*con + 0.25*plan; EV/MW in $M/MW — published
null for hyperscaler-role and private rows where a conglomerate EV over an
AI-DC slice would mislead; %energized; coverage = backlog / EV. The notebook
tracker's render-time quarter parsing (energization timeline) is ported here.
A missing quote degrades the row (cap null, stale true) — never drops it."""
import re
from pathlib import Path

from pipeline.capacity import cap_series, px_series
from pipeline.publish.util import write_json
from pipeline.store import vintage

_YEAR = re.compile(r"20(2[5-9])")


def parse_quarter(when: str | None) -> int | None:
    """Site 'when' string -> quarter ordinal (year*4 + q-1), None if undated.
    Semantics ported verbatim from the notebook tracker's parseQ()."""
    s = (when or "").lower()
    m = _YEAR.search(s)
    if not m:
        return None
    year = int("20" + m.group(1))
    if re.search(r"q1|jan|feb|march|\bmar\b|early", s):
        q = 1
    elif re.search(r"q2|apr|may|jun|mid-?2|midyear|mid ", s):
        q = 2
    elif re.search(r"q3|jul|aug|sep", s):
        q = 3
    else:
        q = 4
    return year * 4 + (q - 1)


def _quarter_label(o: int) -> str:
    return f"{o // 4}Q{o % 4 + 1}"


def _latest(conn, code):
    rows = vintage.latest(conn, code)
    return (rows[-1][0], rows[-1][1]) if rows else (None, None)


_PASSTHROUGH = ("t", "n", "role", "dupe", "private", "confidence", "flag",
                "dom", "pipe", "op", "con", "plan", "nd", "ndflag", "bk",
                "valuation_b", "econ", "sites", "src")


def _company_row(conn, c: dict) -> dict:
    private = c["private"]
    cap_date = cap = px = None
    if not private:
        cap_date, cap = _latest(conn, cap_series(c["t"]))
        _, px = _latest(conn, px_series(c["t"]))
    total = c["op"] + c["con"] + c["plan"]
    wmw = c["op"] + 0.5 * c["con"] + 0.25 * c["plan"]
    ev = round(cap + (c.get("nd") or 0), 2) if cap is not None else None
    suppress = private or c["role"] == "hyperscaler"
    return {**{k: c.get(k) for k in _PASSTHROUGH},
            "cap": round(cap, 2) if cap is not None else None,
            "px": px, "priced_date": cap_date,
            "stale": not private and cap is None,
            "ev": ev, "wmw": round(wmw, 1),
            "ev_per_mw": (round(ev * 1000 / wmw, 1)
                          if ev is not None and wmw > 0 and not suppress else None),
            "pct_energized": round(100 * c["op"] / total, 1) if total > 0 else None,
            "coverage": round(c["bk"] / ev, 2) if c.get("bk") and ev else None}


def _cohort(row: dict) -> str:
    return "hyperscaler" if row["role"] == "hyperscaler" else "neocloud"


def _totals(rows: list[dict]) -> dict:
    live = [r for r in rows if r["dupe"] is None]
    return {"companies": len(rows),
            "op": sum(r["op"] for r in live),
            "con": sum(r["con"] for r in live),
            "plan": sum(r["plan"] for r in live)}


# The original tracker's timeline window opens at 2026Q2; earlier or undated
# construction sites fold into the operational base rather than the curve.
_QMIN = 2026 * 4 + 1


def _timeline(rows: list[dict]) -> dict:
    live = [r for r in rows if r["dupe"] is None]
    base = sum(r["op"] for r in live)
    adds: dict[int, float] = {}
    miles: dict[int, list] = {}
    for r in live:
        for name, mw, st, when in r["sites"]:
            if st != "c" or not mw:
                continue
            o = parse_quarter(when)
            if o is None or o < _QMIN:
                continue
            adds[o] = adds.get(o, 0) + mw
            miles.setdefault(o, []).append([r["t"], name, mw])
    if not adds:
        return {"base_mw": base, "points": [], "milestones": {}}
    points, cum = [], base
    for o in range(_QMIN, max(adds) + 1):
        cum += adds.get(o, 0)
        points.append({"q": _quarter_label(o), "add_mw": adds.get(o, 0),
                       "cum_mw": cum})
    return {"base_mw": base, "points": points,
            "milestones": {_quarter_label(o): m for o, m in sorted(miles.items())}}


def build(conn, cfg: dict) -> dict:
    rows = [_company_row(conn, c) for c in cfg["companies"]]
    neo = [r for r in rows if _cohort(r) == "neocloud"]
    hyp = [r for r in rows if _cohort(r) == "hyperscaler"]
    priced = [r["priced_date"] for r in rows if r["priced_date"]]
    _, nvda_cap = _latest(conn, "fmp_cap_nvda")
    evs = [r["ev"] for r in rows if r["ev"] is not None and r["dupe"] is None]
    return {"as_of_curated": cfg["as_of_curated"],
            "priced_date": max(priced) if priced else None,
            "note": cfg["note"], "basis": cfg["basis"],
            "companies": rows,
            "cohorts": {"all": _totals(rows), "neocloud": _totals(neo),
                        "hyperscaler": _totals(hyp)},
            "timeline": {"all": _timeline(rows), "neocloud": _timeline(neo),
                         "hyperscaler": _timeline(hyp)},
            "tenants": cfg["tenants"], "geo": cfg["geo"],
            "geo_unmapped": cfg["geo_unmapped"], "geo_note": cfg["geo_note"],
            "reference": {"nvda_cap_b": round(nvda_cap, 1) if nvda_cap is not None else None,
                          "cohort_ev_b": round(sum(evs), 1) if evs else None}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "capacity.json")
```

- [ ] **Step 4: Write the schema** — `schemas/capacity.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "capacity.json — /capacity AI-megawatts tracker",
  "type": "object",
  "required": ["published_at", "as_of_curated", "priced_date", "note", "basis",
               "companies", "cohorts", "timeline", "tenants", "geo",
               "geo_unmapped", "geo_note", "reference"],
  "properties": {
    "published_at": {"type": "string"},
    "as_of_curated": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
    "priced_date": {"type": ["string", "null"]},
    "note": {"type": "string"},
    "basis": {"type": "object"},
    "companies": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["t", "n", "role", "dupe", "private", "confidence",
                     "op", "con", "plan", "cap", "px", "priced_date", "stale",
                     "ev", "wmw", "ev_per_mw", "pct_energized", "coverage",
                     "valuation_b", "sites", "src"],
        "properties": {
          "t": {"type": "string"},
          "n": {"type": "string"},
          "role": {"enum": ["neocloud", "landlord", "operator",
                            "hyperscaler", "exploratory"]},
          "dupe": {"type": ["string", "null"]},
          "private": {"type": "boolean"},
          "confidence": {"enum": ["filed", "estimate"]},
          "op": {"type": "number", "minimum": 0},
          "con": {"type": "number", "minimum": 0},
          "plan": {"type": "number", "minimum": 0},
          "cap": {"type": ["number", "null"]},
          "px": {"type": ["number", "null"]},
          "priced_date": {"type": ["string", "null"]},
          "stale": {"type": "boolean"},
          "ev": {"type": ["number", "null"]},
          "wmw": {"type": "number", "minimum": 0},
          "ev_per_mw": {"type": ["number", "null"]},
          "pct_energized": {"type": ["number", "null"]},
          "coverage": {"type": ["number", "null"]},
          "valuation_b": {"type": ["number", "null"]},
          "nd": {"type": ["number", "null"]},
          "bk": {"type": ["number", "null"]},
          "sites": {"type": "array"},
          "src": {"type": "array"}
        }
      }
    },
    "cohorts": {
      "type": "object",
      "required": ["all", "neocloud", "hyperscaler"],
      "additionalProperties": {
        "type": "object",
        "required": ["companies", "op", "con", "plan"],
        "properties": {"companies": {"type": "integer", "minimum": 0},
                       "op": {"type": "number"}, "con": {"type": "number"},
                       "plan": {"type": "number"}}
      }
    },
    "timeline": {
      "type": "object",
      "required": ["all", "neocloud", "hyperscaler"],
      "additionalProperties": {
        "type": "object",
        "required": ["base_mw", "points", "milestones"],
        "properties": {
          "base_mw": {"type": "number"},
          "points": {"type": "array", "items": {
            "type": "object",
            "required": ["q", "add_mw", "cum_mw"],
            "properties": {"q": {"type": "string", "pattern": "^\\d{4}Q[1-4]$"},
                           "add_mw": {"type": "number"},
                           "cum_mw": {"type": "number"}}}},
          "milestones": {"type": "object"}
        }
      }
    },
    "tenants": {"type": "array"},
    "geo": {"type": "array", "items": {
      "type": "object",
      "required": ["t", "site", "mw", "st", "lat", "lng", "approx"],
      "properties": {"lat": {"type": "number"}, "lng": {"type": "number"},
                     "approx": {"type": "boolean"}}}},
    "geo_unmapped": {"type": "array"},
    "geo_note": {"type": "string"},
    "reference": {
      "type": "object",
      "required": ["nvda_cap_b", "cohort_ev_b"],
      "properties": {"nvda_cap_b": {"type": ["number", "null"]},
                     "cohort_ev_b": {"type": ["number", "null"]}}
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `.venv/bin/python -m pytest tests/test_capacity_writer.py -q`
Expected: all PASS.

- [ ] **Step 6: Full suite + commit**

Run: `.venv/bin/python -m pytest -q` — all PASS.

```bash
git add pipeline/publish/capacity.py schemas/capacity.schema.json tests/test_capacity_writer.py
git commit -m "feat(publish): capacity.json writer — derived valuation math, cohorts, timeline, schema"
```

---

### Task 5: run_daily 9th phase + qa wiring + seed artifact

**Files:**
- Modify: `pipeline/run_daily.py`, `pipeline/publish/qa.py`
- Modify: `tests/test_run_daily.py` (qa total 23→24, capacity.json artifact assertions), `tests/test_qa.py` (only if a count is hard-pinned)
- Create (generated): `site/public/data/capacity.json`

**Interfaces:**
- Consumes: `capacity_cfg.load_capacity(registry_codes=...)` (Task 3), `capacity_json.build/write` (Task 4).
- Produces: `capacity` entry in `qa.PHASES` (check name `capacity_ok`), CAPACITY phase in run_daily, seed `site/public/data/capacity.json` for the site build.

- [ ] **Step 1: RED — extend the e2e expectations first**

In `tests/test_run_daily.py`:
- Add `"capacity.json"` to the published-artifact existence list.
- `assert qa["total"] == 23` → `== 24`.
- After the datacenter assertions add:

```python
    capacity = json.loads((out / "capacity.json").read_text())
    assert len(capacity["companies"]) == 18
    crwv = next(c for c in capacity["companies"] if c["t"] == "CRWV")
    # fake FMP_EQ cap (39.78) + config nd flows through to EV
    assert crwv["cap"] == pytest.approx(39.78)
    assert crwv["ev"] == pytest.approx(39.78 + crwv["nd"])
    orcl = next(c for c in capacity["companies"] if c["t"] == "ORCL")
    assert orcl["role"] == "hyperscaler" and orcl["ev_per_mw"] is None
    assert checks["capacity_ok"]["pass"] is True
```

(Place after the line defining `checks = {c["name"]: c for c in qa["checks"]}` — move that line earlier if needed.)

Run: `.venv/bin/python -m pytest tests/test_run_daily.py -q` — expected FAIL (no capacity.json, total 23).

- [ ] **Step 2: Wire qa.py**

In `pipeline/publish/qa.py`:

```python
PHASES = ("nowcast", "outlook", "composites", "datacenter", "geography",
          "labor", "commodities", "capacity")
```

and add to `_PHASE_DONE`:

```python
               "capacity": "capacity tracker completed"}
```

- [ ] **Step 3: Wire run_daily.py**

Imports: add `capacity as capacity_cfg` to the `from pipeline import ...` line, and `capacity as capacity_json` inside the `from pipeline.publish import (...)` list (alphabetical: before `commodities`).

After the `_commodities_phase` block:

```python
    # AI capacity tracker (/capacity page): isolated like the phases above —
    # hand-curated MW config x daily FMP_EQ market caps; a bad config edit or
    # a missing quote must never touch the core gauge.
    def _capacity_phase():
        cap_cfg = capacity_cfg.load_capacity(
            registry_codes={s.code for s in series})
        cap_path = capacity_json.write(capacity_json.build(conn, cap_cfg),
                                       args.out, published_at=published_at)
        validate.validate_file(cap_path, SCHEMAS / "capacity.schema.json")
        print(f"published: {cap_path}")

    _run_phase("CAPACITY", _capacity_phase, phase_errors, "capacity")
```

Update the module docstring: "Eight independently isolated phases" → "Nine", and append `, and (9) the AI capacity tracker (capacity_ok)` to the phase list sentence.

- [ ] **Step 4: Run the suites**

Run: `.venv/bin/python -m pytest tests/test_run_daily.py tests/test_qa.py -q`
Expected: PASS (test_qa derives from `qa.PHASES`; if any test hard-pins the phase count or total, update the pin — e.g. the comment "the 7 qa.PHASES checks" is just a comment; a `total` assertion would move by +1).

Then full suite: `.venv/bin/python -m pytest -q` — all PASS.

- [ ] **Step 5: Seed the equity store rows (live, optional) and verify FMP tickers**

If `FMP_API_KEY` is set in the environment, do the one-time live pull — this is also the spec's ticker-verification step (TCEHY/KEEL/WYFI/BTDR/BABA may not resolve on FMP):

```bash
.venv/bin/python - <<'EOF' 2>&1 | tee /tmp/fmp_eq_verify.txt
import os, warnings
from dataclasses import replace
from pathlib import Path
from pipeline import registry
from pipeline.connectors import fmp
from pipeline.connectors.util import PartialFetchWarning
from pipeline.store import vintage

_, series = registry.load_registry()
eq = [s for s in series if s.source == "FMP_EQ"]
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always", PartialFetchWarning)
    obs = fmp.fetch_equity([s.source_id for s in eq], os.environ["FMP_API_KEY"])
id_map = {s.source_id: s.code for s in eq}
obs = [replace(o, series_code=id_map[o.series_code]) for o in obs]
print("fetched:", len(obs), "obs; new rows:", vintage.append(obs, Path("store")))
for w in caught:
    print("PARTIAL:", w.message)
EOF
```

**If any ticker reports `no quote in batch response`:** report it to the user; per spec the fallback is hand-entered `valuation_b` + treating the row like a private one (do NOT silently drop — flag it for the Task 10 research pass). If `FMP_API_KEY` is not set, skip this step — the artifact seeds with null caps and the next bot run fills them.

- [ ] **Step 6: Generate the seed artifact**

```bash
.venv/bin/python - <<'EOF'
from datetime import datetime, timezone
from pathlib import Path
from pipeline import capacity as capacity_cfg, registry
from pipeline.publish import capacity as capacity_json, validate
from pipeline.store import vintage

_, series = registry.load_registry()
conn = vintage.load(Path("store"))
cfg = capacity_cfg.load_capacity(registry_codes={s.code for s in series})
stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
p = capacity_json.write(capacity_json.build(conn, cfg), Path("site/public/data"), stamp)
validate.validate_file(p, Path("schemas") / "capacity.schema.json")
print("wrote", p)
EOF
```

Expected: `wrote site/public/data/capacity.json` (schema-valid).

- [ ] **Step 7: Commit**

```bash
git add pipeline/run_daily.py pipeline/publish/qa.py tests/test_run_daily.py tests/test_qa.py site/public/data/capacity.json store
git commit -m "feat(run_daily): 9th isolated phase — capacity tracker (capacity_ok) + seed artifact"
```

(Include `store/` only if Step 5 appended live rows.)

---

### Task 6: Site — types, page shell, client state, capacity-bars view

**Files:**
- Modify: `site/src/lib/types.ts`
- Create: `site/src/app/capacity/page.tsx`, `site/src/components/capacity/CapacityClient.tsx`, `site/src/components/capacity/CapacityBars.tsx`

**Interfaces:**
- Consumes: `capacity.json` payload (Task 4 shape), existing `KpiCard`, `fmtSigned`/`fmtDay` from `@/lib/format`.
- Produces: types `Capacity`, `CapacityCompany`, `CapacityTimeline`, `Cohort`; `cohortOf(c)` helper; `<CapacityClient data={Capacity}>` owning `{tab, cohort, query, sort}` state; view components receive `rows: CapacityCompany[]` already cohort-filtered/searched/sorted (bars) and `data: Capacity` + `cohort: Cohort` (other views, Tasks 7–8).

- [ ] **Step 1: Add types** (append to `site/src/lib/types.ts`)

```ts
export type CapacityCompany = {
  t: string; n: string; role: "neocloud" | "landlord" | "operator" | "hyperscaler" | "exploratory";
  dupe: string | null; private: boolean; confidence: "filed" | "estimate";
  flag?: string | null; dom?: string | null; pipe?: string | null;
  op: number; con: number; plan: number;
  nd?: number | null; ndflag?: string | null; bk?: number | null;
  valuation_b: number | null;
  cap: number | null; px: number | null; priced_date: string | null; stale: boolean;
  ev: number | null; wmw: number; ev_per_mw: number | null;
  pct_energized: number | null; coverage: number | null;
  econ: Record<string, string> | null;
  sites: [string, number | null, string, string][];
  src: [string, string][];
};

export type CapacityTimeline = {
  base_mw: number;
  points: { q: string; add_mw: number; cum_mw: number }[];
  milestones: Record<string, [string, string, number][]>;
};

export type CapacityCohortKey = "all" | "neocloud" | "hyperscaler";

export type Capacity = {
  published_at: string; as_of_curated: string; priced_date: string | null;
  note: string; basis: Record<string, string>;
  companies: CapacityCompany[];
  cohorts: Record<CapacityCohortKey, { companies: number; op: number; con: number; plan: number }>;
  timeline: Record<CapacityCohortKey, CapacityTimeline>;
  tenants: [string, string, number, string][];
  geo: { t: string; site: string; mw: number; st: string; lat: number; lng: number; when?: string; approx: boolean }[];
  geo_unmapped: { t: string; site: string; mw: number; st: string; why: string }[];
  geo_note: string;
  reference: { nvda_cap_b: number | null; cohort_ev_b: number | null };
};
```

- [ ] **Step 2: Page shell** — `site/src/app/capacity/page.tsx`:

```tsx
import type { Metadata } from "next";
import capacityJson from "../../../public/data/capacity.json";
import { KpiCard } from "@/components/KpiCard";
import { CapacityClient } from "@/components/capacity/CapacityClient";
import type { Capacity } from "@/lib/types";

const data = capacityJson as unknown as Capacity;
const all = data.cohorts.all;
const gw = (mw: number) => (mw / 1000).toFixed(1);

export const metadata: Metadata = {
  title: `AI Capacity: ${gw(all.op + all.con + all.plan)} GW tracked across ${all.companies} companies · repriced daily`,
  description:
    "Who has the AI megawatts — neoclouds, ex-BTC-miner landlords, and hyperscalers: operational / construction / planned critical-IT MW, with valuations repriced daily.",
};

export default function Page() {
  const ref = data.reference;
  return (
    <div>
      <h1>
        AI Capacity <span className="subtitle">who has the megawatts?</span>
      </h1>
      <p className="lede">
        Sellable and self-use <b>AI critical-IT megawatts</b> across the
        pure-play GPU clouds, the ex-bitcoin-miners pivoting into AI
        colocation, and the hyperscalers — what each is worth per megawatt,
        who its customers are, and when the capacity arrives. MW numbers are
        hand-curated from filings; valuations reprice every morning. Market
        cap ≠ megawatts — the gap is the whole point.
      </p>
      <div className="kpi-row">
        <KpiCard label="Tracked capacity" value={`${gw(all.op + all.con + all.plan)} GW`}
          context={`${all.companies} companies · op + construction + planned`} accent="sky" />
        <KpiCard label="Operational today" value={`${gw(all.op)} GW`}
          context={`neoclouds ${gw(data.cohorts.neocloud.op)} GW · hyperscalers ${gw(data.cohorts.hyperscaler.op)} GW`} accent="amber" />
        <KpiCard label="Under construction" value={`${gw(all.con)} GW`}
          context="the delivery question — pipeline ≠ revenue until energized" accent="violet" />
        <KpiCard label="NVDA vs the field"
          value={ref.nvda_cap_b != null ? `$${(ref.nvda_cap_b / 1000).toFixed(1)}T` : "—"}
          context={ref.cohort_ev_b != null
            ? `Nvidia market cap vs $${(ref.cohort_ev_b / 1000).toFixed(1)}T combined tracked EV`
            : "Nvidia market cap (cohort EV pending first repricing)"} accent="sky" />
      </div>
      <p className="fineprint">
        MW data as of <b>{data.as_of_curated}</b>
        {data.priced_date ? <> · priced <b>{data.priced_date}</b></> : <> · awaiting first repricing run</>}
      </p>
      <CapacityClient data={data} />
    </div>
  );
}
```

(If `fineprint`/`kpi-row` classes don't exist in `globals.css`, use the nearest existing equivalents from /datacenter or /commodities — check those pages and reuse; do not invent new global CSS unless nothing fits.)

- [ ] **Step 3: Client wrapper** — `site/src/components/capacity/CapacityClient.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import type { Capacity, CapacityCompany, CapacityCohortKey } from "@/lib/types";
import { CapacityBars } from "./CapacityBars";
import { ValuationScatter } from "./ValuationScatter";
import { DemandMap } from "./DemandMap";
import { TimelineChart } from "./TimelineChart";
import { GeoMap } from "./GeoMap";

export function cohortOf(c: CapacityCompany): CapacityCohortKey {
  return c.role === "hyperscaler" ? "hyperscaler" : "neocloud";
}

const COHORTS: [CapacityCohortKey, string][] = [
  ["all", "All"], ["neocloud", "Neoclouds"], ["hyperscaler", "Hyperscalers"],
];
const TABS = ["Capacity", "Valuation × Execution", "Demand map", "Timeline", "Geo map"] as const;
const SORTS: [string, string][] = [
  ["total", "Total"], ["op", "Operational"], ["con", "Construction"],
  ["plan", "Planned"], ["ev_per_mw", "EV / MW"], ["cap", "Mkt cap"],
];

function sortVal(c: CapacityCompany, key: string): number {
  switch (key) {
    case "op": return c.op;
    case "con": return c.con;
    case "plan": return c.plan;
    case "ev_per_mw": return c.ev_per_mw ?? -1;
    case "cap": return c.cap ?? c.valuation_b ?? -1;
    default: return c.op + c.con + c.plan;
  }
}

export function CapacityClient({ data }: { data: Capacity }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Capacity");
  const [cohort, setCohort] = useState<CapacityCohortKey>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("total");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.companies
      .filter((c) => cohort === "all" || cohortOf(c) === cohort)
      .filter((c) => !needle ||
        `${c.t} ${c.n} ${c.econ?.anchor ?? ""}`.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => sortVal(b, sort) - sortVal(a, sort));
  }, [data, cohort, query, sort]);

  const btn = (on: boolean): React.CSSProperties => ({
    font: "inherit", fontSize: 13, cursor: "pointer", padding: "6px 12px",
    borderRadius: 8, border: "1px solid var(--border)",
    background: on ? "var(--chip-bg)" : "none",
    color: on ? "var(--text)" : "var(--muted)",
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 6px" }} role="tablist">
        {TABS.map((t) => (
          <button key={t} style={btn(tab === t)} role="tab"
            aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "8px 0 14px" }}>
        {COHORTS.map(([k, label]) => (
          <button key={k} style={btn(cohort === k)} onClick={() => setCohort(k)}>{label}</button>
        ))}
        {tab === "Capacity" && (
          <>
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>sort</span>
            {SORTS.map(([k, label]) => (
              <button key={k} style={btn(sort === k)} onClick={() => setSort(k)}>{label}</button>
            ))}
          </>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker, company, customer…" aria-label="Search companies"
          style={{ flex: "1 1 200px", minWidth: 160, font: "inherit", fontSize: 13,
                   padding: "6px 10px", borderRadius: 8,
                   border: "1px solid var(--border)", background: "none",
                   color: "var(--text)" }} />
      </div>
      {tab === "Capacity" && <CapacityBars rows={rows} />}
      {tab === "Valuation × Execution" && <ValuationScatter rows={rows} />}
      {tab === "Demand map" && <DemandMap data={data} visible={new Set(rows.map((r) => r.t))} />}
      {tab === "Timeline" && <TimelineChart timeline={data.timeline[cohort]} />}
      {tab === "Geo map" && <GeoMap data={data} visible={new Set(rows.map((r) => r.t))} />}
    </div>
  );
}
```

- [ ] **Step 4: Capacity bars view** — `site/src/components/capacity/CapacityBars.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { CapacityCompany } from "@/lib/types";

const SEG = { op: "var(--accent-amber, #f4c64a)", con: "var(--accent-sky, #5eb0ef)", plan: "var(--muted)" };
const fmtMW = (mw: number) => (mw >= 10_000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);
const money = (b: number | null | undefined) =>
  b == null ? "—" : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : `$${b.toFixed(b < 10 ? 2 : 1)}B`;

function Detail({ c }: { c: CapacityCompany }) {
  const kv: [string, string][] = [
    ["Market cap", c.private ? `${money(c.valuation_b)} (last round, private)` : money(c.cap)],
    ["EV", money(c.ev)],
    ["EV / weighted MW", c.ev_per_mw != null ? `$${c.ev_per_mw.toFixed(1)}M` :
      c.private ? "— (private)" : c.role === "hyperscaler" ? "— (conglomerate EV; not meaningful per AI MW)" : "—"],
    ["% energized", c.pct_energized != null ? `${c.pct_energized}%` : "—"],
    ["Backlog coverage", c.coverage != null ? `${c.coverage}× EV` : "—"],
    ["Net debt", c.nd != null ? money(c.nd) : "—"],
    ...(Object.entries(c.econ ?? {}).map(([k, v]) => [k, v] as [string, string])),
  ];
  return (
    <div style={{ padding: "10px 14px 14px", borderTop: "1px solid var(--border)" }}>
      {c.ndflag && <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0" }}>{c.ndflag}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, margin: "10px 0" }}>
        {kv.map(([k, v]) => (
          <div key={k} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>{k}</div>
            <div style={{ fontSize: 13 }}>{v}</div>
          </div>
        ))}
      </div>
      {c.sites.length > 0 && (
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <tbody>
            {c.sites.map(([name, mw, st, when], i) => (
              <tr key={i} style={{ borderBottom: "1px dashed var(--border)" }}>
                <td style={{ padding: "3px 8px 3px 0", width: 90, color: "var(--muted)" }}>{mw != null ? fmtMW(mw) : "—"}</td>
                <td style={{ padding: "3px 8px 3px 0" }}>{name}</td>
                <td style={{ padding: "3px 0", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {{ o: "operational", c: "construction", p: "planned", s: "secured" }[st] ?? st} · {when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.src.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Sources:{" "}
          {c.src.map(([label, url], i) => (
            <span key={url}>{i > 0 && " · "}<a href={url} target="_blank" rel="noreferrer">{label}</a></span>
          ))}
        </p>
      )}
    </div>
  );
}

export function CapacityBars({ rows }: { rows: CapacityCompany[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...rows.map((c) => c.op + c.con + c.plan), 1);
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>
        <span style={{ color: SEG.op }}>■</span> operational{" "}
        <span style={{ color: SEG.con }}>■</span> construction{" "}
        <span style={{ color: SEG.plan }}>■</span> planned — critical-IT AI MW, verify-adjusted
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((c, i) => {
          const total = c.op + c.con + c.plan;
          return (
            <div key={c.t} className="dashboard-panel" style={{ padding: 0 }}>
              <div onClick={() => setOpen(open === c.t ? null : c.t)}
                style={{ display: "grid", gridTemplateColumns: "230px 1fr 110px", gap: 12,
                         alignItems: "center", padding: "9px 14px", cursor: "pointer" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: "var(--muted)", marginRight: 6 }}>{i + 1}</span>
                    {c.n}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {c.private ? "private" : c.t} · {c.role}
                    {c.confidence === "estimate" && <span title="MW footprint is an estimate, not filing-grade"> · est.</span>}
                    {c.flag && <span style={{ color: "var(--accent-amber, #f4c64a)" }}> · {c.flag}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden",
                              border: "1px solid var(--border)" }}>
                  <div style={{ width: `${(c.op / max) * 100}%`, background: SEG.op }} />
                  <div style={{ width: `${(c.con / max) * 100}%`, background: SEG.con }} />
                  <div style={{ width: `${(c.plan / max) * 100}%`, background: SEG.plan, opacity: 0.45 }} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtMW(total)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                    {c.ev_per_mw != null ? `$${c.ev_per_mw.toFixed(0)}M/MW` : c.stale ? "unpriced" : " "}
                  </div>
                </div>
              </div>
              {open === c.t && <Detail c={c} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Stub the three remaining views** so the build compiles (Tasks 7–8 replace them) — create `ValuationScatter.tsx`, `DemandMap.tsx`, `TimelineChart.tsx`, `GeoMap.tsx` each as a minimal typed component, e.g.:

```tsx
"use client";
import type { CapacityCompany } from "@/lib/types";
export function ValuationScatter({ rows }: { rows: CapacityCompany[] }) {
  return <p style={{ color: "var(--muted)" }}>Valuation × execution — coming in the next commit ({rows.length} rows).</p>;
}
```

(mirror the prop signatures from `CapacityClient`: `DemandMap`/`GeoMap` take `{ data: Capacity; visible: Set<string> }`, `TimelineChart` takes `{ timeline: CapacityTimeline }`).

- [ ] **Step 6: Build**

Run: `cd site && npm run build`
Expected: static export succeeds, `/capacity` in the route list. Also `npm test` still green.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/types.ts site/src/app/capacity site/src/components/capacity
git commit -m "feat(site): /capacity page — cohort/search/sort client shell + capacity bars view"
```

---

### Task 7: Scatter + timeline views

**Files:**
- Replace stubs: `site/src/components/capacity/ValuationScatter.tsx`, `site/src/components/capacity/TimelineChart.tsx`

**Interfaces:**
- Consumes: `rows: CapacityCompany[]` (already filtered/sorted), `timeline: CapacityTimeline` from the published payload. No client math beyond pixel projection.

- [ ] **Step 1: ValuationScatter** — plots only rows with non-null `ev_per_mw` AND non-null `pct_energized`; dot radius ∝ √wmw; axis titles; a muted note listing suppressed rows:

```tsx
"use client";
import type { CapacityCompany } from "@/lib/types";

const W = 1000, H = 460, M = { l: 70, r: 30, t: 20, b: 50 };

export function ValuationScatter({ rows }: { rows: CapacityCompany[] }) {
  const pts = rows.filter((c) => c.ev_per_mw != null && c.pct_energized != null);
  const excluded = rows.filter((c) => !pts.includes(c)).map((c) => c.t);
  if (!pts.length) return <p style={{ color: "var(--muted)" }}>No priced rows in this cohort — EV/MW is suppressed for hyperscalers and private builders.</p>;
  const ymax = Math.max(...pts.map((c) => c.ev_per_mw as number)) * 1.15;
  const X = (v: number) => M.l + (v / 100) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const R = (c: CapacityCompany) => Math.max(5, Math.sqrt(c.wmw) / 3);
  return (
    <div className="dashboard-panel" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="EV per megawatt vs percent energized">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={X(v)} y1={M.t} x2={X(v)} y2={H - M.b} stroke="var(--border)" />
            <text x={X(v)} y={H - M.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{v}%</text>
          </g>
        ))}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={M.l} y1={Y(ymax * f)} x2={W - M.r} y2={Y(ymax * f)} stroke="var(--border)" />
            <text x={M.l - 8} y={Y(ymax * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              ${Math.round(ymax * f)}M
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">% ENERGIZED (op / total) →</text>
        <text x={16} y={H / 2} transform={`rotate(-90 16 ${H / 2})`} textAnchor="middle" fontSize="11" fill="var(--muted)">EV / WEIGHTED MW ($M) →</text>
        {pts.map((c) => (
          <g key={c.t}>
            <circle cx={X(c.pct_energized as number)} cy={Y(c.ev_per_mw as number)} r={R(c)}
              fill="var(--accent-sky, #5eb0ef)" fillOpacity="0.25" stroke="var(--accent-sky, #5eb0ef)">
              <title>{`${c.n} — $${(c.ev_per_mw as number).toFixed(1)}M/MW · ${c.pct_energized}% energized · ${Math.round(c.wmw)} weighted MW`}</title>
            </circle>
            <text x={X(c.pct_energized as number)} y={Y(c.ev_per_mw as number) - R(c) - 4}
              textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text)">{c.t}</text>
          </g>
        ))}
      </svg>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 8px" }}>
        Dot size = weighted MW (op + 0.5·construction + 0.25·planned). Priced daily.
        {excluded.length > 0 && <> Not plotted (EV/MW suppressed or unpriced): {excluded.join(", ")}.</>}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: TimelineChart** — step area over `timeline.points` (all values pre-computed by the pipeline) + milestone cards:

```tsx
"use client";
import type { CapacityTimeline } from "@/lib/types";

const W = 1000, H = 420, M = { l: 70, r: 26, t: 20, b: 44 };
const fmtMW = (mw: number) => (mw >= 10_000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw).toLocaleString("en-US")} MW`);

export function TimelineChart({ timeline }: { timeline: CapacityTimeline }) {
  const pts = timeline.points;
  if (!pts.length) return <p style={{ color: "var(--muted)" }}>No dated construction sites in this cohort.</p>;
  const ymax = Math.max(...pts.map((p) => p.cum_mw)) * 1.08;
  const X = (i: number) => M.l + ((i + 1) / (pts.length + 1)) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  let d = `M ${M.l} ${Y(timeline.base_mw)}`;
  let prev = timeline.base_mw;
  pts.forEach((p, i) => { d += ` L ${X(i)} ${Y(prev)} L ${X(i)} ${Y(p.cum_mw)}`; prev = p.cum_mw; });
  const area = `${d} L ${X(pts.length - 1)} ${Y(0)} L ${M.l} ${Y(0)} Z`;
  return (
    <div>
      <div className="dashboard-panel" style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative MW energizing by quarter">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={M.l} y1={Y(ymax * f)} x2={W - M.r} y2={Y(ymax * f)} stroke="var(--border)" />
              <text x={M.l - 8} y={Y(ymax * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtMW(ymax * f)}</text>
            </g>
          ))}
          <path d={area} fill="var(--accent-sky, #5eb0ef)" fillOpacity="0.10" />
          <path d={d} fill="none" stroke="var(--accent-sky, #5eb0ef)" strokeWidth="2" />
          {pts.map((p, i) => (
            <g key={p.q}>
              {(i % 2 === 0 || i === pts.length - 1) && (
                <text x={X(i)} y={H - M.b + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.q}</text>
              )}
              <circle cx={X(i)} cy={Y(p.cum_mw)} r="3.5" fill="var(--accent-sky, #5eb0ef)">
                <title>{`${p.q}: +${fmtMW(p.add_mw)} → ${fmtMW(p.cum_mw)} cumulative`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 2px" }}>
        Cumulative critical-IT MW coming online, from disclosed construction-stage energization dates
        (operational MW is the {fmtMW(timeline.base_mw)} baseline; undated sites excluded, so the curve
        understates the pipeline — and slippage is common).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
        {Object.entries(timeline.milestones).map(([q, items]) => (
          <div key={q} className="dashboard-panel" style={{ padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-sky, #5eb0ef)", marginBottom: 4 }}>{q}</div>
            {items.map(([t, site, mw], i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--muted)", padding: "1px 0" }}>
                <b style={{ color: "var(--text)" }}>{t}</b> {site} — {fmtMW(mw)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `cd site && npm run build` — passes.

```bash
git add site/src/components/capacity
git commit -m "feat(site): /capacity valuation scatter + energization timeline views"
```

---

### Task 8: Demand map + geo map views

**Files:**
- Create: `site/src/components/capacity/geobase.ts` (generated)
- Replace stubs: `site/src/components/capacity/DemandMap.tsx`, `site/src/components/capacity/GeoMap.tsx`

**Interfaces:**
- Consumes: `data.tenants` (`[tenant, landlordTicker, mw, terms]`), `data.geo`/`geo_unmapped`/`geo_note`, `visible: Set<string>` of tickers surviving the cohort/search filter. `GEOBASE` panels carry `{W, H, lon0, lat1, cosm, k, pad, d}` (equirectangular params + coast path) — projection: `x = pad + (lon - lon0) * cosm * k`, `y = pad + (lat1 - lat) * k`.

- [ ] **Step 1: Extract GEOBASE from the notebook** (read-only source):

```bash
.venv/bin/python - <<'EOF'
import re
from pathlib import Path
html = (Path.home() / "Development/notebook/public-equity/neocloud-capacity-tracker.html").read_text()
m = re.search(r"const GEOBASE=(\{.*?\});\n", html, re.S)
obj = m.group(1)
out = ("// Generated by docs/superpowers/plans/2026-07-21-capacity-tracker.md Task 8\n"
       "// from the notebook tracker's GEOBASE: coast outlines + equirectangular\n"
       "// projection params per panel. x = pad + (lon-lon0)*cosm*k; y = pad + (lat1-lat)*k.\n"
       "export type GeoPanel = { W: number; H: number; lon0: number; lat1: number; cosm: number; k: number; pad: number; d: string };\n"
       "export const GEOBASE: Record<string, GeoPanel> = " + obj + ";\n")
Path("site/src/components/capacity/geobase.ts").write_text(out)
print("panels:", re.findall(r'"(\w+)":\{"W"', obj))
EOF
```

Expected: prints the panel keys (e.g. `['na', 'eu']`). Inspect the generated file compiles (`npm run build` later).

- [ ] **Step 2: DemandMap** — two-column tenant→landlord edge diagram:

```tsx
"use client";
import type { Capacity } from "@/lib/types";

const W = 1000, ROW = 46, PAD = 30;
const fmtMW = (mw: number) => `${Math.round(mw).toLocaleString("en-US")} MW`;

export function DemandMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const edges = data.tenants.filter(([, landlord]) => visible.has(landlord));
  if (!edges.length) return <p style={{ color: "var(--muted)" }}>No disclosed tenant relationships in this cohort.</p>;
  const tenants = [...new Set(edges.map((e) => e[0]))];
  const landlords = [...new Set(edges.map((e) => e[1]))];
  const H = PAD * 2 + Math.max(tenants.length, landlords.length) * ROW;
  const ty = (t: string) => PAD + tenants.indexOf(t) * ROW + ROW / 2;
  const ly = (l: string) => PAD + landlords.indexOf(l) * ROW + ROW / 2;
  const maxMW = Math.max(...edges.map((e) => e[2]), 1);
  const xL = 250, xR = W - 190;
  return (
    <div className="dashboard-panel" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tenant to landlord capacity commitments">
        <text x={xL - 10} y={14} textAnchor="end" fontSize="10" fill="var(--muted)" letterSpacing=".1em">TENANT / ANCHOR</text>
        <text x={xR + 10} y={14} fontSize="10" fill="var(--muted)" letterSpacing=".1em">LANDLORD / OPERATOR</text>
        {edges.map(([tenant, landlord, mw, terms], i) => (
          <path key={i}
            d={`M ${xL} ${ty(tenant)} C ${xL + 180} ${ty(tenant)}, ${xR - 180} ${ly(landlord)}, ${xR} ${ly(landlord)}`}
            fill="none" stroke="var(--accent-sky, #5eb0ef)" strokeOpacity="0.45"
            strokeWidth={Math.max(1.5, (mw / maxMW) * 14)}>
            <title>{`${tenant} → ${landlord}: ${fmtMW(mw)}${terms ? ` · ${terms}` : ""}`}</title>
          </path>
        ))}
        {tenants.map((t) => (
          <text key={t} x={xL - 10} y={ty(t) + 4} textAnchor="end" fontSize="12" fill="var(--text)">{t}</text>
        ))}
        {landlords.map((l) => (
          <text key={l} x={xR + 10} y={ly(l) + 4} fontSize="12" fill="var(--text)">{l}</text>
        ))}
      </svg>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 8px" }}>
        Edge width = committed critical-IT MW. Hover an edge for lease terms. Disclosed deals only.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: GeoMap** — panels from `GEOBASE`, dots from `data.geo`, chips from `geo_unmapped`:

```tsx
"use client";
import type { Capacity } from "@/lib/types";
import { GEOBASE, type GeoPanel } from "./geobase";

const ST: Record<string, string> = { o: "var(--accent-amber, #f4c64a)", c: "var(--accent-sky, #5eb0ef)", p: "var(--muted)", s: "var(--muted)" };
const STLABEL: Record<string, string> = { o: "operational", c: "construction", p: "planned", s: "secured" };
const R = (mw: number) => Math.max(4, Math.sqrt(mw) * 1.15);

function inPanel(p: GeoPanel, lon: number, lat: number): boolean {
  const [x, y] = proj(p, lon, lat);
  return x >= 0 && x <= p.W && y >= 0 && y <= p.H;
}
function proj(p: GeoPanel, lon: number, lat: number): [number, number] {
  return [p.pad + (lon - p.lon0) * p.cosm * p.k, p.pad + (p.lat1 - lat) * p.k];
}

export function GeoMap({ data, visible }: { data: Capacity; visible: Set<string> }) {
  const sites = data.geo.filter((s) => visible.has(s.t));
  const unmapped = data.geo_unmapped.filter((s) => visible.has(s.t));
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Object.entries(GEOBASE).map(([key, p]) => {
          const here = sites.filter((s) => inPanel(p, s.lng, s.lat));
          if (!here.length) return null;
          return (
            <div key={key} className="dashboard-panel" style={{ flex: "1 1 420px", minWidth: 0 }}>
              <svg viewBox={`0 0 ${p.W} ${p.H}`} role="img" aria-label={`Site map — ${key}`}>
                <path d={p.d} fill="var(--chip-bg)" stroke="var(--border)" strokeWidth="0.7" />
                {here.sort((a, b) => b.mw - a.mw).map((s, i) => {
                  const [cx, cy] = proj(p, s.lng, s.lat);
                  return (
                    <circle key={i} cx={cx} cy={cy} r={R(s.mw)} fill={ST[s.st]} fillOpacity={s.st === "o" ? 0.4 : 0.2}
                      stroke={ST[s.st]} strokeWidth="1.5" strokeDasharray={s.approx ? "5 3" : undefined}>
                      <title>{`${s.t} — ${s.site}\n${Math.round(s.mw)} MW · ${STLABEL[s.st] ?? s.st}${s.when ? ` · ${s.when}` : ""}${s.approx ? " · approx location" : ""}`}</title>
                    </circle>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 2px" }}>{data.geo_note} Dashed = approximate location.</p>
      {unmapped.length > 0 && (
        <div className="dashboard-panel" style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)", marginBottom: 6 }}>
            Not mappable (location undisclosed)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unmapped.map((s, i) => (
              <span key={i} title={s.why} style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", color: "var(--muted)" }}>
                <b style={{ color: "var(--text)" }}>{s.t}</b> {s.site} · {Math.round(s.mw)} MW
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build + commit**

Run: `cd site && npm run build` — passes.

```bash
git add site/src/components/capacity
git commit -m "feat(site): /capacity demand map + geo map views"
```

---

### Task 9: Nav + e2e + full verification

**Files:**
- Modify: `site/src/lib/nav.ts`, `site/e2e/smoke.spec.ts`

- [ ] **Step 1: Nav** — replace the top-level Data Centers link in `NAV` with a group (the footer derives from `NAV` automatically):

```ts
  {
    kind: "group",
    label: "AI Infra",
    sections: [
      {
        items: [
          { href: "/datacenter", label: "Data Centers", emoji: "🏭" },
          { href: "/capacity", label: "AI Capacity", emoji: "⚡" },
        ],
      },
    ],
  },
```

- [ ] **Step 2: e2e route** — add to `ROUTES` in `site/e2e/smoke.spec.ts` (marker text is in the page lede, unique to the body):

```ts
  ["/capacity", "the gap is the whole point"],
```

- [ ] **Step 3: Run everything**

```bash
cd site && npm run build && npm test && npm run e2e
cd .. && .venv/bin/python -m pytest -q
```

Expected: build green, vitest green, Playwright 26 routes green with zero console errors, pytest all green.

- [ ] **Step 4: Commit**

```bash
git add site/src/lib/nav.ts site/e2e/smoke.spec.ts
git commit -m "feat(site): /capacity in AI Infra nav group + e2e smoke coverage"
```

---

### Task 10: Research pass — new companies (GATED on user verification)

**Files:**
- Modify: `config/capacity.json` (add ~11 companies + tenant edges + geo sites; bump `as_of_curated`), regenerate `site/public/data/capacity.json`

**Interfaces:**
- Consumes: everything above — this task only adds data, no code.

**This task requires live web research and ends at a user gate — nothing merges or publishes until the user signs off on the config diff.**

- [ ] **Step 1: Research, with a citation per number.** For each of: **MSFT, AMZN, GOOGL, META, BABA, TCEHY, BIDU** (role `hyperscaler`, `confidence: "estimate"` unless filing-grade), **EQIX, DLR** (role `landlord`), **xAI, OpenAI/Stargate** (role `hyperscaler`, `private: true`, `valuation_b` = last-round valuation, cited), collect:
  - `op` / `con` / `plan` critical-IT AI MW (best public estimates: filings, earnings calls, credible trackers — record the source and date for every figure in `src`),
  - `nd` (net debt $B, latest 10-Q/annual report; null for private),
  - `bk` — only where the backlog is capacity-specific (REIT leasing backlog yes; cloud-wide RPO stays null with an `econ` note explaining why),
  - `econ` block (anchor customers, capex/MW where disclosed, contract structure),
  - major named campuses for `sites` (name, MW, status letter, when-string parseable by `parse_quarter` where a date is public),
  - `geo` entries (town/county centroid lat/lng, `approx: true` unless the campus location is disclosed) or `geo_unmapped` with a `why`,
  - `tenants` edges for hyperscaler→neocloud tenancy (e.g. Microsoft→CRWV, OpenAI/Stargate→Oracle) with MW and terms.
  - Also refresh ORCL's numbers (its blob data is as-of 2026-07-09) and sanity-scan the ported 18 — anything that visibly moved gets flagged in the summary, not silently changed.
- [ ] **Step 2: Update `config/capacity.json`** — append the new companies, set `as_of_curated` to today, update the `note` string to describe the expanded cohort (it still references the notebook file as canonical — reword to name the spec as canonical). Re-run the loader test suite: `.venv/bin/python -m pytest tests/test_capacity_config.py -q` — the "18 companies" assertion must be updated to the new count in the same commit.
- [ ] **Step 3: Regenerate the artifact** with the Task 5 Step 6 script; validate against the schema; `cd site && npm run build && npm run e2e`.
- [ ] **Step 4: USER GATE — present the config diff** with the citation list and confidence flags. Wait for sign-off. Apply requested corrections and repeat Step 3.
- [ ] **Step 5: Commit after approval**

```bash
git add config/capacity.json site/public/data/capacity.json tests/test_capacity_config.py
git commit -m "data(capacity): hyperscaler + REIT + private-builder rows (user-verified)"
```

---

### Task 11: Merge readiness

- [ ] **Step 1:** Full verification: `.venv/bin/python -m pytest -q` AND `cd site && npm run build && npm test && npm run e2e` — all green, output captured verbatim.
- [ ] **Step 2:** `git fetch origin && git rebase origin/main` (expect daily-bot `data: daily publish` commits; store JSONL conflicts resolve by union — keep both sides' rows).
- [ ] **Step 3:** Invoke `superpowers:finishing-a-development-branch`. **Do not push without explicit user approval** — push deploys to production via Vercel.
