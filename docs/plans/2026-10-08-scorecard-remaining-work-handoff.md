# Handoff: remaining work from the 2026-10-07 page scorecard

Written 2026-10-08, after PR #70 merged (main `9f02177`; daily publish `f58df0d`). The AI Infra
build order is **complete**. This file lists everything the scorecard asked for that is **not**
done, verified against production and the code on 2026-10-08. It also gives a recommended order of
work. Each session below is sized as one PR.

- **Scorecard:** claude.ai artifact `KKxF8kTmXAuvQzM87iqMvh` ("Macrogauge Page Scorecard"). This
  file reproduces every remaining fix verbatim, so you don't need to open it.
- **Shipped so far:** PRs #56–#70.
  - Home rework and methodology DC section (#56).
  - Escalation chart (#59), news tape (#60), compute roster and cloud GPUs (#61).
  - /datacenter hub split plus /power (#62), long-lead lead times (#63), /capacity (#64).
  - Build Inputs (#65), /markets trends (#66), Site Costs (#67), Cost of Capital (#68).
  - Index Ledger (#69), the C&W market-pipeline column (#70).

## How to start a session

1. `git fetch && git checkout main && git pull`. The daily bot commits `data: daily publish …`
   every weekday morning, so expect to rebase over it before pushing.
2. Branch: `feat/<slug>` from main.
3. Follow the per-page cycle used for #56–#70:
   - implement, run the full gate, check visually in the browser, then commit;
   - stop for "push and open the PR";
   - a review session writes `docs/reviews/<date>-pr-N-review.md`;
   - validate and fix the findings, then stop for "merge it with main";
   - merge with `gh pr merge --merge` and verify the prod deploy.
   **Push, PR and merge each need Eric's explicit go-ahead.**
4. **Full gate:**
   - `pytest -q` (1265 at handoff);
   - in `site/`: `npm run lint`, `npm test` (388), `npm run build`, `npm run e2e` (230 at handoff, 0
     skipped after the 10-07 publish).
5. **Preview:** `.claude/launch.json` has `site-static` (serves `site/out` on :4174). Run
   `npm run build` first. Vercel redirects in `site/vercel.json` do **not** run under the static
   `serve`; test redirects against a Vercel preview or prod.
6. **Never hand-commit `site/public/data/*.json` or `store/`.** To preview a new artifact field:
   - regenerate the artifact locally from the store plus config;
   - build and test against it;
   - then restore the committed file byte-for-byte.

   Gate the e2e on the field with
   `test.skip(!data.<field>, "published <file> predates <field> (lands with the next daily publish)")`.

## Recommended order

| # | Session | Size | Why this order |
|---|---|---|---|
| 1 | **Trust layer + raw-number defects**: /status, /data, /methodology collapse, the 3 live raw-value leaks | M | The scorecard's "credibility gap": a project-controls reader checks these first. The leaks are visible defects on prod today. Site-only except the qa detail string. |
| 2 | **/changes covers every artifact**, movers ranked, AI-infra headline | M | Also a scorecard coverage gap ("a monthly what-changed cost report"). Pipeline + schema + site. |
| 3 | **Route consolidation**: the 9 merges/redirects | M–L | Takes ~40 routes to ~30. Mostly moving content; redirects in `site/vercel.json`. Do it before the macro polish, so you polish the surviving pages only. |
| 4 | **Macro page polish** (surviving macro pages) | L, split | Secondary audience by design; several small PRs. |
| 5 | **Coverage gaps** (new data) | L each | Each needs research and new connectors/config; scope with Eric first. |

---

## Session 1: trust layer + raw-number defects

Stakes: low-blast, site-only, plus one pipeline string.

### 1a. Raw values leaking on prod (confirmed 2026-10-08)

| Page | What shows | Where |
|---|---|---|
| `/stress` | `11.111439`, `1701000` in the indicator table's Value column | `site/src/app/stress/page.tsx:37`: `<td>{row.value}</td>` prints the raw float. Also line 34: KPI context prints raw `stress.published_at`. |
| `/heatcheck` | `2026-10-08T03:33:13…` in the Heat score KPI context | `site/src/app/heatcheck/page.tsx:52`: `${heat.published_at}` |
| `/status` | `yoy=3.3965478924364856` in a check's detail | `pipeline/publish/qa.py:82`: `f"yoy={cpi['yoy_pct']} prev={cpi['prev_yoy_pct']}"`. Round in the f-string; qa.json is regenerated daily, so the fix shows after the next publish. |

- Format values per indicator unit. Check `site/src/lib/format.ts` and `indicatorLabels.ts` for
  existing helpers before writing new ones.
- Dates: the site's other pages show `published_at` as a date or "HH:MM UTC" stamp. Reuse
  whatever /as-of uses (`fmtStamp` in `AsOfClient.tsx`) or the StaleBanner helper.
- e2e: assert no `\d+\.\d{5,}` run and no ISO `T..:..:..` in the page text of /stress,
  /heatcheck and /status.

### 1b. `/status`: group by section, AI Infra first

Scorecard fix, verbatim:
> Group checks and sources by section (AI Infra first), show each artifact's data as-of and each
> curated input's last review, and draw staleness as a bar.

- Today: `site/src/app/status/page.tsx` (194 lines) renders one flat `checks.map` (l.92) and one
  flat `sources.map` (l.143).
- **Sections:** derive them from the nav (`site/src/lib/nav.ts`), not a new hand list. AI Infra
  first.
- **Map each check and source to a section:**
  - phase `*_ok` checks map by phase name;
  - sources map via the artifacts they feed. `config/series.json` has the source per series. A
    small mapping in `site/src/lib` with a vitest is fine.
- **"Each curated input's last review":** use the curated configs' `as_of_curated`, found in:
  - `config/dc_markets.json`, `config/capacity.json`, `config/dc_longlead.json`;
  - `config/dc_market_pipeline.json` (doc_date 2026-09-14; stale 2027-11-19);
  - `config/ai_news.json`.

  Import them at build time; `site/src/lib/components.ts` already imports `config/basket.json`.
- **Staleness bar:** age ÷ `max_staleness_days`. The freshness classifier is
  `pipeline/freshness.py`, and its result is already in `qa.json` / `methodology.json`.

### 1c. `/data`: group files, AI Infra first

Scorecard fix, verbatim:
> Group files by section with AI Infra first, show each file's data as-of, and give DC and compute
> files a field preview plus CSV.

- Today: `site/src/app/data/page.tsx` (79 lines) maps `DATA_FILES` (`site/src/lib/dataFiles.ts`,
  pinned by `dataFiles.test.ts`) into one flat table.
- Add a `section` field to each `DATA_FILES` entry and extend the test so every published file has
  one.
- "Data as-of": each artifact has `published_at`; many also have `as_of`. Read both at build time.
- Field preview: the schema-generated types / `schemas/*.schema.json` `description`s are the
  natural source for a field dictionary.
- The CSV recipes already exist (`site/src/lib/exportSpecs.ts`).

### 1d. `/methodology`: collapse the series inventory

Scorecard fix, verbatim:
> Add a DC Cost Index & compute methodology section right after the glossary and collapse the
> inventory behind the source chips.

- The DC section is **done** (#56). The inventory is **not**: `site/src/app/methodology/page.tsx:214`
  `<Section title="Series inventory"><MethodologyInventory …/>` renders every row. The page has no
  `<details>`, and its rendered text is ~411 KB.
- Collapse it behind the source chips: clicking a source filters or expands its rows.
- Keep it findable by Ctrl-F: either a `<details>` element, or rows that stay in the DOM.

### Not reproduced / already fixed (don't redo)

- **Cadence labels:** ECI and ULC now say "(quarterly)"; T5YIFR carries no wrong tag.
- **Mobile clipping** on /cpi-preview, /next-print, /matrix, /recession, /longlead: at 375px every
  wide table is in an `overflow-x: auto` container, no column is hidden, and the document doesn't
  scroll sideways.
- **Already fixed:** /escalation's raw `9000000`, the DDR5 "16GB" unit (#65), and the /markets
  outlier (#66).
- **Unverified:**
  - The /status-vs-/methodology counts mismatch: the methodology count wasn't found in its text, so
    re-check when touching both pages.
  - The gasoline YoY mismatch (home vs /outlook): the pages now show different measures, so it is
    not comparable.

---

## Session 2: `/changes` covers every artifact

Scorecard fix, verbatim:
> Diff every published artifact, show only movers ranked by significance with an 'N unchanged'
> collapse, and open with a one-sentence headline of the day's biggest AI-infra move.

Coverage-gap wording, verbatim:
> /changes only diffs 8 CPI-centric readings. It should cover compute, power hubs, rates,
> long-lead and capacity, and lead with the day's biggest AI-infra move.

- Today: `pipeline/publish/changes.py` snapshots only `pulse.json`, `gaptable.json` and
  `datacenter.json` headline YoYs (`read_previous`, l.50; reads at l.36–40).
- `run_daily.py` takes that snapshot BEFORE the engine phase. That ordering is load-bearing and
  pinned by tests.
- **Design suggestion:**
  - A declarative list of (artifact, JSON path, label, unit, section, "significance" scale)
    readings, in config or a module constant, covering compute index, power hubs, rates, long-lead
    and capacity.
  - `read_previous` snapshots all of them; the writer diffs them and ranks by |Δ| ÷ that reading's
    typical daily move (or a stated threshold).
  - The site shows movers, an "N unchanged" collapse, and a one-sentence data-driven headline. Put
    the headline helper in `site/src/lib` with vitest, like `ratesHeadline` / `capacityHeadline`.
- Schema change: add fields **optionally** so older `changes.json` still validates.
- The `changes` phase is isolated (`changes_ok`). Keep it so.

---

## Session 3: route consolidation (9 routes still live, all return 200 on prod)

Only `/dc-scoreboard` → `/escalation/grades` is done, via `site/vercel.json` `redirects`
(`permanent: true`). Use the same mechanism.

| Route | Scorecard verdict / fix (verbatim) | Target |
|---|---|---|
| `/vs-bls` | Retire into /gap as a validation section showing the headline gauge vs CPI and core with MAE. | /gap |
| `/supercore` | Fold into /gap as one variant row with a takeaway headline. | /gap |
| `/next-print` | Redirect to /cpi-preview and move the fuel-forward tile into its gasoline receipt row. | /cpi-preview |
| `/releases` | Redirect to /revisions, which already shows first print and release date. | /revisions |
| `/real-wages` | Fold into /labor as a real-wage-gap panel with a construction-trades series. | /labor |
| `/metros` | Fold into /housing as a collapsible by-metro table and fix the sparkline colour. | /housing |
| `/heatcheck` | Merge into Macro cycle with a 3–5 year heat-score line and a sentence subtitle. | new /macro-cycle |
| `/stress` | Fold into Macro cycle as one sparkline row, or retire. | new /macro-cycle |
| `/recession` | Merge into one Macro-cycle page as a six-row distance-to-threshold bar chart. | new /macro-cycle |

- **Recommendation: split this into 2–3 PRs.**
  - PR A: pure redirects whose content already exists at the target (/next-print, /releases).
  - PR B: folds into existing pages (/vs-bls + /supercore → /gap; /real-wages → /labor;
    /metros → /housing).
  - PR C: the new /macro-cycle page (heatcheck + stress + recession).
- If session 1 lands first, its raw-value fixes on /stress and /heatcheck move with the content.
- **For every removed route, update:**
  - `site/src/lib/nav.ts` and the e2e route lists (`smoke.spec.ts` route table, `site-fixes.spec.ts`
    artifact map);
  - the sitemap and OG lists, if any;
  - `internalLinks` (the test that fails on links to dead routes);
  - `DATA_FILES`, if a page was the only consumer of an artifact. **Keep publishing the artifact;
    removing one is a pipeline change.**
- Redirects can't be e2e-tested under static `serve`. Verify on the Vercel preview (curl `-I` for
  the 308 and `location`), as was done for /dc-scoreboard.

---

## Session 4: macro page polish (surviving pages)

Secondary audience; do after session 3 so merged-away pages aren't polished. One PR per group.
Scorecard fixes are verbatim; D/S/R/U are the scorecard's design / story / AI-infra relevance /
usefulness scores.

| Page | D S R U | Verdict | Fix |
|---|---|---|---|
| `/matrix` | 5 4 4 5 | REWORK | Cut the forecaster block and retitle as 'Construction & escalation inputs' with PPI, imports, tariff, ECI/ULC first, each with a 24-month sparkline and 3m/12m change. |
| `/labor` | 6 5 4 4 | REWORK | Add a Construction labour band at the top (CES2000000001, construction AHE vs private, JOLTS construction) linking to /markets. |
| `/calculator` | 7 5 3 3 | REWORK | Rebuild as a contract-escalation calculator: pick DC Build/Ops/Hardware, a long-lead PPI leg or CPI, enter a bid or NTP date, and rebase the chart to 100 on that date. |
| `/outlook` | 6 6 4 5 | REWORK | Retitle the chart with the takeaway, annotate the hump, and add a CSV of 12-month component paths. |
| `/revisions` | 6 5 3 4 | DEMOTE | Absorb /releases, title with the payroll takeaway, collapse CPI to one line and add PPI and ECI revisions, which escalation clauses index to. |
| `/cpi-preview` | 5 5 3 4 | DEMOTE | Absorb /next-print, add a takeaway hero and a dot plot of Macrogauge/Cleveland/Kalshi, and sort receipts by \|contribution\|. |
| `/pce` | 7 6 3 5 | DEMOTE | Keep as the macro flagship; swap the weights table for a CPI-vs-PCE dumbbell and annotate the 2021–22 overshoot. |
| `/gap` | 6 5 2 4 | DEMOTE | Make it the single 'variants & validation' page absorbing /vs-bls and /supercore; collapse the 10 carry rows into one line. |
| `/scoreboard` | 6 4 2 3 | DEMOTE | Lead with the head-to-head win over a small error chart and move benchmark tiles under the backtest. |
| `/cost-of-living` | 6 5 3 4 | DEMOTE | Default to 24 months, annotate the 2026 rate-driven jump and recolour Official CPI neutral grey. |
| `/housing` | 6 6 1 3 | DEMOTE | Demote, absorb /metros as a drill-down, and drop the rate series from the affordability chart. |
| `/grocery` | 6 6 1 2 | DEMOTE | Lead with the spread table and a takeaway headline; move utilities out. |
| `/my-inflation` | 6 4 1 2 | DEMOTE | Plot 'your rate minus everyone's' as one line and keep the gap neutral below ~0.25pp. |
| `/components/[code]` | 6 5 1 3 | DEMOTE | Clone this template for DC index sub-components (transformer, switchgear, GPU legs); default this chart to 36 months. |

- **Highest value for the AI-infra reader:**
  - `/calculator` as a contract-escalation calculator;
  - `/matrix` retitled as escalation inputs;
  - the `/labor` construction band;
  - `/revisions` adding PPI/ECI (what escalation clauses index to);
  - the DC sub-component drill-down (`/components` template).

  Do these first and leave the household pages last.
- **Defects from the scorecard's "colour without meaning" list:** check while touching each page.
  - /outlook, /components and /my-inflation paint every positive value red (a 0.02pp gap in alarm
    red).
  - The /metros sparkline colour follows sign, not acceleration, as its footnote claims.
  - Use `heat.levelRamp` / `levelInk` or a neutral stroke; /markets set the precedent of a neutral
    sparkline for levels.
- **Misleading scales:** /vs-bls and /cost-of-living let the 2022 peak crush the current story.
  Default to a recent window, as /cost-of-living's fix says.

---

## Session 5: coverage gaps (new data; scope with Eric before building)

From the scorecard's "What an AI-infra reader expects and won't find". Status as of 2026-10-08:

| Gap | Status | Note |
|---|---|---|
| Lead times in weeks (transformers, switchgear, gensets) | **Done** (#63) | `lead_times` per package + `lead_time_benchmark` |
| Construction-financing rates (IG/BBB OAS, term SOFR) | **Done** (#68) | 30-day avg SOFR used, not term SOFR (term SOFR is licensed) |
| Steel/HRC, PJM capacity in build inputs | **Done** (#65) | GOES not added; check whether a public series exists |
| GPU rental prices from hyperscalers/neoclouds | **Partly** (#61) | On-demand list $/GPU-hr for AWS/Azure/OCI/CoreWeave. **Missing: 1–3-year reserved pricing, and price per unit of capability over time** (the deflation story). |
| Capacity over time | **Partly** | /capacity has a Timeline tab built from the curated roster. **Missing: GW energized per quarter as a forward schedule, plus PPA and interconnection-queue MW tied to named companies.** |
| Power availability per market | **Not done** | Interconnection-queue wait times and all-in $/MW build cost by market, beside the /markets labor panel. The 2026-10-07 research found C&W's cost guide has per-market $/MW only as an unlabeled dot chart, and JLL's $/MW is shell-and-core only (`docs/research/2026-10-markets-construction-totals.md`, "Build-cost per MW"). LBNL "Queued Up" (2026 edition, already used on /power) has queue durations by ISO, not by our markets. |
| A monthly "what changed" cost report | **Session 2** | |

Each is research-first. Follow the /markets pattern:
- a research report in `docs/research/`;
- one source per column, on one stated basis;
- verbatim quotes checked against committed evidence;
- a null note rather than a zero.

---

## Watch-outs carried forward

- **Curated refresh dates:** the C&W market pipeline figures go stale 2027-11-19. The next edition
  (H2 2026) is expected around Feb–Mar 2027. On refresh:
  - edit `config/dc_market_pipeline.json`;
  - re-save the flipbook text layer to `docs/research/evidence/`, so
    `test_every_quote_is_verbatim_on_its_flipbook_page` still holds.
- **The /markets table fits its card at exactly 1198px at 1440 wide** (e2e asserts it). Any new
  column needs a width check at 1440 and 1280 with a row expanded.
- **Hand types and schemas:** hand types in `site/src/lib/types.ts` must extend the schema types,
  and new artifact fields are optional in the schema. Never `as unknown as` an artifact.
- **e2e regexes:** loose header regexes (`/^Market/`) broke when a similarly named column was
  added. Anchor them.
