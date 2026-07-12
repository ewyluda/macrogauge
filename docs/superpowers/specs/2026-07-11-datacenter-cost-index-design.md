# Data Center Cost Index Design — DC Build + DC Ops + State Parity

**Status:** Approved 2026-07-11 (brainstorming session); revised 2026-07-12 after a
pre-plan code review — anchored splice, series-level basket, source-key isolation,
pinned parity formula, FMP futures coverage confirmed live.
**Inputs:** `docs/macrogauge-design.md` (engine stages, JSON contract, testing);
`config/series.json` / `config/basket.json` (registry + basket patterns); the phase-3/4
isolation architecture in `pipeline/run_daily.py` (three fenced blocks + `*_ok` flags);
the `pce` variant's hand-seeded-weights precedent.

A new page (`/datacenter`) tracking **data center cost inflation** with two custom
weighted input-cost indexes — no official "data center PPI" exists, which is the pitch.
Primary job (locked in brainstorming): *track DC cost inflation over time*; geographic
parity is a supporting table, not the hero.

## 1. Scope

**In scope (v1):**

1. **DC Build index** — cost to construct a data center facility: construction labor,
   materials, electrical equipment, mechanical/cooling equipment. Facility-only.
2. **DC Ops index** — cost to run one: industrial power, facilities/ops labor,
   maintenance & parts.
3. **State parity table** — per-state Build and Ops cost multipliers vs national average.
4. One published artifact `datacenter.json` (+ schema), one new route
   `site/src/app/datacenter/`, nav entry, Playwright smoke 16 → 17 pages.

**Out of scope (deferred):** IT hardware (servers/GPUs/networking) in the index — the
facility-only boundary matches industry construction-cost studies, and hedonically
quality-adjusted official IT price indexes would mislead in the GPU era; an IT-hardware
context *sidebar* is a possible fast-follow. Also deferred: metro-level parity (OEWS is
annual, city cost indexes are proprietary), live power-price proxies for Ops, map
visualization (v1 is a sortable table), non-US geographies. Water/cooling consumables
are excluded from Ops with a stated reason — no public water-price index exists
(utility rate surveys are annual and proprietary); the methodology note says so
explicitly, so the omission reads as considered rather than missed.

## 2. Decisions locked in brainstorming

1. **Time series is the hero.** Headline = YoY for each index; parity table is secondary.
2. **Two separate indexes**, not one blended TCO number — capex and opex inflate on
   different drivers; a capex/opex blend ratio would be an indefensible assumption.
