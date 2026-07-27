# P4 — Long-lead equipment board (vendor order books as a lead-time proxy)

> **Status:** design, approved 2026-07-26. Corrects the P4 entry's FMP premise in
> `docs/plans/2026-07-24-project-controls-gaps.md` (see §2.1).
>
> **Register item:** P4, from `docs/plans/2026-07-24-project-controls-gaps.md`.
> **Grades:** energization date, contingency adequacy; defensibility is the design constraint
> throughout.

## 1. What this is

The binding constraint in DC delivery right now is not transformer *price*, it's transformer
*availability*. We track price (PPI) for switchgear, transformers, generators, HVAC and pumps; we
track lead time nowhere. `docs/superpowers/plans/2026-07-16-dc-context-layer.md` Step 4 already
chased a lead-time *quote* (weeks), required a primary source, found none, and correctly shipped
`context.transformer = null`. That standard stands.

P4 ships the verifiable thing instead: a **long-lead equipment board** joining, per critical
package, the price YoY we already publish with what each major vendor's own filings and earnings
documents say about its order book — backlog, orders, book-to-bill — as a **directional proxy for
lead-time pressure**. Explicitly not a lead-time quote in weeks. Same honesty posture as
"wholesale tells you about the grid; it does not nowcast retail."

Every number on the board traces to a company document. That is the whole feature.

---

## 2. What recon established, and what it corrected

Measured 2026-07-26 (four parallel probes: repo, EDGAR XBRL, FMP live, vendor primary documents).
**Do not re-derive.** Raw downloads preserved in the session scratchpad
(`edgar/facts_*.json`, `fsar_*.json`, `tr_etn.json`, `fmp_docs.html`).

### 2.1 ⚠ The register's FMP premise — mechanics narrowly confirmed, data claim refuted

The register says: *"The FMP connector already exists — this is a new endpoint, not a new
integration."*

- **FMP has no orders / bookings / book-to-bill endpoint at all.** The full docs page
  (527,476 bytes, fetched live) has **zero** matches for
  backlog / book-to-bill / remaining performance / unfilled / bookings / order book, while control
  greps hit (income-statement 18, transcript 42). A guessed `stable/backlog` route returns
  HTTP 404 `[]`.
- FMP *does* expose raw XBRL `revenueremainingperformanceobligation` via
  `stable/financial-statement-full-as-reported` (annual + quarterly, same host and auth as the
  existing connector — that half of the premise holds), **but the values are per-ticker
  untrustworthy**: Vertiv returns RPO **$24.5M** against its own **$10.23B** revenue in the same
  response — FMP flattens multi-context XBRL to an arbitrary single value. ETN/GEV/CMI/CAT looked
  coherent; SBGSY and HTHIY return empty `[]`; ABB is frozen at its last SEC filing.
- Net: what the register imagined as a machine-readable feed is, at primary-source standard,
  **mostly a hand-curation problem** — which is what this design builds (decision locked, §3).

### 2.2 EDGAR XBRL — clean for two of eight, with a silent-truncation trap

SEC's `companyconcept`/`companyfacts` API carries **only undimensioned facts**. When a filer moves
its RPO total onto the typed dimension
`RevenueRemainingPerformanceObligationExpectedTimingOfSatisfactionStartDateAxis`, the API series
**silently stops while the numbers keep appearing in filings**:

| ticker | API series | trap status |
|---|---|---|
| GEV | quarterly 2024Q1→2026Q2, clean, current ($176.3B) | clean |
| CAT | quarterly 2018Q1→2026Q1, current ($37.1B RPO); 3 COVID quarters missing | clean |
| ETN | **stops 2024-03-31**; Q1-2026 10-Q carries $22.8B on the typed dimension | trapped |
| CMI | **stops 2025-12-31**; same dimension move; also 10× scope drift in its own tag history ($643M → $6.3B) | trapped |
| VRT | no RPO numerator in XBRL at all; headline backlog lives in untagged 8-K exhibits | absent |
| ABB | 20-F annual only, dead after FY2023 (deregistered) | dead |
| Schneider | no EDGAR financial filings (ADR paperwork only; `companyfacts` 404s) | absent |
| Hitachi | last structured fact 2012-03-31; Hitachi Energy is a non-registrant | absent |

