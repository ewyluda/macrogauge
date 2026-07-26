"""Offline backtest gate for the wave-4b year-ratio power nowcast (spec §6).

    .venv/bin/python scripts/backtest_power_yearratio.py --store store

Replays deployment honestly for each gradeable retail print month M: the
nowcast at mid-month M uses only wholesale obs <= that date, anchored on the
newest retail print available then (AVAIL_LAG_DAYS embargo, replicating the
~75-day publication lag). Errors are in YoY points against the realized
print. Flip condition (spec §6): the selected λ>0 must beat BOTH naive
baselines (carry-forward AND λ=0) on MAE with max |err| <= 3.0 YoY pts.
Results land in the spec's §10; this script publishes nothing.

The grading math (constants, month_shift, grade_month, grade_all) lives in
`pipeline.engine.powergrade` so a later task can publish the same verdict
under a schema with an as-of instead of it only existing as this script's
console output (spec 7) -- this file is now just the CLI: load the store,
call the engine, print the table, exit on the verdict."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline.engine import blend                          # noqa: E402
from pipeline.engine.powergrade import (                    # noqa: E402,F401
    RETAIL, HUBS, LAMBDAS, SMOOTH_DAYS, AVAIL_LAG_DAYS, GRADE_DAY,
    MAX_ERR_PTS, month_shift, grade_month, grade_all,
)
from pipeline.store import vintage                         # noqa: E402

# month_shift, grade_month, and grade_all are re-exported above (not called
# directly by this module) so tests/test_backtest_power.py -- which loads
# this script as a module and exercises the grading math on it -- keeps
# working unchanged against the moved engine functions.


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
