# Year-Ratio Power Nowcast — like-month wholesale coupling for DC Ops (Wave 4b)

**Status:** Approved 2026-07-16 (brainstorming session; decisions: backtest gate before any
index activation; λ seeded from cost structure and validated by the backtest; backtest results
live offline in this spec + one methodology sentence).
**Follows:** wave 4 (`2026-07-15-power-tail-design.md`), whose §10 recorded the Option-B
deferral and queued this spec. All wave-4 machinery (connectors, backfill-to-2026-01, blend
engine, power panel, honest `tail.active=false`) is deployed through `1896974`.

Wave 4's level-anchored splice failed its live sanity gate: the smoothed hub composite swings
~2.8× on ordinary seasonality (spring ~18–25 → July ~54 $/MWh) while retail industrial power is
tariff-smoothed and seasonally flat (9.29 → 8.66 ¢/kWh over the same months), so the ops
headline exploded +6.2% → +52.3%. This wave couples wholesale to retail
**like-month-to-like-month**, which cancels seasonality by construction, damps the signal by an
explicit pass-through share λ, and — the process lesson — proves the coupling against realized
retail prints **before** the config flip that lets it touch the index.

## 1. Scope

**In scope (wave 4b):**
- A `year_ratio` transform in the engine (pure, config-selected per component) + config keys
  on the ops power component (`live_proxy_transform`, `live_proxy_passthrough`), restored
  `live_proxy_blend`/`live_proxy_smooth_days`.
- MISO weekend fix: the connector's calendar-aware skip drops ALL Sat/Sun market days
  (56 missing 2026-01→07, confirmed in store). Catch-up fetch window, store-blind.
- Backfill deepened to **2024-07-01** for CAISO + MISO (weekends included) + repair of the
  2026 MISO weekend holes.
- Offline backtest script; its graded table lands in §10 of this spec; the **config flip is the
  final commit and happens only if the flip condition (§6) passes**.
- Publish: `power.tail` gains `transform`/`passthrough`/`nowcast` when active (inactive shape
  byte-identical to today); capacity-auction `multiple`/`years_span` math migrates from
  PowerPanel into the pipeline. One new KpiCard ("Wholesale-implied industrial rate").
- Entry tasks folded from the wave-4 final review: blend-list dedup validation; bidirectional
  smooth↔blend loader validation; the PowerPanel math migration above.

**Out of scope:** `accountability_power` (own wave, ~Oct — published grading belongs there;
this wave's grading is offline by decision); new sources or series (**zero** — registry pins
stay 26 sources / 269 series); PJM DataMiner2; any retail-rate *modeling* beyond the single
pinned λ; wave 3b (compute section — separate track, its DRAMeX consent + regex gates are
already in motion).

## 2. Decisions locked in brainstorming

1. **Backtest gate first.** The ~12-month-deeper backfill the formula needs anyway doubles as
   the validation dataset; the flip ships only on a passing grade. Fail → Option-B fallback
   again (everything ships except the config flip; the graded table is recorded either way).
2. **λ = seed + backtest-validate.** Seeded from EIA cost-structure evidence (generation /
   purchased-power share of the industrial retail rate; plan task pins the citation), chosen
   among candidates by the backtest, shipped as a **pinned config constant with provenance** —
   the pipeline never refits.
3. **Backtest home = offline.** Checked-in script, graded table in this spec, one honest
   sentence in `/datacenter` methodology. No new published artifact (that's accountability_power's
   job in the fall).
4. **Residual anchoring at the last print** (§4): continuity at the splice + re-anchor on every
   print, as in `splice_anchored` — but the correction is now small model error, not a seasonal
   swing.

## 3. The transform

New pure function in `pipeline/engine/blend.py` (name: `splice_year_ratio`), slotting exactly
where `splice_anchored` slots in `dcindex.run`'s component loop:

```
W        = trailing_mean(hub_mean([caiso_sp15_da, miso_indiana_da]), 7)   # existing fns
model(t) = official_filled(t−365d) × (1 + λ·(W(t)/W(t−365d) − 1))
tail(t)  = model(t) × official(T0) / model(T0)      for t > T0 (last official print)
```

- `official_filled` = the rebased official index forward-filled on the daily grid (the ratio is
  scale-invariant, so rebased vs raw is equivalent; rebased keeps the output in index space).
- **W(t−365d) lookup, never fabricate:** nearest W observation at/before `t−365d` within a
  **7-day tolerance**; no observation in tolerance → that tail date is **skipped** (no output).
  Same rule for the anchor date T0. Weekend/holiday holes additionally shrink the 7-day
  trailing-mean sample (existing `trailing_mean` semantics, unchanged).
- λ semantics pinned by tests: λ=1 → tail YoY tracks smoothed wholesale YoY (up to the anchor
  residual); λ=0 → last year's seasonal shape re-anchored at T0 (NOT flat carry-forward —
  test pins the actual semantics, not a slogan).
