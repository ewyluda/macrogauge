# Phase 1c Design — Homepage Viz + Methodology (nowflation-faithful)

**Status:** Approved 2026-07-08 (brainstorming session)
**Inputs:** `docs/macrogauge-design.md` §5 (engine), §6 (JSON contract), §7 (front end / design
tokens), §10 (Phase 1 row); `docs/superpowers/specs/2026-07-07-phase-1b-gauge-design.md` (1b/1c
boundary); nowflation teardown `dashboards/nowflation-site-teardown.md` §4 (design system) and §5
(homepage inventory) + `dashboards/nowflation-screenshots/index.png` — both in the notebook repo.

## 1. Scope

Phase 1c completes the Phase-1 homepage: the visualization layer over the JSONs 1b already
publishes, plus the two new pipeline writers those visuals require, plus one gating engine
correction. Styling and layout follow nowflation.com **exactly** for the sections we build here.

**In scope:**

- **Engine correction (gating, ships first):** headline YoY switches to per-component own-end
  aggregation (Option A, §3) so the daily hero line launches clean instead of sawtoothed.
- **Chart infrastructure:** ECharts + one shared `EChart` client component owning the dark theme.
- **Hero chart:** daily YoY multi-series line (gauge / tracker / official), 2018→now.
- **Basket treemap + replay scrubber:** all five modes (YoY / MoM-ann / vs-BLS / 1-day Δ / WoW Δ),
  ▶ Play + month scrubber 2018→now, backed by a new `replay.json`.
- **Gap table:** variant-level index cuts (gauge, tracker vs official) + component decomposition.
- **Methodology page** at `/methodology`, backed by a new generated `methodology.json`.

**Out of scope (Phase 2+):** Cost-of-Living / Supercore / PCE variants and their hero-chart lines
and gap-table rows; official-core time series; nowcast / Fed-watch / top-movers / quilt / gap-signal
/ forecast-accountability / metros / grocery homepage sections (later phases). The homepage grows to
the Phase-1 subset of nowflation's flagship page, not the whole 5,000px.

## 2. Decisions locked in brainstorming

1. **Follow nowflation styling/layout exactly** for every 1c section (hero, treemap, gap table,
   methodology), scaled to the series we have live. Absent variants leave absent legend slots /
   table rows — never faked (Phase-1 honesty rule).
2. **Full 1c in one plan** — frontend viz *and* both new pipeline writers (`replay.json`,
   `methodology.json`), each with a schema, a writer, and tests.
3. **All five treemap modes** are supported now, which requires the engine to expose per-component
   daily series (§6). The two daily-delta modes (1-day, WoW) are the reason.
4. **Headline-YoY methodology is resolved before the hero ships (Option A, §3)** — not reframed in
   copy, not deferred. The hero must launch clean.
5. **`index` (Laspeyres level) is untouched** by the Option A change — only the headline `yoy`
   derivation changes. The level still powers "prices up X% since 2018."
6. **Chart library = ECharts** (locked in the master spec; nowflation uses it; its native `treemap`
   series covers the replay). Integrated as a client component with `ssr:false` so the static
   export stays clean.

## 3. Engine correction — headline YoY (Option A)

### 3.1 The defect

The component-level YoYs in `gaptable.json` are already clean: the shipped `own_end` fix
(`gauge.py:75`, commit `f9eccf7`) computes each component's YoY at its **own last observation** so
lagging series compare like-month-to-like-month. The **headline** never got that fix. It computes

```
out[variant]["yoy"] = aggregate.yoy(index)            # gauge.py:78
```

i.e. YoY as a **ratio of weighted sums at grid dates**. At the grid end the bls_cf components are
forward-filled to their last print (May), while the base-year grid benefits from a print (June
prior-year) the current year does not have yet — a one-month numerator/denominator misalignment
that biases the headline down between prints and snaps back on print day (the sawtooth).

### 3.2 The fix

Aggregate the already-clean component YoYs instead:

```
headline_yoy(d) = Σ_i  weight_i × component_yoy_i(d)
```

where `component_yoy_i = aggregate.yoy(daily[code])` (each component on its own forward-filled
daily grid), over the date-intersection where every component has a non-None YoY — the same
intersection discipline `aggregate.headline()` already uses for the index.

- **`aggregate.py`:** add `weighted_yoy(component_yoys: dict[str, dict[str, float|None]],
  weights: dict[str, float]) -> dict[str, float]`.
