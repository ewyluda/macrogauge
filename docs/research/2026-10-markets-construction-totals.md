# Per-market data-center construction totals for /markets (research, 2026-10-07)

Brief: `docs/plans/2026-10-07-markets-construction-totals-handoff.md` (branch `feat/markets-tightness`).
Goal: a sourced, market-level "MW under construction" figure for each of the 20 `/markets`
rows, shown beside (not replacing) the "Tracked AI projects" column.

## Decision (Eric, 2026-10-07)

- **One publisher for the column: Cushman & Wakefield, *Americas Data Center Update H1 2026***
  (published 2026-09-14). It is the only publicly readable source with a complete
  operational / under-construction / planned set per market. Its basis, colocation **plus
  hyperscale self-build**, is the AI build-out this site tracks.
- **CBRE, JLL, county, federal-lab and utility figures stay in this report** as cross-checks
  and context. They are not on the page, because each one is a different basis or geography
  (see "Why not mix sources").

## C&W basis and geography (applies to every figure below)

- **Basis, verbatim footnote on every market page:** "* Definition: Key indicators are based
  on operational Hyperscale Self -Build & Colo data center facilities in the market and
  excludes Captive & ICT".
  - Under Construction (U/C) and Planned are separate series. The cost guide adds
    "Development pipeline excludes early-stage projects".
  - **IT vs facility MW is not stated** in the Americas Update. The companion *Global Data
    Center Market Comparison 2026* labels its metric "Operational IT Load", but that is an
    inference, so the page should say "basis not stated" rather than "IT MW".
- **Geography:** C&W markets are named regions with map labels, not county lists. Several
  are much wider than our tight core counties. Each one's geography is recorded below, and
  the page must show it beside the figure.
- **Period / date:** every KEY INDICATORS box is badged H1 2026 (period end 2026-06-30). The
  document is dated 2026-09-14.
  - Caveat: some two-market tertiary pages (Iowa, Cheyenne) carry narrative text that still
    describes H2 2025, e.g. "As of H2 2025, 420MW was under construction" for Iowa. We use
    the H1 2026 boxes and treat the narratives as stale.
- **Source URL:** https://digital.cushmanwakefield.com/americasdatacenterupdateh12026-09-2026-global-central-en-content-mrsrch-datacentres/
  - Landing page: https://www.cushmanwakefield.com/en/insights/americas-data-center-update
- **Evidence:** quotes come from the flipbook's published text layer (`common/search/searchtext.js`).
  - The text layer runs some digits together ("39,340M W", "5,52 3MW"). The quotes below keep
    those artifacts; the figure column normalizes the spacing only.
  - On two-market pages (pp. 40–41) the text order does not follow the printed layout.
    Attribution was checked against screenshots of the rendered pages.
  - Spot-checked independently in this session: Virginia, Columbus, Reno, SLC, Iowa,
    Cheyenne and the footnote all match the saved text layer.

## Chosen figure per market (20/20 covered: 15 figures, 5 null notes)

"Fit" describes how the C&W geography compares to our county set (`config/dc_markets.json`):
- **close**: the same metro.
- **wider**: a larger region containing our counties.
- **proxy**: a region in which our market is one of several named places.