- Downstream is byte-identical to wave 4: tail-scoped >5% gate with blend-aware
  `_arrived_today`, `aggregate.yoy_at_obs` at own last obs, `official+proxy` mode label,
  `tail_active` → `power.tail.active` pass-through.

## 4. Why residual anchoring is not wave 4's mistake again

Wave 4 anchored the wholesale **level** onto retail, importing the full seasonal swing. Here
the model already produces a retail-shaped value (last year's retail × damped like-month
ratio); the anchor factor `official(T0)/model(T0)` corrects only the model's error at T0 —
bounded by how wrong the coupling was for one month, not by the wholesale/retail seasonal gap.
It preserves the property we kept from copper: influence confined to the tail, self-corrects
every print. The backtest grades the **anchored** transform, so this choice is validated, not
assumed.

## 5. Config & loader

`config/dc_basket.json`, ops power component (final commit of the wave, gated on §6):

```json
"live_proxy_blend": ["caiso_sp15_da", "miso_indiana_da"],
"live_proxy_smooth_days": 7,
"live_proxy_transform": "year_ratio",
"live_proxy_passthrough": 0.5
```

(`0.5` is the placeholder shape — the committed value is whatever §6 selects; §10 records it.)

`pipeline/dc_basket.py` `DCComponent` gains `live_proxy_transform: str = "level"` and
`live_proxy_passthrough: float | None = None`. Loader validation (extending the wave-4 rules):
- `transform` ∈ {"level", "year_ratio"}; `year_ratio` requires `live_proxy_blend` +
  `live_proxy_smooth_days`; `passthrough` required by and exclusive to `year_ratio`;
  `passthrough` ∈ (0, 1].
- **Entry-task folds:** `live_proxy_blend` codes must be unique (dedup); smooth↔blend
  validated in BOTH directions (`smooth_days` without `blend` rejected, not just the reverse).
- Copper/aluminum (`level` default) and the dormant NAND proxy are untouched — pinned by the
  existing real-config test extending to the new fields.

`dcindex.run`: the component loop selects the transform — `level` → today's
`splice_anchored(idx, live_idx)`; `year_ratio` → `splice_year_ratio(idx_filled, W, λ)`.
No other engine line changes.

## 6. Backtest gate (`scripts/backtest_power_yearratio.py`)

Checked in, offline, reads the store only (no network), unit-tested (§9 — it is a shipping
gate, its math must be right).

**Protocol — replay deployment honestly.** For each gradeable retail print month M
(expected ~10: 2025-07 → 2026-04): compute the anchored tail value at M's obs date using only
wholesale observations dated ≤ that date, with **T0 = the newest retail print actually
available then** (2–3 months back — replicating the real ~75-day lag), then compare against the
realized print for M. Errors reported in YoY points (nowcast YoY vs realized YoY, both vs the
same year-ago base).

**Candidates:** λ ∈ {0, 0.25, 0.5, 0.75, 1.0} ∪ {cost-structure seed}.

**Baselines — two distinct naives, both must lose:** (i) **carry-forward** — predict M's value
= official(T0), which is exactly today's shipped no-tail behavior on the filled grid; (ii)
**λ=0** — last year's seasonal shape re-anchored at T0 (§3). These are not the same series and
neither is graded as a candidate winner.

**Flip condition (pinned):** the selected λ > 0 must
(a) beat BOTH baselines on MAE across graded months, and
(b) keep max |error| ≤ **3.0 YoY points**.
Pass → commit the §5 config flip + run the live sanity check (§11). Fail → everything else
still ships (transform machinery config-gated and tested, MISO fix, backfill, capacity-math
migration); `tail.active` stays false; §10 records the failing table and the spec's status
line gains the outcome.

## 7. Data plumbing

1. **MISO weekend catch-up (real fix, evidence in store):** every run fetches a trailing
   window of the last **4 market days** instead of only the newest, store-blind — the
   append-side value-dedupe makes re-fetches no-ops, so Monday's 8:40 ET run picks up the
   Fri/Sat/Sun files at ≤3 extra polite requests/run. The existing 404-skip semantics are
   unchanged (a genuinely absent file is a skip, not an error).
2. **Backfill** (`scripts/backfill_power.py`, extended): CAISO + MISO from **2024-07-01**
   through the existing 2026-01-01 start (weekends included), plus the 56 MISO 2026 weekend
   holes. Both retentions verified (MISO probed to ~2023+; CAISO OASIS deep). Same polite
   pacing (CAISO ≥5 s/windowed request, MISO ≥1 s/file, ~650 requests total), through the normal
   connectors with `vintage_date=today`; value-dedupe makes reruns no-ops. Controller-executed
   once, before the backtest task.
3. ICE and Henry Hub: untouched (panel-only, per wave 4).

