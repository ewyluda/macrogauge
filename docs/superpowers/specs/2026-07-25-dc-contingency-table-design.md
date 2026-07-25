# P3a — DC escalation contingency table + calculator forward leg

**Status:** design approved 2026-07-25, not yet planned to task level.
**Audience:** hyperscaler Project Controls (see `docs/plans/2026-07-24-project-controls-gaps.md`).
**Grades:** contingency adequacy, defensibility.
**Predecessor:** P1 `/escalation` (shipped 2026-07-25, `feat/dc-escalation`).
**Successors, deliberately deferred:** P3b grading harness, P3c DC forward engine.

---

## 1. What this is

`/escalation` gains a **"deliver by"** input and a **contingency basis table**. The reader enters a
base cost, a base date, and a delivery date; the page returns a cumulative escalation factor under
each of five named bases, an empirical percentile band matched to their exact window length, and a
component bridge for the basis they select.

**P3a makes no forecast.** Every published number is a stated, checkable claim about what has already
happened. That is what makes it shippable today — see §2, which establishes that a defensible
forecast is not currently buildable.

---

## 2. What recon established, and what it corrected

Measured 2026-07-25 against the repo and live sources. **The gap register's P3 entry was wrong on
several counts; these corrections supersede it. Do not re-derive.**

### 2.1 Corrections to the register

1. **True forward-curve coverage of DC Build is 0.0%, not 8.5%.** `fmp_copper` and `fmp_alum` are FMP
   *continuous front-month* symbols (`HGUSD`, `ALIUSD`) — one price, no expiry chain. FMP's
   `commodities-list` returns exactly 40 symbols, each with a single `tradeMonth`; a dated-contract
   probe (`commodities-quote?symbol=HGZ26`) returns `not_found`. Contango/backwardation is not
   computable from any connector in the repo at any price tier. The honest label for the 8.5% is
   **"daily market-priced input coverage,"** not "forward driver."

2. **The CPI outlook's "87.5%" is not weight coverage** and must never again be set against the DC
   8.5%. It is a driver-*status* score over 8 config blocks (`pipeline/engine/outlook.py:217-218`;
   `live=1.0, partial=0.5, fallback=0.0`; 7 live + 1 fallback = 87.5), pinned at
   `tests/test_outlook.py:77`. Weight-denominated, CPI is **97.2%** with ≥1 driver and **51.6%** with
   a *dedicated* component-specific driver.

3. **`/outlook` is itself a spot-momentum extrapolator.** Every driver signal is
   `signals.lookback_return` over a front-month series multiplied by a hand-set `pass_through`
   constant. There is no regression, no fitted beta, and no estimated elasticity anywhere in the
   repo. The register's critique of P3 — "trailing extrapolation wearing a forecast's clothes" —
   describes the shipped CPI engine too. The difference is degree, not kind.

4. **A vintage-true DC backtest is impossible today.** The entire 2017–2026 DC history was backfilled
   in a single sweep on 2026-07-12/15 (`ppi_steel` has exactly two vintage dates). `CPIAUCNS` is the
   only series in the store with real point-in-time release history. Any gate run before roughly
   mid-2027 grades against final-revision values that were not knowable at forecast time. **This is
   the reason P3a makes no forecast claim** — and the reason P3c's ship decision cannot be made yet.

5. **The published negative result is a hardcoded, now-stale React string.**
   `site/src/app/datacenter/page.tsx:211-220` states "best MAE 8.5 vs 5.2 YoY pts." Re-running
   `scripts/backtest_power_yearratio.py` against the current store still FAILs (exit 2) but now reads
   carry-forward **4.778** over 9 months, best λ=0.25 MAE 8.452. The verdict is unchanged and the gap
   has widened, but the site number is one print stale. It carries no as-of, is in none of the 34
   published JSONs, is not schema-validated, and nothing in CI would catch it drifting.
   **Out of scope for P3a; log it and fix it in P3b.**

### 2.2 The sample problem P3a exists to solve

Computed from the live published grid (`indexes.build.monthly`, 103 months, trailing partial month
dropped → 102 usable):

