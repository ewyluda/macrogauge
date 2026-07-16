# DC Context Layer — demand-side cards + backlog folds (Wave 5)

**Status:** Approved 2026-07-16 (brainstorming session; decisions: approach A — `context`
block inside datacenter.json, no new artifact; verification spike before any hand-seeded
value lands in config; EIA-930 Dominion demand deferred to its own wave).
**Follows:** waves 1–4b (all deployed through `583a406`). Source research:
2026-07-15 enhancement proposal (artifact 1c69e5c2), build-order item 5 — "cheap,
hand-seeded or existing-connector cards that make the page read like a hub, not a chart."

The /datacenter page prices the inputs; this wave adds the layer that says why they're
inflating — the demand and scarcity context — plus three backlogged pipeline quality items
the page has been waiting on. Everything here is either hand-seeded config or rides
existing keys; there are no external gates and no activation decisions.

## 1. Scope

**In scope (wave 5):**
- Hand-seeded context cards behind a verification spike: colo asking rate (CBRE),
  grid interconnection queue (LBNL), Turner & Townsend $/W validator, transformer lead
  time (spike-gated — ships only if a primary source confirms; otherwise omitted, not
  labeled).
- Four new live series on existing/derived access: `eia_diesel` (weekly retail diesel,
  existing EIA key), `cpi_water` (`CUSR0000SEHG01`, existing FRED connector),
  `kalshi_dc_count` + `kalshi_dc_nuclear` (new `KALSHI_DC` isolation key, keyless).
- A nullable, schema-pinned `context` block in datacenter.json + one new page section
  ("The bigger picture") between the power panel and state parity.
- Backlog folds: (1) dcindex freshness signal (`stale` flag per component from registry
  `max_staleness_days`); (2) per-group weight/contribution sums published; (3) raw
  per-state `power_cents`/`wage_level` in parity rows.

**Out of scope:** EIA-930 Dominion-VA demand (own wave — new API route); the
phase-registry refactor (approach A avoids a sixth isolation block); datacenter.json
payload trim (YAGNI until drill-downs land); anything wave-3b (compute section —
gated on data accumulation + DRAMeX consent, reminder routine set for 2026-07-30);
RunPod/Lambda posted-price scrapes.

## 2. Decisions locked in brainstorming

1. **Approach A:** context lives in datacenter.json (nullable block, `construction`/`power`
   precedent), hand-seeds in `config/dc_context.json` with a `pipeline/dc_context.py`
   loader (`dc_power.py` precedent). No new published artifact, no new run_daily phase.
