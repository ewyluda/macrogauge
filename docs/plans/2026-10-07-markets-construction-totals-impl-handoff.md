# Handoff: implement the sourced "Market pipeline" column on /markets

Written 2026-10-07, at the end of the research session. **The research is done and the
source decision is made.** This session builds the feature. Read in this order:

1. **This file.**
2. **`docs/research/2026-10-markets-construction-totals.md`**, the research report. It has
   the per-market figures, quotes, geographies and null notes, and is the source of truth for
   the config.
3. **`docs/plans/2026-10-07-markets-construction-totals-handoff.md`**, the original brief. It
   has the implementation design, rules and acceptance list, and still applies except where
   this file overrides it.

## Decisions already made (Eric, 2026-10-07): don't re-litigate

- **One source for the column: Cushman & Wakefield, *Americas Data Center Update H1 2026***.
  - Published 2026-09-14; the period ends 2026-06-30.
  - URL: https://digital.cushmanwakefield.com/americasdatacenterupdateh12026-09-2026-global-central-en-content-mrsrch-datacentres/
  - Basis: colocation plus hyperscale self-build, excluding captive and ICT. **IT vs
    facility MW is not stated**, so say so on the page.
- **Report-only sources.** These must never be on the page, because each is a different
  basis or geography:
  - CBRE (colocation-only).
  - JLL (gated).
  - The NLR county dataset.
  - Utility contracted load.
  - Loudoun square feet.
- **Keep the "Tracked AI projects" column.** The new column is additional.
- **Coverage: 15 markets with figures, 5 null notes.** The nulls are newcarlisle,
  mtpleasant, richland, memphis and councilbluffs.

## Overrides and refinements to the original brief

- **`basis` is one value for the whole column**, so it isn't needed per row. Store it once
  at the config top level, e.g. `"basis": "colo+hyperscale-self-build"` plus a
  `basis_note`.
- **Add a `fit` enum per market: `close | wider | proxy`.** It describes how C&W's region
  compares to our county set. The page must name the C&W region whenever fit ≠ close:

  | Our market | C&W region | Fit |
  |---|---|---|
  | NoVA | **Virginia (statewide)** | wider |
  | Abilene | West Texas | proxy |
  | Des Moines | Iowa, excluding Council Bluffs | wider |
  | Hillsboro | Portland + Eastern Oregon | wider |
  | San Antonio | Austin + San Antonio | wider |
  | Quincy | Central Washington | wider |
  | Chicago | Chicago | wider |
  | Atlanta | Atlanta | wider |
  | Silicon Valley | Silicon Valley | wider |

  Exact values are in the report's table.
- **Per-row figures:** `mw_uc` is the column. Also carry `mw_operating` and `mw_planned`
  from the same KEY INDICATORS box for the expanded row. Show them together but **never sum
  them**.
- **Per-row provenance:** `doc`, `doc_date` "2026-09-14", `period` "2026-06-30", `page`,
  `geography` (region name + C&W map labels), `quote` and `src` URL.
  - **Quotes:** copy verbatim from the report's table. The text layer has spacing artifacts
    such as "39,340M W" and "5,52 3MW". Keep them, or normalize the spacing only; never
    change a digit.
- **Stale rule:** flag a figure stale at more than ~430 days past `doc_date` (≈ 2027-11-18).
  The badge must actually render (PR #63 F4 lesson).
- **Null notes:** each one names the sources checked; the report's "Chosen figure" table has
  the wording basis. A null must never read as 0.

## Starting state

- **Worktree:** `.claude/worktrees/markets-construction-totals-4c8c6e`.
  - Branch: `claude/markets-construction-totals-4c8c6e`.
  - Rebased on `origin/main` at `fd8dd6f`. PR #66 is merged, so there is nothing to stack on.
- **This branch already has a docs-only commit:** the research report, this handoff, and
  `docs/research/evidence/2026-10-cw-americas-h1-2026-searchtext.json`.
  - That JSON is C&W's flipbook text layer. Grep it to re-verify any quote before it goes
    into config.
  - Two-market pages (pp. 40–41) print in a different order than the text layer. The report
    already resolved attribution against screenshots, so trust the report's page/block notes.
- **Not pushed.** Approval gates still apply: Eric approves push, PR and merge.
- **Before pushing,** fetch and rebase over the daily `data: daily publish` bot commits.

## Build checklist (detail in the original brief §"Proposed implementation")

1. **Config:** `config/dc_market_pipeline.json`, schema_version 1. Keys must match
   `config/dc_markets.json`, and each market has exactly one of `figures` / `null_note`.
2. **Loader:** `pipeline/dc_market_pipeline.py`. Validate:
   - Dashed-ISO dates and https URLs.
   - The `fit` enum, and the keys against the roster.
   - Add a real-config loading test as the CI gate.
3. **Writer:** add a per-market `market_pipeline` block to `pipeline/publish/dc_markets.py`
   (a passthrough plus the computed `stale`).
   - A config error degrades the block to null. It must never fail the markets phase.
4. **Schema:** `schemas/dc_markets.schema.json`. Make `market_pipeline` optional so older
   artifacts still validate.
5. **Site:**
   - Add a sortable "Market pipeline (C&W)" column in `MarketsClient.tsx`.
   - The value reads like "7.4 GW under construction · Virginia (statewide)".
   - The stale badge and the source geography and quote go in the tooltip or expanded row.
   - Update the colSpan bookkeeping (comment above `Row`), plus `SORT_COLS`, `COL_BASIS` and
     `SortKey` in `site/src/lib/dcMarkets.ts`.
   - Update the method note.
   - Display rule: show GW only if a formatter already does that, otherwise MW as stated.
     Any rounding is presentation only; config keeps the stated MW.
6. **Tests:**
   - pytest: loader rejections, writer passthrough, stale aging.
   - vitest: the formatter.
   - e2e: **publish-gated with an explicit skip reason**. Verify it locally against an
     artifact regenerated from the store + config, then restore the committed
     `site/public/data/dc_markets.json` before committing.
7. **Docs:** extend the `dc_markets` description in CLAUDE.md and update the test counts.

## Watch-outs

- **Don't let "Northern Virginia" sit next to 7,355 MW without "Virginia (statewide)".**
  This is the most likely way the column misleads. CBRE's NoVA-only figure (2,420 MW,
  colocation only) is in the report for context but cannot be used in this column.
- **Atlanta's sources disagree and are unreconciled** (CBRE 2,882 vs C&W 1,715 MW U/C). It
  stays report-only, but the method note could say broker figures differ by definition.
- **Next refresh:** the C&W H2 2026 update, expected ~Feb–Mar 2027. Record that date
  wherever the repo tracks manual refresh dates (see memory `page-review-series-2026-10`).
