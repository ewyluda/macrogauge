# Missing measures, visuals and capabilities — batched implementation plan

Date: 2026-09-03. Baseline: `main` @ `b5e3fa5` (878 pytest / 166 vitest / 63 e2e / 30 routes /
36 published artifacts / 693 registry series across 30 sources).

Scope: product gaps found by a full read of `site/src`, `site/public/data/*.json`,
`config/series.json` and the publish layer. Engineering debt is **not** here — it stays in
`todo.md` and `docs/plans/2026-09-01-codebase-review.md`. The Project Controls register
(`docs/plans/2026-07-24-project-controls-gaps.md`) is referenced, not duplicated.

Two audiences, scored separately throughout: **G** = general inflation readers (My Inflation,
grocery, calculator, real wages), **PC** = hyperscaler Project Controls (DC pages).

## Findings this plan is built on

Verified 2026-09-03 by grep of every artifact key path against `site/src`:

| Class | What | Evidence |
|---|---|---|
| Collected, never published | Treasury curve `DGS1MO…DGS30` (8 tenors), `BAMLH0A0HYM2`, `DTWEXBGS`, `GDPNOW`, `WALCL`, `WTREGEN`, `RRPONTSYD`, `EXHOSLUSM495S`, `USSTHPI`, `RIFLPBCIANM60NM` | no publisher references them; only `matrix.py` touches the breakevens |
| Collected, never published | all 12 `or_*` OpenRouter token prices, `vast_h200/b200/a100_sxm/rtx4090`, all 5 `usda_*_w`, `steo_elec_ind_us`, `steo_power_pj` | `commodities.py` hardcodes only `vast_h100_sxm` |
| Published, never rendered | `gauge_daily.variants.pce`, `compare.pce_yoy_pct`, `compare.supercore_yoy_pct`, `compare.validation.{pce,supercore}`, `gaptable.variants.{gauge,tracker,supercore,pce}` | only `gauge/col/tracker/supercore` read; `/gap` ignores `variants` |
| Published, never rendered | `replay.components[].bls_index` (14×3166 floats), `dc_grades.anchors[].realized.*` (288 rows), `dc_grades.leadlag.mappings[].profile`, `backtest.rows[].{cutoff,naive_mom_pct}`, `labor.claims.continued`, `heatcheck.groups.*.active_weight`, `heatcheck/stress indicators[].direction`, `outlook.parameters.*`, `capacity.timeline`, `dc_markets.markets[].mw_{disclosed,planned,secured}`, `sources_status.sources[].fetched` | typed in `lib/types.ts` or local types, no JSX reads them |
| Measure absent | 3m/6m annualized rates; contribution-to-YoY over time; breadth/diffusion; day-over-day change; revisions (first print vs latest) | grep: zero hits for "annualized" outside the two calculators, zero for "diffusion"/"breadth"; `pulse.json` carries no prior-day value |
| Visual absent | stacked contribution bars; nowcast uncertainty band; release-date markers; expected-vs-realized scatter | contributions are table columns only; `OutlookChart.tsx` DOES draw the outlook band — the nowcast hero does not |
| Capability absent | CSV/JSON download, URL state, copy-link, citation string, OpenGraph image, sitemap/robots, RSS, print CSS, glossary, per-component pages, point-in-time page, light mode | zero `useSearchParams`/`history.replaceState`; `layout.tsx` metadata is title+description only |

Not gaps (checked): `quilt_months_48/all` are fetched at runtime by `QuiltHeatmap.tsx:88`;
`ensemble.weights` and `benchmarks.cleveland` render generically on the homepage.

## Invariants every batch respects

- The site computes nothing the pipeline could publish **except** pure re-expressions of
  published arrays (annualizing, contribution arithmetic, breadth counts). Anything that needs the
  store goes through a writer + `schemas/*.schema.json` + an isolated `_..._phase` in
  `pipeline/run_daily.py` + a `*_ok` QA check + `tests/test_run_daily.py` fake coverage.