| | 2018-01 start (as published today) |
|---|---|
| YoY months | 90 |
| months with negative Build YoY | **1 of 90** (−0.20%, 2020-05) |
| min / max YoY | −0.20% / +20.69% |

Two failures follow directly:

**(a) The horizon-matched percentile band collapses.** Annualized, on the 2018+ sample:

| h | windows | indep | p10 | p50 | p90 | spread | COVID overlap |
|---|---|---|---|---|---|---|---|
| 12mo | 90 | 7.5 | +1.26 | +3.82 | +16.64 | 15.4pp | 37% |
| 24mo | 78 | 3.2 | +1.88 | +5.04 | +13.43 | 11.6pp | 58% |
| 36mo | 66 | 1.8 | +3.76 | +6.79 | +10.26 | 6.5pp | 86% |
| 48mo | 54 | 1.1 | +5.01 | +7.74 | +8.35 | **3.3pp** | **100%** |

A 4-year window reads 4.6× more certain than a 1-year window. That is entirely an overlap artifact:
100% of 48-month windows and 86% of 36-month windows contain the 2021–22 spike. Published as-is it
would tell a Project Controls reader that long windows are safe — the opposite of true, and exactly
the claim that burns a contingency budget.

**(b) The sample contains no downturn.** One negative month in ninety. A contingency table built on
2018+ data implies DC construction escalation has never meaningfully fallen. It has.

---

## 3. The unlock: backfill Build history to 2007-12

All 12 Build components are FRED series. Probed observation starts, 2026-07-25:

| component | w | FRED id | starts |
|---|---|---|---|
| `constr_wages` | 0.15 | `CES2000000003` | 2006-03 |
| `switchgear` | 0.14 | `WPU1175` | 1947-01 |
| `transformers` | 0.12 | `WPU1174` | 1947-01 |
| `hvac_equip` | 0.10 | `PCU333415333415` | 1977-12 |
| `elec_contractors` | 0.09 | `PCU23821X23821X` | **2007-12** |
| `generators` | 0.09 | `PCU333611333611` | 1982-06 |
| `steel` | 0.065 | `WPU1017` | 1939-01 |
| `plumb_hvac_contractors` | 0.06 | `PCU23822X23822X` | **2007-12** |
| `copper_wire` | 0.055 | `WPU10260314` | 1986-12 |
| `concrete` | 0.05 | `PCU327320327320` | 1965-01 |
| `pumps` | 0.05 | `WPU1141` | 1947-01 |
| `alum_shapes` | 0.03 | `WPU102501` | 1947-01 |

The binding constraint is the two contractor PPIs at 2007-12. **Common span: 2007-12 → 2026-06, 222
months. Zero new connectors, zero new series definitions** — a deeper fetch through the existing FRED
connector.

### 3.1 Reconstruction validated

The index was rebuilt from raw FRED data (rebase each component to 2018-01 = 100, Laspeyres weighted)
and compared against the published `indexes.build.monthly.index` over the 101-month overlap:

- **max absolute difference 1.241 index points — at `2026-06` only**, which is the copper/aluminium
  live-proxy splice the reconstruction deliberately skips
- **every other overlap month matches to 0.000 index points**; mean absolute difference 0.012

The backfill is arithmetically exact. The 2018-01 = 100 base and every currently-published value are
unchanged; history is added *before* the existing series, not recomputed.

### 3.2 What the deeper sample gives

| | 2018-01 (now) | 2007-12 (backfilled) |
|---|---|---|
| usable months | 102 | **222** |
| YoY months | 90 | **210** |
| negative months | 1 (1%) | **40 (19%)** |
| min / max YoY | −0.20% / +20.69% | **−5.40%** (2009-07) / +20.69% (2021-11) |
| mean / median YoY | +6.21% / +3.82% | +3.46% / **+2.69%** |
| independent draws @ h=12 | 7.5 | **17.5** |
| independent draws @ h=36 | 1.8 | **5.2** |
| regimes spanned | COVID spike only | **GFC collapse + COVID spike** |

Percentile band on the backfilled sample, annualized — the collapse is gone:

