# DC Hardware Index + Hedonic-Gap Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third index ("DC Hardware" — chips, memory, storage, servers, network) to `/datacenter`, plus a hedonic-gap panel of ~11 official IT-hardware price series, per `docs/superpowers/specs/2026-07-15-dc-hardware-index-design.md`.

**Architecture:** Five transaction-sensitive official FRED series form a new fixed-weight basket flowing through the existing `dcindex` engine (rebase → aggregate; no live proxy, no gate in v1). Panel YoY (at each series' own last observation) is computed in the engine from 11 registry series and published in `datacenter.json` alongside `indexes.hardware`. The site refactors `DcIndexChart` from two fixed series to N and adds a diverging-bar gap panel.

**Tech Stack:** Python 3.12 pipeline (pytest), Next.js static site (vitest + Playwright), JSON Schema validation.

## Global Constraints

- **No network in tests, ever.** `test_run_daily.py`'s generic FRED fake serves any FRED series id from `fred_cpiaucns.json` — new FRED series need **no** new fixtures.
- **No invented series IDs.** All 11 FRED ids below were verified live 2026-07-15 (spec §3).
- Weights per basket must sum to exactly 1.0 (validated on load).
- Official prints are never gated/held; the gate is proxy-tail-scoped and hardware v1 has no proxy.
- Component YoY at each component's OWN last observation (`aggregate.yoy_at_obs`), never grid end.
- `jsonschema.ValidationError` must still fail the run (schema updated in the same task as the payload change).
- Site computes nothing beyond presentation (sorting is presentation; precedent `page.tsx` parity strips).
- Commit after every task; run `pytest -q` (pipeline tasks) or `npm run build && npm test` in `site/` (site tasks) before each commit.
- Do NOT push. Push = deploy; the user approves pushes explicitly.

---

### Task 1: Weight citation spike (research, no code)

**Files:**
- Create: `docs/superpowers/specs/2026-07-15-dc-hardware-spike-notes.md`

**Interfaces:**
- Produces: confirmed group weights (compute/storage/network) and lens subdivision used verbatim in Task 3's `config/dc_basket.json`. If the spike moves the shares, Task 3 uses the spike's numbers — group sums are what citations must support; the 0.35/0.15/0.10 compute-lens split is our editorial blend and is documented as such.

- [ ] **Step 1: Research published DC IT-capex breakdowns** (WebSearch/WebFetch). Targets, in order of authority: Dell'Oro Group data-center capex reports (server share of DC IT capex), Synergy Research (server/storage/network split), IDC infrastructure trackers, SemiAnalysis AI-datacenter cost anatomy. Record: source, date, the split it supports, URL. Sanity targets from the spec: compute ≈ 0.60, storage ≈ 0.25, network ≈ 0.15. Storage at 0.25 is above pre-AI norms (~0.15) — justify with the 2025–26 memory/storage price-cycle salience *and* at least one citation on storage share of AI-era buildouts, or lower it to what citations support and re-split (weights must still sum to 1.0; keep three groups).

- [ ] **Step 2: Write the notes doc.** Structure it exactly like `docs/superpowers/specs/2026-07-12-dc-series-spike-notes.md` (read it first): per-group table of citations → chosen weight; a "lens subdivision" section explaining compute = imported-finished-goods 0.35 + domestic-components 0.15 + imported-chips 0.10 (editorial blend, group sum is what's cited); an "excluded series, with receipts" section carrying the spec's exclusions (`PCU3344133344131` publication hole, dead fiber PPI, hedonic exclusions).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-15-dc-hardware-spike-notes.md
git commit -m "docs: DC Hardware weight citation spike notes"
```

---

### Task 2: Registry — 11 new FRED series

**Files:**
- Modify: `config/series.json` (append to `"series"` array, after the entry with code `"ppi_mach_repair"`)
- Test: `tests/test_registry.py:14,20,25-` (count pins + `fred_ids` dict)

**Interfaces:**
- Produces: registry codes `ppi_storage`, `ppi_semis_components`, `ppi_network_equip`, `mxp_computers_exsemi`, `mxp_semis`, `mxp_semis_comp_naics`, `ppi_semi_headline`, `ppi_servers`, `ppi_ic_packages`, `ppi_wafers`, `cpi_computers` — Tasks 3–5 reference these exact codes. Collection is automatic (`collect.py` fans out by source; `id_map` remaps source_id → code).

- [ ] **Step 1: Update the failing pins first.** In `tests/test_registry.py`: change `assert len(series) == 229` → `240` and `assert len(fred) == 62` → `73`; add to the `fred_ids` dict (keep its style):

```python
            "ppi_storage": "PCU334112334112",
            "ppi_semis_components": "PCU33443344",
            "ppi_network_equip": "PCU334210334210",
            "mxp_computers_exsemi": "IR213COM",
            "mxp_semis": "IR21320",
            "mxp_semis_comp_naics": "IZ3344",
            "ppi_semi_headline": "PCU334413334413",
            "ppi_servers": "PCU3341113341115",
            "ppi_ic_packages": "WPU117839",
            "ppi_wafers": "PCU334413334413A",
            "cpi_computers": "CUUR0000SEEE01",
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_registry.py -q`
Expected: FAIL — `len(series) == 240` (still 229).

- [ ] **Step 3: Append the 11 entries to `config/series.json`** immediately after the `ppi_mach_repair` object:

```json
    {"code": "ppi_storage", "source": "FRED", "source_id": "PCU334112334112", "name": "PPI computer storage device mfg", "max_staleness_days": 80},
    {"code": "ppi_semis_components", "source": "FRED", "source_id": "PCU33443344", "name": "PPI semiconductor & electronic component mfg (group)", "max_staleness_days": 80},
    {"code": "ppi_network_equip", "source": "FRED", "source_id": "PCU334210334210", "name": "PPI telephone apparatus mfg (network equipment)", "max_staleness_days": 80},
    {"code": "mxp_computers_exsemi", "source": "FRED", "source_id": "IR213COM", "name": "Import price: computers, peripherals ex-semiconductors", "max_staleness_days": 110},
    {"code": "mxp_semis", "source": "FRED", "source_id": "IR21320", "name": "Import price: semiconductors (end use)", "max_staleness_days": 110},
    {"code": "mxp_semis_comp_naics", "source": "FRED", "source_id": "IZ3344", "name": "Import price: semis & electronic components (NAICS 3344)", "max_staleness_days": 110},
    {"code": "ppi_semi_headline", "source": "FRED", "source_id": "PCU334413334413", "name": "PPI semiconductor & related device mfg (headline)", "max_staleness_days": 80},
    {"code": "ppi_servers", "source": "FRED", "source_id": "PCU3341113341115", "name": "PPI host computers & servers", "max_staleness_days": 80},
    {"code": "ppi_ic_packages", "source": "FRED", "source_id": "WPU117839", "name": "PPI integrated circuit packages incl. microprocessors", "max_staleness_days": 80},
    {"code": "ppi_wafers", "source": "FRED", "source_id": "PCU334413334413A", "name": "PPI other semiconductor devices incl. wafers", "max_staleness_days": 80},
    {"code": "cpi_computers", "source": "FRED", "source_id": "CUUR0000SEEE01", "name": "CPI computers, peripherals & smart home assistants", "max_staleness_days": 80},
```

MXP series get 110 days (release covers one month earlier than PPI — spec §3 staleness).

- [ ] **Step 4: Run the full pipeline suite**

Run: `pytest -q`
Expected: PASS (346 tests). The `test_run_daily.py` FRED fake serves any series id; the source-count pin (16) is untouched.

- [ ] **Step 5: Commit**

```bash
git add config/series.json tests/test_registry.py
git commit -m "feat(registry): 11 FRED series for DC Hardware index + hedonic-gap panel"
```

---

### Task 3: Basket config + loader — hardware basket and hardware_gap rows

**Files:**
- Modify: `config/dc_basket.json`, `pipeline/dc_basket.py`
- Test: `tests/test_dc_basket.py`, helper in `tests/test_dcindex.py`

**Interfaces:**
- Consumes: Task 2 registry codes.
- Produces: `load_baskets()` now returns `{"build","ops","hardware"}`; new frozen dataclass `GapRow(code: str, label: str, series: str, in_basket: bool)` and `load_hardware_gap(path: Path | None = None, registry_codes: set[str] | None = None) -> list[GapRow]` (config order preserved; `in_basket` derived from hardware-basket series membership; unknown series / duplicate codes raise ValueError). Task 4 calls both.

- [ ] **Step 1: Write the failing tests.** In `tests/test_dc_basket.py`, update `test_load_real_baskets` and add gap tests:

```python
def test_load_real_baskets():
    base_month, baskets = dc_basket.load_baskets()
    assert base_month == "2018-01"
    assert set(baskets) == {"build", "ops", "hardware"}
    for name, comps in baskets.items():
        assert abs(sum(c.weight for c in comps) - 1.0) <= 1e-9
    proxied = {c.code: c.live_proxy for c in baskets["build"] if c.live_proxy}
    assert proxied == {"copper_wire": "fmp_copper", "alum_shapes": "fmp_alum"}
    # hardware v1 is official-only: no proxies, and its groups have labels
    assert not any(c.live_proxy for c in baskets["hardware"])
    labels = dc_basket.load_group_labels()
    assert {c.group for c in baskets["hardware"]} <= set(labels)
    w_labor, w_power = dc_basket.parity_shares(baskets)
    assert 0 < w_labor < 1 and 0 < w_power < 1
    assert labels["labor"]


def test_load_real_hardware_gap():
    rows = dc_basket.load_hardware_gap()
    assert len(rows) == 11
    _, baskets = dc_basket.load_baskets()
    hw_series = {c.series for c in baskets["hardware"]}
    assert {r.series for r in rows if r.in_basket} == hw_series
    assert sum(r.in_basket for r in rows) == 5
    codes = [r.code for r in rows]
    assert len(codes) == len(set(codes))


def test_hardware_gap_unknown_series_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 1.0}],
               OK_OPS,
               gap=[{"code": "g", "label": "G", "series": "nope"}])
    with pytest.raises(ValueError, match="unknown series code"):
        dc_basket.load_hardware_gap(p, registry_codes={"s_a", "s_p", "s_h"})