| key | our counties | C&W market (geography) | fit | U/C MW | in operation MW | planned MW | page | verbatim quote |
|---|---|---|---|---|---|---|---|---|
| nova | Loudoun, Prince William | **Virginia**, statewide. Map labels: Ashburn/Sterling, Manassas, Culpeper, Fredericksburg, Richmond, Danville | wider | 7,355 | 12,338 | 39,340 | 8 | "H1 2026 KEY INDICATORS* 64 Operators 12,338MW In Operation 7,355MW Under Construction 1.0% Colo Vacancy 39,340M W Planned 1063MW H1 2026 Absorption" |
| dfw | Dallas, Tarrant, Ellis | **Dallas + Fort Worth**. Map labels: Red Oak, Fort Worth, Midlothian, Plano/Richardson, Dallas/Irving | close | 1,720 | 1,845 | 15,392 | 18 | "H1 2026 KEY INDICATORS* 45 Operators 1,845MW In Operation 1,720 MW Under Construction 3.4 % Colo Vacancy 15,392MW Planned 124MW H1 2026 Absorption" |
| chicago | Cook, DuPage | **Chicago**. Map labels: Elk Grove Village, Chicago CBD, Northlake, Hoffman Estates, Aurora, DeKalb | wider | 725 | 1,526 | 10,981 | 20 | "H1 2026 KEY INDICATORS* 55 Operators 1,526MW In Operation 725MW Under Construction 3.1% Colo Vacancy 10,981MW Planned 212MW H1 2026 Absorption" |
| phoenix | Maricopa, Pinal | **Phoenix**. Map labels: Mesa, Glendale, Goodyear, Chandler | close | 1,597 | 2,492 | 7,524 | 14 | "H1 2026 KEY INDICATORS* 40 Operators 2,492 MW In Operation 1,597MW Under Construction 2.7% Colo Vacancy 7,524 MW Planned 133MW H1 2026 Absorption" |
| atlanta | Douglas, Fulton | **Atlanta**. Map labels: Social Circle, Alpharetta, Lithia Springs, South Fulton | wider | 1,715 | 1,880 | 18,500 | 16 | "H1 2026 KEY INDICATORS* 31 Operators 1,880 MW In Operation 1,715MW Under Construction 2.3% Colo Vacancy 18,500MW Planned 128MW H1 2026 Absorption" |
| svl | Santa Clara | **Silicon Valley**. Map labels: San Francisco/Oakland, Silicon Valley | wider | 222 | 1,101 | 1,483 | 24 | "H1 2026 KEY INDICATORS* 44 Operators 1,101MW In Operation 222MW Under Construction 5.0 % Colo Vacancy 1483MW Planned -1.6MW H1 2026 Absorption" |
| columbus | Franklin, Licking | **Columbus**. Map labels: New Albany, Columbus | close | 2,043 | 3,488 | 11,545 | 12 | "H1 2026 KEY INDICATORS* 17 Operators 3,488 MW In Operation 2,043 MW Under Construction 2.2% Colo Vacancy 11,545MW Planned 337MW H1 2026 Absorption" |
| slc | Salt Lake, Utah | **Salt Lake City**. Map labels: West Jordan, Eagle Mountain | close | 369 | 632 | 2,080 | 30 | "H1 2026 KEY INDICATORS* 9 Operators 632 MW In Operation 369MW Under Construction 0.6 % Colo Vacancy 2,080 MW Planned 1MW H1 2026 Absorption" |
| abilene | Taylor | **West Texas**. Narrative names the Crusoe/Microsoft Abilene campus and a proposed Fort Bliss (El Paso) campus | proxy | 2,461 | 500 | 16,204 | 34 | "H1 2026 KEY INDICATORS* 6 Operators 500MW In Operation 2,461 MW Under Construction 0.0 % Colo Vacancy 16,204MW Planned 286MW H1 2026 Absorption" |
| newcarlisle | St. Joseph | none | — | null | | | | No C&W market page covers Indiana; "Indiana" appears only in the Chicago narrative's corridor sentence. |
| mtpleasant | Racine | none | — | null | | | | No C&W market page for Wisconsin/Milwaukee; no mention of Wisconsin or Mount Pleasant in the text layer. |
| richland | Richland Parish | none | — | null | | | | No C&W market page for Louisiana. Meta's Rayville, LA land purchase (1,420 acres, Jul-25) appears only in the national land table (p.4). |
| memphis | Shelby | none | — | null | | | | No C&W market page. Memphis appears only as an axis label in the cost guide's unlabeled $/MW chart. |
| councilbluffs | Pottawattamie | none (excluded explicitly) | — | null | | | 41 | "Note: Council Bluffs, Iowa, is considered part of the Omaha market and is excluded from Iowa figures." There is no Omaha page. |
| desmoines | Polk, Dallas IA | **Iowa**, statewide, excluding Council Bluffs | wider | 1,248 | 1,246 | 4,850 | 41 (top block) | "KEY INDICATORS* 15 / 55 Operators / Data Centers 1,246 MW In Operation 1248MW U/C 22.4 % Colo Vacancy 4,850 MW Planned" |
| cheyenne | Laramie | **Cheyenne** | close | 241 | 621 | 4,551 | 41 (bottom block) | "KEY INDICATORS* 4 / 19 Operators / Data Centers 621MW In Operation 241MW U/C 28.6 % Colo Vacancy 4,551 MW Planned" |
| reno | Storey, Washoe | **Reno** | close | 1,001 | 357 | 6,840 | 32 | "H1 2026 KEY INDICATORS* 6 Operators 357MW In Operation 1,001MW Under Construction 1.9% Colo Vacancy 6,840MW Planned 21MW H1 2026 Absorption" |
| quincy | Grant | **Central Washington**. Narrative cites Grant County PUD's Quincy transmission program | wider | 160 | 726 | 738 | 40 (bottom block in print, first in text layer) | "KEY INDICATORS* 6 / 34 Operators / Data Centers 726MW In Operation 160MW U/C 2.7% Colo Vacancy 738MW Planned" |
| sanantonio | Bexar | **Austin + San Antonio**, combined. Map labels: Austin, San Antonio, San Marcos | wider | 1,438 | 1,210 | 15,987 | 22 | "H1 2026 KEY INDICATORS* 28 Operators 1,210MW In Operation 1,438MW Under Construction 5.0 % Colo Vacancy 15,987MW Planned 53MW H1 2026 Absorption" |
| hillsboro | Washington OR | **Portland + Eastern Oregon**. Map labels: Umatilla, The Dalles, Prineville, Hillsboro | wider | 729 | 3,632 | 5,523 | 10 | "H1 2026 KEY INDICATORS* 24 Operators 3,632M W In Operation 729 MW Under Construction 2.5% Colo Vacancy 5,52 3MW Planned 312MW H1 2026 Absorption" |

