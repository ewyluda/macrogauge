# /capacity — Neocloud + Hyperscaler AI Capacity Tracker — Design Spec

**Date:** 2026-07-21
**Branch:** `capacity-tracker`
**Origin:** Native reimplementation + expansion of the standalone notebook page
`~/Development/notebook/public-equity/neocloud-capacity-tracker.html` ("Neoclouds — Who Has the
Megawatts?", data as-of 2026-07-09). The notebook file is NOT modified or moved; its embedded
`NEO` JSON blob is the seed dataset.

## Goal

An independent `/capacity` page on macrogauge answering "who has the AI megawatts?" across
**neoclouds, ex-BTC-miner landlords/operators, AND hyperscalers** — with the valuation side
(market cap → EV, EV/MW, backlog coverage) **repriced daily** by the pipeline instead of frozen
at a hand-curated snapshot date. MW capacity numbers stay hand-curated from filings
(no API exists for them); market data rides the existing FMP connector.

## Decisions (from brainstorm, 2026-07-21)

| Question | Decision |
|---|---|
| Data model | **Hybrid**: hand-curated MW/backlog/sites in `config/capacity.json`; market caps repriced daily via FMP; publisher computes all derived analytics |
| Hyperscaler treatment | **One grid, cohort toggle** (All / Neoclouds / Hyperscalers); new `hyperscaler` role; misleading metrics (EV/MW) suppressed per-row, not per-page |
| Coverage adds | MSFT, AMZN, GOOGL, META (+ ORCL re-roled); **private** xAI + OpenAI/Stargate; colo REITs EQIX, DLR; Chinese BABA, TCEHY, BIDU; **NVDA as stat-bar reference only** (no capacity row) |
| Views | **All 5**: capacity bars, valuation × execution scatter, demand map, energization timeline, geo map |
| New-company data | **I research, user verifies** — every number cited + confidence-flagged; nothing publishes before sign-off |
| Route | `/capacity` |
| Styling | **Macrogauge design system** (cards/typography/palette of /datacenter, /commodities) — the tracker's information design carries over, its CSS does not |

## Roster (~29 rows + 1 reference)

- **Ported as-is (verify-adjusted, from the notebook blob):** CRWV, NBIS (neocloud); APLD, CORZ,
  GLXY, WULF, HUT, CIFR, KEEL, RIOT (landlord); IREN, BTDR, WYFI, BTBT, DOCN, AKAM (operator);
  MARA (exploratory). Anything visibly stale since 2026-07-09 gets flagged during the research pass.
- **ORCL** re-roled `benchmark` → `hyperscaler` (its `dupe:"benchmark"` exclusion is replaced by
  cohort-scoped totals — see Derived analytics).
- **New hyperscalers:** MSFT, AMZN, GOOGL, META + Chinese BABA, TCEHY, BIDU (role `hyperscaler`).
- **New landlords:** EQIX, DLR (role `landlord` — traditional colo REITs, same cohort as miners).
- **Private builders:** xAI, OpenAI/Stargate — role `hyperscaler`, `private: true`, no ticker;
  hand-entered `valuation_b` (last funding round, cited) instead of a daily cap; EV/MW and
  coverage null.
- **NVDA:** not a company row. Published as `reference: {nvda_cap_b, …}` and rendered as a
  stat-bar tile ("NVDA market cap vs. combined cohort EV").

Role enum becomes: `neocloud | landlord | operator | hyperscaler | exploratory`
(`benchmark` retired — ORCL was its only member).
Cohort mapping for the toggle: **Neoclouds** = neocloud + landlord + operator + exploratory;
**Hyperscalers** = hyperscaler (public + private); **All** = both.

## 1. Config: `config/capacity.json` (hand-curated layer)

Structure mirrors the notebook blob, renamed/extended:

```jsonc
{
  "schema_version": 1,
  "as_of_curated": "2026-07-21",        // bumped on every hand edit
  "note": "...", "basis": { ... },       // methodology strings, ported
  "companies": [{
    "t": "CRWV", "n": "CoreWeave", "role": "neocloud",
    "dupe": "tenant" | null,             // excluded from de-duped MW totals (unchanged semantics)
    "private": false,                    // true => no FMP series; valuation_b required
    "valuation_b": null,                 // private rows only: last-round valuation, $B
    "confidence": "filed" | "estimate",  // new: hyperscaler MW footprints are estimates — labeled on-page
    "op": 1000, "con": 700, "plan": 1800, "pipe": ">8,000 (2030)",
    "nd": 32.1, "ndflag": "...",         // net debt $B, hand-curated (quarterly)
    "bk": 99.4,                          // backlog/RPO $B (null where undisclosed)
    "flag": "⚠ tenant — ...", "dom": "coreweave.com",
    "econ": { "backlog": "...", "revmw": "...", "capexmw": "...", "anchor": "...",
              "contract": "...", "margin": "...", "power": "...", "pricing": "..." },
    "sites": [["name", mw|null, "o|c|p", "when string"], ...],
    "src": [["label", "url"], ...]
  }],
  "tenants": [["tenant name", "landlord ticker", mw, "terms"], ...],   // demand-map edges
  "geo": [{ "t", "site", "mw", "st", "lat", "lng", "when", "approx" }, ...],
  "geo_unmapped": [{ "t", "site", "mw", "st", "why" }, ...],
  "geo_note": "..."
}
```

Loader `pipeline/capacity.py` (pattern: `pipeline/basket.py`) validates on load: unique tickers,
role in enum, op/con/plan ≥ 0 (numbers, no nulls — 0 means none), `private` rows have
`valuation_b` and no FMP series expected, public rows must have matching `fmp_cap_*` /
`fmp_px_*` series in the registry (cross-check at load), `tenants`/`geo` reference known tickers.
The notebook's `px`/`cap`/`baseline` snapshot fields are **dropped** — that's the pipeline's job now.

## 2. Collection: FMP equity quotes

- `pipeline/connectors/fmp.py` gains `fetch_equity(mapping, api_key, ...)` where `mapping` is
  `{FMP symbol → code stem}` (e.g. `{"MSFT": "msft"}`). One `stable/batch-quote` call for all
  ~28 public tickers (27 company rows + NVDA, which exists only to feed the reference tile);
  each row emits **two observations**: `fmp_px_<stem>` = `price` ($) and
  `fmp_cap_<stem>` = `marketCap / 1e9` ($B, rounded to 2dp).
- Registered in `config/series.json` (~56 new series, `max_staleness_days: 7`, source FMP).
- Drift/plausibility protection per house convention: cap must be > 0 and < 10,000 ($10T),
  px > 0 and < 100,000; implausible rows are skipped with a recorded per-item error.
- Per-item isolation + `warn_partial` (existing convention): one bad ticker never drops the batch.
- Tickers to verify against FMP during implementation (OTC/foreign/small): TCEHY, BABA, KEEL,
  WYFI, BTDR. Any ticker FMP can't quote falls back to hand-curated `valuation_b` (same path as
  private rows) with an `unpriced` flag, and the row still renders.
