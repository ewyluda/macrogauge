# /markets — DC Market Panel (Project Controls P2) — Design Spec

**Date:** 2026-07-25
**Register item:** `docs/plans/2026-07-24-project-controls-gaps.md` §P2
**Status:** design approved, not yet planned to task level
**Grades:** forecast accuracy, energization date

> ⚠ **Naming collision.** `docs/plans/2026-07-17-p2-geography-matrix.md` is a *different, completed*
> "P2" (the geography + matrix wave that shipped `/metros`, `/states`, `/matrix`). Refer to both by
> date-prefixed filename, never by "P2".

## Goal

Give hyperscaler Project Controls a construction-labor instrument at **real DC market resolution**.
State resolution averages Loudoun with Bristol; `metros.json` is 50 Zillow consumer-shelter metros and
does not serve this. The panel answers: *how tight is the craft-labor market where I am building, versus
the nation, and who else is building there?*

## Decisions locked during the 2026-07-25 brainstorm

1. **Scope = option 1 ("re-scope around what's solid").** The register's P2 was not buildable as
   written; see *What recon established* below.
2. **Market membership is a county list, not a radius.** Auditable, matches how this audience thinks,
   and shares one geography with county QCEW.
3. **Tight core counties, with per-county receipts published.** A market is the counties where data
   centers actually are, not the MSA. Northern Virginia = Loudoun + Prince William, not the 11-county
   metro. Measured: tight NoVa reads +9.9% wage / +12.5% employment; the MSA definition dilutes that to
   +7.7% / +6.2% by averaging in Arlington, Alexandria, and Fairfax City. The per-county rows publish
   beneath the aggregate so the aggregation is checkable.
4. **The capacity join is demoted to a denominated supporting column.** It is no longer load-bearing.
5. **Labor is the headline.** Construction employment YoY is the *direct* measurement of craft-labor
   tightness; the MW join was only ever a proxy for it.

## What recon established (measured 2026-07-25, not estimated)

The register's P2 entry asserted four columns. Three were wrong or unbacked, and the recon changed the
shape of the feature. Recording the measurements so this is not re-derived:

**Refuted — the capacity join cannot carry the panel.**

- **Northern Virginia returns 1 site / 0 MW** at a 60-mile radius. Its only in-radius entry is
  `DLR / Ashburn / Northern Virginia hub` with `mw: null`. The nearest MW-bearing site is AMZN Louisa
  Co. (2,700 MW) at 73.3 mi.
- Des Moines, Salt Lake City, and Reno return **0 sites** at 60 mi; SLC and Reno are still empty at
  150 mi.
- `geo[]` totals 47,746 MW against the same file's `companies[]` total of 119,811 MW — a **40% census**,
  unreconciled and bidirectional (AMZN maps 34% of its MW; ORCL maps 174%).
- 23 of 112 entries have `mw: null`. `st` is a **status** enum (`o`/`c`/`p`/`s`) — there is no
  "announced" status, contrary to the register's wording.
- **This gap is structural, not curatable.** `capacity.json` is a roster of 29 *public* companies by
  construction. Loudoun's capacity belongs largely to private operators (CyrusOne, Vantage, Aligned,
  STACK, QTS, EdgeConneX) that file nothing, plus hyperscaler leased space inside their shells. The
  entire Virginia bounding box contains 3 sites. Closing it means sourcing site-level MW from
  non-filing companies — the same primary-source wall that nulled `context.transformer`, whose standard
  `docs/superpowers/plans/2026-07-16-dc-context-layer.md` says stands.
- **Coordinates cannot support a distance join regardless of MW.** 70 of 112 entries carry
  `approx: true`, which `geo_note` defines as state-centroid placement — yet AMZN Louisa Co. sits 73 mi
  from NoVa, a plausible *county* placement rather than Virginia's centroid (~110 mi out). The flag does
  not tell you which coordinates to trust, so no radius computation over them is defensible.

