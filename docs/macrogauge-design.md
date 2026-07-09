# macrogauge — Design Spec

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plans (one per phase)
**Reference:** dashboards/nowflation-site-teardown.md (in the notebook repo)
(full teardown of nowflation.com, studied 2026-07-06) + full-page screenshots in
`dashboards/nowflation-screenshots/` (in the notebook repo).

## 1. Goal

Build our own faithful version of nowflation.com: a daily-updated US inflation/macro analytics
site centered on an independent gauge that re-prices the CPI basket from live market data, with
nowcasts graded in public and a full macro/markets cockpit around it.

**Personal tool first, public-ready always.** v1 optimizes for the owner's daily macro read; every
architectural choice (static site, open JSON contract, receipts layer) is made so flipping to
public later is a DNS change, not a rebuild.

### Decisions locked during brainstorming (2026-07-07)

| Question | Decision |
|---|---|
| Domain | Faithful macro/inflation rebuild (same subject matter, our own build) |
| Audience | Personal tool first; public-ready architecture |
| Scope | Everything — gauge + nowcasts + economy + markets + long tail, one master spec, phased |
| Infra | New standalone repo; GitHub Actions daily pipeline; static deploy (Vercel) |
| Front end | Next.js App Router, `output: 'export'`, TypeScript, ECharts |
| Gauge sources | Full faithful blend including scrapes (AAA, MND, Manheim, Cleveland Fed) |
| Build strategy | Vertical slice first (walking skeleton end-to-end, then widen) |

### Non-goals

- No monetization (no ads), no SEO campaign, no branding work in v1 — `macrogauge` is a working
  name only.
- No live API / server runtime — the site is static files, full stop (same as the original).
- No original methodology research: we implement the teardown's documented methods (Laspeyres
  aggregate, published blends, transparent composites). Improvements are post-v1.
- Not built inside the notebook repo — this is a product build in its own repo.

## 2. Architecture

Static site over pre-baked JSON, produced by a scheduled pipeline. Three parts, one repo:

```
macrogauge/
├── pipeline/                  # Python 3.12
│   ├── connectors/            # one module per source: fred.py, bls.py, eia.py, zillow.py,
│   │                          #   fmp.py, treasury.py, pmms.py, aptlist.py, redfin.py,
│   │                          #   aaa.py, mnd.py, manheim.py, usda.py, cleveland.py,
│   │                          #   kalshi.py, polymarket.py, worldbank.py, …
│   ├── engine/                # rebase.py, blend.py, aggregate.py, variants.py,
│   │                          #   nowcast/, composites/, backtest.py
│   ├── publish/               # one writer per contract JSON + qa.py self-test
│   ├── store/                 # vintage observation log (see §3)
│   └── config/                # basket weights, blend specs, series registry (YAML)
├── site/                      # Next.js static export + TypeScript + ECharts
│   ├── public/data/           # published JSONs — the ONLY pipeline→site interface
│   └── src/
│       ├── components/        # the ~12-component shared library (§6)
│       ├── app/               # routes; series/[code] via generateStaticParams
│       └── lib/               # formatting, tokens, chart theme
├── schemas/                   # JSON Schema per contract file, validated in CI
└── .github/workflows/         # daily.yml, ci.yml
```

**Hard rule — the contract is the interface.** All analytics are computed in the pipeline; the
site only formats. Any number derived in the browser (calculators, my-inflation reweighter) uses
the same published component data, never re-fetches sources. (This is the notebook
dashboard-scaffold pattern, scaled up.)

### Daily run (GitHub Actions)

- **Schedule:** 8:40 AM ET weekdays; extra 9:45 AM ET run on CPI and jobs-report days (release
  calendar checked in-job). Cron is UTC — schedule both DST offsets and gate in-job on ET time.
- **Steps:** collect all connectors (failures isolated) → append vintage store → run engine →
  write `site/public/data/*.json` → validate against `schemas/` → run QA self-test → build Next
  export → deploy to Vercel → commit store partitions + published JSONs back to the repo.
  (No `[skip ci]` on data commits — Vercel skips deploys for `[skip ci]` commits, which would
  kill the deploy. Bot pushes made with `GITHUB_TOKEN` don't trigger Actions `push` workflows
  anyway, so `ci.yml` never runs on data commits; validation happens pre-commit, in the
  pipeline.)
