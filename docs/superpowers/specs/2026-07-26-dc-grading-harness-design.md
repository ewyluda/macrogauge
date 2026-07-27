# P3b — DC escalation grading harness, and P3c — unfilled-orders lead-lag study

> **Status:** design, approved 2026-07-26. Supersedes the P3b/P3c entries in
> `docs/plans/2026-07-24-project-controls-gaps.md` and the P3c framing in
> `docs/superpowers/specs/2026-07-25-dc-contingency-table-design.md` §2.1 item 4.
>
> **Register items:** P3b (grading harness) and P3c (forward engine), from
> `docs/plans/2026-07-24-project-controls-gaps.md`.
> **Grades:** contingency adequacy, defensibility, forecast accuracy.

## 1. What this is

P3a shipped a contingency table: five named bases, each an annualized index ratio over a stated
historical window, carried forward to the reader's delivery month. It makes **no claim about which
basis is right** — deliberately, because nothing in the repo could grade one.

**P3b builds the thing that grades them.** For every month at which we can reconstruct what the DC
Build index *actually read at the time*, it computes what each basis would have told a reader to
carry, carries it, and compares against what escalation actually did. The output is the metric this
audience is measured on — **did you carry enough** — not the metric a forecaster would reach for.

**P3c is scoped down to a measurement, not a model.** The register's forward engine is not built
here. What is built is the study that decides whether it ever can be: do manufacturers' unfilled
orders lead DC input prices, at what lag, and does that lead hold up out of sample?

Both publish. P3b's grades and P3c's verdict share one artifact and one page, because they answer one
question in two halves: *how well do our bases work, and can anything do better?*

---

## 2. What recon established, and what it corrected

Measured 2026-07-26 against live ALFRED and the repo. **The register and the P3a spec were both
wrong on the premise that blocked P3c. Do not re-derive.**

### 2.1 The blocking premise is refuted

Both documents state that a vintage-true DC backtest is impossible before roughly mid-2027
(register P3 §"SECOND CORRECTION" bullet 4; P3a spec §2.1 item 4). The reasoning was sound about the
*store* — the whole 2007–2026 DC history was backfilled in single sweeps, so `ppi_steel` has two
vintage dates and there is no point-in-time history to walk.

**The inference to "impossible" was wrong, because the store is not the only source of vintages.**
`pipeline/connectors/fred.py:18` `fetch_vintages()` already pulls the full ALFRED realtime history,
and `scripts/backfill_alfred.py` already established the pattern for loading it (it is why
`CPIAUCNS` appears in all 113 store partitions). Probed 2026-07-26 against all 12 Build components:

| component | w | FRED id | ALFRED rows | distinct vintages | first vintage | mean \|revision\| |
|---|---|---|---|---|---|---|
| `constr_wages` | 0.15 | `CES2000000003` | 1263 | 184 | 2011-03-04 | 0.132% |
| `switchgear` | 0.14 | `WPU1175` | 462 | 137 | 2015-03-13 | 0.236% |
| `transformers` | 0.12 | `WPU1174` | 369 | 138 | 2015-03-13 | 0.602% |
| `hvac_equip` | 0.10 | `PCU333415333415` | 487 | 135 | 2015-04-14 | 0.345% |
| `elec_contractors` | 0.09 | `PCU23821X23821X` | 469 | 135 | 2015-04-14 | 0.419% |
| `generators` | 0.09 | `PCU333611333611` | 396 | 135 | 2015-04-14 | 0.504% |
| `steel` | 0.065 | `WPU1017` | 490 | 138 | 2015-03-13 | 0.539% |
| `plumb_hvac_contractors` | 0.06 | `PCU23822X23822X` | 450 | 135 | 2015-04-14 | 0.288% |
| `copper_wire` | 0.055 | `WPU10260314` | 442 | 138 | 2015-03-13 | 1.679% |
| `concrete` | 0.05 | `PCU327320327320` | 469 | 135 | 2015-04-14 | 0.374% |
| `pumps` | 0.05 | `WPU1141` | 454 | 136 | 2015-03-13 | 0.227% |
| `alum_shapes` | 0.03 | `WPU102501` | 438 | 138 | 2015-03-13 | 0.514% |

**Build weight with real ALFRED vintage history: 1.000.** Zero new connectors. The binding
constraint on vintage-true reconstruction is ALFRED's PPI vintage start (2015-03/04), not mid-2027.

**Validation the reconstruction is correct:** rebuilding the index from raw ALFRED at today's vintage
and computing P3a's rolling bases reproduces **trailing-3yr +5.02%** and **current momentum +7.70%** —
bit-matching the raw-FRED figures stated in P3a spec §5.1. The reconstruction is not a new
methodology; it is the published one, run against a vintage filter.