This is why the v1 data path is config-only (§3): an EDGAR connector would add coverage for two
vendors and inherit a failure mode that has already bitten two others.

### 2.3 What each vendor actually discloses, at primary-source standard

Verified verbatim against the company's own documents (8-K exhibits, 10-Q, quarterly PDFs, IR
decks), 2026-07-26. Trade-press paraphrase was excluded throughout — one web-search summary
claimed a "$462 billion" Cummins backlog that the filing itself flatly contradicts.

| vendor | quarterly disclosure | dollar figure? | DC-relevant scope |
|---|---|---|---|
| GE Vernova | orders $ + backlog $ (footnote: backlog ≡ RPO) + segment book-to-bill (~1.7 Electrification) + Gas Power GW backlog | yes, quarterly | Electrification; Power |
| Vertiv | backlog $15.0B + book-to-bill ~2.9x, 8-K press-release text | yes, quarterly | whole company (segments are geographic) |
| ABB | orders $ + order backlog $ by business area (Electrification $13,676M +57%), quarterly Financial Information PDF / 6-K; backlog note-defined as unsatisfied performance obligations | yes, quarterly | Electrification |
| Hitachi Energy | order backlog ¥9.2tn / **$57.9B** (+33%) in Hitachi Ltd quarterly earnings decks; segment orders ¥ | yes, quarterly | Power Grids (Hitachi Energy) |
| Caterpillar | "Order Backlog" $62.7B in 10-Q MD&A (stable boilerplate: "dollar amount of backlog believed to be firm was approximately $X") | yes, quarterly | total company only; Power & Energy color qualitative |
| Eaton | backlog **+44%** YoY and rolling 12-mo book-to-bill **1.2** (Electrical), 8-K exhibit; dollar backlog is **annual 10-K only** ($19.8B) | % quarterly, $ annual | Electrical Americas |
| Schneider | backlog **€25,362M** in the **FY** results release only; quarterly releases qualitative; se.com 403-blocks non-browser fetchers | annual only | Energy Management |
| Cummins | **nothing** — zero backlog/orders/book-to-bill mentions in Q1-2026 release and 10-Q (both verified); its $6.9B RPO note is maintenance-dominated, not a genset backlog | no | Power Systems (null) |

Segment-name trap, verified: Caterpillar's DC-relevant segment is now **"Power & Energy"** (67
mentions in the Q1-2026 10-Q; "Energy & Transportation" zero).

### 2.4 "Backlog" is at least three different numbers — never sum, never share an axis

Caterpillar's own Q1-2026 filings carry **$62.7B** "Order Backlog" (MD&A, believed-firm dealer
orders) and **$37.1B** RPO (XBRL) simultaneously. GEV's backlog is footnote-defined *as* RPO.
ABB's is order-based. These are different accounting objects. Every published figure therefore
carries a `basis` classifier (`rpo` / `order-backlog` / `mdna-backlog`) and a `scope` classifier
(`group` / `segment` / `product-line`), rendered as badges — the `dc_context` peers pattern.
Figures with different bases never share an axis or a sum, anywhere.

