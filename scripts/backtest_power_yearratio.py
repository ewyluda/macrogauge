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
LAMBDAS = (0.0, 0.25, 0.5, 0.75, 1.0)
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

    rows, mae, mx = {}, {}, {}
    for lam in LAMBDAS:
        graded = {m: grade_month(official, w, m, lam) for m in targets}
        graded = {m: g for m, g in graded.items() if g is not None}
        if not graded:
            print(f"lambda={lam}: no gradeable months", file=sys.stderr)
            continue
        rows[lam] = graded
        errs = [abs(g[0]) for g in graded.values()]
        mae[lam], mx[lam] = sum(errs) / len(errs), max(errs)
    if not rows:
        print("no gradeable months at all — check backfill coverage",
              file=sys.stderr)
        return 1

    any_lam = next(iter(rows))
    cfs = [abs(g[1]) for g in rows[any_lam].values()]
    cf_mae = sum(cfs) / len(cfs)

    print("| month | realized_yoy_base | " +
          " | ".join(f"err λ={lam}" for lam in rows) + " | err carry-fwd |")
    print("|---|---|" + "---|" * (len(rows) + 1))
    for m in sorted(rows[any_lam]):
        cells = " | ".join(f"{rows[lam][m][0]:+.2f}" if m in rows[lam] else "—"
                           for lam in rows)
        print(f"| {m} | {official[m]:.2f} | {cells} "
              f"| {rows[any_lam][m][1]:+.2f} |")
    print(f"\ncarry-forward MAE: {cf_mae:.3f} pts over {len(cfs)} months")
    for lam in rows:
        print(f"lambda={lam}: MAE {mae[lam]:.3f}, max|err| {mx[lam]:.3f}, "
              f"n={len(rows[lam])}")

    best = min((lam for lam in rows if lam > 0), key=lambda x: mae[x])
    ok = mae[best] < cf_mae and mae[best] < mae.get(0.0, float("inf")) \
        and mx[best] <= MAX_ERR_PTS
    print(f"\nselected lambda={best} -> "
          f"{'PASS: flip approved' if ok else 'FAIL: do not flip'} "
          f"(spec §6: beat carry-fwd {cf_mae:.3f} and λ=0 "
          f"{mae.get(0.0, float('nan')):.3f}; max|err| <= {MAX_ERR_PTS})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
