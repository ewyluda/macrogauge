# Phase 1b Design — The Independent Gauge

**Status:** Approved 2026-07-07 (brainstorming session)
**Inputs:** `docs/macrogauge-design.md` §5 (engine), §6 (JSON contract), §10 (Phase 1 row); Phase 1a/1a.5 plans and their locked deviations.

## 1. Scope

Phase 1 of the master design splits across plans 1b and 1c. **Phase 1b delivers the data
side plus one visible homepage change:**

- Engine stages 1–4 over the vintage store: rebase, blend & splice, quality gate, aggregate.
- Two variants: **gauge** (CPI-comparable, market-rent shelter) and **tracker** (official
  shelter dynamics, built to re-track the print).
- Four published JSONs, each with a schema and one writer: `pulse.json` (supersedes
  `pulse_lite.json`), `gauge_daily.json`, `compare.json`, `gaptable.json`.
- Homepage KPI swap: the gauge YoY joins the hero row using existing components.
- QA growth: five gauge checks in `qa.json`.

**Out of scope (Phase 1c):** `replay.json` (treemap frames — written when its consumer
exists), hero chart, treemap, gap-table UI, methodology page, ECharts, any new site
component. **Out of scope (Phase 2+):** Apartment List/Redfin/AAA/MND/Manheim/USDA
sources, Cost-of-Living/Supercore/PCE variants, nowcasts.

`engine/official.py` and `official.json` are untouched; the interim dashboard keeps
working throughout.

## 2. Decisions locked in brainstorming

1. **1b/1c boundary** — 1b = engine + four JSONs + KPI swap; all charting is 1c.
2. **`replay.json` deferred to 1c** so its frame shape is built alongside the Treemap
   that consumes it.
3. **Quality gate lands in 1b** (design doc listed it ambiguously under Phases 1 and 2):
   it is pure engine math, protects the weekly GASREGW feed now, and Phase 2 scrapes plug
   into a proven gate.
4. **Rounding owner (deferred from 1a):** the pipeline owns all math and publishes final
   rounded numbers — percentages and percentage-points at 2dp, index levels at 2dp. YoY is
   always computed from unrounded indexes, then rounded. The site only formats (1dp
   display for percentages).
5. **`pulse_lite.json` retires** in the same commit `pulse.json` lands — nothing consumes
   it (Phase-0 loop-prover); writer, schema, and tests are removed.
6. **Basket config is JSON** (`config/basket.json`), same locked no-new-deps deviation as
   the series registry (spec shows `basket.yaml`).

## 3. Architecture

Five pure stage modules mirroring the master design's five stages, each a pure function
over plain `{obs_date: value}` dicts, independently unit-testable — plus a thin
orchestrator that reads the store and hands results to writers:

```
pipeline/engine/rebase.py      # stage 1: index any series to Jan-2018 = 100
pipeline/engine/blend.py       # stage 2: blend live sources, splice onto official history
pipeline/engine/gate.py        # stage 3: >5% one-day quality gate
pipeline/engine/aggregate.py   # stage 4: daily grid, Laspeyres, YoY
pipeline/engine/variants.py    # stage 5: gauge + tracker construction
pipeline/engine/gauge.py       # orchestrator: store -> stages -> per-variant results
config/basket.json             # 14 components: weight, official series, live spec, mode
pipeline/publish/pulse.py      # + gauge_daily.py, compare.py, gaptable.py (one per file)
schemas/pulse.schema.json      # + gauge_daily, compare, gaptable schemas
```

Phase 2 then only touches config and adds connectors: Apartment List/Redfin slot into
declared blend weights; scrapes feed the existing gate; Manheim exercises the splice's
late-start path.

## 4. Basket (config/basket.json)

Weights are the master design's 2026 seed weights (BLS December relative importance),
Σ = 1.000, asserted by QA. `mode` is the component's Phase-1b state.