Derivation is where the distortions live: FX (ABB/Hitachi/Schneider report in $, ¥, €), M&A
(Eaton's Fibrebond backlog intangibles are the only "backlog" hits in its 10-Q), and tag scope
drift (CMI). Hence stated-only (§3).

---

## 3. Decisions locked (user, 2026-07-26)

1. **Placement: both** — a dedicated `/longlead` page plus a teaser strip on `/datacenter`.
2. **Metric posture: stated-only.** The board publishes ONLY figures the company itself states —
   verbatim metric name, value, basis badge, scope badge, period, as-of, verbatim quote, source
   URL. No derived book-to-bill, no derived YoY, no cross-vendor aggregation. The register's
   "backlog growth against revenue" derivation idea is dropped on the recon evidence.
3. **Data path: config-only for v1.** Hand-curated `config/dc_longlead.json` on the
   `capacity.json` operating model (quarterly refresh in earnings season, ~8 documents). No new
   connector, no registry change, no store series, no network. A machine cross-check leg (EDGAR,
   for GEV/CAT) can be added later without rework because the config stays the source of truth.

---

## 4. Content model

**Package-major board, vendors as atoms.** The five long-lead packages are the Build basket's
electrical + mechanical groups — 0.50 of Build weight, stated on-page:

| package | weight | vendors |
|---|---|---|
| `switchgear` | 0.14 | Eaton, ABB, Schneider, GE Vernova |
| `transformers` | 0.12 | Hitachi Energy, GE Vernova |
| `hvac_equip` | 0.10 | Vertiv |
| `generators` | 0.09 | Caterpillar, Cummins (null) |
| `pumps` | 0.05 | *none* — published null note |

Many-to-many is expected (GEV serves two packages); the config stores each vendor once and
packages reference vendor keys, so a vendor's figures cannot diverge between packages.

**Per package, the board shows:**
- **Price leg (have):** the component's PPI YoY at its own last observation, `last_obs`, `weight`,
  `contribution_pp` — joined from the same run's DC index result, never recomputed.
- **Vendor rows (new):** each vendor's latest stated figures. A **figure** is:
  `{metric, kind, basis, scope, value, unit, period, asof, quote, src}` with
  `kind ∈ {backlog, orders, book_to_bill, backlog_growth}`,
  `basis ∈ {rpo, order-backlog, mdna-backlog}`, `scope ∈ {group, segment, product-line}`,
  `unit ∈ {usd_b, eur_b, jpy_tn, pct_yoy, ratio}`, `period`/`asof` ISO dates, `quote` verbatim
  from the document, `src` a `[label, https-url]` pair. **`period` is the date the figure
  measures** (e.g. the quarter end, `2026-06-30`); **`asof` is the source document's publication
  date** (e.g. the 8-K date) — staleness ages on `asof`, the badge row shows `period`.

**Honest nulls are published, not omitted** (the `transformer = null` precedent):
- Cummins renders as a vendor row whose `null_note` states the finding: no backlog, orders, or
  book-to-bill disclosure anywhere; the $6.9B RPO note is maintenance-dominated and cannot be
  read as a genset backlog (verified Q1-2026 release + 10-Q, zero mentions).
- `pumps` renders as a package whose `null_note` states that no roster vendor discloses an
  order-book figure at primary-source standard.
- Schneider stays on the board with `cadence: "annual"` — its figure ages on a ~430-day allowance
  instead of quietly reading as fresh. (Curation note: H1-2026 results due 2026-07-30; re-check
  whether a numeric backlog appears.)

---

## 5. Config and loader

**`config/dc_longlead.json`** (hand-curated; `schema_version: 1`, `as_of_curated`):

```json
{
  "schema_version": 1,
  "as_of_curated": "<spike date>",
  "packages": [
    {"code": "switchgear", "vendors": ["etn", "abb", "schneider", "gev"], "null_note": null},
    {"code": "pumps", "vendors": [],
     "null_note": "No roster vendor discloses an order-book figure for industrial pumps at primary-source standard."}
  ],
  "vendors": {
    "gev": {
      "name": "GE Vernova", "ticker": "GEV", "listed": "NYSE",
      "dc_segment": "Electrification; Power (Gas Power GW backlog)",
      "cadence": "quarterly",
      "figures": [
        {"metric": "Backlog", "kind": "backlog", "basis": "rpo", "scope": "group",
         "value": 176.0, "unit": "usd_b", "period": "2026-06-30", "asof": "<spike>",
         "quote": "<verbatim from the release>",
         "src": ["Q2 2026 8-K press release", "https://www.sec.gov/..."]}
      ],
      "null_note": null
    }
  }
}
```

**`pipeline/dc_longlead.py`** — fail-loud loader, `dc_context.py` precedent. Validation rules
(each one a `ValueError` with a matchable message; a typo'd config must never publish a garbled
board):

- enums pinned exactly as §4; `cadence ∈ {quarterly, annual}`
- every figure: numeric non-bool `value`; ISO `period` and `asof` (4-digit years — the
  when-string trap from capacity curation applies); non-empty verbatim `quote`; `src` a 2-list
  whose second element starts `https://`
- per vendor: `figures == []` ⟺ `null_note` is a non-empty string (exactly one of the two ways
  to exist)
- per package: `code` must be a Build component code in `config/dc_basket.json` (loaded via
  `pipeline.dc_basket`) so the price join cannot dangle; every vendor ref resolves; no duplicate
  package codes; `vendors == []` ⟺ package `null_note` present
- top level: `schema_version == 1`; `as_of_curated` ISO date; optional `teaser` — a list of
  `"vendor_key:kind"` strings (e.g. `["gev:backlog", "vrt:book_to_bill"]`), each of which must
  resolve to a vendor that has a figure of that kind. This is the curated pick of what the
  `/datacenter` strip headlines, so the site never chooses (or computes) a highlight itself.

Loader returns frozen dataclasses (`LongLeadConfig`, `Package`, `Vendor`, `Figure`), pure data,
no I/O beyond the config read.

---

## 6. Publisher, artifact, staleness

**`pipeline/publish/longlead.py`** — pure
`build(cfg, dc_result, today) -> dict`, published as **`longlead.json` (the 36th artifact)** with
`schemas/longlead.schema.json` validated inline as it lands.

- **Join:** each package row carries `weight` from the basket config (passed in by `run_daily`
  via `pipeline.dc_basket` — a config read, available even when the engine is not), and
  `price_yoy_pct`, `price_last_obs`, `contribution_pp` read from
  `dc_result["indexes"]["build"]["components"][code]` — the component-YoY-at-own-last-obs values
  the DC engine already computed. If the DC phase failed, `dc_result` is `None` and the three
  price fields publish `null` while `weight` stays populated; the schema legally allows the
  degraded shape (nulls, empty arrays) end-to-end.
- **Staleness, computed at publish:** per vendor, `stale = (today − newest figure asof) >
  allowance`, allowance 120 days for `quarterly`, 430 for `annual`. A missed earnings season
  surfaces on-page instead of silently aging. Vendors with `null_note` carry `stale: false`
  (nothing to age).
- **Verbatim passthrough** otherwise: figures publish exactly as curated (quote, src, badges),
  plus `meta: {as_of_curated, build_weight_covered}` where `build_weight_covered` is the sum of
  the five package weights (0.50) *computed from the basket, not hardcoded*.

## 7. `run_daily.py` wiring

A **twelfth isolated phase** with its own `try/except` and a `longlead_ok` flag in `qa.json`,
ordered **after the DC index phase** (it consumes `dc_result`; runs with `dc_result=None` if that
phase failed — a broken engine degrades the board's price legs, never blanks the vendor rows).
`jsonschema.ValidationError` re-raises and fails the run, caught before the generic `Exception`,
exactly as the existing eleven phases pin it. No new source: collect, registry, and
`sources_status` are untouched.

## 8. Site surfaces

- **`/longlead`** — "Long-Lead Board" `NavItem` appended to the AI Infra group in
  `site/src/lib/nav.ts`. A **server component** (static tables/cards; no `"use client"`)
  importing `public/data/longlead.json` at build time. Render: intro stating what the board is
  and is not (directional proxy, **not a lead-time quote in weeks**) · per-package sections
  (header: label, weight, price-YoY chip with as-of; vendor rows: figure chips with value, basis
  badge, scope badge, period, stale badge; per-figure source links; null rows render their
  reasons in full) · a basis legend defining `rpo` / `order-backlog` / `mdna-backlog` in one line
  each, anchored by the Caterpillar proof ($62.7B MD&A backlog vs $37.1B RPO in the same
  filing) · `.method` prose carrying the framing constraint and the curation cadence. Reuses
  `KpiCard`, `table-card` / `data-table`, badge spans.
- **`/datacenter` teaser** — a `LongLeadStrip` component rendered `{longlead && ...}` beside
  `PowerPanel` / `ContextPanel`: the config-curated `teaser` figures as chips (§5) + "5 packages
  · 0.50 of Build weight" linking to `/longlead`. Conditional-on-null so a degraded publish
  drops the strip.

## 9. Testing

Config-only means the whole feature tests as pure functions — **no fixtures, no fake_get changes,
no network anywhere**.

- **Loader:** happy path against the real config (provenance present, enums hold); a
  parametrized garbled-config rejection per validation rule in §5.
- **Publisher:** join math against a minimal `dc_result`; degraded `dc_result=None` shape;
  stale-flag boundary at exactly the allowance (age == allowance → fresh; age > allowance →
  stale); schema validation of both populated and degraded outputs; `build_weight_covered`
  derived, not literal.
- **`run_daily`:** `longlead.json` written and `longlead_ok` true in the end-to-end test; a
  forced longlead crash still publishes every other artifact (isolation pin); a schema-invalid
  longlead payload fails the run (`ValidationError` ordering pin).
- **Site:** e2e smoke gains `/longlead` (30 routes, zero console errors) and a `/datacenter`
  teaser assertion; vitest only if a formatting helper emerges.

## 10. Acceptance criteria

1. Every number on `/longlead` traces to a company document by clicking its source link.
2. No derived figure exists anywhere in artifact or UI — grep-level check: no arithmetic on
   figure values outside the staleness age computation.
3. Figures with different `basis` values never share an axis, a sum, or an unbadged table column.
4. Cummins and `pumps` render as explicit, reasoned nulls.
5. Config values enter only from the verification spike's tee'd evidence (§11).
6. Full suites green: pytest (813 + new), vitest (137 + any), e2e (45 + new).

## 11. Seeding — spike discipline and curation duty

Recon produced verified verbatim quotes and URLs for all eight vendors, but **no value enters
`config/dc_longlead.json` except from a re-verification spike** (the dc-context SPIKE-FINAL
pattern): re-fetch each primary source, tee the evidence to the scratchpad, and transcribe
values/quotes/URLs from the fetched documents only. Recon's findings are the spike's checklist,
not the config's content. Known fetch hazards for the spike: se.com 403-blocks non-browser agents
(Schneider's quote was verified via a full republication; record which URL the citation uses);
ABB's `library.e.abb.com` download URLs carry expiring signed tokens — cite the stable news-center
release page.

Ongoing duty: one curation pass per earnings season (~8 documents, quarterly), updating
`as_of_curated`; the staleness flags make a skipped season visible on-page.

## 12. Deliberately not doing

- **Lead-time quotes in weeks** — the Step-4 primary-source standard stands; nothing here claims
  weeks.
- **Derived book-to-bill / backlog YoY / any cross-vendor aggregate** — §2.4; stated-only.
- **An EDGAR or FMP connector in v1** — §2.1/§2.2; two-vendor coverage against a demonstrated
  silent-truncation trap. Revisit only if the quarterly curation duty proves unsustainable, as an
  additive cross-check that nudges when a new filing lands — config stays the source of truth.
- **Kalshi/market pricing of lead times** — no such market exists at standard.
- **Trade-press numbers** — excluded by rule; recon caught a fabricated "$462B Cummins backlog"
  in a search summary, contradicted by the filing itself.
