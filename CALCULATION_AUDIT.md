# Site Calculation and Math Audit

**Audit date:** 2026-07-16  
**Published-data snapshot:** 2026-07-16T23:20:26Z  
**Scope:** All calculations displayed on the MacroGauge site, traced through Python engines and publishers, published JSON artifacts, and browser-side TypeScript calculations.  
**Assessment:** Needs revision

## Executive summary

Most arithmetic is internally consistent and well tested, but two material calculation problems affect the headline inflation measure and the current CPI nowcast:

1. The displayed 3.05% Macrogauge YoY rate is not the year-over-year change in the site's published Macrogauge price index. The price index itself rises 2.32% over the same 365-day window, a 0.73 percentage-point difference.
2. Measured components in the CPI nowcast use the first day of the prior month as their comparison point. For the current gasoline calculation, that turns a July monthly estimate into an approximately six-week change and materially depresses the forecast.

Additional findings concern the forecast backtest, component gap reconciliation, mixed-period real-wage comparison, personal-inflation edge cases, and two lower-risk date/annualization approximations.

No implementation changes were made as part of this audit.

## Methodology

The audit covered:

- Python calculation engines under `pipeline/engine/`
- JSON publishers under `pipeline/publish/`
- Runtime configuration in `config/`
- Published artifacts in `site/public/data/`
- Browser-side calculations in `site/src/lib/`, `site/src/components/`, and route components
- Independent reconciliation against the append-only observation store
- Existing automated tests and pipeline QA results

Checks included formula tracing, weight and denominator reconciliation, independent recomputation of published values, date alignment, missing-data behavior, rounding, unit handling, forecast/backtest comparability, and consistency between headline numbers and plotted series.

## Material findings

### 1. High: Headline YoY does not equal the YoY of the published gauge index

The site creates a daily headline price index as a weighted average of component index levels:

```text
headline_index(t) = sum(weight_i * component_index_i(t)) / sum(weight_i)
```

It then calculates the displayed headline YoY using a different construction:

```text
headline_yoy(t) = sum(weight_i * component_own_observation_yoy_i(t)) / sum(weight_i)
```

These operations are not mathematically equivalent. The second method was deliberately introduced to avoid stale-print sawtooth behavior by carrying each component's last like-month YoY forward. That rationale is understandable, but both results are presented as the same Macrogauge measure.

Current reconciliation:

| Variant | Displayed component-weighted YoY | Published index YoY | Difference |
|---|---:|---:|---:|
| Gauge | 3.05% | 2.32% | +0.73pp |
| Cost of Living | 2.93% | 2.01% | +0.92pp |
| Tracker | 3.73% | 2.98% | +0.75pp |
| Supercore | 3.10% | 3.22% | -0.12pp |
| PCE | 3.37% | 2.52% | +0.84pp |

Relevant implementation:

- `pipeline/engine/aggregate.py`: `headline()` and `weighted_yoy()`
- `pipeline/engine/gauge.py`: the independently published `index` and `yoy` series

#### Impact

- A user cannot reproduce the displayed headline by taking the year-over-year change in the plotted gauge index.
- The purchasing-power calculator uses the level index, while “inflation right now” uses the component-weighted definition.
- The outlook uses level-index YoY, producing 2.57% for the latest complete month, while nearby headline surfaces show 3.05%.
- Historical and annualized price-level calculations are not directly comparable with the headline YoY without understanding the definition split.

### 2. High: Measured CPI-nowcast components use the wrong monthly window

For a target month such as July, the nowcast sets the comparison start to the first day of June:

```text
start = first day of prior month
move = component_level(latest July observation) / component_level(June 1) - 1
```

This is neither an endpoint July-over-June comparison nor a partial-month average versus prior-month average. For daily series, it can include nearly two months of movement.

Current gasoline example:

| Observation | Component index |
|---|---:|
| June 1 | 168.52 |
| June 30 | 149.96 |
| July 16 | 151.38 |

Resulting alternatives:

| Method | Gasoline move |
|---|---:|
| Published: July 16 versus June 1 | -10.17% |
| July 16 versus June 30 | +0.94% |
| July partial-month average versus June average | -6.71% |

Gasoline has a 3% basket weight, so the published -10.17% move contributes approximately -0.305 percentage points to the -0.13% CPI nowcast.

Replacing only that calculation would move the total approximately to:

- +0.20% using the prior-month endpoint; or
- -0.03% using partial-month average versus prior-month average.

The appropriate convention is a modeling decision, but the current first-of-prior-month baseline is not consistent with either standard interpretation.

Relevant implementation:

- `pipeline/engine/nowcast/models.py`: `cpi_nowcast()` measured-component branch

Existing tests verify that data after the target month does not leak into the calculation, but they do not include daily observations throughout the prior month and therefore do not expose this window error.

### 3. Medium: The displayed backtest does not test the live bottom-up model

The live CPI forecast is a 14-component bottom-up calculation using measured component moves, capped historical trends, and selected futures-driver adjustments.

The published “Vintage-true MAE” instead backtests a three-month moving average of previously known official CPI changes:

```text
forecast = average(last three known official CPI monthly changes)
```

Current reported results:

- Three-month-average model MAE: 0.289pp
- Naive last-print MAE: 0.252pp
- Observations: 108

The backtested model underperforms the naive baseline, and its MAE is not validation evidence for the live component-level model shown alongside it.

Relevant implementation:

- `pipeline/engine/backtest.py`: `cpi_walk_forward()`
- `pipeline/engine/nowcast/models.py`: `cpi_nowcast()`

The arithmetic in the backtest is correct. The issue is model comparability and presentation.