3. **Hybrid data posture** (the site's DNA): monthly official series (PPI/CES/EIA) as the
   backbone, live daily proxies (FMP copper/aluminum futures) spliced on top where markets
   exist — but via an **anchored splice** (§4), not the gauge's replace-after-splice-point
   `splice()`: the official series stays the backbone everywhere it exists, and futures
   drive only the tail past the last PPI print.
4. **Facility-only equipment boundary** (see out-of-scope above).
5. **State-level parity**, honest with public data: EIA state industrial electricity
   prices (monthly) + QCEW state construction wages (quarterly).
6. **Approach A architecture:** full vertical reusing the existing pure engine stages
   (`rebase` → `blend`/`splice` → `gate` → `aggregate`) under a new orchestrator — the
   14-component `gauge.run()` is not touched.

## 3. Components, sources, weights

Backbone series ride **existing connectors** (FRED, BLS, EIA, FMP) — the one confirmed
piece of new connector code is QCEW (small connector or extension, §6). All new series
are entries in
`config/series.json` with per-series `max_staleness_days` (PPI ~45d, EIA state power
~75d, futures 7d as for `fmp_gold`/`fmp_wti` — survives long weekends, QCEW ~270d —
quarterly with a ~5-month publication lag, so the latest observation is legitimately
~8 months old just before a release).

### DC Build (weights sum 1.0, validated on load)

| Component group | Weight | Backbone (monthly) | Live proxy (daily, spliced) |
|---|---|---|---|
| Construction labor | 0.30 | Avg hourly earnings, construction (CES via FRED); PPI specialty-trade contractors (electrical, plumbing/HVAC, nonresidential) | — |
| Materials | 0.25 | PPI: steel mill products, ready-mix concrete, copper wire & cable, aluminum mill shapes | Copper (`HGUSD`) + aluminum (`ALIUSD`) futures (FMP), anchor-spliced onto the matching PPI sub-series |
| Electrical equipment | 0.30 | PPI: switchgear & switchboard apparatus, power & distribution transformers, generator sets / turbine-generators | — |
| Mechanical / cooling | 0.15 | PPI: AC, refrigeration & heating equipment; industrial pumps | — |

### DC Ops (weights sum 1.0, validated on load)

| Component | Weight | Backbone |
|---|---|---|
| Power | 0.55 | EIA US average industrial electricity price (already-integrated source) |
| Facilities/ops labor | 0.30 | Avg hourly earnings, data processing/hosting & related (CES via FRED/BLS) |
| Maintenance & parts | 0.15 | PPI: commercial & industrial machinery repair/maintenance |

### Basket granularity: series-level components, display-level groups

The tables above are *display groups*. The engine basket defines **one component per
series** (each PPI is its own component; weights sum to 1.0 across all components per
basket), with a `group` field carrying the display rollup. Rationale: `blend()`'s
renormalize-on-missing semantics is correct for redundant measures of one concept
(ZORI + Apartment List are both "rent") but wrong for distinct goods — a stale steel
PPI must carry forward, not silently shift its weight to concrete and redefine the
basket. Blend/splice is reserved for genuine same-concept pairs (copper futures ↔
copper wire & cable PPI). The spike subdivides each group weight across its member
series (citations recorded); group sums are preserved, and the page's contribution
bars roll series contributions up by `group`.

### Two honesty rules (carried from repo convention)

- **No invented series IDs.** The table above names series *concepts*. Implementation
  task #1 is a verification spike: confirm each candidate's exact FRED/BLS series ID,
  history depth (must reach 2017-01), and units before wiring anything. Any concept with
  no real series gets dropped or substituted, and its weight renormalized — recorded in
  the spike notes. (Already verified 2026-07-12: FMP `HGUSD` copper and `ALIUSD`
  aluminum futures quote live on the existing `stable/batch-quote` route — see §9
  risk 2.)
- **Cited weights.** Provisional weights above get checked against published industry
  cost breakdowns (Turner & Townsend data centre cost index, CBRE/Uptime-style studies)
  during the spike; final weights and their citations land in the page's methodology
  section, like the `pce` variant's hand-seeded BEA shares. The spike should
  specifically stress-test the electrical-equipment share — hyperscale build studies
  often put electrical systems above 30%.

## 4. Pipeline architecture

- **Registry:** new series entries in `config/series.json` (~15–20 national series +
  per-state power/wage series, §6). `sources_status.json` and staleness handling cover
  them automatically. **The bulk per-state fetches register under NEW source keys
  (`EIA_STATE`, `QCEW`) with their own `FETCHERS` entries** — same connector code,
  separate failure domain. `collect.py` isolates per *source name* and `eia.fetch`
  raises inside its per-series loop, so one bad state series under the existing `EIA`
  key would fail the whole EIA `SourceResult` and drop freshness on the core gauge's
  electricity/nat-gas components. New keys keep the failure-isolation hard invariant
  intact: DC-index plumbing can never lower core-gauge freshness.
- **Basket config:** new `config/dc_basket.json` — two baskets (`build`, `ops`), each a
  flat list of series-level components (`code`, backbone series, `weight`, `group`,
  optional live-proxy series), per §3: weights sum to 1.0 per basket; `group` drives
  display rollups only. Loaded by `pipeline/dc_basket.py`, mirroring `basket.py`
  (weights-sum-1.0 validation on load, unknown series codes rejected).
- **Engine:** new orchestrator `pipeline/engine/dcindex.py` composing the existing pure
  stage functions: `rebase` (base 2018-01 = 100, grid start 2017-01 internally for YoY
  bases, publish from 2018-01), an **anchored splice** for the futures grafts — a small
  variant of `splice()` that anchors at the *last official print* (official series
  everywhere it exists; futures tail scaled to it and re-anchored as each new print
  lands). `splice()` as-is anchors once at the live series' *first* observation and
  discards official data after it — right for the gauge's independent re-pricing
  (Manheim deliberately replaces CPI used-cars), wrong here: raw-metal futures are an
  *input* to a fabricated-product PPI, not a measure of it (~3× the volatility, plus
  contract-roll drift that would compound forever from a fixed splice point). Anchored,
  futures influence is confined to the ~1–2 month nowcast tail and self-corrects at
  every print. Then `gate` (one-day hold on >5% jumps in just-arrived observations),
  `aggregate` (daily forward-fill grid, weighted headline, 365-day YoY). **Component YoY
  is computed at each component's own last observation** — the PPI components lag by
  ~1–2 months and the like-month-to-like-month invariant from `gauge.py` applies
  verbatim (reuse `aggregate.yoy_at_obs`).
- **Store:** same vintage store, new series codes. No row-evolution or schema changes.
  One-time backfills at launch: `HGUSD`/`ALIUSD` daily history via the existing FMP
  `fetch_history` route (phase-2a gold/WTI precedent; vintage = today, never
  backdated). FRED/EIA monthly series arrive with full history on first fetch; QCEW
  fetches only the latest few quarters (parity needs just the latest).

## 5. Publish + run ordering

- One artifact **`datacenter.json`** + JSON Schema in `schemas/`, validated inline as it
  lands. Contents: per-index daily series from 2018-01 (index level + YoY), headline YoY
  per index, per-component YoY + contribution (weight × component YoY, with `group`
  rollups for the display bars), the state parity table (per state: build multiplier,
  ops multiplier, raw input relatives, as-of dates), freshness/meta. The parity table
  carries **latest values + as-of dates only — never per-state histories** (payload
  discipline; cf. the stress.json trim).
- Runs as a **fourth isolated try/except block** in `run_daily.py` with a
  `datacenter_ok` flag in `qa.json` — same pattern as `engine_ok` / `nowcast_ok` /
  `composites_ok`. A broken PPI series can never touch the core gauge, and
  `jsonschema.ValidationError` still re-raises and fails the run (schema-invalid
  artifacts never deploy).
- Published-file count 25 → 26; CLAUDE.md counts updated.

## 6. Geographic parity (state-level)

Per state, two multipliers vs the national average, shown as a sortable table:

- **Ops parity** — driven by EIA state industrial electricity price (monthly;
  `ELEC.PRICE.{ST}-IND.M` via the **existing per-seriesid route** — ~51 sequential GETs
  under the `EIA_STATE` source key, stored as per-state series codes. Zero new
  connector code, ~10–25s of run time; a facets-based single-fetch extension is the
  fallback only if run time becomes a problem).
- **Build parity** — driven by state construction wage level (QCEW NAICS-23 average
  weekly wage, quarterly, ~2-quarter lag). **Confirmed: the existing BLS connector
  cannot reach QCEW as-is** — `bls.py` keeps only `M01–M12` periods, and QCEW rows are
  `Q01–Q04`, so they would be silently dropped even if the v2 API serves `ENU` series.
  Two candidate routes, spike picks one: (a) BLS v2 timeseries API plus a small
  quarterly-period parsing extension, if `ENU` series are actually served; (b) QCEW's
  own open-data CSV API, industry slice
  (`data.bls.gov/cew/data/api/{year}/{qtr}/industry/23.csv`) — one keyless fetch per
  quarter covering every state. Either way it runs under its own `QCEW` source key
  (§4). If it slips, the parity table **degrades gracefully to ops-parity-only** (power
  is the dominant state-varying cost anyway).

Parity math — **pinned formula**. (The earlier "renormalized over what varies" wording
was ambiguous: with a single varying input it collapses to the raw relative, and a
column labeled "build multiplier" would then badly overstate true cost variation.)
Inputs that don't vary by state — materials and equipment; ops labor and maintenance
in v1 — are treated as nationally priced (true to first order; stated in methodology)
and pinned at relative 1.0 at their basket weights:

- **build_mult(state) = w_labor × (state wage / national wage) + (1 − w_labor)** —
  with the provisional §3 weights, `0.30 × wage_rel + 0.70`.
- **ops_mult(state) = w_power × (state industrial ¢/kWh / national) + (1 − w_power)** —
  provisionally `0.55 × power_rel + 0.45`.

The raw input relatives are shown as columns alongside the multipliers. State
facilities-ops wages would need QCEW NAICS-518 per state; upgrade only if the spike
shows it's as cheap as NAICS-23. Each column shows its as-of date; refresh cadence is
whatever the source gives (monthly power, quarterly wages).

Parity is computed in the engine step from the store (pure function, like everything
else) and published inside `datacenter.json` — the site computes nothing.

## 7. Site page

New route `site/src/app/datacenter/` following the established pattern (render pre-baked
JSON only):

1. Hero: two YoY tiles (DC Build, DC Ops) with direction/freshness treatment matching
   existing pages.
2. Indexed time-series chart, both indexes, 2018-01 = 100.
3. Component contribution breakdown (weight × YoY bars) per index.
4. State parity table — sortable by build/ops multiplier, showing input values and as-of
   dates.
5. Inline methodology note: input-price-index framing, facility-only boundary, weight
   citations, splice explanation.

Nav grows by one link. No new client math beyond rendering (vitest only if any client
transform sneaks in; goal is none).

## 8. Testing

Existing conventions apply wholesale:

- **No network, ever.** Every new series gets fixture data wired into
  `test_run_daily.py`'s `fake_get`/`fake_post`.
- **Engine tests are pure dict tests:** anchored splice (futures tail re-anchors when a
  new PPI print lands; official history is never overwritten), YoY-at-own-obs across
  lagging components (base-month-hole walk-back included), stale-series carry-forward
  (a stale steel PPI must NOT shift weight to other components — §3 basket
  granularity), gate hold on a futures spike, parity math against pinned
  worked-example numbers (including the ops-only degraded mode).
- Basket-load validation tests (weights sum, unknown series codes rejected).
- Schema validation test for `datacenter.json`; run-ordering test that a `dcindex`
  failure still publishes status + qa with `datacenter_ok: false`.
- Playwright smoke: `/datacenter` renders, zero console errors.

## 9. Phasing & risks

**V1 ships:** both national indexes, state parity table, page, tests.

**Deferred:** metro parity, live Ops power proxy, IT-hardware sidebar, parity map, ex-US.

**Risks, ranked:**

1. **Series existence** — candidate PPI/CES concepts may not exist as clean monthly
   series with 2017+ history, and detailed PCU/WPU series occasionally get discontinued
   or recoded mid-life (registry staleness catches it when it happens). Mitigation:
   verification spike is implementation task #1; substitution + renormalization rules
   above.
2. **FMP commodity coverage** — **largely resolved 2026-07-12:** `HGUSD` (copper) and
   `ALIUSD` (aluminum) confirmed live on FMP's commodity quote routes — the same
   endpoint family `fmp_gold`/`fmp_wti` already use in production. Residuals for the
   spike: confirm with the pipeline's own `FMP_API_KEY` plan (verification was via a
   different FMP client), and note ALIUSD trades thin — occasional stale/gappy quotes,
   mitigated by the gate stage, 7d staleness, and the anchored splice bounding futures
   influence to the tail. Fallback unchanged: DC Build ships monthly-only.
3. **QCEW plumbing** — a small new connector/extension is now *confirmed* necessary
   (§6: `bls.py` drops quarterly periods); two candidate routes, spike picks one;
   parity degrades to ops-only if it slips.
4. **PPI revision behavior** — PPI revises for ~4 months after first print; the vintage
   store's append-only semantics handle this natively (latest-vintage-wins), but grading
   or replay features for this page are out of scope until revision behavior is observed.
