# Phase 2a Design — Full-Blend Data Layer

**Status:** Approved 2026-07-09 (brainstorming session)
**Inputs:** `docs/macrogauge-design.md` §4 (connectors), §5 (engine + variants), §6 (JSON
contract), §8 (QA), §10 (Phase 2 row); `.superpowers/sdd/progress.md` 1c final-review fix-soon
backlog; `config/basket.json` (live_blend weights already seeded for shelter);
`config/series.json` (31-series registry as of 1c).

Phase 2 was split in brainstorming: **2a = this spec** (connectors, engine, variants, new JSON
artifacts — everything the pipeline publishes), **2b = the six Phase-2 pages** (quilt, supercore,
my-inflation, calculator, real-wages, grocery cards) consuming 2a's artifacts. 2b gets its own
spec when 2a ships.

## 1. Scope

**In scope (ordered — Approach A, risk-graded):**

1. **Entry tasks (first commits, per the ledger convention):**
   - `replay.json` carries per-component own-obs YoY, and the treemap's YoY/vs-BLS modes read
     it, so the final frame reconciles with the published headline — the 365d-level-ratio
     footer caveat comes out in the same task (data fix + its one consumer, self-contained).
   - `methodology.json` `live_sources` annotated active vs `(phase-in)` — resolves itself as 2a
     connectors land, but the annotation ships first so the page is honest at every commit.
   - `/methodology` renders the `lead_lag` stat in its validation section.
   - **FMP history backfill:** one-time historical pull (FMP history endpoint) into the vintage
     store so Markets KPI YoY renders before 2027. Store rows are appended with today's vintage
     month (we learned them today) — never backdated vintages.
2. **Connectors, cheap→risky:** Apartment List (CSV), Redfin (CSV) → USDA (API, key) →
   AAA gas (scrape), Mortgage News Daily (scrape), Manheim (scrape). Registry entries, recorded
   fixtures, drift assertions per §3.
3. **Component rewiring (config):** shelter blend activates its seeded 3-source weights; fuel
   moves to AAA-daily-primary with EIA GASREGW demoted to QA cross-check; used_vehicles rides
   Manheim shifted +30d; food_home rides the USDA composite. The seven sticky components stay
   BLS carry-forward by design.
4. **Variants 2→5:** Cost-of-Living, Supercore, PCE-weighted join gauge/tracker (§4).
5. **New published artifacts:** `quilt_months_{24,48,all}.json` (+1 schema),
   `grocery_basket.json` (~25 BLS AP items, expanded from the current 6) (+1 schema);
   `compare`/`gaptable`/`methodology` extend to five variants. Published files 9 → 14.
6. **Close-out:** scrape-failure live drill (§7), full republish, ship.

**Out of scope:** all Phase-2 pages (2b); nowcasts/benchmarks (phase 3); composites (phase 4);
Vercel-Auth public-access decision (separate ops call); release-calendar 2027 refresh (dated
~2026-10); the gaptable base-hole month-aware walk-back (dated, must land before 2026-11-12 —
tracked independently of phase numbering).

**Already built, not rebuilt here:** the quality gate (`gate.py`, 1b) — 2a only routes the new
daily sources through it; blend renormalization for sources phasing in at different start dates
(`blend.py`, 1b) — activation is config.

## 2. Decisions locked in brainstorming

