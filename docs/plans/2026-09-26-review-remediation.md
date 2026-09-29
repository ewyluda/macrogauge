# Review remediation — 2026-09-26

Follow-up to the 2026-09-25 comprehensive review (seven parallel reviewers; findings delivered
in chat). Work landed in suggested order: date bombs and silent breakage → calculation errors →
methodology → value-adds. This file records what shipped and what is still open.

## Shipped

### Tier 1 — date bombs and silent breakage (`fix/ops-sources-2026-09-26`)
- Publish gate → `pipeline/publish_gate.py` (tested); window 8:00–21:59 ET; gate fast-forwards to
  origin/main; extra backup cron; `repository_dispatch: daily` hook; ubuntu-24.04; 30-min timeout.
- Critical-QA step turns the daily run red; `watchdog.yml` + `pipeline/watchdog.py` fail nightly when
  the last closed weekday has no publish (2026-08-28 went unnoticed).
- Release calendar self-refreshes from FRED `release/dates` (CPI/PPI/PIO/Empsit) into
  `store/calendar/releases.json`; `next_target` infers the month past the calendar;
  `calendar_horizon` qa; release-day guard covers PCE/NFP; `feed.xml` null guard (the 2026-12-11
  build break).
- Manheim: "(MUVVI) in August was 208.2" phrasing + two-month re-read (self-heals a missed final).
- Apartment List: CSV link discovered from the research page (pin kept as a loud fallback).
- Staleness limits to natural cadence; intermittent policies (vast B200/H200, BLS OJ); SFCOMPUTE
  retired (registry `retired`); PCEPI relabelled SA.
- Canonical origin `macrogauge.vercel.app` (the `-cloudten` alias is served `noindex`), self-canonical
  on every page, sitemap includes `/components/*`.

### Tier 2 — calculation errors
- Scoreboard actuals = change as the release reported it (payrolls Aug +162k, not +217k).
- ALFRED vintages for PCEPI/PAYEMS (real first prints on /revisions, /releases); "change first" fixed.
- Pending forecasts list every call awaiting its print (the Aug PCE call was hidden).
- GDPNow tile (update date + real 30d change); recession claims ratio + per-signal as_of.
- Site (`fix/site-calc-2026-09-26`): calendar-month momentum lookback + NSA notes; /portfolio share
  links; WCAG text-on-heat helper; en-US locale; control names; empty states; supercore/component
  labels; stale-phase banner; lazy CSV export (/rates 820 kB → 341 kB).
- DC (`fix/dc-calc-2026-09-26`): proxy tail anchored on the reference-month mean (Build 9.48 → 9.29,
  Hardware 35.68 → 33.24); escalation measures to the last complete month; chain-linked compute
  indexes (GPU 30d +12.9% → +3.2%) and date-joined CSV; curated `energize_q` for the capacity timeline
  (15 sites moved); roster count, Kalshi label, combined-EV tile.

### Tier 3 — methodology
- Weights = BLS relative importance (`config/cpi_relative_importance.json`, Dec 2016–2025) price-updated
  to the YoY base month; "other" = exact CPI residual (`pipeline/derived.py`). Aug-2026 reconstruction
  3.34 vs actual 3.40 (seed weights: 3.58). Headline moves ~3.42 → ~3.15–3.18.
- EIA electricity/gas `live_method: year_ratio` (official where printed; like-month tail after).
- SA nowcast (CPIAUCSL/CPILFESL factors), SA grading, PCE bridge on SA CPI; shelter rows from official
  OER/rent trend; "benchmark error scale" relabel. Coverage floor 40 → 35.

### Tier 4 — value-adds
- Core CPI nowcast + Cleveland core + Kalshi `KXCPICORE` benchmarks, core ensemble on /cpi-preview.
- Head-to-head leaderboard (SA, first release) on /scoreboard; inverse-MAE ensemble weights once each
  forecaster has 6 graded prints.