| Component | Weight | Official series | Live source (1b) | Mode |
|---|---|---|---|---|
| shelter_owned | .265 | CUUR0000SEHC | rent blend (gauge only) | live / bls_cf in tracker |
| other | .185 | CUUR0000SAG | — | bls_cf |
| food_home | .082 | CUUR0000SAF11 | — (USDA in Ph2) | bls_cf |
| medical | .081 | CUUR0000SAM | — | bls_cf |
| shelter_rent | .075 | CUUR0000SEHA | zori_us (blend .50; aptlist .30 + redfin .20 in Ph2) | live |
| food_away | .057 | CUUR0000SEFV | — | bls_cf |
| education_comm | .055 | CUUR0000SAE | — | bls_cf |
| recreation | .053 | CUUR0000SAR | — | bls_cf |
| new_vehicles | .036 | CUUR0000SETA01 | — | bls_cf |
| fuel | .030 | CUUR0000SETB01 | eia_gasreg_w (AAA daily in Ph2) | live |
| electricity | .028 | CUUR0000SEHF01 | eia_elec_res | live |
| apparel | .025 | CUUR0000SAA | — | bls_cf |
| used_vehicles | .021 | CUUR0000SETA02 | — (Manheim in Ph2) | bls_cf |
| nat_gas | .007 | CUUR0000SEHF02 | eia_ng_res | live |

Blend specs declare all designed sources with design weights; the blender renormalizes
over sources actually present in the store, so ZORI carries 100% of shelter_rent today
and Phase 2 is a config change.

## 5. Engine stages

**Rebase (stage 1).** Every input series → index with Jan-2018 = 100. Anchor = mean of
the series' observations dated within 2018-01 (robust for weekly GASREGW; for monthly
first-of-month series this is the 2018-01-01 value). Rebase makes price levels
($/gal, cents/kWh, $ rent) unitless and comparable. Series history before 2018 is kept
(indexed relative to the same base) — the store's 2017 rows feed YoY bases for
early-2018 dates.

**Blend & splice (stage 2).** Per component:
1. *Blend:* weighted arithmetic mean of the rebased live series, weights renormalized
   over available sources.
2. *Splice:* component = rebased official BLS history up to the live blend's first date
   `t0`, live blend scaled by `official(t0) / blend(t0)` from `t0` on. In 1b every live
   source starts ≤ 2017-01, so the live segment spans the whole window; the late-start
   path is exercised by tests (and by Manheim in Phase 2).
3. *Re-anchor:* the assembled component is re-indexed so component(Jan-2018) = 100
   exactly — all components share the Laspeyres base point regardless of splice scaling.

Sticky components (mode `bls_cf`) are the rebased official series carried forward
between prints — no fake precision.

**Quality gate (stage 3).** Any live component moving >5% in one day: hold at the prior
value for one day and flag the component (flags surface in QA). Missing inputs carry
forward and lower coverage. Publication never blocks.

**Aggregate (stage 4).** Components are forward-filled onto a daily grid from 2017-01-01
to the max component obs date (the published as-of). `headline = Σ weightᵢ × componentᵢ`
(weights renormalized). `YoY = index_t / index_{t−365d} − 1`, computed on unrounded
values. Published window starts 2018-01-01; YoY is valid from the start because 2017
history feeds the base.

**Variants (stage 5).**
- *Gauge:* the shelter_rent market blend drives **both** shelter_rent and shelter_owned
  weights (.075 + .265).
- *Tracker:* shelter_owned and shelter_rent use official SEHC/SEHA dynamics (bls_cf);
  only fuel/electricity/nat_gas ride live data.

**Coverage.** Per variant: Σ weights of live-mode components whose latest live
observation is within its registry `max_staleness_days`; bls_cf components never count.
Expected at ship: gauge ≈ 40.5%, tracker ≈ 6.5% — published honestly, never inflated.

## 6. Published contract

All four files: one writer module, one schema, validated in `run_daily` before publish
and by `tests/test_published_data.py` on the committed artifact. Percentages/pp 2dp,
index levels 2dp, dates `YYYY-MM-DD`.

**`pulse.json`** — KPI feed:
```json
{ "published_at": "...",
  "gauge":   { "yoy_pct": 2.41, "as_of": "2026-07-06", "coverage_pct": 40.5 },
  "tracker": { "yoy_pct": 2.35, "as_of": "2026-07-06", "coverage_pct": 6.5 },
  "official": { "yoy_pct": 2.4, "prev_yoy_pct": 2.3, "month": "2026-05-01" },
  "gap_pp": 0.01 }
```
`gap_pp` = gauge YoY − official YoY. `as_of` = last daily-grid date.