2. **Verification spike first (task #1):** every hand-seeded number is re-fetched from a
   primary source before entering config; each card carries `asof` + `source`. The
   transformer lead-time card is spike-gated: no primary source → no card.
3. **`KALSHI_DC` is its own isolation key** (EIA_STATE/STEO/EIA_SPOT precedent): thin DC
   books must never fail the core KALSHI (CPI) row. Thin-book semantics differ
   deliberately from the CPI fetch: **no priced markets → skip (empty list), never an
   error** — CPI books are always live so raising is right there; DC books are
   speculative so absence is expected, and carry-forward + a render-when-present card
   absorb it.
4. **Store everything live** (diesel, water, both Kalshi series) as daily/weekly series —
   clocks start now; cards need only latest values but history accrues for free.

## 3. Hand-seeded config — `config/dc_context.json` + `pipeline/dc_context.py`

Loader mirrors `dc_power.py`: dataclasses, load-time validation (numeric values, non-empty
`asof`/`source` per card, T&T rows non-empty ascending years), fail-loud on a garbled
config. Candidate values, all pending spike re-verification (2026-07-15 research values
shown; the spike pins the final numbers + exact citation strings):

| Card | Fields | Research value | Primary source (spike re-verifies) |
|---|---|---|---|
| `colo` | rate_kw_mo, yoy_pct, vacancy_pct, under_construction_gw, asof, source | $194.95 / +6.5% / 1.4% / 6.0 GW | CBRE North America Data Center Trends H2 2025 |
| `queue` | generation_gw, storage_gw, asof, source | 1,400 / 890 | LBNL "Queued Up" 2025 edition |
| `tnt` | rows: [{year, escalation_pct}] (+ optional per-market $/W), asof, source | +5.5% YoY escalation; SV $13.3/W … PHX $9.8/W | Turner & Townsend Data Centre Cost Index |
| `transformer` | weeks, asof, source — **nullable; spike-gated** | ~128 wk (trade press, UNVERIFIED) | WoodMac or equivalent primary; else omitted |

Update cadence is honest by construction: every card publishes its `asof`, and the
methodology says these are hand-updated (CBRE semiannual, LBNL/T&T annual).

## 4. New live series (registry 26→27 sources, 269→273 series)

| code | source | source_id | cadence | staleness | notes |
|---|---|---|---|---|---|
| `eia_diesel` | EIA (existing key) | *spike pins the v2 seriesid* (weekly US retail diesel $/gal) | weekly | 10 | genset-fuel card |
| `cpi_water` | FRED (existing) | `CUSR0000SEHG01` | monthly | 45 | cooling-water CPI; known Oct-2025 gap already tolerated by forward-fill |
| `kalshi_dc_count` | KALSHI_DC (new key, keyless) | `KXUSADATACENTERS` | daily (thin) | 30 | expected 2026 US DC count from the strike ladder |
| `kalshi_dc_nuclear` | KALSHI_DC | `KXDATACENTER` | daily (thin) | 30 | P(nuclear-powered DC by 2030), single binary |

**Kalshi connector refactor:** extract the survival-curve/CDF expected-value math from the
CPI `fetch` into a shared helper; the CPI path's output must stay byte-identical (pinned
by the existing tests). New `fetch_dc(...)` (same module) computes: ladder → expected
count (reusing the helper); binary market → last price as probability, obs_date = fetch
date (these are standing questions, not monthly references — no reference-month
derivation). Drift checks: plausible ranges (count in (0, 50 000), prob in (0, 1]);
malformed payload raises "structure drift?". Thin-book skip per §2.3. The spike confirms
both tickers' live market shapes and the exact expected-value semantics for the count
ladder before implementation.

collect.py wiring: `KALSHI_DC` fetcher + registry source entry; `test_run_daily` fake
branches for both tickers; sources_status gains the row automatically.

## 5. Publish — `context` block in datacenter.json

