# /capacity freshness review: every tracked company (research, 2026-10-17)

Scope: all 29 companies in `config/capacity.json`, the 10 hyperscalers and the 19 neoclouds,
ex-miner landlords and operators. For each one we checked every tracked site (operating, under
construction, planned, secured) for status, MW and timing changes. We also looked for new,
cancelled and sold sites, and for newer filed capacity totals. The previous curation was
2026-10-02, and `as_of_curated` is now 2026-10-17.

Raw research: `docs/research/2026-10-17-capacity-review-findings.json`, one entry per company.
Each entry holds the rows confirmed as current, every proposed change with its verbatim quote,
the unverified leads, and notes. Not every proposal there was applied. Section 3 lists what
was, and section 2 lists where the curator departed from the proposal.

## Evidence standard and how sources were read

- **Quotes are verbatim.** Every applied change rests on a passage quoted exactly from a fetched
  source. The excerpts are saved under `docs/research/evidence/2026-10-17-cap-*.txt` (155
  files). Each file header gives the URL, publisher, publication date and retrieval method. A
  script checked every quote in the findings file against its evidence file.
- **Direct fetch was blocked.** This session's network policy refused curl and WebFetch to SEC,
  company IR and news hosts. Sources were read in full through the TradingView connector
  (newswire stories from GlobeNewswire, Business Wire, PR Newswire, Reuters, Dow Jones and
  dpa-AFX, plus Quartr call and conference transcripts) and through FMP (call transcripts and
  press-release leads). A change that rests only on a press-release lead is marked medium
  confidence in the findings.
- **Snippets are never used.** Anything seen only in a search snippet or an AI summary is listed
  under `unverified` and left out of the config.
- **Citations must be real links.** A `src` entry is added only for a specific article URL that
  appeared in fetched text. IR landing pages and Quartr transcript IDs are not links, so they
  were dropped. Those transcripts are cited through their evidence files instead.
- **Quarter rules** follow the 2026-10-08 research (`2026-10-capacity-energize-dates.md`):
  - A stated quarter or month maps to its own quarter. 1H maps to Q2, 2H to Q4, and a bare year
    to Q4.
  - A phased site is dated only when the source gives the first phase's MW. Otherwise
    `energize_q` stays null.
- **Grid MW stays out of the critical-IT field.** Where a source gives only grid or utility MW,
  the row's `mw` is null and the text says "grid". The exception is landlord rows that already
  carry grid MW (KEEL, CIFR, GLXY, IREN pipeline sites), which keep that basis and say so.
- **Market tags follow county lists.** A `market` tag means the site sits in that market's
  county list in `config/dc_markets.json`. So Hampton GA (Henry Co.), Hunt Co. TX, Crittenden Co.
  AR and an Atlanta parcel in an undisclosed county carry no tag.

## 1. Effect on the published tracker

These totals come from running `pipeline/publish/capacity.build` against `store/` with the
edited config (including the PR 127 review fixes in section 2a), as of 2026-10-17. Both
`capacity.json` and `dc_markets.json` validate against their schemas.

| Cohort | Operating MW | Construction MW | Planned MW | Timeline cumulative MW |
|---|---|---|---|---|
| all | 41,476 → 41,490 | 33,871 → 37,891 | 49,818 → 44,883 | 57,308 → 56,186 (2028Q4) |
| neocloud | 3,754 → 3,770 | 8,381 → 8,551 | 13,558 → 11,223 | 11,593 → 11,465 (2028Q4) |
| hyperscaler | 37,721 → 37,721 | 25,490 → 29,340 | 36,260 → 33,660 | 45,715 → 44,721 (2028Q4) |

- **Counts:** site rows 174 → 242, map pins 121 → 137, unmapped entries 23 → 74, tenant edges
  29 → 37.
- **Timeline:** cumulative MW at 2026Q4 goes 45,914 → 43,576 and at 2028Q4 goes 57,308 →
  56,186. The curve falls even though construction MW rose, for three reasons:
  - Abilene's delivered buildings left the schedule. Oracle's `op` already counted them.
  - Doña Ana, Saline Twp, Port Washington and Lappeenranta are under construction but undated:
    no first-phase MW and no full-build quarter is public.
  - Phased sites now enter at the quarter their MW is in service, not at first delivery. That
    shifts 2027 lower. Grid-only figures (e.g. the Muskogee expansion) no longer count.

  Cohort totals (`op`/`con`/`plan`) are unaffected by dating.

## 2. Curator decisions that differ from the raw proposals

- **ORCL.**
  - *Construction and planned totals:* `con` 2,150 → 5,000 and `plan` 1,600 → 0. Doña Ana,
    Saline Twp and Port Washington are now under construction, with customer delivery beginning
    H1/H2 2027. They are undated on the timeline; see section 2a. Their combined planned row was the only planned capacity the row carried, so leaving
    `plan` at 1,600 would have counted them twice.
  - *Site MW:* Doña Ana and Port Washington drop from 2,200 and 1,300 MW (press facility power;
    2.2 GW was the Bloom fuel-cell plan) to ~1,000 MW each. Oracle's co-CEO said on the 9/10/26
    call: "We talk about these sites kind of as being around a gigawatt a piece." Saline keeps
    1,400 MW.
  - *Duplicate row removed:* "OpenAI add'l Stargate 4,500 p" counted the same five campuses a
    second time.
  - *Abilene split:* 618 MW operational (Oracle: 6 of 8 buildings, 75% delivered) and 206 MW
    under construction. The 206 is our arithmetic from Oracle's 75%.
- **IREN.**
  - *Construction and planned totals:* the agent proposed `con` 330 → 750, derived from IREN's
    YE2027 IT targets. Applied instead: `con` 530 and `plan` 530. That moves only Sweetwater 1's
    first phase, the one with a stated build: 300 MW gross, which is ≈200 MW IT at IREN's stated
    "200 MW of IT load for 300 MW of gross capacity".
- **CORZ.**
  - *Hunt County:* stays `s`, though it has a signed AMD lease and pre-construction is under
    way. Its 285 MW also sits inside the 530 MW AMD five-site row, so moving it to `c` would
    double-count it on the timeline.
  - *AMD lease rates:* the $/kW-month figures were not added, because their units are uncertain.
- **CRWV.**
  - *Map pins:* no CRWV pins were added. CRWV is `dupe: tenant`, and its campuses are pinned
    under their landlords. Taloja, Lancaster and Conapto are therefore not on the map; see
    follow-ups.
- **EQIX.**
  - *Hampton:* added as ~240 MW `c`. The US xScale JV planned row drops 1,500 → 1,260, and
    `con`/`plan` 350/1,500 become 590/1,260 (total unchanged).
  - *Dallas DA12 (~67 MW):* not added. It is a retail IBX, and the EQIX row deliberately
    excludes retail.
- **GOOGL.**
  - *New Florence:* moved `p` → `c` because Ameren says construction began. `con`/`plan` become
    6,000/5,500 (total unchanged).
  - *Cheyenne:* the proposed `plan` +1,300 MW was not applied. Linking Black Hills' "1.8 GW
    project" to Google is inferred.
- **DOCN.**
  - *Pins:* the named 2026 AI data centers are pinned at metro level. Kansas City is untagged;
    Memphis carries the `memphis` tag. Richmond is unmapped (no MW). `geo_note` now says so.
  - *Memphis:* moved from construction to operating, so `op`/`con` go 70/65 → 85/50. The CFO said
    on 9/8 that all three 2026 data centers had been turned on.
- **Duplicate edges.** Two tenant edges came from two agents each and were added once:
  Google → XAI, and Tencent → ORCL (press-reported, unconfirmed).
- **XAI.** The two unnamed SpaceX hosting deals ($6.7B over six months, and ~$1.11B/month from
  12/1) are one tenant row, since they may be the same counterparty.

## 2a. Fixes from the PR 127 review

The review is in `docs/reviews/2026-10-17-pr-127-review.md`. The publisher puts a construction
row's whole MW in its `energize_q` quarter, and the page reads `mw` as critical IT. The first
pass broke both rules in places.