- New artifacts are validated inline as they land; `jsonschema.ValidationError` fails the run.
- Connectors stay untouched unless a batch says otherwise; nothing here adds a scrape.
- `output: "export"` stays. No server routes: RSS/sitemap are build-time static files.
- Every new page: `<title>` metadata, `lib/nav.ts` entry, e2e route in `site/e2e/smoke.spec.ts`
  (zero console errors), vitest for any new `lib/*.ts` math.
- Receipts culture: every new number carries `as_of`, and every model-ish visual carries the
  existing disclaimer pattern from `/outlook`.

## Batch map

| Batch | Theme | Audience | Pipeline touch | Est. effort | Depends on |
|---|---|---|---|---|---|
| **1** | Share & export foundation | G+PC | none | 2–3 days | — |
| **2** | Render what is already published | G+PC | none | 2–3 days | 1 (download button) |
| **3** | Momentum, contribution, breadth | G | none | 3–4 days | 1 (URL state) |
| **4** | Pipeline unlocks: rates, compute, food, housing, what-changed | G+PC | 5 writers | 5–7 days | 1 |
| **5** | Receipts: components, revisions, point-in-time, nowcast band | G+PC | 2 writers | 5–7 days | 1, 4e |
| **6** | Project Controls last mile (P7, P6, scatter) | PC | none | 4–5 days | 1, 2c |
| **7** | Hygiene: glossary, empty states, light mode, a11y | G+PC | none | 2 days | opportunistic |

Ship order: 1 → 2 → 3 → 4 → 5 → 6. Batch 7 items ride along with whichever batch touches the
file. Each batch is one branch + one PR; none should exceed ~25 files changed.

---

## Batch 1 — Share & export foundation (site-only)

