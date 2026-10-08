# Energize dates for undated /capacity construction sites (research, 2026-10-08)

Scope: the 12 status-`c` rows in `config/capacity.json` that have no energize quarter (`energize_q`
is null or absent, or `mw` is null). Only `c` rows with a quarter ≥ 2026Q1 and a non-null MW enter
the forward Timeline (`pipeline/publish/capacity.py` `_events` → `_timeline`). Context rows
(`dupe` not null, e.g. AKAM) are excluded from `_timeline` whatever their quarter.

Baseline (published `site/public/data/capacity.json`, `published_at` 2026-10-08T12:49Z, cohort `all`):
base 41,475.5 MW, 2028Q4 cumulative 56,974.8 MW (2028Q4 adds 2,320 MW).

Evidence standard: every date or MW below is quoted verbatim from a page fetched on 2026-10-08.
Excerpts are saved under `docs/research/evidence/2026-10-energize-*.txt`. Anything that appeared
only in a search snippet or a summarizer answer is marked **UNVERIFIED** and is not used.

Conversion rules: a stated quarter → that quarter; a month → its quarter; "first half YYYY" →
YYYYQ2; a year only → YYYYQ4 (conservative end of year). For a phased site, the first phase is
dated only when the source gives that phase's MW. Otherwise the MW/date pairing is ambiguous and
the row stays null.

## 1. Summary

| Ticker | Site | MW | Current energize_q | Proposed | Rule | Source type | Verified? |
|---|---|---|---|---|---|---|---|
| GLXY | Helios Phase III | 133 | null | **2028Q4** | year only ("2028") | Primary: Galaxy Q4'25 results release, SEC 8-K exhibit | Yes |
| WULF | Abernathy JV (sale to Fluidstack) | 84 | null | keep null | n/a: capacity leaves WULF at close, already excluded from `con` | config logic | n/a |
| AMZN | Salem Township Innovation Campus, PA | 960 | null | keep null | no date; the PPA ramp is not campus energization | Primary: Amazon campus page ("TBD"); Talen 8-K | Yes (that no date exists) |
| AMZN | Richmond County, NC | 1000 | null | keep null | no date; "over the next seven years or so" is the build horizon | Secondary: WSOC | Yes (that no date exists) |
| GOOGL | Chesterfield, VA (Bermuda Hundred) | 900 | null | keep null, and **fix the row** | first building "late 2027" but its MW is undisclosed; the 900 MW looks like a different site | Secondary: Richmond BizSense; DCD on a Dominion SCC filing | Yes |
| META | Lebanon, IN | 720 | null | keep null | first phase "late 2027 or early 2028", phase MW not stated (up to six phases) | Secondary: Bloomberg, Indiana Capital Chronicle (quoting Meta VP) | Yes |
| META | Sturgeon County, AB | 720 | null | keep null | no DC date stated | Primary: Meta newsroom | Yes |
| EQIX | Global xScale portfolio (35+ facilities) | 725 | null | keep null | program total at full build-out, mostly already operating; no date | Primary: Equinix 2021 PR; Q2'26 10-Q | Yes |
| DLR | Atlanta, GA, 200 MW development | 200 | null | **2028Q4** | year only ("targeting 2028 delivery") | Primary (call transcript): DLR Q1'26 earnings call | Yes |
| AKAM | Distributed edge inference nodes (Anthropic) | null | (none) | keep MW null | no per-site or Anthropic-only MW; also a context row, excluded from timeline | Secondary: TechTarget quoting Akamai | Yes |
| META | Montgomery, AL | null | (none) | keep MW null | no company-stated MW; Epoch model estimate only | Third-party estimate (Epoch AI) | Estimate only |
| META | Cheyenne, WY | null | (none) | keep MW null | no company-stated MW; Epoch model estimate only | Third-party estimate (Epoch AI) | Estimate only |

## 2. MW added to the dated schedule if every proposal is accepted

| Quarter | Added MW | Rows |
|---|---|---|
| 2028Q4 | +333 | GLXY Helios Phase III 133 + DLR Atlanta 200 |

Effect on the `all` timeline: 2028Q4 adds 2,320 → 2,653 MW, and the 2028Q4 cumulative goes from
56,974.8 to 57,307.8 MW (57.0 → 57.3 GW). No other quarter changes, and the window still ends at
2028Q4. This was computed from the published baseline plus the two rows, not by running the
pipeline. It is inferred until a build confirms it.

## 3. Per-site detail