- Frozen per-component calls + "Last print — forecast → result" with miss attribution.
- Matrix: flexible core CPI, core PCE, China import prices, core goods CPI, 5y5y, Cleveland 1y/10y
  expectations, ECI, unit labor costs.
- Multi-item RSS (ledger); methodology changelog + `methodology_version`; scoped /data licence.
- Ops: FRED 5xx retry, PMMS drift guard, release-day target, absence `since`, security headers,
  CI on publishes, Dependabot, next 15.5.26.

## Still open

_2026-09-29: external scheduler DONE — cron-job.org → `repository_dispatch` Mon–Fri 8:45/10:45/13:45 ET
(fine-grained PAT `macrogauge-scheduler`, Contents r/w, expires ~2027-09; renew before then).
GitHub crons remain the fallback._

### Needs the owner (accounts, money, or a decision)
- Custom domain + analytics (Vercel Web Analytics or Plausible) — product decisions.
- Email / release-morning alerts (Buttondown or Resend account).
- About / corrections page (owner name, contact, corrections policy).
- Source-licensing register: per-source terms review (FMP, TrendForce/DRAMeXchange, MND, Manheim,
  AAA, Zillow, OpenRouter, Vast) before any growth push. The /data licence is now scoped, not audited.

### Engineering backlog — status 2026-09-29 (branch `feat/backlog-2026-09-29`)
Done:
1. DC curation — PJM 2028/29 ($325), CBRE H1 2026 ($204.69/kW-mo, 7.48 GW), long-lead Q2
   (Hitachi $63.6B, Eaton +33%/1.2, CAT $72.1B; Vertiv stopped disclosing backlog after Q4 2025),
   ORCL FY27 Q1 (RPO $664B, nd ≈ $89.0B, +850 MW).
2. Vintage-true history — `compare.realtime` (ledger + first-release reconstruction); homepage
   lead-lag on it (0.951).
3. PCE nowcast on the PCE calendar, actual SA CPI once printed, PPI→PCE bridge (4 BEA-input PPIs,
   used only when it beats CPI-only out of sample), core PCE nowcast + official core PCE.
4. Time-varying price-updated weights through history, per-month weights in replay/quilt, site
   contribution parity per date (max 0.007pp).
5. Storage tail gated by a backtest (INSUFFICIENT until ~2027-08 → official-only; Hardware ≈ 29%);
   Heat Check on SA inputs; supercore graded vs BLS services less rent of shelter (+ energy services);
   Manheim double count; like-month gate for year-ratio tails.
6. Homepage reconciliation strip, outlook caveat, 2-dp tiles, labelled gas, /gap vs each variant's own print.
7. a11y B14/B15/B16, schema-generated TS types (B8, drift guard), next/link everywhere (B19).
8. vast.ai banded queries past the 64-offer cap + B300.
9. Kalshi KXFED market-implied Fed path on /rates; effective tariff rate; NY Fed GSCPI + MCT.
10. Distribution — per-page OG cards, SVG badges, /grocery/[item], /states/[st], /metros/[m].
11. DC — official-only Build series, monthly CSV, P80 contingency, PA/NC/DE/KS multipliers on own
    latest quarter, price-adjustment clause kit (/escalation/clause).
12. Ops — actions pinned by SHA, persist-credentials false, push token only in the commit step.

Still open (deliberately small or blocked):
- NY Fed SCE, Atlanta BIE (not on FRED; need connectors), euro-area HICP (placement decision).
- S-curve midpoint escalation, Census M3 backlog months, NAICS 238210 electrical-contractor labor.
- Storage-tail λ needs ~12 months of NAND history (≈2027-08) before the gate can pass.

### Calendar
- 2026-10-14 CPI: first SA-graded print; first component miss attribution on /cpi-preview.
- 2027-01 (BLS mid-January): add the December-2026 relative-importance table and move
  `weights_as_of` (tested: `test_weights_match_latest_bls_relative_importance`).
- `review_by` 2027-01-15 (BLS OJ, bread, pork chops); 2027-03-31 (vast, SFCOMPUTE, QCEW policies).