### 2.1a ⚠ CORRECTION, 2026-07-26 (Task 3 implementation) — the rebase month is NOT immaterial

**§5.1's claim that the rebase base month "cancels exactly" is wrong, and every strict-leg figure
in §2.2 and §3 below is superseded by this block. Do not re-derive them.**

The claim holds for a single series. It fails for a **Laspeyres sum of separately-rebased
components**, which is what this index is:

```
H_b(t) = Σ w_i · I_i(t) / I_i(b)      →  effective weight of component i is  w_i / I_i(b)
```

Changing `b` reweights the basket, so the aggregate's *growth rates* change too. Measured against
the published monthly grid at today's vintage:

| rebase base | worst divergence vs published | months diverging >0.05 pts | strict anchors |
|---|---|---|---|
| 2008-01 (as originally specced) | **1.0029 index pts** | 199 of 222 | 132, from 2015-03 |
| **2018-01 (the published base)** | **0.1081 index pts** | **1** of 222 | **99, from 2018-01** |

`BASE_MONTH` is therefore **2018-01-01**, matching `config/dc_basket.json`'s `base_month` and
`rebase.py`'s stage-1 contract. Any other base grades a different index than the one on the site.

**The honest floor is the index's own base month, not ALFRED's vintage start.** A reader standing in
2016 could not have computed an index whose base is 2018-01 — it had no base yet. This is a
conceptual limit, not a data accident, and it is a cleaner claim than the original.

**Corrected sample depth.** The extended leg is essentially unchanged; only the strict leg shrinks:

| | strict | extended |
|---|---|---|
| anchors | **99**, 2018-01 → 2026-06 | 187, 2010-12 → 2026-06 |
| gradeable n, h=12/24/36/48 | 88 / 76 / 64 / 52 | 175 / 163 / 151 / 139 |
| independent draws | **7.33 / 3.17 / 1.78 / 1.08** | 14.58 / 6.79 / 4.19 / 2.90 |