### GLXY: Helios Phase III (133 MW) → propose 2028Q4
- **Primary:** Galaxy, *Q4 & FY 2025 results release* (8-K exhibit), 2026-02-03.
  https://www.sec.gov/Archives/edgar/data/1859392/000185939226000009/glxy-20251231xpressrelease_.htm
  - The table gives Phase I / II / III as "133MW 260MW 133MW" with "Expected Delivery Date" "1H26 2027 2028".
  - Footnote 2, verbatim: "Will be completed in phases, with the full capacity for Phase I expected to be delivered by the end of the first half of 2026, Phase II expected throughout 2027 and Phase III expecting to commence in 2028."
- **Rule:** year only → 2028Q4. Note that "commence in 2028" is a start date, so Q4 is the conservative read.
- **Later filings:**
  - The Q2'26 10-Q (filed 2026-08-10) groups II+III: "the incremental 393 MW of critical IT load leased to CoreWeave under the Phase II … and Phase III … leases … is expected to be delivered starting in the second quarter of 2027."
  - The Q2'26 release dates only Phase II ("expected to begin in the second quarter of 2027").
  - Neither restates a separate Phase III year, and neither contradicts 2028. The Feb-2026 table is the latest Phase-III-specific statement.
  - Suggested `when` text: "final CoreWeave option; delivery to commence 2028 (Q4'25 release)".
- **Evidence:** `evidence/2026-10-energize-glxy-helios-phase-iii.txt`

### WULF: Abernathy JV, 84 MW → keep null
- The row's own `when` says "exits at close (installments through Apr 2027); excluded from con".
- Dating it would put 84 MW on the cohort timeline for capacity WULF is selling and that its `con` already excludes. Fluidstack is not a roster row, so no other row would own it either.
- No external search was needed. The null is deliberate and correct.

