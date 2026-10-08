# Handoff: real per-market data-center construction totals for /markets

Written 2026-10-07 at the end of the /markets scorecard session (branch
`feat/markets-tightness`). This is a self-contained brief for a **new
session**. Read it top to bottom before touching code.

## The ask

Research and curate **real, sourced, per-market data-center construction
figures** (MW under construction, and inventory/operating MW where the same
source gives it) for the markets on `/markets`. Draw them from published
market reports: CBRE, Cushman & Wakefield, Gilbane and other credible sources
(see "Sources to search"). Then wire them into the DC market panel so a reader
sees each market's actual pipeline, not just the sites our AI capacity tracker
happens to itemize.

The user asked for this explicitly ("perform a research report to pull real
per-market construction totals"). Plan on two deliverables:

1. **A research report**: a table of every market × source with figure,
   definition, period, publication date, URL and verbatim quote. It also covers
   gaps and conflicts between sources. Save it under `docs/research/` (e.g.
   `docs/research/2026-10-markets-construction-totals.md`).
2. **The implementation**: a curated config, a writer passthrough, schema,
   site and tests (design below). It goes on its own branch and PR, with the
   usual approval gates (the user approves push / PR / merge explicitly).

## Why (the problem this fixes)

`/markets` (site/src/app/markets/page.tsx, site/src/components/markets/MarketsClient.tsx)
ranks 20 data-center markets on county construction-labor tightness (QCEW).
Its capacity column used to be read as each market's pipeline. In fact it is a
**join of the AI capacity tracker's hand-tagged sites** (`config/capacity.json`
→ `geo[].market`), built in `pipeline/publish/dc_markets.py::build` → fields
`sites`, `mw_construction`, `mw_operating`, `mw_planned`, `mw_secured`,
`mw_disclosed` and `sites_mw_undisclosed`. The tracker itemizes listed AI
builders' sites, not whole markets. So Northern Virginia, the world's largest
DC market, showed "1 tracked site · MW not disclosed", and several markets show 0.

The 2026-10-07 session (PR from `feat/markets-tightness`) **relabelled** that
column "Tracked AI projects" and added a coverage caveat, but did not source real
totals. The page review scorecard (claude.ai artifact KKxF8kTmXAuvQzM87iqMvh)
listed "Capacity column undermines credibility" as a /markets minus. Its fix:
"source or drop the MW-under-construction column".

**Keep the relabelled "Tracked AI projects" column.** The user decided to keep
it. The new sourced figures are an *additional* market-level column or block,
not a replacement.

## The markets (roster: `config/dc_markets.json`)

Our market = **tight core counties** (QCEW), not the metro area. Report
geographies differ (CBRE's "Northern Virginia" spans Loudoun, Prince William and
Fairfax). Record each source's own geography beside its figure; never imply it
equals our county set.

| key | Market | Our counties | Tracker today (con / op MW · sites) |
|---|---|---|---|
| nova | Northern Virginia | Loudoun, Prince William | 0 / 0 · 1 site, MW undisclosed |
| dfw | Dallas–Fort Worth | Dallas, Tarrant, Ellis | 0 / 250 · 2 sites |
| chicago | Chicago | Cook, DuPage | 0 / 0 · 1 site, MW undisclosed |
| phoenix | Phoenix | Maricopa, Pinal | 0 / 200 · 1 site |
| atlanta | Atlanta | Douglas, Fulton | 200 / 0 · 1 site |
| svl | Silicon Valley | Santa Clara | none |
| columbus | Columbus OH | Franklin, Licking | 0 / 1,221 · 3 sites |
| slc | Salt Lake City | Salt Lake, Utah | none |
| abilene | Abilene TX | Taylor | 900 / 300 · 2 sites |
| newcarlisle | New Carlisle IN | St. Joseph | 0 / 1,725 · 1 site |
| mtpleasant | Mt Pleasant WI | Racine | 0 / 400 · 1 site |
| richland | Richland Parish LA | Richland Parish | 1,440 / 0 · 1 site |
| memphis | Memphis | Shelby | 0 / 1,400 · 2 sites |
| councilbluffs | Council Bluffs IA | Pottawattamie | 0 / 500 · 1 site |
| desmoines | Des Moines IA | Polk, Dallas | none |
| cheyenne | Cheyenne WY | Laramie | 2 sites, MW undisclosed |
| reno | Reno / Storey NV | Storey, Washoe | none |
| quincy | Quincy WA | Grant | 18 planned · 2 sites |
| sanantonio | San Antonio TX | Bexar | none |
| hillsboro | Hillsboro OR | Washington | none (QCEW-suppressed market) |

