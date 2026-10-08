# Power availability and build cost per market for /markets (research spike, 2026-10-08)

Brief: scorecard Session 5, "Power availability per market"
(`docs/plans/2026-10-08-scorecard-remaining-work-handoff.md`). Research only: no code, config,
schema or test changed. Prior report on the same page: `docs/research/2026-10-markets-construction-totals.md`.

Two candidate columns beside the 20 `/markets` rows (`config/dc_markets.json`):
1. **Time to power**: how long a new data-center load waits for a grid connection, or the size of
   a large-load queue, per market.
2. **All-in $/MW build cost** per market.

Rules applied (from the project): one source per column on one stated basis; a verbatim quote,
URL, page and as-of date for every figure; a null note rather than a zero; build only if one basis
covers at least 10 of the 20 markets.

## 1. Verdict

| column | verdict | best single-basis coverage | why |
|---|---|---|---|
| Time to power | **Don't build** | 5/20 (JLL 2026 Outlook bar chart, with no printed values) | No public source gives per-market wait times on one basis. LBNL (June 2026) says so directly: "there is limited publicly available information on large load interconnection timelines or costs". Queue sizes exist only per ISO or utility, on 7+ different bases, and do not map one-to-one to our markets. |
| All-in $/MW | **Don't build (yet)** | 17/20 named (C&W 2026 Cost Guide), but **0/20 with a printed value**. Best with printed values: 8/20 (Turner & Townsend, construction-only basis). | C&W's chart covers 17 of our markets on one all-in basis, but plots low/mid/high as unlabeled dots in a raster image. That means no figure can be quoted. T&T prints values but covers only 8 markets, 2 short of the threshold, and on a narrower basis. |

Build-partial was considered and rejected for both columns. Every candidate is below 10/20 on a
quotable basis (see table 2).

## 2. Sources scored