| h | windows | indep | p10 | p25 | p50 | p75 | p90 | spread | COVID overlap |
|---|---|---|---|---|---|---|---|---|---|
| 12mo | 210 | 17.5 | **−0.89** | +0.71 | +2.69 | +4.59 | +7.75 | 8.6pp | 16% |
| 24mo | 198 | 8.2 | −0.35 | +0.77 | +2.79 | +4.31 | +9.45 | 9.8pp | 23% |
| 36mo | 186 | 5.2 | +0.12 | +0.68 | +2.80 | +4.54 | +9.56 | 9.4pp | 31% |
| 48mo | 174 | 3.6 | +0.19 | +1.09 | +2.31 | +6.49 | +7.99 | 7.8pp | 36% |
| 60mo | 162 | 2.7 | +0.37 | +1.08 | +1.89 | +6.86 | +7.23 | 6.9pp | 39% |

`p10` at h=12 is **negative** once the GFC is in sample. That number does not exist in the current
data, and it is the single most important cell in the table for a contingency reader.

**Provenance caveat.** The backfilled column above is computed from a raw-FRED reconstruction, which
omits the copper/aluminium live-proxy splice in the trailing months (§3.1). Only windows *ending* in
a splice month are affected — a handful out of 210 — so the percentiles will shift marginally, not
materially, when recomputed on the published-plus-backfilled grid. The 2018-start column is computed
from the published grid and needs no such caveat. Re-run both after the backfill lands and record the
actual figures in the implementation plan.

**Independent-draw estimate** is `(n − h) / h`, i.e. the number of non-overlapping windows the sample
could have supported. It is published per row, not hidden.

---

## 4. Architecture

**Pipeline work is the backfill and nothing else.** The contingency math is entirely client-side,
computed from `indexes.build.monthly`, which `/escalation` already loads for P1's bridge.

This is a deliberate departure from the `/outlook` pattern (server-computed, its own artifact). The
reasons:

- It preserves P1's acceptance criterion verbatim: *a user can reproduce, by hand, any number the
  tool outputs from published `datacenter.json` values.* A percentile computed server-side and
  published as a scalar cannot be checked; one computed from the published monthly grid can.
- It costs **no new published artifact, no new JSON Schema, no new `run_daily` phase, no `qa.PHASES`
  / `qa._PHASE_DONE` wiring, no `*_ok` flag, no schema-violation test, no neighbour-isolation test.**
  The register's invariant list applies to new phases; P3a adds none.
- The regime definitions are formulas, and the invariant is that formulas get *published, not
  hidden*. They are stated on-page in the method block, and their inputs are the published grid.

### 4.1 Pipeline changes

| file | change |
|---|---|
| `config/series.json` | **none** — all 12 Build components already defined |
| `scripts/backfill_dc_history.py` | new one-shot backfill, follows `scripts/backfill_alfred.py`. Fetches the 12 Build components from 2007-12. Append-only; **no committed partition is rewritten**. The daily run is unchanged — it continues to fetch recent observations only, and carry-forward store semantics make the deeper history permanent once written |
| `pipeline/engine/dcindex.py:23` | `GRID_START` becomes per-index, derived from each index's own components' common first observation. **Ops and Hardware stay at 2017-01, untouched** |
| `pipeline/publish/datacenter.py` | published **daily** arrays keep their 2018-01 start; published **monthly** arrays extend to 2007-12 |

That last row is load-bearing for payload. Measured: the daily `dates` array for Build is 3,127
points today and would roughly double; `datacenter.json` is 575KB on disk. The monthly block is
14.2KB at 103 months and projects to **30.6KB at 222 months** — which is all the contingency math
needs. Publishing a slice while the internal grid runs deeper is the existing convention (see
`CLAUDE.md`: grid start is 2017-01 internally; writers publish from 2018-01).

### 4.2 Site changes

New module, with colocated vitest per repo convention:

- `site/src/lib/dcContingency.ts` — named bases, horizon-matched percentiles, per-basis
  decomposition, disclosure statistics
- `site/src/lib/dcContingency.test.ts`

Additive edits at the three seams P1 cut and documented at
`docs/superpowers/plans/2026-07-24-dc-escalation-calculator.md:1009-1011`:

- `site/src/lib/dcEscalation.ts:39-46` — `escalate()` gains an optional forward segment;
  `EscalationResult` grows fields. **Nothing is renamed or removed.**
