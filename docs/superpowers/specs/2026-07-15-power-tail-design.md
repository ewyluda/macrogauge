# Power Tail Design — wholesale nowcast on DC Ops + power panel (Wave 4)

**Status:** Approved 2026-07-15 (brainstorming session; decisions: multi-hub keyless feeds,
7-day trailing-mean smoothing). Follows waves 1–3a (all deployed through f3d1426).
**Inputs:** 2026-07-15 enhancement research (CAISO OASIS keyless zip verified live; MISO
marketreports CSV verified w/ ~2023+ retention; EIA ICE XLSX parsed, 7 hubs, 2001+; no EIA v2
daily wholesale route exists — re-verified); wave-3a machinery this wave rides:
`splice_anchored` + tail-scoped gate + the honest `tail_active` mode label (dcindex), openpyxl +
census xlsx parse pattern, per-source isolation keys.

DC Ops' dominant component (power, 0.55 weight) rides EIA retail industrial ¢/kWh at a ~75-day
lag — the stalest number on `/datacenter`. This wave gives it a **smoothed wholesale nowcast
tail**: the exact copper-futures architecture (anchored splice, gate, honest label), fed by two
keyless daily hubs, plus a "power bill" panel with national hub breadth and the PJM
capacity-auction story.

**Correction from the design discussion (recorded honestly):** the proxy backfill does NOT need
366 days for YoY. Component YoY at own-last-obs on a spliced series takes its base from the
official retail territory of the series (the 2025-xx retail prints are genuine obs, satisfying
`yoy_at_obs`'s month check). The backfill requirement is only **splice overlap**: ≥1 proxy
observation at/before the last official retail print (2026-04-01 today), plus margin. Backfill
from **2026-01-01** (~6.5 months) covers overlap with two prints of slack.

## 1. Scope

**In scope (wave 4):** three keyless connectors (CAISO, MISO, ICE) + one existing-key series
(Henry Hub under a new `EIA_SPOT` isolation key); the blended-smoothed proxy machinery in the
engine (config-driven, pure); the ops power component's live tail; a `power` block in
`datacenter.json` + "The power bill" panel on `/datacenter`; the one-word mode-label fix
("futures tail" → "live tail"); one-time backfill.

**Out of scope:** `accountability_power` artifact/page — **deferred to its own small wave
(~October)** when 2–3 STEO vintages make rows gradeable (vintages already collecting since 3a;
an all-pending section today adds nothing). PJM DataMiner2 / Dominion-zone feed (needs a
user-registered key — revisit on request). Retail-rate modeling of any kind: the tail is an
input-price *nowcast*, labeled as such.

## 2. Decisions locked in brainstorming

1. **Multi-hub keyless:** CAISO SP15 + MISO Indiana Hub as the daily tail (equal-weight mean);
   EIA's ICE workbook supplies East/Texas breadth for the display panel and deep history —
   panel-only, never the splice proxy (biweekly cadence, different product: trade-weighted
   averages vs DAM LMP).
2. **7-day trailing mean:** raw daily hub prices stored untouched (auditable); the engine
   splices a 7-day trailing mean, so the >5% gate trips on sustained moves, not single spike
   days. Methodology labels it a "smoothed wholesale nowcast."
3. **Blend is engine config, not a stored series:** derived values are never written to the
   store as if observed. `DCComponent` grows optional `live_proxy_blend` +
   `live_proxy_smooth_days`; the transform is a pure, tested engine step.
4. **Negative prices are real** (curtailment hours; occasionally negative daily means in spring):
   plausible ranges must admit them — (−100, 3 000) $/MWh on daily means.

## 3. Sources & series

**No invented identifiers:** node ids, hub labels, CSV/zip layouts, and the RNGWHHD seriesid
alias below are candidates pinned by the research; **implementation task #1 is a verification
spike** (live fetches, trimmed fixtures into `tests/fixtures/`, final strings + observed values
in `docs/superpowers/specs/2026-07-15-power-spike-notes.md`).

### 3.1 `CAISO` — SP15 day-ahead LMP (keyless zip/CSV)

`GET https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=<D>T07:00-0000&enddatetime=<D+1>T07:00-0000&version=1&market_run_id=DAM&node=TH_SP15_GEN-APND&resultformat=6`
(verified live: HTTP 200, `application/x-zip-compressed`, one CSV inside with hourly rows).
Connector: unzip in memory (stdlib `zipfile`), filter `LMP_TYPE == "LMP"`, average the hourly
`MW` values ($/MWh) into one observation per trade date. DST days legitimately have 23/25
hours — accept 20–28 rows, else drift error.

| code | series | staleness |
|---|---|---|
| `caiso_sp15_da` | daily mean DAM LMP, TH_SP15_GEN-APND | 7 |

Drift checks: zip contains ≥1 CSV; required columns present (spike pins exact header names:
`INTERVALSTARTTIME_GMT`, `LMP_TYPE`, `MW` candidates); hourly-row count in [20, 28]; daily mean
in (−100, 3 000). OASIS throttles aggressive clients: the daily run makes ONE request; the
backfill script sleeps ≥5 s between windows (§8).

### 3.2 `MISO` — Indiana Hub day-ahead ex-post LMP (keyless CSV)

`GET https://docs.misoenergy.org/marketreports/YYYYMMDD_da_expost_lmp.csv` (verified live:
one ~1.3 MB CSV per market day, available next day; retention probed to ~2023+). Wide format:
2 header lines, node rows with HE1–HE24 columns. Connector: locate the row whose node column is
the spike-pinned Indiana Hub label (candidate `INDIANA.HUB`), average HE1–HE24.

| code | series | staleness |
|---|---|---|
| `miso_indiana_da` | daily mean DA ex-post LMP, Indiana Hub | 7 |

Drift checks: hub row present (by label, never row index); 24 parseable HE values (DST files
carry HE structure per MISO convention — spike verifies an actual DST date's shape and pins the
accepted range); daily mean in (−100, 3 000). A 404 for today's file (holiday/weekend market
calendar) is a skip, not an error — carry-forward absorbs it; any other HTTP error propagates
to the isolation boundary.

