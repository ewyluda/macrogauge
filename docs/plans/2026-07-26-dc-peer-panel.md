# DC escalation peer panel — verification spike + build note

> **This document is the gate.** A peer without a fetched URL and a verbatim quote in this file
> does not enter `config/dc_context.json`. Precedent: the transformer lead-time card, which was
> **omitted** rather than labelled "unverified" when no primary source could be found
> (`docs/superpowers/specs/2026-07-16-dc-context-spike-notes.md`).

**Date:** 2026-07-26 · **Branch:** `feat/dc-peer-panel` · **Scope:** generalize the singleton
`context.tnt` card into `context.peers[]`, seeded with **three** peers.

RLB (needs an `index_level` → derive path) and Mortenson (needs a blank-year cell) are explicitly
**deferred to a second PR** — see "Deferred" at the bottom.

## Why

The site carries exactly one external calibration peer. A single name reads as cherry-picking;
a panel with the **basis of each number printed next to it** reads as a methodology argument, which
is what this audience is graded on. The panel's job is not to show that many firms agree with us —
it is to show what each one measures, and therefore what the gap between them means.

Research backing: 93 candidates verified against fetched pages across 6 discovery lanes, 36
confirmed. The full tiering, 40 rejects-with-reasons, and the not-yet-swept categories live in the
research artifact; the durable conclusions are restated below.

## Peer 1 — Turner & Townsend, Data Centre Construction Cost Index (INCUMBENT)

Already in config; carried into `peers[0]` unchanged. Evidence is not re-derived here — it was
recorded in the 2026-07-16 wave-5 spike and remains valid.

| year | escalation_pct | evidence |
|---|---|---|
| 2022 | 15.0 | `reports.turnerandtownsend.com/dcci-2022/data-centre-cost-trends` — "an average 15 percent uplift in local currency construction costs" (single-sourced) |
| 2023 | 6.0 | dcci-2023 **and** dcci-2024 reports — "the overall average year-on-year cost increase across the index from 2022-2023 is six percent" (cross-validated) |
| 2024 | 9.0 | dcci-2024 **and** 2025-2026 reports — "the overall average year-on-year cost increase across the 2024 index is nine percent, compared to six percent in 2023" (cross-validated) |
| 2025 | 5.5 | 2025-2026 report — "5.5 percent increase in the cost per watt" |

Source of record: `docs/superpowers/specs/2026-07-16-dc-context-spike-notes.md` lines 95–131.

**Basis note.** This is T&T's *cost index* headline, not their separate **tender price inflation
(TPI)** metric — the 2026-07-16 spike deliberately did not use TPI, which prints different numbers
(4% TPI 2022-2023). Classified `basis: "cost_model"` on that evidence, and the distinction is why
this peer is not lumped in with the bid indices.

## Peer 2 — Turner Construction, Turner Building Cost Index

**Fetched 2026-07-26** — `https://turnerconstruction.com/uploads/cost-index-Q2-2026.pdf`
(HTTP 200, 471,355 bytes, 1 page). WebFetch cannot parse it; `pdftotext -layout` extracts cleanly.

Verbatim, the `YEAR / AVERAGE INDEX / %` table:

```
YEAR                      AVERAGE INDEX        %
2025                          1485           4.1
2024                          1426           3.9
2023                          1373           6.0
2022                          1295           8.0
2021                          1199           1.9
2020                          1177           1.8
2019                          1156           5.5
2018                          1096           5.6
2017                          1038           5.0
2016                           989           4.8
2015                           943           4.5
2014                           902           4.4
2013                           864           4.1
```

Verbatim methodology, printed on the same page:

> "The Turner Building Cost Index is determined by the following factors considered on a nationwide
> basis: labor rates and productivity, material prices and the competitive condition of the
> marketplace."

**Seeded rows: 2018–2025** (8 rows). The index runs to 2013, but our own Build YoY column starts at
2018, and rows where our own column is empty by construction read as missing data rather than as a
base date. The 2013–2017 values are recorded above if a longer table is ever wanted.