- `site/src/components/DcEscalationClient.tsx:83-112` — a `DELIVER BY` `<input type="month">` as a
  third child of the existing two-`<label>` flex row; state hooks at `:27-31`
- `KpiCard`'s already-optional `chip?: ReactNode` slot (`KpiCard.tsx:12-24`) carries the band

---

## 5. The math — prescriptive

### 5.1 Named bases

Five bases, each defined as an **annualized index ratio over a stated window**. Measured on the
backfilled sample, anchored at the last complete month (2026-06 as of writing):

| basis | window | kind | months | annualized | cumulative |
|---|---|---|---|---|---|
| Long-run (full sample) | 2007-12 → last complete | **rolling end** | 222 | **+3.64%** | +93.70% |
| Downturn regime (GFC) | 2008-12 → 2011-12 | **absolute** | 36 | **+2.47%** | +7.60% |
| Trailing 3yr | last 36 complete months | **rolling** | 36 | **+4.76%** | +14.96% |
| Current momentum | last 12 complete months | **rolling** | 12 | **+6.90%** | +6.90% |
| Peak regime (COVID) | 2021-04 → 2023-12 | **absolute** | 32 | **+8.61%** | +24.63% |

These are computed against the **published** index, which carries the copper/aluminium live-proxy
splice in its trailing months. A raw-FRED reconstruction that skips the splice gives +3.68% / +5.02%
/ +7.70% for the three rolling bases — up to 80bp higher on `Current momentum`. **The two absolute
bases are bit-identical either way**, because no splice falls inside 2008-12 → 2011-12 or
2021-04 → 2023-12. Implementations must read the published grid, not re-derive from FRED.

**Rolling vs absolute is a required distinction, not a presentational one.** The three rolling bases
re-derive every publish and their values will drift; the two absolute bases are fixed historical
episodes and their values must never move once the backfill lands. A test should pin the two absolute
values.

The two absolute windows are hand-set to the observed episodes — the GFC construction downturn and
the 2021–23 spike — and both are stated on-page with their bounds. They are not derived by a rule,
and the spec does not pretend otherwise.

**The annualized-ratio definition is load-bearing and must not be substituted with a median or mean
of YoY prints.** For trailing-3yr, the median of YoY readings is +3.45% while the annualized ratio is
+5.02% — and the median **cannot be decomposed additively**. Only the ratio preserves P1's bridge
identity.

`Current momentum` is the null the power-nowcast precedent graded against (carry-forward). Putting it
on the page as a visible row rather than burying it inside a gate is deliberate: the reader sees the
naive answer alongside the alternatives and can judge for themselves.

The two window-anchored regimes (`Downturn`, `Peak`) are applied to the reader's window by carrying
their annualized rate, not by replaying their month-by-month path.

### 5.2 Bridge identity

Decompose the **cumulative** delta; derive the annualized rate from the total:

```
contrib_i = w_i · (I_i(b) − I_i(a)) / H(a)
```

where `I_i` is component `i`'s rebased index, `H` the Laspeyres headline, `a` the window start and
`b` the window end. Exact in exact arithmetic; verified to **3.4e-5 pp** against the published grid,
the residual being the published values' 3-decimal rounding.

**Do not annualize per component and then weight.** That leaves a Jensen gap of up to 0.089pp and the
bridge rows will not sum to the headline — the exact failure P1's acceptance criterion exists to
prevent. Annualize the *total* only.

Worked example — trailing 3yr, 2023-06 → 2026-06, cumulative **+14.96%**, annualized **+4.76%/yr**,
computed from the published component grid:

| component | w | own %/yr | contrib (pp of cumulative) |
|---|---|---|---|
| `switchgear` | 0.14 | +8.77% | **+4.02** |
| `copper_wire` | 0.055 | +12.35% | +2.08 |
| `constr_wages` | 0.15 | +4.40% | +1.78 |
| `transformers` | 0.12 | +3.16% | +1.43 |
| `alum_shapes` | 0.03 | +13.55% | +1.20 |
| `hvac_equip` | 0.10 | +3.42% | +1.13 |
| `generators` | 0.09 | +4.25% | +1.05 |
| `pumps` | 0.05 | +5.16% | +0.78 |
| `elec_contractors` | 0.09 | +1.67% | +0.45 |
| `concrete` | 0.05 | +3.02% | +0.44 |
| `steel` | 0.065 | +1.49% | +0.38 |
| `plumb_hvac_contractors` | 0.06 | +1.32% | +0.23 |
| **sum** | 1.000 | | **+14.96** |