- **P1: whole campuses dated to an unquantified first delivery.** These rows had their dates
  fixed:
  - *Oracle:*
    - Shackelford goes back to 2028Q4, its full build. First delivery is H1 2027, with no
      phase MW given.
    - Doña Ana, Saline Twp and Port Washington are now undated. Oracle gives only the start of
      customer delivery (H1/H2 2027), with no phase MW and no full-build date.
  - *Nebius:* Lappeenranta is now undated ("first capacity 2027", no phase MW).
  - *DLR:* the Northern Virginia buyout splits into 192 MW at 2027Q2 and 96 MW at 2028Q2. The
    release says two buildings stabilize in H1 2027 and the third in H1 2028, but not which
    one is later.
  - *CoreWeave and Galaxy:*
    - CoreWeave's Helios copy splits into Ph II (260 MW, 2028Q1) and Ph III (133 MW, 2028Q4).
    - Galaxy's own Helios Phase II row goes 2027Q2 → 2028Q1 to match. Its eight halls start in
      Q2 2027, seven are online by YE27, and the last comes in early 2028. That row predates
      this PR; it is re-dated here so the two rows agree.
  - *Dalton:* CORZ's row and CoreWeave's copy go 2026Q4 → 2027Q1 ("complete early 2027").
  - *Applied Digital:* Polaris Forge 2 splits into ~50 MW at 2026Q4 and ~150 MW at 2027Q1. The
    first figure comes from APLD's "300 MW of total critical IT online across North Dakota by
    the end of this calendar year", against the 250 MW live at PF1.
  - *TeraWulf:* CB-4 goes back to 2026Q4. The late-September date was the first hall only;
    the rest phases through 2H 2026.

  - *Rows dated at first power before the 2026-10-08 rule*, re-dated here too:
    - CORZ's AMD five-site row moves to 2028Q4. Deliveries begin in 2027 and ramp "through
      the end of 2028".
    - WULF Hawesville moves to 2028Q1. All 401 MW of critical IT is due "by early 2028".
    - RIOT Rockdale's frontier-lab lease splits into 96 MW at 2027Q4 (rent from December 2027)
      and 95 MW at 2028Q2 (full deployment June 2028).
    - Stargate Milam moves to 2028Q4. Its first building's MW is not stated.

  `test_dated_construction_rows_name_no_later_completion` now fails any dated construction row
  whose own text names a later completion, with no exceptions. The publisher's docstring
  (`pipeline/publish/capacity.py`) now states that the curated quarter follows this rule. The
  free-text parser's first-power reading only covers rows with no curated quarter.
- **P2: grid-only figures in the critical-IT field.** These new or re-stated rows now carry
  `mw` null and keep the grid figure in their text:
  - IREN: Sweetwater 1 remainder, Sweetwater 2, Kiowa, Bundey, Badajoz, other Nostrum sites and
    Redbank (campus scale).
  - Cipher: Colchis, Mikeska, McLennan, Stingray Phase II, the Barber Lake expansion and Odessa.

  Their pins move to `geo_unmapped` with a "grid MW only" reason, as `geo_note` prescribes for
  sites with undisclosed MW. `test_grid_only_figures_never_fill_the_critical_it_field` fails
  any row or pin whose text labels its figure grid, gross or utility without a stated IT
  figure, with no exceptions. The pre-existing grid-basis rows are fixed the same way:
  - *CORZ Muskogee expansion:* the 330 MW was not stated anywhere. Core Scientific's close
    release gives ~440 MW of gross grid power, a 1.5 GW gross / ~1.0 GW leasable plan, and
    "the next approximately 82 MW" for "its customer" from 2H 2027
    (`evidence/2026-10-17-cap-corz-polaris-close.txt`). The row is now null and undated. That
    82 MW likely sits inside the AMD five-site row.
  - *GLXY Helios II:* 830 MW gross.
  - *WULF Muskie:* 1 GW of contracted utility service.
  - *KEEL:* Panther Creek (350 MW of PPL utility capacity), Scrubgrass (a 750 MW load study)
    and Sherbrooke (a 96 MW PPA, which the guard missed because its text said "PPA").
  - *BTDR Clarington:* 570 MW grid.

  Meta's Hyperion and El Paso rows now state the tracker's existing gross × 0.72 IT basis in
  their text, as Lebanon and Sturgeon already did.
- **Company `plan` totals re-based to critical IT.** Three `plan` totals were the same grid
  figures. None of these companies discloses a critical-IT figure for them, so they are
  excluded rather than converted:
  - *GLXY:* 830 → 0. It was Helios II's 830 MW gross, and Galaxy has no other planned IT
    figure; the gross pipeline stays in `pipe`.
  - *KEEL:* 556 → 110. Panther Creek's 350 MW of utility capacity and Sherbrooke's 96 MW PPA
    are out. Sharon's "one 110-megawatt phase" stays, since its basis is not stated
    (`evidence/2026-10-17-cap-keel-q2-zacks-sharon-moses.txt`).
  - *WULF:* 2,320 → 1,320. Muskie's 1 GW of utility service is out. Chesapeake (TeraWulf:
    "up to 1 GW of data center capacity") and Lake Hawkeye (320 MW critical IT) stay.

  Neocloud planned MW falls 13,499 → 11,223. EV per weighted MW rises for the three:
  GLXY 17.2 → 28.1, KEEL 11.1 → 45.2, WULF 8.0 → 10.5 ($M/MW). Each row's `flag` states
  what its `plan` counts.
- **P2: A901's full-delivery quarter.** The row is now dated 2027Q2, when Bitdeer says all
  67 MW of critical IT are due. The Q1 start had no stated MW, so it stays in the text.
  `test_full_capacity_quarter_survives_an_unquantified_earlier_ramp` pins this: the curated
  quarter outranks the Q1 date the free-text parser would pick.

Section 3 below shows each row's final value after these fixes.

## 3. Applied changes, by company

The list below is generated from the applied decision log. Map-pin and citation housekeeping
that mirrors a site change is not listed. The row's own `src` list carries the sources.

### CRWV (CoreWeave)

- **new site:** Taloja, Navi Mumbai (AdaniConneX) — 3×80 MW: 240 MW, `s`. New since 2026-10-02: CoreWeave's India entry — three 80 MW buildings at AdaniConneX's Taloja campus, CoreWeave sole tenant, first phase mid-2028, option to double. Source: CoreWeave.
- **site:** Helios (Galaxy) — Ph I: 133 MW, `o`. The row's 800 MW is GROSS power, not critical IT (Galaxy: 'the entirety of the 800 gross MW'); CoreWeave's Helios critical IT = 133 (Ph I) + 260 (Ph II) + 133 (Ph III) = 526 MW, matching the GLXY tenant row. Source: Galaxy Digital.
- **new site:** Helios (Galaxy) — Ph II: 260 MW, `c`, energize 2028Q1 (last of 8 halls); Ph III: 133 MW, `c`, energize 2028Q4. Remaining CoreWeave critical IT at Helios; split and re-dated in the review fixes. Source: Galaxy Digital.
- **site:** Core Scientific — 4 campuses (billing): 437 MW, `o`. The single 590 MW 'c' row (energize_q 2025Q4, now past) is stale: CORZ reached 437 billable MW in mid-July with four of the five CoreWeave campuses substantially complete; only Dalton Ph II (150 MW) remains. Source: Core Scientific.
- **new site:** Core Scientific — Dalton GA Ph II: 150 MW, `c`, energize 2027Q1. Remaining CoreWeave capacity at Core Scientific, delivering from end-2026 and complete early 2027. Source: Core Scientific earnings call.
- **site:** Applied Digital — Ellendale PF1 Bldg 1–2: 250 MW, `o`. '100 MW live' is stale: Polaris Forge 1 (leased to CoreWeave) reached 250 MW live on 2026-10-01; Bldg 3 (150 MW) is still under construction. Source: Applied Digital.
- **new site:** Applied Digital — Ellendale PF1 Bldg 3: 150 MW, `c`, energize 2027Q4. Remaining 150 MW of the CoreWeave Ellendale lease. Source: Applied Digital.
- **site:** First self-builds (2–3 sites; unnamed): MW n/d, `c`, energize 2026Q4. Status 'p' is stale: management says the first several self-builds are already well underway, with the first site online later in 2026. Source: CoreWeave; Goldman Sachs conference.
- **new site:** Lancaster, PA — 100 MW (exp. to 300 MW): 100 MW, `p`. Material announced CoreWeave site missing from the row (not named anywhere in sites). Source: CoreWeave.
- **new site:** Conapto Stockholm, Sweden (2 campuses): MW n/d, `o`. Named European site (CoreWeave says >1 GW of contracted power is outside the US, yet the row lists no European site). Source: CoreWeave.
- **field:** `pipe`. Adds the filed-call figure that >1 GW of contracted power is outside the US, and the post-call India deal. Source: CoreWeave.
- **flag:** `flag`. Reader-facing financing-risk context for a debt-funded build-out: the week of Oct 12–16 CoreWeave bonds traded at distressed levels. Source: Reuters.
- **tenant:** Microsoft → CRWV. The '~45% of CRWV rev' share has no current basis; Reuters (citing company filings) puts Microsoft at ~67% of 2025 revenue. Source: Reuters.
- **tenant:** OpenAI → CRWV. Replace the bare 'committed' with the disclosed contract values. Source: Reuters.
- **new tenant:** Anthropic → CRWV. Material named customer missing from the demand map. Source: Reuters.