- Store accumulates daily caps (vintage semantics as usual) — weekend/outage carry-forward is
  free, and cap history enables future sparklines (out of scope now).
- One-time backfill is NOT needed — the page only uses latest cap.

## 3. Publish: `pipeline/publish/capacity.py` → `site/public/data/capacity.json`

Pure `build(conn, cfg) -> dict` + `write(payload, out_dir, published_at)` per the established
writer contract; JSON Schema `schemas/capacity.schema.json` validated inline.

**Derived analytics (all pipeline-side; the site computes nothing):**
- Per public row: `cap` (latest store value + its `priced_date`), `px`, `ev = cap + nd`,
  `wmw = op + 0.5·con + 0.25·plan`, `ev_per_mw = ev / wmw` ($M/MW), `pct_energized =
  op / (op+con+plan)` (null when total is 0), `coverage = bk / ev` (null when bk null).
- `ev_per_mw` is **published as null for hyperscaler-role and private rows** (conglomerate EV over
  an AI-DC slice is not honest) — suppression is a data decision made in the pipeline, not CSS.
- Private rows: `cap: null`, `ev: null`, `valuation_b` passed through.
- Missing/stale cap (store empty for a ticker): row publishes with `cap: null` + `stale: true`
  rather than being dropped; derived fields degrade to null. Degraded-safe like other writers.