- **`gauge.py`:** build `component_yoys[code] = aggregate.yoy(daily[code])` (already computed for
  the gaptable snapshot; reuse per date), set `out[variant]["yoy"] = aggregate.weighted_yoy(...)`.
  The only field that changes is `out[variant]["yoy"]`. `index` (the Laspeyres level) and the
  per-component `end_value` (`daily[code][end]`, an index value QA reads) are untouched.

### 3.3 Evidence (computed 2026-07-08 from committed store output)

| Gauge headline | Value | Gap vs official 4.25% |
|---|---|---|
| Published now (ratio-of-sums, grid-end) | 2.30% | −1.94pp |
| Fixed (Σ weight × like-month component YoY) | **3.38%** | −0.87pp |

The method validates: the **same** weighted-component aggregation applied to the **BLS** component
YoYs reconstructs official CPI to **4.316% ≈ 4.25%** (within rounding). So the aggregation is sound,
the fix removes ~1.1pp of mechanical timing noise, and the residual −0.87pp is genuine divergence —
almost entirely fuel (ours 19.4% vs BLS 40.5%, −0.63pp). Contributions now **sum to the headline**,
which the gap table and treemap already assume.

### 3.4 Ripples — all recompute, all re-validated

- `pulse.json` (gauge ~2.3→~3.4, tracker likewise up, `gap_pp` shrinks), `compare.json`
  gauge/tracker series and their `validation` stats, `gauge_daily.json` `yoy_pct`.
- **Re-verify the pinned exit criterion `tracker corr ≥ 0.95`** (`9594a36`) still holds — expected
  to *improve*, since the aligned tracker sits closer to official. Update the pinned expected
  values deliberately, with the new computed numbers recorded in the task log (tee-verbatim).
- QA gauge checks that assert on the headline value get their expected numbers refreshed.

## 4. Chart infrastructure

- Add **ECharts** to `site/package.json`, imported modularly (`echarts/core` + only the used
  charts/components) to keep the bundle lean.
- **`site/src/components/EChart.tsx`** — a `"use client"` wrapper, dynamic-imported with
  `{ ssr: false }` at each use site so nothing renders ECharts during static export. Owns the
  shared dark theme derived from the existing CSS tokens (`globals.css`): thin 1.5–2px lines,
  sparse muted gridlines, no axis titles, dashed gray for official/comparison series, dark
  tooltips, legend chips with colored dots. Resizes with its container. Every later-phase chart
  reuses it.
- Semantic color mapping stays a hard rule: sky = ours, amber = official/cost, red = hot, emerald
  = cool/verified, violet = alt series.

## 5. Hero chart — `HeroChart.tsx`

- Daily YoY multi-series line, exact nowflation layout: centered legend chips, 5% gridlines, time
  axis 2018→now, thin lines, dark tooltip.
- Series live today: **Gauge** (sky) and **CPI-Tracker** (violet), daily from
  `gauge_daily.json.variants.*.yoy_pct`; **Official CPI** (dashed gray), monthly-stepped from
  `compare.json.official_yoy_pct`. Cost-of-Living and Official-Core legend slots are omitted until
  those series exist (Phase 2+).
- The line launches **clean** because of §3. A lead-lag / coverage callout renders beneath it
  (nowflation pattern: "gauge N% · coverage X% independent data · vs official").
- NBER recession shading and any dashed reference lines come from the shared `EChart` theme.

## 6. Basket treemap + replay — `Treemap.tsx` + `replay.json`

### 6.1 Component

- ECharts `treemap` series: **tile area = basket weight, color = selected mode metric** on the
  blue→red diverging scale (−2%→6%), tile label = component name + value. Matches the screenshot.
- **Five mode chips:** YoY / MoM-ann / vs-BLS / 1-day Δ / WoW Δ. A **▶ Play button + month
  scrubber** hydrated client-side replays 2018→now; the footer shows "Ours N% · BLS M%" at the
  scrubber position (nowflation pattern).

### 6.2 Engine exposure

`gauge.run()` already builds `daily[code]` (per-component forward-filled daily index) and the
per-component official/BLS index internally; today it returns only scalars. Extend the return so
`out[variant]` carries, per component, the daily `index[]` and `bls_index[]` over the shared grid
dates (published from `PUBLISH_START`). No new math — exposure only.

### 6.3 `replay.json` (new writer + schema)