Notes on the choice:
- **Northern Virginia:** the GW-scale acceptance item is met (7,355 MW U/C), but the figure is
  **statewide Virginia**, which includes Culpeper, Richmond and Danville. The page must say
  "Virginia (statewide)", not "Northern Virginia". For a NoVA-only number:
  - CBRE gives 2,420.2 MW, but on a colocation-only basis.
  - The NLR county dataset gives Loudoun alone 596 MW in construction, on a different basis
    again.
  - Neither may share the column (see below).
- **Proxy and wider regions** (Abilene → West Texas, Des Moines → Iowa, Quincy → Central
  Washington, San Antonio → Austin + San Antonio, Hillsboro → Portland + Eastern Oregon,
  NoVA → Virginia): the figure describes the region, not our counties. The page label should
  name the region every time.
- **The five nulls** are the single-campus markets C&W does not break out. In each case the
  tracker's itemized campus is likely most of the market, and the null note should say so
  rather than read as 0.
- **Column definition:** the column carries **U/C only**. In-operation and planned are kept in
  config for the expanded row. They are the same publisher and basis, so they can appear
  together, but never summed.

## Why not mix sources in one column

| source | basis | geography | coverage of our 20 | why not on the page |
|---|---|---|---|---|
| **CBRE** *NA Data Center Trends H1 2026* (2026-08-27) | "Wholesale" colocation inventory; hyperscale self-build excluded by inference from the labels, never stated; IT vs facility not stated | Market names only, no boundaries | 8 primary + Central WA + Austin–SA | Different basis from C&W; mixing would put a colo-only 2,420 MW next to a colo+self-build 7,355 MW as if comparable. Several rows look carried forward (below). |
| **JLL** *NA Data Center Report Midyear 2026* (2026-08-11) | Leased + hyperscaler-owned; IT vs facility not stated | Market tables gated behind a lead form (not submitted) | NoVA inventory, Phoenix U/C only | Gated; press-release figures are mostly deliveries/absorption or existing+U/C combined. |
| **NLR "Speed to Power" county viewer** (relayed by DRI, Jan 2026; read 2025-12-10) | "demand capacity" MW, third-party data | County | Loudoun, Storey, Washoe | Viewer now retired (cannot refresh or extend); different basis. |
| **Utilities** (AEP Ohio, Black Hills, Grant PUD, PGE, CPS, WEC, TVA/MLGW) | Contracted load / service capacity / queue / average MW of energy | Utility territory | Most markets | Load ≠ construction MW (handoff rule: never mixed with broker U/C). |
| **County planning** (Loudoun) | Square feet, built + U/C combined | County | Loudoun | Square feet, not MW; no separate U/C. |

## Cross-check table (context only, not published)

### CBRE H1 2026 vs C&W H1 2026, under construction (MW)

CBRE figures come from CBRE's own Infogram data tables, embedded in
https://www.cbre.com/insights/books/north-america-data-center-trends-h1-2026 (2026-08-27).