Switchgear alone is 27% of the last three years' escalation. That single row is the thing this
audience uses to adjudicate a claim, and it is why the bridge has to sum.

### 5.3 Percentile band

Horizon-matched over realized windows of the reader's exact window length. Every displayed band
carries:

- window count
- independent-draw estimate `(n − h) / h`
- COVID-overlap share — the fraction of contributing windows that intersect **2021-04 → 2022-12**,
  the spike episode; this window is a stated constant, not derived
- the sample span and the two episodes it is made of

**Horizon cap: 48 months**, applied to the delivery-date input itself — not to the band alone. At
h=48 the sample gives 174 windows and 3.6 independent draws; beyond it the count falls below 3 and
the band stops being a distribution. Capping the whole input rather than degrading one row keeps a
single rule on the page: **every basis and every band the reader sees covers the same window.** The
UI states the cap and its reason rather than silently clamping.

Forty-eight months covers the register's stated 12–36 month range with headroom, and covers a
mid-2026 base against a 2029-2030 energization.

### 5.3.1 Input edge cases

- **Base date before 2007-12** — reject with the sample start named. There is no index before it.
- **Base date after the last complete month** — reject; a base cannot be in the stub month or the
  future.
- **Delivery date at or before the last complete month** — this is P1's pure-historical case. Fall
  through to `escalate()` unchanged, show no forward segment and no band.
- **Delivery date more than 48 months past the last complete month** — reject per the cap above.
- **Window shorter than 12 months on the forward leg** — bases still apply (they are rates), but the
  band's smallest supported `h` is 12; below that, show bases only and say so.

### 5.4 Anchoring

**Every basis anchors on the last complete month, not `months[last]`.**

Two verified reasons. `pipeline/engine/dcindex.py:88` computes `end = min(max(max(s) for s in
built.values()), today)` — a `max` over component end dates — so the Build grid runs up to 53 days
past the last date at which 91.5% of the basket had real data. Consequently the trailing monthly
point (currently `2026-07`) is a 24-day stub in which only `copper_wire` and `alum_shapes` (8.5% of
weight) moved; the other 91.5% is June forward-filled. Anchoring a rate on it would read a
two-component move as a basket move.

---

## 6. Copy that must change

`site/src/app/escalation/page.tsx:69-73` currently reads: *"This is history, not a forecast: it
measures what input prices have already done, and stops at the last print."*

The page now projects forward, so that sentence becomes false as written — but the claim underneath
it must stay true. The replacement states that the bases are **realized regimes the reader may choose
to carry, not a prediction of which one obtains.** The distinction between "we are not forecasting"
and "nothing here extends past the last print" is the whole of P3a's defensibility, and the copy has
to carry it.

---

## 7. Deliberately out of scope

- **Any forecast, central path, or model.** No gate is needed because no forecast claim is made.
- **The grading harness and the stale hardcoded MAE string** (§2.1 item 5) — P3b.
- **The DC forward engine** — P3c, and its ship decision cannot be made until real vintages
  accumulate (~mid-2027).
- **Location input.** Parity multipliers are *level* multipliers, not escalation rates; a real site's
  base cost already embeds local pricing, so applying `build_mult` double-counts. Unchanged from P1;
  a "deliver by + where" UI is the obvious wrong next step.
- **A Turner & Townsend anchor row.** `config/dc_context.json` `tnt.rows` is retrospective only
  (2022 +15.0%, 2023 +6.0%, 2024 +9.0%, 2025 +5.5%). Their forward figures exist but are
  PDF/hand-curated and add a recurring maintenance burden for a number that is not ours.