- **A failed connector never blocks publish.** It carries the prior value forward, lowers the
  coverage score, and surfaces in `sources_status.json` + a failing QA check.
- **Secrets:** FRED, BLS, EIA, FMP API keys as Actions secrets (all free/already held).

## 3. Vintage store

Every observation is stored with the date we learned it, so history can't be silently rewritten
and backtests can be vintage-true.

- **Record:** `(series_code, obs_date, value, vintage_date, source, route)`.
- **Format:** append-only JSONL, partitioned monthly (`store/obs/2026-07.jsonl`), committed to
  git. Text diffs, append-only writes, no hosted DB. At the original's scale (1,068 series /
  332k obs) this is ~tens of MB — years of headroom.
- **Query layer:** engine loads partitions into in-memory SQLite at run start; all engine reads
  go through an `as_of(vintage_date)` view so live runs and backtests share one code path.
- **Revisions:** a re-published value for the same `(series_code, obs_date)` appends a new row
  with the new vintage — never overwrites. "Latest vintage wins" for live; "vintage ≤ cutoff"
  for backtests.

## 4. Data layer — connectors

One module per source exposing `fetch(session) -> list[Observation]`, registered in
`config/series.yaml` with route, cadence, and the series it feeds. No connector imports another.

| Route | Source | Feeds | Phase |
|---|---|---|---|
| API (key) | FRED + ALFRED | official CPI/PCE components, rates, ~90 themed series, revisions | 1 |
| API (key) | BLS (incl. AP average prices) | official CPI detail, grocery staples | 1 |
| API (key) | EIA | residential electricity, nat gas, weekly petroleum (GASREGW validation) | 1 |
| API (key) | FMP | futures/commodities, economic calendar, street consensus, gold | 1 |
| API | Treasury FiscalData | debt, interest expense, customs duties (keyless) | 1 |
| CSV | Zillow ZORI + ZHVI | shelter rent blend, home values | 1 |
| CSV | Freddie Mac PMMS | 30yr mortgage (weekly fallback) | 1 |
| CSV | Apartment List | shelter rent blend | 2 |
| CSV | Redfin Data Center | shelter rent blend | 2 — retired by Redfin 2025, dropped (2a) |
| Scrape | AAA daily gas | fuel component (daily) | 2 |
| Scrape | Mortgage News Daily | 30yr daily rate (primary; PMMS fallback) | 2 |
| Scrape | Manheim (Cox Automotive) | used-vehicle index, shifted +30d | 2 |
| API | USDA (NASS/MMN) | food-at-home composite, farm-gate prices | 2 |
| Scrape | Cleveland Fed | inflation nowcast benchmark | 3 |
| API | Kalshi | CPI/FOMC market odds | 3 |
| API | Polymarket | prediction markets page | 4 |
| API | World Bank / IMF | countries matrix | 5 |

**Scrape protections** (required, since we chose the full blend): recorded HTML fixtures in
tests; the >5% one-day quality gate (§5); per-connector QA check; carry-forward fallback. A
broken scrape degrades coverage, never correctness. Manheim publishes monthly (mid-month +
full-month) — we consume the published index page, apply the 30-day lead shift, and accept
monthly cadence for that component.

## 5. Engine

Five pure stages over the vintage store (each independently unit-testable):

1. **Rebase** — every series indexed to Jan 2018 = 100. Late-starting series spliced: scaled to
   match their component index at first overlap.
2. **Blend & splice** — volatile components ride live data spliced onto official BLS history:
   - shelter_rent = Zillow ZORI + Apartment List (5:3, renormalized; Redfin leg dropped 2a — dataset retired)
   - fuel = AAA daily pump, validated weekly vs EIA GASREGW
   - used_vehicles = Manheim wholesale shifted 30 days (wholesale leads retail)
   - food_home = USDA composite; electricity + nat_gas = EIA residential
   - **Sticky categories carry official BLS forward between prints** (medical, recreation,
     education_comm, food_away, new_vehicles, apparel, other) — no fake precision.
3. **Quality gate** — any live component moving >5% in one day: hold at prior value one day,
   flag. Missing inputs carry forward and lower the coverage score. Publication never blocks.