**`gauge_daily.json`** — columnar daily series per variant, 2018-01-01 → as-of
(~3.1k points/variant; 1c's hero-chart feed):
```json
{ "published_at": "...", "rebase": "2018-01=100",
  "variants": { "gauge":   { "dates": [...], "index": [...], "yoy_pct": [...] },
                "tracker": { "dates": [...], "index": [...], "yoy_pct": [...] } } }
```

**`compare.json`** — monthly grid (our daily index sampled at first-of-month), aligned
to months where official CPI exists:
```json
{ "published_at": "...", "months": ["2018-01-01", "..."],
  "official_yoy_pct": [...], "gauge_yoy_pct": [...], "tracker_yoy_pct": [...],
  "validation": {
    "gauge":   { "corr": 0.0, "mean_abs_gap_pp": 0.0, "window": "2018-01..2026-05" },
    "tracker": { "corr": 0.0, "mean_abs_gap_pp": 0.0, "window": "2018-01..2026-05" } } }
```
`corr` is the Pearson correlation of monthly YoY values over the stated window. The
`validation` block is where the Phase-1 exit criterion (tracker corr ≥ 0.95) is
published; 1c's methodology page reads it from here.

**`gaptable.json`** — per-component decomposition, gauge variant:
```json
{ "published_at": "...", "as_of": "2026-07-06", "official_month": "2026-05-01",
  "rows": [ { "component": "shelter_owned", "label": "Shelter (owned)",
              "weight": 0.265, "mode": "live",
              "ours_yoy_pct": 0.0, "bls_yoy_pct": 0.0,
              "gap_pp": 0.0, "contribution_pp": 0.0 } ],
  "total_gap_pp": 0.0 }
```
`ours_yoy_pct` as of the daily grid end; `bls_yoy_pct` at the latest official month —
being ahead of the print is the point, both carry their as-of. `contribution_pp` =
weight × gap. `mode` labels carried-forward rows honestly (`BLS-CF` badge in 1c).

**Wiring.** `run_daily`: collect → official engine (unchanged) → gauge engine → write
official + pulse + gauge_daily + compare + gaptable + sources_status + qa → validate all
against schemas → publish. `pulse_lite` writer/schema/tests removed in the same commit
`pulse.json` lands.

## 7. Homepage KPI swap

The hero row in `site/src/app/page.tsx` gains a **MACROGAUGE YoY** KpiCard: sky accent
(blue = ours, hard semantic rule), value + as-of from `pulse.json` (build-time import,
same pattern as `official.json`), a DeltaChip showing `gap_pp` vs official, and coverage
as the subtitle (e.g. "40% live weight"). Existing components only. The footer line
promising the gauge "arrives in phase 1b" is replaced with a one-sentence description of
the gauge and its coverage caveat.

## 8. QA growth (qa.json)

Five new checks, same pattern as existing ones; failures surface, never block publish:

1. Gauge headline current — `pulse.gauge.as_of` within 7 days of the run date.
2. No null component values at the daily-grid end.
3. Basket weights sum to 1 (±1e-9).
4. Gauge coverage ≥ 0.35.
5. Tracker corr vs official ≥ 0.95 (from the compare validation block).

## 9. Testing

TDD, red-first, per repo rule; engine tests use hand-computed fixtures via
`vintage.append`/`load` on `tmp_path`; no test touches the network.

- **Per-stage:** rebase anchoring (monthly + weekly mean-of-Jan-2018 + missing-anchor
  error), blend renormalization (single-source and three-source cases — Phase 2
  pre-tested), splice late-start scaling at first overlap, component re-anchor, gate
  holds a >5% one-day move exactly one day + flags, carry-forward lowers coverage,
  Laspeyres aggregation, YoY from unrounded values, variant shelter handling
  (gauge vs tracker differ only in shelter modes).
- **Writers:** shape, rounding, schema validation for all four files.
- **Exit criterion as a test:** tracker monthly-YoY corr vs official ≥ 0.95 computed
  over the real committed store — the phase cannot be called done while red.
- **Contract:** `tests/test_published_data.py` extended to the four committed
  artifacts + cross-file sanity (`gap_pp` ≡ gauge − official within rounding).
- **Site:** `npm run build` + grep for the new KPI label; local serve for the
  controller's visual pass.

## 10. Exit criteria (Phase 1b)

1. Daily run publishes all four gauge JSONs unattended, schema-valid.
2. Tracker monthly-YoY corr vs official CPI ≥ 0.95 on the 2018→now backfill
   (test + QA check + published in `compare.json`).
3. Gauge KPI visible on production homepage with as-of, gap chip, and coverage.
4. QA green (all new checks passing on the committed artifacts).
