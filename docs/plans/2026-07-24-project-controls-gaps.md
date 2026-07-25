# Project Controls Audience — Gap Register & Build Plan

> **Status:** register only — nothing here is specced to task level yet. Each item below is a
> *gap statement* with enough detail to start cold. Promote an item to a full plan doc
> (`docs/plans/` or `docs/superpowers/plans/`) before implementing it.

**Goal:** Make MacroGauge's data-center layer usable as a working instrument by hyperscaler
**Project Controls** organizations — the cost-estimating, cost-control, scheduling, change-management,
and risk functions inside AWS Capital Delivery, Microsoft CO+I, Google DC Delivery, Meta Infra, and
their owner's-rep / EPC counterparts.

**Source of truth for scope:** 2026-07-24 repo + published-JSON review (this file is the record of it).

## Why this audience, and what they're graded on

Every item is scored against the four things this function is measured on:

1. **Forecast accuracy** — did EAC hold?
2. **Contingency adequacy** — did we draw more than we carried?
3. **Energization date** — did the schedule hold?
4. **Defensibility** — can Finance and the board survive the number?

Their structural problem: DC-specific escalation data is annual, retrospective, and arrives as a PDF
(Turner & Townsend, Linesight, Cumming, Mortenson). ENR BCI is monthly but generic and city-weighted.
RSMeans is a quarterly cost book. **There is no DC PPI.** That absence is the wedge — and the site
already says so. Lead with it.

## Assets that already land (do not rebuild — these are the foundation)

Live in `site/public/data/datacenter.json` and `capacity.json` as of 2026-07-21:

- **DC Build +6.81% YoY, 12 weighted components, per-component `contribution_pp`.** Steel +1.10pp,
  switchgear +1.26pp, aluminum +1.00pp, copper wire +0.87pp. This decomposition is the exact format
  used to adjudicate or rebut an escalation claim.
- **Long-lead electrical carries real weight** — switchgear 14%, transformers 12%, generators 9%,
  HVAC 10%. 45% of the index sits in the packages that drive DC schedule risk.
- **PJM capacity auction ladder** — $28.92 → $269.92 → $329.17 → $333.44 /MW-day (11.5× in three
  delivery years).
- **Census C30** — $59.3B SAAR, +23.1% YoY, 33× the 2014 average, plus a real-dollar line deflated by
  our own Build index.
- **Turner & Townsend calibration rows** (2022–2025 escalation vs our Build YoY) — external validation
  against a name this audience already trusts.
- **51-state parity** with published formulas (`w_labor` 0.30 QCEW NAICS-23; `w_power` 0.55 EIA).
- **116 GW tracked / 29 companies / 112 geo-located sites** with tenant and lease terms.
- **The receipts culture** — published weights, per-card as-of dates, gate flags, append-only vintage
  store, and a *published negative result* (the year-ratio power nowcast lost to carry-forward,
  8.5 vs 5.2 MAE, so it shipped config-gated and off). For a defensibility-graded audience this is
  worth more than most features. **Preserve it in everything below.**

---

## P1 — Escalation calculator ($/MW bridge)

**Status:** shipped 2026-07-25 on `feat/dc-escalation` (historical-only; not yet merged to
main) · **Grades:** forecast accuracy, defensibility · **Effort:** low

**Gap.** We publish index points (`2018-01=100`) and YoY %. They estimate in **$/MW critical IT load**.
A reader sees "+6.81%" and asks "escalated against what base?" The index is deliberately *not* a
turnkey quote — methodologically correct, and stated on-page — but the bridge into an estimate is missing.

**Build.** Input: base cost (their $/MW or total $), base date, delivery window, market. Output:
escalated cost, a **component-level bridge** showing which packages drove it, and the volatility band.

**Key design constraint:** *the user supplies the base.* We never publish a $/MW benchmark we can't
defend. This keeps the honest "index, not quote" position while still landing in their workflow.

**Data path.** Needed two small pipeline changes, not zero: `dcindex.py` and `datacenter.py` gained a
monthly sample grid (`indexes.*.monthly.{months,index,components}`), because the point-in-time
`contribution_pp` snapshot cannot support a bridge over an arbitrary base month. Site-side, it did
reuse the client-side patterns in `site/src/components/CalculatorClient.tsx` (since-date) and
`MyInflationClient.tsx` (user-weighted basket). Full path:
`docs/superpowers/plans/2026-07-24-dc-escalation-calculator.md`.