**Basis: `bid_price`.** "The competitive condition of the marketplace" is contractor margin and bid
climate, inside the number. We price inputs. This is the single most important label on the panel.
The classification is inferential, and the UI says so: Turner's method statement supports
margin-inside, but nowhere states that the series prices accepted tenders, so the badge renders as
"bid-price proxy" rather than a definitive bid index (PR #7 review, 2026-07-26). A peer that
explicitly prices tenders (RLB TPI, second wave) should get its own enum instead of inheriting
this one.

**Period basis: `annual_average`** — the `%` column is change in the *annual average* index, which
is roughly six months phase-lagged from a point-in-time 365-day YoY.

**Do NOT seed the quarterly `%` column** (2nd Qtr 2026 = 1.44, 1st Qtr 2026 = 1.32, 4th Qtr 2025 =
1.14, 3rd Qtr 2025 = 1.15). It is quarter-over-quarter and would read roughly 4× low in an annual
column. Recorded here because it is the obvious mistake for the next person reading this PDF.

**Naming hazard.** Turner Construction and Turner & Townsend are unrelated firms. Both peers must
always render with the full firm name; "Turner" alone is ambiguous to exactly this audience.

## Peer 3 — BLS, PPI New Office Building Construction (PCU236223236223)

**Fetched 2026-07-26** — `POST https://api.bls.gov/publicAPI/v1/timeseries/data/`, body
`{"seriesid":["PCU236223236223"],"startyear":"2017","endyear":"2026"}` → HTTP 200,
`status: REQUEST_SUCCEEDED`. Keyless.

Verbatim December index levels returned by the API:

```
2017 M12  132.3
2018 M12  139.7
2019 M12  144.7
2020 M12  146.9
2021 M12  167.361
2022 M12  200.106
2023 M12  204.580
2024 M12  210.225
2025 M12  216.724
```

Latest observation is `2026 M06 = 218.983`, carrying BLS footnote code **P**: *"Preliminary. All
indexes are subject to monthly revisions up to four months after original publication."*

Dec-over-Dec, **computed by us** from the levels above — this is why the peer carries
`derived: true` and the levels are quoted in config rather than only the percentages:

| year | calc | escalation_pct |
|---|---|---|
| 2018 | 139.7 / 132.3 | 5.59 |
| 2019 | 144.7 / 139.7 | 3.58 |
| 2020 | 146.9 / 144.7 | 1.52 |
| 2021 | 167.361 / 146.9 | 13.93 |
| 2022 | 200.106 / 167.361 | 19.57 |
| 2023 | 204.580 / 200.106 | 2.24 |
| 2024 | 210.225 / 204.580 | 2.76 |
| 2025 | 216.724 / 210.225 | 3.09 |

**Basis: `output_price` — corrected during review, and this correction is the reason the peer is
labelled the way it is.** The first synthesis classified this series as an *input / matched-model*
index and grouped it as methodologically on our side of the contract. That is wrong. PPI industry
series measure **the price contractors receive** for constructing new office buildings, which puts
it alongside Turner and RLB, not alongside our input basket. Shipping it mislabelled would have
been the most attackable cell on the page.

**Why carry it anyway.** It is the *de facto* deflator applied to data-centre capital plans, because
BLS publishes no data-centre construction PPI. The honest framing — the one that ships — is "the
official deflator available for DC work is an office-building index, and here is the gap", never
"the peer says 3.1%, we say 6.8%, we win". Its basket contains none of our 14% switchgear / 12%
transformer / 9% generator weighting, so part of every gap is definitional rather than evidentiary.

**Verified negative supporting the site's existing wedge.** BLS's own machine-readable industry
list (`download.bls.gov/pub/time.series/pc/pc.industry`) enumerates twelve NAICS 236/237/238
building industries and returns **zero** matches for "data cent". "There is no DC PPI" is therefore
checkable in one request rather than asserted. (`download.bls.gov` 403s browser user-agents and
per BLS policy wants a User-Agent carrying a contact email — relevant only if this is ever promoted
to a real connector.)

## What is deliberately NOT seeded

- **Turner's quarterly `%` column** — QoQ, see above.
- **Turner 2013–2017** — our own column is empty there.
- **Any forecast.** Every seeded row is a realised, backward-looking print. JLL's 2026 +6.0%,
  Linesight's 4.5–5.5% range and T&T's forward bid-price calls are forecasts; putting a forecast in
  the same column as a realised print invites the reader to score us against a number that was
  never a measurement. If a forecast is ever added it needs its own visual treatment.
- **RLB per-city rows** — "Washington, DC 3.98%" is generic building work in the District, not
  Northern Virginia. Beside a `/dc-markets` panel a reader will calibrate against it.
- **Anything from the 40 rejected candidates** — the durable ones: Census C30 and AIA/Deltek are
  *spending volume*, not price (C30 implies +74% for 2024); datacenterHawk and CBRE's DC trends are
  *leasing rates*; ENR and S&P PEG are hard-blocked; Construction Analytics is a composite that
  already includes Turner and Mortenson, so it would present one dataset as two corroborations;
  AECOM publishes no cost index at all.

## Build

1. `config/dc_context.json` — replace `tnt` with `peers[]`.
2. `pipeline/dc_context.py` — `tnt_rows`/`tnt_asof`/`tnt_source` → `peers: tuple[Peer, ...]`,
   frozen dataclass, loud validation on enums, key uniqueness, ascending years, row shape.
3. `pipeline/engine/dcindex.py` `context_block()` — loop peers, inject `build_yoy_pct` per row
   exactly as the `tnt` loop did.
4. `schemas/datacenter.schema.json` — `context.tnt` → `context.peers`, enums pinned. `run_daily.py`
   re-raises `jsonschema.ValidationError` before the generic handler, so a malformed peer fails the
   run rather than deploying — which is the safety we want on hand-seeded numbers.
5. `site/src/lib/peerRows.ts` + `peerRows.test.ts` — union-year matrix builder (mirrors the
   `dcEscalation.ts` / `dcEscalation.test.ts` convention, keeps client math under vitest).
6. `site/src/components/ContextPanel.tsx` — one table, row axis = sorted union of years, one column
   per peer plus our Build YoY. Column headers carry **always-visible basis and scope badges**;
   missing cells render an em dash and are never back-filled.

## Deferred to a second PR

- **RLB North America NCCI** — publishes a quarterly *level* series (Q1-23 247.49 → Q1-26 285.47),
  which means we choose the basis rather than accept the publisher's. Needs a `kind: index_level`
  row type plus a `derive` field on the peer. Also the only free route to ENR's BCI, which it
  reprints.
- **Mortenson** — only peer publishing a labor / materials / trade-partner split. Needs a blank
  2023 cell (the Q4-2023 edition publishes no annual figure — blank, not zero).
- **Promote BLS PCU236223236223 to a real registry connector** with `max_staleness_days`, so the
  official row refreshes itself instead of being hand-seeded. Logged as a todo.
- **Two tier-2 spikes worth a human hour:** the Cushman & Wakefield US Development Cost Guide
  flipbook (only known path to a US, DC-specific, multi-market $/MW peer) and T&T's own DCCI
  microsite per-market US$/W table (7 US markets that map onto `/dc-markets`).
