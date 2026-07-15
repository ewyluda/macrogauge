# DC Hardware Index Design — third index + hedonic-gap panel (Wave 1)

**Status:** Approved 2026-07-15 (brainstorming session; composition decision: transaction-sensitive
basket). Follows the 2026-07-15 enhancement research (6-agent source-verification workflow; all
series IDs below fetched live from FRED/BLS that day).
**Inputs:** `docs/superpowers/specs/2026-07-11-datacenter-cost-index-design.md` (DC Build/Ops
architecture this extends); `config/dc_basket.json` / `pipeline/dc_basket.py` /
`pipeline/engine/dcindex.py` (the N-index machinery); `pipeline/publish/datacenter.py` +
`schemas/datacenter.schema.json`; repo-fit findings: the only pipeline hard-code blocking a third
index is the `("build", "ops")` tuple at `pipeline/dc_basket.py:37`.

A third index on `/datacenter` tracking **data center IT-hardware cost inflation** — chips, memory,
storage, finished systems, network gear — plus a **hedonic-gap panel** showing why the naïve
official series would mislead. The DC Build/Ops indexes price the facility; this prices what fills
it, which in 2026 is the most inflationary part and has no official composite index.

## 1. Scope

**In scope (wave 1):**

1. **DC Hardware index** — five official monthly series (weights sum 1.0), same engine path as
   Build/Ops: rebase 2018-01=100 → aggregate (daily forward-fill grid, Laspeyres headline,
   365-day YoY, component YoY at own last obs). No live proxy in v1.
