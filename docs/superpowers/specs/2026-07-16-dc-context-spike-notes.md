# DC Context Layer Verification Spike Notes (2026-07-16)

Verification run against live CBRE, LBNL, and Turner & Townsend public report pages, a live
Wood Mackenzie/DOE primary-source hunt for the transformer lead-time trade-press claim, the
repo's own EIA connector (diesel), and live Kalshi market fetches for both DC tickers. Corrects
the design doc's (`docs/superpowers/specs/2026-07-16-dc-context-layer-design.md` §3-4) research
values where useful, confirms most of them almost exactly, and settles one card as OMIT. These
strings/values are authoritative for Tasks 2-4 — where this file disagrees with the design doc or
plan, this file wins.

**Headline results:** CBRE and LBNL confirmed the research values essentially exactly (one minor
precision correction on CBRE's under-construction figure). Turner & Townsend's headline 2025
figure (+5.5%) also confirmed exactly, plus three additional cross-validated prior years pulled
straight from each year's own primary report page (2022/2023/2024). The transformer lead-time
figure (~128wk) turned out to be **trade-press-only — untraceable to any public Wood Mackenzie,
NEMA, or DOE page** despite a genuine primary-source hunt that surfaced two *different* real
WoodMac figures (120wk and 150wk, both from 2024); **VERDICT: OMIT**, per spec §2's "no primary
source → no card" rule. The diesel seriesid works on the first try, no probe of the alternate id
needed — but the brief's own `[-3:]` spot-check command grabs the three *oldest* observations
(1994!) due to the v2 API's descending default sort, a genuine footgun worth flagging. Both Kalshi
DC tickers are **priced live today** — no skip path exercised — and the ladder's cumulative
"Above X" semantics matched the design doc's assumption exactly.

## 1. CBRE — North America Data Center Trends H2 2025

**URL (primary, public press release):**
`https://www.cbre.com/press-releases/fast-growing-north-american-data-center-market-set-records-in-2025`
(fetched via WebFetch; a plain `curl` hits a Cloudflare JS challenge — see
`w5-spike-cbre-press.html` in the scratchpad, HTTP 403 body is the challenge page only, not
usable as evidence on its own — the WebFetch tool's browser-equivalent render got through).

**Verbatim quotes:**
- "The national average lease rate rose by 6.5% year-over-year to $194.95 per kW/month"
- "the vacancy rate fell to a historic low of 1.4%"
- "Capacity under construction fell to 5,994.4 MW at year end from 6,350.1 MW at the end of 2024"

**Verdict — confirmed, one precision correction:**
| field | research value | verified value |
|---|---|---|
| rate_kw_mo | $194.95 | **$194.95** (exact match) |
| yoy_pct | +6.5% | **+6.5%** (exact match) |
| vacancy_pct | 1.4% | **1.4%** (exact match) |
| under_construction_gw | 6.0 GW | **5.99 GW** (5,994.4 MW verbatim; "6.0" was a loose rounding) |

Evidence: `w5-spike-cbre-webfetch.log`.

## 2. LBNL — "Queued Up: 2025 Edition"

`emp.lbl.gov/queues` and the OSTI biblio page both return Cloudflare "Attention Required" 403s to
a plain `curl` (see `w5-spike-lbnl-queues.html`, `w5-spike-lbnl-news.html`) and WebFetch also
403'd on `emp.lbl.gov/queues` directly. **Worked instead: the PDF report itself**, hosted with no
Cloudflare gate:

**URL (primary, public PDF):**
`https://eta-publications.lbl.gov/sites/default/files/2025-12/queued_up_2025_edition_12.15.2025.pdf`
— `curl` HTTP 200, extracted with `pdftotext` (`w5-spike-lbnl-queued-up-2025.pdf` /
`.txt` in the scratchpad).

**Verbatim, title page:** "Queued Up: 2025 Edition / Characteristics of Power Plants / Seeking
Transmission Interconnection / As of the End of 2024 ... Lawrence Berkeley National Laboratory /
Interconnection.fyi ... December 2025"

**Verbatim, page 3 (High-Level Findings):** "Roughly 2,290 gigawatts (GW) of capacity actively
seeking interconnection (1,400 GW of generation; 890 GW of storage)"

Cross-checked independently via OSTI.gov (DOE's own archive, WebFetch succeeded there):
abstract states "As of the end of 2024, there were ~10,300 projects actively seeking grid
interconnection in the U.S., representing 1,400 GW of generation and approximately 890 GW of
storage." — byte-identical to the PDF.

**Verdict — confirmed exactly, straight from the primary PDF body (not just an abstract):**
| field | research value | verified value |
|---|---|---|
| generation_gw | 1,400 | **1,400** (exact match) |
| storage_gw | 890 | **890** (exact match) |

**Data-vintage note (load-bearing for the `asof` string):** the report is titled "2025 Edition"
and was *published* December 2025, but the underlying queue data is *as of the end of 2024* — a
~1-year publish lag is normal for this annual report. An early WebSearch AI summary (not a fetch)
conflated this with a different, more-recent "backlog eased somewhat in 2025" LBNL news post
citing different, larger totals (2,060 GW / 1,312 GW generation / 749 GW storage) — that item was
never independently fetched (Cloudflare-blocked) and is **not** the report the task brief named
("Queued Up 2025 edition"); 1,400/890 from the actual titled report is the correct pin.

Evidence: `w5-spike-lbnl-webfetch.log`, `w5-spike-lbnl-queued-up-2025.txt`.

## 3. Turner & Townsend — Data Centre Construction Cost Index

**URL (primary, 2025-2026 edition, public report site):**
`https://reports.turnerandtownsend.com/data-centre-construction-cost-index-2025/data-centre-cost-trends`

**Verbatim:** "Our data centre construction cost index for 2025 shows a 5.5 percent increase in
the cost per watt of building a traditional cloud-based, air-cooled data centre. This is markedly
lower than the 9.0 percent year-on-year increase we reported in our 2024 report."

Cross-validated with two *other* years' own report pages (each year states its own headline
figure, and each also restates the *prior* year's figure — giving two independent confirmations
for 2023 and 2024):

- **2024 report** (`reports.turnerandtownsend.com/dcci-2024/data-centre-cost-trends`): "Globally,
  the overall average year-on-year cost increase across the 2024 index is nine percent, compared
  to six percent in 2023." → confirms 2024=9%, 2023=6%.
- **2023 report** (`reports.turnerandtownsend.com/dcci-2023/data-centre-cost-trends`): "the
  overall average year-on-year cost increase across the index from 2022-2023 is six percent" →
  confirms 2023=6% independently.
- **2022 report** (`reports.turnerandtownsend.com/dcci-2022/data-centre-cost-trends`, single-
  sourced only): "an average 15 percent uplift in local currency construction costs" → 2022=15%.
  A separate WebSearch AI summary claimed "8 percent in 2022" from an unnamed source — that figure
  could not be traced to any primary T&T page and is **rejected as unverified**.
- 2021 and earlier: the `dcci-2021` report page exists but its fetched excerpt did not contain an
  escalation percentage; no earlier years were pursued further (brief requires "at minimum the
  latest" — four cross-validated years exceeds that bar; guessing years not found in accessible
  primary pages would violate the house honesty rule).

**Bonus (matches design spec's per-market mention exactly, not required by SPIKE-FINAL but
corroborates the spec's table):** Silicon Valley $13.3/W, Phoenix $9.8/W (2025 report).

**Verdict — confirmed exactly, plus 3 extra cross-validated years:**
| year | escalation_pct | source confirmation |
|---|---|---|
| 2022 | 15.0 | dcci-2022 report (single-sourced) |
| 2023 | 6.0 | dcci-2023 **and** dcci-2024 reports (cross-validated) |
| 2024 | 9.0 | dcci-2024 **and** 2025-2026 reports (cross-validated) |
| 2025 | 5.5 | 2025-2026 report (matches research value exactly) |

Note: all four figures are the same "year-on-year cost increase across the index" headline
metric, consistently worded across all three fetched report years — not to be confused with T&T's
separate "tender price inflation (TPI)" metric, which the 2023 report page also mentions with
different numbers (4% TPI 2022-2023, 12% TPI decrease in 2022) and which this spike deliberately
did NOT use.

Evidence: `w5-spike-tnt-webfetch.log`.

## 4. Transformer lead time — VERDICT: OMIT

**The researched ~128wk figure ("Wood Mackenzie's Q2 2025 survey") is trade-press-only.**
Fetched `industrialsage.com`'s article directly and asked for its citation: "does NOT provide a
hyperlinked source or specific URL to Wood Mackenzie data... text-based attribution only, without
a retrievable source document reference." A `site:woodmac.com` search for "128 weeks" returned
zero `woodmac.com` results — the search engine ignored the `site:` filter and re-surfaced the same
trade-press articles. **Cannot independently verify 128wk via any public WoodMac/NEMA/DOE page.**

A genuine primary-source hunt DID find real, public, unauthenticated Wood Mackenzie pages —
confirmed by `curl` (no auth/cookies) that the figures appear in the raw served HTML, not gated:

- **2024-04-02** — `woodmac.com/news/opinion/supply-shortages-and-an-inflexible-market-give-rise-to-high-power-transformer-lead-times/`:
  "Large transformers... have lead times ranging from 80 to 210 weeks" / "Transformer lead times
  have been increasing for the last 2 years - from around 50 weeks in 2021, to **120 weeks on
  average in 2024**."
- **2024-06-27** — `woodmac.com/news/opinion/4-years-into-a-difficult-transformers-market-in-the-us-is-there-a-potential-end-in-sight/`:
  "Lead times for power and GSU transformers have tripled since 2021, reaching an average of **~150
  weeks after receipt of order (ARO)** over the last two quarters."
- **2025-08-14** — `woodmac.com/press-releases/power-transformers-and-distribution-transformers-will-face-supply-deficits-of-30-and-10-in-2025/`:
  WoodMac's own most recent public statement on this topic — contains **no week-count figure at
  all**, only supply-deficit percentages.

DOE's July 2024 "Large Power Transformer Resilience Report to Congress"
(`energy.gov/sites/default/files/2024-10/EXEC-2022-001242...pdf`, fetched + `pdftotext`'d) states
a *different* metric: "36-month lead times being commonly quoted and maximum lead times reaching
as much as 60 months" — commonly-quoted/max, not "average," and not directly comparable.

**Reasoning for OMIT rather than substituting one of the two real 2024 WoodMac figures:** they
disagree with each other by 25% within the same calendar year (120wk vs ~150wk, six weeks apart in
publication date), both are now 2+ years stale against today (2026-07-16) for a fast-moving
supply-chain metric, and WoodMac's own most recent public 2025 statement deliberately dropped the
week-count headline in favor of deficit percentages — suggesting even WoodMac stopped publicly
restating a single "average weeks" figure. Picking between two disagreeing primary numbers to
backfill a "current" card would be an editorial call this spike isn't positioned to make. Per spec
§2 ("no primary source → no card"), **`transformer: null`** in the config.

Evidence: `w5-spike-transformer-webfetch.log`, `w5-spike-woodmac.html`, `w5-spike-doe-lpt-report.pdf`/`.txt`.

## 5. Diesel — EIA seriesid

Ran exactly the brief's command (after `set -a; source .env; set +a`):
```
.venv/bin/python -c "from pipeline.connectors import eia; import os; print(eia.fetch(['PET.EMD_EPD2D_PTE_NUS_DPG.W'], os.environ['EIA_API_KEY'])[-3:])"
```
**No 404 — the id works on the first try.** No probe of the `PET.EMM_EPMR_PTE_NUS_DPG.W`
alternate needed. Output (`w5-spike-diesel-fetch.log`):
```
[Observation(series_code='PET.EMD_EPD2D_PTE_NUS_DPG.W', obs_date='1994-04-04', value=1.109, ...),
 Observation(..., obs_date='1994-03-28', value=1.107, ...),
 Observation(..., obs_date='1994-03-21', value=1.106, ...)]
```

**Genuine finding (load-bearing, not in the design doc): those are the three OLDEST observations
in the series (1994!), not the "3 recent observed values" the brief asked for.** Root-caused by
querying the raw v2 API directly (`w5-spike-diesel-raw.json`): `response.total = 1687`,
`len(data) = 1687` (the full history fits in one unpaginated call — well under the ~5000-row page
cap noted in the power-tail spike notes for Henry Hub). The v2 `seriesid` route's **default sort is
descending by period** (most recent first: `data[0]` = 2026-07-13, ..., `data[-1]` = 1994-03-21 —
oldest). `pipeline.connectors.eia.fetch()` appends rows in that same order with no re-sort, so
Python's `[-3:]` slice grabs the tail of a *descending* list — the three oldest rows — while `[:3]`
is what actually gives "3 recent observed values." **This is a spot-check footgun only, not a
production bug**: downstream store/vintage reads select the latest obs via `MAX(obs_date)` in SQL,
never by list position, so `run_daily`/`store.append()` are unaffected. Worth a one-line callout
for the next person who runs this exact ad-hoc pattern.

**Working seriesid:** `PET.EMD_EPD2D_PTE_NUS_DPG.W`

**3 recent observed values** (correct order, live fetch 2026-07-16):
| obs_date | value ($/gal) |
|---|---|
| 2026-07-13 | 4.796 |
| 2026-07-06 | 4.578 |
| 2026-06-29 | 4.668 |

Matches the design plan's own worked example and test fixture row
(`("eia_diesel", "2026-07-13", 4.796)` in the Task 5 test) byte-for-byte — the plan author had
already spot-verified this live value; this spike independently reconfirms it.

Evidence: `w5-spike-diesel-fetch.log`, `w5-spike-diesel-raw.json`, `w5-spike-diesel-notes.log`.

## 6. Kalshi DC markets

```
curl -s "https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXUSADATACENTERS&status=open&limit=100"
curl -s "https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXDATACENTER&status=open&limit=100"
```
Both HTTP 200. Saved raw: `w5-spike-kalshi-count.json`, `w5-spike-kalshi-nuclear.json`.

**Both books are priced live today — no skip path exercised.**

**`KXUSADATACENTERS` (count ladder) — 7 markets, one event `KXUSADATACENTERS-26DEC31`, all
"greater_or_equal" binaries, floor_strike step 100, `last_price_dollars` strictly decreasing as
strike increases:**
| ticker | floor_strike | last_price_dollars |
|---|---|---|
| ...-T5200 | 5200 | 0.2800 |
| ...-T5100 | 5100 | 0.4500 |
| ...-T5000 | 5000 | 0.6400 |
| ...-T4900 | 4900 | 0.7500 |
| ...-T4800 | 4800 | 0.8500 |
| ...-T4700 | 4700 | 0.9000 |
| ...-T4600 | 4600 | 0.9400 |

This **confirms the cumulative "Above X" survival-curve semantics the design doc assumed** —
identical shape to `KXCPI`. `rules_primary` (verbatim, T5200): "If the number of data centers
listed by Data Center Map in the United States before the end of 2026 is at least 5,200, then the
market resolves to Yes." `rules_secondary`: "The count as of June 1, 2026 is 4313." (a live
anchor). `last_price_dollars` is a numeric string on every rung, parses cleanly with `float()`.

**Expected-value semantics — ran the plan's exact `_expected_from_ladder` algorithm by hand
against the live full 7-rung ladder:**
```
strikes = [4600,4700,4800,4900,5000,5100,5200]
probs   = [0.94, 0.90, 0.85, 0.75, 0.64, 0.45, 0.28]
gaps = [100]*6 -> tail = 50
values  = [4550, 4650, 4750, 4850, 4950, 5050, 5150, 5250]
masses  = [0.06, 0.04, 0.05, 0.10, 0.11, 0.19, 0.17, 0.28]   (sums to 1.0000)
EXPECTED COUNT = 5031.0   (well inside COUNT_PLAUSIBLE (0, 50_000) — no drift flag)
```
Confirms the plan's `_expected_from_ladder` helper works unmodified on the real payload — no
semantic changes needed for Task 3.

**`KXDATACENTER` (nuclear binary) — 1 market, no `floor_strike` (single-market fallback path is
exactly right):**
`last_price_dollars = "0.4600"` → probability 0.46. `rules_primary` (verbatim): "If US starts the
process of building a nuclear-powered data center on a military base before Jan 1, 2030, then the
market resolves to Yes." `title`: "Will the US start the process of building a nuclear-powered
data center on a military base before 2030?"

**Nuance for config/site copy (Tasks 2 and 9):** the market question is narrower than the generic
`nuclear_by_2030_prob` field name implies — it specifically asks whether the US *starts the
process* of building a nuclear-powered DC *on a military base*, not any nuclear-powered DC
anywhere. The field can still carry this value (it's the only live nuclear-DC market that exists),
but site copy should say something like "military-base nuclear DC (Kalshi)" rather than a bare
"will a nuclear DC be built" claim.

**Fixtures (both real, no synthetic prices needed — both books priced live):**
- `tests/fixtures/kalshi_dc_count.json` — trimmed to 5 of the 7 live markets (kept the 5 highest
  strikes, T5200 through T4800), real payload verbatim, `cursor` key preserved.
  Trimmed-fixture expected value (hand-computed, same algorithm): **5047.0** — close to but not
  identical to the full 7-rung live value (5031.0); expected artifact of trimming fewer points,
  not a bug.
- `tests/fixtures/kalshi_dc_nuclear.json` — the single live `KXDATACENTER-30` market, verbatim
  (already ≤5 at n=1).

Evidence: `w5-spike-kalshi-notes.log`, `w5-spike-kalshi-count.json`, `w5-spike-kalshi-nuclear.json`.

---

## SPIKE-FINAL

Config-ready JSON for `config/dc_context.json` (Task 2 — copy verbatim):

```json
{
  "colo": {
    "rate_kw_mo": 194.95,
    "yoy_pct": 6.5,
    "vacancy_pct": 1.4,
    "under_construction_gw": 5.99,
    "asof": "H2 2025",
    "source": "CBRE North America Data Center Trends H2 2025 (cbre.com)"
  },
  "queue": {
    "generation_gw": 1400,
    "storage_gw": 890,
    "asof": "2025 Edition (data as of end of 2024)",
    "source": "LBNL Queued Up: 2025 Edition, Dec 2025 (emp.lbl.gov)"
  },
  "tnt": {
    "rows": [
      {"year": 2022, "escalation_pct": 15.0},
      {"year": 2023, "escalation_pct": 6.0},
      {"year": 2024, "escalation_pct": 9.0},
      {"year": 2025, "escalation_pct": 5.5}
    ],
    "asof": "2025-2026 edition",
    "source": "Turner & Townsend Data Centre Construction Cost Index 2025-2026 (turnerandtownsend.com)"
  },
  "transformer": null
}
```

**Transformer VERDICT: OMIT.** No primary WoodMac/NEMA/DOE page publicly states the researched
~128wk figure; the two real primary WoodMac figures found (120wk @ 2024-04, ~150wk ARO @ 2024-06)
disagree by 25% and are both 2+ years stale. `transformer` stays `null` (see §4 above for full
reasoning).

**Diesel seriesid (Task 4):** `PET.EMD_EPD2D_PTE_NUS_DPG.W` — works with no 404, no probe of the
alternate id needed. 3 recent observed values: 2026-07-13 = 4.796, 2026-07-06 = 4.578,
2026-06-29 = 4.668 ($/gal). Spot-check footgun noted (§5): use `[:3]` not `[-3:]` to see recent
values with this connector's un-sorted output — production `run_daily` is unaffected (SQL
`MAX(obs_date)` selection, not list order).

**Kalshi DC market shapes (Task 3):** both `KXUSADATACENTERS` and `KXDATACENTER` are priced live
today — thin-book skip path exists but was not exercised. Ladder = cumulative "Above X" binaries,
identical shape/semantics to `KXCPI` — `_expected_from_ladder` needs no changes. Single-binary
fallback (no `floor_strike`) is exactly right for `KXDATACENTER`. Expected-value worked example
(live full ladder): strikes `[4600..5200]` step 100, probs `[0.94,0.90,0.85,0.75,0.64,0.45,0.28]`
→ **expected count 5031.0**. Binary: `last_price_dollars "0.4600"` → probability **0.46**.
Fixtures built from real live payloads (no synthetic marking needed): `tests/fixtures/kalshi_dc_count.json`
(5 of 7 rungs, expected 5047.0 on the trimmed set) and `tests/fixtures/kalshi_dc_nuclear.json`
(the single real market).

## Access notes

- **CBRE** (`cbre.com`): Cloudflare-gated against plain `curl` (JS challenge page); WebFetch got
  through cleanly. No fixture needed (no connector reads CBRE directly — hand-seeded config only).
- **LBNL** (`emp.lbl.gov`, `osti.gov`): both Cloudflare-gated against plain `curl` and WebFetch;
  worked around by fetching the underlying PDF directly from `eta-publications.lbl.gov` (no gate)
  and extracting with `pdftotext`. OSTI.gov's biblio page worked fine via WebFetch as an
  independent cross-check.
- **Turner & Townsend** (`reports.turnerandtownsend.com`): no gate, WebFetch worked directly on
  every year's report subpage tried (2022-2025).
- **Wood Mackenzie** (`woodmac.com`): opinion/news article pages are public (confirmed via `curl`,
  no auth) even though the site gates a downloadable PDF extract behind a lead-gen form; press
  releases are fully public.
- **DOE** (`energy.gov`): PDF report downloads with plain `curl`, no gate; `pdftotext` extracts
  cleanly.
- **EIA v2 API** (`api.eia.gov`): existing project key (`EIA_API_KEY` in `.env`) used read-only,
  confirmed via the repo's own `eia.fetch()` — a pure HTTP+parse function, no store I/O.
- **Kalshi** (`external-api.kalshi.com`): no auth needed for public market data, plain `curl`
  default UA returned 200 for both tickers.

## Report path

Full report: `/Users/ericwyluda/Development/macrogauge/.superpowers/sdd/task-1-report.md`
(supersedes any wave-4 content previously at that path — this file covers wave 5 task 1 only).
Fixtures: `tests/fixtures/kalshi_dc_count.json`, `tests/fixtures/kalshi_dc_nuclear.json`.
Raw evidence tee'd to `/private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/d9a85bbf-530e-4fbe-837b-90ffd983d619/scratchpad/w5-spike-*`.