`dcindex.context_block(conn, cfg, dc_result)` (power_block precedent — store reads plus
the already-computed build index, which §6's T&T `build_yoy_pct` rows need):

```json
"context": {
  "colo":        {…config passthrough…},
  "queue":       {…config passthrough…},
  "tnt":         {"rows": […], "asof": "…", "source": "…"},
  "transformer": null | {…config passthrough…},
  "kalshi":      null | {"dc_count_expected": 1234.5, "nuclear_by_2030_prob": 0.61,
                          "count_asof": "…", "nuclear_asof": "…"},
  "diesel":      null | {"latest": 4.80, "asof": "…", "unit": "$/gal"},
  "water":       null | {"yoy_pct": 4.1, "asof": "…"}
}
```

- Top-level `context` nullable (pre-config bootstrap, `construction` precedent); each
  live sub-object independently nullable (no store rows → null → card hidden).
- `water.yoy_pct` = YoY at its own last obs (`aggregate.yoy_at_obs`, hardware-gap
  pattern; None-safe when the base month is missing).
- Kalshi values are latest-vintage store reads, rounded at publish (2dp count, 2dp prob
  as percentage or 0-1 — pin: publish prob 0–1 with 2dp; site formats as %).
- Schema: `context` added to datacenter.schema.json as an OPTIONAL nullable property with
  every branch typed; no `required` list gains it. The writer always emits it (null until
  the config lands mid-wave), and — test-pinned — the currently-deployed document, which
  has no `context` key at all, must still validate against the new schema.

## 6. Site — "The bigger picture" section

Rendered between the power panel and state parity, only when `context` is non-null:
- KpiCard row: colo rate ("$194.95/kW-mo", context: vacancy + YoY + asof), queue
  ("1,400 GW queued", context: +890 GW storage), diesel ("$4.80/gal", genset fuel),
  water ("+X.X% YoY", cooling water CPI) — each card only when its sub-object exists.
- T&T validator: small table (year, T&T escalation %, our DC Build YoY that year) with a
  one-line framing ("annual external calibration for a daily index"). Our Build YoY per
  year comes from the published index — computed pipeline-side into `tnt.rows`
  (site computes nothing): each row gains `build_yoy_pct` (Dec-31 YoY of that year from
  the build index, null where the grid doesn't reach).
- Kalshi odds strip: two badges/mini-cards, render-when-present, labeled as
  market-implied odds with asof.
- Transformer card only if present.
- Methodology paragraph: provenance + cadence honesty, thin-book note, validator framing.

## 7. Backlog folds (pipeline quality items the page waits on)

1. **Freshness signal:** `dcindex.run(conn, today, basket_path=None, staleness=None)` —
   run_daily passes `{s.code: s.max_staleness_days for s in series}`. Every component
   entry gains `"stale": bool` — true when `(today − last_obs).days` exceeds the
   backbone series' allowance (False when staleness map absent/series unlisted: tests
   and callers without the map keep current behavior). Publisher passes it through;
   ComponentTable renders a muted "stale" marker beside Last obs. Closes "dcindex
   ignores max_staleness_days".
2. **Group sums:** each published index gains
   `"groups": [{"group", "weight": Σweight, "contribution_pp": Σcontribution_pp|null}]`
   (null when any member contribution is null — never partial sums silently). Site group
   header rows display them (the page comment explicitly waits on pipeline for this).
3. **Parity levels:** state rows gain `"power_cents"` and `"wage_level"` raw values
   (already fetched in `_by_state` tuples; currently discarded after computing
   relatives). ParityTable shows them as secondary columns.

## 8. Testing

- dc_context loader: happy path + rejection per rule (non-numeric value, empty
  asof/source, empty/descending T&T years, transformer-absent OK).
- Kalshi: CPI fetch byte-identical after helper extraction (existing tests unchanged =
  the pin); `fetch_dc` ladder worked example (hand-computed expected count), binary prob,
  thin-book skip (both tickers), range/drift rejections.
- context_block: every sub-object's null + populated branch; water YoY missing-base
  branch; rounding pins.
- Freshness: stale/fresh boundary (age == allowance → fresh; +1 day → stale), absent map
  → False everywhere, unlisted series → False.
- Group sums: worked arithmetic incl. null-member → null-sum branch.
- Parity levels: passthrough + rounding.
- Publish/schema: context null + fully-populated validate; currently-deployed document
  (no `context` key) validates against the new schema; writer passthrough.
- test_run_daily: fake branches for `KALSHI_DC` tickers, diesel, water; registry pins
  bumped to exact spike-confirmed counts (27 sources / 273 series).
- e2e: route count unchanged; page renders with null context (deploy-order safety) and
  with populated context.

## 9. Risks, ranked

1. **Hand-seeded staleness** — cards go stale silently between manual updates; mitigated
   by visible `asof` on every card + methodology cadence statement (capacity-auction
   precedent).
2. **Kalshi DC books die or change shape** — skip semantics + render-when-present mean a
   dead market removes a card, never breaks a run; drift checks catch shape changes.
3. **T&T/CBRE publish paywalled revisions** — the spike records exactly what a public
   primary source states; if a number can't be publicly re-verified, it doesn't ship.
4. **CPI regression via the Kalshi refactor** — the helper extraction is pinned by the
   untouched existing CPI tests; any behavior change fails the suite.
5. **Schema drift for consumers** — context is a new nullable key; nothing existing is
   touched; deployed-document validation is test-pinned.

## 10. Sequencing

Spike (verify all four cards + diesel seriesid + Kalshi DC market shapes, live) →
dc_context config/loader → Kalshi refactor + KALSHI_DC connector + registry wiring →
context_block + backlog folds (engine) → publish/schema → site section + methodology →
full gates (pytest ≥470+new / build / vitest / e2e) → close-out docs → push after user
approval (rebase over the daily bot commit; store JSONL union).