def test_hardware_gap_duplicate_codes_rejected(tmp_path):
    p = _write(tmp_path,
               [{"code": "a", "label": "A", "group": "labor", "series": "s_a", "weight": 1.0}],
               OK_OPS,
               gap=[{"code": "g", "label": "G", "series": "s_a"},
                    {"code": "g", "label": "G2", "series": "s_p"}])
    with pytest.raises(ValueError, match="duplicate"):
        dc_basket.load_hardware_gap(p, registry_codes={"s_a", "s_p", "s_h"})
```

Update the `_write` helper so every tmp basket file carries all three baskets (loaders iterate the full tuple) and an optional gap list:

```python
OK_HW = [{"code": "hw", "label": "H", "group": "compute", "series": "s_h", "weight": 1.0}]


def _write(tmp_path, build, ops, hardware=None, gap=None):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops,
                             "hardware": hardware or OK_HW,
                             "hardware_gap": gap or []}))
    return p
```

Existing `_write` callers pass `registry_codes` explicitly — add `"s_h"` to each call's set (three tests).

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dc_basket.py -q`
Expected: FAIL — real config has no `"hardware"` key; `load_hardware_gap` doesn't exist.

- [ ] **Step 3: Update `config/dc_basket.json`.** Add to `group_labels` (existing seven keys untouched):

