# Data Center Cost Index Design — DC Build + DC Ops + State Parity

**Status:** Approved 2026-07-11 (brainstorming session)
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
visualization (v1 is a sortable table), non-US geographies.

## 2. Decisions locked in brainstorming

1. **Time series is the hero.** Headline = YoY for each index; parity table is secondary.
2. **Two separate indexes**, not one blended TCO number — capex and opex inflate on
   different drivers; a capex/opex blend ratio would be an indefensible assumption.
3. **Hybrid data posture** (the site's DNA): monthly official series (PPI/CES/EIA) as the
   backbone, live daily proxies (FMP copper/aluminum futures) spliced on top where markets
   exist, exactly as gauge variants graft live data onto official history.
4. **Facility-only equipment boundary** (see out-of-scope above).
5. **State-level parity**, honest with public data: EIA state industrial electricity
   prices (monthly) + QCEW state construction wages (quarterly).
6. **Approach A architecture:** full vertical reusing the existing pure engine stages
   (`rebase` → `blend`/`splice` → `gate` → `aggregate`) under a new orchestrator — the
   14-component `gauge.run()` is not touched.

## 3. Components, sources, weights

Backbone series ride **existing connectors** (FRED, BLS, EIA, FMP) — zero new connector
modules expected (QCEW is the one possible exception, §6). All new series are entries in
`config/series.json` with per-series `max_staleness_days` (PPI ~45d, EIA state power
~75d, futures ~5d, QCEW ~270d — quarterly with a ~5-month publication lag, so the latest
observation is legitimately ~8 months old just before a release).

### DC Build (weights sum 1.0, validated on load)

| Component group | Weight | Backbone (monthly) | Live proxy (daily, spliced) |
|---|---|---|---|
| Construction labor | 0.30 | Avg hourly earnings, construction (CES via FRED); PPI specialty-trade contractors (electrical, plumbing/HVAC, nonresidential) | — |
| Materials | 0.25 | PPI: steel mill products, ready-mix concrete, copper wire & cable, aluminum mill shapes | Copper + aluminum futures (FMP), spliced onto the matching PPI sub-series |
| Electrical equipment | 0.30 | PPI: switchgear & switchboard apparatus, power & distribution transformers, generator sets / turbine-generators | — |
| Mechanical / cooling | 0.15 | PPI: AC, refrigeration & heating equipment; industrial pumps | — |

### DC Ops (weights sum 1.0, validated on load)

| Component | Weight | Backbone |
|---|---|---|
| Power | 0.55 | EIA US average industrial electricity price (already-integrated source) |
| Facilities/ops labor | 0.30 | Avg hourly earnings, data processing/hosting & related (CES via FRED/BLS) |
| Maintenance & parts | 0.15 | PPI: commercial & industrial machinery repair/maintenance |

### Two honesty rules (carried from repo convention)

- **No invented series IDs.** The table above names series *concepts*. Implementation
  task #1 is a verification spike: confirm each candidate's exact FRED/BLS series ID,
  history depth (must reach 2017-01), and units before wiring anything. Any concept with
  no real series gets dropped or substituted, and its weight renormalized — recorded in
  the spike notes.
- **Cited weights.** Provisional weights above get checked against published industry
  cost breakdowns (Turner & Townsend data centre cost index, CBRE/Uptime-style studies)
  during the spike; final weights and their citations land in the page's methodology
  section, like the `pce` variant's hand-seeded BEA shares.

## 4. Pipeline architecture

- **Registry:** new series entries in `config/series.json` (~15–20 national series +
  per-state power/wage series, §6). `sources_status.json` and staleness handling cover
  them automatically.
- **Basket config:** new `config/dc_basket.json` — two baskets (`build`, `ops`), each
  mapping component → member series (with intra-component blend weights) → component
  weight. Loaded by `pipeline/dc_basket.py`, mirroring `basket.py` (weights-sum-1.0
  validation on load).
- **Engine:** new orchestrator `pipeline/engine/dcindex.py` composing the existing pure
  stage functions: `rebase` (base 2018-01 = 100, grid start 2017-01 internally for YoY
  bases, publish from 2018-01), `blend`/`splice` (futures grafted onto PPI history at the
  splice point), `gate` (one-day hold on >5% jumps in just-arrived observations),
  `aggregate` (daily forward-fill grid, weighted headline, 365-day YoY). **Component YoY
  is computed at each component's own last observation** — the PPI components lag by
  ~1–2 months and the like-month-to-like-month invariant from `gauge.py` applies
  verbatim (reuse `aggregate.yoy_at_obs`).
- **Store:** same vintage store, new series codes. No row-evolution or schema changes.

## 5. Publish + run ordering

- One artifact **`datacenter.json`** + JSON Schema in `schemas/`, validated inline as it
  lands. Contents: per-index daily series from 2018-01 (index level + YoY), headline YoY
  per index, per-component YoY + contribution (weight × component YoY), the state parity
  table (per state: build multiplier, ops multiplier, inputs, as-of dates), freshness/meta.
- Runs as a **fourth isolated try/except block** in `run_daily.py` with a
  `datacenter_ok` flag in `qa.json` — same pattern as `engine_ok` / `nowcast_ok` /
  `composites_ok`. A broken PPI series can never touch the core gauge, and
  `jsonschema.ValidationError` still re-raises and fails the run (schema-invalid
  artifacts never deploy).
- Published-file count 25 → 26; CLAUDE.md counts updated.

## 6. Geographic parity (state-level)

Per state, two multipliers vs the national average, shown as a sortable table:

- **Ops parity** — driven by EIA state industrial electricity price (monthly; one
  multi-state EIA API fetch, stored as per-state series codes).
- **Build parity** — driven by state construction wage level (QCEW NAICS-23 average
  weekly wage, quarterly, ~2-quarter lag). *This is the largest plumbing unknown:* if the
  existing BLS connector can't reach QCEW cleanly, it needs a small extension — and if
  that slips, the parity table **degrades gracefully to ops-parity-only** (power is the
  dominant state-varying cost anyway).

Parity math: multiplier = weighted blend of the state-varying inputs, renormalized over
what actually varies by state — materials and equipment are treated as nationally priced
(true to first order; stated in methodology). So **build parity** = state construction
wage relative, weighted at the labor share, renormalized. **Ops parity (v1)** = state
industrial power price relative at the power share, renormalized — ops labor and
maintenance are treated as nationally priced in v1 (state facilities-ops wages would
need QCEW NAICS-518 per state; upgrade only if the spike shows it's as cheap as
NAICS-23). Each column shows its as-of date; refresh cadence is whatever the source
gives (monthly power, quarterly wages).

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
- **Engine tests are pure dict tests:** splice-onto-PPI-history, YoY-at-own-obs across
  lagging components (base-month-hole walk-back included), weight renormalization when a
  source is stale, gate hold on a futures spike, parity math (including the
  ops-only degraded mode).
- Basket-load validation tests (weights sum, unknown series codes rejected).
- Schema validation test for `datacenter.json`; run-ordering test that a `dcindex`
  failure still publishes status + qa with `datacenter_ok: false`.
- Playwright smoke: `/datacenter` renders, zero console errors.

## 9. Phasing & risks

**V1 ships:** both national indexes, state parity table, page, tests.

**Deferred:** metro parity, live Ops power proxy, IT-hardware sidebar, parity map, ex-US.

**Risks, ranked:**

1. **Series existence** — candidate PPI/CES concepts may not exist as clean monthly
   series with 2017+ history. Mitigation: verification spike is implementation task #1;
   substitution + renormalization rules above.
2. **FMP commodity coverage** — the current FMP plan may not include copper/aluminum
   futures endpoints. Fallback: DC Build ships monthly-only (still correct, just less
   daily motion); proxies added when access is confirmed.
3. **QCEW plumbing** — largest new-code unknown; parity degrades to ops-only (§6).
4. **PPI revision behavior** — PPI revises for ~4 months after first print; the vintage
   store's append-only semantics handle this natively (latest-vintage-wins), but grading
   or replay features for this page are out of scope until revision behavior is observed.