### 3.3 `ICE` — national hub breadth (keyless XLSX, panel-only)

`https://www.eia.gov/electricity/wholesale/xls/ice_electric-2026.xlsx` (parsed in research:
daily trade-date rows, 7 hubs, wtd-avg $/MWh; file updated ~biweekly, observed lag ≤8 days).
Reuses openpyxl + the census-style parse conventions (header row by name, hub column by label,
footer stop, range checks). Current-year file only; history accrues in the store.

| code | candidate hub label | staleness |
|---|---|---|
| `ice_pjm_west` | `PJM WH Real Time Peak` | 21 |

Panel-only: **never a splice proxy** (cadence + product mismatch, §2.1). Pinned: `source_id` =
the hub label; the connector derives the current-year URL from the run date (year rollover
happens automatically each January; the prior-year final file is NOT refetched — its history is
already in the store by then).

### 3.4 `EIA_SPOT` — Henry Hub daily spot (existing key, zero connector code)

New isolation key mapping to `_eia` (the STEO/EIA_STATE precedent — one bad series id must not
fail the core `EIA` row): `eia_henry_hub` ← seriesid `NG.RNGWHHD.D` (spike-corrected: the bare
`RNGWHHD` id 404s on the seriesid route; the prefixed daily id works through `eia.fetch`). Staleness 7 (daily, ~2-day lag + weekends). Panel driver
card; also future 3b/4b regressor material.

**Registry arithmetic:** sources 22 → 26 (`CAISO`, `MISO`, `ICE`, `EIA_SPOT`); series 265 → 269
(4 new: `caiso_sp15_da`, `miso_indiana_da`, `ice_pjm_west`, `eia_henry_hub`; `ice_ercot_north` was
dropped by the spike — the hub does not exist in the ICE workbook).
FRED 73 untouched.

## 4. Engine — blended, smoothed proxy (config-driven, pure)