**Acceptance.** A user can reproduce, by hand, any number the tool outputs from published
`datacenter.json` values. Bridge rows sum to the headline delta.

**Decisions locked 2026-07-24, time scope resolved 2026-07-25:**
- **Index scope: DC Build only.** Not Ops (monthly, lags 7wk behind Build), not Hardware (OEM story).
- **No location input.** Escalation is national. State parity multipliers are *level* multipliers
  (cost vs national), not escalation rates — a user's base cost for a real site already embeds local
  pricing, so applying `build_mult` on top would double-count location. Market translation, if ever
  wanted, is a visually separate second operation, never silently folded into the escalation.
- **Time scope: DECIDED — historical-only, no forward leg.** Was deferred pending a choice between
  "wait for P3, build together" and shipping historical-only now. Resolved in favor of
  historical-only: base month → latest publish, plus the two pipeline tasks noted above (not the
  "zero pipeline work" originally assumed, but still no forward-looking claim). Fully defensible
  today. The forward leg stays behind P3's own backtest gate and, when/if it clears, extends this
  same UI. **The historical calculator was built as a strict subset of the combined one — this did
  not cause a second UI build, only an additive one.**

---

## P2 — DC market panel (metro resolution) + capacity-competition join

**Status:** shipped 2026-07-25 on `feat/dc-market-panel` (Task 11 of
`docs/superpowers/plans/2026-07-25-dc-market-panel.md`) · **Grades:** forecast accuracy,
energization date · **Effort:** medium

**Gap.** State resolution is too coarse for site work — Virginia averages Loudoun with Bristol. The real
markets are ~15–20 named places: Northern Virginia, Columbus, Phoenix, Dallas, Atlanta, Des Moines,
Council Bluffs, Salt Lake, Abilene, New Carlisle, Mt Pleasant, Richland Parish, Memphis, Reno.

`metros.json` exists but is **50 metros of Zillow ZORI/ZHVI — consumer shelter, not construction.**
It does not serve this purpose.

**⚠ SUPERSEDED (measured 2026-07-25, before implementation) — do not re-derive.** This entry originally
asked for a panel joining ISO/utility and **announced MW within ~60 miles** from `capacity.json` `geo[]`.
Recon for the design spec refuted both the radius join and the ISO column; full measurements are in
`docs/superpowers/specs/2026-07-25-dc-market-panel-design.md` ("What recon established"). Summary:

- **The 60-mile capacity-radius join is not buildable.** Northern Virginia returns 1 site / 0 MW at 60mi
  (nearest MW-bearing site is 73.3mi out); Des Moines, Salt Lake City, and Reno return 0 sites even at
  150mi. `geo[]` is a 40% census of `companies[]` MW (private, non-filing operators — CyrusOne, Vantage,
  Aligned, STACK, QTS, EdgeConneX — own most of Loudoun's capacity and file nothing), and coordinate
  precision (`approx: true` on 70/112 entries) cannot support a defensible distance computation regardless
  of MW coverage. Structural, not curatable — same primary-source wall that nulled `context.transformer`.
- **No ISO column exists at state resolution.** There is no state→ISO map anywhere in the repo; ERCOT is
  energy-only with no capacity-auction analogue collected, nothing collects MISO's PRA, and PJM zonal
  pricing would require a paid Associate Membership to redistribute.
- **What shipped instead:** county-QCEW construction wage + employment (level and YoY, like-for-like
  county sets) is the headline — a *direct* craft-labor-tightness measurement, not a proxy — for a
  20-market, config-driven roster (`config/dc_markets.json`), each market a tight core-county list (not
  the MSA) with per-county receipts. `iso`/`utility`/`grid` are published as hand-curated market
  attributes (not derived from a radius join). The capacity join was **demoted, not dropped**: it
  ships as a denominated supporting column (sites / disclosed MW / undisclosed-MW sites, never a bare
  MW figure) keyed by hand-assigned market tag on each `capacity.json` `geo[]` entry — never a
  coordinate radius.

**Build (as shipped).** A panel keyed to 20 real DC markets, each row carrying:
- county construction wage level + YoY (QCEW NAICS-23, county resolution, like-for-like YoY)
- county construction headcount level + YoY
- spread vs the national rate for both (the tightness signal)
- hand-curated ISO/grid + utility, published as market metadata, not derived
- a denominated capacity-competition column (sites / disclosed MW / undisclosed-MW sites), joined by
  hand-assigned market tag, not radius
- per-county receipts so the market-level aggregation is checkable

---

## P3 — Forward DC escalation curve (12–36 months)

**Status:** not started · **Grades:** forecast accuracy, contingency adequacy · **Effort:** medium

**Gap.** Trailing YoY doesn't help someone budgeting a 2029 energization. They need "what factor do I
carry for a project breaking ground Q2 2027, energizing Q4 2029?"

**Have.** `/outlook` does 12-month forward for the CPI basket — 14 component paths, 8 forward drivers,
87.5% driver coverage, realized-volatility bands (`outlook.json`, `macrogauge_outlook_v1`).

**⚠ CORRECTION (verified 2026-07-24, after this register was first written).** The original entry said
"the engine exists; it has never been pointed at the DC indexes," implying a re-point. **That was wrong
on two counts — measured, not estimated:**

1. **`outlook.run()` is hard-coupled to the CPI gauge.** It takes `gauge_result` and reads
   `gauge_result["variants"]["gauge"]`; its 8 drivers are CPI-domain by construction (fuel, food-at-home,
   nat gas, used vehicles, wages, goods pipeline, shelter, new vehicles), each with its own
   `config/outlook.json` block keyed to CPI component codes. Reusable pieces are `engine/signals.py`
   helpers and the *architecture*, not `run()`. This is a sibling engine, not a parameter change.

2. **DC Build has 8.5% forward-driver coverage, vs the CPI outlook's 87.5%.** Only two of twelve
   components carry a `live_proxy` in `config/dc_basket.json` — `copper_wire` (0.055, `fmp_copper`) and
   `alum_shapes` (0.030, `fmp_alum`). The remaining **91.5%** has no forward market, including the
   largest weights: constr_wages 0.15, switchgear 0.14, transformers 0.12, HVAC 0.10, generators 0.09.
   DC Ops is **0%** covered. (DC Hardware is 15%, via `dramex_nand_mlc64` on storage.)

**What that means.** A DC forward curve would be ~91.5% trailing-median extrapolation wearing a forecast's
clothes. That is precisely the shape of claim the year-ratio power nowcast made before its backtest killed
it. **P3 must be gated by its own backtest against realized DC Build prints before publishing anything**,
and it may legitimately fail that gate and ship config-gated-off. Budget for that outcome; do not assume
a curve ships.

**Implication for P1.** P1 was made dependent on P3 on 2026-07-24 under the assumption P3 was a
medium-effort re-point. Given the above, **that dependency should be revisited** — see the P1 entry.

**Build.** 12–36 month forward path for DC Build and DC Ops, published **as an annual escalation factor
table** (2026: x%, 2027: y%, 2028: z%). That table format is literally the cell they paste into the
capital plan — ship the shape they consume, not just a chart.

**Risk.** Horizon >12mo exceeds what the outlook model was validated for. Either extend the volatility
band honestly or cap the published horizon. **Do not ship an unbacktested 36-month curve** — that would
contradict the power-tail precedent, which is the most credible thing we have.

---

## P4 — Long-lead equipment board (vendor backlog as lead-time proxy)

**Status:** not started · **Grades:** energization date, contingency adequacy · **Effort:** medium

**Gap.** The binding constraint in DC delivery right now is not transformer *price*, it's transformer
*availability*. We track price (PPI) for switchgear, transformers, generators, HVAC, pumps. We track
lead time nowhere.

**Prior art — read before restarting this.** `docs/superpowers/plans/2026-07-16-dc-context-layer.md`
Step 4 already chased transformer lead time, required a **primary** source (NEMA / DOE / Wood Mackenzie),
ruled that trade-press paraphrase does not count, found none, and correctly shipped
`context.transformer = null`. **That discipline was right and stands.** The approach was what failed,
not the standard.

**New approach — the verifiable path.** Public-company **backlog and book-to-bill** from filings:
Eaton, Schneider, ABB, Hitachi Energy, Vertiv, Cummins, Caterpillar, GE Vernova. Backlog growth against
revenue is a defensible, machine-readable *proxy for lead-time direction*, sourced to an 8-K/10-Q rather
than a trade rag. The FMP connector already exists — this is a new endpoint, not a new integration.

**Build.** Per critical package: price YoY (have) + backlog / book-to-bill trend (new) + source link.

**Framing constraint.** Publish it as a **directional proxy**, explicitly not a lead-time quote in weeks.
Same honesty posture as "wholesale tells you about the grid; it does not nowcast retail."

**Highest-novelty item on this list.**

---

## P5 — Claims-grade artifacts: export, citation, point-in-time

**Status:** partially tracked (todo.md #6) · **Grades:** defensibility · **Effort:** low

**Gap.** They need numbers they can put *in a document* — change-order justifications, claim rebuttals,
capital requests, board decks. Today: no CSV, no stable citation format, no PDF.

**Build.**
- CSV / Excel export of any series (already backlog #6 — **for this audience it is not hygiene, it is
  the use case**; re-rank accordingly)
- A stable, citable reference string: *"MacroGauge DC Build Index, 2026-07-21, 2018-01=100, +6.81% YoY"*
- A monthly one-page PDF — this audience circulates PDFs
- **A point-in-time page.** The append-only vintage store + `replay.json` mean we can prove what the
  index read on any past date, **never restated**. In a claims context that is the whole ballgame: the
  counterparty cannot argue we revised history. This currently reads as a methodology footnote; it
  deserves its own surface.

---

## P6 — Portfolio / program view

**Status:** not started · **Grades:** all four · **Effort:** medium

**Gap.** Everything on the site is market-level. They manage a *program*. There is no notion of "my projects."

**Build (light, no login).** Define projects — name, market, MW, base estimate, base date, delivery date —
persisted in localStorage/URL. Return portfolio escalation exposure: total capital at risk, weighted
escalation to date, forecast escalation to completion, and which components drive it.

**Why it matters commercially.** This is the feature that converts MacroGauge from a site they *read*
into a tab they *keep open*. Same client-side pattern as `MyInflationClient.tsx`.

**Depends on:** P1 (calculator math), ideally P3 (forward curve) for escalation-to-completion.

---

## P7 — Audience landing page + vocabulary

**Status:** not started · **Grades:** none directly (conversion) · **Effort:** low

**Gap.** The DC work sits under an inflation brand, in a nav group labeled "AI Infra." This audience
decides in ~15 seconds whether a site is for them, and the deciding words are **escalation, basis of
estimate, contingency, long-lead, GMP, market conditions, $/MW, energization** — not *CPI basket*.

**Build.** A dedicated landing page in their language with `/datacenter` and `/capacity` as its children.
Lead with "no official DC PPI exists, so we built one." Cheap, high conversion.

---

## P8 — Named contract-reference index (strategic, not a sprint)

**Status:** decision needed, not scheduled · **Effort:** business decision

DC construction contracts increasingly carry escalation clauses tied to a **named published index**, and
Project Controls picks which index goes in the contract. A versioned, methodology-frozen, compliance-grade
MacroGauge DC Build series could become that referenced index — the highest-ceiling outcome available here.

The receipts culture is the prerequisite and it already exists. What's missing is a **methodology freeze +
versioning policy** (an index referenced in a contract cannot have its weights quietly change). Flagging
now so P1–P7 don't accidentally foreclose it.

---

## Suggested build order

`P1 → P2 → P3 → P4 → P5 → P6 → P7`, with **P7 pullable forward at any time** (it's independent and cheap)
and **P5's CSV export pullable forward** (already backlogged, unblocks the claims story early).

P1 and P2 are the recommended start: highest value per unit effort, and both are pure assembly over data
already published.

## Deliberately not doing

- **The 12-slide `/deck`** — user is reworking or deleting it (2026-07-24). Any Project Controls deck cut
  should wait for that decision. If it returns: slides 4 (build drivers) and 7 (PJM 11.5×) are the ones
  that land; the missing slide is *"what this changes about the escalation factor you're carrying."*
- **Leading with the DC Hardware index (+19.15%).** Analytically the most interesting thing on the site,
  but it's an OEM/procurement story — Project Controls buys shell and fitout, someone else buys GPUs.
  Keep it, don't lead with it.
- **Re-chasing transformer lead time via trade press.** See P4 — the primary-source standard stands.

## Invariants any implementation must respect

Carried from `CLAUDE.md`; do not re-derive:

- HTTP injected, never real, in tests; `tests/test_run_daily.py`'s `fake_get`/`fake_post` must cover every
  new source.
- Store rows append-only and schema-versionless; never rewrite a committed partition.
- Every published file validates inline against `schemas/<stem>.schema.json`; `ValidationError` fails the
  run by design. Schemas must legally allow degraded output (nulls / empty arrays).
- New pipeline phases run in their own isolated `try/except` with an `*_ok` flag — a failure must not
  suppress other phases.
- Connector failure isolation + drift protection for any new scrape/unofficial source.
- Weights and formulas get published, not hidden. Every card carries an as-of date.