**Status: SHIPPED 2026-09-03 on `feat/batch1-share-export`.** Delivered as specified with three
deviations: (1) `GradesClient` has no client state, so nothing to wire; (2) `/dc-scoreboard`
exports the 288 grading anchors (the Batch 2c scatter's input) rather than a bare citation;
(3) the RSS item body is the headline set for now — Batch 4e replaces it with the diff.
Gates: vitest 166 → 197, e2e 63 → 72, build 38 routes incl. `feed.xml`, `sitemap.xml`,
`robots.txt`, `opengraph-image`.

**Why first:** every later batch adds a chart or a table that should be downloadable and
linkable, and PC's P5 says export *is* the use case. Build the primitives once.

### 1a. `DownloadData` component
- `site/src/components/DownloadData.tsx`: props `{ rows: Record<string, unknown>[], filename,
  citation }`. Renders two small buttons: **CSV** (client-side serialize, `Blob` + object URL) and
  **JSON** (direct `<a href="/data/<file>.json" download>` to the published artifact).
- `site/src/lib/csv.ts` + `csv.test.ts`: header row from union of keys, RFC-4180 quoting,
  `null` → empty, numbers untouched, dates ISO.
- Mount on: hero chart (gauge_daily variants), `/gap`, `/grocery`, `/commodities`, `/metros`,
  `/states`, `/datacenter` component table, `/escalation` bridge table, `/markets`, `/longlead`,
  `/releases`, `/scoreboard` tables, `/matrix`.
- Also add a **"Data" footer row** in `SiteFooter.tsx` linking every `public/data/*.json` with
  one-line descriptions (an open-data page in miniature; the full page is 5f).

### 1b. URL state hook
- `site/src/lib/urlState.ts` + test: `useUrlState<T>(key, default, codec)` reading
  `window.location.search` on mount (client component, `useEffect`, no `useSearchParams` to stay
  export-safe) and writing via `history.replaceState`. Codecs: string, int, float, enum, month.
- Wire into: quilt window/mode chips, treemap month scrubber, `CalculatorClient` (date, amount),
  `DcEscalationClient` (base month, base cost, delivery month, basis), `GradesClient`
  (basis/horizon), `MyInflationClient` (segments + state), `CapacityClient` (tab/cohort/sort/q),
  `RaiseCalculator` (raise %), `/datacenter` LEVEL|YOY toggle.
- **`CopyLink` button** (`components/CopyLink.tsx`, `navigator.clipboard`, "Copied" state 1.5s)
  next to every wired control group.

### 1c. Citation string
- `site/src/lib/citation.ts` + test: `cite({ series, asOf, rebase, value })` →
  `MacroGauge <series>, <as_of>, 2018-01=100, <value> — https://…/<route>?<state>`.
- Rendered as a small `<code>` block with a copy button under the hero KPI, `/datacenter` KPIs,
  `/escalation` result, `/dc-scoreboard`. Feeds the `DownloadData.citation` prop (first CSV line as
  a `#` comment).

### 1d. Discoverability
- `site/src/app/opengraph-image.tsx` (Next static OG, 1200×630): brand, headline gauge YoY vs
  official, DC Build YoY, `published_at`. Reads `pulse.json` + `datacenter.json` at build. Also
  `twitter-image` alias. Verify with `npm run build` output in `out/`.
- `site/src/app/sitemap.ts` from `NAV` (single source of truth), `site/src/app/robots.ts`.
- `site/src/app/feed.xml/route.ts` with `export const dynamic = "force-static"`: one item per
  publish (`pulse.published_at`), body = headline numbers + top movers. Static export emits
  `out/feed.xml`. Link `<link rel="alternate" type="application/rss+xml">` in `layout.tsx`.
- `@media print` block in `globals.css`: hide nav/footer/controls, white background, charts keep
  their canvas (ECharts renders fine), page-break before `<section>`.

### Tests / acceptance
- vitest: `csv`, `urlState` codecs, `citation`.
- e2e: `/escalation?base=2024-01&cost=1000000&delivery=2027-06&basis=long_run` renders those
  values; CSV button produces a download event; `feed.xml`, `sitemap.xml`, `robots.txt` exist in
  `out/` after build (assert in `site/e2e/build-artifacts.spec.ts` or a vitest reading `out/`).
- OG image opens without console error.

---

## Batch 2 — Render what is already published (site-only)

**Status: SHIPPED 2026-09-03 on `feat/batch2-render-published`.** Not quite site-only: 2a needed
two additive, nullable pipeline fields (`compare.official_pce_yoy_pct`, `official.headline.pce`)
so `/pce` can chart and quote what it is graded on; both stay optional in their schemas until the
next publish regenerates the artifacts. Deviations: `gaptable.rows` exist only for the main gauge,
so 2e is a five-variant summary strip, not a row-level selector; `labor.history.weekly` carries no
continued-claims tail, so it is a KPI figure only; `capacity.timeline` is now RENDERED (published
curve for unfiltered cohorts, client rebuild only under a text search) with a vitest pinning the
two equal. `lib/dcAnchors.ts` reproduces every published `legs.*.grades` cell from the anchor rows
(pinned by test), so the scatter caption and the table cannot disagree. Gates: pytest 881,
vitest 204, e2e 81, 39 routes.

### 2a. `/pce` page (Inflation → The gauge)
- Data: `gauge_daily.variants.pce`, `compare.pce_yoy_pct`, `compare.validation.pce`, `gaptable.variants.pce`,
  `accountability_pce`. Official PCEPI is in the store as `PCEPI` but `official.json` carries only `headline.cpi`
  and `headline.core` (verified 2026-09-03) — add `headline.pce` in `pipeline/publish/official.py`
  via the same `yoy_pct` helper (schema additive, one test).
- Visuals: KPI row (PCE-weighted gauge YoY, official PCEPI YoY, gap), `HeroChart` variant with
  PCE weights vs PCEPI, `GapDecomposition` with the pce variant's rows, the PCE receipts table
  currently only on `/scoreboard`.
- Copy: explain hand-seeded BEA shares (`pce_weight` in `config/basket.json`) and that this is
  graded vs PCEPI, not PCE core.

### 2b. Supercore history
- `/supercore` gains the 102-month `compare.supercore_yoy_pct` series and `validation.supercore`
  (lead-lag/corr) in the same layout `/vs-bls` uses. Today it only plots `gauge_daily.supercore`.

### 2c. DC grading depth (feeds Batch 6)
- `/dc-scoreboard`: **expected-vs-realized scatter** from `dc_grades.anchors[].realized.h{12,24,36,48}`
  against each basis's carry at that anchor — one point per anchor, 45° line, colour = basis,
  horizon toggle (URL state). This is the single strongest defensibility visual available and
  the data is already there. New `lib/dcAnchors.ts` + test.
- Lead-lag **correlation profile** line (lag on x, corr on y, gate threshold as `markLine`) per
  mapping from `leadlag.mappings[].profile[]`, under the existing verdict text.
- Show `legs.*.contains_downturn` as a badge on each leg.

### 2d. Small dead fields, one PR section
- `/labor`: continued claims line on `LaborClaimsChart`.
- `/heatcheck`, `/stress`: `direction` arrow per indicator; `active_weight` in group tiles.
- `/scoreboard`: per-row naive MoM column + `cutoff` (vintage date) column in the backtest table;
  makes "beats naive" auditable row by row.
- `/markets`: `mw_planned` / `mw_secured` as muted secondary columns, labelled with the same
  "denominated, not curated" caveat `lib/dcMarkets.ts` already carries.
- `/longlead`: `listed` (exchange-listed) badge.
- `/status`: `fetched` count beside `new_rows`.
- `/outlook`: collapsible "Model parameters" panel listing `parameters.*` verbatim (provenance
  was published for exactly this).
- `capacity.timeline`: **decision** — either render it and delete `lib/capacityTimeline.ts`, or
  drop the field (todo #5/#21 contract pass). Recommendation: render the published one, keep the
  client builder only for cohort filtering, and pin equality in a test so they cannot drift.

### 2e. Gap page variants
- `/gap`: variant selector (gauge | col | tracker | supercore | pce) over `gaptable.variants`;
  URL state. Today the page shows one variant and ignores the rest.

### Tests / acceptance
- vitest: `dcAnchors`; e2e: `/pce` route + scatter canvas paint (reuse the supercore canvas-paint
  pattern); `test_published_data.py` gains `official.json` PCEPI field if 2a touches it.

---

## Batch 3 — Momentum, contribution, breadth (site-only math)

**Status: SHIPPED 2026-09-03 on `feat/batch3-momentum-breadth`.** One correction to the plan's
3b formula: the engine's headline YoY is NOT an index ratio — it is `Σ wᵢ·yoyᵢ` over each
component's own like-month YoY (`aggregate.weighted_yoy`), so the exact contribution is simply
`wᵢ · yoyᵢ` off `replay.json`'s published per-component series (the index-ratio formula
disagreed with the published headline by up to 0.78pp). Parity is pinned by test against both
`gauge_daily` (every month end) and `gaptable.rows[].contribution_pp`. Momentum uses position
offsets (91/182 grid days) because the published grid is contiguous and forward-filled, unlike the
weekday-only raw series `pct_change_daily` bridges. One `?rate=` key drives the hero, `/vs-bls`,
`/cost-of-living` and `/supercore`; official prints stay YoY-only in momentum modes (no official
index level is published). Breadth is computed at build time from `quilt_months_all` and also
feeds two rows into `/matrix` OURS. Gates: vitest 219, e2e 86, build 39 routes.

All three are pure re-expressions of arrays already published daily. Put the math in
`site/src/lib/momentum.ts`, `contribution.ts`, `breadth.ts`, each with vitest against a hand-computed
fixture, and reuse across pages.

### 3a. Annualized momentum
- From `gauge_daily.variants.*.index` (daily, forward-filled): `ann(k) = ((I_t / I_{t−k·~30d})^(12/k) − 1)·100`
  using the nearest-obs-within-±3d convention `publish/util.pct_change_daily` uses, so site and
  pipeline agree. k ∈ {1, 3, 6}; YoY stays the published `yoy_pct`.
- Hero chart and `/vs-bls`, `/cost-of-living`, `/supercore`, `/pce`: a **YoY | 3m ann. | 6m ann.**
  segmented control (URL state). Official series get the same treatment from `replay.bls_index`
  (that is what that dead field is for).
- Homepage component table and `/outlook` component table: add 3m-ann column beside YoY.
- Copy: one line under the control — "annualized rates amplify noise; ±3d daily convention".

### 3b. Contribution-to-YoY stacked bars
- Exact Laspeyres contribution from `replay.json`: per component `c_i(t) = w_i · I_i(t−365) / H(t−365) · yoy_i(t)`
  where `H` is the headline index (`gauge_daily.variants.gauge.index`), so Σ c_i = headline YoY to
  rounding. Test asserts the sum matches `yoy_pct` within 0.02pp on a fixture.
- New `components/ContributionChart.tsx` (ECharts stacked bar, monthly sampling = last obs of
  month, 24/48/all window via existing `chartWindow.ts`, ours | BLS mode via `bls_index/bls_yoy`).
  Register `BarChart` in the ECharts registry (the registry audit test will fail otherwise — that
  is the point of it).
- Mount on homepage below the hero chart and on `/gap` (contribution to the *gap* is already a
  table there; the bar makes it visual).

### 3c. Breadth & diffusion
- From `quilt_months_all.components[].ours_yoy_pct` (14 × 105 months): share of components
  YoY > 2%, share accelerating vs 3 months earlier, weighted share > 2%. Also from the daily
  replay for a live reading.
- **Own trimmed-mean and median** of the 14 component YoYs (weight-trimmed, 16%/16% like
  Cleveland's) — then `/matrix` UNDERLYING group can show "Cleveland median 3.11 / MacroGauge
  median x.xx" side by side. Note the 14-component coarse basket in the copy: it is a breadth
  read, not a substitute for Cleveland's 45-item trim.
- New `components/BreadthPanel.tsx`: diffusion line (0–100%) + two KPI tiles; mount on homepage
  and `/supercore`.

### Tests / acceptance
- vitest fixtures for all three libs; e2e: segmented control changes the y-axis label; stacked
  bar canvas paints. ECharts registry test green.

---

## Batch 4 — Pipeline unlocks (five writers, five isolated phases)

**Status: SHIPPED 2026-09-03 on `feat/batch4-pipeline-unlocks`.** Four new artifacts (`rates`,
`compute`, `housing`, `changes`) + the grocery `wholesale[]` block + pulse `prev_*` fields, four
isolated phases (`changes` runs LAST), qa 27 → 31 checks. The four artifacts were generated locally
from the committed store (pure store→JSON, no network — the 2026-07-17 snapshot precedent) so the
site builds before the next daily run; that run regenerates them with a single stamp. Decisions
taken: OpenRouter roster = the registry, renormalized over live members (a stale model leaves the
mean, never freezes a dead price); the compute history is ~2.5 months and the page says so; the
affordability income proxy is one average private earner (AHE×2080/12), deliberately harsher than
household income and labelled as such; `changes` reads the previous publish from the checkout, no
store change. Gates: pytest 902, vitest 219, e2e 96 (35 routes), build 43 routes.

Each writer follows the `commodities.py` contract: pure store→dict, null rows on missing series,
schema in `schemas/`, isolated `_xxx_phase` in `run_daily.py`, `xxx_ok` in `qa.py`,
`test_run_daily.py` fake extended, `test_published_data.py` pair added (do this while todo #27 is
open so the new files land in the contract list from day one).

### 4a. `rates.json` → `/rates` (Economy)
- Series (all already collected daily): `DGS1MO DGS3MO DGS6MO DGS1 DGS2 DGS5 DGS10 DGS30`,
  `T5YIE T10YIE`, `BAMLH0A0HYM2`, `DTWEXBGS`, `WALCL WTREGEN RRPONTSYD`, `pmms_30yr`,
  `mnd_30y_d`, `DRSFRMACBS`.
- Payload: `curve.latest[]` (tenor, yield, 1d/30d/1y change), `curve.tails{}` (60 obs), derived
  `spreads` (2s10s, 3m10s, 10y real = DGS10 − T10YIE), `liquidity` (WALCL, TGA, RRP levels +
  net liquidity = WALCL − TGA − RRP), `credit` (HY OAS), `dollar`, `mortgage` (30y, spread to 10y).
- Page: curve chart (tenor on x, today vs 1m ago vs 1y ago), 2s10s history with inversion
  shading, net-liquidity area chart, mortgage-spread line, KPI row. Every derived series here is
  arithmetic on published levels — say so in the page copy.

### 4b. `compute.json` → `/compute` (AI Infra) — the "cost of a token" index
- Series: 12 `or_*` (6 models × in/out $/Mtok), `vast_h100_sxm h200 b200 a100_sxm rtx4090`,
  `sfc_h100`, `dramex_*` (already in commodities).
- Payload: per-series latest + 30d/1y change + 90-obs tail; a **blended token price index**
  (equal-weight geometric mean of the 6 models' blended 3:1 in:out price, rebased to its first
  full month = 100) and a **GPU-hour index** (equal-weight over the 5 vast SKUs). Both rebased with
  `engine/rebase.py`. Publish the composition (weights, first month) in the payload like
  `datacenter.json` does.
- Page: two index lines + per-model table + GPU table. Cross-link from `/datacenter` hardware
  panel ("input costs up X%, output price of a token down Y%").
- **Decision for Eric:** the OpenRouter model set is hand-curated (`config/series.json`); a
  deprecated model id will go stale (7d) and drop out of the mean. Document renormalization over
  live members (same rule `blend.py` already uses).

### 4c. USDA staples into `grocery_basket.json`
- `usda_{eggs,milk,beef,pork,broiler}_w` as a `wholesale[]` block: weekly wholesale price, YoY,
  tail; and a **farm-to-shelf** pairing where a BLS AP item exists (eggs ↔ `APU0000708111`, milk,
  ground beef, pork chops, chicken). Schema additive.
- `/grocery`: wholesale sparkline beside the retail sparkline for the five paired items, spread
  KPI (retail YoY − wholesale YoY). This is the phase-5 "farm-to-shelf" page from the design doc,
  delivered as a section rather than a route.

### 4d. `housing.json` → `/housing` (Economy)
- Series: `CSUSHPINSA`, `USSTHPI`, `EXHOSLUSM495S`, `zhvi_us`, `zori_us`, `aptlist_us`,
  `pmms_30yr`, `mnd_30y_d`, AHE from `labor`.
- Payload: prices (3 HPIs YoY), rents (2 sources YoY), sales, **affordability**: monthly payment on
  0.80×ZHVI at the 30y rate (exactly the `col` variant's marginal-buyer construction, reused —
  cite `variants.py`) as a share of median weekly earnings ×52/12; history 2018→. Publish the
  formula constants in the payload.
- Page: price-vs-rent chart, payment-to-income line with 2018 baseline, sales bars, KPI row. Link
  from `/cost-of-living` ("why COL diverges from CPI: this").

### 4e. What changed since yesterday → `pulse.json` + `changes.json`
- Mechanism (no store change): `run_daily.py` reads the **existing** `out/pulse.json` and
  `out/replay.json` (the previous publish is in the checkout) before overwriting, and the writer
  emits `changes.json`: headline delta (pp) per variant, per-component YoY delta, which sources
  landed new rows today (`sources_status.new_rows > 0`), gate holds fired, and `prev_published_at`.
  Also add `prev_yoy_pct` + `prev_as_of` to each `pulse` variant (additive schema).
- First run after deploy has no prior file → publish `changes` with `prev: null` and the site shows
  "first reading". Test both branches.
- Site: **"Since yesterday"** strip on the homepage under the KPI row (gauge +0.05pp · gasoline
  +0.9% · Manheim print landed · 1 gate hold), and a `/changes` route with the last publish's full
  diff table. RSS (1d) item body switches to this text. This is the reason to open the site daily.

### Tests / acceptance
- pytest: writer unit tests on synthetic store rows (null-row path, renormalization for 4b,
  affordability arithmetic for 4d, prior-file-missing path for 4e); `test_run_daily.py` covers all
  five phases with the fake and asserts each `*_ok`; schema-violation-fails-run test per phase
  (todo #2's pattern). `qa` check count 27 → 32 (`qa.json` has 27 checks today).
- Site: 4 new routes in nav + e2e; `test_published_data.py` pairs.

---

## Batch 5 — Receipts surfaces

**Status: SHIPPED 2026-09-03 on `feat/batch5-receipts`.** 5a: 14 static `/components/[code]` pages
(splice point DERIVED as the first grid day ours departs from the official index — no engine
change; `replay` gained additive `last_obs` + `gate_flags`); component names link from `/gap`,
`/outlook`, `/cpi-preview`, the homepage official table and the contribution table. 5b:
`revisions.json` off `first_releases` vs `latest` — CPI's level revisions are 0.000 (the receipt
that CPI-U NSA is not revised), PCE and payrolls carry real ones. 5c: `store/ledger/pulse.jsonl`
append-only, dedup by published_at, BACKFILLED from 74 git commits of pulse.json (decision 4
resolved: backfill); `/as-of` with `?date=` URL state and a live citation. 5d: ForecastHero
realized-error band (±backtest MAE, labelled "not a calibrated interval"), CPI release-day rules
on the hero chart. 5e: `/data` with sizes, stamps and schema links (`prebuild` copies `schemas/`
into `public/schemas`, gitignored). Gates: pytest 909, vitest 222, e2e 106, 60 pages.

### 5a. Per-component pages `/components/[code]` (14 static routes)
- `generateStaticParams` over `config/basket.json` codes (import the JSON at build; it is already
  in the repo). Content per component: weight, official series id, `live_blend` sources and
  weights, `live_variants`, `lead_days`; chart of ours vs BLS (from `replay` index + YoY) with the
  **splice point** marked (`markLine` at the first live obs — publish `splice_date` per component
  in `replay.json`, additive); source freshness rows filtered from `sources_status`; gate holds
  (needs `gate_holds[]` per component in `replay.json`, additive, from the engine's gate output);
  the component's 3m-ann/YoY/contribution (Batch 3 libs); outlook path (`outlook.component_paths`);
  download + citation (Batch 1).
- Every component name in every table (`/`, `/gap`, `/outlook`, `/cpi-preview`, quilt rows)
  becomes a link. This is the receipts view the tagline promises.

### 5b. Revisions view → `revisions.json` + `/revisions` (Forecasts)
- Pipeline: `releases.json` already has first prints for CPI/PCE/NFP. Add a `revisions` writer
  that pairs each first print with the **latest** value for that reference month (CPI: store
  latest-vintage row; PCE and NFP: `fred.fetch_vintages` already exists — extend collection of
  `PCEPI`/`PAYEMS` vintages if the store lacks them; check first). Payload: per target, per
  reference month: first, latest, revision (level and YoY pp), first_release_date, n_vintages.
- Page: revision bars per target (first→latest YoY pp), cumulative NFP revision line, table.
  Ties to the scoreboard: grades are against **first** prints — say so and link.

### 5c. Point-in-time ledger → `ledger.json` + `/as-of` (About)
- The vintage store proves what inputs we had; what a claims reader needs is **what the site said
  on a given day, never restated**. Cheapest honest form: an append-only `store/ledger/pulse.jsonl`
  (one row per publish: `published_at`, gauge/col/tracker/supercore/pce YoY, DC Build/Ops/Hardware
  YoY, official month + YoY, coverage). `run_daily.py` appends after a successful engine phase;
  `ledger.json` publishes the full ledger (a few KB/year). Backfill from git history once
  (`git log -p -- site/public/data/pulse.json` + `datacenter.json`) via a one-shot script with the
  same per-row coverage guard the DC backfill needed.
- Page: date picker (URL state) → the readings as published that day + citation string for that
  date; a "readings timeline" chart of the headline as-published vs today's history (the two can
  differ — that difference is the honest revision footprint of a live-data gauge).
- Store partition rule: `store/ledger/` is a new directory; row-evolution policy from README
  applies (fields add-only).

### 5d. Nowcast uncertainty band
- `/cpi-preview` and `/next-print` `ForecastHero`: draw ±1·MAE (from `backtest.summary`,
  horizon-matched to days-to-release if `backtest.rows[].cutoff` supports it, else the overall MAE)
  around the ensemble MoM, and the implied YoY range. Add release-date `markLine`s
  (`releases[].first_release_date` + `pulse.next_print.date`) to the hero chart and `/vs-bls`.
  Label: "realized error band, not a calibrated interval" (same wording as `/outlook`).

### 5e. Open-data page `/data` (About)
- Every artifact: name, one-line description, schema link (copy `schemas/` into `public/` at
  build via a `prebuild` npm script), size, `published_at`, fields consumed by which pages
  (hand-maintained list, checked by a vitest that every `public/data/*.json` appears). Citation
  and licence text. Replaces the Batch 1 footer row with a proper page; keep the footer link.

### Tests / acceptance
- pytest: revisions pairing, ledger append (idempotent per `published_at`), backfill guard.
- Site: 14 component routes + `/revisions` + `/as-of` + `/data` in e2e; `generateStaticParams`
  output count pinned = basket length.

---

## Batch 6 — Project Controls last mile (site-only; register P7 → P6)

Read `docs/plans/2026-07-24-project-controls-gaps.md` §P6/§P7 and the corrections in memory
before starting; the register's premises have been refuted four times by recon.

### 6a. P7 landing page `/project-controls`
- Vocabulary-first: escalation, basis of estimate, contingency, long-lead, $/MW, energization.
  Lead: "no official DC PPI exists, so we built one." Tiles into `/datacenter`, `/escalation`,
  `/markets`, `/longlead`, `/capacity`, `/dc-scoreboard`, `/compute` (4b), plus the citation
  string (1c), the anchor scatter (2c) and the ledger (5c) as the three "defensibility" proofs.
  Nav: AI Infra group gets a titled section "For Project Controls" at the top.

### 6b. P6 portfolio view `/portfolio`
- Projects in `localStorage` + URL-encoded state (1b codec for an array): name, market
  (`dc_markets` key), MW, base estimate, base month, delivery month, basis. Aggregates: capital at
  risk, weighted escalation to date (P1 math in `lib/dcEscalation.ts`), carry to completion by the
  **reader-selected** realized basis (P3a math in `lib/dcContingency.ts`) with the horizon-matched
  band, and component drivers. Export CSV (1a). No forecast language anywhere — the
  contingency-table disclaimer is reused verbatim.
- Import/export of the project list as JSON so it can move between machines.

### 6c. `/escalation` polish already on todo
- #19 currency formatting, #20 month-input validation, #37 extraction — do them here since the
  file is open.

---

## Batch 7 — Hygiene (ride-along)

- **Glossary**: `site/src/lib/glossary.ts` (term → 1–2 sentences) + `<Term>` component rendering
  `<abbr title>` with a dotted underline; terms: Laspeyres, splice, vintage, gate hold,
  carry-forward, rebase, supercore, lead-lag, contingency basis, anchor, first print. Mount in
  `/methodology` as a list and inline wherever the term first appears on a page.
- **Empty/degraded states** (todo #7) on `/scoreboard`, `/labor` grades, `/dc-scoreboard`.
- **Light mode**: the design is dark-first by intent; if added, follow the artifact theme
  pattern (tokens on `:root`, `prefers-color-scheme`, `data-theme` override) and re-shoot the
  ECharts theme in `chartTheme.ts`. **Decision for Eric** — recommendation: defer; print CSS (1d)
  covers the "I need it on paper" case.
- a11y items #28–#30 as their files are touched; `focus-visible` ring in `globals.css`.

---

## Decisions needed before Batch 4

1. **OpenRouter model roster** for the token index (4b): keep the current 6, or pin a "frontier
   basket" with an explicit replacement policy?
2. **`capacity.timeline`** (2d): render or delete.
3. **Light mode** (7): defer or build.
4. **Ledger backfill** (5c): backfill from git history (one-shot script, ~50 publishes) or start
   the ledger from the merge date and let it grow.

## Sequencing notes

- Batch 1 and 2 can be one PR each and merged within a week; nothing in them changes a number.
- Batch 3 changes no published number either, but adds visuals that will get shared — do 1d (OG
  image) before 3 so shared charts carry a preview card.
- Batch 4 writers are independent of each other; if time is short ship 4e (what changed) and 4a
  (rates) first — 4e is the daily-return hook, 4a is the largest zero-cost unlock.
- Batch 5a depends on 3 (momentum/contribution libs) and on two additive `replay.json` fields;
  publish those fields in Batch 4's PR so the schema change lands with pipeline tests.
- Always rebase over the morning `data: daily publish` commit; store conflicts resolve by union.
