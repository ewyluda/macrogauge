# Power purchase agreements for /capacity companies (research, 2026-10-08)

Goal: a curated, quote-backed table of power purchase agreements and similar dedicated supply
deals tied to the data-center load of the companies in `config/capacity.json`. It mirrors the
`config/issuer_bonds.json` pattern: every row carries a verbatim quote containing its MW figure,
and the passage it was read from is committed under `docs/research/evidence/`.

Outputs (research only; nothing is wired in):

- Draft config: `docs/research/2026-10-capacity-ppas-draft.json` (26 deals)
- Evidence: `docs/research/evidence/2026-10-ppa-<ticker>-<slug>.txt` (22 files; several rows
  share one file)

How the quotes were made verbatim: every page was fetched in full, by curl and HTML-strip for
open pages, or as rendered page text in a browser where curl got a 403 (Talen IR, SEC EDGAR).
The relevant passage was saved to an evidence file, whitespace-collapsed. Each `quote` in the
draft JSON was then cut programmatically as an exact substring of its evidence file, and the
build asserted that the MW figure appears in it. For the five browser-sourced files, the quote
strings were re-checked against the live page text (`includes()` = true for all). No figure
comes from a search snippet or a summarizer.

## 1. Summary

**26 rows** across 6 tickers. Totals count Elementl as 3 × 600 MW.

| Status | MW | Rows |
|---|---:|---:|
| Signed agreement (all instruments) | 25,287 | 21 |
| of which: an actual PPA | 9,550 | 11 |
| of which: other signed instruments (utility ESA / special contract, development or funding agreement, tariff, collaboration) | 15,737 | 10 |
| MOU / LOI / option | 4,850 | 5 |

By company (signed MW / MOU-LOI-option MW / rows):

| Ticker | Signed | MOU/LOI/option | Rows |
|---|---:|---:|---:|
| META | 13,232 | 2,250 | 11 |
| AMZN | 5,930 | 300 | 5 |
| GOOGL | 2,990 | 1,800 | 7 |
| ORCL | 2,300 | 0 | 1 |
| MSFT | 835 | 0 | 1 |
| EQIX | 0 | 500 | 1 |

No in-scope row with a primary source was found for CRWV, NBIS, the miner/landlord cohort
(APLD CORZ GLXY WULF HUT CIFR IREN KEEL RIOT BTDR WYFI BTBT MARA), DOCN, AKAM, DLR, BABA, TCEHY,
BIDU, XAI or STARGATE. See §3–4 for why.

By technology (signed MW / MOU-LOI-option MW / rows):

| Technology | Signed | MOU/LOI/option | Rows |
|---|---:|---:|---:|
| gas | 12,762 | 0 | 4 |
| nuclear (existing), incl. uprates | 7,230 | 0 | 7 |
| nuclear (SMR/advanced) | 2,710 | 4,700 | 8 |
| nuclear (restart) | 1,450 | 0 | 2 |
| hydro | 670 | 0 | 1 |
| geothermal | 265 | 150 | 3 |
| other (fusion) | 200 | 0 | 1 |

Utility-built gas for a single customer dominates the signed MW: Entergy for Meta (2,262 +
5,200 MW), NIPSCO for Amazon (3,000) and VoltaGrid for Oracle (2,300). None of these is a PPA in
the usual sense. Section 3, item 1, treats this as the biggest scope question.

## 2. Table

Each row's quote is in the draft JSON. The evidence file is named in the JSON's `evidence`
field. "nameplate" means plant or project capacity where the buyer's share is not stated;
"contracted" means the buyer's stated volume.