### ORCL (Oracle (OCI))

- **site:** Abilene TX (Stargate I, Crusoe) — bldgs 1–6: 618 MW, `o`. Oracle's 9/10/26 call says 6 of 8 Abilene buildings (618 MW, 75% of capacity) are delivered — supersedes the Epoch 10/02 satellite read (~420 MW, 4 bldgs). Source: Oracle Corporation.
- **new site:** Abilene TX (Stargate I, Crusoe) — bldgs 7–8: 206 MW, `c`, energize 2026Q4. Remaining two Abilene buildings. Source: Oracle Corporation.
- **site:** Shackelford County TX (Vantage): 1400 MW, `c`, energize 2028Q4 (full build). First customer delivery is H1 CY2027 per Oracle, with no phase MW. Source: Oracle Corporation.
- **removed:** Doña Ana NM (STACK) / Saline MI (Related) / Port Washington WI (Vantage). Replace the combined 'p' row with three 'c' rows (below). Source: Oracle Corporation.
- **new site:** Doña Ana County NM (Project Jupiter, STACK): 1000 MW, `c`, undated. Customer delivery begins H1 CY2027 per Oracle, with no phase MW and no full-build date; Oracle calls construction 'definitely on track'. Source: Oracle Corporation; Reuters; Proactive Investors; Benzinga; Invezz; 24/7 Wall St.
- **new site:** Saline Township MI (Related Digital): 1400 MW, `c`, undated. Customer delivery begins H2 2027 per Oracle, with no phase MW; the network core is ahead of schedule. Source: Oracle Corporation.
- **new site:** Port Washington WI (Vantage): 1000 MW, `c`, undated. Delivery begins H2 CY2027 per Oracle, which said on 9/10/26 the build is 'very on track'; Aterio flags a mid-2028 risk. Source: Oracle Corporation; Business Wire; Oracle.
- **removed:** OpenAI add'l Stargate (Oracle ~$300B/5yr). DOUBLE COUNT: the 4.5 GW / ~$300B Oracle-OpenAI deal (Jul 2025) IS the capacity at the named campuses, which Oracle contracted Aug-Oct 2025 and lists as its '5 largest sites' (Abilene, Shackelford, Doña Ana, Saline, Port Washington). Source: Oracle Corporation.
- **field:** `con` = 5000. Concrete disclosed driver: Oracle says Doña Ana, Port Washington and Saline are under construction (customer delivery H1/H2 CY2027) and 'around a gigawatt a piece'. Source: Oracle Corporation. Note: con = sum of the construction rows; Saline kept at 1,400 MW — Oracle's 'around a gigawatt a piece' was said of New Mexico and Wisconsin.
- **curator:** plan 1600→0: the three campuses it estimated (Doña Ana/Saline/Port Washington) are now construction rows; no named planned Oracle campus remains.
- **flag:** `flag`. Record the planned->construction moves and refresh the 'Watch' items: post-9/24 Jupiter developments (permit, gas line, El Paso Electric power), Port Washington delay-risk report, and the 10/28 Investor Day and 12/14 Q2 dates. Source: Benzinga; Business Wire; Invezz; Oracle Corporation; Proactive Investors.
- **field:** `econ.power`. Site-level power plans are now disclosed: Oracle's call (Bloom at NM; grid in WI) and Oracle's 10/2/26 Point Beach release. Source: 24/7 Wall St.; Oracle; Oracle Corporation.
- **field:** `econ.capexmw`. Q1 call restated the FY27 capex guide. Source: Oracle Corporation.
- **new tenant:** Tencent → ORCL. Credible press (FT, carried by Reuters and MarketWatch) reports a new large Oracle tenant. Source: MarketWatch; Reuters.

### NBIS (Nebius)

- **site:** Vineland NJ (Microsoft): 300 MW, `c`, energize 2026Q4. 'majority H2 2026' needs a fresher status. Source: Nebius; Stocktwits.
- **site:** Lappeenranta, Finland (AI factory): 310 MW, `c`, undated (first capacity 2027, no phase MW). Nebius announced construction rather than an option or LOI, so `s` understated it. Source: Nebius.
- **new site:** Rotterdam, NL (VOLT gigafactory) — LOI, REPORTED: MW n/d, `s`. New since 10/02. Source: GuruFocus.
- **site:** UK (Kao Data Harlow · Vantage CWL1 Newport, Wales) · Estonia · addl Finland: MW n/d, `s`. Names the Kao Data Harlow deployment (10-year agreement, June 2026) that the UK row omits. Source: Kao Data; Nebius.
- **field:** `pipe`. The YE 2026 5 GW target has been reached (CEO at Citi TMT), and the Q2 call gave a 2026 connected-power guide of 800 MW–1 GW that the row lacks. Source: Nebius; Nebius CEO.
- **flag:** `flag`. Same basis as the pipe update; op 185 looks low against an 800 MW–1 GW connected-power guide, but connected ≠ active, so op is left for the Q3 (10/22) re-pull. Source: Nebius; Nebius CEO.
- **tenant:** Meta → NBIS. The terms omit the $12B dedicated capacity committed in the 3/16/26 agreement; the CEO says the second contract delivers Q1–Q2 2027. Source: Nebius; Nebius CEO.
- **site:** Béthune, France (ex-Bridgestone plant): 240 MW, `c`. The CEO confirmed the French site is the ex-Bridgestone tyre plant (= Béthune) and described it as a data center now, so it is no longer only 'REPORTED' and has moved past 's'. Source: Nebius CEO at Citi conference.

### APLD (Applied Digital)

- **site:** PF1 — Bldg 2 (Ph1 + Ph2): 150 MW, `o`. Company's own Q1 FY27 release dates the two 75 MW RFS events July 1 and October 1, 2026 (2026-10-02 was the announcement date). Source: Applied Digital.
- **site:** Polaris Forge 2 (Harwood): split into ~50 MW `c` energize 2026Q4 (APLD's 300 MW ND target less 250 MW live) + ~150 MW `c` energize 2027Q1 (full early 2027). Source: Applied Digital.
- **site:** Polaris Forge 3 — Center, ND (Oliver Co.) — LEASED: 300 MW, `c`, energize 2027Q4. Location is now public: the company names Center (Oliver County), ND as home of PF3, and MDU's ESA release says 'near Center'. Source: Applied Digital; Applied Digital earnings call; MDU Resources.
- **site:** Delta Forge 2 — Alabama — LEASED: 210 MW, `c`, energize 2028Q2. Company now states DF2 is in Alabama (previously 'a new southern state'). Source: Applied Digital.
- **new site:** Finland campus (up to ~1 GW power) — SECURED: MW n/d, `s`. First non-US site, announced 2026-10-06. Source: Applied Digital; Applied Digital earnings call.
- **field:** `nd` = 2.7. Aug 31, 2026 balance sheet: $6.4B debt − $3.7B cash, equivalents and restricted cash ≈ $2.7B (was $0.8B at 5/31/26) as Q1 capex of $2.07B deployed note proceeds. Source: Applied Digital; Applied Digital earnings call.
- **field:** `ndflag`. Refresh to latest filed balance sheet. Source: Applied Digital; Applied Digital earnings call.
- **flag:** `flag`. FY27 Q1 (reported 2026-10-07) adds forward delivery guidance and the Finland site. Source: Applied Digital; Applied Digital earnings call.
- **field:** `pipe`. Management's FY27 Q1 framing; the 'actively marketed' MW was not restated by management in fetched text (an analyst cited 1.3 GW — see unverified). Source: Applied Digital earnings call.
- **field:** `econ.anchor`. Matches the tenant split above. Source: Applied Digital.
- **field:** `econ.capexmw`. Latest quarterly purchases of property and equipment. Source: Applied Digital.
- **curator:** tenant split: IG hyperscaler 1010 → tier-one IG hyperscaler 810 + PF2 IG hyperscaler 200.

### CORZ (Core Scientific)

- **review fix:** AMD five-site program: 530 MW, `c`, energize 2028Q4 (deliveries begin 2027 and ramp "through the end of 2028"; per-site MW n/d). Source: Core Scientific earnings call.
- **review fix:** Muskogee expansion (Polaris DS): MW n/d (was an unstated 330), `c`, undated. The release gives ~440 MW of gross grid power, a 1.5 GW gross / ~1.0 GW leasable plan, and the next ~82 MW to its customer from 2H 2027; its pin is unmapped. Source: Core Scientific via Business Wire.
- **site:** Muskogee, OK (CoreWeave): 70 MW, `o`. The 70 MW is the Muskogee slice of CoreWeave's 590 MW (the record's five CoreWeave rows sum to 590). Source: Core Scientific earnings call.
- **site:** Dalton, GA (CoreWeave Ph I–II): 175 MW, `c`, energize 2027Q1. This is CoreWeave's Dalton capacity; Ph II's last ~150 MW delivers from end-2026 and completes early 2027. Source: Core Scientific earnings call.
- **field:** `pipe`. Spell out the AMD reservation and the separately disclosed new-site pipeline. Source: Core Scientific CDO at H.C. Wainwright conference; Core Scientific earnings call.
- **field:** `econ.anchor`. Matches the tenant split. Source: Core Scientific earnings call.
- **flag:** `flag`. Adds the remaining CoreWeave timing and the Q3 date (Nov 5, not late Oct). Source: Core Scientific; Core Scientific earnings call.
- **curator:** tenant split: AMD 530 → AMD direct 380 + AMD-backed neocloud 150.