- `pipeline/dc_basket.py`: `DCComponent` gains `live_proxy_blend: list[str] | None = None` and
  `live_proxy_smooth_days: int | None = None`. Loader validation: blend codes must exist in the
  registry; `live_proxy` and `live_proxy_blend` are mutually exclusive; `smooth_days` requires
  `blend` (v1 keeps smoothing off the single-proxy path — copper stays raw); blend list must be
  non-empty when present.
- `pipeline/engine/blend.py`, two new pure functions:
  - `hub_mean(series_list: list[dict]) -> dict` — per-date equal-weight mean over the series
    that HAVE that date (one hub missing a day → the other carries; no date where none have
    obs).
  - `trailing_mean(series: dict, days: int) -> dict` — for each obs date d, the mean of the
    values at obs dates within the calendar window [d−days+1, d] that exist in the series.
    (Calendar window over present obs — weekends/gaps shrink the sample, never fabricate.)
- `pipeline/engine/dcindex.py`: where the component loop builds `live`, a blend component gets
  `live = trailing_mean(hub_mean([...]), smooth_days)`; everything downstream — rebase,
  `splice_anchored`, tail-scoped gate, `tail_active` mode label — is byte-identical to the
  single-proxy path. `_arrived_today` extends to blend components: the tail's last obs "arrived
  today" if ANY blend series has a row for that obs date with vintage == today.
- `config/dc_basket.json` ops power component gains
  `"live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"], "live_proxy_smooth_days": 7`.