| market | CBRE U/C (colo) | CBRE inventory | C&W U/C (colo + self-build) | C&W geography | comment |
|---|---|---|---|---|---|
| Northern Virginia | 2,420.2 | 4,496.5 | 7,355 | Virginia statewide | Geography and basis both differ. CBRE: "The market's capacity under construction rose by 16.5% to 2,420.2 MW". |
| Atlanta | 2,882.0 | 1,803.2 | 1,715 | Atlanta | CBRE > C&W despite CBRE's narrower stated basis. This is unexplained: neither source publishes boundaries or inclusion rules detailed enough to reconcile them. |
| Dallas–Fort Worth | 767.7 | 1,432.8 | 1,720 | DFW | |
| Chicago | 706.8 | 910.6 | 725 | Chicago | Close agreement. |
| Phoenix | 248.0 | 1,069.2 | 1,597 | Phoenix | JLL: "1.7 GW under construction", consistent with C&W. |
| Silicon Valley | 144.0 | 509.2 | 222 | Silicon Valley | |
| Hillsboro / Portland | 170.3 | 491.4 | 729 | Portland + E. Oregon | CBRE charts title it "Portland/Hillsboro" (tighter). |
| Central Washington | 68.1 | 409.0 | 160 | Central Washington | |
| Austin–San Antonio | 550.2 | 243.1 | 1,438 | Austin + San Antonio | Both combine Austin with San Antonio. |
| Columbus, SLC, Reno, Des Moines | not tracked | — | 2,043 / 369 / 1,001 / 1,248 | | CBRE mentions them only in prose. |

### CBRE data-quality flags

- **Possible carry-forward:** identical under-construction and preleased values across
  periods.
  - NY Tri-State: 142.1 / 93.8 in H1 2025, H2 2025 and H1 2026.
  - Phoenix (176.0 / 153.5) and Hillsboro (136.8 / 121.4): identical in H1 2025 and H2 2025.
  - The Denver and Charlotte–Raleigh secondary rows are identical between H2 2025 and
    H1 2026.
- **Press-release slips:** the H1 2026 release says supply was "10.9 megawatts", against
  10,903 MW in the report. NoVA absorption is 467.6 MW in the report and 467.7 MW in the
  release.
- **Template artifact:** the Atlanta chapter's Fig 1 header reads "Central Washington", but
  the data is Atlanta's.
- **No published boundaries.** The DFW chapter's "outside of Infomart's 30-mile radius" hints
  at a radius definition, but CBRE never states one.

### Other figures by market (each on its own basis; for the expanded-row future or context)

- **Loudoun (county Planning & Zoning, as of 2026-03-01; table created 2026-08-28):**
  - Built + under construction: 233 buildings, 56,540,000 SF.
  - Approved, no building permit yet: 116 buildings, 35,653,000 SF.
  - In legislative process: 56 buildings, 20,702,000 SF.
  - Source: https://www.loudoun.gov/DocumentCenter/View/222160
- **Loudoun / Storey / Washoe (NLR Speed to Power, via DRI report Table 1, Jan 2026):**
  - MW, operating / in construction / planned:
    - Loudoun 5,333.67 / 596 / 6,349.4
    - Storey 70 / 475 / 5,495
    - Washoe 216.5 / 20 / 5
  - Source: https://www.dri.edu/wp-content/uploads/Data-Center-Report-Final-2.pdf
  - The viewer is retired.
- **Prince William:** the county dashboard lists 57 completed / 30 under construction /
  53 planned data centers. These are project counts, from press coverage
  (virginiabusiness.com, 2026-09-23). No MW figures exist.
- **Columbus (AEP Ohio letter to PUCO, 2026-02-12, via press):**
  - 5,642 MW of data-center service agreements signed under Schedule DCT, 4,842 MW of it in
    "Central Ohio".
  - 17,861 MW total under agreement.
  - This is contracted load.
- **Utah (Gardner Institute to the Legislature, Apr 2026):** statewide >920 MW operating and
  2,600 MW under construction. The basis is mixed: IT load where available, otherwise total
  utility. https://le.utah.gov/interim/2026/pdf/00003188.pdf
- **Cheyenne (Black Hills 8-K, 2026-10-06, Google project):**
  - Up to 590 MW grid-connected, plus ~2.1 GW via a third-party microgrid.
  - A 2.7 GW resource mix including reserves; peak load in 2030.
  - This is service capacity.
  - https://www.sec.gov/Archives/edgar/data/0001130464/000119312526415597/bkh-ex99_1.htm
- **Quincy (Grant PUD FAQ, 2026-08-28):** ~280 aMW of data-center energy use in 2025, and
  ~800 MW of large-load requests in the queue. https://www.grantpud.org/blog/data-center-faqs
- **Hillsboro (PGE/GridCARE, 2025-10-08):** >80 MW energized in 2026; >400 MW by 2029.
- **San Antonio (CPS, press):** up to 17 GW large-load pipeline (KSAT, 2026-07-23); ~2 GW of
  data-center load in contracting.
