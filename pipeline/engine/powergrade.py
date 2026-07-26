"""Engine: the power-nowcast backtest gate (spec §6).

A like-month year-ratio nowcast for wholesale-to-retail power was backtested
against realized retail prints and lost to simple carry-forward at every
pass-through level tested, so the DC Ops index stays on official retail data
and the nowcast machinery ships config-gated. That verdict used to live only
as a hardcoded string in the DC page (`site/src/app/datacenter/page.tsx`) --
no as-of, no schema, nothing in CI to catch it drifting from a re-run. It
already had: a live re-run reads carry-forward 4.778 and best lambda=0.25
MAE 8.452, while the page still said "8.5 vs 5.2".

This module is the one computation. `scripts/backtest_power_yearratio.py`
calls it (via `grade_all`) for its printed table and exit code; a later task
calls `run()` to publish the same numbers under a schema with an as-of. Both
draw on the identical `grade_month`/`grade_all` machinery, so the CLI gate
and the published number cannot independently drift from each other the way
the hardcoded string did.

Moved verbatim from `scripts/backtest_power_yearratio.py` -- this refactor
must not change what the gate decides. See that script's module docstring
for the full backtest methodology (embargo, grading day, flip condition)."""
from datetime import date, timedelta

from pipeline.engine import blend
from pipeline.store import vintage

RETAIL = "eia_elec_ind_us"
HUBS = ("caiso_sp15_da", "miso_indiana_da")
LAMBDAS = (0.0, 0.25, 0.5, 0.75, 0.8, 1.0)   # 0.8 = cost-structure seed
    # (AEO2025 Table 8: generation 7.687 / industrial 9.064 ¢/kWh -> 0.848,
    # rounded down for the all-sector-average caveat; spec §6 grid ∪ seed)
SMOOTH_DAYS = 7
AVAIL_LAG_DAYS = 75   # retail print for month M appears ~75d after month start
GRADE_DAY = 15        # grade the tail value a reader saw mid-month
MAX_ERR_PTS = 3.0     # spec §6(b)


def month_shift(d: str, months: int) -> str:
    y, m = int(d[:4]), int(d[5:7]) + months
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}-01"


def grade_month(official: dict[str, float], w_smoothed: dict[str, float],
                target: str, lam: float) -> tuple[float, float] | None:
    """(nowcast_err, carry_forward_err) in YoY points for print month
    `target`, or None when coverage is missing. Both errors share the
    realized YoY's base month, so err = (estimate - realized)/base * 100."""
    t = target[:8] + f"{GRADE_DAY:02d}"
    cutoff = (date.fromisoformat(t) - timedelta(days=AVAIL_LAG_DAYS)).isoformat()
    off_asof = {d: v for d, v in official.items() if d <= cutoff}
    live_asof = {d: v for d, v in w_smoothed.items() if d <= t}
    base_m = month_shift(target, -12)
    if target not in official or base_m not in official or not off_asof:
        return None
    spliced = blend.splice_year_ratio(off_asof, live_asof, lam)
    t0 = max(off_asof)
    tail_dates = [d for d in spliced if t0 < d <= t]
    if not tail_dates:
        return None
    base, realized = official[base_m], official[target]
    err = (spliced[max(tail_dates)] - realized) / base * 100.0
    cf = (off_asof[t0] - realized) / base * 100.0
    return err, cf


def grade_all(official: dict[str, float], w_smoothed: dict[str, float],
             targets: list[str], lambdas: tuple[float, ...] = LAMBDAS):
    """Grade every target month at every lambda, then reduce to the
    intersection of months EVERY lambda could grade before scoring.

    A λ>0 model can go non-positive on an extreme wholesale ratio
    (splice_year_ratio's sign guard then skips that tail date entirely,
    per its docstring), while λ=0's model reduces to official[ob] — always
    positive whenever coverage exists. So per-λ gradeable month-sets can
    differ, and comparing MAE across DIFFERENT month subsets per candidate
    silently drops exactly the volatile months where a bad λ would post its
    worst errors — biasing the gate toward a false PASS. Scoring only the
    common intersection, and carry-forward's MAE over that SAME
    intersection, keeps the three-way comparison (candidate vs carry-fwd vs
    λ=0) apples-to-apples. No month is silently discarded: callers get back
    exactly which months were excluded (`dropped`) instead of a truncated
    row set with no explanation.

    Returns (per_lambda, common, dropped, mae, mx, cf_mae):
      per_lambda: {lam: {month: (err, cf)}} — grade_month's per-month
                  output, ungraded (None) months omitted.
      common:     sorted months present in per_lambda[lam] for EVERY lam.
      dropped:    sorted months graded by at least one lambda but not all —
                  the ones `mae`/`mx`/`cf_mae` below exclude.
      mae, mx:    {lam: float} — MAE / max|err| over `common` only.
      cf_mae:     float over `common` only, or None when `common` is empty
                  (carry-forward's error is lambda-invariant per month, so
                  any lambda's `common`-month cf values agree)."""
    per_lambda = {}
    for lam in lambdas:
        graded = {m: grade_month(official, w_smoothed, m, lam) for m in targets}
        per_lambda[lam] = {m: g for m, g in graded.items() if g is not None}

    graded_sets = [set(g) for g in per_lambda.values()]
    common = sorted(set.intersection(*graded_sets)) if graded_sets else []
    union = sorted(set.union(*graded_sets)) if graded_sets else []
    dropped = sorted(set(union) - set(common))

    mae, mx = {}, {}
    if common:
        for lam, graded in per_lambda.items():
            errs = [abs(graded[m][0]) for m in common]
            mae[lam], mx[lam] = sum(errs) / len(errs), max(errs)

    cf_mae = None
    if common:
        any_lam = lambdas[0]
        cfs = [abs(per_lambda[any_lam][m][1]) for m in common]
        cf_mae = sum(cfs) / len(cfs)

    return per_lambda, common, dropped, mae, mx, cf_mae