```json
        "compute": "Compute",
        "storage": "Storage & memory",
        "network": "Network equipment"
```

Add after the `"ops"` array (weights: Task 1 spike numbers; the values below are the spec's provisional shares — replace only if the spike moved them):

```json
    "hardware": [
        {"code": "hw_imported", "label": "Imported hardware ex-semis", "group": "compute", "series": "mxp_computers_exsemi", "weight": 0.35},
        {"code": "semis_components", "label": "Semis & electronic components", "group": "compute", "series": "ppi_semis_components", "weight": 0.15},
        {"code": "imported_semis", "label": "Imported semiconductors", "group": "compute", "series": "mxp_semis", "weight": 0.10},
        {"code": "storage", "label": "Computer storage devices", "group": "storage", "series": "ppi_storage", "weight": 0.25},
        {"code": "network", "label": "Network & telephone apparatus", "group": "network", "series": "ppi_network_equip", "weight": 0.15}
    ],
    "hardware_gap": [
        {"code": "storage", "label": "Computer storage devices PPI", "series": "ppi_storage"},
        {"code": "semis_imports_naics", "label": "Import: semis & components (NAICS)", "series": "mxp_semis_comp_naics"},
        {"code": "semis_components", "label": "Semis & components group PPI", "series": "ppi_semis_components"},
        {"code": "hw_imported", "label": "Import: computers ex-semis", "series": "mxp_computers_exsemi"},
        {"code": "network", "label": "Network & telephone apparatus PPI", "series": "ppi_network_equip"},
        {"code": "ic_packages", "label": "IC packages incl. microprocessors PPI", "series": "ppi_ic_packages"},
        {"code": "imported_semis", "label": "Import: semiconductors", "series": "mxp_semis"},
        {"code": "servers", "label": "Servers (host computers) PPI", "series": "ppi_servers"},
        {"code": "semi_headline", "label": "Semiconductor mfg PPI (headline)", "series": "ppi_semi_headline"},
        {"code": "cpi_computers", "label": "CPI computers & peripherals", "series": "cpi_computers"},
        {"code": "wafers", "label": "Other semis incl. wafers PPI", "series": "ppi_wafers"}
    ]
```

- [ ] **Step 4: Update `pipeline/dc_basket.py`.** Change line 37's tuple and add the gap loader:

```python
    for name in ("build", "ops", "hardware"):
```

Update `load_baskets`'s docstring first line to `"""(base_month, {"build": [...], "ops": [...], "hardware": [...]})."""` (keep the rest). Append at module end:

```python
@dataclass(frozen=True)
class GapRow:
    code: str                   # panel row id
    label: str                  # display label
    series: str                 # store series code
    in_basket: bool             # derived: series is a hardware-basket backbone


def load_hardware_gap(path: Path | None = None,
                      registry_codes: set[str] | None = None) -> list[GapRow]:
    """Hedonic-gap panel rows, config order. in_basket is DERIVED from
    hardware-basket series membership — never hand-maintained (spec §2)."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    rows = raw.get("hardware_gap", [])
    if registry_codes is None:
        from pipeline import registry
        _, series = registry.load_registry()
        registry_codes = {s.code for s in series}
    hw_series = {c["series"] for c in raw.get("hardware", [])}
    out = [GapRow(code=r["code"], label=r["label"], series=r["series"],
                  in_basket=r["series"] in hw_series) for r in rows]
    codes = [r.code for r in out]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"hardware_gap: duplicate codes {sorted(dupes)}")
    for r in out:
        if r.series not in registry_codes:
            raise ValueError(f"hardware_gap/{r.code}: unknown series code {r.series}")
    return out
```

- [ ] **Step 5: Fix `tests/test_dcindex.py`'s helper** (its tmp baskets now also need the hardware key — `dcindex.run` loads the full tuple). `ppi_steel` is a real registry code, so the default satisfies registry validation:

```python
ONE_COMP_HW = [
    {"code": "hw", "label": "HW", "group": "compute", "series": "ppi_steel", "weight": 1.0},
]


def write_basket(tmp_path, build, ops, hardware=None, gap=None):
    p = tmp_path / "dc_basket.json"
    p.write_text(json.dumps({"base_month": "2018-01", "group_labels": {},
                             "build": build, "ops": ops,
                             "hardware": hardware or ONE_COMP_HW,
                             "hardware_gap": gap or []}))
    return p
```

`ONE_COMP_HW` rides `ppi_steel`, which already has store rows in most tests. Two tests need attention: `test_component_with_no_grid_observations_raises_named_error` (its steel rows predate the grid — the hardware basket now ALSO fails on steel, same ValueError, match="steel" still passes) and `test_missing_series_raises_clear_error` (no steel rows at all — still raises ValueError; passes). `test_proxy_splice_and_gate` and `test_official_print_not_gated_when_proxy_tail_is_empty` have copper rows but no steel rows — their hardware basket would raise. Give those two an explicit hardware basket on a series they already populate:

```python
    # in both proxy tests, pass: hardware=[{"code": "hw", "label": "HW", "group": "compute",
    #                                       "series": "ppi_copper_wire", "weight": 1.0}]
    basket = write_basket(tmp_path, build, ONE_COMP_OPS,
                          hardware=[{"code": "hw", "label": "HW", "group": "compute",
                                     "series": "ppi_copper_wire", "weight": 1.0}])
```

- [ ] **Step 6: Run the affected suites**

Run: `pytest tests/test_dc_basket.py tests/test_dcindex.py -q`
Expected: PASS.

- [ ] **Step 7: Run the full suite** (registry validation of the real config, run_daily end-to-end — the datacenter phase now builds three indexes from fixture data)

Run: `pytest -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add config/dc_basket.json pipeline/dc_basket.py tests/test_dc_basket.py tests/test_dcindex.py
git commit -m "feat(dc): hardware basket + hedonic-gap rows in dc_basket config/loader"
```

---

### Task 4: Engine — panel YoY in dcindex.run

**Files:**
- Modify: `pipeline/engine/dcindex.py` (`run()`, lines 39–90)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Consumes: `dc_basket.load_hardware_gap(basket_path)` (Task 3).
- Produces: `dcindex.run()`'s return dict gains `"hardware_gap": list[dict]`, each `{"code": str, "label": str, "series": str, "in_basket": bool, "yoy_pct": float | None, "last_obs": str}` in config order; rows whose store series is empty are OMITTED (a broken panel-only series degrades to a missing row, never an error). Task 5's publisher consumes this shape.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_dcindex.py`):

```python
GAP_HW = [{"code": "hw", "label": "HW", "group": "compute",
           "series": "ppi_storage", "weight": 1.0}]


def test_hardware_gap_yoy_at_own_last_obs(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("ppi_storage", "2017-01-01", 100.0), ("ppi_storage", "2018-01-01", 120.0),
        ("ppi_servers", "2017-02-01", 200.0), ("ppi_servers", "2018-02-01", 202.0),
    ] + OPS_ROWS)
    basket = write_basket(
        tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS, hardware=GAP_HW,
        gap=[{"code": "storage", "label": "Storage PPI", "series": "ppi_storage"},
             {"code": "servers", "label": "Servers PPI", "series": "ppi_servers"}])
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket)
    panel = {r["code"]: r for r in result["hardware_gap"]}
    assert [r["code"] for r in result["hardware_gap"]] == ["storage", "servers"]
    assert panel["storage"]["in_basket"] is True
    assert panel["storage"]["yoy_pct"] == pytest.approx(20.0)
    assert panel["storage"]["last_obs"] == "2018-01-01"
    # servers is NOT in the basket, and its YoY sits at ITS own last obs
    assert panel["servers"]["in_basket"] is False
    assert panel["servers"]["yoy_pct"] == pytest.approx(1.0)
    assert panel["servers"]["last_obs"] == "2018-02-01"