- **Abilene (Crusoe):**
  - The campus is 1.2 GW across 8 buildings (2025-03-18).
  - A 900 MW Microsoft expansion was announced 2026-03-30 (press: ~2.1 GW total).
- **New Carlisle:** 2,250 MW in Amazon's filing with the Indiana Utility Regulatory
  Commission (press, 2025-04-23). The NIPSCO 3 GW deal is for **other** Amazon sites.
- **Mt Pleasant (WEC Q2 2026 call):** a 2.6 GW forecast for the I-94 corridor, which spans
  Racine and Kenosha. The 3.9 GW figure adds Vantage at Port Washington.
- **Richland Parish:**
  - Meta "up to 5 GW" is the campus's ultimate potential (ENR, 2026-04-02).
  - Entergy's >5.2 GW is **new generation**, not load.
- **Memphis:** two separate TVA approvals of 150 MW each (Nov 2024; Feb 2026, press). No
  source states a total, so none is computed here.
- **Council Bluffs, Des Moines (MW):** none found from Google, MidAmerican, the counties or the
  Greater Des Moines Partnership. The Partnership gives campus square feet only.

Figures rejected because they could not be fetched and verified this session:
- Cleanview per-building MW.
- PGE's "430 MW contracted / 1.7 GW pipeline".
- Prince William's ~6.8M SF staff figure.
- Weitz's 192 MW West Des Moines campus.
- A "180 MW Microsoft Quincy" item.
- Builder figures seen only in search summaries.

Sources checked with nothing usable:
- **Gilbane:** the Q2 2026 Market Conditions Report has no market MW.
- **datacenterHawk:** public pages are facility-level only.
- **DC Byte, Structure Research, Synergy:** not reached.

## Build-cost per MW (for the scorecard's coverage gap; not this column)

- **C&W 2026 Data Center Development Cost Guide (2026-09-03):**
  - All-in greenfield cost is "$8.9 million per MW to $23.3 million per MW, excluding chips
    and GPUs", averaging $17.6M/MW.
  - Per-market values exist only as an unlabeled dot chart, so they were not read off.
  - Ranking stated in text: Silicon Valley, Chicago, NYC/NNJ, Toronto and LA are the five most
    expensive; Virginia is mid-pack.
- **JLL 2026 Global Data Center Outlook (Jan 2026), shell and core only:**
  - Printed chart labels: Chicago $12–14M/MW, N. Virginia $11–12M, and Phoenix / Dallas /
    Atlanta $10–11M each.
  - Basis: a 50 MW single-tenant air-cooled building, excluding land and IT.
  - Not comparable to C&W's all-in figures.

## Implementation notes carried forward

- Config entry per market:
  - Fields: `publisher` / `doc` / `doc_date` 2026-09-14 / `period` 2026-06-30 / `page` /
    `geography` (C&W region name + map labels) / `fit` (close|wider|proxy) / `quote`.
  - Figures: `mw_uc`, plus `mw_operating` and `mw_planned` from the same box.
  - Nulls: `null_note` naming the sources checked.
- `basis`: one value for the whole column, `colo+hyperscale-self-build (excl. captive & ICT);
  IT vs facility not stated`.
- **Stale rule:** past ~430 days from `doc_date` (≈ 2027-11-18). C&W publishes semi-annually,
  so the next refresh is the H2 2026 update, expected ~Feb–Mar 2027 (the H2 2025 edition came
  out Feb 2026).
- **Quote normalization:** keep the text-layer artifacts in `quote` as-is, or normalize
  digit spacing only. Never change a number.
- **Implementation branch:** must stack on PR #66 (`feat/markets-tightness`) or follow its
  merge. Both touch `MarketsClient.tsx`, `dc_markets.py` and `dc_markets.schema.json`.

## Evidence trail

The C&W H1 2026 text layer is committed at `docs/research/evidence/2026-10-cw-americas-h1-2026-searchtext.json`; re-grep any quote there. The other raw downloads stayed in the session scratchpad and are not committed: the CBRE pages and Infogram JSON, the JLL PDF, and the county and utility
pages. Every C&W figure above was re-grepped from the saved C&W text layer on 2026-10-07. The
CBRE NoVA 2,420.2 MW was re-grepped from the saved Infogram data.

Fetch methods:
- **cbre.com** returns a Cloudflare challenge to scripted fetches. It was read in the in-app
  browser without solving any challenge.
- **JLL's** gated report form was not submitted.