| # | Ticker | Counterparty | Facility | Technology | MW | MW basis | Status | Instrument | Announced | Term (yr) | Start | Source |
|---|---|---|---|---|---:|---|---|---|---|---|---|---|
| 1 | MSFT | Constellation Energy | Crane Clean Energy Center (TMI Unit 1), PA | nuclear (restart) | 835 | nameplate | signed | PPA | 2024-09-20 | 20 | 2028 | Constellation release |
| 2 | AMZN | Talen Energy | Susquehanna, PA | nuclear (existing) | 1,920 | contracted | signed | PPA | 2025-06-11 | through 2042 | full volume by 2032 | Talen release |
| 3 | META | Constellation Energy | Clinton Clean Energy Center, IL | nuclear (existing) | 1,121 | contracted | signed | PPA | 2025-06-03 | 20 | 2027-06 | Constellation release |
| 4 | META | Vistra | Perry, OH | nuclear (existing) | 1,268 | contracted | signed | PPA | 2026-01-09 | 20 | late 2026 | Vistra 8-K |
| 5 | META | Vistra | Davis-Besse, OH | nuclear (existing) | 908 | contracted | signed | PPA | 2026-01-09 | 20 | late 2026 | Vistra 8-K |
| 6 | META | Vistra | Uprates at Perry / Davis-Besse / Beaver Valley (213+80+140) | nuclear (existing) | 433 | contracted | signed | PPA | 2026-01-09 | 20 | by 2031, full end-2034 | Meta newsroom (+ 8-K split) |
| 7 | META | TerraPower | Two Natrium units (site TBD) | nuclear (SMR/advanced) | 690 | nameplate | signed | development funding w/ energy rights | 2026-01-09 | — | as early as 2032 | Meta newsroom; TerraPower release |
| 8 | META | TerraPower | Up to six more Natrium units | nuclear (SMR/advanced) | 2,100 | nameplate | option | rights to energy | 2026-01-09 | — | by 2035 | Meta newsroom |
| 9 | META | Oklo | Pike County, OH campus | nuclear (SMR/advanced) | 1,200 | nameplate ("up to") | signed | prepayment / development funding | 2026-01-09 | — | as early as 2030 | Meta newsroom |
| 10 | META | Entergy Louisiana | Franklin Farms 1–2 + Waterford 5 CCCTs (Hyperion) | gas | 2,262 | nameplate | signed | electric service agreement (utility-built) | 2024-10 | — | 2028 / 2029 | Entergy 10-Q Q3 2025 |
| 11 | META | Entergy Louisiana | Seven new CCGTs (Hyperion expansion) | gas | 5,200 ("more than") | nameplate | signed (LPSC approval pending at source date) | electric service agreement (utility-built) | 2026-03-27 | — | — | Entergy release |
| 12 | META | Sage Geosystems | Geopressured geothermal, east of Rockies | geothermal | 150 ("up to") | nameplate | mou | partnership | 2024-08-26 | — | 2027 phase 1 | Meta newsroom |
| 13 | META | XGS Energy | Advanced geothermal, New Mexico (PNM) | geothermal | 150 | nameplate | signed | development agreement | 2025-06-12 | — | — | NM Governor release |
| 14 | GOOGL | Kairos Power | Advanced reactor fleet (sites TBD) | nuclear (SMR/advanced) | 500 | nameplate | signed | master plant development agreement (PPAs per plant) | 2024-10-14 | — | first by 2030, all by 2035 | Kairos release |
| 15 | GOOGL | NextEra Energy | Duane Arnold, IA | nuclear (restart) | 615 | nameplate (Google = "majority") | signed | PPA | 2025-10-27 | 25 | 2029-Q1 | NextEra release |
| 16 | GOOGL | Brookfield Renewable | Holtwood + Safe Harbor hydro, PA | hydro | 670 | nameplate | signed | PPA | 2025-07-15 | 20 | — | Brookfield release |
| 17 | GOOGL | Commonwealth Fusion Systems | ARC, Chesterfield County, VA | other (fusion) | 200 | contracted | signed | PPA | 2025-06-30 | — | early 2030s | CFS release |
| 18 | GOOGL | NV Energy / Fervo | Enhanced geothermal, Nevada | geothermal | 115 | contracted | signed (PUCN approval not verified) | Clean Transition Tariff (utility supply agreement) | 2024-06-11 | — | — | Google blog |
| 19 | GOOGL | Elementl Power | 3 undisclosed sites | nuclear (SMR/advanced) | 600 × 3 | nameplate per site ("at least") | option | early-stage capital + offtake option | 2025-05-07 | — | — | Google blog |
| 20 | GOOGL | Constellation Energy | Uprates at 11 units (IL, PA, NJ) | nuclear (existing) | 890 | contracted | signed | PPA | 2026-10-06 | 20 | 2028 first uprate | Constellation release |
| 21 | AMZN | Energy Northwest (X-energy) | Cascade, Richland, WA (phase 1, 4 SMRs) | nuclear (SMR/advanced) | 320 | nameplate | signed | development agreement | 2024-10-16 | — | early 2030s | About Amazon |
| 22 | AMZN | Dominion Energy | SMR near North Anna, VA | nuclear (SMR/advanced) | 300 ("at least") | nameplate | mou | agreement to explore | 2024-10-16 | — | — | About Amazon |
| 23 | AMZN | Constellation Energy | Calvert Cliffs, MD (incl. 190 MW uprate) | nuclear (existing) | 690 | contracted | signed | PPA | 2026-09-30 | 20 | uprate 2030–2032 | Constellation release |
| 24 | AMZN | NIPSCO / NIPSCO GenCo | New generation for northern Indiana campuses | gas | 3,000 ("up to") | nameplate | signed (IURC approved June 2026) | utility special contract + GenCo PPA | 2025-11-24 | — | — | NiSource article (+ 10-Q Q2 2026) |
| 25 | ORCL | VoltaGrid | Modular gas for OCI AI data centers | gas | 2,300 | nameplate | signed | collaboration, terms undisclosed | 2025-10-15 | — | — | VoltaGrid release |
| 26 | EQIX | Oklo | Oklo powerhouses (sites TBD) | nuclear (SMR/advanced) | 500 | nameplate | loi | letter of intent | 2024-02-16 | 20 | — | Equinix LOI (SEC exhibit 10.19) |