- **Cohort totals** (replaces the notebook's single de-duped total): for each cohort
  (`neocloud`, `hyperscaler`, `all`) sum op/con/plan over member rows with `dupe == null`.
  ORCL's old `dupe:"benchmark"` is removed — it is simply not in the neocloud cohort.
- **Timeline**: the notebook's render-time `parseQ()` quarter-parsing of site `when` strings moves
  into the publisher. Publishes `timeline: { base_mw, points: [{q: "2026Q3", add_mw, cum_mw}],
  milestones: {q: [[t, site, mw], ...]} }` per cohort scope, built from construction-stage sites
  with parseable dates (same regex semantics, ported to Python + unit-tested). Unparseable `when`
  → excluded from the curve (as today) but still listed in the row detail.
- **Pass-throughs**: `tenants`, `geo`, `geo_unmapped`, per-company detail (econ/sites/src),
  `basis`, notes, `as_of_curated`.
- **Reference block**: `{ nvda_cap_b, cohort_ev_b }` for the stat-bar tile.
- Header dates: `as_of_curated` (MW layer) + `priced_date` (max obs_date across cap series) +
  `published_at`.

**Orchestration (`pipeline/run_daily.py`):** 9th isolated `try/except` phase after commodities;
`capacity_ok` joins the qa.json phase dict; `sources_status` still publishes first;
`jsonschema.ValidationError` re-raises (caught before generic `Exception`) — same pinned ordering
invariants, extended by test.

## 4. Site: `/capacity` page

`site/src/app/capacity/page.tsx` importing `capacity.json`, plus client components under
`site/src/components/capacity/`:

- **Header**: title, lede, stat bar (cohort op/con/plan GW totals, company count, NVDA-vs-cohort-EV
  reference tile), dual date line: "MW data as of {as_of_curated} · priced {priced_date}".
- **Cohort toggle** (All / Neoclouds / Hyperscalers) + search box + sort control — shared state
  across all five views (one client wrapper component owns it).
- **View tabs** (5):
  1. **Capacity bars** — ranked rows, stacked op/con/plan bars on a shared MW axis, expandable
     detail drawer (econ KPI grid, sites list, source links, flags). Sort keys: total, op, con,
     plan, EV/MW, cap.
  2. **Valuation × Execution scatter** — EV/MW vs %energized; only rows with non-null `ev_per_mw`
     plot (hyperscalers/private naturally excluded); dot size = weighted MW.
  3. **Demand map** — tenant→landlord edges from `tenants`, now including hyperscaler tenancy
     (e.g. MSFT→CRWV, ORCL/Stargate) as first-class nodes.
  4. **Energization timeline** — cumulative step area from the published `timeline` block
     (client does zero date parsing).
  5. **Geo map** — NA + Europe panels from `geo` lat/lng (town-centroid dots, approx = dashed),
     `geo_unmapped` chip row below.
- Rows with `ev_per_mw: null` render "—" with a tooltip explaining why (conglomerate/private).
- `confidence: "estimate"` rows carry a visible "est." chip — hyperscaler MW is not filing-grade.
- Nav: added to the AI-infra group next to /datacenter and /commodities. Metadata title pattern
  matches sibling pages (e.g. "AI Capacity: {all-cohort GW} GW tracked · priced daily").
- Styling: macrogauge globals (cards, chips, `--bg` palette, existing chart idioms). No new fonts,
  no port of the notebook CSS.

## 5. Research task (gated)

Curate, with citation per number and `confidence` flag: MSFT, AMZN, GOOGL, META, ORCL (refresh),
BABA, TCEHY, BIDU, EQIX, DLR, xAI, OpenAI/Stargate — op/con/plan critical-IT AI MW (estimates
from filings, earnings calls, credible public trackers), net debt, backlog where meaningful
(REIT leasing backlog yes; hyperscaler RPO is cloud-wide — likely null + econ note), econ blocks,
major sites (+ geo centroids where disclosed), tenant edges, sources. Also sanity-refresh the
ported 18 for anything that visibly moved since 2026-07-09 (flag, don't silently change).

**Gate:** the completed `config/capacity.json` diff is presented for user verification before the
branch merges / anything publishes. Same verify-adjusted spirit as the original tracker.

## 6. Testing

- **pytest** (all fixture-driven, no network):
  - `fetch_equity`: fixture batch-quote response → px+cap observations; implausible-value skip;
    partial failure emits `PartialFetchWarning`; symbol→code mapping.
  - Config loader: valid file loads; duplicate ticker / bad role / private-without-valuation /
    unknown ticker in tenants|geo all raise.
  - Publisher: derived math (ev, wmw, ev_per_mw, pct_energized, coverage, rounding); hyperscaler +
    private ⇒ `ev_per_mw` null; missing cap ⇒ degraded row not dropped; cohort dedup totals;
    timeline quarter-parser (port the regex cases: "Q3 2026", "phased from 2026", "H2 2026",
    "early 2027", unparseable); schema validates a full and a degraded payload.
  - `run_daily`: capacity phase failure ⇒ run still exits 0 and publishes status+qa with
    `capacity_ok: false`; ValidationError still fatal; `test_run_daily` end-to-end fake gains the
    equity batch-quote route.
- **site**: `npm run build` green; Playwright smoke grows to 26 pages (/capacity renders, zero
  console errors). No new vitest math suites — the client renders published values only.

## 7. Maintenance workflow

Filings/announcements drop → edit `config/capacity.json`, bump `as_of_curated`, commit. Valuations
reprice themselves every morning via the daily bot. Quarterly: refresh `nd`/`bk` from 10-Qs.

## Out of scope

- Cap-history sparklines (store already accumulates the data; future enhancement).
- Automated MW ingestion or scraping of capacity announcements.
- Any change to the notebook HTML tracker.
- Backtesting/QA-gauge integration — this page is a standalone artifact like /commodities.

## Process

TDD per repo convention; commit per task; **never push without approval** (push = production
deploy); rebase over daily bot commits before any push.