| # | source | basis | markets covered (n/20) | as-of | access | verified? |
|---|---|---|---|---|---|---|
| A | **Turner & Townsend, Data Centre Construction Cost Index 2025 (2025–26 edition)** | US$/W of IT load, construction only (excl. land, utility works, site works, fees). 30–50 MW air-cooled build-to-suit hyperscale | **8/20** with printed values | Nov 2025; FX avg 2024-10-01 → 2025-10-01 | Free web report, but the **live URL now redirects** to another T&T report; read via Wayback plus the still-live chart embed | **Yes**: text quotes plus the chart's own data CSV, and the rendered labels checked visually |
| B | **Cushman & Wakefield, Data Center Development Cost Guide 2026** (p.28) | All-in greenfield $M/MW, low/mid/high, excl. chips/GPUs | **17/20 by label, 0/20 by value** | published 2026-09-03 | Free flipbook | **Yes** for labels and text (vector text layer). Values are not printed (raster dots). |
| C | JLL, 2026 Global Data Center Outlook (p.25) | Shell and core only, $M/MW, 50 MW single-tenant air-cooled, excl. land and IT | 5/20 | PDF created 2026-03-03 | Free PDF | Yes (printed labels; already in the prior report) |
| D | **JLL, 2026 Global Data Center Outlook (p.18)** | "Average grid connection lead times for new 50 MW data centers (years)" | **5/20** | PDF created 2026-03-03 | Free PDF | Chart and labels **yes**. Values are **not printed**, and the press "7 years for NoVA" figure is UNVERIFIED in the text. |
| E | PJM 2026 Long-Term Load Forecast, Table B-9 | Load-forecast adjustment above embedded, summer peak MW, by transmission zone | 3/20 distinct (DOM→nova, COMED→chicago, AEP→columbus + newcarlisle with one shared figure) | 2026-01-14 (B-9 corrected 2026-02-06) | Free XLSX | Yes |
| F | ERCOT Large Load Interconnection Status Update (monthly) | Large-load queue MW by status. Load-zone and TSP breakdowns are image-only charts. | ≤3/20 (dfw, abilene, sanantonio) | Mar 13 2026 read; monthly | Free PDF | Text yes; load-zone values are images only |
| G | Utility disclosures (repo's `config/dc_power.json` tariffs table plus prior report) | "contracted", "committed", "signed agreements", "in study", "requests", "potential", "peak load" (7+ bases) | ~15/20 touched, but no two share a basis and several figures are company-wide | 2025-02 → 2026-10 | Free filings | Yes in-repo (PR #50). Not re-fetched in this session. |
| H | CBRE NA Data Center Trends H1 2026 | Qualitative power text per market chapter | 8 chapters, no time figures | 2026-08-27 | Free (Cloudflare to scripts) | Yes (read in browser) |
| I | C&W Americas Data Center Update H1 2026 | Qualitative power narrative per market | ~15, no time figures | 2026-09-14 | Free flipbook | Yes (committed text layer) |
| J | DC Hub "DCPI" time-to-power | "Median interconnection queue wait for hyperscale-grade loads", source not stated | Unknown | "Q2 2026" | **Paywalled** numbers; per-market narrative auto-generated ("claude-haiku") | Rejected |
| K | MMCG "U.S. Data Center Census 2026" | Operator-reported MW floor by utility/state | ~4/20 | June 2026 | Free blog | Read via summarizer only; rejected on basis |

## 3. Per-source detail

### A. Turner & Townsend DCCI 2025: the best quotable $/MW source, 8/20

- **URLs**
  - Report (dead link): https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/
    now redirects to `climate-environmental-report-2026-compact` (checked with curl and the in-app
    browser on 2026-10-08).
  - Read via Wayback:
    - https://web.archive.org/web/20251118010658/https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/data-centre-cost-trends
    - https://web.archive.org/web/20251118194331/https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/methodology
  - Figure 3 data: the live everviz embed https://app.everviz.com/embed/YW3FkZ6CA/?v=17. Its
    data-label format is `US${point.y:.2f}/W`, and its rendered labels were checked against a
    screenshot.
  - Live US landing page: https://www.turnerandtownsend.com/en-us/insights/data-center-construction-cost-index-2025-2026/
  - Evidence: `docs/research/evidence/2026-10-power-tt-dcci-2025.txt`
- **Basis, verbatim (methodology):**
  - "Benchmarking cost data has been modified to represent a typical air-cooled, build-to-suit
    hyperscale data centre in the average range of 30-50MW (IT load)."
  - "The cost model does not include any client direct costs, land purchase costs, utility works,
    abnormal groundworks, site works, active IT equipment, fibre cabling to support office
    fit-outs or professional services fees."
  - "© Turner & Townsend Limited. All rights reserved November 2025."
- **Text quotes (trends page):**
  - "Silicon Valley (US$13.3 per watt)"
  - "rates more comparable with Portland (US$10.9 per watt)"
  - "Atlanta (US$9.9 per watt), Phoenix (US$9.8 per watt) and Columbus (US$9.8 per watt)"
- **Chart-only values** (Figure 3; CSV row and rendered label):
  - `"Chicago";11.232` → "US$11.23/W"
  - `"North Virginia";10.92` → "US$10.92/W"
  - `"Dallas";9.54` → "US$9.54/W"
- **US markets in the index (10):** Silicon Valley, New Jersey, Chicago, North Virginia, Portland,
  Atlanta, Phoenix, Columbus, Dallas, Charlotte. Eight of them map to our markets. New Jersey and
  Charlotte do not.
- **Notes**
  - The basis is **not all-in**: no land, utility works or site works. It is not comparable to
    C&W's $M/MW, and must not be mixed with it.
  - T&T is majority-owned by CBRE, as stated on its own methodology page.
  - The next edition is likely ~Nov 2026 (inferred from the Nov 2025 cadence). If it adds two
    of Reno, SLC, San Antonio, Des Moines/Iowa, Quincy, Cheyenne or Memphis, it crosses 10/20.

### B. C&W Data Center Development Cost Guide 2026: right basis, no quotable values

- **Source**
  - Flipbook: https://digital.cushmanwakefield.com/datacenterdevcostguide-amer-content-pds-datacenter-/ (34 pp.)
  - Landing page: https://www.cushmanwakefield.com/en/united-states/insights/data-center-development-cost-guide
  - Evidence: `docs/research/evidence/2026-10-power-cw-costguide-2026-p25-p28.txt`. That file
    holds the text layer of pp. 25–28, taken from the flipbook's per-page vector SVGs because
    this flipbook has no `searchtext.js`.
- **Basis, verbatim (p.25, spacing restored):** "an all-in metric that comprises development costs
  for power infrastructure, core and shell or sitework, contingencies, cooling infrastructure,
  tenant-carried costs, land and site acquisition, escalations, design and engineering fees, and
  other miscellaneous costs".
- **Range (p.27):** "an all-in total average greenfield data center development cost of $8.9
  million per MW to $23.3 million per MW, excluding chips and GPUs, within the United States and
  Canada."
- **Per-market chart (p.28):** "Construction Costs by Market / Greenfield Data Center Development:
  Cost Range Per MW".
  - The legend is "Low (U.S.$M/MW) Mid (U.S.$M/MW) High (U.S.$M/MW)", on an axis running
    $6–$24.
  - The page SVG holds only text plus a single `<path>`, so the dots live in the raster substrate.
    The rendered page (screenshot, 2026-10-08) shows dots with **no data labels**.
- **The 38 market labels, in printed order:** Silicon Valley, Chicago, NYC/Northern NJ, Toronto,
  Los Angeles, Vancouver, Boston, Alberta, Montreal+Quebec, Seattle, Minneapolis,
  Portland+Eastern OR, Pennsylvania, Las Vegas, Central Washington, Reno, Columbus, Kansas City,
  Phoenix, Virginia, Atlanta, Indianapolis, Salt Lake City, Denver, Iowa, Omaha, Dakotas,
  Cheyenne, Nashville, Memphis, Tulsa, Oklahoma City, Dallas, Carolinas, Texas Panhandle,
  West Texas, Houston, Austin/San Antonio.
- **Is the order a ranking? Inferred, not stated.** The labels appear to be sorted from most to
  least expensive:
  - The first five match the text: "Silicon Valley, Chicago, New York City/Northern New Jersey,
    Toronto and Los Angeles representing the five most expensive markets".
  - The last six include five Texas markets, consistent with "four of those five are in Texas".
  - Virginia sits mid-chart ("ranks in the middle of the pack").
  - C&W never states the sort key.
- **Coverage of our 20:** 17.
  - Matched markets: svl, chicago, hillsboro (Portland+Eastern OR, wider), quincy (Central
    Washington, wider), reno, columbus, phoenix, nova (Virginia, wider), atlanta, slc, desmoines
    (Iowa, wider), councilbluffs (Omaha), cheyenne, memphis, dfw, abilene (West Texas, proxy),
    sanantonio (Austin/San Antonio, wider).
  - Council Bluffs → Omaha relies on the Americas Update's note that "Council Bluffs, Iowa, is
    considered part of the Omaha market". Applying it to the cost guide is inferred.
  - Not covered: newcarlisle, mtpleasant, richland. Indianapolis is a different market from
    New Carlisle (St. Joseph County).
- **Why not build:**
  - No number can be quoted.
  - Reading dot positions off the raster would be a derived estimate, not a published figure,
    which breaks the verbatim rule.
  - A rank column would rest on an unstated sort key.

### C. JLL 2026 Global Data Center Outlook, shell and core $/MW (p.25): 5/20

- Already recorded in the prior report. Re-read this session from
  https://www.jll.com/content/dam/jllcom/en/global/documents/reports/research-reports/26-research-global-data-center-outlook-new.pdf
  (PDF p.25).
- Chart title: "2026 average data center construction costs in the largest global markets ($
  millions per MW)".