Expect the broker reports to cover the **primary markets** (NoVA, DFW, Chicago,
Phoenix, Atlanta, Silicon Valley, Hillsboro/Portland, Columbus, Salt Lake, Reno,
San Antonio, possibly Des Moines and Quincy/Central Washington). The
single-campus markets (Abilene, Richland, New Carlisle, Mt Pleasant, Council
Bluffs, Cheyenne) are usually *not* broken out. For those, the tracker's
itemized campus may already be most of the market. Say so per market rather
than inventing a figure.

## Sources to search (most authoritative first)

Each figure needs a primary document: the publisher's own PDF or page, not a
news summary of it. If only press coverage is reachable, label it
`confidence: "press"` (the pattern from `config/dc_power.json` tariffs).

- **CBRE**: *North America Data Center Trends* (H1 2026, published ~Aug–Sep
  2026; and H2 2025). Gives per primary market: inventory MW, **under
  construction MW**, preleased %, vacancy, rents. The best single source.
  It may be gated; try cbre.com/insights. The report PDF is often linked from the
  press release.
- **Cushman & Wakefield**: *Americas Data Center Update* / *Global Data Center
  Market Comparison 2026* / *Data Center Development Cost Guide 2026*. Gives
  market MW operational, under construction and planned, plus $/MW build cost
  benchmarks. The build-cost-per-market figures are also useful for the
  scorecard's "power availability per market" coverage gap.
- **JLL**: *2026 Global Data Center Outlook* (Jan 6, 2026; already cited on
  /longlead for the 42-week equipment lead time). Per-market figures may be in
  the regional chapters. Also JLL's North America Data Center Report (mid-year).
- **Gilbane**: *Construction Market Outlook / Data Center Market Report*. Gives
  construction-cost and labor commentary, possibly market pipelines.
- **datacenterHawk**, **Structure Research**, **DC Byte**, **Synergy**: often
  quoted market MW figures. Usually paywalled, so use what is publicly stated
  and cite it.