def test_hardware_gap_missing_base_is_none_and_empty_series_omitted(tmp_path):
    conn = make_conn(tmp_path, [
        ("ppi_steel", "2017-01-01", 100.0), ("ppi_steel", "2018-01-01", 110.0),
        ("ppi_concrete", "2017-01-01", 200.0), ("ppi_concrete", "2018-01-01", 210.0),
        ("ppi_storage", "2017-01-01", 100.0), ("ppi_storage", "2018-01-01", 120.0),
        # cpi_computers first obs 2017-09: its 2018-01 YoY base (2017-01) is missing
        ("cpi_computers", "2017-09-01", 50.0), ("cpi_computers", "2018-01-01", 51.0),
        # ppi_wafers has NO store rows at all
    ] + OPS_ROWS)
    basket = write_basket(
        tmp_path, TWO_COMP_BUILD, ONE_COMP_OPS, hardware=GAP_HW,
        gap=[{"code": "storage", "label": "Storage PPI", "series": "ppi_storage"},
             {"code": "cpi_computers", "label": "CPI computers", "series": "cpi_computers"},
             {"code": "wafers", "label": "Wafers PPI", "series": "ppi_wafers"}])
    result = dcindex.run(conn, today="2018-02-15", basket_path=basket)
    panel = {r["code"]: r for r in result["hardware_gap"]}
    assert set(panel) == {"storage", "cpi_computers"}   # wafers row omitted
    assert panel["cpi_computers"]["yoy_pct"] is None    # base predates first obs
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dcindex.py -q -k hardware_gap`
Expected: FAIL — `KeyError: 'hardware_gap'`.

- [ ] **Step 3: Implement.** In `pipeline/engine/dcindex.py` `run()`, replace the final `return` line:

```python
    # Hedonic-gap panel: YoY at each series' OWN last observation, same
    # like-month honesty as basket components (yoy_at_obs omits month-hole
    # bases). A panel-only series with no store rows degrades to a missing
    # row — it must never take the whole index down (unlike basket
    # components, whose absence raises above).
    panel = []
    for row in dc_basket.load_hardware_gap(basket_path):
        s = _series(conn, row.series)
        if not s:
            continue
        last = max(s)
        filled = aggregate.fill_daily(s, GRID_START, last)
        panel.append({"code": row.code, "label": row.label, "series": row.series,
                      "in_basket": row.in_basket,
                      "yoy_pct": aggregate.yoy_at_obs(s, filled).get(last),
                      "last_obs": last})
    return {"base_month": base_month, "indexes": out, "hardware_gap": panel}