**Corrected shortfall rates** (§3 and §3.1's tables are superseded by these):

| h | basis | strict | extended |
|---|---|---|---|
| 12 | Long-run | 61.4% | 46.3% |
| 12 | Trailing 3yr | **39.8%** | **40.6%** |
| 12 | Current momentum | 48.9% | 53.7% |
| 24 | Long-run | 75.0% | 53.4% |
| 24 | Trailing 3yr | **44.7%** | **42.9%** |
| 24 | Current momentum | 50.0% | 53.4% |
| 36 | Long-run | 96.9% | 64.2% |
| 36 | Trailing 3yr | 65.6% | 56.3% |
| 36 | Current momentum | **60.9%** | **55.0%** |
| 48 | Long-run | 100.0% | 64.7% |
| 48 | Trailing 3yr | 80.8% | 66.9% |
| 48 | Current momentum | **71.2%** | **71.2%** |

**The headline finding survives and sharpens**: Long-run still under-provisions 96.9% of 36-month and
100% of 48-month windows on the vintage-true sample while winning symmetric error, and the
strict-vs-extended spread (§3.1) is wider than before, not narrower.

**Ruling, 2026-07-26 (human): the strict leg publishes only h=12 and h=24.** At h=36 and h=48 it
carries 1.78 and 1.08 independent draws — roughly one — and a "100.0%" resting on one draw is exactly
the claim this spec's own standard rejects elsewhere. Those two horizons are carried by the extended
leg alone, and the strict column renders an explicit "vintage-true sample too thin at this horizon"
note rather than a figure. This is a stated exception to §9 criterion 3's paired-leg rule, and the
only one.

### 2.2 The replacement constraint is sample depth, not vintage availability

> **Superseded by §2.1a for every strict-leg figure.** The table below reflects the original
> 2008-01 rebase and is retained only as the record of what was measured before the correction.

Reconstructing the index at each ALFRED vintage yields **132 distinct vintage-true anchors,
2015-03 → 2026-06** (one per distinct last-observation month). Graded against realized escalation:

| horizon | gradeable anchors | independent draws `n/h` |
|---|---|---|
| 12mo | 121 | **10.08** |
| 24mo | 109 | **4.54** |
| 36mo | 97 | **2.69** |
| 48mo | 85 | **1.77** |

**This is the honest blocker on P3c, and it replaces the refuted one.** A forward model is gradeable
at 12 months on ~10 independent draws. It is **not** gradeable at 36–48 months — the horizons a
2029–2030 energization actually budgets against — and will not be for years: anchors accrue at ~1
per month, so h=36 reaches 3.6 independent draws around 2029.

Waiting does not solve this the way the old premise implied it would. **Record the new reason; do not
restate the old one.**

### 2.3 Revisions are real but small at index level

Reconstructing at nine historical anchors and comparing against final-revision values for the same
observation months:

| anchor | index level vs final | trailing-12m rate vs final |
|---|---|---|
| 2018-06 | −0.118% | −0.144pp |
| 2019-06 | +0.040% | +0.021pp |
| 2020-06 | +0.273% | +0.273pp |
| 2021-06 | −0.083% | −0.114pp |
| 2022-06 | +0.125% | +0.149pp |
| 2023-06 | +0.087% | +0.094pp |
| 2024-06 | −0.226% | −0.225pp |
| 2025-06 | **−0.275%** | **−0.274pp** |

**Maximum distortion from using final-revision data in place of vintage-true: ±0.27pp on the
annualized rate.** Against carried rates of 2.5–8.6%/yr this is small — which is what makes §5.2's
extended leg defensible rather than a shortcut.

> **Amended 2026-07-26 (PR #8 review).** The ±0.27pp above was measured on the nine pre-backfill
> anchors in this table and did not survive the full ALFRED backfill: across all 99 overlapping
> anchor months the maximum strict-vs-extended divergence in a carried rate is **0.672pp**
> (current_momentum at 2022-04 — the 2021–22 spike amplifies index-level revisions into larger
> rate-level moves than any June anchor showed). A hardcoded bound the artifact's own anchor rows
> contradict is the same claim-outlives-the-number failure §7 exists to prevent, so
> `revision_disclosure_pp` is now **derived from the artifact's own overlapping anchors on every
> publish** (`dcgrade._revision_disclosure_pp`), and every sentence quoting it (`paired_legs_note`,
> the extended leg's provenance, the methodology paragraph) builds from that derived value. Nothing
> hardcodes the figure anymore. The §5.2 conclusion is unchanged in kind — the distortion remains
> an order of magnitude smaller than the strict-vs-extended spreads the legs exist to show — but
> the published number is now the measured one.
>
> One further disclosure from the same review: the ALFRED backfill resurrected one print the
> agency later retracted (ppi_copper_wire 2020-07, 292.9, vintage 2020-08-11 — the daily snapshot
> skips that month), and because latest-vintage-wins has nothing later for that cell, the
> published Build index at 2020-07 moved 106.4733 → 106.5814 (+0.1081) when the artifact was
> regenerated. See scripts/backfill_dc_vintages.py's docstring for the mechanism and why the
> value stands.

### 2.4 P3c's candidate inputs exist

All six FRED M3 unfilled-orders series named in P3a spec §11 were probed and resolve, monthly,
**1992-01 → 2026-05** — a 34-year sample, materially deeper than the Build index itself:

`A35CUO`/`U35CUO` (electrical equipment), `A33HUO`/`U33HUO` (ventilation/heating/AC),
`ATGPUO`/`UTGPUO` (turbines and generators). SA and NSA variants both available.

---

## 3. The measurement that defines the feature

Grading the three rolling bases over the strict vintage-true sample:

| h | basis | MAE pp | bias pp | **shortfall rate** | mean shortfall | worst |
|---|---|---|---|---|---|---|
| 12 | Long-run | **3.34** | −2.76 | 66.9% | 4.56 | 17.38 |
| 12 | Trailing 3yr | 4.42 | −0.99 | **52.9%** | 5.11 | 16.43 |
| 12 | Current momentum | 4.36 | −0.71 | 59.5% | 4.26 | 17.56 |
| 24 | Long-run | **3.14** | −2.96 | 79.8% | 3.82 | 12.50 |
| 24 | Trailing 3yr | 4.26 | −1.15 | **61.5%** | 4.40 | 11.83 |
| 24 | Current momentum | 4.97 | −0.66 | 64.2% | 4.38 | 13.54 |
| 36 | Long-run | **3.30** | −3.29 | **99.0%** | 3.33 | 8.65 |
| 36 | Trailing 3yr | 4.04 | −1.99 | 77.3% | 3.90 | 7.87 |
| 36 | Current momentum | 5.00 | −0.68 | **70.1%** | 4.05 | 10.12 |
| 48 | Long-run | 3.75 | −3.75 | **100.0%** | 3.75 | 6.71 |
| 48 | Trailing 3yr | **3.81** | −3.16 | 88.2% | 3.95 | 5.95 |
| 48 | Current momentum | 5.08 | −1.46 | **82.4%** | 3.97 | 8.18 |

Bias is negative for every basis at every horizon: **on this sample every basis under-provisioned on
average.**

**The finding that sets the headline metric: the basis with the best MAE is the worst contingency.**
Long-run wins symmetric error at 12/24/36 months and under-provisions 99% of 36-month windows and
100% of 48-month windows. MAE does not care about sign; a contingency budget cares about almost
nothing else. **Shortfall rate is the headline; MAE ships as a secondary column precisely so the
inversion is visible on the page.**

### 3.1 The finding attenuates on the deeper sample — say so, do not overstate it

The strict leg's anchors begin 2015-03 and therefore contain the 2021–22 spike and **no downturn** —
the same sample defect P3a's backfill existed to fix for the percentile band. Re-graded on the
extended leg (final-revision, 187 anchors, 2010-12 → 2026-06):

| h | basis | MAE pp | bias pp | shortfall rate | strict-leg shortfall |
|---|---|---|---|---|---|
| 12 | Long-run | 3.06 | −1.28 | 48.6% | 66.9% |
| 12 | Trailing 3yr | 3.56 | −0.32 | **42.3%** | 52.9% |
| 12 | Current momentum | 3.68 | −0.20 | 53.1% | 59.5% |
| 24 | Long-run | 2.90 | −1.34 | 55.2% | 79.8% |
| 24 | Trailing 3yr | 3.34 | −0.42 | **42.9%** | 61.5% |
| 24 | Current momentum | 4.00 | −0.16 | 54.6% | 64.2% |
| 36 | Long-run | 2.92 | −1.51 | 65.6% | **99.0%** |
| 36 | Trailing 3yr | 3.08 | −0.99 | **56.3%** | 77.3% |
| 36 | Current momentum | 3.74 | −0.22 | **56.3%** | 70.1% |
| 48 | Long-run | 3.04 | −1.72 | 64.7% | **100.0%** |
| 48 | Trailing 3yr | 2.91 | −1.70 | 66.2% | 88.2% |
| 48 | Current momentum | 3.66 | −0.73 | 70.5% | 82.4% |

Extended-leg gradeable counts: **175 / 163 / 151 / 139** anchors at h=12/24/36/48, giving
**14.58 / 6.79 / 4.19 / 2.90** independent draws.

**The 99% and 100% figures are substantially sample composition.** They fall to 65.6% and 64.7% once
the post-GFC disinflation is in the anchor set, and the MAE-vs-shortfall inversion, while still
present at h=36, is much weaker. Publishing the strict leg alone would have shipped a frightening
number that the deeper sample does not support.

> **Amended 2026-07-26 (PR #8 review).** The table above and this paragraph predate the §2.1a
> base-month correction. On the corrected sample the committed artifact reads: strict long_run
> h=36/h=48 at **96.9% / 100%** (measured, unpublished — the strict leg withholds those horizons as
> too thin), falling to **64.2% / 64.7%** on the extended leg. The composition argument is
> unchanged; `dc_grades.json` is authoritative for every current figure.

**This is the single most important honesty constraint in the build.** Copy must present the two legs
as a range whose spread is itself the finding — *how much the answer depends on whether your sample
contains a downturn* — and must never quote a strict-leg shortfall rate without its extended-leg
counterpart adjacent.

---

## 4. Architecture

Data flows the repo's one direction: collect → store → engine → publish → validate. Nothing here
deviates.

### 4.1 Pipeline

**`scripts/backfill_dc_vintages.py`** (new, one-off, run locally with `FRED_API_KEY`).
Loads the registry, resolves the 12 Build components to their `source_id`s, calls
`fred.fetch_vintages()` per series, **remaps `source_id` → registry `code` before appending**
(`id_map = {s.source_id: s.code}` then `replace(o, series_code=...)`, exactly as
`scripts/backfill_dc_history.py:102-103` does — skipping this silently creates a parallel series
under the FRED id), and writes via `vintage.append_vintages()`, which is identity-deduped so
re-running is a no-op.

**It must carry the per-series coverage guard.** `fetch_vintages` is single-series so it cannot
partially fail the way `fred.fetch` does, but the 12-series loop reintroduces the same trap that
silently truncated the Build index before PR #6: validate that every one of the 12 came back with
vintage history spanning the expected range **before** appending anything. The store is append-only;
a half-loaded vintage set cannot be undone.

Footprint: ~5,400 rows (~0.5 MB against a 20 MB store), ~23 new partitions before 2017-02 plus
appends into existing ones. Appending rows to committed partitions is established practice here —
`CPIAUCNS` already appears in all 113 — and is not a rewrite.

**`pipeline/engine/dcgrade.py`** (new). Pure functions of dicts, no I/O, testable directly like every
other engine stage:

- `index_asof(components, vintage_date) -> dict[str, float]` — Laspeyres Build index using only
  observations known by `vintage_date`.
- `bases_at(index, anchor_month) -> dict[str, float]` — the three rolling bases (and, for the
  scenario section, the two absolute windows).
- `grade(anchors, realized, horizons) -> dict` — shortfall rate, mean/worst conditional shortfall,
  bias, MAE, anchor count, independent draws.

**`pipeline/publish/dc_grades.py`** (new) → `site/public/data/dc_grades.json`, with
`schemas/dc_grades.schema.json` validated inline as it lands.

**`pipeline/run_daily.py`** — one new isolated `try/except` phase with a `grades_ok` flag, following
the existing ten. A failure here must not suppress any other phase, and `jsonschema.ValidationError`
must still re-raise ahead of the generic `Exception`.

**`config/series.json`** — three new FRED series for P3c: `U35CUO`, `U33HUO`, `UTGPUO`. **NSA, not
SA**: the Build components are NSA, the study compares YoY to YoY (which cancels seasonality by
construction), and mixing adjustment conventions across a correlation is the kind of silent error
this repo publishes weights to avoid. Existing FRED connector, no new integration.

### 4.2 Site

- **New route `/dc-scoreboard`** in the AI Infra nav group, carrying the full harness: both legs, the
  rules/scenarios split, anchor counts and independent draws, the vintage-true methodology, and
  P3c's lead-lag verdict.
  *Naming is not load-bearing and can change — `/scoreboard` is already CPI's, and P7 argues this
  audience's vocabulary is "contingency" and "basis of estimate" rather than "scoreboard."*
- **`site/src/lib/dcGrades.ts`** + `dcGrades.test.ts` — client-side derivation and formatting, matching
  the `dcContingency.ts` / `dcEscalation.ts` pattern.
- **Inline verdict in `DcEscalationClient.tsx`** at the basis picker: the selected basis's shortfall
  rate at the reader's own horizon, both legs, linking through. Compact — that component is already
  450 lines and this must not turn it into the grading page.

---

## 5. The math — prescriptive

### 5.1 Anchors and as-of reconstruction

For a vintage date `T`, each component takes its **latest ALFRED vintage ≤ T**, the set of
observation months present across all 12 is intersected, and the index is the Laspeyres weighted sum
over the 12 published weights, each component rebased to a base month inside the always-available
history.

~~**The rebase month is immaterial and must be stated as such.** Every basis and every realized value
is a ratio, so the rebase constant cancels exactly. It is *not* 2018-01 for this computation:
requiring a 2018-01 base would falsely floor the earliest anchor at 2018-06, discarding 3 years of
usable vintages.~~

**⚠ REFUTED, 2026-07-26 — see §2.1a.** The cancellation argument holds for a single series and fails
for a Laspeyres sum of separately-rebased components: `H_b(t) = Σ w_i·I_i(t)/I_i(b)` makes the
effective weight `w_i/I_i(b)`, so the base month reweights the basket and changes its growth rates.
Measured, a 2008-01 base diverges from the published index by up to **1.0029 index points across 199
of 222 months**; the published 2018-01 base diverges by 0.1081 at one month. **`BASE_MONTH` is
`2018-01-01`.** The earliest anchor is 2018-01 and the strict leg has 99 anchors, not 132 — and that
floor is principled, since an index based at 2018-01 cannot be reconstructed at a vintage that
predates its own base.

An **anchor** is one distinct last-observation-month across all vintages. 99 in the strict leg
(the §2.1a correction above; this sentence originally said 132). Multiple ALFRED vintages mapping
to the same last-observation month collapse to one anchor — grading the same month twice would
inflate the sample without adding information.

### 5.2 The two legs

| leg | provenance | anchors | span | contains a downturn |
|---|---|---|---|---|
| **Strict** | vintage-true (ALFRED as-of) | 132 | 2015-03 → 2026-06 | **no** |
| **Extended** | final-revision throughout | 187 | 2010-12 → 2026-06 | yes (post-GFC) |

Both publish, labelled distinctly, following the `BT`/`LIVE` badge precedent in `backtest.json`. The
extended leg's justification is §2.3's measured revision distortion, which must be published
alongside it — it is the reason the leg is defensible, and without it the leg is just a looser
standard.

> **Amended 2026-07-26 (PR #8 review).** The table above predates §2.1a: strict = **99** anchors,
> **2018-01 → 2026-06**. And per §2.3's amendment the distortion bound is no longer the
> hand-measured ±0.27pp this section originally cited — it is derived from the artifact's own
> overlapping anchors on every publish (0.672pp on the 2026-07-26 artifact).

The extended leg starts **2010-12**, not 2007-12: the trailing-3yr basis needs 36 months of history
before the first anchor can carry all three rolling bases.

### 5.3 Rules vs scenarios — a required separation

**Rules (backtested).** Long-run, Trailing 3yr, Current momentum. Each is computable at any anchor
from information available at that anchor. These get the grading table.

**Scenarios (not backtested, and not graded at all).** GFC downturn (2008-12 → 2011-12) and COVID
peak (2021-04 → 2023-12) are hand-picked windows selected in 2026 with full hindsight. Grading
"carry the COVID rate" at a 2018 anchor is lookahead twice over — the window had not closed, and
nobody could have chosen it as a regime then. Restricting to anchors where the window *had* closed
leaves the COVID scenario **18 gradeable anchors at h=12, ~1.5 independent draws**.

**Ruling: no shortfall rate, MAE, bias or any other grading statistic is computed or published for
the two scenarios.** A grade on 1.5 independent draws is not a measurement, and publishing one
invites exactly the over-reading the number cannot support. The scenarios appear in their own
section as **reference rates with their windows stated** — what the rate is, which episode it is
drawn from, and an explicit statement that it is hindsight-selected and therefore ungradeable.

This is a stricter line than "grade them with a warning flag," and deliberately so: a footnote on a
shared table is not protection, because readers compare adjacent numbers and skip footnotes. If the
two scenarios carry no statistics, there is nothing to misread.

### 5.4 Metrics

For basis `b`, anchor month `m`, horizon `h`:

```
carried    = b's annualized rate at m
realized   = (I_final[m+h] / I_final[m]) ** (12/h) − 1
error      = carried − realized          # +ve = carried more than needed
shortfall  = −error where error < −ε     # under-provisioned; ε = 1e-9 pp
```

**Amendment, 2026-07-26 (Task 4 implementation): the comparison carries an epsilon, and it must.**
The idealized `error < 0` cannot survive float64 `pow()` over windows of differing length. Measured on
a constant-rate fixture where carried and realized are equal by construction, **13 of 116 anchors came
back negative by chance**, with a maximum magnitude of `4.44e-14` pp. That is noise being counted as
under-provisioning.

`ε = 1e-9` pp sits roughly five orders of magnitude above the measured noise floor and seven below the
two-decimal precision every published statistic rounds to, so it cannot mask a shortfall any reader
could see: a genuine 0.0001pp shortfall still clears it and is still counted. The constant lives at
`dcgrade._SHORTFALL_EPS_PP` with the same reasoning recorded beside it.

Published per (leg × basis × horizon): `shortfall_rate` (share of anchors with `error < 0`),
`mean_shortfall` and `worst_shortfall` (conditional on shortfall — a mean over all anchors would
dilute the number that matters with the windows that were fine), `bias`, `mae`, `n`, and
`independent_draws = n/h`.

`realized` uses the final-revision index in **both** legs. Only the *carried* side needs to be
vintage-true — that is what the reader knew when deciding. What actually happened is what actually
happened.

Horizons: 12, 24, 36, 48 — matching `/escalation`'s existing 48-month cap so every horizon a reader
can select is gradeable.

### 5.5 Payload

```
anchors: [{ m, leg, bases: {long_run, trailing_3yr, current_momentum},
            realized: {h12, h24, h36, h48} }]
```

~15 KB. Every published summary statistic is derivable from this array, which satisfies "reproduce
any number by hand" without shipping a 2,640-row basis × horizon cross product. Summary tables are
also published so the page renders without computing.

---

## 6. P3c — the lead-lag study

**Mappings** (0.45 of Build weight, per P3a spec §11):

| series | Build components | combined weight |
|---|---|---|
| `U35CUO` | `switchgear` (0.14) + `transformers` (0.12) | 0.26 |
| `U33HUO` | `hvac_equip` (0.10) | 0.10 |
| `UTGPUO` | `generators` (0.09) | 0.09 |

**Method.** Cross-correlate unfilled-orders YoY against the mapped component's YoY at lags 0–24
months, over the full common sample (1992–2026 where the component PPI reaches back that far).
Report per mapping: best lag, peak correlation, and the correlation profile across lags.

**Stability gate, stated before the numbers exist.** Split the sample in half and re-run. The study
supports proceeding to a model only if the best lag is **consistent in sign and within ±3 months
across both halves**, and the peak correlation holds the same sign. Otherwise the finding is that
backlogs do not usefully lead these prices, and **that publishes as a negative result** — the
power-nowcast precedent, which is the most credible asset the site has.

**No transfer coefficient is estimated.** Turning a correlation into a price forecast requires an
elasticity, and fitting one on this sample is exactly the overfit the register warns about. The study
publishes lead structure and nothing downstream of it.

`concrete`, `constr_wages`, `elec_contractors` and `plumb_hvac_contractors` — 0.35 of Build weight —
have no forward market of any kind and are out of scope for any lead-lag treatment.

### 6.1 RESULT, measured 2026-07-26 — and why "1 of 4 stable" must never be published bare

The study ran twice. Both runs are recorded because the difference between them *is* the finding.

| sample | months | span | mappings clearing the gate | `weight_stable` |
|---|---|---|---|---|
| targets at store depth | 222 | 2008-01 → 2026-06 | **0 of 4** | 0.00 |
| targets backfilled to 1992 | **402** | 1993-01 → 2026-06 | **1 of 4** (`U35CUO` → `transformers`) | 0.12 |

**Two caveats must travel with that "1 of 4" everywhere it appears — page, artifact, and summary.**

**(a) The recovered lag is 0–2 months. That is contemporaneous, not a lead.** First-half best lag 2
months, second-half 0 months, both positive at ~0.7. This study exists to decide whether a forward
model is buildable at **12–48 month** horizons. A same-month correlation does not support that at any
gate strictness, and it is equally consistent with both series responding simultaneously to a shared
shock (commodity input costs, a supply-chain disruption) as with backlog→price transmission.

**(b) The flip is a split-half midpoint artifact, not a relationship that became stable.** On the
222-month sample the midpoint fell around 2017-03 and the pairing failed *because* its two halves
genuinely disagreed — 2008–2017 peaked at lag 24 (r=0.327), 2017–2026 at lag 0 (r=0.784). Deepening
the sample moved the midpoint to roughly 2009-09, which folds that entire conflicting window into a
single half where the disagreement is no longer exercised; the reported second-half r=0.658 sits
almost exactly between the two previously-conflicting sub-period values, consistent with pooling
them. The "first half" it is now compared against is a different, previously-untested 1993–2009 era.
**The specific instability that failed the gate was not resolved. It was moved out of view.**

**The gate was deliberately NOT changed after seeing this.** A sub-period robustness check would
catch the artifact, and adding one now — after the pre-registered test produced a positive — would be
tuning the instrument to the answer, which is the exact failure mode stating the gate up front was
meant to prevent. The pre-registered gate's literal outcome publishes as-is, with these caveats
beside it. `first_half` and `second_half` lags and correlations publish per mapping so a reader can
see the disagreement directly rather than take our word for it.

**Standing conclusion for P3c: no forward model is warranted on this evidence.** One near-contemporaneous
correlation covering 0.12 of Build weight, whose stability is sensitive to where the sample is cut,
is not a forecasting input.

---

## 7. The stale power-nowcast MAE string

`site/src/app/datacenter/page.tsx:217` hardcodes *"best MAE 8.5 vs 5.2 YoY pts."* A live re-run reads
carry-forward 4.778 / best λ=0.25 MAE 8.452 — verdict unchanged, number one print stale. It carries
no as-of, appears in none of the published JSONs, is not schema-validated, and nothing in CI would
catch it drifting again.

**The fix is to publish it, not to retype it.** The power-nowcast grade lands in `dc_grades.json`
with an as-of, under the schema, and `page.tsx` renders from the artifact. Correcting the literal
would only reset the staleness clock.

---

## 8. Deliberately out of scope

- **Any forward model.** P3c here is a measurement. §2.2's draw counts mean a model cannot be graded
  at the horizons that matter, and the register's "do not ship an unbacktested forward model" stands.
- **A transfer coefficient or fitted elasticity** — §6.
- **Extending the strict leg before 2015-03.** ALFRED's PPI vintages start there; nothing can be done
  about it.
- **Grading Ops or Hardware.** Build only, matching P1/P3a's scope decision.
- **Location adjustment.** Unchanged from P1 and P3a: parity multipliers are level multipliers, not
  escalation rates.
- **Re-deriving the P3a contingency table's own values.** This harness grades those bases; it does
  not recompute or restate them.

---

## 9. Risks

1. **The strict leg's shortfall numbers get quoted without the extended leg.** The 99%/100% figures
   are memorable and misleading alone (§3.1). This is the highest-likelihood failure of the feature
   and it is a copy problem, not a code problem. Mitigation: the two legs render adjacent by
   construction, never in separate views, and no single-leg shortfall rate appears in any summary
   line or inline verdict.
2. **The `source_id` → registry `code` remap is skipped in the backfill.** Silent: it creates a
   parallel series under the FRED id, and the engine reads the registry code, so the harness would
   see no new vintages and quietly grade nothing. Mitigation: assert post-append that
   `vintage.as_of()` at an early date returns rows for all 12 **registry** codes.
3. **Anchors double-counted.** Multiple ALFRED vintages can share one last-observation month;
   grading each would inflate `n` and the independent-draw estimate without adding information
   (§5.1). Mitigation: dedupe by last-observation month, pinned by test.
4. **Independent draws at h=48 read 1.77 (strict) and 2.90 (extended).** Both are below the ~3.6
   threshold P3a used to justify its own cap. The page must render these live and say plainly that
   the 48-month row is the weakest, rather than presenting four horizons as equally supported.
   No fixed-threshold claim is hardcoded — P3a's §5.3 correction shows those go stale as the sample
   grows.
5. **The lead-lag study finds a spurious lead.** 34 years of monthly data will produce *some* peak at
   *some* lag for any pair. The split-half gate in §6 exists for this and must be stated in the spec
   before the numbers are computed — which it now is.
6. **Payload growth on a page every DC visitor loads.** `dc_grades.json` is a new file, not an
   addition to `datacenter.json`, so `/datacenter` and `/escalation` load costs are unchanged except
   for the inline verdict's small read.

---

## 10. Acceptance criteria

1. A reader can reproduce, by hand, any published summary statistic from the `anchors` array in
   `dc_grades.json`.
2. Both legs publish, adjacent, with their anchor counts, spans, independent draws, and the ±0.27pp
   revision disclosure that justifies the extended leg.
3. No shortfall rate appears anywhere on the site — summary, inline verdict, or table — without its
   counterpart leg beside it.
4. The three rolling bases and the two hindsight-selected scenarios appear in separate sections; the
   scenario section states that its windows were chosen with hindsight, and **publishes no grading
   statistic of any kind** for them (§5.3). A test asserts `dc_grades.json` carries no shortfall,
   MAE or bias field under the scenario block.
5. The reconstruction reproduces P3a spec §5.1's raw-FRED bases (trailing-3yr +5.02%, current
   momentum +7.70%) at today's vintage — pinned by test, since this is what proves the harness grades
   the published index rather than a parallel one.
6. Anchors are deduped by last-observation month; a test proves multiple vintages of one month yield
   one anchor.
7. The backfill validates all 12 series' coverage before appending, and refuses to append if any is
   short.
8. `datacenter/page.tsx` renders the power-nowcast grade from `dc_grades.json`, with an as-of, under
   the schema. No hardcoded MAE literal remains.
9. A `grades_ok: false` run still publishes every other artifact; the schema accepts the degraded
   shape (nulls / empty arrays).
10. `pytest -q`, `npm test`, `npm run build`, `npm run e2e` all green, with `/dc-scoreboard` added to
    the e2e route list and zero console errors.

---

## 11. Invariants carried from `CLAUDE.md`

- **HTTP injected, never real, in tests.** ALFRED responses become fixtures under `tests/fixtures/`;
  `tests/test_run_daily.py`'s `fake_get` extended to the three new unfilled-orders series.
- **Store rows append-only and schema-versionless.** The vintage backfill adds rows for earlier
  `vintage_date`s — exactly what the store is designed for. Never rewrite a committed partition.
- **Every published file validates inline against its schema**; `ValidationError` re-raises ahead of
  the generic `Exception` and fails the run. `dc_grades.schema.json` must legally accept degraded
  output.
- **New pipeline phase runs in its own isolated `try/except` with a `grades_ok` flag.** A failure must
  not suppress any other phase.
- **Weights and formulas get published, not hidden.** Every card carries an as-of date.

---

## 12. Register corrections this spec makes

To be applied to `docs/plans/2026-07-24-project-controls-gaps.md` when this lands:

- **P3 §"SECOND CORRECTION" bullet 4 is refuted.** A vintage-true DC backtest is possible today via
  ALFRED, back to 2015-03, covering 100% of Build weight. Replace with §2.2's constraint: gradeable
  at h=12 (10.1 independent draws), not gradeable at h=36–48 (2.69 / 1.77).
- **P3a spec §2.1 item 4 carries the same refuted claim** and should be annotated rather than edited,
  matching how that document handles its own post-ship corrections.
- **P3b's scope grew.** The register describes it as a back-test plus a string fix; it is a published
  accountability surface with its own artifact, schema, phase, and page.
- **P3c's scope shrank.** From a forward engine to the lead-lag measurement that decides whether one
  is ever attempted.
