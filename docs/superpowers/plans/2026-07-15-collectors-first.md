# Collectors-First Implementation Plan (Wave 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the collection clocks for DRAM/NAND spot, GPU rental, AI inference prices, and STEO forecast vintages — 5 new source keys, ~25 series, zero published-artifact or site changes — per `docs/superpowers/specs/2026-07-15-collectors-first-design.md`.

**Architecture:** Four new connector modules (2 scrapes on the aaa.py drift-protection template, 2 keyless APIs treated like scrapes) + STEO reusing the EIA connector under its own source key (`EIA_STATE` precedent). One 3-line engine change: the component `mode` label reflects actual tail contribution, enabling the dormant DRAM `live_proxy` config to ship now and self-activate ~September.

**Tech Stack:** Python 3.12 pipeline, pytest. No site work.

## Global Constraints

- **No invented identifiers.** Row labels, `gpu_name` values, and OpenRouter model ids in this plan are the research's candidates. Task 1's spike fetches every source live, records trimmed fixtures, and pins the FINAL strings in its notes doc; the controller injects those finals into Tasks 2–6 dispatches. Values marked `# SPIKE-FINAL` in this plan are defaults to be overridden.
- **No network in tests.** Happy paths run against the spike's recorded fixtures in `tests/fixtures/`; drift tests use tiny inline synthetic inputs.
- Every connector: injected `http_get`, `"structure drift?"` ValueErrors on any structural miss, plausible-range checks, `vintage_date or today_et()`.
- All four new `fetch` signatures are identical: `fetch(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]`; `series_code = source_id` (collect's id_map remaps).
- One isolated source key per provider; never grouped. STEO must NOT touch the existing `EIA`/`EIA_STATE` keys' failure domains.
- Nothing publishes from the new series this wave. `sources_status.json` rows appear automatically.
- vast.ai thin-market rule: store an observation only when the median rests on ≥3 offers; otherwise skip (never error).
- STEO series carry future-dated observations (forecast curve) BY DESIGN — never join a basket/panel; wave 4's vintage-slicing accessor is the only sanctioned reader.
- Pins that move: sources 17→22 (`tests/test_run_daily.py` status-row count, `tests/test_registry.py` sources set), series 242→267. FRED count (73) untouched.
- Commit after every task; `.venv/bin/pytest` (system python is 3.9). Do NOT push (push = deploy; user approves).

---

### Task 1: Verification spike — live fetches, fixtures, final strings

**Files:**
- Create: `docs/superpowers/specs/2026-07-15-collectors-spike-notes.md`, `tests/fixtures/dramex.html`, `tests/fixtures/sfcompute.html`, `tests/fixtures/vastai_bundles.json`, `tests/fixtures/openrouter_models.json`

**Interfaces:**
- Produces: the FINAL strings Tasks 2–6 use verbatim — DRAMeXchange row labels + the session-average cell position; vast.ai `gpu_name` values + a sample offers response; the sfcompute payload row regex (exact escaping) + section keys; the 6 FINAL OpenRouter model ids; STEO row confirmation through `eia.fetch`. Plus each fixture's expected parsed values (for test assertions).

- [ ] **Step 1: DRAMeXchange.** Fetch `https://www.dramexchange.com/` (curl with a browser UA if plain fetch 403s). Locate the three candidate rows (`MLC 64Gb 8GBx8`, `DDR5 16Gb (2Gx8) 4800/5600`, `DDR4 16Gb (2Gx8) 3200`) — record the EXACT label text as it appears, which numeric `tab_tr_gray` cell is the session average (candidate: 5th), and today's values. Trim the HTML to the spot-table region (keep all three rows + at least one neighboring row as a negative control) → `tests/fixtures/dramex.html`. If a candidate row is gone, substitute the nearest current-generation equivalent and record why.
- [ ] **Step 2: vast.ai.** GET `https://console.vast.ai/api/v0/bundles/?q=<urlencoded>` for each candidate `gpu_name` (`H100 SXM`, `H200`, `B200`, `A100 SXM4`, `RTX 4090`) with the spec §3.2 query. Confirm each returns offers with `dph_total`/`num_gpus`; record offer counts + median $/GPU-hr per GPU. Save ONE representative response (trimmed to ~6 offers, real field structure) → `tests/fixtures/vastai_bundles.json`. Substitute any `gpu_name` that returns zero offers across retries.
- [ ] **Step 3: sfcompute.** Fetch `https://sfcompute.com`. Locate `pricesByHardwareType` in the flight payload; record the exact escaping around `date`/`avg` (the `\"`-escaped JSON and any `$D` date prefix), the section keys (`H100`/`H200`/`B200`), and row counts. Trim to the payload region (keep ≥3 rows per type) → `tests/fixtures/sfcompute.html`.
- [ ] **Step 4: OpenRouter.** GET `https://openrouter.ai/api/v1/models`. For each candidate model pick the provider's CURRENT equivalent tier if the candidate id is gone (`openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-70b-instruct`, `deepseek/deepseek-chat`, `google/gemini-2.0-flash-001`, `mistralai/mistral-large`). Record the 6 FINAL ids + their prompt/completion prices in $/Mtok. Save a trimmed fixture containing exactly those 6 models' entries (full per-model structure) → `tests/fixtures/openrouter_models.json`.
- [ ] **Step 5: STEO.** With the project's EIA key, confirm `pipeline.connectors.eia.fetch(["STEO.ESICU_US.M", "STEO.ELWHU_PJ.M"], key)` returns observations including future-dated periods, and note how the connector renders monthly periods as obs_dates. (Read-only; do not write to the store.)
- [ ] **Step 6: Notes doc.** Write `docs/superpowers/specs/2026-07-15-collectors-spike-notes.md`: per-source final strings, expected fixture-parse values, substitutions with reasons, access notes (UA requirements, response sizes), and the DRAMeXchange ToS §6.3 posture line. No invented values — anything unfetchable is recorded as such and its series dropped from scope with a note.
- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-07-15-collectors-spike-notes.md tests/fixtures/dramex.html tests/fixtures/sfcompute.html tests/fixtures/vastai_bundles.json tests/fixtures/openrouter_models.json
git commit -m "docs+fixtures: collectors spike — final strings and recorded fixtures"
```

---

### Task 2: DRAMEX connector

**Files:**
- Create: `pipeline/connectors/dramex.py`
- Test: `tests/test_dramex.py`

**Interfaces:**
- Consumes: Task 1's `tests/fixtures/dramex.html`, final row labels, avg-cell position, expected values.
- Produces: `dramex.fetch(source_ids, vintage_date=None, http_get=None)`; Observations with `source="DRAMEX"`, `route="SCRAPE"`, `obs_date=vintage` (spot, one obs/series/run).

- [ ] **Step 1: Write the failing tests** (`tests/test_dramex.py`; replace `31.1` etc. with the spike's expected values):

```python
from pathlib import Path

import pytest

from pipeline.connectors import dramex

FIXTURE = (Path(__file__).parent / "fixtures" / "dramex.html").read_text()


class _R:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _get(text):
    return lambda url, timeout=None: _R(text)


def test_happy_path_parses_session_averages():
    obs = dramex.fetch(["MLC 64Gb 8GBx8"],                     # SPIKE-FINAL label
                       vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "MLC 64Gb 8GBx8"                   # SPIKE-FINAL
    assert o.value == pytest.approx(31.1)                      # SPIKE-FINAL value
    assert (o.obs_date, o.vintage_date) == ("2026-07-15", "2026-07-15")
    assert (o.source, o.route) == ("DRAMEX", "SCRAPE")


def test_all_three_rows_parse():
    labels = ["MLC 64Gb 8GBx8", "DDR5 16Gb (2Gx8) 4800/5600",
              "DDR4 16Gb (2Gx8) 3200"]                         # SPIKE-FINAL labels
    obs = dramex.fetch(labels, vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert [o.series_code for o in obs] == labels
    assert all(dramex.PLAUSIBLE[0] <= o.value <= dramex.PLAUSIBLE[1] for o in obs)


def test_missing_row_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        dramex.fetch(["No Such Product 1Gb"], vintage_date="2026-07-15",
                     http_get=_get(FIXTURE))


def test_implausible_value_is_structure_drift():
    html = ('<tr><td>MLC 64Gb 8GBx8</td>'
            + '<td class="tab_tr_gray">99999</td>' * 5 + "</tr>")
    with pytest.raises(ValueError, match="structure drift"):
        dramex.fetch(["MLC 64Gb 8GBx8"], vintage_date="2026-07-15",
                     http_get=_get(html))
```

- [ ] **Step 2: Verify failure** — `.venv/bin/pytest tests/test_dramex.py -q` → FAIL (no module).

- [ ] **Step 3: Create `pipeline/connectors/dramex.py`:**

```python
"""DRAMeXchange DRAM/NAND spot prices — scraped from https://www.dramexchange.com/

One observation per series per run: the session average from the public spot
table (the closing session, ~18:10 GMT+8, precedes the 8:40 ET run). The page
shows the current session only — no history exists to backfill, which is why
collection ships ahead of any consuming feature (wave-3a collectors-first).
Scrape protections per house convention: per-row regex anchored on the exact
product label, pinned to tests/fixtures/dramex.html; plausible-range check;
collect-layer isolation.

ToS posture (spike 2026-07-15): §6.3 permits use with attribution — only
derived/rebased values may ever be published, never raw price republication.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://www.dramexchange.com/"
PLAUSIBLE = (0.5, 1000.0)   # $ per unit — outside this the table has drifted
AVG_CELL = 5                # SPIKE-FINAL: session average is the Nth gray cell
_CELL = r'.*?tab_tr_gray">([0-9.]+)<'


def _row_re(label: str) -> re.Pattern:
    # Anchored on the exact product label; captures AVG_CELL numeric cells.
    # DOTALL + non-greedy could in principle leak past a short row into its
    # neighbor — the fixture pin plus the range check catch that drift.
    return re.compile(re.escape(label) + _CELL * AVG_CELL, re.DOTALL)


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the exact product-row label (spike-pinned)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    out = []
    for sid in source_ids:
        m = _row_re(sid).search(html)
        if not m:
            raise ValueError(
                f"DRAMeXchange row {sid!r} not found (structure drift?)")
        value = float(m.group(AVG_CELL))
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"DRAMeXchange {sid}: {value} implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="DRAMEX",
                               route="SCRAPE"))
    return out
```

- [ ] **Step 4: Verify pass** — `.venv/bin/pytest tests/test_dramex.py -q` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/connectors/dramex.py tests/test_dramex.py
git commit -m "feat(connectors): DRAMEX spot-price scrape with drift protection"
```

---

### Task 3: VASTAI connector

**Files:**
- Create: `pipeline/connectors/vastai.py`
- Test: `tests/test_vastai.py`

**Interfaces:**
- Consumes: Task 1's `tests/fixtures/vastai_bundles.json` + final `gpu_name` strings.
- Produces: `vastai.fetch(...)`; Observations `source="VASTAI"`, `route="API"`, `obs_date=vintage`; exports `MIN_OFFERS = 3`.

- [ ] **Step 1: Write the failing tests** (`tests/test_vastai.py`):

```python
import json
from pathlib import Path

import pytest

from pipeline.connectors import vastai

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "vastai_bundles.json").read_text())


class _R:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(payload):
    return lambda url, timeout=None: _R(payload)


def test_happy_path_median_per_gpu():
    obs = vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",   # SPIKE-FINAL
                       http_get=_get(FIXTURE))
    assert len(obs) == 1
    o = obs[0]
    assert o.series_code == "H100 SXM"                            # SPIKE-FINAL
    # median of the fixture's per-GPU prices — SPIKE-FINAL expected value
    assert o.value == pytest.approx(2.1, rel=0.5)
    assert (o.source, o.route) == ("VASTAI", "API")


def test_thin_market_skipped_not_error():
    thin = {"offers": FIXTURE["offers"][: vastai.MIN_OFFERS - 1]}
    assert vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                        http_get=_get(thin)) == []


def test_missing_offers_key_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                     http_get=_get({"unexpected": []}))


def test_missing_price_fields_is_structure_drift():
    bad = {"offers": [{"gpu_name": "H100 SXM"}] * 5}
    with pytest.raises(ValueError, match="structure drift"):
        vastai.fetch(["H100 SXM"], vintage_date="2026-07-15", http_get=_get(bad))


def test_multi_gpu_offers_normalized_per_gpu():
    offers = {"offers": [{"dph_total": 8.0, "num_gpus": 4},
                         {"dph_total": 2.0, "num_gpus": 1},
                         {"dph_total": 4.0, "num_gpus": 2}]}
    obs = vastai.fetch(["H100 SXM"], vintage_date="2026-07-15",
                       http_get=_get(offers))
    assert obs[0].value == pytest.approx(2.0)   # all normalize to 2.0/GPU-hr
```

- [ ] **Step 2: Verify failure** — `.venv/bin/pytest tests/test_vastai.py -q` → FAIL.

- [ ] **Step 3: Create `pipeline/connectors/vastai.py`:**

```python
"""vast.ai GPU rental offers — median $/GPU-hr per GPU type.

Keyless public search API. Undocumented endpoint, so it is treated like a
scrape: required-field checks raise "structure drift?" and the collect-layer
isolation contains any failure. The median over live on-demand full-GPU
offers is this connector's one computation — a documented measurement, not
modeling. Thin-market honesty: days with fewer than MIN_OFFERS offers are
skipped entirely (the store's carry-forward absorbs the gap) rather than
storing a junk median.
"""
import json
import statistics
import urllib.parse

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://console.vast.ai/api/v0/bundles/"
MIN_OFFERS = 3
PLAUSIBLE = (0.05, 50.0)   # $/GPU-hr


def _query(gpu_name: str) -> str:
    q = {"gpu_name": {"eq": gpu_name}, "rentable": {"eq": True},
         "gpu_frac": {"eq": 1}, "type": "on-demand", "limit": 1000}
    return urllib.parse.quote(json.dumps(q))


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the vast.ai gpu_name string (spike-pinned)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out = []
    for sid in source_ids:
        resp = http_get(f"{URL}?q={_query(sid)}", timeout=60)
        resp.raise_for_status()
        offers = resp.json().get("offers")
        if offers is None:
            raise ValueError(f"vast.ai {sid}: no 'offers' key (structure drift?)")
        prices = []
        for o in offers:
            if "dph_total" not in o or "num_gpus" not in o:
                raise ValueError(f"vast.ai {sid}: offer missing dph_total/"
                                 "num_gpus (structure drift?)")
            if o["num_gpus"]:
                prices.append(o["dph_total"] / o["num_gpus"])
        if len(prices) < MIN_OFFERS:
            continue   # thin market today — skip; carry-forward absorbs it
        value = round(statistics.median(prices), 4)
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"vast.ai {sid}: median {value} implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="VASTAI",
                               route="API"))
    return out
```

- [ ] **Step 4: Verify pass** — 5 passed. **Step 5: Commit**

```bash
git add pipeline/connectors/vastai.py tests/test_vastai.py
git commit -m "feat(connectors): VASTAI GPU rental medians (keyless API, n>=3 rule)"
```

---

### Task 4: SFCOMPUTE connector

**Files:**
- Create: `pipeline/connectors/sfcompute.py`
- Test: `tests/test_sfcompute.py`

**Interfaces:**
- Consumes: Task 1's `tests/fixtures/sfcompute.html` + the spike's EXACT row regex escaping.
- Produces: `sfcompute.fetch(...)`; Observations `source="SFCOMPUTE"`, `route="SCRAPE"`, **obs_date from the payload's own dates** (multi-day emission, self-healing).

- [ ] **Step 1: Write the failing tests** (`tests/test_sfcompute.py`):

```python
from pathlib import Path

import pytest

from pipeline.connectors import sfcompute

FIXTURE = (Path(__file__).parent / "fixtures" / "sfcompute.html").read_text()


class _R:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _get(text):
    return lambda url, timeout=None: _R(text)


def test_happy_path_emits_daily_history():
    obs = sfcompute.fetch(["H100"], vintage_date="2026-07-15",
                          http_get=_get(FIXTURE))
    assert len(obs) >= 3                       # fixture keeps >=3 rows per type
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates) or dates == sorted(dates, reverse=True)
    assert all(o.series_code == "H100" for o in obs)
    assert all(sfcompute.PLAUSIBLE[0] <= o.value <= sfcompute.PLAUSIBLE[1]
               for o in obs)
    assert all(o.vintage_date == "2026-07-15" for o in obs)
    assert {(o.source, o.route) for o in obs} == {("SFCOMPUTE", "SCRAPE")}


def test_all_types_parse():
    obs = sfcompute.fetch(["H100", "H200", "B200"], vintage_date="2026-07-15",
                          http_get=_get(FIXTURE))
    assert {o.series_code for o in obs} == {"H100", "H200", "B200"}


def test_missing_section_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        sfcompute.fetch(["GB300"], vintage_date="2026-07-15",
                        http_get=_get(FIXTURE))


def test_zero_rows_is_structure_drift():
    # a section that exists but matches no rows (escaping drifted)
    html = FIXTURE.replace("avg", "mangled")
    with pytest.raises(ValueError, match="structure drift"):
        sfcompute.fetch(["H100"], vintage_date="2026-07-15", http_get=_get(html))
```

- [ ] **Step 2: Verify failure.** **Step 3: Create `pipeline/connectors/sfcompute.py`** (ROW_RE's exact escaping is SPIKE-FINAL — the controller injects the spike's regex if it differs):

```python
"""sfcompute H100/H200/B200 spot averages — scraped from the homepage's
Next.js flight payload.

The payload embeds pricesByHardwareType with ~31 trailing daily rows per
hardware type, so each fetch emits a month of observations: a missed run
self-heals from the next day's overlap, and vintage.append's value-dedupe
keeps re-fetched days free — unique among our scrapes. Regex pinned to
tests/fixtures/sfcompute.html; plausible-range check; collect isolation.
"""
import re

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation

URL = "https://sfcompute.com"
PLAUSIBLE = (0.2, 50.0)   # $/GPU-hr
# SPIKE-FINAL escaping: Next.js flight payload escapes quotes; dates carry a
# $D prefix. Pinned against the recorded fixture.
ROW_RE = re.compile(
    r'\\"date\\":\\"(?:\$D)?(\d{4}-\d{2}-\d{2})[^"\\]*\\",\\"avg\\":([0-9.]+)')


def _section(html: str, key: str) -> str:
    m = re.search(r'\\"' + re.escape(key) + r'\\":\[(.*?)\]', html, re.DOTALL)
    if not m:
        raise ValueError(
            f"sfcompute section {key!r} not found (structure drift?)")
    return m.group(1)


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = the pricesByHardwareType key (H100 / H200 / B200)."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    html = get_text(URL, http_get)
    out = []
    for sid in source_ids:
        rows = ROW_RE.findall(_section(html, sid))
        if not rows:
            raise ValueError(
                f"sfcompute {sid}: zero rows parsed (structure drift?)")
        for date_s, avg_s in rows:
            value = float(avg_s)
            if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
                raise ValueError(f"sfcompute {sid}: {value} implausible "
                                 f"(range {PLAUSIBLE}) — structure drift?")
            out.append(Observation(series_code=sid, obs_date=date_s,
                                   value=value, vintage_date=vintage,
                                   source="SFCOMPUTE", route="SCRAPE"))
    return out
```

- [ ] **Step 4: Verify pass** — 4 passed. **Step 5: Commit**

```bash
git add pipeline/connectors/sfcompute.py tests/test_sfcompute.py
git commit -m "feat(connectors): SFCOMPUTE spot averages (self-healing 31-day payload)"
```

---

### Task 5: OPENROUTER connector

**Files:**
- Create: `pipeline/connectors/openrouter.py`
- Test: `tests/test_openrouter.py`

**Interfaces:**
- Consumes: Task 1's `tests/fixtures/openrouter_models.json` + the 6 FINAL model ids.
- Produces: `openrouter.fetch(...)`; `source_id` format `<model_id>:prompt` / `<model_id>:completion`; values in **$/Mtok**; missing model → its series skipped silently; zero basket models → drift error.

- [ ] **Step 1: Write the failing tests** (`tests/test_openrouter.py`; model ids/prices are SPIKE-FINAL):

```python
import json
from pathlib import Path

import pytest

from pipeline.connectors import openrouter

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "openrouter_models.json").read_text())


class _R:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(payload):
    return lambda url, timeout=None: _R(payload)


def test_happy_path_dollars_per_mtok():
    obs = openrouter.fetch(["openai/gpt-4o:prompt",              # SPIKE-FINAL id
                            "openai/gpt-4o:completion"],
                           vintage_date="2026-07-15", http_get=_get(FIXTURE))
    by_code = {o.series_code: o.value for o in obs}
    # fixture pricing.prompt "0.0000025" -> $2.50/Mtok — SPIKE-FINAL values
    assert by_code["openai/gpt-4o:prompt"] == pytest.approx(2.5)
    assert by_code["openai/gpt-4o:completion"] == pytest.approx(10.0)
    assert {(o.source, o.route) for o in obs} == {("OPENROUTER", "API")}


def test_missing_model_skipped_silently():
    obs = openrouter.fetch(["gone/model:prompt", "openai/gpt-4o:prompt"],
                           vintage_date="2026-07-15", http_get=_get(FIXTURE))
    assert [o.series_code for o in obs] == ["openai/gpt-4o:prompt"]


def test_zero_basket_models_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["gone/model:prompt"], vintage_date="2026-07-15",
                         http_get=_get(FIXTURE))


def test_no_data_list_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        openrouter.fetch(["openai/gpt-4o:prompt"], vintage_date="2026-07-15",
                         http_get=_get({"models": []}))
```

- [ ] **Step 2: Verify failure.** **Step 3: Create `pipeline/connectors/openrouter.py`:**

```python
"""OpenRouter model prices — $/Mtok for a fixed model basket.

Keyless public API. Prices are OpenRouter's routed best-available price, a
caveat that belongs to the future index's methodology, not to collection.
Failure semantics are deliberate: a basket model missing from the response
skips its two series (deprecation then surfaces as per-series staleness
within 7 days — the designed early-warning), while an unparsable response or
a fully-missing basket raises. Basket substitutions are an index-construction
decision (wave 3b), never made silently here.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

URL = "https://openrouter.ai/api/v1/models"
PLAUSIBLE = (0.01, 500.0)   # $/Mtok


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    """source_id = '<model_id>:prompt' or '<model_id>:completion'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(URL, timeout=60)
    resp.raise_for_status()
    data = resp.json().get("data")
    if not isinstance(data, list):
        raise ValueError("openrouter: no 'data' list (structure drift?)")
    pricing = {m.get("id"): (m.get("pricing") or {}) for m in data}
    out = []
    for sid in source_ids:
        model_id, _, direction = sid.rpartition(":")
        p = pricing.get(model_id)
        if p is None:
            continue   # deprecated model -> series goes stale (early-warning)
        raw = p.get(direction)   # "prompt" | "completion", USD per token
        if raw in (None, ""):
            continue
        value = round(float(raw) * 1_000_000, 6)   # USD/token -> $/Mtok
        if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
            raise ValueError(f"openrouter {sid}: {value} $/Mtok implausible "
                             f"(range {PLAUSIBLE}) — structure drift?")
        out.append(Observation(series_code=sid, obs_date=vintage, value=value,
                               vintage_date=vintage, source="OPENROUTER",
                               route="API"))
    if not out:
        raise ValueError(
            "openrouter: zero basket models found (structure drift?)")
    return out
```

- [ ] **Step 4: Verify pass** — 4 passed. **Step 5: Commit**

```bash
git add pipeline/connectors/openrouter.py tests/test_openrouter.py
git commit -m "feat(connectors): OPENROUTER inference prices ($/Mtok, fixed basket)"
```

---

### Task 6: Registry + collect wiring + fake_get + pins

**Files:**
- Modify: `config/series.json`, `pipeline/collect.py`, `tests/test_registry.py`, `tests/test_run_daily.py`

**Interfaces:**
- Consumes: Tasks 2–5 connectors; spike-final strings for all source_ids.
- Produces: 25 registry series across 5 new sources; collection fans out automatically.

- [ ] **Step 1: Update the failing pins first.** `tests/test_registry.py`: sources set gains `"DRAMEX", "VASTAI", "SFCOMPUTE", "OPENROUTER", "STEO"`; `len(series)` 242 → 267. `tests/test_run_daily.py`: status-row count 17 → 22.
- [ ] **Step 2: Verify failure** — `.venv/bin/pytest tests/test_registry.py -q` → FAIL.
- [ ] **Step 3: `config/series.json`.** Add to `"sources"` after `"CENSUS"`:

```json
"DRAMEX": {"route": "SCRAPE", "cadence": "daily"},
"VASTAI": {"route": "API", "cadence": "daily"},
"SFCOMPUTE": {"route": "SCRAPE", "cadence": "daily"},
"OPENROUTER": {"route": "API", "cadence": "daily"},
"STEO": {"route": "API", "cadence": "monthly", "secret": "EIA_API_KEY"}
```

Append 25 series after the census entries (source_ids are SPIKE-FINAL; the labels below are the candidates):

```json
{"code": "dramex_nand_mlc64", "source": "DRAMEX", "source_id": "MLC 64Gb 8GBx8", "name": "NAND flash spot, session avg ($)", "max_staleness_days": 7},
{"code": "dramex_ddr5_16g", "source": "DRAMEX", "source_id": "DDR5 16Gb (2Gx8) 4800/5600", "name": "DDR5 16Gb spot, session avg ($)", "max_staleness_days": 7},
{"code": "dramex_ddr4_16g", "source": "DRAMEX", "source_id": "DDR4 16Gb (2Gx8) 3200", "name": "DDR4 16Gb spot, session avg ($)", "max_staleness_days": 7},
{"code": "vast_h100_sxm", "source": "VASTAI", "source_id": "H100 SXM", "name": "vast.ai H100 SXM median ($/GPU-hr)", "max_staleness_days": 7},
{"code": "vast_h200", "source": "VASTAI", "source_id": "H200", "name": "vast.ai H200 median ($/GPU-hr)", "max_staleness_days": 7},
{"code": "vast_b200", "source": "VASTAI", "source_id": "B200", "name": "vast.ai B200 median ($/GPU-hr)", "max_staleness_days": 7},
{"code": "vast_a100_sxm", "source": "VASTAI", "source_id": "A100 SXM4", "name": "vast.ai A100 median ($/GPU-hr)", "max_staleness_days": 7},
{"code": "vast_rtx4090", "source": "VASTAI", "source_id": "RTX 4090", "name": "vast.ai RTX 4090 median ($/GPU-hr)", "max_staleness_days": 7},
{"code": "sfc_h100", "source": "SFCOMPUTE", "source_id": "H100", "name": "sfcompute H100 spot avg ($/GPU-hr)", "max_staleness_days": 7},
{"code": "sfc_h200", "source": "SFCOMPUTE", "source_id": "H200", "name": "sfcompute H200 spot avg ($/GPU-hr)", "max_staleness_days": 7},
{"code": "sfc_b200", "source": "SFCOMPUTE", "source_id": "B200", "name": "sfcompute B200 spot avg ($/GPU-hr)", "max_staleness_days": 7},
{"code": "or_gpt4o_in", "source": "OPENROUTER", "source_id": "openai/gpt-4o:prompt", "name": "OpenRouter GPT-4o input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_gpt4o_out", "source": "OPENROUTER", "source_id": "openai/gpt-4o:completion", "name": "OpenRouter GPT-4o output ($/Mtok)", "max_staleness_days": 7},
{"code": "or_claude_sonnet_in", "source": "OPENROUTER", "source_id": "anthropic/claude-3.5-sonnet:prompt", "name": "OpenRouter Claude Sonnet input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_claude_sonnet_out", "source": "OPENROUTER", "source_id": "anthropic/claude-3.5-sonnet:completion", "name": "OpenRouter Claude Sonnet output ($/Mtok)", "max_staleness_days": 7},
{"code": "or_llama70b_in", "source": "OPENROUTER", "source_id": "meta-llama/llama-3.1-70b-instruct:prompt", "name": "OpenRouter Llama 70B input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_llama70b_out", "source": "OPENROUTER", "source_id": "meta-llama/llama-3.1-70b-instruct:completion", "name": "OpenRouter Llama 70B output ($/Mtok)", "max_staleness_days": 7},
{"code": "or_deepseek_in", "source": "OPENROUTER", "source_id": "deepseek/deepseek-chat:prompt", "name": "OpenRouter DeepSeek input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_deepseek_out", "source": "OPENROUTER", "source_id": "deepseek/deepseek-chat:completion", "name": "OpenRouter DeepSeek output ($/Mtok)", "max_staleness_days": 7},
{"code": "or_gemini_flash_in", "source": "OPENROUTER", "source_id": "google/gemini-2.0-flash-001:prompt", "name": "OpenRouter Gemini Flash input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_gemini_flash_out", "source": "OPENROUTER", "source_id": "google/gemini-2.0-flash-001:completion", "name": "OpenRouter Gemini Flash output ($/Mtok)", "max_staleness_days": 7},
{"code": "or_mistral_large_in", "source": "OPENROUTER", "source_id": "mistralai/mistral-large:prompt", "name": "OpenRouter Mistral Large input ($/Mtok)", "max_staleness_days": 7},
{"code": "or_mistral_large_out", "source": "OPENROUTER", "source_id": "mistralai/mistral-large:completion", "name": "OpenRouter Mistral Large output ($/Mtok)", "max_staleness_days": 7},
{"code": "steo_elec_ind_us", "source": "STEO", "source_id": "STEO.ESICU_US.M", "name": "STEO industrial electricity forecast (c/kWh, vintage-archived)", "max_staleness_days": 45},
{"code": "steo_power_pj", "source": "STEO", "source_id": "STEO.ELWHU_PJ.M", "name": "STEO PJM wholesale power ($/MWh, vintage-archived)", "max_staleness_days": 45}
```

- [ ] **Step 4: `pipeline/collect.py`.** Import list gains `dramex`, `openrouter`, `sfcompute`, `vastai` (alphabetical). Wrappers + FETCHERS:

```python
def _dramex(subset, key, http):
    return dramex.fetch([s.source_id for s in subset], http_get=http)


def _vastai(subset, key, http):
    return vastai.fetch([s.source_id for s in subset], http_get=http)


def _sfcompute(subset, key, http):
    return sfcompute.fetch([s.source_id for s in subset], http_get=http)


def _openrouter(subset, key, http):
    return openrouter.fetch([s.source_id for s in subset], http_get=http)
```

```python
            "EIA_STATE": _eia, "QCEW": _qcew, "CENSUS": _census,
            "DRAMEX": _dramex, "VASTAI": _vastai, "SFCOMPUTE": _sfcompute,
            "OPENROUTER": _openrouter,
            # STEO is a separate source key only for failure isolation — the
            # fetch mechanics are plain EIA (v2 seriesid route), like EIA_STATE.
            "STEO": _eia}
```

- [ ] **Step 5: `tests/test_run_daily.py` fake_get branches** (before the final `raise AssertionError`; fixtures are the spike's recorded files):

```python
    if "dramexchange.com" in url:
        return _text(FIXTURES / "dramex.html")
    if "console.vast.ai" in url:
        return FakeResponse(json.loads((FIXTURES / "vastai_bundles.json").read_text()))
    if "sfcompute.com" in url:
        return _text(FIXTURES / "sfcompute.html")
    if "openrouter.ai" in url:
        return FakeResponse(json.loads((FIXTURES / "openrouter_models.json").read_text()))
```

(STEO rides the existing `api.eia.gov` branch — the seriesid URL doesn't end `.W`, so it gets `eia_monthly.json`, same as the other EIA monthlies.)

- [ ] **Step 6: Full suite** — `.venv/bin/pytest -q` → all green (status rows now 22; nothing consumes the new series).
- [ ] **Step 7: Commit**

```bash
git add config/series.json pipeline/collect.py tests/test_registry.py tests/test_run_daily.py
git commit -m "feat(registry): 5 collector sources + 25 series (DRAMEX/VASTAI/SFCOMPUTE/OPENROUTER/STEO)"
```

---

### Task 7: Dormant DRAM proxy + honest mode label

**Files:**
- Modify: `config/dc_basket.json`, `pipeline/engine/dcindex.py` (run loop, ~lines 44–65)
- Test: `tests/test_dcindex.py`, `tests/test_dc_basket.py`

**Interfaces:**
- Consumes: registry code `dramex_nand_mlc64` (Task 6).
- Produces: hardware storage component carries the dormant proxy; `mode == "official+proxy"` ONLY when the spliced tail extends past the last official print.

- [ ] **Step 1: Write the failing tests.** In `tests/test_dcindex.py`:

```python
def test_dormant_proxy_labels_official_and_changes_nothing(tmp_path):
    # proxy rows exist but ALL post-date the last official print: splice
    # returns official-only, mode must NOT advertise a tail, no gate flags.
    build = [{"code": "copper_wire", "label": "Copper", "group": "materials",
              "series": "ppi_copper_wire", "weight": 1.0,
              "live_proxy": "fmp_copper"}]
    rows = [
        ("ppi_copper_wire", "2017-01-01", 100.0),
        ("ppi_copper_wire", "2018-01-01", 100.0),
        ("fmp_copper", "2018-01-10", 50.0), ("fmp_copper", "2018-01-11", 55.0),
    ] + OPS_ROWS
    conn = make_conn(tmp_path, rows)
    basket = write_basket(tmp_path, build, ONE_COMP_OPS)
    result = dcindex.run(conn, today="2018-01-12", basket_path=basket)
    b = result["indexes"]["build"]
    assert b["components"]["copper_wire"]["mode"] == "official"
    assert b["gate_flags"] == []
    assert max(b["index"]) == "2018-01-01"      # no tail beyond the print
```

Wait — `fmp_copper` obs at 2018-01-10/11 are AFTER the last official print (2018-01-01), and `splice_anchored` anchors at the last official print using a proxy obs at/before it; with none, it returns official-only. In `tests/test_dc_basket.py`, flip the wave-1 assertion:

```python
    # hardware v1 carried no proxies; wave 3a ships the dormant DRAM tail
    hw_proxied = {c.code: c.live_proxy for c in baskets["hardware"] if c.live_proxy}
    assert hw_proxied == {"storage": "dramex_nand_mlc64"}
```

(replacing `assert not any(c.live_proxy for c in baskets["hardware"])`).

- [ ] **Step 2: Verify failure** — the dcindex test fails on `mode == "official"` (current code says `official+proxy` whenever proxy rows exist); the dc_basket test fails on the missing config key.
- [ ] **Step 3: Config.** In `config/dc_basket.json`, the hardware `storage` component gains `"live_proxy": "dramex_nand_mlc64"`.
- [ ] **Step 4: Engine.** In `pipeline/engine/dcindex.py`'s component loop, track actual tail contribution:

```python
            tail_active = False
            if live:
                live_idx = rebase.rebase(live, base_month)
                official_end = max(idx)
                idx = blend_mod.splice_anchored(idx, live_idx)
                last = max(idx)
                tail_active = last > official_end
                # Gate only a real proxy tail. When the proxy has no points
                # past the last official print, `last` IS an official print:
                # official data is trusted (never held), matching the gauge —
                # otherwise a proxy vintage correction dated at the print
                # could hold a legitimate official month-over-month move.
                if tail_active:
                    idx, flagged = gate.apply_gate(
                        idx, _arrived_today(conn, comp.live_proxy, last, today))
                    if flagged:
                        flags.append(f"{comp.code}@{last}")
            built[comp.code] = idx
            # a proxy that contributes no tail must not advertise one — the
            # page's "Data" column reflects what today's series actually is
            modes[comp.code] = "official+proxy" if tail_active else "official"
```

(This replaces the `if last > official_end:` guard — `tail_active` is the same expression — and the old `modes[...] = "official+proxy" if live else "official"` line. The `live` declaration line stays; `tail_active = False` is initialized just before `if live:`.)

- [ ] **Step 5: Run** `.venv/bin/pytest tests/test_dcindex.py tests/test_dc_basket.py -q` → all pass, including the pre-existing proxy tests (active tails still label `official+proxy`; `test_official_print_not_gated_when_proxy_tail_is_empty` asserts flags/index only, both unchanged).
- [ ] **Step 6: Full suite** — `.venv/bin/pytest -q` → green. (`test_run_daily`'s end-to-end now runs the hardware basket with the dormant proxy: the DRAMEX fixture obs are vintage-dated today, far after the fixture PPI prints, so the splice stays dormant there too.)
- [ ] **Step 7: Commit**

```bash
git add config/dc_basket.json pipeline/engine/dcindex.py tests/test_dcindex.py tests/test_dc_basket.py
git commit -m "feat(dc): dormant NAND spot proxy on storage + honest official+proxy label"
```

---

### Task 8: Live collection run (CONTROLLER-EXECUTED)

- [ ] Step 1: `set -a; source .env; set +a && .venv/bin/python -m pipeline.run_daily --store store --out site/public/data` — exit 0. All 5 new source rows in `sources_status.json` with `ok: true` and sensible `fetched` counts (DRAMEX 3, VASTAI ≤5, SFCOMPUTE ~90, OPENROUTER 12, STEO ~900). A failed new source here: inspect before committing (drift in the hours since the spike is possible — refresh the fixture/strings if so).
- [ ] Step 2: Sanity: spot values within plausible ranges and consistent with the spike's numbers; `datacenter.json` hardware index BYTE-IDENTICAL in `index`/`yoy_pct` to the prior commit (dormant proxy changed nothing) and storage component `mode` still `"official"`; STEO store rows include future obs_dates.
- [ ] Step 3: `git add store site/public/data && git commit -m "data: first collection — DRAM/GPU/inference spot + STEO vintages"`.

---

### Task 9: Final gates, docs, review (CONTROLLER-EXECUTED)

- [ ] Step 1: full gates from clean state (pytest; site build/test/e2e — site untouched but the datacenter.json republish must keep it green).
- [ ] Step 2: `CLAUDE.md`: connector count 16 → 20 (add vastai/openrouter to the API list, dramex/sfcompute to the scrape list); test-count string to the new pytest total.
- [ ] Step 3: commit docs; final whole-branch review (most capable model) with ledger minors; STOP for push approval.

---

## Self-review notes

- **Spec coverage:** §3.1–3.5 sources → Tasks 2–6; §4 dormant proxy + label → Task 7; §5 wiring/pins → Task 6; §6 tests → embedded; spike-first honesty rule → Task 1 + SPIKE-FINAL markers throughout; live verification → Task 8.
- **Type consistency:** all four `fetch(source_ids, vintage_date=None, http_get=None)` signatures match their collect wrappers; `MIN_OFFERS`/`PLAUSIBLE` exports match test imports; `tail_active` replaces the identical `last > official_end` guard so gate semantics are untouched.
- **Known seams:** the sfcompute `ROW_RE` escaping and the dramex `AVG_CELL` position are the two highest-drift-risk pins — both are explicitly spike-owned, and their tests run against the recorded fixture rather than synthetic HTML precisely so a wrong pin fails loudly in Task 2/4 rather than silently in production.
- **Pin arithmetic:** 3+5+3+12+2 = 25 series; 242+25 = 267; 17+5 = 22 sources.