```

Also update the module docstring's first line: `"""DC cost index engine: three input-cost indexes (build, ops, hardware) + state parity + hedonic-gap panel."""`

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_dcindex.py -q`
Expected: PASS (all, including the pre-existing ones via the Task 3 helper).

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): hedonic-gap panel YoY (own-last-obs) in dcindex.run"
```

---

### Task 5: Publisher + schema + run_daily wiring

**Files:**
- Modify: `pipeline/publish/datacenter.py`, `schemas/datacenter.schema.json`, `pipeline/run_daily.py` (`_datacenter_phase`, ~line 263)
- Test: `tests/test_datacenter_writer.py`

**Interfaces:**
- Consumes: Task 4's `dc_result["hardware_gap"]` shape; registry `series` list already in scope in `run_daily.main`.
- Produces: `datacenter.build(dc_result: dict, parity_result: dict, source_ids: dict[str, str]) -> dict` — **third positional parameter added** (maps registry series code → provider source_id). Published `hardware_gap` rows: `{"code", "label", "source_id", "yoy_pct", "last_obs", "in_basket"}`.

- [ ] **Step 1: Write the failing tests.** In `tests/test_datacenter_writer.py`, extend `DC_RESULT` and both tests:

```python
# add inside DC_RESULT["indexes"], after "ops":
        "hardware": {
            "index": {"2018-01-01": 100.0, "2018-06-01": 112.0},
            "yoy": {"2018-01-01": None, "2018-06-01": 12.0},
            "as_of": "2018-06-01", "gate_flags": [],
            "components": {
                "storage": {"label": "Storage", "group": "storage", "weight": 1.0,
                            "mode": "official", "yoy_pct": 12.0,
                            "last_obs": "2018-06-01"}}},

# add as a new top-level key in DC_RESULT (sibling of "indexes"):
    "hardware_gap": [
        {"code": "storage", "label": "Storage PPI", "series": "ppi_storage",
         "in_basket": True, "yoy_pct": 12.345, "last_obs": "2018-06-01"},
        {"code": "cpi_computers", "label": "CPI computers", "series": "cpi_computers",
         "in_basket": False, "yoy_pct": None, "last_obs": "2018-05-01"}],

SOURCE_IDS = {"ppi_storage": "PCU334112334112", "cpi_computers": "CUUR0000SEEE01"}
```

Update both tests to pass `SOURCE_IDS` and assert the new payload:

```python
def test_build_publishes_from_2018_with_contributions():
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS)
    ...existing assertions unchanged...
    gap = {r["code"]: r for r in payload["hardware_gap"]}
    assert gap["storage"]["source_id"] == "PCU334112334112"
    assert gap["storage"]["yoy_pct"] == 12.35          # rounded 2dp
    assert gap["storage"]["in_basket"] is True
    assert gap["cpi_computers"]["yoy_pct"] is None
    assert payload["indexes"]["hardware"]["headline_yoy_pct"] == 12.0