4. **Aggregate** — Laspeyres: `headline_index = Σ weightᵢ × component_indexᵢ`.
   `YoY = index_today ÷ index_365d_ago − 1`. Weights = BLS CPI relative importance (December
   values), hand-seeded in `config/basket.yaml`, renormalized, refreshed annually.
   Seed weights (2026, 14 components): shelter_owned .265, other .185, food_home .082,
   medical .081, shelter_rent .075, food_away .057, education_comm .055, recreation .053,
   new_vehicles .036, fuel .030, electricity .028, apparel .025, used_vehicles .021, nat_gas .007.
5. **Variants** — five published cuts, each validated vs official history (corr + mean abs gap
   published in methodology):

| Variant | Construction |
|---|---|
| Gauge (CPI-comparable) | market-rent blend applied to both rent and OER weights |
| Cost-of-Living | owned shelter = marginal-buyer payment: `P = L·r(1+r)³⁶⁰ / ((1+r)³⁶⁰ − 1)`, `L = 0.80 × ZHVI`, `r = 30yr rate / 12` (MND daily, PMMS fallback) |
| CPI-Tracker | official shelter dynamics — built to re-track the print |
| Supercore | services ex-shelter, weights renormalized |
| PCE-weighted | same components under BEA PCE shares, graded vs PCE |

### Nowcasts (phase 3) — all versioned, all graded

- **CPI** — bottom-up from component indexes mapped onto the BLS shelter cycle; calibrated
  params (fuel_beta, rent_lag_months, rent_w) published in the JSON.
- **PCE bridge** — maps the CPI-space nowcast into PCE space.
- **NFP** — linear `nfp = a + b·payroll_momentum − c·claims_delta`, walk-forward refit monthly;
  MAE vs naive published.
- **Ensemble** — inverse-error-weighted blend of ours + Cleveland Fed + street + Kalshi;
  weights update as prints grade.
- **Vintage-true backtesting:** historical forecasts use only ALFRED data as of the day before
  release, graded against first-release actuals. Rows badged `live` vs `backtest` everywhere
  displayed. Fuel 2-week forward printed with its formula:
  `gas_forward_2wk = pump + 0.85 × (RBOB_5d_avg − RBOB_prior15d_avg)`.

### Composites (phase 4) — transparent, no fitting

- **Economy Heat Check** — 21 indicators, each a momentum transform (mostly 3-mo change)
  z-scored vs own 2017-now history, clamped ±2.5, signed so positive = heating; group weights
  Prices 25 / Real Economy 25 / Pipeline 20 / Housing 15 / Money & Expectations 15;
  score = weighted mean z × 50, clamped ±100.
- **Consumer Stress Index** — 7 series percentile-scored 0–100 within own 2019-now range,
  direction-adjusted; weights: card delinquency 20, card APR 15, saving rate 15, debt service 15,
  revolving growth 15, mortgage delinquency 10, continuing claims 10.
- **50-State Cost Pressure** — mean percentile of YoY change across electricity, nat gas,
  gasoline, home prices (FHFA), unemployment, per state.
- **Recession composite** — six named signals (Sahm ≥ +0.50pp, 10Y–3M < 0, NFCI > 0, claims 3m
  avg 10% above 12m, CFNAI-3mo < −0.70, Chauvet-Piger > 20%), each with its trigger rule and
  lead record printed; composite = equal-weighted share triggered.
- **Gap decomposition** — `gap contributionᵢ = weightᵢ × (our YoYᵢ − BLS YoYᵢ)`.
- **Real wages** — `real = (1 + raise) ÷ (1 + inflation) − 1` vs both gauge and official.
- **Live counters** — latest official Treasury figure linearly interpolated between publishes,
  labeled as such.

## 6. JSON contract

We adopt the teardown §2 inventory as our schema spec — same shapes, our data. Core files:
`pulse.json`, `replay.json`, `gauge_daily.json`, `compare.json`, `quilt_months_{24,48,all}.json`,
`gaptable.json`, `nextprint.json`, `nowcast_latest.json`, `releases.json`,
`accountability_<target>.json`, `backtest.json`, `fuel.json`, `geo.json`, `metros.json`,
`grocery_basket.json`, `sources_status.json`, `brief.json`, `qa.json`, `methodology.json`.
Per-page files (`heatcheck.json`, `labor.json`, `fred_themed.json`, …) and per-series files
(`series_<code>.json`) phase in with their pages.