## 8. Publish + site (no new routes)

- `pipeline/engine/dcindex.py` `power_block`: when the ops power mode is `official+proxy`,
  `tail` gains `"transform": "year_ratio"`, `"passthrough": λ` (both read from the component
  config) and `"nowcast": {"implied_cents_kwh", "yoy_pct", "asof"}` where
  `implied_cents_kwh = retail_raw(T0) × tail_idx(end)/tail_idx(T0)` (2 dp),
  `yoy_pct`/`asof` are **passed through** from the already-computed power component entry
  (single source of truth — never recomputed). Inactive shape stays byte-identical to today.
- `capacity_auction` block gains `"multiple"` and `"years_span"` computed in `power_block`
  from the config rows (null when fewer than 2 rows or a non-positive first price) — the
  PowerPanel client math (multiple/yearsSpan, `PowerPanel.tsx:33-44`) is deleted and the site
  goes back to computing nothing.
- `schemas/datacenter.schema.json`: `tail` gains the three optional fields;
  `capacity_auction` gains the two nullable numbers. Today's published inactive document must
  validate against the new schema unchanged (test-pinned).
- Site: PowerPanel renders one new KpiCard ("Wholesale-implied industrial rate",
  `X.XX¢/kWh` + `yoy_pct` context) only when `tail.nowcast` is present; capacity story line
  reads published fields. `/datacenter` methodology adds: like-month coupling formula in words,
  λ value + provenance, the honest pass-through caveat (wholesale moves ≠ contracted retail
  moves; λ states how much we let through), and the backtest sentence
  ("validated against N realized prints, MAE X vs Y for no-tail").

## 9. Testing (house conventions; zero new series, pins 26/269 unchanged)

- **The wave-4 regression test — most important in the wave:** a synthetic strongly-seasonal
  wholesale series against a flat retail series where `splice_anchored` provably produces a
  large spurious tail move and `splice_year_ratio` provably does not. Pins the reason this
  wave exists.
- `splice_year_ratio` pure tests: hand-computed worked example; anchor continuity at T0;
  7-day tolerance lookup (hit at 6 days, skip at 8); skipped-date behavior; λ=1 and λ=0
  semantics; empty-W → official-only (degrades exactly like today).
- Loader: transform whitelist, year_ratio↔blend/smooth/passthrough requirement matrix,
  passthrough range, blend dedup, bidirectional smooth↔blend — each a rejection test.
- MISO catch-up: Monday-style run fetches the 4-day window (fixture per day), re-fetch
  dedupe no-op, 404-in-window skip.
- dcindex integration: year_ratio component end-to-end (blend → smooth → year-ratio → gate →
  mode label → `tail.active`), gate trips on a sustained >5% smoothed-ratio move.
- Backtest script: grading math unit tests on synthetic store data (as-of masking honored,
  T0 lag honored, YoY-point error arithmetic).
- Publish/schema: inactive byte-identity; active-with-nowcast validates; capacity
  multiple/years_span incl. null branches. Site: vitest updated — PowerPanel renders the
  published capacity fields (client math deleted) and the nowcast card when present; e2e count
  unchanged (no new routes).

## 10. Backtest results (recorded post-run)

*Filled in by the backtest task before the flip decision: candidate table (λ → MAE, max |err|),
selected λ + provenance line, pass/fail against §6, and the flip decision taken.*

## 11. Risks, ranked

1. **Thin grading set** (~10 months, one utility cycle) — mitigated by the structural seed
   (λ is a cost share, not a free parameter), the max-error bound, and the honest fallback:
   a fail ships as today's behavior.
2. **2024-07→2025 MISO/CAISO backfill gaps** (retention edges, maintenance windows) — the
   7-day tolerance skips unbridgeable dates; the backtest only grades months with coverage;
   a month lost to gaps shrinks N, never fabricates.
3. **Anchor residual at an anomalous print** (T0 lands on a weird retail month) — bounded by
   re-anchoring at the next print; visible in the backtest, which replays exactly this
   mechanism.
4. **Ratio spikes from last year's denominator** (W(t−365) in a low-price trough) — damped by
   λ and by 7-day smoothing on BOTH sides of the ratio; sustained moves still trip the
   existing tail gate → amber badge, one-day hold.
5. **Schema drift for consumers** — inactive document byte-identity is test-pinned; all new
   fields optional.

## 12. Sequencing

Plumbing (loader keys + MISO fix) → transform + tests → backfill (controller) → backtest →
§10 recorded → **flip only on pass** → live pipeline run + sanity check (ops YoY vs the 6.22%
no-tail baseline; the move must be explainable by λ × wholesale like-month YoY × 0.55 weight)
→ full gates (pytest ≥436 / build / vitest / e2e) → push after user approval (rebase over the
daily bot commit; store JSONL conflicts resolve by union).