- Effects, stated: ops `as_of` moves from the retail print (~75 d stale) to the tail end
  (~1 d); the ops headline and power component mode (`official+proxy`, labeled "monthly + live
  tail") flip on as soon as the backfill lands; gate flags on sustained >5% moves in the
  smoothed tail surface as the existing amber badges.

## 5. Publish — `power` block in `datacenter.json`

Nullable top-level `power` (schema-pinned like `construction`; null before first collect):

```json
{"tail": {"active": true, "smooth_days": 7,
          "hubs": ["caiso_sp15_da", "miso_indiana_da"]},
 "hubs": [{"code": "caiso_sp15_da", "label": "CAISO SP15 (day-ahead)",
           "latest": 44.7, "asof": "2026-07-14", "unit": "$/MWh"}, …4 rows],
 "henry_hub": {"latest": 2.83, "asof": "2026-07-13", "unit": "$/MMBtu"},
 "capacity_auction": [{"delivery_year": "2024/25", "price_mw_day": 28.92}, …4 rows]}
```

- Hub latest/asof read from the store (latest-vintage-wins); `tail.active` = the engine's
  `tail_active` for the power component (single source of truth — passed through, not
  recomputed).
- `capacity_auction` is hand-seeded config (`config/dc_power.json`, loaded + validated like the
  BEA-shares precedent): the four PJM BRA results verified in research
  (28.92 / 269.92 / 329.17 / 333.44 $/MW-day, delivery years 2024/25–2027/28) with a
  `source` note field; updated by hand after each auction (~annual).
- Values rounded 2 dp; payload ~1 KB.

## 6. Site page

1. **"The power bill" panel** on `/datacenter`, after the construction section: three hub stat
   cards (two live daily, one ICE with its as-of date visibly older — honesty by dates),
   a Henry Hub card, and the capacity-auction mini-table with its ~800%-in-two-auctions story
   line. Rendered only when `dc.power` is non-null.
2. **Ops table label fix:** the `ComponentTable` ternary `"monthly + futures tail"` becomes
   `"monthly + live tail"` (now covers copper/aluminum futures AND wholesale power; the
   methodology names which proxy each component uses).
3. **Methodology paragraph** extension: smoothed wholesale nowcast (7-day trailing mean of
   SP15 + Indiana Hub, anchored to the retail print, re-anchored every print), why wholesale is
   an input-price nowcast for a retail series (marginal-cost signal, ~3× volatility, bounded by
   anchoring — the copper-futures argument verbatim), ICE hubs panel-only, negative-LMP note.

No new routes; e2e count unchanged.

## 7. Testing

House conventions: CAISO zip fixtures BUILT in-test (stdlib zipfile wrapping a spike-shaped
CSV); MISO fixture = spike-trimmed real CSV (hub row + a few neighbors, both header lines);
ICE fixture generated in-test via openpyxl (census pattern). Per-connector drift tests (each
check), DST row-count acceptance, MISO-404-today skip, negative-mean acceptance inside range.
Engine: `hub_mean` (one-missing/both-present/none), `trailing_mean` (window shrink at edges,
gap handling), dcindex blend-component worked example (blend → smooth → splice → gate label),
loader mutual-exclusion validation. Publish/schema: null + populated `power`. Pins: sources 26,
series 271; e2e fake branches for the three new hosts. `test_dc_basket` real-config assertion
extends to the ops blend fields.

## 8. One-time backfill

`scripts/backfill_power.py` (checked in; FMP gold/WTI launch-backfill precedent): CAISO
windowed requests (spike pins the max window; ≥5 s sleep between requests) and MISO daily files
(≥1 s sleep), both from **2026-01-01**, through the normal connectors with
`vintage_date=today`, appended via `vintage.append` (value-dedupe makes reruns no-ops).
Controller-executed once before the site task; ~200 polite requests total. ICE needs no
backfill (current-year file carries 2026 history on first fetch).

## 9. Risks, ranked

1. **OASIS quirks** — throttling, maintenance windows, zip-format oddities; mitigated by
   one-request-per-day cadence, drift checks, isolation; a missed day is carry-forward.
2. **Wholesale↔retail concept gap** — the tail nowcasts a retail series with a wholesale
   signal; bounded by the anchored splice (influence confined to the ~2-month tail,
   self-corrects every print) and stated plainly in methodology. The 7-day mean further damps
   basis noise.
3. **MISO retention** — missed backfill days beyond the window are unrecoverable from this URL;
   irrelevant at 2026-01-01 scope (well inside retention).
4. **DST/day-boundary edges** — 23/25-hour days, MISO holiday 404s; handled by accepted-range
   row counts and skip semantics, each pinned by a test.
5. **ICE hub-label drift** — census-class, drift-checked, panel-only blast radius.
6. **Capacity-auction staleness** — hand-seeded annual data; the block carries an `asof`/source
   note so a missed update reads as dated, not wrong.

## 10. Post-implementation finding (2026-07-15, recorded before first deploy)

The live activation run FAILED the sanity gate: ops headline YoY jumped +6.2% → +52.3% (power
component +89%). Root cause is a design flaw in §2's mechanism for THIS series pair, not an
implementation bug: the smoothed hub composite swings ~2.8× from spring anchor (~18–25 $/MWh)
to mid-July (~54 $/MWh) on ordinary seasonality plus a heat event, and the anchored LEVEL
splice maps that swing onto a retail series that is tariff-smoothed and seasonally flat
(9.29 → 8.66 ¢/kWh over the same months). The copper→PPI analogy does not transfer: those two
series share (no) seasonality; wholesale and retail power do not. The 7-day smoothing keeps
daily moves under the 5% gate, so nothing tripped.

**Decision (user-approved): Option B.** The index tail is DEFERRED — `live_proxy_blend` removed
from the ops power component (commit 09b4c2a); the power panel, capacity table, all four
connectors, the backfill, and the blend engine machinery (config-gated, fully tested) ship as
built. `power.tail` publishes `{active: false, smooth_days: null, hubs: []}` honestly.

**Queued as the next spec ("year-ratio nowcast"):** couple wholesale to the index
like-month-to-like-month — `retail_nowcast(t) = retail_filled(t−365d) × W(t)/W(t−365d)` — the
house YoY philosophy applied to the proxy transform, which cancels seasonality by construction.
Requirements already scoped: ~12 further months of hub backfill (both sources' history reaches,
spike-verified), a new pure engine transform with its own gate semantics and gap handling, and
honest methodology on partial/lagged wholesale→retail pass-through.