- Note, verbatim: "Average build costs for the shell and core of a single-tenant 50 MW air-cooled
  data center. Land acquisition and active IT equipment costs are excluded."
- AMER markets: Chicago, N. Virginia, Phoenix, Dallas, Atlanta.
- Evidence: `docs/research/evidence/2026-10-power-jll-outlook-2026-p18-p25.txt`.

### D. JLL 2026 Outlook, grid connection lead time (p.18): the only per-market time-to-power chart, 5/20

- Chart title, verbatim: "Average grid connection lead times for new 50 MW data centers (years)".
  Source line: "Source: JLL Research".
- Text: "the average wait time for a grid connection in primary data center markets exceeds four
  years."
- AMER bars: Dallas, Phoenix, Atlanta, Chicago, N. Virginia.
  - **No values are printed.** The text layer has only the axis ticks "0 Years 2 4 6 8 10".
  - By eye, from the rendered page: Dallas ≈ Phoenix ≈ 2.5 yr; Atlanta ≈ Chicago ≈ 5 yr;
    N. Virginia ≈ 7 yr. These are **not quotable**.
- The widely repeated "seven years for a 100 MW connection in Northern Virginia" is
  **UNVERIFIED**:
  - It appears in constructionowners.com (2026-07-01), attributed to this report.
  - The report's text layer contains no "seven" and no "100 MW". Its chart is titled "50 MW".