- **Utility / ISO filings** for single-campus markets: e.g. Dominion's
  contracted DC load (already in `config/dc_power.json` tariffs: "53.8 GW
  contracted"), Entergy Louisiana (Hyperion), AEP Ohio (Columbus). These are
  load figures, not construction MW. If used, they are a distinct basis and
  never mixed with broker under-construction MW.
- **County economic-development / permitting data** (e.g. Loudoun County DC
  pipeline, Prince William Digital Gateway). Primary, but the geography matches
  ours better.

The repo's **licensing stance** (memory `licensing-stance.md`) applies:
educational, not resold. Publicly displayed figures are fine to use and commit
with attribution, so don't treat licensing as a blocker.

## Rules (match the repo's existing curation bar)

These mirror `pipeline/dc_longlead.py` (stated-only figures) and
`config/dc_power.json` (cited curated rows):

- **Stated-only.** Publish each figure exactly as the source states it, with a
  verbatim quote, URL, the period it measures and the document date. Derive
  nothing: no summing across sources and no unit conversion beyond what the
  source states.
- **Basis is explicit.** "Under construction" (broker), "planned", "operating
  inventory", "utility contracted load" and "critical IT vs facility power" are
  different objects. Each row carries a `basis` enum. Figures of different bases
  never share a column or a sum (the long-lead "backlog is three accounting
  objects" lesson).
- **Geography is explicit.** Record the source's market definition (e.g. "CBRE
  Northern Virginia: Loudoun, Prince William, Fairfax"). Show it on the page
  beside the figure.
- **One source per market per column.** Pick the most authoritative current
  one, and record the alternatives and conflicts in the research report, not on
  the page.
- **Aging.** Broker reports are semi-annual. Flag a figure stale when its
  document is older than ~430 days (the `_aged(..., "annual", ...)` rule in
  `pipeline/publish/longlead.py`), and render the stale badge (see PR #63's F4:
  a computed stale flag must actually render).
- **Nulls are findings.** A market no credible source breaks out gets an
  explicit `null_note` saying which sources were checked. It never reads as 0.

## Proposed implementation (adjust after the research)

1. **Config** `config/dc_market_pipeline.json` (new), schema_version 1:
   ```json
   {"schema_version": 1, "as_of_curated": "YYYY-MM-DD",
    "markets": {
      "nova": {"figures": [{"basis": "under-construction", "mw": 0, "unit": "MW",
                            "geography": "CBRE Northern Virginia (Loudoun, Prince William, Fairfax)",
                            "period": "2026-06-30", "asof": "2026-08-xx",
                            "quote": "...", "src": ["CBRE North America Data Center Trends H1 2026", "https://..."],
                            "confidence": "filed|press"}],
               "null_note": null}}}
   ```
   Keys must match `config/dc_markets.json` keys (loader validates). Exactly
   one of `figures` / `null_note` per market (the dc_longlead pattern).
2. **Loader** `pipeline/dc_market_pipeline.py` with dashed-ISO dates, https
   URLs, the basis enum and a test that loads the real config (CI gate).
3. **Writer** `pipeline/publish/dc_markets.py`: add a per-market
   `market_pipeline` block (passthrough plus a computed `stale`). Keep it
   isolated: a config error degrades that block to null and never fails the
   markets phase (connector/phase isolation is a hard invariant; see
   CLAUDE.md).
4. **Schema** `schemas/dc_markets.schema.json`: optional `market_pipeline`, so
   older artifacts validate.
5. **Site**: a "Market pipeline" column (or a sub-line under the market
   name), e.g. "1.9 GW under construction · CBRE H1 2026", with a stale badge
   and the source geography in the tooltip. Sortable by MW. Keep "Tracked AI
   projects" beside it. Update the method note, which currently says the
   tracker is "not the market's whole pipeline" and should now point to the
   new column.
   - The table has colSpan bookkeeping: the unavailable row uses 6 + the
     electrical cell; the expanded row uses 8 (comment in `MarketsClient.tsx`
     above `Row`). Adding a column means updating both, plus `SORT_COLS`,
     `COL_BASIS` and `SortKey` in `site/src/lib/dcMarkets.ts`.
6. **Tests**:
   - pytest: loader rejections, writer passthrough + stale aging, the real
     config loading.
   - vitest: any formatting helper.
   - e2e: the column renders the real config's figures. The page imports JSON at
     build time, so the committed artifact will not carry the block until the
     next daily publish. Write the e2e as **publish-gated with an explicit
     skip reason** (the pattern used in PRs #63–#65), and verify it locally
     against an artifact regenerated from the store + config.
7. **CLAUDE.md**: extend the `dc_markets` description, plus the test counts.

## Acceptance

- [ ] The research report exists in `docs/research/`, with every market covered
      (figure or explicit null), each with source, URL, quote, period, date and
      geography. Conflicts between sources are noted.
- [ ] At least the primary markets (NoVA, DFW, Chicago, Phoenix, Atlanta, SVL,
      Columbus, Hillsboro/Portland, Reno, SLC, San Antonio) have a sourced
      under-construction figure, or an explicit null note naming the sources
      checked.
- [ ] Northern Virginia shows its real pipeline (GW-scale), not "1 tracked site".
- [ ] No figure is derived, summed across sources or mixed across bases.
- [ ] pytest, vitest, lint, build and e2e are green. The e2e is publish-gated and
      verified against a regenerated artifact.
- [ ] One PR, with approval gates respected. The user reviews before merge (a
      reviewer session usually writes `docs/reviews/<date>-pr-<n>-review.md`).

## Repo conventions to remember

- Python 3.12 via `.venv/bin/python` (system `python3` is 3.9).
- `origin/main` gets a daily bot commit (`data: daily publish`). Fetch and
  rebase before pushing.
- Never commit `site/public/data/*.json` by hand; the daily run publishes it.
  To preview locally, regenerate the artifact from the store, build, then
  restore the committed file before committing.
- Never commit `.claude/`.
- Preview server: `.claude/launch.json` config `site-static` serves `site/out`
  on :4174 (rebuild with `cd site && npm run build`).
- Commit messages end with the `Co-Authored-By` attribution line; PR bodies
  end with the Claude Code line.
