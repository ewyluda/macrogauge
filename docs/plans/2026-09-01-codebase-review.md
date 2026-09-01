# Codebase review — 2026-09-01

Scope: `pipeline/`, `config/`, `schemas/`, `.github/workflows/`, `site/src/`, and a browser walk of
production at 1440×900 and 390×844. Everything already on `todo.md` (audited 2026-08-10) was
excluded; only new findings are listed. Items marked **verified** were re-checked against source by
hand after the review pass; the rest are reviewer findings with file:line evidence.

Design canvas for the UI/UX items: https://claude.ai/code/artifact/e110d1e9-e3f1-4a2d-b159-bfc4b2a7fd4d

Baselines measured this session: `pytest -q` 873 passed in 21.7 s (CLAUDE.md says 851);
`npm test` 154 tests in 1.0 s; `npm run e2e` 48 passed in 27 s (CLAUDE.md says 47);
`npm run build` 13.9 s, 34 pages; store 24 MB / 179,390 rows / 187 partitions, `vintage.load` 0.47 s.

## A. Pipeline

### P1 — silent wrong numbers or a scheduled red run

- **A1 (verified) — FIXED on `fix/review-2026-09-01-p1s`.** The >5% quality gate is dead for any `lead_days`-shifted component.
  `pipeline/engine/gauge.py:98-100`: `last = max(idx)` is the *shifted* date; `_arrived_today`
  queries `obs_date = ?` with that shifted date, which no store row carries, so `arrived` is always
  False and the gate never holds. Affects `used_vehicles` (`manheim_uvvi_m`, `lead_days: 30`,
  `config/basket.json:40`). Fix: un-shift `last` per gate code before the arrival query; add a
  regression test with a +20% print arriving today.
  *Done:* `_arrived_today` now takes per-code store dates via `_store_date` (lead un-shifted);
  `tests/test_gauge.py::test_gate_fires_for_lead_shifted_component` fails on the old code.