### GLXY (Galaxy Digital (Helios))

- **review fix:** `plan` = 0 (was 830, Helios II's gross MW). No critical-IT figure is disclosed for Helios II or the new Texas sites. Source: Galaxy Digital earnings call.
- **site:** Helios II expansion (830 MW gross): MW n/d (grid-only figure kept in the text), `s`. Adds the stated energization timing and lease status. Source: Galaxy Digital earnings call.
- **site:** Helios III + IV interconnects (2 × 1 GW gross): MW n/d, `p`. Galaxy now defines the Helios upside as 2 GW gross across two POIs (Helios III and IV). Source: Galaxy Digital earnings call.
- **new site:** Merlin — McGregor, TX (500 acres): MW n/d, `s`. Second Galaxy campus, announced 2026-07-28 (missed by the 10-02 curation). Source: Galaxy Digital; Galaxy Digital earnings call.
- **new site:** Caspian (TX) — 700 MW gross: MW n/d, `s`. New Texas site disclosed on the Q2 call (most advanced of the new sites). Source: Galaxy Digital; Galaxy Digital earnings call.
- **new site:** Selene (TX) — 900 MW gross: MW n/d, `s`. New Texas site disclosed on the Q2 call. Source: Galaxy Digital earnings call.
- **field:** `pipe`. Galaxy now states >5.7 GW of potential capacity (Q2 call, repeated in the 10/13 PR); the ~3,100 figure predates the three new sites. Source: Galaxy Digital; Galaxy Digital earnings call.
- **flag:** `flag`. Reflects the new sites, Helios II timing and the Q3 date. Source: Galaxy Digital; Galaxy Digital earnings call.

### WULF (TeraWulf)

- **review fix:** `plan` = 1,320 (was 2,320). Muskie's 1 GW of utility service is excluded; Chesapeake (up to 1 GW of data center capacity) and Lake Hawkeye (320 MW critical IT) stay. Source: Kentucky Power (AEP) via PR Newswire; TeraWulf Q2'26 earnings call.
- **review fix:** Justified Data — Hawesville KY (Anthropic): 401 MW, `c`, energize 2028Q1 (initial services 2H 2027, full 401 MW of critical IT by early 2028). Source: TeraWulf via GlobeNewswire (8/24/26).
- **site:** Lake Mariner — CB-4: 168 MW, `c`, energize 2026Q4. The first hall's rent was targeted for late September and the rest phases through 2H 2026, so the row is dated to the full phase. Source: TeraWulf Q2'26 earnings call.
- **site:** Muskie Data — Grayson KY: MW n/d (1 GW of utility service kept in the text), `p`. Kentucky Power's 10/05/26 release: contracted demand rose 500 MW → 1 GW and the second 500 MW moved from 2030 to 2029. Source: Kentucky Power (AEP) via PR Newswire; TeraWulf; Benzinga.
- **site:** Chesapeake Data — Morgantown MD: 1000 MW, `p`. Q2 call: FERC cleared the Morgantown acquisition on 7/29/26; acquisition not yet closed (no closing announcement found through 10/17). Source: TeraWulf Q2'26 earnings call.
- **site:** Abernathy JV — sale to Fluidstack agreed 7/06: 84 MW, `c`. Q2 call quantifies the installments and confirms the first $250M was received in July 2026, so the 'NOT closed' wording in ndflag is stale (see company_update). Source: TeraWulf Q2'26 earnings call.
- **site:** Lake Hawkeye (Cayuga) — Lansing NY: 320 MW, `p`. The location is now public: Needham (via Stocktwits) puts Lake Hawkeye at the Cayuga site in Lansing NY, and the CEO says 'Cayuga Lake Hawkeye' on the Q2 call. Source: Stocktwits; TeraWulf Q2'26 earnings call; The Block.
- **field:** `ndflag`. Abernathy cash has partly arrived (so 'NOT closed' is stale), and the 10/05 8-K flags new secured debt coming. Source: Reuters; TeraWulf Q2'26 earnings call.
- **flag:** `flag`. Reflect the 10/05 Muskie amendment and the Chesapeake/CB-4 status. Source: Kentucky Power.

### HUT (Hut 8)

- **tenant:** IG hyperscaler (Nvidia per WSJ/FT, unconfirmed) → HUT. WSJ, Reuters and FT (per Benzinga) name Nvidia as the Beacon Point tenant. Source: Benzinga; Dow Jones Newswires.
- **tenant:** Fluidstack → HUT. Q2 call states both facts directly. Source: Hut 8 Q2'26 earnings call.
- **field:** `pipe`. Q2 call explains what the 8.7 GW includes and excludes. Source: Hut 8 Q2'26 earnings call.
- **field:** `econ.anchor`. Same evidence as the two tenant updates. Source: Benzinga; Hut 8 Q2'26 earnings call.

### CIFR (Cipher Digital (ex-Cipher Mining))

- **removed:** ERCOT 'Batch Zero'. The 2 GW placeholder equals Colchis 1 GW + Mikeska 500 + McLennan 500, which Cipher has now named and which got Batch Zero conditional designations in Sep 2026. Source: Cipher Digital Q2'26 business update call.
- **new site:** Colchis JV — West TX (AEP direct connect): MW n/d (grid-only figure kept in the text), `p`. Company-named 1 GW site. Source: Cipher Digital CFO at KBW Virtual AI Summit; The Block.
- **new site:** Mikeska TX: MW n/d (grid-only figure kept in the text), `p`. Named in the Q2 call. Source: Cipher Digital Q2'26 business update call; Stocktwits.
- **new site:** McLennan TX: MW n/d (grid-only figure kept in the text), `p`. Same basis as Mikeska. Source: Seeking Alpha; Stocktwits.
- **new site:** Stingray Phase II (expansion): MW n/d (grid-only figure kept in the text), `p`. Q2 call adds a planned 200 MW Stingray expansion. Source: Cipher Digital Q2'26 business update call; Stocktwits.
- **new site:** Barber Lake expansion: MW n/d (grid-only figure kept in the text), `p`. Company-disclosed 500 MW expansion that the row lacks. Source: Cipher Digital Q2'26 business update call.
- **new site:** Odessa TX (bitcoin; HPC conversion candidate): MW n/d (grid-only figure kept in the text), `s`. Cipher counts Odessa in its 477 MW available for 2027 (with Reveille and Ulysses). Source: Cipher Digital CFO at KBW Virtual AI Summit; Cipher Digital Q2'26 business update call.
- **new site:** Milsing TX: MW n/d, `p`. Named in the Q2 call as part of the 2030+ 2.1 GW, but its MW is not stated separately (do not infer). Source: Cipher Digital Q2'26 business update call.
- **site:** Apollo — ~288-acre option near San Antonio TX: 900 MW, `s`. Adds the stated 2031 horizon and the Sep 2026 Batch Zero result. Source: Cipher Digital Q2'26 business update call; Stocktwits.
- **field:** `pipe`. The Batch Zero breakdown and the BYOG initiative are the material pipeline facts since the row was curated. Source: Cipher Digital; Cipher Digital CFO at KBW Virtual AI Summit; Stocktwits.
- **field:** `ndflag`. A material capital-structure change after the Q2 basis. Source: Cipher Digital; Reuters; TradingView.
- **flag:** `flag`. Adds the two material post-curation events. Source: Cipher Digital CFO at KBW Virtual AI Summit; Reuters.
- **tenant:** Fluidstack → CIFR. Cipher's own 9/14 PR puts Anthropic beside Fluidstack at Barber Lake, which makes Anthropic the likely end-user. Source: Cipher Digital; Cipher Digital CFO at KBW Virtual AI Summit; Stocktwits.

### IREN (IREN)

- **site:** Sweetwater 1 (remainder, grid MW): MW n/d (grid-only figure kept in the text), `s`. Sweetwater 1 is no longer just secured land: IREN says the first building is going up and 300 MW gross of data-center capacity is under construction for Q4 2027. Source: GuruFocus; IREN; IREN via GlobeNewswire.
- **new site:** Sweetwater 1 — first phase (liquid-cooled): 200 MW, `c`, energize 2027Q4. New under-construction phase at Sweetwater 1. Source: GuruFocus; IREN. Note: MW = IREN's own stated IT:gross ratio applied to the 300 MW gross phase.
- **new site:** Sweetwater 2: MW n/d (grid-only figure kept in the text), `s`. Sweetwater 2 is part of IREN's announced 2 GW Sweetwater Hub but has no site row (only in pipe text). Source: GuruFocus; IREN.
- **new site:** Childress Horizons 5–6 (liquid-cooled): MW n/d, `c`, energize 2027Q4. Construction has started on the next two Horizons at Childress; the row lacks them. Source: IREN.
- **site:** Mackenzie BC (air-cooled B300 + 2027 liquid): MW n/d, `c`, energize 2026Q4. The single 'Canada' row hides three different states: Mackenzie is in active GPU install for the Dec quarter, Prince George's air-cooled fleet is already commissioned (next change), Canal Flats is a 2027 liquid conversion. Source: Blue Owl Capital via PR Newswire; IREN.
- **new site:** Prince George BC: MW n/d, `o`. Prince George is operating AI capacity (air-cooled fleet commissioned, customers/end users on site per SemiAnalysis), not merely under construction. Source: IREN; Stocktwits.
- **new site:** Canal Flats BC (liquid-cooled GB300 conversion): MW n/d, `p`. FY26 call announced converting all of Canal Flats to liquid cooling; no construction start stated, so 'p'. Source: IREN.
- **site:** Kiowa OK: MW n/d (grid-only figure kept in the text), `s`. MW is now public for both sites; split the combined null row. Source: IREN; Zacks.
- **new site:** Bundey, South Australia: MW n/d (grid-only figure kept in the text), `s`. Bundey split out of the combined row with its disclosed MW and grid agreement. Source: Stocktwits; Zacks.
- **site:** Badajoz, Spain (Nostrum flagship): MW n/d (grid-only figure kept in the text), `s`. 490 MW is the whole Nostrum Spain portfolio; IREN says Badajoz itself is ~300 MW and the other ~190 MW sits at other Spanish development sites. Source: IREN.
- **new site:** Other Nostrum Spain sites: MW n/d (grid-only figure kept in the text), `s`. Keeps the 490 MW Nostrum total once Badajoz is split out. Source: IREN.
- **new site:** Redbank, NSW (Wagga Wagga): MW n/d (grid-only figure kept in the text), `p`. New 900 MW campus announced by IREN on 10/13–14 (post-curation). Source: Stocktwits.
- **curator:** con 330→530 / plan 730→530: Sweetwater 1 first phase (≈200 MW IT) moves from plan to construction.
- **flag:** `flag`. Adds the post-curation tenant report, the restated delivery targets, the mining exit and the BC reliability flag. Source: Benzinga; IREN; Stocktwits.
- **new tenant:** Frontier AI lab (Anthropic per The Information, unconfirmed) → IREN. IREN disclosed a new frontier-lab contract (separate from Prometheus); The Information named Anthropic on 10/11. Source: Benzinga; IREN.
- **tenant:** Microsoft → IREN. Adds the remaining delivery timing. Source: IREN.
- **field:** `pipe`. Puts the disclosed per-site MW into pipe and adds Redbank and the unnamed Batch Zero projects. Source: GuruFocus; Zacks.

### KEEL (Keel Infra. (ex-Bitfarms))

- **site:** Panther Creek PA: MW n/d (350 MW of utility capacity kept in the text), `p`. Panther Creek is not under construction. Source: Keel Infrastructure; Keel Infrastructure mgmt at KBW AI Infrastructure Summit.
- **site:** Moses Lake WA: 18 MW, `c`, energize 2027Q4. Moses Lake has started construction: site development began during go-vertical permitting, modules were delivered, and the CEO confirms ground broken. Source: Keel Infrastructure; Keel Infrastructure mgmt at KBW AI Infrastructure Summit; PowerSecure.
- **site:** Sharon PA: 110 MW, `p`. 'lease target 2026' is stale. Source: Keel Infrastructure.
- **site:** Sherbrooke QC: MW n/d (96 MW PPA kept in the text), `s`. The gating item is the outstanding ministerial signature, and Keel can't say when it will come. Source: Keel Infrastructure; Keel Infrastructure mgmt at KBW AI Infrastructure Summit.
- **site:** Scrubgrass PA: MW n/d (750 MW load study kept in the text), `s`. Adds detail and the next milestone; status unchanged. Source: Keel Infrastructure; Keel Infrastructure mgmt at KBW AI Infrastructure Summit.
- **field:** `con` = 18. Follows the site rows: Panther Creek c → p (−350), Moses Lake p → c (+18). Source: Keel Infrastructure mgmt at KBW AI Infrastructure Summit.
- **field:** `plan` = 110 (first pass 556; re-based to critical IT in section 2a). This keeps Sharon's 110 MW phase and excludes Panther Creek's 350 MW of utility capacity and Sherbrooke's 96 MW PPA. Source: Keel Infrastructure.
- **flag:** `flag`. Refreshes the date of the no-tenant flag and adds the construction status. Source: Keel Infrastructure; Keel Infrastructure mgmt at KBW AI Infrastructure Summit.
- **field:** `dom`. The row has an empty domain; Keel's own release gives its site. Source: Keel Infrastructure via GlobeNewswire.

### RIOT (Riot Platforms)

- **review fix:** Rockdale frontier-lab lease split: 96 MW `c` energize 2027Q4 (rent from December 2027) + 95 MW `c` energize 2028Q2 (full 191 MW deployment June 2028). Source: Riot Platforms Q2'26 call.
- **site:** Corsicana (AI/HPC): 756 MW, `s`. Small wording update: Riot says it is building the first core-and-shell and buying long-lead gear speculatively. Source: Riot Platforms.

### BTDR (Bitdeer)

- **new site:** Malaysia (3rd hub) — A901 (AI cloud): 67 MW, `c`, energize 2027Q2 (full 67 MW; the Q1 start's tranche MW is n/d). This is Bitdeer's third Malaysian hub, a new leased AI-cloud campus. Source: Bitdeer via GlobeNewswire.
- **new site:** Cyberjaya, Malaysia — A103 (AI cloud): 60 MW, `p`. New 60 IT MW leased facility on the existing Cyberjaya campus; brings secured AI-cloud capacity to ~333.5 MW of the up-to-350 MW Q1'28 target. Source: Bitdeer via GlobeNewswire.
- **site:** Cyberjaya, Malaysia — A102 (AI cloud): 9.5 MW, `c`, energize 2027Q1. The sell-out release states energization in Q1 2027; 'ready Nov 2026' is facility readiness (Aug update), and the CFO on 9/14 said Malaysia executes 'early next year into mid of next year'. Source: Bitdeer via GlobeNewswire; Quartr transcript.
- **site:** Johor, Malaysia — A201 (AI cloud): 21.7 MW, `c`, energize 2027Q1. 'Late negotiations' is stale: off-take commitments for >70% of A201 were announced 9/29/26 (>$1.7B expected revenue over 5 years). Source: Benzinga; Bitdeer via GlobeNewswire.
- **site:** Wenatchee WA (A501): 10 MW, `c`, energize 2027Q4. CFO on the Q2 call: Washington State and Tennessee are the two sites 'we're actively working on and doing construction'; Knoxville is already 'c', Wenatchee should match. Source: Quartr transcript.
- **site:** Clarington OH: MW n/d (570 MW grid kept in the text), `s`. CFO: Clarington is being developed for crypto mining now; the motion to dismiss the neighbor's suit was denied and the case is in discovery. Source: Quartr transcript (Bitdeer CFO).
- **field:** `con` = 349.3. +67 (A901 'c') +10 (Wenatchee p→c). Source: Bitdeer via GlobeNewswire.
- **field:** `plan` = 1143. +60 (A103 'p') −10 (Wenatchee moved to 'c'). Source: Bitdeer via GlobeNewswire.
- **flag:** `flag`. 206.5 MW figure is superseded twice (273.5 on 10/8, 333.5 on 10/12); off-take status changed for A201. Source: Bitdeer via GlobeNewswire.
- **field:** `econ.backlog`. A201 off-take adds >$1.7B; Seeking Alpha headline puts total AI-cloud revenue backlog at $2.9B (the release body itself could not be fetched). Source: Seeking Alpha.

### WYFI (WhiteFiber)

- **site:** NC-1 (Madison NC, Nscale): 40 MW, `o`. The 'expected Q3 2026' text is now in the past. Source: Quartr transcript.
- **new site:** Ontario (third-party DC; Baseten 1,392 B300): MW n/d, `c`. WhiteFiber is the tenant in a third-party Ontario data center for a dedicated Baseten GPU deployment; MW not disclosed (do not convert from GPU count). Source: Quartr transcript; Zacks.
- **new site:** Paris region, France (third-party DC; IG customer): MW n/d, `c`. The >$160M Paris deal is in econ.backlog but has no site row; WhiteFiber targeted end-September RFS after procurement and site arrangements. Source: Quartr transcript.
- **new site:** Krambu partnership (exclusive GPU operator; sites n/d): MW n/d, `s`. Aug-12 agreement: WhiteFiber is Krambu's exclusive GPU infrastructure operator for 100 MW of planned capacity; Krambu supplies the data halls. Source: Quartr transcript; WhiteFiber via PR Newswire.
- **field:** `pipe`. Q2 call adds NC-1 tranche-2 (45 MW gross) and a further ~200 MW under Duke evaluation; Krambu adds 100 MW of access. Source: Quartr transcript.

### BTBT (Bit Digital)

- No change: nothing new cleared the evidence bar.

### MARA (MARA Holdings)

- **site:** Starwood Digital Ventures JV: MW n/d, `p`. Management guidance is 'at least two leases' by year-end, reiterated 9/14; no lease signed as of the 10/2 Clear Street CFO meeting. Source: Benzinga; Quartr transcript.
- **flag:** `flag`. Lease target is two, not one; status refreshed to 10/2; Exaion acknowledged. Source: Quartr transcript.
- **new site:** Exaion (France; majority-owned since Mar 2026): MW n/d, `o`. MARA's majority-owned Exaion already runs AI workloads for paying customers; the row has no entry for it. Source: Quartr transcript.

### DOCN (DigitalOcean)

- **new site:** Richmond (VA) AI DC: MW n/d, `o`. First of three new 2026 AI data centers named on the Q2 call; MW not disclosed. Source: Quartr transcript.
- **new site:** Kansas City AI DC: 10 MW, `o`. Second 2026 data center; CFO gave its size as 10 MW. Source: Quartr transcript.
- **new site:** Memphis, TN AI DC: 15 MW, `o`. Third 2026 data center (the '15 MW left in one facility'). Source: Quartr transcript.
- **flag:** `flag`. Site-level disclosures now exist for the 2026 adds. Source: Quartr transcript.
- **new tenant:** DigitalOcean → EQIX. DigitalOcean leases its AI capacity from tier-1 colo providers and names Equinix first. Source: Quartr transcript.
- **curator:** op 70→85 / con 65→50: Memphis 15 MW turned on (CFO 9/8).
- **curator:** geo_note: DOCN named 2026 sites now pinned.

### AKAM (Akamai (CIS))

- **new site:** Anthropic CPU expansion — numerous colo sites, majority US (10–30 MW blocks): MW n/d, `p`. The 9/24 deal is CPU capacity in leased colocation, not edge PoPs: CFO says it is spread over numerous providers in 10–30 MW blocks, mostly in the US, some already secured. Source: Quartr transcript.
- **site:** Distributed edge inference nodes (Anthropic $1.8B plan + robotics GPU deal): MW n/d, `c`. Separate the earlier GPU-inference commitments from the 9/24 CPU expansion so readers don't read the $11.6B as edge PoP capacity. Source: Quartr transcript.

### MSFT (Microsoft)

- **new site:** La Porte, IN — NW Indiana campus (NIPSCO GenCo power): MW n/d, `p`. NiSource signed a 20-year energy agreement (10/16/26) for Microsoft's 'previously announced northwest Indiana campus', service starting 2028, Microsoft funding all generation/transmission. Source: Dow Jones Newswires; NiSource Inc. via Business Wire; dpa-AFX / RTTNews.
- **field:** `econ.power`. New Microsoft-funded utility supply arrangement; also a candidate row for config/power_deals.json (kind 'utility supply', status signed but subject to regulatory approval per the release's risk factors). Source: NiSource Inc. via Business Wire.
- **field:** `pipe`. Microsoft (10/12/26) said it will roll out multi-gigawatt Maia 300 deployments from 2027 — a disclosed pipeline driver; no site or MW attached, so op/con/plan unchanged. Source: Reuters.

### AMZN (Amazon (AWS))

- **site:** Hobart / NW Indiana (Lake Co.): 2400 MW, `p`. NiSource (the serving utility) says the original Amazon contract was IURC-approved in June 2026, civil site work follows later in 2026 and load energization begins 2027, and a July-17 amendment adds 400 MW of Amazon contracted load. Source: NiSource Inc.; dpa-AFX / RTTNews.
- **site:** Salem Township Innovation Campus, PA (Luzerne Co.): 960 MW, `c`. Talen's Q2-2026 call dates the AWS campus full build-out to 2028–2030 with the ~2 GW contract ramping through 2030; Reuters (Feb-2026) says Talen already supplies an Amazon data center there. Source: Reuters; Talen Energy.
- **new site:** NW Louisiana campuses #1–2 — Caddo & Bossier Parishes (w/ STACK): MW n/d, `c`. The row carries only Shreveport campus #3, yet its own text says $18B spans 3 Caddo-Bossier campuses; the first two ($12B, announced 2026-02-23) are missing. Source: Benzinga; GlobeNewswire; Reuters.
- **new site:** Gilroy, CA (Santa Clara Co.): MW n/d, `c`. WSJ (2026-08-07) reports a $2B Amazon data center in Gilroy, CA that residents learned of only once construction began. Source: The Wall Street Journal.
- **field:** `pipe`. Latest company statement on the capacity trajectory is the Q2-2026 call reaffirmation (no new GW-added figure was given); also surfaces the Indiana +400 MW amendment and the $18B Louisiana program. Source: Amazon.com; NiSource Inc.; Reuters.
- **flag:** `flag`. Flag says 'TENANTS empty' but the record already carries an Amazon tenant edge at CIFR (286 MW), and the Louisiana campuses are a STACK partnership; also records that Q2'26 gave no new GW datapoint. Source: Amazon.com; GlobeNewswire.
- **field:** `econ.power`. New signed nuclear PPA (Constellation/Amazon, 9/30/26) and the approved NIPSCO supply contract are the largest power deals since curation. Source: Business Wire; NiSource Inc..

### GOOGL (Alphabet (Google))

- **site:** New Florence, MO (Montgomery Co.): 1000 MW, `c`. Ameren (the serving utility) said on its Q2'26 call that Google held a groundbreaking and began construction in its Missouri territory, so p -> c. Source: Ameren Corporation.
- **site:** Cedar Rapids, IA (Big Cedar Ind. Ctr): MW n/d, `c`. '1st bldg 2026' is stale: Alliant says Google has energized its transmission service and is ramping on its contracted load schedule while construction continues — not yet a clean 'o' (no in-service statement, no MW). Source: Alliant Energy.
- **new site:** Cheyenne, WY (Laramie Co.; Black Hills + AEP power): MW n/d, `p`. New GW-scale Google campus named 10/06/26: Black Hills signed definitive agreements (effective 9/30, terms to 2048) to serve a 'planned Google data center to be constructed in Cheyenne'; AEP followed 10/14 with a $4B, 702 MW fuel-cell PPA for Google. Source: American Electric Power; Black Hills Corp..
- **new site:** Wilbarger County, TX (Vernon; AES co-located gen): MW n/d, `p`. A Texas Google campus outside the row's three named hubs: AES (2/24/26) signed 20-year PPAs for generation co-located with 'a new Google data center in Wilbarger County'. Source: AES Corp.; Reuters.
- **new site:** Pine Island, MN (Xcel ESA): MW n/d, `p`. Google campus missing from the row. Source: Xcel Energy.
- **new site:** West Memphis, AR (Crittenden Co.): MW n/d, `c`. Material Google campus missing from the row. Source: Entergy.
- **new site:** Stillwater + Muskogee, OK (OG&E; 3 DCs): MW n/d, `p`. The pipe lists OK $9B (Pryor/Stillwater/Muskogee) but no site row exists. Source: OGE Energy.
- **new site:** Muhos + Kajaani, Finland (Tuike Finland; part of €13B): MW n/d, `p`. Google's largest European commitment (9/09/26) sits only in the pipe. Source: Reuters; dpa-AFX / RTTNews.
- **new site:** Visakhapatnam, India (AdaniConneX/Airtel) — 1 GW campus: 1000 MW, `p`. Vizag is in the pipe and geo_unmapped (1000 MW, p) but has no site row. Source: Mint.
- **field:** `pipe`. Adds the new or advanced sites (Cheyenne, Wilbarger, West Memphis, Pine Island, the OG&E contract), the Finland halt, the New Florence construction start, the Lea County vote and Crux AI. Source: Reuters; WSJ / Dow Jones Newswires.
- **flag:** `flag`. Readers should know Google is now both a tenant (xAI/SpaceX) and a backer of off-balance-sheet capacity (Crux AI JV; Nexus guarantees), and that none of it is in op/con/plan. Source: CNBC; Reuters; The Wall Street Journal.
- **field:** `econ.capexmw`. Adds the Q2 call's tech-infra split and the stated reason for the guide raise. Source: Alphabet.
- **curator:** con 5000→6000 / plan 6500→5500: New Florence (1,000 MW) moved planned→construction (Ameren 7/31/26); total unchanged.

### META (Meta Platforms)

- **site:** Cheyenne, WY (Laramie Co.): MW n/d, `c`, energize 2026Q4. Primary utility statement: Black Hills (Cheyenne Light) said on its 2026-08-06 call that Meta's Cheyenne AI data center is 'slated to begin ramping later this year'. Source: Black Hills Corp..
- **site:** Prometheus - New Albany, OH (Licking Co.): 471 MW, `o`. Adds the one company-side power milestone now on record (Williams, primary) and drops the forward Epoch '~676 MW Nov 2026' waypoint, which will read stale within weeks. Source: The Williams Companies.
- **new site:** Tulsa, OK: MW n/d, `c`. Material 2026 Meta campus missing from the row: Meta began construction in Tulsa on 2026-04-21 (Reuters). Source: Reuters; Zacks Investment Research.
- **new site:** Beaver Dam, WI (Dodge Co.): MW n/d, `c`. Meta campus under construction that the row lacks (announced Nov 2025 as Meta's '30th data center' per search snippets). Source: Alliant Energy.
- **flag:** `flag`. The newest filed capacity signal Meta gives is in dollars, not MW: a ~$68B July-2026 lease tranche starting 2027-28. Source: Meta Platforms.
- **field:** `econ.anchor`. 'Meta Compute launched Jul 2026' is off: Zuckerberg referred to 'our Meta compute initiative' on the 2026-04-29 Q1 call; what arrived in July was the plan to rent surplus capacity (Q2 call: 'as part of our Meta Compute effort'). Source: Meta Platforms.

### BABA (Alibaba (Alibaba Cloud))

- **field:** `pipe`. The >20 GW-by-2032 goal is now a CEO-stated company target (Apsara 9/22/26), not just press-reported; region/AZ count is stale (company now states 31 regions / 107 AZs) and the 9/23/26 release names the next new regions and expansion countries; the Q1 FY27 call gives RMB190B spent of the RMB380B plan. Source: Alibaba Cloud press release; Alibaba Group Q1 FY27 earnings call; Dow Jones Newswires; Gelonghui; Reuters.
- **field:** `econ.capexmw`. Replace the derived 'RMB126.1B + 67.7B' spend tally with management's own RMB190B-spent figure; add the disclosed 100-day AIDC delivery and 2026 modular-capacity plan. Source: Alibaba Group Q1 FY27 earnings call; Gelonghui.
- **flag:** `flag`. Readers will see the 20 GW headline; the flag should say why it does not move op/con/plan (no baseline, no schedule, facility not critical-IT GW). Source: Reuters.
- **site:** Ulanqab campus (Inner Mongolia): 300 MW, `o`. Status unchanged (o); refresh when-text with the Aug 2026 AI-capacity milestone (first region for Zhenwu M890 SuperNode instances) and super-DC/green-power detail. Source: Gelonghui.
- **new site:** São Paulo, Brazil region (2 AZs): MW n/d, `o`. New operational Alibaba Cloud region (two AZs / two data centers in São Paulo) launched 8/27-28/26; MW not disclosed. Source: Benzinga; Gelonghui.
- **new site:** France region (opened mid-2026): MW n/d, `o`. Alibaba exec at Apsara: new facilities opened in France 'in recent months'; the 9/23/26 release lists France among countries where the DC footprint will expand. Source: Alibaba Cloud press release; Gelonghui.
- **new site:** South Korea 3rd DC: MW n/d, `o`. Alibaba Cloud's third data center in Korea went live 8/18/26 (2025 Apsara had listed Korea among DC-expansion markets). Source: Gelonghui.
- **new site:** New regions: Türkiye / Finland / Netherlands: MW n/d, `p`. Company-announced planned first regions (Apsara 2026). Source: Alibaba Cloud press release.

### TCEHY (Tencent (Tencent Cloud))

- **field:** `pipe`. Tencent's largest overseas compute arrangement belongs in the pipeline context, labelled as press-reported. Source: Reuters.
- **field:** `ndflag`. Material post-quarter debt raise (~$5.6B net) that the Q3 balance sheet will show; flag it now so nd gets re-pulled. Source: Gelonghui; Reuters.

### BIDU (Baidu (Baidu AI Cloud))

- **field:** `pipe`. The Q1'26 call gives a company-stated scale point for the Kunlun build: a single cluster of >30,000 accelerators in commercial deployment. Source: Baidu Q1'26 earnings call.

### EQIX (Equinix)

- **new site:** Hampton, GA xScale campus (Americas JV) — 4 bldgs: 240 MW, `c`. The CEO said Hampton 'will support approximately 240 MW of IT capacity' and that it was contributed to the Americas (US) xScale JV in Jan 2026. Source: Equinix.
- **site:** US xScale JV campuses (>1.5GW): 1260 MW, `p`. Hampton is the JV's first asset ('an important first step towards deploying $15 billion'). Source: Equinix.
- **new site:** Minooka, IL xScale campus: MW n/d, `p`. Equinix names Minooka as its other active US xScale site alongside Hampton. Source: Equinix.
- **site:** atNorth (Nordics - Iceland/Sweden/Finland): 800 MW, `p`. The close release names the development sites. Source: CPP Investments / Equinix; Equinix.
- **new site:** Cape Town, South Africa — 2 DCs (King Air Industria): MW n/d, `p`. Reuters reports Cape Town approval for two Equinix data centres needing about 170 MW of power capacity. Source: Reuters.
- **field:** `econ.capexmw`. The Q2'26 release and call raised 2026 capex from about $4.1B and set the 2027–29 range. Source: Equinix.
- **field:** `pipe`. Adds the company-wide pipeline figures disclosed between Feb and Sep 2026. Source: Equinix.
- **flag:** `flag`. The footprint is now 282 data centers (Q2'26 10-Q, per the Oct-8 research evidence). Source: Equinix.
- **curator:** con 350→590 / plan 1500→1260: Hampton ~240 MW IT (US xScale JV's first asset) under construction, half leased.

### DLR (Digital Realty)

- **site:** Charlotte, NC - 2nd 200MW building: 200 MW, `c`. CEO on the Q1'26 call called the second 200 MW 'under construction', and IR (BofA, 2026-09-09) said two of three Charlotte projects are underway. Source: Digital Realty.
- **site:** Charlotte, NC - 200MW AI-inference (AA hyperscaler): 200 MW, `c`, energize 2028Q4. The `when` text is refreshed with the CFO's phasing: deliveries start in 2027 and run into 2028. Source: Digital Realty.
- **new site:** Northern Virginia ex-Blackstone JV bldgs: 192 MW (2 of 3) `c` energize 2027Q2 + 96 MW (3rd) `c` energize 2028Q2. DLR bought out Blackstone's stake on 6/30/26; all three buildings are 100% leased, and the release gives the two stabilization dates. Source: Digital Realty / Blackstone (GlobeNewswire); Digital Realty.
- **new site:** Kansas City metro (Astra Enterprise Park, De Soto KS) — 1,440 acres: MW n/d, `s`. Powered land bought in June 2026 for ~$475M, with a signed Energy Service Agreement. Source: Digital Realty.
- **new site:** Atlanta metro — >1 GW campus (873-acre parcel + adjacent parcel): 1000 MW, `p`. This is the 'larger project' the CEO set apart from the 200 MW Atlanta build. Source: Digital Realty.
- **new site:** Hillsboro, OR — 30-acre parcel (160 MW) + adjacent 85 MW assemblage: 245 MW, `p`. The Q1'26 release and call disclose a 30-acre Hillsboro/Portland parcel for 160 MW of IT capacity, next to an 85 MW assemblage announced the quarter before. Source: Digital Realty.
- **new site:** Osaka KIX15, Ibaraki (MC Digital Realty 50/50 JV): 24 MW, `c`, energize 2028Q4. New since the 2026-10-02 curation: construction started on 2026-10-07 on a 24 MW AI-oriented building, with operations scheduled for Q4 2028. Source: Digital Realty.
- **new site:** Singapore — Jurong Island (DC-CFA2 award): 50 MW, `s`. Singapore's DC-CFA2 gave DLR a provisional 50 MW allocation on Jurong Island, aimed at AI inference and HPC. Source: Digital Realty.
- **new site:** Charlotte, NC - 3rd project (approved, not started): MW n/d, `p`. IR named a third vested Charlotte project that is approved but not yet underway. Source: Digital Realty.
- **new site:** São Paulo, Brazil — hyperscale development: MW n/d, `c`. The CFO lists São Paulo with Charlotte and Atlanta as active development, and Q2 had record São Paulo >1 MW leasing. Source: Digital Realty.
- **site:** Ashburn / Northern Virginia hub: MW n/d, `o`. The `when` text gains IR's September description of Digital Dulles and of current NoVA availability. Source: Digital Realty.
- **field:** `econ.power`. The 2.7 GW figure came from a secondary source (Alphastreet). Source: Digital Realty.
- **field:** `econ.backlog`. IR stated the pro forma figure at BofA on 2026-09-09. Source: Digital Realty.
- **field:** `pipe`. Adds the land and power runway management disclosed in Q1–Q3 2026, and the current footprint wording ('300+ facilities in 55+ metros'). Source: Digital Realty.

### XAI (xAI (Colossus))

- **field:** `pipe`. Company now states its year-end and 2027 targets directly (call + CFO conference remarks), replacing the '~2,000 gross by late 2026' estimate. Source: SpaceX; SpaceX CFO Bret Johnsen at Goldman Sachs Communacopia.
- **field:** `econ.anchor`. Google is no longer press-only — SpaceX management names Google as a CSA customer ramping in Q3/October; two further hosting deals were disclosed (Q2 call, CFO 9/10). Source: CNBC; PYMNTS; SpaceX; SpaceX CFO Bret Johnsen at Goldman Sachs Communacopia.
- **new tenant:** Google → XAI. Demand edge missing from tenants (currently only in econ.anchor as press-only). Source: CNBC; PYMNTS; SpaceX.
- **new tenant:** Unnamed hosting customers (SpaceX AI compute) → XAI. New contracted demand at SpaceX AI compute disclosed by the CFO. Source: SpaceX CFO Bret Johnsen at Goldman Sachs Communacopia.

### STARGATE (OpenAI / Stargate)

- **review fix:** Milam County TX: 1,200 MW, `c`, energize 2026Q4 → 2028Q4. The first building's MW is not stated, so the row is dated to the full build already in its text. Otherwise nothing new cleared the evidence bar.

## 4. Open items for the next refresh

Unverified leads worth a primary-source check. All are in the findings file with where each
was seen.

- **META:** Mason County, KY hyperscale campus. The county approved a $10B
  community-benefits agreement on 10/13–14, but we saw it only in search results. Hyperion's
  `energize_q` 2028Q3 conflicts with a Meta spokesperson's "2 GW by 2030" and with leases
  starting "around 2029".
- **STARGATE:** the SB Energy S-1/A could not be fetched. Search excerpts put Milam at about
  753 MW IT (308 + 445), with none of it operating. The row's "first bldg delivery Oct 2026"
  needs that check.
- **AMZN:** five open site checks.
  - Birchwood/King George VA has no row, despite the 9/29/26 settlement.
  - Louisa Co. VA reportedly started construction in March 2025 (`p` → `c`?).
  - Falls Township, Bucks Co. PA is reportedly more than half built, with first sections online
    Q4 2026.
  - The Mississippi row bundles Vicksburg and Clinton.
  - Georgia (Butts/Douglas) has no row.
- **GOOGL:** reported but not verified:
  - Armstrong/Haskell under construction.
  - Botetourt VA, Roanoke (Wood Haven) and Monrovia IN.
  - A temporary restraining order at Pine Island.

  Two rows need a source either way:
  - Jackson Co. AL's 300 MW and 2026Q4 date are unsourced.
  - The old Pryor and Midlothian pins do not match the site rows.
- **MSFT:** Mount Pleasant's amended plan (7 buildings, not 9). Nscale's Narvik and Loughton
  capacity for Microsoft is not tracked.
- **XAI:** a new Southaven building at 8325 Tulane Rd, and the HUMAIN 500 MW project in Saudi
  Arabia.
- **Smaller leads:**
  - CRWV: Kenilworth NJ as its first self-build.
  - NBIS: Pennsylvania site specifics (Butler Twp, Schuylkill Co.; 260 MW by Oct 2027).
  - APLD: Delta Forge 2 in Brookwood, Tuscaloosa Co.
  - BTDR: Shalersville OH (~750 MW grid).
  - BTBT: its WhiteFiber stake (~60% vs 69.6%).
  - MARA: a Long Ridge termination date of 11/30.
  - BABA: Nantong may be operating, not expanding.
- **Structural issues**, which predate this review:
  - The CORZ AMD five-site row overlaps the Dalton Ph III and Hunt rows.
  - EQIX's "Global xScale portfolio 725 `c`" likely includes operating capacity.
  - CRWV has no map pins for campuses outside tracked landlords.
- **`config/power_deals.json` candidates** found during the review:
  - Amazon–Constellation Calvert Cliffs (690 MW PPA, 9/30/26).
  - NiSource–Microsoft NW Indiana (20-yr, from 2028).
  - Kentucky Power–TeraWulf Muskie (1 GW, 10/5/26).
  - About seven 2026 Google deals: Black Hills, AEP's 702 MW of fuel cells, Xcel, AES, OG&E,
    Georgia Power and Fervo.

Q3 reports, all likely to move filed figures. Dates are as found, and some are not yet
confirmed by the company:
- **October:** SpaceX/xAI 10/20 · META 10/21 · NBIS ~10/22 · GLXY 10/27 · MSFT, GOOGL (~),
  EQIX and ORCL Investor Day 10/28 · AMZN, DLR 10/29 · RIOT ~10/30.
- **November:** HUT 11/04 · CORZ, AKAM 11/05 · WULF 11/06 · BIDU ~11/17 · TCEHY 11/18 ·
  BABA ~11/24.
- **Mid-November, no date announced:** IREN, KEEL, WYFI, DOCN, CIFR and CRWV.
- **Later:** ORCL Q2 12/14 · APLD ~January.