Primary-source quality: 25 of 26 rows rest on a company, counterparty, SEC or government
document. None is secondary press. Row 13 is a state governor's release (a government primary)
rather than Meta's or XGS's own. Row 25 is the counterparty's release only; Oracle's own was
not found.

## 3. Scope edge cases and recommended decisions

1. **Utility-built generation under an electric service agreement is not a PPA (rows 10, 11, 24).**
   Meta (Entergy) and Amazon (NIPSCO GenCo) are retail customers of a utility that builds gas
   plants because of their load and charges them for it. That makes these deals the largest
   dedicated power commitments in the table: 10,462 MW of the 25,287 signed. *Recommend:*
   keep them, but publish `instrument` beside `status` so "signed" is never read as "PPA", and
   offer a "PPAs only" view (9,550 MW). If they are dropped, Meta falls from 13.2 GW signed to
   5.8 GW.
2. **Fleet-level supply with no named plant (excluded).** Google–Constellation's companion
   "15-year energy supply agreement for an additional 2,700 MWs in PJM's fleet" (same release
   as row 20) names no facility and no technology. *Recommend:* exclude it, as the draft does,
   since it fails "single named project" and would be the largest Google row. If included, it
   needs `technology: "other"` and a fleet flag.
3. **Development/funding agreements and options vs offtake (rows 7–9, 14, 19, 21).** TerraPower
   (2 units), Oklo, Kairos and Energy Northwest are signed agreements to fund or develop plants,
   with energy rights or PPAs to come. TerraPower's other six units and Elementl are options.
   *Recommend:* keep `status` as is (an option is not counted as signed), and treat every
   "signed" non-PPA as pipeline, not contracted supply.