Per component: `{ code, label, weight, index[], bls_index[] }` over a shared `dates[]`. The five
mode colorings are **display transforms** the client derives from the two index arrays
(YoY = idx[d]/idx[d−365]−1; MoM-ann from month samples; 1-day / WoW from daily diffs; vs-BLS =
ours_yoy − bls_yoy). This is a **deliberate, bounded exception** to the §6 "site only formats" hard
rule: the engine remains the sole source of the indices, and the client only does trivial
difference/ratio arithmetic on published numbers — it never re-derives the gauge or re-fetches
sources. (Alternative, if we prefer strict adherence: the writer precomputes all five mode arrays,
~5× the file size; the plan may revisit.)

- **Size:** ~14 components × ~3,100 daily points × 2 arrays ≈ ~700 KB–1 MB. Acceptable for a
  **lazy-loaded, non-blocking** widget (gauge_daily.json is already 322 KB). If it exceeds ~1 MB,
  the plan applies rounding to 2dp and, if still large, delta-encoding — decided in-plan, not here.
- Schema in `schemas/`, validated in `run_daily` before deploy (ValidationError hard-fails, per the
  existing ordering); one writer module; pure-function tests against a fixture.

## 7. Gap table — `GapTable.tsx`

- **Homepage variant-level table** (nowflation "NOWFLATION VS OFFICIAL — GAP TABLE"): columns
  INDEX · OURS YoY · LATEST OFFICIAL YoY · GAP chip · NEXT PRINT. Rows live today: **Gauge** and
  **CPI-Tracker** vs official, from `pulse.json` + `compare.json`. Gap chips colored (blue
  negative), next-print date in amber. Absent variants = absent rows.
- **Component decomposition table** below the treemap, straight from `gaptable.json` (label, weight,
  mode `LIVE`/`BLS-CF` pill, ours vs BLS YoY, gap, contribution) — the "gap-table UI" deliverable.

## 8. Methodology page — `/methodology` + `methodology.json`

- New route `site/src/app/methodology/page.tsx`, nowflation-styled explainer (uppercase section
  labels, muted METHODOLOGY prose cards, in-text links).
- **`methodology.json` (new writer + schema), generated — never hand-written** — from
  `config/basket.json` + the series registry + `compare.json.validation`, so docs cannot drift from
  code: the gauge formula, the 14-component weight table (weight, source, live/bls-cf), the
  blend/splice description, the gauge-vs-tracker variant definitions, and live corr / mean-abs-gap
  per variant. Schema-validated in `run_daily`; pure-function writer test.

## 9. Testing & validation

- **Pipeline:** unit test `aggregate.weighted_yoy` against a hand-computed fixture; pure-writer
  tests for `replay.py` and `methodology.py` against fixtures; extend the end-to-end
  `test_run_daily.py` (fake_get/fake_post already cover every source) to assert the two new files
  land and validate; bump the published-file and QA-count assertions by the two new files; update
  the pinned tracker-corr and any headline-value assertions to the recomputed numbers, evidence
  tee'd verbatim into the task log.
- **Contract:** JSON Schema for `replay.json` and `methodology.json`; both validated in CI and in
  the daily run before deploy.
- **Site:** `npm run build` (static export) must stay green in CI; charts hydrate client-side
  against the imported JSONs; no console errors on the homepage or `/methodology`.

## 10. Build order

Each part is independently testable and commit-able:

1. **Part 0 — engine fix (§3):** `weighted_yoy` + `gauge.py` wiring; recompute; re-validate and
   re-pin tracker corr. *Gates everything — the hero renders its output.*
2. **Part 1 — chart infra (§4):** ECharts + `EChart` component + theme.
3. **Part 2 — hero chart (§5).**
4. **Part 3 — treemap + replay:** engine exposure (§6.2) → `replay.json` writer + schema + tests
   (§6.3) → `Treemap.tsx` with all five modes (§6.1).
5. **Part 4 — gap table (§7).**
6. **Part 5 — methodology page + `methodology.json` (§8).**

## 11. Exit criteria (Phase 1c)

- Headline daily YoY is per-component own-end aggregated; hero line renders with no systematic
  print-day sawtooth; `tracker corr ≥ 0.95` re-verified and re-pinned; BLS-reconstruction sanity
  check (weighted BLS component YoY ≈ official) recorded.
- Homepage renders, from pre-baked JSON only: KPI hero row (existing) + daily hero chart + basket
  treemap with working ▶ replay across all five modes + variant gap table + component decomposition
  + sources row (existing).
- `/methodology` renders from generated `methodology.json`.
- `replay.json` and `methodology.json` publish with passing schemas; `run_daily` still exits 0 with
  a broken engine (status + qa still publish) and hard-fails on any schema-invalid artifact.
- `pytest -q` green (new writer/aggregate tests included); `npm run build` green.