- Coverage is 5/20, all primary markets, so it fails the threshold even if values were printed.

### E. PJM 2026 Load Forecast, Table B-9 (zone large-load adjustments): 3 distinct/20

- Source: https://www.pjm.com/-/media/DotCom/planning/res-adeq/load-forecast/2026-load-report-tables.xlsx
  (sheet "Table B9").
- Evidence: `docs/research/evidence/2026-10-power-pjm-2026-table-b9.txt`.
- Title, verbatim: "Adjustments Above Embedded to Summer Peak Load (MW) for Each PJM Zone and RTO
  (2026 - 2046)", with the note "This Table was updated 2/6/2026 to correct for an error
  calculating embedded".
- 2026 / 2030 values:
  - DOM 3429 / 10135
  - COMED 478 / 4838
  - AEP 1913 / 7918
  - PJM RTO 6403 / 33707
- Report p.5: the DOM adjustment covers "Growth in data center load and a voltage optimization
  program". The AEP and COMED adjustments cover "Growth in data center load".
- Why it fails the threshold:
  - The basis is a forecast adjustment, not a queue or a wait.
  - The geography is a transmission zone: DOM is most of Virginia, and AEP spans many states.
  - It covers only PJM markets.
  - The AEP zone includes "INM Indiana Michigan Power, sub-zone of AEP" and "OP Ohio Power,
    sub-zone of AEP". Columbus and New Carlisle therefore share one AEP figure.

### F. ERCOT Large Load Interconnection Status Update: ≤3/20

- Source: https://www.ercot.com/files/docs/2026/03/12/March-TAC-Report.pdf (Mar 13, 2026).
- Evidence: `docs/research/evidence/2026-10-power-ercot-llis-2026-03.txt`.
- Status categories are defined verbatim, from "Observed Energized" through "No Studies
  Submitted".
- "Of the 9042 MW that have received Approval to Energize ...".
- The breakdowns "Loads Approved to Energize – By Zone & Project Type", "Large Load Project
  Distribution by Load Zone" and "Distribution - TSP" are image-only. The footnote on the zone
  chart reads "*Other Includes LZ_NORTH, LZ_SOUTH, and LZ_HOUSTON".