Rules:

- **One writer module per file**; a JSON Schema per file in `schemas/`, validated in CI and in
  the daily run before deploy.
- **`methodology.json` is generated** from `config/basket.yaml` + the connector registry + live
  validation stats — never hand-written, so docs can't drift from code.
- Exports (phase 5): headline/components CSV, `feed.xml` RSS of the daily brief.

## 7. Front end

**Next.js App Router, `output: 'export'`, TypeScript, ECharts.** All pages statically generated
at publish time; series/country pages via `generateStaticParams` over inventory JSONs. Page data
is imported at build time (numbers baked into HTML); interactive widgets (treemap replay,
calculators, reweighter, cart) hydrate client-side against the same published JSONs.

**Component library (~12 components cover ~90% of the site):** `PageShell` (nav + live-gauge
chip + search + footer), `KpiCard`, `DeltaChip`, `StatusPill`, `DataTable` (sortable,
color-coded cells, tab chips), `EChart` (owns dark/light theme, NBER shading, dashed reference
lines, legend chips), `Treemap` (replay scrubber + mode toggles), `QuiltHeatmap` (PNG export),
`StateTileMap`, `NumberLine` (forecaster who's-where), `Countdown`, `ExplainerCard`, `RangeBar`
(5-yr position), `ProbabilityBar`.

**Design tokens (verbatim from teardown §4):** bg `#0B0F14`, card `#11161C`, border `#1E2630`
(1px hairlines), text `#E6EDF3`, muted `#8B98A5`; accents: sky `#38BDF8` = ours/primary, amber
`#F59E0B` = official/cost, red `#F87171` = hot, emerald `#34D399` = cool/verified, violet
`#A78BFA` = alt series; chips = 10%-opacity accent bg + 35%-opacity border; radius 10px; system
font stack; h1 26px/700 with muted inline subtitle; 11px uppercase letter-spaced section labels;
KPI numbers 24–40px bold; tabular numerals in tables. Light theme via toggle.
**Semantic color mapping is a hard site-wide rule:** blue = ours, amber = official, red =
inflation hot / worse, green = disinflation / better, purple = alternate series.

**Presentation formula (every analytics page):** KPI cards with as-of dates → one hero viz →
supporting small multiples → dense color-coded table → plain-English methodology footnote →
receipts. A number never appears without its date, source, and a comparison anchor.

## 8. QA & credibility layer

Built from phase 1, grown to the full set — this is the moat:

1. `qa.json` self-tests, growing to the original's 13 checks (headline current, no NaN
   components, viz frames complete, official CPI verified vs released print, benchmark
   plausibility, narrative fresh, nowcast fresh, ensemble computed, fuel feeds flowing,
   no connector failures 24h, coverage ≥ threshold, nowcast params calibrated) with a public
   `SELF-TEST n/n ✓` badge.
2. Official-CPI verification vs the released print, with ✓ badge on the card.
3. Coverage % displayed honestly; sticky components labeled `BLS-CF`.
4. As-of dates on every figure; cadence in every table.
5. Formulas printed on the cards that use them.
6. `live` / `backtest` (`BT`) badging on all graded forecasts.
7. Sources-status page: per-connector route, cadence, last-success, last message.
8. Evergreen graded URLs (cpi-preview becomes the result page each print morning).
9. Open-data page documenting every JSON/CSV (phase 5).

## 9. Testing