1. **2a/2b split** of the spec's Phase 2 row (data layer vs pages), each with its own spec+plan.
2. **Grocery basket expands to ~25 AP items now** — one batched BLS request covers it, and
   revision vintages start accruing for the phase-5 cart page. Item list is a plan task
   (spec open question #4), anchored on the existing 6 staples.
3. **FMP history backfill folds into 2a** (open since 1a.5).
4. **Approach A sequencing** — entry tasks → CSVs → USDA → scrapes → variants → writers → drill.
   Scrapes get maximum store soak time before variants depend on them; the shelter blend
   improves the gauge within the first few tasks.
5. **Coverage exit figure recomputed:** the master spec's "~37%" predates 1c making shelter
   live. Expected gauge live coverage after 2a ≈ **50.8%** (40.5 + used_vehicles 2.1 +
   food_home 8.2). The master spec table figure is stale, not a target.

## 3. Connectors & registry

One module per source in `pipeline/connectors/`, `http_get`/`http_post` injected, failure
isolation via `SourceResult` (hard invariant: a broken source lowers freshness and surfaces in
`sources_status.json` + `qa.json`, never blocks the run). Series driven by `config/series.json`.

**Every connector task opens with a live access spike:** verify the URL/format against the real
source, record genuine fixtures into `tests/fixtures/`, then TDD against them. (1a lesson: four
wire-format bugs the mocked suite couldn't see.) Access mechanics below are best-known and are
pinned by that spike:

| Source | Route | Cadence | Access (verify in spike) | max_staleness | On failure |
|---|---|---|---|---|---|
| Apartment List | CSV | monthly | research/data page CSV, national rent index | ~45d | blend renormalizes to zori/redfin |
| Redfin | CSV | monthly | Data Center TSV (public S3), national rents | ~45d | blend renormalizes |
| AAA gas | scrape | daily | gasprices.aaa.com national average | ~4d | fuel → EIA weekly → BLS-CF |
| MND 30yr | scrape | daily | mortgagenewsdaily.com rate page | ~5d | CoL rate → PMMS weekly |
| Manheim | scrape | monthly (mid + full) | UVVI publish page | ~45d | used_vehicles → BLS-CF |
| USDA | API (key) | weekly/monthly | AMS Market News and/or NASS QuickStats | ~30d | food_home → BLS-CF |

- **Scrape protections (spec §4, mandatory):** recorded HTML fixtures; structure-drift
  assertions (selector still matches, value in plausible range); the >5% one-day gate;
  carry-forward. A moved page degrades coverage, never correctness.
- **USDA composite construction rule (fixed now; series list is a plan research task):** a
  fixed-weight basket of USDA wholesale/retail food series. Weights live in config (alongside
  the basket, not in code), the composite is computed as a weighted mean of rebased inputs, then
  spliced onto official food_home history exactly like every other live source. If the research
  spike finds USDA coverage too thin for an honest composite, food_home stays BLS-CF and the
  spec's food_home row moves to a later phase — recorded as a deviation, not silently absorbed.
- **Fuel demotion is config + one QA check:** EIA GASREGW keeps collecting; a new QA check
  flags AAA-vs-GASREGW weekly divergence beyond a threshold set in the plan.
- **Registry adds:** ~6 live-source series (`aptlist_us`, `redfin_us`, `aaa_gas_d`, `mnd_30y_d`,
  `manheim_uvvi_m`, USDA composite inputs) + ~19 AP grocery items (one batched BLS request —
  50-series/request limit, quota trivial).
- **New secret:** one USDA API key in GitHub Actions, same pattern as FRED/EIA/BLS/FMP; error
  strings sanitized (key redaction already value-based since 1a).

## 4. Engine

All changes stay within the five pure stages; no stage gains I/O.

- **Manheim +30d lead shift:** a new optional `lead_days` field on a blend source in
  `basket.json` (`{"manheim_uvvi_m": {"weight": 1.0, "lead_days": 30}}` or equivalent shape
  chosen in the plan). The shift is applied engine-side at blend time — a view over the store.
  **Store rows keep true observation dates** (append-only/immutable policy untouched).
- **Cost-of-Living variant:** a new pure function computes the marginal-buyer payment index
  `P = L·r(1+r)³⁶⁰ / ((1+r)³⁶⁰ − 1)`, `L = 0.80 × ZHVI`, `r = 30yr rate / 12` (MND daily,
  PMMS weekly fallback), rebased to 2018-01 = 100, replacing `shelter_owned` in this variant
  only. Hand-computed fixture cases mandatory (payment math is the kind of thing that's wrong
  by 12× silently).
- **Supercore:** subset + renormalization in the variants stage; the component subset lives in
  config (`supercore_components`), seeded in the plan from BLS service classifications. Code
  never hardcodes the list.
- **PCE-weighted:** each basket component gains `pce_weight` (hand-seeded from BEA December
  shares, refreshed annually like CPI weights, **validated Σ = 1.0 on load** like `weight`).
  Graded vs official PCE: one new FRED registry row (PCEPI), and `official.py` grows a PCE
  column only if the plan finds it cheap — otherwise grading vs PCE lands in compare stats.
- **Variants:** `variants.VARIANTS` 2 → 5. Which components ride live in which variant stays
  config (`live_variants` lists in `basket.json`), not code. Component YoY remains computed at
  each component's own last observation (the 1c invariant) in every variant.

## 5. JSON contract additions

- **`quilt_months_{24,48,all}.json`** — one writer, one schema, three window files: month ×
  component YoY grid (ours + official per cell), feeding 2b's `QuiltHeatmap`. Data is a re-cut
  of the engine's monthly series (compare-style), no new engine math.
- **`grocery_basket.json`** — ~25 AP items: label, unit, latest price, m/m and y/y change,
  as-of date. One writer, one schema.
- **`compare.json` / `gaptable.json` / `methodology.json`** extend from 2 to 5 variants
  (validation stats — corr + mean abs gap — published per variant, same as gauge/tracker today).
  Schema bumps follow the 1c Task-3 precedent: committed-data contract tests regenerate in-task.
- **`replay.json`** gains per-component own-obs YoY (entry task, §1.1).
- Published file count 9 → 14. Every new file gets a JSON Schema in `schemas/`, validated before
  landing; the run_daily ordering invariants (status-first, ValidationError-fails-run) are
  pinned by existing tests and untouched.

## 6. QA additions

- AAA-vs-EIA GASREGW weekly divergence flag (threshold in plan).
- Quilt frames complete (every month in window has all 14 components or an explicit null).
- Grocery basket fresh (AP series within staleness).
- `sources_status.json` grows to 13 connectors; per-connector checks come free from the
  existing framework.
- Coverage threshold check re-pinned at the new expected ~51% (exact value from the first real
  run, pinned honestly, not aspirationally).

## 7. Testing & the live drill

Existing conventions hold: HTTP injected never real, fixtures per source, pure-stage unit tests,
contract tests over committed data, no network in tests.

New in 2a:
- Hand-computed fixtures for: payment-index math (CoL), supercore renormalization, PCE
  aggregation, lead-shift blend, quilt grid shape.
- Structure-drift assertions per scrape (selector matches, plausible-range).
- `test_run_daily`'s end-to-end fake extends to all 13 sources.
- **Live drill (exit criterion):** a controlled local run with each scrape's fetch deliberately
  raising, verifying: component falls to its documented fallback, coverage drops, QA +
  `sources_status` surface it, all 14 files publish, exit 0. Drill evidence (tee-verbatim, per
  process conventions) goes in the task report.

## 8. Exit criteria

1. All 14 components on their spec'd sources (live where spec'd, BLS-CF for the seven sticky).
2. Live drill passes per §7.
3. Five variants published with corr + mean-abs-gap in methodology; tracker corr ≥ 0.95 pin
   holds (existing test).
4. `quilt_months_*` + `grocery_basket` schema-validated and published by the daily run.
5. Full suite green; site build green (methodology page renders lead_lag + 5 variants).
6. Gauge live coverage ≈ 51% published honestly.

## 9. Resolve in the plan (not blocking this spec)

1. USDA series list + composite weights (research spike; §3 fallback rule if coverage too thin).
2. The ~25 AP grocery item list (anchor: existing 6 staples; target the teardown's cart set).
3. `supercore_components` seed list from BLS service classifications.
4. `pce_weight` seed values from BEA December shares.
5. Exact `lead_days` config shape (per-source dict vs parallel map).
6. AAA-vs-GASREGW divergence threshold.
7. Whether official PCE YoY goes through `official.py` or compare stats only.

## 10. Risks

- **Scrape fragility** (AAA, MND, Manheim) — accepted with the master spec's mitigations (§3
  protections + drill). Manheim is the most likely to require access adjustments (proprietary
  daily index; we consume the monthly publish page only).
- **USDA composite honesty** — the fallback rule in §3 prevents a thin composite from shipping
  as if it were food_home; worst case food_home stays BLS-CF and coverage lands ~43% not ~51%.
- **Schema bumps on committed data** — 1c Task-3 precedent applies: regenerate committed
  artifacts in-task from the committed store, byte-reproducible by the reviewer.
- **Daily bot commits during the phase** — rebase over `data: daily publish` per convention;
  store JSONL conflicts resolve by union.
