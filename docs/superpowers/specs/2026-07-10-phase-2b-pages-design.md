# Phase 2b Design — The Six Phase-2 Surfaces

**Status:** Approved 2026-07-10 (brainstorming session)
**Inputs:** `docs/macrogauge-design.md` §6 (JSON contract), §7 (front end), §9 (testing),
§10 (Phase 2 row); `docs/superpowers/specs/2026-07-09-phase-2a-full-blend-data-design.md`
(2a/2b split); the nowflation teardown + screenshots
(`~/Development/notebook/dashboards/`, esp. `supercore.png`, `calculator.png`,
`my-inflation.png`, `real-wages.png`, `index.png` quilt/grocery modules); the 13 published
artifacts as of the 2a ship (2026-07-10).

Phase 2 was split in 2a brainstorming: 2a shipped the data layer (5 connectors, 5 variants,
13 published files). **2b = this spec:** the six Phase-2 surfaces consuming those artifacts.
In the original site the quilt and grocery cards are *homepage modules*, not routes — so 2b
is four new routes + two new homepage modules (decision #1 below).

## 1. Scope

**In scope (ordered — Approach A, vertical slices, artifact-touching surfaces first):**

1. **Grocery module** — `grocery_basket.json` gains per-item monthly series (store already
   holds 2017→now); two utility AP codes join the registry; homepage sparkline-card row.
2. **Real-wages page** — 1–2 wage series join the registry (FRED connector); new
   `real_wages.json` writer + schema (published files 13 → 14); `/real-wages` route.
3. **Quilt module** — `QuiltHeatmap` component (24M/48M/full toggles, 1920×1080 PNG export)
   on the homepage. No pipeline changes.
4. **Supercore page** — `/supercore` route. No pipeline changes.
5. **Calculator page** — `/calculator` route. No pipeline changes.
6. **My-inflation page** — `/my-inflation` route, the personal basket reweighter. No
   pipeline changes.

Cross-cutting, landing with their first consumer: `SparklineCard`, `SegmentedControl`
components; vitest for client math; Playwright smoke pass in CI; flat nav grows to six links.

**Out of scope:** my-inflation **state toggle** (needs `states.json`, Phase 4); grocery
**cart page** + per-item pages + share-URLs (Phase 5); Indeed wage tracker (original's
second wage line — we substitute Average Hourly Earnings; revisit when `labor.json` lands
in Phase 4); nav dropdown mega-menus (Phase 3/4 when page count demands them); light-theme
toggle (unphased, not 2b); nowcast/outlook homepage modules (Phase 3).

## 2. Decisions locked in brainstorming

1. **Faithful structure:** 4 routes (`/supercore`, `/my-inflation`, `/calculator`,
   `/real-wages`) + 2 homepage modules (quilt, grocery cards) — matching the original,
   where quilt and grocery are homepage modules only.
2. **Slim wage artifact now** (not deferring to Phase 4's `labor.json`): Atlanta Fed Wage
   Growth Tracker + Average Hourly Earnings via the existing FRED connector, published in a
   new `real_wages.json`. Full-fidelity page in 2b; `labor.json` still arrives in Phase 4.
3. **Calculator is gauge-era** (2018-01 →, daily resolution) — that is its pitch
   ("daily-resolution answer official calculators can't give"); powered by
   `gauge_daily.json` alone.
4. **Utility AP codes added** (electricity $/kWh, piped gas $/therm) so the grocery card
   row matches the original's six staples exactly.
5. **Approach A sequencing** — artifact-touching slices first (grocery, real-wages) so
   republishes cluster early; pure-frontend slices after; my-inflation last (most intricate
   client logic).
6. **Testing infra lands in 2b:** vitest for client math (the math *is* the product on
   these pages) and the design-spec §9 Playwright smoke pass (right phase — pages go 2 → 6).

## 3. Pipeline & contract changes

All additive; no existing field renamed, removed, or retyped.

**`grocery_basket.json`** — each item gains
`series: {months: ["2018-01", …], prices: [...]}` (monthly, published from 2018-01 per the
publish-window convention). Writer + schema change only; data is already in the store. The
artifact stays pure data for all items — the homepage curates its featured cards via a code
constant in the site (selection is formatting).

**Registry additions** (`config/series.json`):
- 2 BLS AP utility series: electricity per kWh, utility (piped) gas per therm — same
  connector, same chunked fetch, monthly cadence. Exact AP codes verified in the plan
  (access spike). They flow into `grocery_basket.json` like the food items.
- 1–2 FRED wage series: Atlanta Fed Wage Growth Tracker (overall median — already a
  12-month growth rate) and Average Hourly Earnings, total private (level series). Exact
  FRED IDs verified in the plan (access spike); if the WGT turns out not to be on FRED,
  fallback is AHE-only with the chart note adjusted (risk §10).

**New `real_wages.json`** (writer `pipeline/publish/real_wages.py`, schema
`schemas/real_wages.schema.json`, published files 13 → 14):

```json
{
  "published_at": "...",
  "kpis": {
    "wage_growth_pct": 3.5,          // latest Atlanta Fed WGT median
    "wage_as_of": "2026-05",
    "real_wage_growth_pct": 1.77     // (1+wage)/(1+gauge_yoy) - 1, pipeline-computed
  },
  "series": {
    "months": ["2019-01", "..."],
    "atlanta_wgt_yoy_pct": [...],    // pass-through (already a growth rate)
    "ahe_yoy_pct": [...]             // YoY computed in the writer from the level series
  }
}
```

Wage series are not basket components: they pass store → writer directly (the `official.py`
pattern), never touching the engine. The page's gauge/official numbers come from
`compare.json` / `pulse.json` — deliberately not duplicated here, so every number has
exactly one published source. Engine: **zero changes** in 2b.

## 4. Homepage modules

Current homepage flow: KPI hero → hero chart → treemap → gap decomposition → gap table →
official CPI components → source groups → Sources.

**Inflation quilt** — new section after the gap table ("Inflation quilt — every component,
every month"). `QuiltHeatmap` component:
- 14 component rows (ordered by basket weight, shelter first) × month columns; each cell
  prints our YoY (`ours_yoy_pct`), colored on the treemap's −2% → 6% blue→red scale — one
  shared scale function, one semantic mapping site-wide.
- Below a visual gap, five headline rows from `compare.json`: OURS: CPI-Comparable /
  Cost of Living / CPI-Tracker / BLS: CPI YoY / BLS: Core CPI YoY — the original's exact
  row set. Supercore/PCE variants stay off the quilt (they have their own surfaces). BLS
  trailing months where the print lags render as empty cells, never forward-filled.
- `24M / 48M / FULL HISTORY` segmented control switching between the three published quilt
  files (all imported at build time).
- **"Export 1920×1080 PNG"** button: client-side canvas render at fixed 1920×1080, title +
  as-of date baked in. The DOM grid and the canvas renderer share one cell-color/value
  function so the export cannot drift from the display.
- Angled month labels on the bottom axis; right-aligned component labels.

**Grocery basket cards** — new section before Sources ("Grocery basket — BLS average
prices"). `SparklineCard` per item: name + unit, big price, blue sparkline of the full
monthly series, signed YoY chip (red = up, blue = down), as-of month. Homepage features the
faithful six — eggs, milk, ground beef, bread, electricity, utility gas — via a code
constant; the other items stay published-but-unfeatured until the Phase 5 cart.

Both modules end with the standard one-line methodology footnote with as-of dates.

## 5. Routes: supercore, calculator, real-wages

**`/supercore` — "Supercore Services."** Subtitle: services inflation excluding shelter,
goods, food-at-home, energy and vehicles — tracked daily. Three KPI cards: Supercore YoY
today (amber, as-of its own last observation — last value of `gauge_daily.supercore
.yoy_pct`), Headline gauge (blue, `pulse.json`), Spread = supercore − headline (labeled
"sticky-services pressure"; browser subtraction of two published numbers). Hero chart:
daily supercore YoY step line since 2019, amber with light area fill, dashed Fed-2%
reference. Explainer card: which of the 14 components are in the cut + weights
renormalized (consistent with `live_variants` config / `methodology.json`), why the Fed
watches it, links to `/methodology`.

**`/calculator` — "The Since-Date Calculator."** Subtitle: what inflation has done since
any date — computed from the daily gauge, not last quarter's CPI. Inputs: date picker
(min 2018-01-01) + amount ($), hint line ("try: lease signing day, your last raise, your
kid's birthday"). Four KPI cards, client-side arithmetic on `gauge_daily.gauge.index`
(nearest prior date when no exact observation):
- prices since `date` — `index_now / index_then − 1` (red positive / green negative)
- $X then costs now — `X × ratio` (amber)
- $X now buys what this bought — `X ÷ ratio` ("purchasing power remaining")
- annualized rate — `ratio^(365/days) − 1`, day count printed
Chart: gauge index sliced from the chosen date forward (Jan 2018 = 100 labeling kept).
Footer: powered by the daily gauge index; official-CPI calculators answer in whole months,
two months late; methodology links.

**`/real-wages` — "Real Wage Tracker."** Subtitle: wage growth vs the daily inflation
gauge — and a calculator for your own raise. Three KPI cards: Wage growth (Atlanta Fed
median, green, as-of from `real_wages.json`), Inflation right now (gauge, amber,
`pulse.json`), Real wage growth (pipeline-computed, green/red by sign). Raise-calculator
card (green left border): raise % input → two result chips, vs today's prices (gauge) and
vs official CPI (`pulse.official.yoy_pct`), both `(1+raise)/(1+inflation)−1` client-side,
formula printed beneath. Hero chart, three series: Atlanta Fed wage growth (green), Average
Hourly Earnings YoY (purple — standing in for the original's Indeed line), gauge YoY
(amber, area fill; monthly from `compare.json`). Chart subtitle: "when green is above
amber, paychecks are winning." Sources footer names all three series.

## 6. `/my-inflation` — the personal basket reweighter

Title: "My Inflation — the official basket isn't your basket; reweight it to your life."
Five toggle rows (the original's six minus **Your state**, deferred to Phase 4):

| Toggle | Options | Weight effect |
|---|---|---|
| Housing | I rent / Own w/ mortgage / Own, paid off | full shelter weight (0.340) → rent / → owned / owned keeps ×0.35 (taxes, insurance, upkeep) |
| Driving | Don't drive / Average miles / Heavy commuter | fuel ×0, used+new vehicles ×0 / ×1 / fuel ×2.5, used+new vehicles ×1.5 |
| Eating out | Mostly cook / Average / Eat out a lot | food_away ×0.4, food_home ×1.4 / ×1 / food_away ×2, food_home ×0.7 |
| Healthcare use | Light / Average / Heavy | medical ×0.5 / ×1 / ×2 |
| Paying tuition | No / Yes | education_comm ×0.6 / ×2.5 |

Multipliers are client constants pinned here, printed in full in the page's methodology
footer (the original's framing: "simple, transparent, and honest about being an
approximation"); values may be tuned at the page's design review without logic changes.
Defaults: I rent / Average miles / Average / Average / No — a renter persona, matching the
original; defaults are not meant to reproduce the gauge.

**Mechanics** — pure functions in `site/src/lib/reweight.ts`:
1. Scale the 14 published basket weights (`replay.json` `components[].weight`) by the
   selected multipliers; renormalize to 1.0.
2. Personal Laspeyres index over `replay.json` component `index` arrays sampled at
   month-ends: `personal_index_t = Σ wᵢ × component_indexᵢ(t)`.
3. Personal YoY = `personal_index_t / personal_index_{t−12mo} − 1`, monthly; chart starts
   2019-01 (first month with a full base).
This mirrors the engine's own headline construction — index first, then YoY — never an
average of component YoYs. **Invariant (vitest-pinned):** with all multipliers ×1 and no
housing reallocation, the personal series reproduces the published gauge monthly YoY
(`compare.json`) within rounding — using the same month-sampling convention as the compare
writer (read the writer before pinning the fixture).

**Display:** result strip — YOUR INFLATION RATE (big, gold) vs MACROGAUGE (blue) + callout
"your basket is running X.XXpp hotter/cooler than the average consumer's" (red hotter /
green cooler). Dual-line monthly chart, personal (gold) vs gauge (blue, `compare.json`).
"What's driving your number" list: top five components by
`contributionᵢ = renormalized_weightᵢ × latest_yoyᵢ` (component YoY at its **own last
observation** — the like-month rule), rendered "0.59pp · 3% of your basket at 19.8%" with
a colored bar. No share-URL state in 2b (arrives with the Phase 5 cart pattern).

## 7. Components & nav

New shared components, each landing with its first consumer:
- `QuiltHeatmap` — DOM grid + canvas exporter sharing one cell-color/value function.
- `SparklineCard` — grocery cards (and reusable for later card rows).
- `SegmentedControl` — quilt window toggles + all five my-inflation toggle rows.

Calculator/raise inputs are styled native inputs — no component ceremony for two fields.
Nav grows to six flat links: Home · Supercore · My Inflation · Calculator · Real Wages ·
Methodology. Dropdown mega-menus deferred until Phase 3/4 page counts demand them.

Every new surface follows the presentation formula: KPI cards with as-of dates → hero viz →
dense supporting detail → plain-English methodology footnote. Semantic colors hold: blue =
ours, amber = official/cost, red = hot, green = better/cool, purple = alternate series.

## 8. Testing

- **Pipeline (pytest):** hand-computed fixture tests for the grocery series extension and
  the real-wages writer (AHE YoY hand-computed; WGT pass-through); fixtures for the new
  FRED/AP series wired into `test_run_daily`'s `fake_get`; contract test updated 13 → 14
  published files; schemas validated. No network in tests, ever.
- **Site unit (vitest, new):** pure functions in `lib/` — since-date math, raise math,
  reweighter (scale/renormalize/index/YoY + the ×1-multipliers gauge-reproduction
  invariant) — against hand-computed fixtures. `npm test` joins the CI site job.
- **Playwright smoke (new, design spec §9):** build the static export, serve it, visit all
  six pages (home, methodology + 4 new routes), assert key elements render and zero console
  errors. Chromium only. Joins the CI site job.
- **Ripple updates:** CLAUDE.md "13 published files" → 14 (+ commands for vitest /
  Playwright); `methodology.json` picks up the new registry series automatically
  (generated).

## 9. Exit criteria

1. Six surfaces live in production; every displayed number traces to a published JSON
   (spot-check reconciliation: supercore KPI vs `gauge_daily`, quilt headline rows vs
   `compare`, grocery cards vs `grocery_basket`, wage KPIs vs `real_wages`).
2. `pytest`, `npm run build`, vitest, and Playwright smoke all green in CI.
3. Quilt PNG export produces a shareable 1920×1080 image matching the on-screen grid.
4. One unattended daily run after merge publishes `real_wages.json` + extended
   `grocery_basket.json` cleanly (registry/writer additions survive the bot loop).
5. As-of dates and methodology footnotes present on every new surface.

## 10. Resolve in the plan (not blocking this spec)

1. **FRED series IDs** for the Atlanta Fed Wage Growth Tracker and AHE (access spike,
   2a-style). Fallback if WGT is not on FRED: ship AHE-only and adjust the chart note —
   do not add a new connector for one line in 2b.
2. **Exact BLS AP codes** for electricity $/kWh and utility gas $/therm (access spike).
3. **Quilt FULL-history layout** — 103 month columns: horizontal scroll container vs
   column thinning; decide against the rendered result.
4. **Page-data weight** — quilt_all + replay are imported at build time into the homepage
   bundle; if export size or hydration cost is noticeable, switch the quilt files to
   runtime `fetch()` from `/data/` (same origin, same artifacts). Measure, then decide.
5. **Playwright/vitest wiring details** — versions, static-serve mechanism in CI, config.
6. **Reweighter multiplier fine-tuning** at the my-inflation task's review (values pinned
   in §6 are the defaults to beat).

## 11. Risks

- **WGT availability on FRED** — mitigated by the AHE-only fallback (plan item #1).
- **Canvas export drift vs on-screen quilt** — one shared cell-color/value function;
  export verified in review against the DOM grid (exit criterion 3).
- **Client math errors** (reweighter/calculator) — vitest hand-computed fixtures + the
  gauge-reproduction invariant; formulas printed on-page per the credibility layer.
- **First new published file since the loop went unattended** — exit criterion 4 makes the
  first post-merge bot run an explicit gate; failure isolation already guarantees a broken
  writer can't take down `sources_status`/`qa`.
- **Homepage bundle growth** — plan item #4 (measure, fetch() fallback ready).
