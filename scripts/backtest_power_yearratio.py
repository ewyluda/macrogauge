"""Offline backtest gate for the wave-4b year-ratio power nowcast (spec §6).

    .venv/bin/python scripts/backtest_power_yearratio.py --store store

Replays deployment honestly for each gradeable retail print month M: the
nowcast at mid-month M uses only wholesale obs <= that date, anchored on the
newest retail print available then (AVAIL_LAG_DAYS embargo, replicating the
~75-day publication lag). Errors are in YoY points against the realized
print. Flip condition (spec §6): the selected λ>0 must beat BOTH naive
baselines (carry-forward AND λ=0) on MAE with max |err| <= 3.0 YoY pts.
Results land in the spec's §10; this script publishes nothing."""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.engine import blend                          # noqa: E402
from pipeline.store import vintage                         # noqa: E402

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


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--first-target", default="2025-07-01")
    args = parser.parse_args(argv)

    conn = vintage.load(args.store)
    official = dict(vintage.latest(conn, RETAIL))
    w = blend.trailing_mean(
        blend.hub_mean([dict(vintage.latest(conn, h)) for h in HUBS]),
        SMOOTH_DAYS)
    targets = [d for d in sorted(official) if d >= args.first_target]

    per_lambda, common, dropped, mae, mx, cf_mae = grade_all(
        official, w, targets, LAMBDAS)

    for lam in LAMBDAS:
        graded_n = len(per_lambda[lam])
        print(f"lambda={lam}: graded {graded_n}/{len(targets)} candidate "
              f"months ({len(targets) - graded_n} skipped)", file=sys.stderr)
    print("months dropped from the common intersection (ungradeable by at "
          f"least one lambda, excluded from ALL comparisons): "
          f"{dropped if dropped else 'none'}", file=sys.stderr)

    if not common:
        print("no months gradeable by every lambda — check backfill "
              "coverage (empty common intersection)", file=sys.stderr)
        return 1

    positive = [lam for lam in LAMBDAS if lam > 0]
    if not positive or not all(lam in mae for lam in positive):
        # Structurally unreachable once `common` is non-empty (every lambda
        # in LAMBDAS is scored over `common` by construction) — guarded
        # anyway so this fails closed with a clear message rather than a
        # bare min() ValueError, per review.
        print("no lambda>0 gradeable over the common intersection — cannot "
              "evaluate a flip candidate", file=sys.stderr)
        return 1

    print("| month | realized_yoy_base | " +
          " | ".join(f"err λ={lam}" for lam in LAMBDAS) + " | err carry-fwd |")
    print("|---|---|" + "---|" * (len(LAMBDAS) + 1))
    for m in common:
        cells = " | ".join(f"{per_lambda[lam][m][0]:+.2f}" for lam in LAMBDAS)
        cf_val = per_lambda[LAMBDAS[0]][m][1]
        print(f"| {m} | {official[m]:.2f} | {cells} | {cf_val:+.2f} |")
    print(f"\ncarry-forward MAE: {cf_mae:.3f} pts over {len(common)} months "
          f"(common intersection across all lambdas)")
    for lam in LAMBDAS:
        print(f"lambda={lam}: MAE {mae[lam]:.3f}, max|err| {mx[lam]:.3f}, "
              f"n={len(common)}")

    best = min(positive, key=lambda x: mae[x])
    ok = mae[best] < cf_mae and mae[best] < mae.get(0.0, float("inf")) \
        and mx[best] <= MAX_ERR_PTS
    print(f"\nselected lambda={best} -> "
          f"{'PASS: flip approved' if ok else 'FAIL: do not flip'} "
          f"(spec §6: beat carry-fwd {cf_mae:.3f} and λ=0 "
          f"{mae.get(0.0, float('nan')):.3f}; max|err| <= {MAX_ERR_PTS})")
    # exit code mirrors the verdict so future automation can't read a
    # FAIL as success; 1 is reserved for no-gradeable-data errors above
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