4. **MW basis.** Restarts (Crane, Duane Arnold) and Kairos, TerraPower and Oklo state plant
   capacity, not the buyer's share. Google takes only "the majority" of Duane Arnold. Hedged
   figures ("up to", "at least", "more than") appear on rows 9, 11, 12, 19, 22 and 24.
   *Recommend:* add an `mw_qualifier` field (`up_to | at_least | more_than | null`) so the page
   can render the hedge the source used.
5. **Supersession.** Talen–AWS March 2024 (the 960 MW Cumulus campus sale plus a co-located
   PPA) was replaced by the June 2025 PPA in row 2. *Recommend:* one row per live contract, and
   record the history in `note`. The 2024 deal is not a row.
6. **Renewable single-project PPAs (not swept).** The hyperscalers sign dozens of wind and
   solar PPAs a year, each ≥100 MW and often "for our data centers". Including them would turn
   this into a renewables registry with hundreds of rows. *Recommend:* keep them out, or
   restrict them to ones the buyer itself ties to a named AI campus. The draft includes none.
   Brookfield hydro (row 16) is in because hydro is dispatchable and the PPAs name two plants.
7. **Self-generation and turbine leasing (excluded).** xAI's Southaven turbines (an air permit
   for its own generation) and Solaris's Stateline JV (equipment leasing) are not purchase
   agreements with a third-party generator. *Recommend:* if wanted, publish them as a separate
   "on-site generation" list, not as PPAs.
8. **Grid interconnection and lease deals for the miner/landlord cohort (excluded).** Examples:
   Cipher–AEP 1 GW Direct Connect, IREN Sweetwater connection agreements, and Cipher–AWS
   300 MW, which is a lease. These secure grid capacity, not supply. Hut 8's July 2024 205 MW
   West Texas PPA served bitcoin mining, not AI load. *Recommend:* exclude, as the draft does.
9. **Below 100 MW (excluded).** Google–Kairos/TVA Hermes 2 (50 MW), Microsoft–Helion fusion
   (50 MW), Google–Georgia Power Vogtle/Hatch uprates (~96 MW, secondary only).
10. **Date format.** Row 10's ESA was disclosed only as "October 2024", so `announced` is
    `YYYY-MM`. A loader mirroring `issuer_bonds.py` (`_DASHED_ISO`) would reject it. Either
    allow `YYYY-MM` or use the LPSC approval month with a note.
11. **Figure-in-quote check.** Quotes print MW as "1,920 megawatts", "615-MW", "1.2 GW",
    "2.1 GW" or "3 gigawatts". A `_mw_in_quote` analogue of `_coupon_in_quote` needs to accept
    comma thousands, a hyphenated "-MW", and GW/gigawatt forms scaled ×1000. For row 19 it
    should check the per-site 600 figure, with `sites: 3` as a separate field.

## 4. Dead ends and unverified (excluded from the draft JSON)