- **A2 (verified) — FIXED on `fix/review-2026-09-01-p1s`.** `headline_current` (critical) will fail by construction 2026-11-21 → ~2026-12-10.
  `pipeline/engine/official.py:19-20` walks back to the latest month whose 12-month base exists. The
  2025-10 CPI print was never published (store has 2025-09 and 2025-11, no 2025-10), so after the
  Oct-2026 print lands (~2026-11-10) the headline month stays `2026-09-01`.
  `pipeline/publish/qa.py:43-47` measures age from that month with `STALE_DAYS = 80`: 2026-11-21 is
  day 81. Fix: measure age from the latest *print* month or the `as_of` vintage, or add an explicit
  base-hole allowance. This is the QA-side twin of the gaptable base-hole fix (todo ledger #1).
  *Done:* `official.latest_yoy` returns `latest_month` (newest print); `qa.run_checks` ages that,
  falls back to `month`, and names the hole in `detail`. Pinned by two tests in `tests/test_qa.py`
  and one in `tests/test_official.py`.
- **A3. Staleness is blind to forecast series with future `obs_date`s.** `steo_elec_ind_us` /
  `steo_power_pj` have `max_obs_date = 2027-12-01`; `qa.py:111` computes `today − latest_obs`,
  which is negative, so STEO can die for a year unnoticed. Fix: registry flag for forecast-shaped
  series; compare against `MAX(vintage_date)` for those.

### P2 — robustness and operations

- **A4. `max_staleness_days` below real cadence → chronic false stale flags.** TDSP 210 (quarterly,
  ~6-month lag; 243 d today), SAHMREALTIME 60 (peaks ~65 d monthly), REVOLSL 80 (92 d today),
  `ppi_storage` 80 (92 d). Internal inconsistency: `qcew_aemp23_c41067` = 400 vs siblings 900.
  Adjacent to todo #10 but these are concrete limit corrections.
- **A5. `daily.yml` pushes without rebasing.** `.github/workflows/daily.yml:71-72`; a human merge
  during the ~10-min run rejects the push and the day's publish is lost until the backup cron.
  `fetch-depth: 50` also bounds the once/day gate's history. Fix: `git pull --rebase` + retry loop;
  gate over `--since=midnight`.
- **A6. Dependencies unpinned and re-resolved on every daily run.** `pyproject.toml` has `>=`
  floors only; `daily.yml:56` installs fresh. Fix: a lock file used by both workflows.
- **A7. Ten schemas lack `additionalProperties: false` and some have untyped interiors**
  (`fuel, heatcheck, stress, recession, nextprint, releases, backtest, accountability, longlead,
  dc_markets`); e.g. `heatcheck.groups: {"type":"object"}`, `backtest.rows.items` has `required`
  but no property types.
- **A8. Entry-splice scale anchors on a source's single first observation** (`blend.py:43-46`);
  a glitchy first scrape permanently mis-levels the blend and the gate cannot catch it.
  Fix: anchor on the first-month mean; reject entries whose implied scale is >5% off.
- **A9. Unregistered series pass silently into the store** (`collect.py:211`
  `id_map.get(code, code)`). Fix: drop-and-warn on unmapped ids.
- **A10. `col` variant freshness checks the wrong sources** (`gauge.py:131-133` uses
  `c.live_blend` while shelter_owned rides `zhvi_us + pmms_30yr/mnd_30y_d`). Fix: reuse `gate_codes`.
- **A11. BLS quota rejections surface as `KeyError: 'series'`** (`connectors/bls.py:28`).
  Fix: check `status`/`message` first.

### P3 — hygiene

- **A12.** Seven re-implementations of month/YoY/round/series helpers: `_round` in
  `publish/official.py:36`, `publish/gaptable.py:20`, `publish/geo.py:46`; `compare.py:48 _month_add`
  vs `dates.months_back`; `dcmarkets.py:67 _year_ago` + `composites.py:36 _yoy` vs
  `publish/util.yoy_pct`; `_series`/`_arrived_today` in `dcindex.py:45,49`, `gauge.py:17,21`,
  `publish/dc_markets.py:40`.
- **A13.** `collect.py:42-143` — 25 near-identical connector wrappers; a table would do.
- **A14.** `run_daily.main` ~370 lines; `staleness` rebuilt at `:131, :289, :409`,
  `registry_codes` at `:355, :368, :384, :401`.
- **A15.** `phase3.record_forecasts` re-parses the whole store (`phase3.py:72`) and the value
  dedupe understates forecast `as_of`.
- **A16.** `generated_on` uses machine-local `date.today()` (`nowcast/models.py:209,224`).
- **A17.** `qa.py:7 STALE_DAYS = 80` duplicates `CPIAUCNS.max_staleness_days`.
- **A18.** `run_daily.py:92` hard-codes `FRED_API_KEY` while the registry declares secrets.
- **A19.** `aaa_wk_avg` is the last 7 *observations*, not 7 days (`run_daily.py:125`).
- **A20.** CI: no pip cache, no ruff/mypy, Playwright browsers re-downloaded every run.
- **A21.** Store growth is ~70% Zillow re-publishing its full revised history monthly
  (`vintage.py:59` value-equality dedupe); optional tolerance dedupe.
- **A22.** Doc drift: CLAUDE.md test counts (851 → 873; 47 → 48 e2e).

## B. Site code

### P1

- **B1 (verified). `/supercore`'s dashed 2% reference line never renders.** `EChart.tsx:13-21`
  registers no `MarkLineComponent`; `StepChart.tsx:30` sets `markLine`. ECharts drops it silently in
  production, so the zero-console-errors gate cannot catch it.
- **B2 (verified). Runtime-fetching charts have no failure state.** `Treemap.tsx:66-69`,
  `CalculatorClient.tsx:18-21`, `MyInflationClient.tsx:85-88`: no `r.ok` check, `.catch` sets
  `null`, so a 404 leaves "loading…" forever. Only `QuiltHeatmap` has a `failed` flag. Fix: one
  `useJson<T>(url)` hook with `ok`/`failed`/abort.

### P2

- **B3 (verified). `GradesClient.tsx` (672 lines) is `"use client"` with zero hooks or handlers**;
  drop the directive and the ~56 kB prop payload and page JS disappear.
- **B4. ECharts is statically imported on 10 routes**, tripling First Load JS (103 → 311–320 kB).
  `next/dynamic(() => import("./EChart"), { ssr: false })` in one place.
- **B5. `/calculator` fetches all of `gauge_daily.json` (818 kB) for two arrays**; pass props like
  `/escalation` does.
- **B6. `replay.json` (1.24 MB) is fetched on `/` and `/my-inflation`; `bls_index` (28%) is read by
  nobody.**
- **B7. `methodology.html` is 762 kB**: 693 rows × 5 inline style objects, then the array serialized
  again into the RSC payload. Move styles to classes.
- **B8. Hand-written JSON types drift**: 7 `as unknown as X` double-casts (`datacenter/page.tsx:35`,
  `longlead:8`, `capacity:7`, `markets:8`, `escalation:32`, `dc-scoreboard:14`);
  `page.tsx:203` casts to read an undeclared field. Generate types from `schemas/*.schema.json`.
- **B9. ECharts options are `Record<string, unknown>`** (`EChart.tsx:31`); use `ComposeOption`.
- **B10. `pair()` copy-pasted in 6 chart wrappers; PNG-export hack duplicated in two.**
- **B11. Active-chip styling triplicated** despite `SegmentedControl` existing (`Treemap.tsx:188`,
  `MethodologyInventory.tsx:18`).
- **B12. Two chart palettes**: `chartTheme.ts` vs `#5eb0ef`/`#f4c64a` in `capacity/*`; no test pins
  `C` to `globals.css`.
- **B13. `Section` titles are `<div>`s; the homepage has no heading at all.**
- **B14. Status encoded by colour only** (`StatusPill`, `MethodologyInventory` dots,
  `SegmentedControl` without `aria-pressed`).
- **B15. Every ECharts canvas and SVG sparkline is unlabeled** (no `role="img"`/`aria-label`).
- **B16. `<main>` wraps header, nav and footer** (`PageShell.tsx:11-58`); no skip link, no `.sr-only`.
- **B17. No OpenGraph/Twitter metadata, `metadataBase`, robots or sitemap**; live-number titles
  already exist and go unused for OG.
- **B18. `QuiltHeatmap` re-fetches `compare.json` the page already baked** — two vintages can
  disagree after a deploy.

### P3

- **B19.** Raw `<a href="/…">` internal links in 8 files (14 occurrences).
- **B20.** `tsconfig` lacks `noUncheckedIndexedAccess`; `supercore/page.tsx:17-19` can throw at
  build on an all-null series.
- **B21.** vitest: no tests for `heat.ts`, `stateTiles.ts`, `indicatorLabels.ts`, `chartTheme.ts`,
  `nav.ts`, `quiltPng.ts`, `geobase.ts`; no component rendering tests.
- **B22.** e2e route list is hand-maintained (nothing asserts `NAV` ⊆ routes) and never asserts a
  chart painted.
- **B23.** `playwright.config.ts` has no `retries`/`trace`.
- **B24.** Loading placeholders don't reserve chart height (layout shift).

## C. UI/UX (production walk; screenshots in the session scratchpad, mockups on the canvas)

1. **Mobile nav never collapses**: 265 px header (31% of viewport) on every page, 28 px targets, not
   sticky. → sticky 56 px header + 44 px menu button + accordion sheet.
2. **No landing for the Project Controls audience**: nothing above the fold mentions data centers;
   `/datacenter` has no in-page path to `/escalation`, `/markets`, `/capacity`, `/longlead` until
   ~7,000 px down. → second header pill "DC BUILD +9.2%", 4-card toolkit row atop `/datacenter`,
   rename nav "Data" → "About".
3. **Home fold**: five equal tiles in five colours, no h1, tagline only in the footer, the
   "Cost of Living" spike dominates the chart. → one 56 px Macrogauge tile with the gap as its
   sub-line, comparators at half weight, tagline promoted to an h1 lede, 24-month default window.
4. **Two page widths** (1200 vs 1720 on home) make the site jump between routes. → one shell.
5. **KPI tiles size to content** (orphaned 4th tile on `/capacity`, ragged mobile widths).
   → `repeat(auto-fit, minmax(220px, 1fr))`.
6. **Header self-test pill is red for an advisory miss on every page.** → amber for advisory,
   red only for critical, and say "1 advisory".
7. **Tables clip inside scroll containers with no affordance on 8 of 10 pages**; `/capacity`
   overflows by 5 px and its stacked bar collapses to a sliver on mobile. → edge fade + hint;
   mobile capacity row with full-width bar and note behind a disclosure.
8. **Number/date formatting inconsistent within single tables** (`$2,559` / `$1,746.21` / `$1,928.3`;
   `4403.20 $/oz` vs `$40.10T`; four as-of formats). `/my-inflation` shows "3.0% vs 3.0%, 0.05pp
   hotter". → fixed decimals per column, unit suffixed, ISO dates in tiles.
9. **Browser-default blue links** on `/longlead` and `/datacenter` (~2.3:1 contrast). → global `a`.
10. **Type floor**: 9–10.5 px tracked uppercase for load-bearing labels. → 11 px floor.
11. **Colour on every cell** in `/outlook`, `/commodities`, home components table removes
    hierarchy. → colour only past a threshold.
12. **Line length** ~190 characters on methodology prose. → `max-width: 72ch`.
13. **`/methodology` is 30,692 px** with the full 693-row inventory. → paginate or collapse per source.
14. Focus ring only on nav elements; charts without text alternatives; no `color-scheme` meta.

## D. Suggested order

1. A1, A2 (before 2026-11-21), B1, B2 — small fixes, real defects.
2. A5, A6 — daily-run resilience.
3. B3, B4, B5 — three edits that remove most of the client payload.
4. C1, C2, C3, C5, C6 — the canvas artboards, in that order.
5. B8 + B9 — generated types close the drift class behind B1 and the seven double-casts.
6. A4, A3, A7 — staleness limits and schema closure.
7. Everything else as hygiene passes.