def _smoothed_hub_mean(hubs: dict[str, dict[str, float]]) -> dict[str, float]:
    """Equal-weight mean across the wholesale hubs, trailing-smoothed over
    SMOOTH_DAYS days -- the script's original `w` computation
    (`blend.hub_mean` + `blend.trailing_mean`, main()'s lines 124-126),
    lifted verbatim rather than re-derived. Takes a {hub_code: series} dict
    (`hub_mean` only cares about the collection of series, not their names,
    so this is the same computation whether the caller passes a dict of
    hub_code -> series, as `run()` does, or the equivalent list)."""
    return blend.trailing_mean(blend.hub_mean(list(hubs.values())), SMOOTH_DAYS)


def run(conn) -> dict:
    """The gate result as publishable numbers.

    Same computation the script has always run (via the shared `grade_all`),
    now importable by the publisher so the site can render the verdict under
    a schema with an as-of instead of a hardcoded literal that nothing in CI
    would catch drifting (spec 7). Degrades to nulls -- never raises -- on a
    store with no RETAIL/HUBS observations, because a later publish task
    must not fail the run over one missing input series."""
    official = dict(vintage.latest(conn, RETAIL))
    hubs = {h: dict(vintage.latest(conn, h)) for h in HUBS}
    smoothed = _smoothed_hub_mean(hubs)
    targets = [m for m in sorted(official) if month_shift(m, -12) in official]

    per_lambda, common, dropped, mae, mx, cf_mae = grade_all(
        official, smoothed, targets, LAMBDAS)

    positive = [lam for lam in LAMBDAS if lam > 0]
    scored = {lam: mae[lam] for lam in positive if lam in mae}
    best_lambda = min(scored, key=scored.get) if scored else None
    best_mae = scored.get(best_lambda)
    best_max_err = mx.get(best_lambda) if best_lambda is not None else None

    return {
        "as_of": max(official) if official else None,
        "months_graded": len(common),
        "carry_forward_mae": round(cf_mae, 3) if cf_mae is not None else None,
        "best_lambda": best_lambda,
        "best_mae": round(best_mae, 3) if best_mae is not None else None,
        "verdict": _verdict(cf_mae, best_mae, mae.get(0.0), best_max_err),
        "note": ("A like-month year-ratio nowcast, backtested against realized "
                 "retail prints before letting it touch the index. It lost to "
                 "simple carry-forward at every pass-through level tested, so "
                 "the ops index stays on official retail data and the "
                 "machinery ships config-gated."),
    }


def _verdict(cf: float | None, best: float | None,
            zero_lambda_mae: float | None,
            best_max_err: float | None) -> str:
    """PASS only under spec §6's actual flip condition: the selected λ>0
    candidate must beat BOTH naive baselines -- carry-forward AND λ=0 -- on
    MAE, with max|err| <= MAX_ERR_PTS. `main()` (scripts/backtest_power_
    yearratio.py) has enforced all three conditions since this gate shipped;
    a verdict built from only the carry-forward comparison would be a
    *different, looser* rule that could report PASS in a case the script's
    own exit code still calls FAIL, breaking the single-source-of-truth this
    refactor exists to establish. See test_verdict_fails_when_beats_both_
    baselines_but_exceeds_max_error for the case that motivates this."""
    if cf is None or best is None or zero_lambda_mae is None or best_max_err is None:
        return "INSUFFICIENT"
    ok = best < cf and best < zero_lambda_mae and best_max_err <= MAX_ERR_PTS
    return "PASS" if ok else "FAIL"