### 4. Medium: Component gap decomposition does not reconcile to the headline gap

Current displayed figures:

- Gauge minus official CPI headline gap: -0.48pp
- Component table “Total gap vs official”: -0.62pp
- Unreconciled difference: 0.14pp

The component table compares the gauge with a weighted reconstruction of official component inflation. That reconstruction is currently 3.67%, versus 3.53% for official headline CPI. Therefore:

```text
3.05% gauge - 3.67% reconstructed BLS basket = -0.62pp
3.05% gauge - 3.53% official headline CPI     = -0.48pp
```

The component formula is implemented correctly:

```text
contribution_i = weight_i * (our_component_yoy_i - BLS_component_yoy_i)
```

However, “Total gap vs official” implies a reconciliation to the official headline that does not occur.

The table also mixes component-specific dates. Some live components run through July 16, used vehicles is dated July 1, and BLS-carried components generally reflect June. The footer gives one overall “ours as of July 16” date rather than row-level dates.

Relevant implementation:

- `pipeline/publish/gaptable.py`: `build()`
- `site/src/components/GapDecomposition.tsx`

### 5. Medium: Real-wage growth mixes June wages with July inflation

The current real-wage figure is mathematically correct for its inputs:

```text
(1 + 3.60%) / (1 + 3.05%) - 1 = 0.534%
```

The published result rounds to 0.53%. However:

- Wage growth is dated June 2026.
- Inflation is the July 16 Macrogauge reading.

The page discloses both dates, but the headline “Real wage growth” is not a same-period comparison. Aligning the periods—and resolving the gauge-definition split described above—would materially change the result.

Relevant implementation:

- `pipeline/publish/real_wages.py`: `build()`
- `site/src/app/real-wages/page.tsx`

### 6. Low: Zero-weight missing components can blank “My Inflation”

The personal-inflation calculation returns `null` if any component YoY is unavailable, even when that component has a zero personalized weight.

For example, a user who does not drive can assign zero weight to fuel and vehicles, but missing vehicle history can still blank the entire personal rate. A zero-weight component should not affect the weighted result.

The “biggest drivers” list is also sorted by signed contribution rather than absolute contribution. Large negative contributions can therefore be omitted from a list described as the biggest drivers.

Relevant implementation:

- `site/src/lib/reweight.ts`: `weightedYoY()` and `contributions()`

### 7. Low: Treemap “MoM annualized” is a 30-day approximation

The treemap calculates:

```text
(index_t / index_t_minus_30_days)^12 - 1
```

This compounds a 30-day change exactly 12 times, representing 360 rather than 365 days, and it uses daily-grid positions rather than calendar-month boundaries. It is a reasonable approximation but not an exact calendar-month annualization.

Relevant implementation:

- `site/src/components/Treemap.tsx`: `modeValue()`

### 8. Low: Daily YoY uses a fixed 365-day offset across leap years

Daily and component YoYs use `date - 365 days` rather than the same calendar date one year earlier. During periods spanning February 29, this can select a base one day away from the expected calendar anniversary.

Forward-filled monthly series largely mask the effect, but genuinely daily market series can use a one-day-shifted base.

Relevant implementation:

- `pipeline/engine/aggregate.py`: `yoy()` and `yoy_at_obs()`
- `pipeline/engine/official.py`: `latest_quote()`

## Calculations that reconciled correctly

The following areas were independently checked and found internally consistent:

- Official CPI and core CPI YoY calculations
- Official component MoM and YoY calculations
- All 28 published grocery-item MoM and YoY calculations
- Gauge basket weights, which sum to exactly 1.0
- The published 3.05% component-weighted gauge headline, which recomputes to 3.0488% before rounding
- CPI-nowcast component weights and contribution summation, subject to the window issue above
- Equal-weight forecast ensemble arithmetic and display rounding
- PCE bridge OLS arithmetic
- NFP units, payroll momentum calculation, and claims conversion to thousands
- Exact real-raise formula: `(1 + raise) / (1 + inflation) - 1`
- Purchasing-power and annualized-since-date calculator formulas
- Heat Check score and coverage calculation
- Consumer Stress weighted-percentile calculation
- Recession rule-share calculation
- Data-center Build, Ops, and Hardware component weights and contribution totals
- State power and wage parity multipliers
- Construction-spend YoY, 2014 comparison, and real-spend deflation
- Capacity-auction multiple and Kalshi probability formatting
- Outlook component path compounding, weighted level aggregation, base effects, and volatility-band arithmetic

The outlook correctly discloses that its shaded range is a realized-volatility band rather than a calibrated confidence interval.

## Verification results

- Python test suite: **498 passed**
- Frontend test suite: **29 passed**
- Repository status before documentation: clean
- Pipeline QA: **18 of 20 checks passed**

The two noncritical pipeline QA failures were:

- Connector timeouts for BLS and Treasury during the latest run
- Eight unavailable QCEW state-wage series

The missing QCEW rows reduce state build-parity coverage but do not affect the national index calculations. Published data artifacts otherwise share the same run timestamp.

## Priority order

1. Resolve or clearly distinguish the headline component-weighted YoY from the YoY of the published price index.
2. Define the CPI-nowcast monthly measurement convention and correct the measured-component window.
3. Backtest the live bottom-up nowcast or clearly label the existing MAE as belonging to a separate three-month-average benchmark.
4. Reconcile the component gap table to official CPI or relabel it as a gap versus the reconstructed BLS basket.
5. Align or more prominently qualify the mixed-period real-wage calculation.
6. Address the lower-risk personal-inflation, annualization, and leap-year edge cases.