2. **Hedonic-gap panel** — per-series YoY (at each series' own last observation) for ~10 official
   IT-hardware price series, published in `datacenter.json` and rendered as a diverging-bar panel
   with in-basket markers. This is the exhibit that justifies the basket's composition.
3. Site: `DcIndexChart` refactored two-fixed-series → N series; third KPI card; hardware
   component table; new gap-panel component; page metadata.

**Out of scope (deferred, already roadmapped):** DRAM/NAND spot nowcast tail via DRAMeXchange
scrape (wave 3 — attaches later as `live_proxy` on the storage component with zero engine change);
cost-of-compute section (wave 3); GPU/accelerator prices (no official series exists; market data
only — wave 3); per-component history drill-downs (separate backlog item, payload discipline);
state parity changes (hardware is nationally/globally priced — parity table untouched, one
methodology line says so).

## 2. Decisions locked in brainstorming

1. **Transaction-sensitive composition.** The basket includes only official series that track
   transaction prices through the current cycle; series structurally flattened by hedonic quality
   adjustment (domestic servers PPI, CPI computers, headline semiconductor PPI) are **excluded
   from the index and shown in the gap panel as contrast**. This is the site's Manheim-vs-CPI-used-cars
   argument applied to hardware, and the methodology paragraph says so explicitly.
2. **The selection rule is "transaction-based," not "hot."** Import semis (`IR21320`, +4.0% YoY at
   approval time — the coolest series in the basket) is included *because* it is border-price
   transaction data. This pre-empts the cherry-picking critique and is stated in the methodology.
3. **One variant, not two.** A budget-weighted-official twin was considered and rejected for v1
   (doubles scope; the gap panel already carries the official-series story).
4. **Panel is config-driven and self-consistent:** panel membership lives in `config/dc_basket.json`;
   the `in_basket` flag is *derived* from hardware-basket membership, never hand-maintained.

## 3. Components, sources, weights

### DC Hardware basket (weights sum 1.0, validated on load)

| Group (display) | Component | Registry code | Source series | Weight | YoY @ 2026-07-15 |
|---|---|---|---|---|---|
| Compute (0.60) | Imported hardware ex-semis | `mxp_computers_exsemi` | FRED `IR213COM` (BLS end-use import, computers/peripherals ex-semiconductors, 1984→) | 0.35 | +18.6% |
| Compute | Semis & electronic components | `ppi_semis_components` | FRED `PCU33443344` (PPI industry group NAICS 3344, 1984→) | 0.15 | +26.2% |
| Compute | Imported semiconductors | `mxp_semis` | FRED `IR21320` (BLS end-use import, semiconductors, 1984→) | 0.10 | +4.0% |
| Storage & memory (0.25) | Computer storage devices | `ppi_storage` | FRED `PCU334112334112` (PPI industry NAICS 334112, 1992→) | 0.25 | +31.5% |
| Network (0.15) | Network & telephone apparatus | `ppi_network_equip` | FRED `PCU334210334210` (PPI industry NAICS 334210, 1985→) | 0.15 | +12.4% |

All five ride the existing FRED connector under the existing `FRED` source key (monthly official
series, same failure domain as the other DC PPIs — no new source-key isolation needed). All reach
2017-01 with decades to spare, so the 2018-01=100 rebase and the daily grid are clean.

**Weights are provisional pending the citation spike (implementation task #1).** Group shares
(compute 0.60 / storage 0.25 / network 0.15) get checked against published DC IT-capex breakdowns
(Dell'Oro, Synergy Research, IDC server/storage/network splits; SemiAnalysis AI-DC cost anatomy for
the accelerator era). The compute-group subdivision (finished-goods lens 0.35 vs component lens
0.15 vs imported-chips lens 0.10) is a lens blend, not a goods split — the spike records the
rationale and citations in `docs/superpowers/specs/2026-07-15-dc-hardware-spike-notes.md`
(precedent: `2026-07-12-dc-series-spike-notes.md`). Group sums are preserved if the subdivision
moves; final weights + citations land in the on-page methodology note.

### Hedonic-gap panel (~10 rows; not index components unless marked)

| Row | Registry code | Source series | In basket | YoY @ 2026-07-15 |
|---|---|---|---|---|
| Computer storage devices PPI | `ppi_storage` | `PCU334112334112` | yes | +31.5% |
| Import semis & components (NAICS) | `mxp_semis_comp_naics` | FRED `IZ3344` (2005-12→) | no | +29.0% |
| Semis & components group PPI | `ppi_semis_components` | `PCU33443344` | yes | +26.2% |
| Import computers ex-semis | `mxp_computers_exsemi` | `IR213COM` | yes | +18.6% |
| Network & telephone apparatus PPI | `ppi_network_equip` | `PCU334210334210` | yes | +12.4% |
| IC packages incl. microprocessors PPI | `ppi_ic_packages` | FRED `WPU117839` (2005-06→) | no | +4.4% |
| Import semiconductors | `mxp_semis` | `IR21320` | yes | +4.0% |
| Servers (host computers) PPI | `ppi_servers` | FRED `PCU3341113341115` (2004-12→) | no | +0.7% |
| Semiconductor mfg PPI (headline) | `ppi_semi_headline` | FRED `PCU334413334413` (1967→) | no | −0.6% |
| CPI computers & peripherals | `cpi_computers` | FRED `CUUR0000SEEE01` (1997-12→) | no | −0.8% |
| Other semis incl. wafers PPI | `ppi_wafers` | FRED `PCU334413334413A` (1976→) | no | −8.0% |

Panel-only series (6) are ordinary registry entries collected daily like everything else; they are
simply not in any basket. Total new registry entries: **11** (5 basket + 6 panel-only), all FRED.

**Deliberately excluded, with receipts** (goes in spike notes, not the page):
`PCU3344133344131` (IC packages, industry side) has a 14-month publication hole (2024-06→2025-07)
that violates the YoY-base rule until 2026-08; fiber-optic-cable PPI `PCU335921335921` is dormant
(no prints since 2025-06) and a connector for it would rot.

### Staleness

PPI series: `max_staleness_days: 80` (matches existing DC PPIs). Import/export price series
(`IR*`, `IZ*`): **110** — the BLS MXP release covers one month earlier than PPI's coverage month,
so the latest observation is legitimately ~75 days old just before a release. CPI series: 80.
The engine's component-YoY-at-own-last-obs rule (house invariant) already handles the mixed
May/June cadence across basket components.

## 4. Pipeline architecture

- **Registry:** 11 new entries in `config/series.json` under the existing `FRED` source. FRED
  history arrives in full on first fetch (connector requests from 2017-01) — **no backfill step**.
- **Basket config:** `config/dc_basket.json` gains a third basket key `hardware` (five components
  as §3) and three new `group_labels` entries: `compute` → "Compute", `storage` → "Storage &
  memory", `network` → "Network equipment" (no collision with the seven existing group keys). It
  also gains a `hardware_gap` list: ordered `{code, label, series}` rows (§3 panel table);
  `in_basket` is derived at load time from hardware-basket series membership.
- **Loader:** `pipeline/dc_basket.py` — extend the basket-name tuple at line 37 to
  `("build", "ops", "hardware")`; add loading + validation for `hardware_gap` (known series codes
  only, no duplicate codes). `parity_shares` reads only build/ops — unaffected.
- **Engine:** `pipeline/engine/dcindex.py` — the per-basket loop is already generic; the hardware
  basket flows through rebase → aggregate untouched. **No gate applies to hardware v1**: the gate
  stage in dcindex is scoped to live-proxy tails, and hardware has none — official monthly prints
  are never held (house invariant; the June 2026 storage-PPI +8.7% MoM print must pass through).
  New pure function for the panel: `official_panel(series_by_code, panel_rows)` → per-row YoY at
  own last obs (reuses `aggregate`'s yoy-at-observation helper), `yoy_pct: None` where the base
  month is missing. Pure dict→dict, tested directly.
- **Store:** same vintage store, new series codes, no schema/row changes.

## 5. Publish

- `datacenter.json` (same single artifact — no new file, no CLAUDE.md count change):
  - `indexes.hardware` — identical shape to build/ops (`as_of`, `headline_yoy_pct`, `gate_flags`
    (always `[]` in v1), `dates`, `index`, `yoy_pct`, `components[]`). The schema's index shape
    already validates via `additionalProperties`; **pin `hardware` in the schema's `required`**
    so a regression that drops it fails the run.
  - New top-level `hardware_gap`: array of `{code, label, source_id, yoy_pct (nullable),
    last_obs, in_basket}`, in the §3 display order. `source_id` (the FRED ID, for on-page
    credibility chips) comes from the registry mapping passed into the builder — never hardcoded
    in the publisher.
  - `group_labels` gains the three hardware groups.
- Schema updated in `schemas/datacenter.schema.json`; validated inline as it lands
  (`ValidationError` re-raises and fails the run, unchanged).
- Runs inside the existing `_datacenter_phase` isolation block; `datacenter_ok` covers it. A
  stale/broken hardware series carries forward and surfaces in `sources_status.json` like any
  other series; it can never touch the core gauge.
- Payload: ~+110 KB on `datacenter.json` (third daily grid, consistent with build/ops). The
  existing 338 KB-trim backlog item absorbs all three indexes together; wave 1 does not attempt
  the trim.

## 6. Site page

`/datacenter` changes only (nav, routes unchanged):

1. **KPI row** grows to three: DC Build (sky), DC Ops (violet), **DC Hardware (amber)**.
2. **`DcIndexChart` refactor:** two fixed prop pairs → `series: Array<{key, label, dates, index,
   yoy, color}>`. LEVEL|YOY SegmentedControl and the PNG-export pattern
   (`echarts.getInstanceByDom` via wrapRef) are preserved as-is. Three lines.
3. **Hardware component table** — same `ComponentTable` with group headers, rendered third,
   after the Build and Ops tables (matching KPI-row order).
4. **`HardwareGapPanel`** (new server component, no client JS): diverging CSS bars around zero —
   red for rising, emerald for falling (existing accent vars) — one row per `hardware_gap` entry:
   label, `source_id` chip, bar, signed YoY, last-obs date, and an "in index" marker on basket
   rows. Published in config order; the page sorts rows by `yoy_pct` descending at render time
   (presentation-only sort, precedent: the parity cheapest/priciest strips; `null` YoY rows sink
   to the bottom). No echarts; bars are the contribution-bar span pattern already on the page.
5. **Metadata title** gains the third number (`build +x · ops +y · hardware +z YoY`).
6. **Methodology paragraph** extended: transaction-sensitive selection rule (including the
   include-the-cool-series point), hedonic exclusion rationale, provisional-weights citation note,
   "hardware is nationally priced — parity unaffected," and the §2 no-official-DRAM-index fact
   (BLS catalogs verified 2026-07-15) as the standing justification for the future wave-3 tail.

No new client math → no new vitest. e2e: `/datacenter` route entry keeps a body-unique marker
(update the marker only if the new content changes uniqueness); zero-console-errors assertion
unchanged.

## 7. Testing

Existing conventions apply wholesale (no network, ever):

- **Fixtures:** all 11 new FRED series wired into `test_run_daily.py`'s `fake_get` with fixture
  observations (including one panel series with a missing YoY base month to pin the nullable path).
- **Loader tests:** three baskets load; hardware weights sum to 1.0; unknown/duplicate codes in
  basket or `hardware_gap` rejected; `in_basket` derivation correct; `parity_shares` unchanged.
- **Engine tests (pure dicts):** hardware basket through rebase→aggregate with mixed last-obs
  months (component YoY at own obs, not grid end); `official_panel` YoY math including the
  missing-base → `None` case; no gate hold on a >5% official monthly print.
- **Publish/schema:** `indexes.hardware` and `hardware_gap` validate; schema `required` pin means
  a run that drops either fails.
- **Pins to bump:** `tests/test_registry.py:14` (229 → 240 series) and `:20` (62 → 73 FRED);
  `test_dc_basket.py` basket-set assertion.
- **Site:** `npm run build` + e2e smoke (21 pages, zero console errors) must stay green; no new
  vitest expected (assert nothing client-computed crept in during review).

## 8. Phasing & risks

**Wave 1 ships:** hardware index (official-only), gap panel, page upgrades, tests, spike notes.

**Deferred:** DRAM spot tail (wave 3; lands as `live_proxy` config on `ppi_storage` + one scrape
connector — zero engine change by design), compute section, per-component drill-downs.

**Risks, ranked:**

1. **Weight defensibility** — the compute-group lens blend (0.35/0.15/0.10) is the least-cited
   part of the design. Mitigation: spike task #1 with recorded citations; group sums preserved on
   any re-split; the methodology publishes the shares.
2. **Import-series revisions & lag** — MXP revises and lags PPI by a month; mitigated by the
   110-day staleness setting, vintage-store append semantics, and YoY-at-own-obs.
3. **Cherry-picking optics** — mitigated structurally: the selection rule is printed, the coolest
   transaction series is in the basket, and the excluded official series are displayed prominently
   in the gap panel rather than hidden.
4. **Storage-PPI volatility** — thin domestic industry sample; large MoM swings are real prints
   and must flow through (no gate); YoY framing on the page absorbs most of it.
5. **Series discontinuation** — the 2025 PPI industry-code purges hit adjacent series (fiber);
   registry staleness + `sources_status` catch any repeat. Panel-only series can be dropped
   without touching the index.
