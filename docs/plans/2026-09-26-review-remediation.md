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

### Needs the owner (accounts, money, or a decision)
- External scheduler for `repository_dispatch` (cron-job.org / Cloudflare Worker + a fine-grained
  token with Actions write on this repo) — the hook is live; GitHub crons remain the fallback.
- Custom domain + analytics (Vercel Web Analytics or Plausible) — product decisions.
- Email / release-morning alerts (Buttondown or Resend account).
- About / corrections page (owner name, contact, corrections policy).
- Source-licensing register: per-source terms review (FMP, TrendForce/DRAMeXchange, MND, Manheim,
  AAA, Zillow, OpenRouter, Vast) before any growth push. The /data licence is now scoped, not audited.

### Engineering backlog (ranked)
1. **Hand-curated DC data refresh:** PJM 2028/29 BRA (cleared 2026-07-14, $325/MW-day) in
   `config/dc_power.json`; CBRE H1 2026 in `dc_context.json`; long-lead Q2 pass (VRT, Hitachi, ETN,
   CAT); ORCL FY27 Q1 (RPO $664B, net debt ≈ $88.9B, +850 MW).
2. **Vintage-true gauge history:** replay `as_of` so compare/lead-lag stats and the homepage
   correlation stop using hindsight (monthly rows applied ~6 weeks pre-release).
3. **PCE nowcast keyed to the PCE calendar** (target the next PIO release; use the actual CPI once
   out) and a PPI→PCE bridge (airline, physician, hospital, portfolio-management PPIs).
4. **Time-varying weights through history** (per-month price-updated RI) with per-month weights in
   replay.json so site contributions keep exact parity.
5. **NAND spot → storage PPI**: pass-through factor + backtest gate, as the power tail has.
6. **Heat Check on SA inputs**; supercore definition (the residual is 49.5% "other"); Manheim
   double-count in the outlook; seasonal gas gate misfires.
7. **Homepage reconciliation strip** (official → reconstruction → ours), outlook caveat, one-decimal
   tile precision, labelled gas prices, /gap supercore + PCE gaps.
8. **a11y backlog** B14 (colour-only source status), B15 (chart text alternatives), B16 (landmarks,
   skip link); B8 schema-generated TS types; B19 raw internal links.
9. **vast.ai coverage:** ordered/paginated queries (server caps at 64 offers), add B300.
10. **New measures:** Kalshi `KXFED` market-implied Fed path on /rates; effective tariff rate
    (customs duties ÷ goods imports); NY Fed SCE/GSCPI/MCT; Atlanta BIE; international HICP.
11. **Distribution:** per-page OG cards, embeds/badges, programmatic long-tail pages
    (`/grocery/[item]`, `/states/[st]`, `/metros/[m]`).
12. **DC audience:** price-adjustment clause kit on official BLS PPIs; official-only Build series for
    contract indexation (P8); S-curve midpoint escalation; P80 contingency; Census M3 backlog months;
    NAICS 238210 electrical-contractor labor by market; PA/NC build multipliers.
13. **Ops hardening:** pin actions by SHA, `persist-credentials: false`, token scoped to the commit step.

### Calendar
- 2026-10-14 CPI: first SA-graded print; first component miss attribution on /cpi-preview.
- 2027-01 (BLS mid-January): add the December-2026 relative-importance table and move
  `weights_as_of` (tested: `test_weights_match_latest_bls_relative_importance`).
- `review_by` 2027-01-15 (BLS OJ, bread, pork chops); 2027-03-31 (vast, SFCOMPUTE, QCEW policies).