- **Ops and Hardware.** Both indexes untouched, at their current 2017-01 grid start. (Noted for
  later: Hardware's 15% proxy coverage is *inactive as published* — `blend.py:78` `splice_anchored`
  returns official-only because `ppi_storage` ends 2026-06-01 while `dramex_nand_mlc64` rows start
  2026-07-15, so the overlap is empty. It self-heals when the July PPI print lands ~2026-08-14.)
- **Backfilling beyond 2007-12.** Ten of twelve components reach back decades, but the two contractor
  PPIs do not, and splicing a 10-component basket onto a 12-component one would break the weight sum
  invariant.

---

## 8. Risks

1. **2008-era PPI methodology breaks.** `PCU23821X23821X` and `PCU23822X23822X` begin at 2007-12,
   exactly at the boundary. A discontinuity check against the other ten components is required before
   the backfill is trusted — a level break at series inception would propagate into the GFC regime,
   which is the whole reason for the backfill.
2. **The trailing-month stub** (§5.4). Anchoring on `months[last]` is the most likely
   implementation error and it is silent.
3. **The band is still one downturn and one spike.** 17.5 independent draws at h=12 is a real sample;
   it is not a stationary distribution. The disclosure must name the two episodes rather than report
   a bare percentile.
4. **Payload.** If the daily-array slice in `publish/datacenter.py` is missed, `datacenter.json`
   roughly doubles for no benefit, on a file every `/datacenter` and `/escalation` visitor loads.
5. **Regenerating the index changes chart history on `/datacenter`.** The monthly arrays grow from
   103 to 222 points. Any consumer that assumes the arrays start at 2018-01 needs checking — the
   daily arrays are unchanged, which limits but does not eliminate the blast radius.

---

## 9. Acceptance criteria

1. A reader can reproduce, by hand, any number the page outputs from published `datacenter.json`
   values — bases, percentiles, and bridge alike.
2. Bridge rows sum to the basis they decompose, to within 1e-4 pp of the published cumulative
   (exact in exact arithmetic; the residual is the published grid's 3-decimal rounding).
3. The reconstruction check in §3.1 is re-run after the backfill lands and every pre-existing
   published monthly index value is unchanged (excepting live-proxy splice months).
4. Every band displayed carries its window count, independent-draw estimate, and sample span.
5. The delivery-date input is capped at 48 months past the last complete month, with an on-page
   reason, and every §5.3.1 edge case is handled explicitly rather than producing `NaN` or a silent
   clamp.
6. The two absolute-window bases (GFC, COVID peak) are pinned by test and do not move between
   publishes; the three rolling bases are not pinned.
7. Every basis anchors on the last complete month; a test proves the trailing stub month is excluded.
8. `escalation/page.tsx`'s no-forecast claim is true as written after the rewrite.
9. `npm test`, `npm run e2e`, `npm run build`, and `pytest -q` all green; `/escalation` already has an
   e2e route entry, extended with assertions for the new controls.

---

## 10. Invariants carried from `CLAUDE.md`

- HTTP injected, never real, in tests.
- Store rows append-only and schema-versionless; **never rewrite a committed partition** — the
  backfill adds rows for earlier `obs_date`s, which is exactly what the store is designed for.
- Every published file validates inline against its schema; `ValidationError` fails the run by
  design. P3a publishes no new file, but `datacenter.schema.json` must still accept the longer
  monthly arrays.
- Weights and formulas get published, not hidden. Every card carries an as-of date.

---

## 11. Noted for P3c, not built here

Recon found **FRED M3 unfilled-orders series that are exact-or-near NAICS matches to 45% of Build
weight, at zero connector cost**: `A35CUO`/`U35CUO` (electrical equipment → `switchgear` 0.14 +
`transformers` 0.12), `A33HUO`/`U33HUO` (HVAC → `hvac_equip` 0.10), `ATGPUO`/`UTGPUO` (turbines and
generators → `generators` 0.09). With the two existing price proxies that is 53.5% of Build weight
with a non-trailing input.

They are **backlogs, not prices**, with no estimated transfer coefficient — and estimating one from
this sample is precisely the overfit the register warns about. Recorded here so P3c starts from the
measurement rather than repeating the search. `concrete`, `constr_wages`, `elec_contractors` and
`plumb_hvac_contractors` — 0.35 of Build weight — have no forward market anywhere and are
structurally unforecastable from prices.