- The September 2026 Board deck (https://www.ercot.com/files/docs/2026/09/17/10-Interconnection-and-Grid-Analysis-Update-REVISED.pdf)
  moves large-load data to a separate "Item 14: Batch Zero Update".
- **Context only (not a /markets column):** a load-zone view could at most cover DFW (North),
  Abilene (West) and San Antonio (LZ_CPS).

### G. Utility large-load pipelines: mixed basis by construction

The repo's `/power` tariffs table (`config/dc_power.json`, verified in PR #50) already holds one
pipeline line per utility. Read against our 20 markets, these are the bases:

| our market | utility line in `dc_power.json` | stated basis |
|---|---|---|
| nova | Dominion: "53.8 GW contracted, 12.0 GW of it under signed service agreements (Jul 2026)" | contracted / signed |
| chicago | ComEd: "About 9 GW in advanced design plus about 17 GW in cluster studies" | design / study |
| phoenix | APS: "4.5 GW committed; about 20 GW uncommitted"; SRP: "no GW pipeline published" | committed |
| atlanta | Georgia Power: "12.4 GW committed ... 76.2 GW pipeline" | committed / pipeline |
| svl | PG&E: "12.7 GW of data-center requests" (Santa Clara is mostly Silicon Valley Power, which has no line) | requests |
| columbus | AEP Ohio: "About 12 GW of AEP's 69 GW contracted load through 2030 is in Ohio" | contracted, statewide |
| newcarlisle | I&M: "Indiana peak load 2.8 GW today, more than 7 GW by about 2030" | peak forecast |
| richland | Entergy LA: "7 to 12 GW of potential data-center load" | potential |
| reno | NV Energy: "About 5.7 GW under signed agreements and 11.2 GW in study (Aug 2025)" | signed / study |
| dfw, abilene, sanantonio | Texas: "ERCOT tracks about 474 GW of large-load requests" | requests, statewide |

In the prior report but not in `dc_power.json`:
- quincy: Grant PUD, "~800 MW of large-load requests in the queue".
- cheyenne: Black Hills 8-K, service capacity.
- hillsboro: PGE/GridCARE.

None at all: slc (Rocky Mountain Power), mtpleasant (We Energies; WEC gives an I-94 corridor
forecast only), memphis (MLGW/TVA), desmoines and councilbluffs (MidAmerican).

That is at least seven bases, and several figures are company-wide or statewide. This is the
mixed-basis case the rules reject. They belong on `/power`, where they already are.

### H/I. Broker narratives: qualitative only

- **CBRE H1 2026, NoVA chapter** (https://www.cbre.com/insights/books/north-america-data-center-trends-h1-2026/northern-virginia-data-center-market):
  "Dominion Energy's batching system continues to extend power delivery timelines for new
  projects". No months or years are given in any chapter of the eight.
- **C&W Americas H1 2026** (committed text layer `2026-10-cw-americas-h1-2026-searchtext.json`),
  for example:
  - Silicon Valley: "long energization timelines and completed facilities that are still waiting
    for power".
  - Reno: "delays continue to create uncertainty around future energization timelines".
  - Phoenix: "power infrastructure remains the defining variable".
  - No durations anywhere.

### Context: LBNL confirms the gap

LBNL, *Speed to Power: Solutions for Accelerating Large Load Connections* (June 2026), printed
p.25:
- "there is limited publicly available information on large load interconnection timelines or
  costs."
- "most transmission owners, transmission providers, and distribution utilities do not publish
  data on load interconnection queues."
- Its one per-utility timeline example is ATC (Wisconsin, 6–18 months of study, 18–60 months of
  construction). That covers no market of ours except, possibly, Mt Pleasant's transmission,
  and that link is inferred: Racine is in ATC's footprint.
- Source: https://eta-publications.lbl.gov/sites/default/files/2026-06/lbnl_large_loads_speed_to_power_final_1.pdf
- Evidence: `docs/research/evidence/2026-10-power-lbnl-speed-to-power-p25.txt`.

## 4. Market × source coverage

Key:
- **V** = a printed or quotable value on that source's basis.
- **L** = labeled in the chart but no printed value.
- **c** = context only, on a different or wider basis.
- **—** = not covered.

| key | A T&T $/W | B C&W all-in (p.28) | C JLL S&C $/MW | D JLL lead time | E PJM B-9 | F ERCOT | G utility line |
|---|---|---|---|---|---|---|---|
| nova | V 10.92 (North Virginia) | L (Virginia) | V | L | c (DOM) | — | c |
| dfw | V 9.54 | L | V | L | — | c | c (TX statewide) |
| chicago | V 11.23 | L | V | L | c (COMED) | — | c |
| phoenix | V 9.8 | L | V | L | — | — | c (APS) |
| atlanta | V 9.9 | L | V | L | — | — | c |
| svl | V 13.3 | L | — | — | — | — | c (PG&E) |
| columbus | V 9.8 | L | — | — | c (AEP) | — | c |
| slc | — | L | — | — | — | — | — |
| abilene | — | L (West Texas, proxy) | — | — | — | c | c (TX statewide) |
| newcarlisle | — | — | — | — | c (AEP, shared) | — | c (I&M) |
| mtpleasant | — | — | — | — | — | — | — |
| richland | — | — | — | — | — | — | c |
| memphis | — | L | — | — | — | — | — |
| councilbluffs | — | L (Omaha, inferred) | — | — | — | — | — |
| desmoines | — | L (Iowa) | — | — | — | — | — |
| cheyenne | — | L | — | — | — | — | c (prior report) |
| reno | — | L | — | — | — | — | c |
| quincy | — | L (Central WA) | — | — | — | — | c (prior report) |
| sanantonio | — | L (Austin/SA) | — | — | — | c (LZ_CPS) | c (TX statewide) |
| hillsboro | V 10.87 (Portland) | L (Portland+E. OR) | — | — | — | — | c (prior report) |
| **V count** | **8** | **0** | **5** | **0** | 0 | 0 | 0 |

## 5. Recommended next step and refresh cadence

Nothing is buildable as a /markets column today. In order of value:

1. **Ask C&W for the numbers behind the p.28 chart** (contact through the guide's Project &
   Development Services or Research contacts).
   - If C&W publishes or confirms low/mid/high $M/MW per market in writing, the cost column is
     buildable at **17/20 on one all-in basis**, with three null notes:
     - newcarlisle and mtpleasant: "no C&W cost market; nearest are Indianapolis/Chicago, which
       are different markets".
     - richland: "no Louisiana market".
   - It would use the same `fit` close/wider/proxy labelling as the construction column.
   - Only Eric can make this request.
2. **Re-check Turner & Townsend's 2026–27 index on release** (expected ~Nov 2026, inferred from
   the 2025 cadence).
   - At 10 or more of our markets, build the column on T&T's construction-only US$/W basis, and
     label it "construction only, excl. land/utility/site works".
   - T&T's report URLs are not stable: the 2025 edition went dark within a year. Commit the
     everviz CSV to evidence at build time, as this spike did.
3. **Time to power:** no build path is visible.
   - Keep the per-utility pipelines on `/power`.
   - The /markets row could link to its utility's `/power` tariff row. This needs no new data,
     because `utility` is already in `dc_markets.json`. It is a UI choice for Eric, not a
     column.
   - Revisit only if FERC's large-load interconnection rulemaking or a state commission creates
     a standardized queue disclosure.
4. **Refresh cadence of the scored sources:**

   | source | cadence |
   |---|---|
   | T&T | annual (~Nov) |
   | C&W Cost Guide | irregular: Q4 2024, then 2026-09-03 |
   | JLL Outlook | annual (Q1) |
   | PJM load forecast | annual (Jan) |
   | ERCOT LLIS | monthly |
   | C&W Americas Update | semi-annual |

## 6. Dead ends (do not repeat)

- **DC Hub DCPI:**
  - "time-to-power" is defined as a median queue wait, with no source dataset named.
  - Per-market numbers are locked: "The numeric DCPI scores ... are locked in this free preview".
  - The bulk CSV needs a key.
  - Narratives are labeled "auto-generated · claude-haiku".
  - Rejected.
- **MMCG Data Center Census 2026:** operator-reported MW floors (capacity reported for 630 of
  1,784 facilities); top-10 utility table only. Wrong basis, and it covers about 4 of our markets.
- **constructionowners.com "market-by-market reality check" (2026-07-01):** secondary. Its only
  number (NoVA 7 years) is UNVERIFIED against JLL.
- **Sightline via Bloomberg ("4 to 7 years" for NoVA/Phoenix/Dallas):** a range across three
  markets. Not reached in primary form.
- **Carbon Direct "AI Meets the Grid"** (ISO-level ~20/40-month averages): ISO-level, and only
  seen second-hand.
- **Substack citing a CPS Energy planner at PowerGen 2026** (Columbus 84 months, etc.):
  second-hand. UNVERIFIED.
- **Statista "data center grid connection lead times by market":** a paywalled republication of
  JLL's chart.
- **CBRE H1 2026:** eight market chapters, qualitative power text only. CBRE prints no
  per-market $/MW.
- **JLL $/MW:** shell and core only, 5 markets (prior report).
- **Newmark:** no per-market power timing found in public coverage. The report itself was not
  opened, so this is UNVERIFIED rather than confirmed absent.
- **NREL/DOE "Speed to Power" viewer:** retired (prior report). DOE's initiative has published
  no per-region timing dataset.
- **LBNL "Queued Up":** generator queues only (already on `/power`).
- **ERCOT Generator Interconnection Status:** generation, not load.
- **reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/*:** every path now
  redirects to an unrelated report. Use Wayback captures (Nov 2025) and the everviz embed.

## Flaw noticed in passing (not fixed; out of scope)

`config/dc_markets.json` row `newcarlisle` sets `"iso": "MISO"`, but its own `utility` is "AEP
Indiana Michigan". PJM's 2026 load report lists "INM Indiana Michigan Power, sub-zone of AEP",
which puts I&M in PJM. **Confirmed** from the report text, saved in
`docs/research/evidence/2026-10-power-pjm-2026-table-b9.txt`. That the AWS campus is served by I&M
rests on press relay of Amazon's filing with the Indiana Utility Regulatory Commission, and is
**inferred**.