### AMZN: Salem Township Innovation Campus, PA (960 MW) → keep null
- **Primary:** Amazon's campus page (https://www.amazoninnovationinpa.com/salem-township-innovation-campus/, retrieved 2026-10-08). The timeline reads, verbatim: "2025 Pre-Construction/ Permitting October 2025 Construction Starts TBD Commissioning of Buildings TBD In Operation".
- **Primary, power and not campus:** Talen 8-K press release, 2025-06-11 (https://www.sec.gov/Archives/edgar/data/1622536/000162828025030559/a20250611pressreleasebusin.htm): "The power delivery schedule will ramp over time, expecting to achieve the full volume no later than 2032, with the potential to meaningfully accelerate."
  - That is a 1,920 MW PPA ramp that can serve other PA sites. It is not an energize date for this row's 960 MW.
- **UNVERIFIED, search summary only:** a "840–1,200 MW by 2029" interim ramp (POWER magazine). Not used.
- **Evidence:** `evidence/2026-10-energize-amzn-salem-richmond.txt`

### AMZN: Richmond County, NC (1,000 MW) → keep null
- **Secondary:** WSOC-TV, 2025-10-30 (groundbreaking): "Amazon will be building over the next seven years or so." It also says "When the project is completed, there will 20 buildings". No first-building date and no MW.
- **UNVERIFIED snippets, not used:**
  - Baxtel "Year Planned: 2027" (a tracker estimate).
  - DCD: capacity and opening date "not revealed".
  - Duke's Richmond County peaker (NCUC CPCN denied 2026-09-18, earlier in-service target ~2029–2030) is grid supply, not the campus.
- **Evidence:** `evidence/2026-10-energize-amzn-salem-richmond.txt`

### GOOGL: Chesterfield, VA (Bermuda Hundred), 900 MW → keep null; the row looks mis-attributed
- **Secondary:** Richmond BizSense, 2026-08-27 (https://richmondbizsense.com/2026/08/27/chesterfield-says-it-wont-approve-any-more-data-center-projects/):
  - "Google expects its first data center in Chesterfield will be up and running in late 2027. That initial building would operate on the company’s campus at 2700 Bermuda Hundred Road".
  - "The development, which is known by the codename Project Peanut, is expected to be fully built out in 2028."
  - On Project Skye (Moseley): "Construction on the first building is anticipated to begin in 2027 and would be operational in 2029."
- **Secondary:** Richmond BizSense, 2025-08-28. On Peanut's first phase: "one building with an undisclosed square footage and megawatt capacity." It also places Skye's land "on the northern edge of the planned Upper Magnolia Green technology park property near Moseley".
- **Where 900 MW comes from:** DCD, 2025-04-30, on a Dominion SCC filing:
  - "a planned 900MW hyperscale data center … The identity of the data center developer was not disclosed, but the facility is expected to be located in the Chesterfield County technology park, in Upper Magnolia Green".
  - "three 300MW phases. The first phase is slated for completion in 2031, with the following two planned for 2032 and 2033."
- **Finding (inferred):** the row joins Peanut's location (Bermuda Hundred, eastern Chesterfield) with the 900 MW / "phased to 2032" schedule of a western-Chesterfield load. That load is most likely Google's Project Skye, since Dominion's filing does not name the customer.
  - Peanut's MW is undisclosed, so its "late 2027" (→ 2027Q4) and "fully built out in 2028" (→ 2028Q4) dates have no MW to pair with.
  - The 900 MW's own first-phase date is 2031 (300 MW → 2031Q4). That is a planned load, not a `c` site.
  - The row's own source (the DCD $9B article) contains no "900" or "MW" in its body.
  - **Recommend:** keep null now, and re-curate as two rows: Peanut (`c`, MW null, late 2027) and an Upper Magnolia Green/Skye row (`p`, 900 MW, 3×300 MW 2031–33).
  - What would confirm it: the Dominion SCC docket naming the customer or the Duval substation's end user.
- **Evidence:** `evidence/2026-10-energize-googl-chesterfield.txt`

### META: Lebanon, IN (720 MW IT) → keep null
- **Secondary, quoting Meta VP Rachel Peterson:**
  - Bloomberg, 2026-02-11 (https://news.bgov.com/tech-and-telecom-law/meta-to-spend-more-than-10-billion-on-indiana-based-data-center): "The data center will span 4 million square feet and is expected to be operational at the end of 2027 or in early 2028".
  - Indiana Capital Chronicle, 2026-02-11: "Peterson said Meta hopes to be online with the first phase by late 2027 or early 2028."
- **Primary:** Meta newsroom, 2026-02-11. It says "designed to deliver 1GW of capacity once operational" and gives no date.
- **Why null:** the date applies to the *first phase*, and no source gives that phase's MW. A search summary says it is an "up to six-phase project" (UNVERIFIED). The row's 720 MW is the full 1 GW × 0.72.
  - If Eric prefers to date the row anyway, the window's end ("early 2028") maps to 2028Q2. That would put the full 720 MW too early.
- **Evidence:** `evidence/2026-10-energize-meta-lebanon-sturgeon.txt`

### META: Sturgeon County, AB (720 MW IT) → keep null
- **Primary:** Meta newsroom, 2026-07-08. No year is given; the only timing is "to plan for and meet our energy needs years in advance of this data center coming online."
- **Power proxy, UNVERIFIED:** search summaries put Pembina/MSIP/Kineticor's 932 MW Greenlight Electricity Centre (FID 2026-07-02) in service in "second half of 2030". The release PDF and the barchart/chartmill copies would not open here.
  - Even if verified, that date is the power plant's, not the data center's.
- **Evidence:** `evidence/2026-10-energize-meta-lebanon-sturgeon.txt`

### EQIX: Global xScale portfolio (725 MW) → keep null
- **Primary:** Equinix/GIC PR, 2021-06-14: "the xScale portfolio of 32 facilities will provide more than 600 megawatts (MW) of power capacity when fully built out".
  - The ">725 MW / 35 facilities" figure is from a later expansion release cited in the config; it is the same kind of program total.
- **Primary:** Q2'26 10-Q: the footprint already includes "23 xScale data centers".
- **Why null:** this is a program total at full build-out, much of it operating. It has no build tranche or date.
  - Side flag: carrying all 725 MW as `c` probably double-counts operating xScale. This is inferred; check against the op/con split note in the `flag` field.
- **Evidence:** `evidence/2026-10-energize-eqix-xscale.txt`

### DLR: Atlanta, GA, 200 MW development → propose 2028Q4
- **Primary (earnings call; third-party transcript):** DLR Q1 2026 call, 2026-04-23 (https://www.fool.com/earnings/call-transcripts/2026/04/23/digital-realty-dlr-q1-2026-earnings-transcript/).
  - Prepared remarks: "we launched construction on another 200 megawatt development site in Atlanta".
  - Andrew Power, in Q&A: "In Atlanta, we have a larger project, but before that, we have another 200 megawatts targeting 2028 delivery in a great location."
- **Q2 2026 call (2026-07-23, MarketBeat transcript):** "we also have significant activity underway in Charlotte, Atlanta, and São Paulo". No revised date.
- **Rule:** year only → 2028Q4.
  - The "larger project" is the separate 873-acre gigawatt parcel. It is not this row.
- **Evidence:** `evidence/2026-10-energize-dlr-atlanta-200mw.txt`

### AKAM: Distributed edge inference nodes (Anthropic), MW null → keep null
- **Secondary:** TechTarget, 2026-09-28, quoting Akamai's 2026-09-24 call: "Akamai did not specifically disclose the power requirement for the Anthropic contract. The company said the $14.4 billion portfolio of large, multiyear cloud contracts it has signed this year, including the Anthropic agreement, will require 95-105 MW of power."
  - The figure is portfolio-wide (it also covers the CPU expansion and the robotics deal).
  - Sites are 10–30 MW colo leases.
- The 8-K (filed 2026-09-24) gives no MW.
- AKAM is `dupe: "context"`, so `_timeline` skips it regardless. A MW here would not move the Timeline.
- **Evidence:** `evidence/2026-10-energize-akam-edge-inference.txt`

### META: Montgomery, AL and Cheyenne, WY (MW null) → keep null
- Meta states no MW for either site. Its pages give $ and sq ft only, and the Alabama PSC's new ≥150 MW contract-summary rule is too recent to have produced a Meta summary that I could find.
- **Epoch AI estimates** (satellite + cooling model, updated 2026-10-05; not company-stated):
  - Montgomery: "153 MW of IT power" now (Buildings 1–2 "operational"), projected "358 MW IT power" in Q1 2027.
  - Cheyenne: "152 MW of IT power" now ("Both buildings estimated to be operational"), projected "207 MW IT power" in Q1 2027.
- **Implication (inferred):** both rows may be partly operating, so the `c` status may be stale.
- **Option for Eric** (the repo already uses Epoch for Meta Prometheus): split each row into an `o` row for the current MW and a `c` row dated 2027Q1 for the delta (Montgomery +205, Cheyenne +55).
  - This does not meet the "stated MW" standard, so it is not counted in section 2.
- **Evidence:** `evidence/2026-10-energize-meta-montgomery-cheyenne.txt`

## 4. Dead ends
- **Helios Phase III:** the Q1'26 release (8-K 2026-04-28) does not mention Phase III. The Phase II notes launch deck (8-K 2026-07-22) covers Phase II only.
- **Amazon Salem / Richmond:**
  - No Amazon NC campus page exists (`amazoninnovationinnc.com` does not resolve).
  - No PPL or Duke filing found that gives a campus energization date or MW.
  - Salem Township minutes and the Times Leader were not searched in depth.
- **Google Chesterfield:**
  - The county data-center page and the DCD $9B article give no MW.
  - The 12onyourside (2026-07-16) open-house piece came up in search only and was not opened.
- **Meta Lebanon:** the per-phase MW was not found. Lebanon, Boone County, and IEDC documents were not opened.
- **DLR Atlanta:** "ATL15/ATL16, Forest Park, >200 MW, estimated completion 2028" (New Project Media) and a "289 MW Cobb County, Q4 2027" (Datacentres.com) appeared in search only. They are UNVERIFIED and may be different projects; neither is used.
- **Meta Montgomery / Cheyenne:**
  - Baxtel's "scheduled to open by 2027" (Cheyenne) and Industrial Info's "buildings 3 and 4 in 2027/2028" appeared in search only and are UNVERIFIED.
  - No Wyoming PSC or Cheyenne Light docket with a Meta MW was found.
- **Blocked fetches:**
  - DCD and the Indiana Capital Chronicle return 403 to curl; both were read through a browser instead.
  - Bloomberg Government was readable by curl.
  - The Pembina release PDF, barchart, and chartmill were unreachable, so the Greenlight date stays UNVERIFIED.

## Outcome (2026-10-08, applied in `config/capacity.json`)

- **New energize dates:**
  - GLXY Helios Phase III → `2028Q4`.
  - DLR Atlanta 200 MW → `2028Q4`.
  - Together they take the 2028Q4 cumulative from 56,974.8 to 57,307.8 MW, checked by running the
    publisher.
- **GOOGL Chesterfield (Bermuda Hundred):** MW 900 → null in both the sites row and the geo row.
  The `when` text now names the Upper Magnolia Green Dominion filing as unattributed, and the pipe
  text is fixed. Google's company-level `con` (a curated estimate) is unchanged, per the roster's
  precedent that site edits never move company totals.
- **Unchanged:** the other ten sites stay undated.