- **Engine:** pytest against hand-computed fixtures for rebase, splice, blend, quality gate,
  Laspeyres, YoY, variant construction, nowcast math, composite scores (same style as the
  notebook's `uw_flow` suite).
- **Connectors:** recorded HTTP/HTML fixtures per source; scrapes additionally get
  structure-drift assertions (selector still matches, value in plausible range).
- **Contract:** JSON Schema validation of every published file, in CI and in the daily run.
- **Backtest regression:** walk-forward backtest results pinned; a change in engine math that
  moves historical MAE fails CI unless the pin is deliberately updated.
- **Site:** one Playwright smoke pass (homepage + one page per cluster renders, no console
  errors) per deploy.
- **Production:** the QA self-test is the ongoing smoke test; failures visible on-site.

## 10. Phases

Each phase gets its own implementation plan (superpowers:writing-plans) when it starts.

| Phase | Delivers | Pages live | Exit criteria |
|---|---|---|---|
| **0 — skeleton** | Repo scaffold, CI, the full loop proven: cron → 1 connector (FRED) → store → trivial engine → 1 JSON → Next build → Vercel deploy → commit-back | placeholder homepage with 1 real KPI | Loop runs green on schedule 3 consecutive days |
| **1 — walking skeleton** | FRED/ALFRED, BLS, EIA, FMP, Treasury, Zillow, PMMS connectors; vintage store; engine stages 1-4; gauge + tracker variants (low coverage, honest); pulse/replay/gauge_daily/compare/gaptable/sources_status/qa JSONs; QA v0 (~6 checks) | homepage (KPI hero row, 5-series hero chart, treemap + modes, gap table — rows only for variants live at the time, sources row), methodology v0 | Daily gauge publishes unattended; tracker corr vs official ≥ 0.95 on 2018-now backfill; QA green |
| **2 — full blend** | Apartment List, Redfin, AAA, MND, Manheim, USDA connectors; quality gate; all 5 variants; coverage ~37%; quilt JSONs; grocery basket | quilt, supercore, my-inflation, calculator, real-wages, grocery basket cards | All 14 components on spec'd sources; scrape failures degrade gracefully in a live drill |
| **3 — nowcasts + receipts** | CPI/PCE/NFP models, ensemble, vintage-true backtest harness, releases/accountability/backtest/nextprint JSONs, Cleveland + Kalshi + street benchmarks | cpi-preview (evergreen), scoreboard, matrix, gap, vs-bls, next-print + Fed Watch homepage modules | First live print graded and published next morning; backtest table with `BT` badges |
| **4 — composites + breadth** | Heat check, stress, recession composite, state pressure, ~90 themed FRED series, labor model | heatcheck, jobs, jobs-preview, macro, recession, growth, housing, housing-market, affordability, metros, money, fiscal, stress, credit, commodities, energy, fx, ratios, rates, mortgage, liquidity, prediction-markets | Full economy + markets menus live |
| **5 — long tail** | Series directory + `series_<code>` pages, grocery cart + item pages, farm-to-shelf, counters, states, revisions (ALFRED), century, countries, calendar, open-data page, CSV exports, RSS | everything else | Site at full page inventory; open-data page accurate |

## 11. Risks & mitigations

- **Scrape fragility** (AAA, MND, Manheim, Cleveland) — fixture tests, quality gate,
  carry-forward, QA visibility. Accepted as inherent to the full-blend decision.
- **Manheim cadence/access** — daily index is proprietary; we consume the monthly publish.
  Component falls back to BLS carry-forward if the page moves.
- **Actions commit-loop** — the daily workflow has no `push` trigger, so bot data commits
  cannot re-trigger it; a dedicated bot identity makes data commits auditable.
- **DST cron drift** — dual UTC crons + in-job ET gate.
- **Weight seeding errors** — basket weights are config, reviewed against BLS December relative
  importance; a QA check asserts Σweights = 1.
- **Scope creep in phase 4/5** — page templates are the mitigation: by phase 4 every new page is
  composition of existing components + one JSON writer.

## 12. Open questions (to resolve in phase plans, none block the spec)

1. **Real name + domain** — `macrogauge` is a working name; decide before any public launch.
2. **FMP key tier** — confirm the existing FMP subscription's REST rate limits cover the daily
   pull (futures + calendar + consensus).
3. **Vercel project setup** — team/personal account, and whether preview deploys run the
   pipeline (they should not — previews reuse last committed data).
4. **BLS AP item list** — which grocery staples beyond the original 6 to carry (cart page wants
   ~25 items).

## Sources

- dashboards/nowflation-site-teardown.md (in the notebook repo) —
  the primary reference; all formulas, weights, palettes, and file schemas trace to it (studied
  2026-07-06 from nowflation.com, credit: Steven Fiorillo / Fiorillo Media).
- Brainstorming session decisions, 2026-07-07 (this doc, §1).