def test_written_file_validates_against_schema(tmp_path):
    payload = datacenter.build(DC_RESULT, PARITY, SOURCE_IDS)
    ...unchanged...
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_datacenter_writer.py -q`
Expected: FAIL — `build()` takes 2 positional args.

- [ ] **Step 3: Implement the writer.** In `pipeline/publish/datacenter.py`, change the signature and add the block before `return out`:

```python
def build(dc_result: dict, parity_result: dict, source_ids: dict[str, str]) -> dict:
```

```python
    out["hardware_gap"] = [
        {"code": r["code"], "label": r["label"],
         "source_id": source_ids.get(r["series"], r["series"]),
         "yoy_pct": None if r["yoy_pct"] is None else round(r["yoy_pct"], 2),
         "last_obs": r["last_obs"], "in_basket": r["in_basket"]}
        for r in dc_result.get("hardware_gap", [])]
```

Update the module docstring: `"""Writer for datacenter.json — DC Build/Ops/Hardware cost indexes, hedonic-gap panel, state parity."""`

- [ ] **Step 4: Update the schema.** In `schemas/datacenter.schema.json`: top-level `"required"` becomes `["published_at", "rebase", "group_labels", "indexes", "parity", "hardware_gap"]`; `indexes.required` becomes `["build", "ops", "hardware"]`; add to top-level `"properties"`:

```json
"hardware_gap": {"type": "array", "items": {"type": "object",
  "required": ["code", "label", "source_id", "yoy_pct", "last_obs", "in_basket"],
  "properties": {"code": {"type": "string"}, "label": {"type": "string"},
    "source_id": {"type": "string"}, "yoy_pct": {"type": ["number", "null"]},
    "last_obs": {"type": "string"}, "in_basket": {"type": "boolean"}}}}
```

- [ ] **Step 5: Wire run_daily.** In `pipeline/run_daily.py` `_datacenter_phase`:

```python
        dc_path = datacenter_json.write(
            datacenter_json.build(dc_result, parity_result,
                                  {s.code: s.source_id for s in series}),
            args.out, published_at=published_at)