| Candidate | What was found | Why excluded |
|---|---|---|
| xAI–Solaris "Stateline Power" JV, ~900 MW, 7-year contract | Solaris 8-K ex. 99.1 (2025-04-28) states 900 MW and 7 years but names only "a major data center client" | **UNVERIFIED buyer**: xAI is identified only by press. It is also equipment leasing, not a PPA (edge case 7). |
| xAI Southaven turbines, "1.2 GW" | Press and secondary reports of an MDEQ permit | Secondary only, and self-generation |
| xAI–TVA/MLGW 150 MW (Feb 2026) | Local TV report | Secondary only. Utility service approval, not a supply deal. |
| Microsoft–Chevron/Engine No. 1, ~2,500 MW West Texas gas (Apr 2026) | Bloomberg-sourced statement: "no definitive agreement" | **UNVERIFIED**: no primary found, and it is exclusivity, not a signed agreement |
| Oracle–NextEra Point Beach subscription (Oct 2026) | WNN quotes Oracle's release; "10–20%" of the plant is in local press | No MW in any primary seen. The 125–250 MW figure is secondary. |
| Google–Fortum Loviisa, Finland (Sep 2026) | ANS / Fortum release reported as "up to 50%" of capacity, 22 years | No MW in the release as reported. Fortum's release was not fetched, so **UNVERIFIED**. |
| Google–NIPSCO "Alphabet Contract" | NiSource Q2-2026 10-Q: retail special contract approved by the IURC in July 2026 | MW not found in the filing excerpts read. Worth a follow-up in NiSource's Q1-2026 10-Q or the IURC order. |
| Google–Constellation 2,700 MW, 15-year | Constellation release (row 20 evidence) | Scope (edge case 2) |
| Brookfield–Google HFA, up to 3,000 MW | Brookfield release (row 16 evidence) | Framework ceiling. Only the 670 MW contracted is a row. |
| Amazon–Energy Northwest option to 960 MW | About Amazon (row 21 evidence) | Expansion option. Only the 320 MW phase 1 is a row. |
| Talen–AWS Cumulus, March 2024, 960 MW | Press, Talen S-1/A | Superseded by row 2 (edge case 5) |
| AEP Ohio–AWS Bloom fuel cells | AEP news (June 2025) | No MW disclosed for the AWS site |
| Stargate Abilene ~360 MW on-site gas | Texas Tribune and trackers | Secondary only. The developer (Crusoe) is the owner, so it is not a STARGATE-ticker purchase. |
| Meta–Williams "Socrates" behind-the-meter gas, Ohio | Williams names only "an investment-grade customer" | Buyer not named in the primary |
| Oracle–Bloom fuel cells | not pursued | No MW in coverage seen |
| Microsoft–Brookfield 10.5 GW framework (2024) | not fetched | Renewable portfolio aggregate, out of scope |

## 5. Recommended refresh cadence

- **Quarterly**, after earnings season (late Jan / Apr / Jul / Oct). Most new deals and status
  changes surface in 8-Ks and 10-Qs: Vistra, Constellation, Talen, NiSource, Entergy.
- **Event checks** on known pending items:
  - LPSC decision on Entergy's seven-plant Hyperion application (row 11), which was still
    pending in the sources read.
  - NRC restart milestones for Crane (2027–2028) and Duane Arnold (2029).
  - The PUCN status of the Fervo Clean Transition Tariff (row 18).
  - IURC/FERC orders on NIPSCO's ADS amendment for incremental service (Q4 2026).
  - Any MOU, LOI or option converting to a PPA (rows 8, 12, 19, 22, 26).
- **The pace is fast.** Three in-scope deals landed in the 6 weeks before this pass:
  Google–Fortum (2026-09-09 per press; MW unverified), Amazon–Calvert Cliffs (2026-09-30) and Google–Constellation
  (2026-10-06). The Oracle–Point Beach subscription was announced 2026-10-02 but stays in §4
  until a primary MW figure turns up. If the table is published, stamp `as_of_curated` and
  expect it to go stale within a quarter.

## Outcome (2026-10-08, owner decisions applied in `config/power_deals.json`)

- **Scope: all 26 rows, labeled.** A curated `kind` (ppa / utility supply / development / funding /
  other) sits beside the source's own `instrument` text, so the page keeps a literal PPA apart from
  utility-built supply and funding deals.
- **Fleet-wide supply excluded.** Google–Constellation's 2,700 MW PJM fleet deal names no plant, so
  it goes in the method note, not the table.
- **Hyperion expansion counted as `pending`, not signed.** Its quote says "proposed", and it still
  needs LPSC certification. That moves the signed total from 25,287 to 20,087 MW (9,550 MW of it
  PPAs). Pending is 5,200 MW. MOU, LOI and option total 4,850 MW, with Elementl counted as 3 sites
  × 600 MW via `sites`.
- **The draft JSON stays as the as-researched record.** The config is the curated version: it
  drops the "per site" `mw_basis` in favour of `sites`, and the MW-in-quote check accepts
  "3 gigawatts".