**Refuted — no ISO data exists at state resolution.** There is no state→ISO map anywhere in the repo.
ERCOT has no price or capacity data of any kind (`pipeline/connectors/ice.py:23-24` records an
exhaustive search finding no ERCOT hub in EIA's ICE workbook); ERCOT is energy-only so there is no
capacity-auction analogue, and nothing collects MISO's PRA. PJM zonal pricing would require a $2,500/yr
Associate Membership to redistribute (`docs/pjm-dataminer2-key.md:37-51`).

**Confirmed and better than assumed — county QCEW works.**

- County is a **config-only** change. The connector hits the area-agnostic *industry* endpoint
  (`.../{year}/{qtr}/industry/23.csv`) and filters rows client-side on `own_code` + `area_fips`
  (`pipeline/connectors/qcew.py:51`), with no `agglvl` or state-shape check. Registering a 5-digit
  county FIPS is sufficient.
- **No duplicate-observation risk.** A live read of 2025Q4 found 3,707 private areas, each at exactly
  **one** `agglvl_code` (county 74: 3,260 · MSA 44: 393 · state 54: 53 · national 14: 1). Zero areas
  carry more than one agglvl at `own_code=5`.
- **Suppression is largely a non-issue at this resolution.** 50 of the 55 counties in the *broad*
  candidate set resolve (**91%**), and Loudoun is clean. The 5 suppressed counties are Culpeper VA,
  Fairfax City VA, Manassas Park VA, Delaware Co. OH, and Washington Co. OR. Under the broad set all 20
  markets produced a wage and a YoY; under the **final tight definition 19 of 20 do**, because
  Hillsboro's sole core county (Washington Co. OR) is one of the suppressed five and no longer has a
  non-core county masking it. That is a real cost of the tight definition and it is the intended
  behaviour — see the roster note.
- **Zero extra HTTP cost.** The connector already downloads the full nationwide file (1.1 MB) regardless
  of how many areas are registered.

**Confirmed — two live bugs block the feature and one is pre-existing.**

- `N_QUARTERS = 5` (`pipeline/connectors/qcew.py:28`) can never reach the year-ago base: it requests
  q0−4..q0 while the newest published quarter is q0−3, whose base is q0−7. The entire QCEW store is
  **88 rows across exactly 2 quarters** (2025-07-01, 2025-10-01), and **`geo.json` ships
  `yoy_pct: null` for all 51 states in production today**. `N_QUARTERS = 8` reaches 2024Q4 and fixes
  this — verified against the live endpoint.
- The connector keeps only `avg_wkly_wage` and **discards `month3_emplvl` and `qtrly_estabs`**, which
  are present in the same rows already downloaded.

**Data recency.** Freshest published quarter is **2025Q4**; 2026Q1 and 2026Q2 both 404 as of
2026-07-25. That is ~7 months past quarter end — the panel must display an as-of, not imply currency.

## The signal, measured

National private construction (NAICS 23, 2025Q4 vs 2024Q4): **+5.1% wage, +1.0% employment**.
Tight-market aggregates, employment-weighted, like-for-like county sets:

| Market | Wage $/wk | Wage YoY | Constr. emp | Emp YoY | Note |
|---|---|---|---|---|---|
| Richland Parish LA | 1,964 | **+57.4%** | 563 | **+105.5%** | thin base |
| Abilene TX | 1,646 | +21.3% | 4,106 | +24.2% | |
| New Carlisle IN | 1,860 | +15.7% | 6,898 | +23.4% | |
| Quincy WA | 1,849 | +14.8% | 1,643 | −9.1% | thin base; divergent |
| Cheyenne WY | 1,690 | +11.3% | 4,018 | +10.5% | |
| Northern Virginia | 2,031 | +9.9% | 43,680 | +12.5% | |
| Mt Pleasant WI | 1,870 | +9.9% | 3,775 | +4.2% | |
| Reno / Storey NV | 1,889 | +9.6% | 24,502 | +8.0% | |
| Salt Lake City | 1,695 | +7.4% | 85,496 | −0.2% | |
| Des Moines IA | 1,830 | +6.2% | 22,859 | +4.8% | |
| Columbus OH | 2,089 | +5.5% | 45,274 | +5.4% | |
| Dallas–Fort Worth | 2,012 | +5.2% | 174,996 | +1.9% | |
| Atlanta | 2,273 | +5.0% | 27,022 | +1.5% | |
| Phoenix | 1,833 | +3.7% | 174,037 | −2.8% | |
| Memphis | 2,002 | +2.6% | 18,510 | +2.9% | |
| San Antonio TX | 1,718 | +1.9% | 49,346 | −1.8% | |
| Silicon Valley | 2,629 | −2.0% | 51,481 | +3.5% | |
| Council Bluffs IA | 1,610 | −2.2% | 2,339 | +11.9% | thin base; divergent |
| Chicago | 2,237 | **−5.7%** | 103,172 | +0.1% | |
| Hillsboro OR | — | — | — | — | **all counties suppressed** |

The signal is real and it corroborates itself: the wage spikes come with employment spikes. Loudoun
alone added **3,779 construction workers** on a 22,372 base. Chicago is genuinely slack. This is the
instrument.

**Numbers in this table are recon values and will move** — they are computed from a one-off live read
at 2025Q4, and the published values come from the store. Do not hard-code them into tests as
expectations; pin engine behaviour on fixtures instead.

## Market roster (20)

Tight core counties. `iso` is null where the market is not in an organized market; `grid` names the
interconnect/region in that case.

| Key | Market | Counties (FIPS) | ISO | Grid | Utility |
|---|---|---|---|---|---|
| `nova` | Northern Virginia | 51107, 51153 | PJM | — | Dominion Energy Virginia |
| `dfw` | Dallas–Fort Worth | 48113, 48439, 48139 | ERCOT | — | Oncor |
| `chicago` | Chicago | 17031, 17043 | PJM | — | ComEd |
| `phoenix` | Phoenix | 04013, 04021 | — | WECC | APS / SRP |
| `atlanta` | Atlanta | 13097, 13121 | — | SERC | Georgia Power |
| `svl` | Silicon Valley | 06085 | CAISO | — | PG&E / Silicon Valley Power |
| `columbus` | Columbus OH | 39049, 39089 | PJM | — | AEP Ohio |
| `slc` | Salt Lake City | 49035, 49049 | — | WECC | Rocky Mountain Power |
| `abilene` | Abilene TX | 48441 | ERCOT | — | AEP Texas |
| `newcarlisle` | New Carlisle IN | 18141 | MISO | — | AEP Indiana Michigan |
| `mtpleasant` | Mt Pleasant WI | 55101 | MISO | — | We Energies |
| `richland` | Richland Parish LA | 22083 | MISO | — | Entergy Louisiana |
| `memphis` | Memphis | 47157 | — | TVA | MLGW |
| `councilbluffs` | Council Bluffs IA | 19155 | MISO | — | MidAmerican Energy |
| `desmoines` | Des Moines IA | 19153, 19049 | MISO | — | MidAmerican Energy |
| `cheyenne` | Cheyenne WY | 56021 | — | WECC | Black Hills Energy |
| `reno` | Reno / Storey NV | 32029, 32031 | — | WECC | NV Energy |
| `quincy` | Quincy WA | 53025 | — | WECC | Grant County PUD |
| `sanantonio` | San Antonio TX | 48029 | ERCOT | — | CPS Energy |
| `hillsboro` | Hillsboro OR | 41067 | — | WECC | Portland General Electric |

**Hillsboro is retained deliberately.** Washington County is disclosure-suppressed, so the row renders
an explicit "not available — BLS disclosure suppression" state. It is *not* silently backfilled from
Multnomah (Portland), which is a different labor market and not where the data centers are. Dropping
the market entirely is a defensible alternative; retaining it makes the suppression visible, which is
the house style.

## 1. Config: `config/dc_markets.json`

```json
{
  "markets": [
    {"key": "nova", "name": "Northern Virginia", "counties": ["51107", "51153"],
     "state": "VA", "iso": "PJM", "grid": null,
     "utility": "Dominion Energy Virginia",
     "note": "Loudoun + Prince William; Ashburn / Data Center Alley"}
  ]
}
```

Loader `pipeline/dc_markets.py`, modelled on `pipeline/dc_power.py` (the smallest complete example —
frozen dataclass, registry cross-check, non-empty/numeric checks, 58 lines). Validates: unique `key`;
non-empty `counties`; each FIPS is 5 digits; `state` is 2 alpha; `iso` in the enum or null; exactly one
of `iso`/`grid` is set; and a registry cross-check that each county has both a `qcew_wage23_c*` and a
`qcew_emp23_c*` series registered. Takes an injectable `registry_codes: set[str] | None` so tests can
pass a fake registry.

**Note a deliberate departure from precedent.** The two nearest siblings — `pipeline/publish/metros.py`
and `geo.py` — *hardcode* their `METROS`/`STATES` lists as module constants "pinned by tests". Driving
the market list from config is a departure, not a continuation. The consequence: the list is no longer
pinned by a writer test, so **the pin moves into the config loader's test**.

## 2. Collection: `pipeline/connectors/qcew.py`

Two changes, no URL change:

1. **`N_QUARTERS: 5 → 8`.** Unblocks YoY. Side effect: this also fixes the pre-existing
   `yoy_pct: null` bug affecting all 51 states in `geo.json` today. That is a genuine bug fix riding
   along, and it should be called out in the commit message rather than landing silently.
2. **Emit employment.** `month3_emplvl` rides as its own series, `qcew_emp23_c{fips}`, keyed by
   `source_id` `"{fips}~emp"`. The connector emits `area_fips` unchanged for wage (preserving the 45
   existing state series untouched) and `"{fips}~emp"` for employment; `collect.py`'s
   `id_map = {s.source_id: s.code}` needs **no change** because it is a plain string map.

**Store impact: none structurally.** New series codes are the sanctioned path — store rows stay
append-only and schema-versionless, no `Observation` field is added, renamed, or retyped, and no
committed partition is rewritten.

`config/series.json` gains **60 new series** — the roster's 30 distinct counties × 2 metrics.
`max_staleness_days` should match the existing QCEW entries (400) given the ~7-month publication lag.

## 3. Engine: `pipeline/engine/dcmarkets.py` (pure)

A pure dict→dict stage, no I/O, testable directly — same contract as the five gauge stages.

- **Wage aggregation is employment-weighted** across a market's counties, not a simple mean.
- **YoY over a like-for-like county set.** A county absent or suppressed in *either* quarter is
  excluded from *both*, so composition changes cannot contaminate the rate. This mirrors how
  `pipeline/engine/dcindex.py:192-195` already handles Louisiana's flickering suppression.
- **Spread vs national** is the headline derived figure: market wage YoY minus national wage YoY, and
  the same for employment.
- **Thin-base flag** when market construction employment is below **1,500**, so Richland Parish's
  +105.5% (563 workers) is never read as equivalent in reliability to Loudoun's +16.9% (26,151). At
  2025Q4 this flags Richland Parish and Council Bluffs; Quincy WA sits just above at 1,643 and does
  not flag, which is the intended sensitivity.

**Reuse:** `dcindex.parity_rows()` (`pipeline/engine/dcindex.py:165`) is pure and key-agnostic and
computes build/ops multipliers from wages + power. It is reused verbatim; only its store-discovery
wrapper `_by_state` is state-locked (`dcindex.py:220`), so this needs a market-keyed sibling wrapper.
Note `parity_rows()` names its output field `state` — a misnomer at market resolution that the writer
must rename.

**Resolution honesty, enforced in the design not the copy.** EIA industrial power is state-level (52
series, ~85-day lag, all 51 states populated) and there is no sub-state alternative. Two markets in one
state therefore share an identical `ops_mult` — Northern Virginia and a hypothetical Bristol VA would
be indistinguishable on power. Since `w_power = 0.55` dominates the parity formula, **the power and
ops columns are labeled state-resolution with the state named**, and the page states which columns
actually vary sub-state (wage and employment only). Publishing a market-resolution `ops_mult` without
that label would reproduce, one level down, the exact coarseness this feature exists to fix.

## 4. Capacity join (supporting column, denominated)

Membership by **hand-assigned `market` tag** on `geo[]` entries in `config/capacity.json` — bounded
curation of roughly 30 of 112 entries, not a sourcing project. Untagged entries are simply not in any
market. This sidesteps the coordinate-trust problem entirely.

`schemas/capacity.schema.json` leaves `additionalProperties` **unset** on `geo.items`, so it defaults to
true and the new `market` tag would validate without any schema edit. **Declare it anyway** — and
declare `when` while there, which is published on all 112 entries today yet appears nowhere in the
schema precisely because that default let it through unnoticed.

Each market publishes **four numbers, never one**:

- tracked sites in market
- MW disclosed
- sites present but MW undisclosed
- and a standing site-wide footnote for the 6,026 MW in `geo_unmapped` that has no location by
  construction

Plus the denominator, on-page: *29 public companies; private operators (CyrusOne, Vantage, Aligned,
STACK, QTS, EdgeConneX) and hyperscaler leased space are not tracked.*

Northern Virginia will read **"1 tracked site · MW not disclosed"**. That is honest, and acceptable
now that the labor columns carry the panel.

*Indicative yield, from the one-off 60-mile radius probe (final tags are hand-assigned and will
differ):* Abilene 4,600 MW · New Carlisle 4,125 · Memphis 1,800 · Mt Pleasant 1,700 · Columbus 1,650 ·
DFW 1,551 · Richland 1,440 · Council Bluffs 500 · Phoenix 200 · NoVa 0 · Des Moines / SLC / Reno 0.

## 5. Publish

`pipeline/publish/dc_markets.py` → `site/public/data/dc_markets.json`, schema
`schemas/dc_markets.schema.json`. Copies the `pipeline/publish/capacity.py` template: `build(conn, cfg,
...) -> dict` plus a three-line `write(payload, out_dir, published_at) -> Path` delegating to the
shared `write_json` envelope. **All derived math lives in the writer/engine; the site renders only.**

`run_daily.py` gains a tenth isolated phase via `_run_phase("markets", ...)`, with the config load
placed **inside** the closure so a bad config edit degrades to `qa` instead of crashing the run.
`jsonschema.ValidationError` re-raises ahead of the generic `Exception`, per the pinned ordering.

This is the **tenth** isolated phase (nine `_run_phase` call sites exist today). Wiring is four files or
the run self-reports a failure: `pipeline/publish/qa.py:22` `PHASES` and `:24` `_PHASE_DONE` — the
cross-check runs in *both* directions, so a phase wired into `run_daily` but missing from `PHASES`
produces a failing "unknown phase" check — plus the two test pins below. The schema must legally allow degraded output — null wage/emp, empty county arrays, a
fully suppressed market.

## 6. Site: `/markets`

Server `page.tsx` static-imports `dc_markets.json`, casts to a hand-written type in
`site/src/lib/types.ts` with **nullable fields declared `| null`** (TypeScript infers from the
committed sample, so a field that is null-in-practice but non-null today will otherwise type wrong and
break the day the pipeline emits a null). Renders `<h1>` + `.subtitle` + `.lede`, a `.kpi-row`, then a
client child for the sortable table, closing with `<p className="method">`.

Interactivity in `MarketsClient.tsx` following `CapacityClient.tsx`: `useState` for sort/filter, one
`useMemo` that filters-then-sorts. County receipts expand per market row.

Pure math in `site/src/lib/dcMarkets.ts` with co-located `dcMarkets.test.ts` — vitest collects only
`src/**/*.test.ts` in node env, so **logic embedded in the `.tsx` is untestable** except through
Playwright.

Three edits or the route breaks: the page, `site/src/lib/nav.ts` NAV, and `site/e2e/smoke.spec.ts`
ROUTES. **Emoji 🏗** — verified unique against the 25 currently in use (🗺 and 🏙 are taken by `/geo`
and `/metros`). Nav emoji uniqueness is enforced only by human review; nothing in CI asserts it. The
e2e marker must be unique to the page **body** — nav dropdowns are always in the DOM and the footer
lists every route label, so a marker like "Markets" would match a hidden nav link instead.

**Build-order constraint:** the page static-imports the JSON, so `npm run build` cannot pass until the
writer has run and its output is committed. The publisher lands first, or in the same commit.

## 7. Testing

- `tests/test_dc_markets_config.py` — loader validation; **pins the market roster** (the pin the
  hardcoded-list precedent would otherwise have provided).
- `tests/test_dcmarkets_engine.py` — pure aggregation; employment weighting; like-for-like YoY;
  one-county-suppressed; all-counties-suppressed degradation; thin-base flag.
- `tests/test_dc_markets_writer.py` — schema-valid output and degraded output.
- `tests/test_run_daily.py` — three hooks: `fake_get` returning **county** rows, a `markets_ok`
  assertion, and a `test_markets_schema_violation_fails_run` pin.
- `tests/fixtures/qcew_industry23.csv` — **add county rows.** Today the fixture holds 5 state/national
  rows only (`agglvl` 54 and 14); no county FIPS has ever flowed through this code path in a test.
- Pin bumps in the same commit or CI fails: `tests/test_registry.py:27` (`len(series) == 598`) and
  `tests/test_run_daily.py:292` (`qa["total"] == 24` → 25), plus `tests/test_qa.py`.
- `tests/test_published_data.py` CONTRACT — add `dc_markets.json`. This list currently covers only
  **16 of 33** artifacts, so without the entry the file is never re-validated in CI.
- HTTP stays injected; no test hits the network.

**Folded-in adjacent fix:** `schemas/capacity.schema.json` declares `lat`/`lng` as bare
`{"type":"number"}` with no bounds, and `pipeline/capacity.py` validates only that `geo['t']` is a known
ticker. A transposed or sign-flipped coordinate in 3,714 lines of hand-curated JSON would pass CI and
silently relocate a multi-GW site. Add `-90..90` / `-180..180` bounds — two lines, and this feature is
the reason to care.

## Out of scope

- **Radius / distance joins** — coordinate precision is unknowable per the `approx` finding.
- **MSA market definitions** — decided against; dilutes the signal.
- **Forward projection of any kind** — that is the 2026-07-24 register's P3, and it is gated by its own
  backtest.
- **PJM zonal or nodal pricing** — redistribution requires a $2,500/yr Associate Membership.
- **ERCOT / MISO capacity-market numbers** — ERCOT is energy-only; nothing collects MISO's PRA. The
  PJM capacity ladder displays only on PJM markets, with its `asof: 2025-12-17` shown so the staleness
  is visible; it is a hand-seeded constant in `config/dc_power.json` with no staleness gate.
- **Closing the `capacity.json` NoVa gap** — structural, needs non-filing private operators.
- **`qtrly_estabs`** — available in the same rows, but no column needs it yet. Deliberately not
  ingested; revisit if an establishment-count column earns its place.

## Follow-ups this spec deliberately leaves open

1. `geo_note` in `config/capacity.json` overstates what `approx: true` means (says state-centroid;
   many are town/county centroids). Worth correcting at the next capacity schema rev — tracked
   alongside todo.md items 5 and 21.
2. `when` on `geo[]` entries is absent from `schemas/capacity.schema.json` entirely — neither required
   nor in properties — so a curator could drop it and the run would still validate.
3. `pipeline/publish/capacity.py:20`'s `_YEAR = re.compile(r"20(2[5-9])")` expires in 2030.
4. CLAUDE.md says "32 published files"; there are 33 (it omits `outlook.json`). This feature makes it
   34 — fix the base number, don't propagate the error.

## Process

Spec → `superpowers:writing-plans` → task-level plan in `docs/superpowers/plans/` → TDD implementation
→ review → PR. Invariants from CLAUDE.md and the register's *Invariants any implementation must
respect* apply unchanged; connector failure isolation, append-only store, inline schema validation, and
published weights/formulas are not re-litigated here.
