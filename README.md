# MacroGauge

**A daily, independent view of US inflation—built from live market data, official releases, and auditable vintage history.**

[![CI](https://github.com/ewyluda/macrogauge/actions/workflows/ci.yml/badge.svg)](https://github.com/ewyluda/macrogauge/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-macrogauge-38bdf8)](https://macrogauge-cloudten.vercel.app)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-static_export-000000)](https://nextjs.org/)

[Open MacroGauge](https://macrogauge-cloudten.vercel.app) · [Explore Data Center Inflation](https://macrogauge-cloudten.vercel.app/datacenter) · [Read the methodology](https://macrogauge-cloudten.vercel.app/methodology)

MacroGauge re-prices the CPI basket using higher-frequency market and alternative data, compares the result with official inflation, forecasts upcoming prints, and publishes the evidence behind every number. The Python pipeline performs all collection and calculation; the Next.js site renders pre-built, schema-validated JSON and does no analytical work in the browser.

## Data Center Inflation

The dedicated [Data Centers page](https://macrogauge-cloudten.vercel.app/datacenter) tracks a category that has no official all-in price index: the cost to build, equip, and operate US data centers.

### Available now

- **DC Build Index** — construction labor, steel, concrete, copper and aluminum, switchgear, transformers, generators, HVAC equipment, and pumps.
- **DC Ops Index** — industrial electricity, facilities and operations labor, and machinery maintenance.
- **DC Hardware Index** — transaction-sensitive official price series for compute, storage and memory, and networking equipment.
- **Live commodity tails** — copper and aluminum futures extend the relevant monthly PPIs beyond their latest official print without overwriting official history.
- **State cost parity** — build and operating-cost multipliers combine QCEW construction wages and EIA industrial electricity prices with nationally priced inputs.
- **Full receipts** — component weights, contributions, last observations, quality holds, and the contrast between transaction-sensitive and hedonically adjusted hardware series.

All three indexes are rebased to `2018-01 = 100`. Build and Ops remain separate because capex and opex have different cost drivers; the project does not manufacture a blended total-cost-of-ownership number from an arbitrary capex/opex split.

### The construction boom, in real terms

The page also carries monthly Census C30 data-center construction spending — and a series no one else publishes, because it requires a data-center-specific cost deflator:

- a keyless **Census XLSX connector** for the seasonally adjusted annual-rate and not-seasonally-adjusted construction series;
- nominal construction spending in dollars and NSA same-month YoY growth;
- **real data-center construction spending**, calculated by deflating Census nominal spending with MacroGauge's own DC Build Index into constant January 2018 dollars;
- revision-aware ingestion into the append-only vintage store, preserving preliminary, revised, and final Census values;
- a nullable `construction` block inside `datacenter.json`, so the section degrades cleanly if the source breaks;
- source-drift checks and an isolated `CENSUS` failure domain, so a workbook-layout change cannot break the core inflation gauge or the rest of the Data Center page.

The design is documented in [DC Construction Boom Design](docs/superpowers/specs/2026-07-15-dc-construction-design.md).

## What you can explore

| Area | Pages and capabilities |
|---|---|
| Inflation gauge | Supercore, cost of living, Gauge-vs-BLS gap decomposition, official comparison, component heatmaps |
| Personal inflation | Custom basket reweighting, grocery prices, since-date calculator, real-wage analysis |
| Forecasts | CPI preview, next-print nowcast, 12-month outlook, forecast scoreboard, model matrix, release log |
| Macro conditions | Economic heat check, consumer stress, recession risk |
| Data centers | Build, operating, and hardware inflation; state parity; component-level receipts |
| Transparency | Live source status, QA results, methodology, vintage replay, and forecast accountability |

## How it works

```text
Official + market + alternative sources
                  │
                  ▼
       isolated source connectors
                  │
                  ▼
   append-only vintage observation store
                  │
                  ▼
 pure engines: rebase → blend/splice → gate → aggregate
                  │
                  ▼
 schema-validated JSON artifacts + QA receipts
                  │
                  ▼
       Next.js static site → Vercel
```

The weekday workflow runs at 8:40 AM Eastern, with backup scheduling for delayed GitHub cron delivery. It collects new observations, recomputes the products, validates every artifact, and commits the resulting store and site data. A new data commit is the pipeline heartbeat; a green workflow that skipped its publication gate is not counted as a publish.

Reliability is built around a few hard rules:

- **Source isolation:** a failed connector is reported in `sources_status.json`; it does not stop unrelated sources.
- **Phase isolation:** the gauge, nowcast, outlook, composites, and Data Center Index publish independently and report failures through `qa.json`.
- **Contract safety:** JSON Schema validation failures stop deployment. Invalid artifacts never ship.
- **Staleness over silence:** stale observations carry forward within explicit limits and remain visible in source and component receipts.
- **No browser-side analytics:** published JSON is the result; the site only formats and visualizes it.
- **No live network calls in tests:** connectors accept injected HTTP functions and use recorded or generated fixtures.

## Repository map

```text
pipeline/
  connectors/        one external source per connector
  engine/             pure calculation stages and product engines
  publish/            JSON builders, writers, and validation
  store/              append-only vintage storage
config/               source registry, baskets, composites, and calendars
schemas/              one JSON Schema contract per published artifact
store/obs/            monthly JSONL vintage partitions
site/
  src/app/            static routes
  src/components/     reusable React and chart components
  src/lib/            presentation utilities and client-only helpers
  public/data/        pipeline-generated JSON consumed by the site
tests/                pytest suite and network fixtures
docs/                 architecture, design specs, and implementation plans
```

The main architecture reference is [macrogauge-design.md](docs/macrogauge-design.md). The Data Center index methodology and pipeline architecture are described in [Data Center Cost Index Design](docs/superpowers/specs/2026-07-11-datacenter-cost-index-design.md).

## Run locally

### Prerequisites

- Python 3.12+
- Node.js 22+
- npm
- A FRED API key for pipeline runs
- Optional EIA, BLS, FMP, and USDA keys for their respective live sources

### Build and run the site

The repository includes the latest published JSON, so the site can run without collecting fresh data first.

```bash
cd site
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To produce the static export:

```bash
npm run build
```

### Run the data pipeline

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

export FRED_API_KEY="..."
export EIA_API_KEY="..."   # optional, enables EIA sources
export BLS_API_KEY="..."   # optional, enables registered BLS sources
export FMP_API_KEY="..."   # optional, enables market-data tails
export USDA_API_KEY="..."  # optional, enables USDA sources

python -m pipeline.run_daily --store store --out site/public/data
```

`FRED_API_KEY` is required to start a daily run. Missing optional credentials surface as isolated source failures; inspect `site/public/data/sources_status.json` and `site/public/data/qa.json` after the run.

## Test and verify

Pipeline tests run from the repository root:

```bash
pytest -q
pytest tests/test_dcindex.py -q
pytest tests/test_run_daily.py -q
```

Frontend checks run from `site/`:

```bash
npm run build
npm test
npm run e2e
```

CI runs the full Python suite, static build, Vitest suite, and Playwright smoke tests on pushes to `main` and on pull requests.

## Data contracts and vintage policy

Every file in `site/public/data/` has a corresponding contract in `schemas/`. Writers validate their output before it becomes deployable, and array alignment or cross-field invariants that JSON Schema cannot express are pinned in tests.

Rows in `store/obs/*.jsonl` are immutable and schema-versionless:

- new `Observation` fields may be added;
- existing fields are never renamed, removed, or retyped;
- readers provide defaults for fields absent from older partitions;
- committed partitions are never rewritten;
- merge conflicts preserve both sets of observation rows.

This policy keeps old vintages replayable and makes source revisions auditable over time.

## Deployment and project status

- **Production:** [macrogauge-cloudten.vercel.app](https://macrogauge-cloudten.vercel.app)
- **Daily publisher:** [`.github/workflows/daily.yml`](.github/workflows/daily.yml)
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- **Current work:** a market-data memory nowcast tail for the DC Hardware Index (no official DRAM price index exists) and a cost-of-compute section (GPU rental and AI inference prices)

MacroGauge is an analytical project, not investment advice. Source data can be revised, delayed, or unavailable; the site exposes freshness and QA state so those limitations remain visible.