```

- [ ] **Step 6: Run the full suite**

Run: `pytest -q`
Expected: PASS. (`test_run_daily` exercises the datacenter phase end-to-end: three indexes + panel from fixture data, schema-validated inline.)

- [ ] **Step 7: Commit**

```bash
git add pipeline/publish/datacenter.py schemas/datacenter.schema.json pipeline/run_daily.py tests/test_datacenter_writer.py
git commit -m "feat(dc): publish indexes.hardware + hardware_gap in datacenter.json (schema-pinned)"
```

---

### Task 6: Regenerate real data (local pipeline run)

The site statically imports `site/public/data/datacenter.json`; Tasks 7–8 compile against `dc.indexes.hardware` and `dc.hardware_gap`, so the checked-in JSON must carry them BEFORE the site work.

**Files:**
- Modify (generated): `site/public/data/*.json`, `store/obs/*.jsonl`

**Interfaces:**
- Produces: `datacenter.json` containing `indexes.hardware` and an 11-row `hardware_gap`, consumed by Tasks 7–8 at build time.

- [ ] **Step 1: Run the pipeline with real keys** (network; keys in `.env` at repo root):

```bash
set -a; source .env; set +a
python -m pipeline.run_daily --store store --out site/public/data
```

Expected: exit 0; `published: .../datacenter.json` among the outputs. Connector failures (if any) surface in `sources_status.json` without blocking — but a FRED failure here means the new ids didn't fetch: STOP and inspect rather than proceeding with a partial hardware index.

- [ ] **Step 2: Sanity-check the artifact**

```bash
python3 -c "
import json
d = json.load(open('site/public/data/datacenter.json'))
hw = d['indexes']['hardware']
print('hardware headline YoY:', hw['headline_yoy_pct'], 'as_of', hw['as_of'])
print('components:', [(c['code'], c['yoy_pct']) for c in hw['components']])
print('gap rows:', [(r['code'], r['yoy_pct']) for r in d['hardware_gap']])
assert len(d['hardware_gap']) == 11 and len(hw['components']) == 5
print('qa says datacenter_ok:', json.load(open('site/public/data/qa.json'))['datacenter_ok'])
"
```

Expected: headline in the ~+15–20% range (spec §2); 11 gap rows with values matching the research signs (storage ~+31, cpi_computers ~−1); `datacenter_ok: True`. If the headline is wildly off the spec's expectation, STOP and investigate before committing.

- [ ] **Step 3: Commit store + data** (house pattern: data commits carry both)

```bash
git add store site/public/data
git commit -m "data: local publish with DC Hardware index + hedonic-gap panel"
```

---

### Task 7: Site — DcIndexChart N-series refactor + third KPI + hardware table

**Files:**
- Modify: `site/src/components/DcIndexChart.tsx`, `site/src/app/datacenter/page.tsx`

**Interfaces:**
- Consumes: Task 6's regenerated `datacenter.json`.
- Produces: `DcIndexChart({ series })` with `series: { key: string; label: string; dates: string[]; index: number[]; yoy: (number | null)[] }[]` — colors assigned inside the chart by position from `[C.sky, C.violet, C.amber]` (fixed order = fixed identity; page always passes build, ops, hardware).

- [ ] **Step 1: Refactor `DcIndexChart.tsx`.** Replace the props type and series construction (keep modes, tooltip, PNG export, layout untouched):

```tsx
export type DcSeries = {
  key: string;
  label: string;
  dates: string[];
  index: number[];
  yoy: (number | null)[];
};

const LINE_COLORS = [C.sky, C.violet, C.amber];

export function DcIndexChart({ series }: { series: DcSeries[] }) {
  const [mode, setMode] = useState<Mode>("level");
  const wrapRef = useRef<HTMLDivElement>(null);

  const option = useMemo(() => {
    const base = baseOption();
    const level = mode === "level";
    return {
      ...base,
      tooltip: level
        ? { ...base.tooltip,
            valueFormatter: (v: unknown) =>
              typeof v === "number" ? v.toFixed(2) : "—" }
        : base.tooltip,
      yAxis: level
        ? { ...base.yAxis, axisLabel: { color: C.muted }, scale: true }
        : { ...base.yAxis, scale: true },
      series: series.map((s, i) => ({
        name: s.label, type: "line", showSymbol: false,
        data: pair(s.dates, level ? s.index : s.yoy),
        lineStyle: { width: 2, color: LINE_COLORS[i % LINE_COLORS.length] },
        itemStyle: { color: LINE_COLORS[i % LINE_COLORS.length] },
      })),
    };
  }, [mode, series]);
```

(The `pair` helper, `exportPng`, and the JSX below stay byte-identical.)

- [ ] **Step 2: Update `page.tsx`.** Metadata (line 11):

```tsx
  title: `Data Center Cost Index: build ${fmtSigned(dc.indexes.build.headline_yoy_pct)} · ops ${fmtSigned(dc.indexes.ops.headline_yoy_pct)} · hardware ${fmtSigned(dc.indexes.hardware.headline_yoy_pct)} YoY`,
```

In the component body (after `const ops = dc.indexes.ops;`):

```tsx
  const hardware = dc.indexes.hardware;
```

Include hardware gate flags in the existing `gateFlags` spread (always `[]` in v1, wired now so a future proxy shows up):

```tsx
  const gateFlags = [
    ...(build.gate_flags as string[]),
    ...(ops.gate_flags as string[]),
    ...(hardware.gate_flags as string[]),
  ];
```

Third KPI card after the ops card:

```tsx
        <KpiCard label="DC Hardware YoY" value={fmtSigned(hardware.headline_yoy_pct)}
                 context={`IT hardware input costs · as of ${hardware.as_of}`} accent="amber" />
```

Chart call becomes:

```tsx
      <DcIndexChart series={[
        { key: "build", label: "DC Build", dates: build.dates, index: build.index, yoy: build.yoy_pct },
        { key: "ops", label: "DC Ops", dates: ops.dates, index: ops.index, yoy: ops.yoy_pct },
        { key: "hardware", label: "DC Hardware", dates: hardware.dates, index: hardware.index, yoy: hardware.yoy_pct },
      ]} />
```

Hardware component table third, after the ops table:

```tsx
      <ComponentTable title="DC Hardware components" comps={hardware.components as Comp[]} groupHeaders />
```

- [ ] **Step 3: Build + tests**

Run: `cd site && npx tsc --noEmit && npm run build && npm test`
Expected: all green (no vitest changes — nothing client-computed was added).

- [ ] **Step 4: Commit**

```bash
git add site/src/components/DcIndexChart.tsx site/src/app/datacenter/page.tsx
git commit -m "feat(site): DC Hardware — third index line, KPI, component table; DcIndexChart takes N series"
```

---

### Task 8: Site — HardwareGapPanel + methodology + e2e

**Files:**
- Create: `site/src/components/HardwareGapPanel.tsx`
- Modify: `site/src/app/datacenter/page.tsx`

**Interfaces:**
- Consumes: `dc.hardware_gap` rows `{ code, label, source_id, yoy_pct, last_obs, in_basket }`.
- Produces: `HardwareGapPanel({ rows })`, a server component (no `"use client"`).

- [ ] **Step 1: Create `site/src/components/HardwareGapPanel.tsx`:**

```tsx
import { fmtSigned } from "@/lib/format";

export type GapRow = {
  code: string;
  label: string;
  source_id: string;
  yoy_pct: number | null;
  last_obs: string;
  in_basket: boolean;
};

// Diverging bars: red = rising costs, emerald = falling (page-wide semantic).
// Sorting is presentation-only (precedent: parity cheapest/priciest strips);
// null YoY sinks to the bottom.
export function HardwareGapPanel({ rows }: { rows: GapRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => (b.yoy_pct ?? -Infinity) - (a.yoy_pct ?? -Infinity)
  );
  const max = Math.max(...rows.map((r) => Math.abs(r.yoy_pct ?? 0)), 0.01);
  return (
    <div className="table-card">
      <h2>Same hardware, eleven official answers <span className="subtitle">why the index uses transaction-sensitive series</span></h2>
      <table className="data-table">
        <thead><tr><th>Official series</th><th>ID</th><th></th><th>YoY</th><th>Last obs</th><th></th></tr></thead>
        <tbody>
          {sorted.map((r) => {
            const v = r.yoy_pct;
            return (
              <tr key={r.code}>
                <td>{r.label}</td>
                <td><span className="badge badge-muted">{r.source_id}</span></td>
                <td style={{ minWidth: 120 }}>
                  <span style={{ display: "inline-block", verticalAlign: "middle",
                                 height: 8, borderRadius: 2,
                                 width: `${(Math.abs(v ?? 0) / max) * 110}px`,
                                 background: (v ?? 0) >= 0 ? "var(--accent-red)" : "var(--accent-emerald)" }} />
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtSigned(v)}</td>
                <td>{r.last_obs}</td>
                <td>{r.in_basket
                  ? <span className="badge badge-muted" style={{ color: "var(--accent-amber)" }}>in index</span>
                  : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `page.tsx`.** Import, then render directly after the hardware `ComponentTable`:

```tsx
import { HardwareGapPanel, type GapRow } from "@/components/HardwareGapPanel";
```

```tsx
      <HardwareGapPanel rows={dc.hardware_gap as GapRow[]} />
```

- [ ] **Step 3: Extend the methodology paragraph.** Append to the existing `<p className="method">` (before the closing tag), keeping the current text intact:

```tsx
        {" "}The DC Hardware index uses only transaction-sensitive official series; the
        hedonically quality-adjusted series (domestic servers PPI, CPI computers, the headline
        semiconductor PPI) are shown above as contrast, not averaged in — the selection rule is
        transaction-based, not hot: imported semiconductors ride in the basket at whatever they
        print. No official DRAM or memory price index exists (BLS catalogs verified 2026-07-15;
        the microprocessor PPI was discontinued in 2015), which is why a market-data memory
        nowcast tail is the planned upgrade. Hardware is nationally priced — it does not enter
        the state parity table. Weights are cited in the methodology notes; group shares:
        compute 0.60, storage &amp; memory 0.25, network 0.15.
```

(If Task 1's spike changed the shares, use the spike's numbers here.)

- [ ] **Step 4: Full site gates**

Run: `cd site && npx tsc --noEmit && npm run build && npm test && npm run e2e`
Expected: all green — e2e's `/datacenter` marker ("Data Center Cost Index" h1) is unchanged; zero console errors.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/HardwareGapPanel.tsx site/src/app/datacenter/page.tsx
git commit -m "feat(site): hedonic-gap panel + hardware methodology on /datacenter"
```

---

### Task 9: Full gates, visual verification, docs

**Files:**
- Modify: `CLAUDE.md` (test-count string only, if changed)

- [ ] **Step 1: Full pipeline + site gates from clean state**

Run: `pytest -q && cd site && npm run build && npm test && npm run e2e`
Expected: all green. Note the new pytest total.

- [ ] **Step 2: Update `CLAUDE.md`'s test count** — the line `pytest -q  # full suite (346 tests)` gets the new total. Nothing else in CLAUDE.md changes (26 published files unchanged; no new sources).

- [ ] **Step 3: Visual verification.** `cd site && npm run dev`, open `/datacenter`, and check: three KPI cards (hardware amber, value matching Task 6's sanity print); three lines in both LEVEL and YOY modes; hardware component table with three group headers; gap panel sorted hot→cold with "in index" badges on exactly 5 rows and the storage row on top (~+31); methodology paragraph renders the new text; browser console clean.

- [ ] **Step 4: Commit docs + wrap up**

```bash
git add CLAUDE.md
git commit -m "docs: test count after DC Hardware index"
```

Then STOP: report results and ask the user before any push (push = deploy).

---

## Self-review notes

- **Spec coverage:** §3 basket/panel → Tasks 2–3; §4 engine → Tasks 3–4; §5 publish/schema/run_daily → Task 5; §6 site (chart, KPI, table, panel, metadata, methodology) → Tasks 7–8; §7 testing → embedded per task (fixtureless FRED fake confirmed); weight citations → Task 1; data regeneration ordering hazard (site imports JSON at build) → Task 6.
- **Type consistency:** `build(dc_result, parity_result, source_ids)` used in Task 5 tests, writer, and run_daily; `GapRow`/`load_hardware_gap` names match between Tasks 3 and 4; `DcSeries` prop shape matches page call; published row keys (`code,label,source_id,yoy_pct,last_obs,in_basket`) match schema, writer, tests, and the site type.
- **Known cross-task coupling:** Task 3 edits `tests/test_dcindex.py`'s helper (needed for Task 4's tests); the two proxy tests get explicit hardware baskets to avoid empty-series raises.
