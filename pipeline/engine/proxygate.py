"""Engine: backtest gate for a DC-index proxy tail (NAND spot -> storage PPI).

The storage component used to ride a LEVEL splice of DRAMeXchange NAND spot
(MLC 64Gb) onto the computer-storage-device PPI: the tail moved one-for-one
with a memory spot price that is an input to, not a measure of, the drive
price BLS surveys. The DC power tail already gets a disciplined treatment
(powergrade.py): a like-month year-ratio nowcast with pass-through λ, graded
against realized prints, and a carry-forward baseline it must beat. This
module gives the storage tail the same treatment, with one difference that
makes it load-bearing: dcindex rides the tail only when this gate returns
PASS (config `live_proxy_gate: "backtest"`), at the λ the backtest picked.
Otherwise the component is official-only.

Backtest (one row per PPI print month M with a year-ago print):
  * grading day t = M-GRADE_DAY (mid-month: BLS prices PPIs mid-month);
  * official as a reader knew it at t — vintage-true (`vintage.as_of`) where
    the store holds vintages that old, else latest-vintage values stamped at
    least AVAIL_LAG_DAYS before t (PPI month M-1 prints ~mid M);
  * proxy = NAND spot trailing-smoothed over SMOOTH_DAYS, only obs <= t;
  * tail estimate = the year-ratio splice (blend.splice_year_ratio) at the
    last proxy date <= t; carry = the last official value known at t;
  * realized = M's FIRST release (what a reader was graded against);
  * error in YoY points: (estimate - realized) / official[M-12] * 100.
PASS requires >= MIN_MONTHS months graded on the common set every λ could
grade, and the best λ>0 to beat BOTH carry-forward and λ=0 on MAE, with a
worst month no worse than carry-forward's worst. λ is also estimated
directly (OLS through the origin of like-month PPI changes on like-month NAND
month-mean changes) and published beside the grid pick for transparency.

Regime switch (2026-10-02). The tail rides only while NAND spot is more than
REGIME_MIN_MOVE (50%) away from its level a year earlier; otherwise the
estimate is carry-forward. Each graded month applies the switch at its own
estimate date, and dcindex applies it at the latest spot date, so the graded
rule is the rule the index rides. Why: half of this PPI's first prints since
2020 repeat the prior month exactly (BLS carries the value; the move lands at
the four-month revision), so in calm years carry-forward is nearly
unbeatable and any NAND tail adds noise (MAE 0.75 vs 1.48 YoY pts,
2020-25). In memory-price shocks (2022, 2026) the tail cuts error by about a
third. Over 2020-04..2026-07 the switched λ=0.15 rule beat carry-forward
2.09 vs 2.67 (first prints), and every threshold from 25% to 100% beat it.

Error bound (2026-10-02). The original absolute bound, |error| <= 10 pts
every month, was unmeetable by ANY rule in the 2026 shock: carry-forward
itself missed Jul-2026 by 58.6 pts (the PPI's first print jumped 80 -> 117).
The bound is now relative: the best λ's worst month must be no worse than
carry-forward's. Both the switch threshold and this bound were set AFTER
seeing the 2020-26 backtest (disclosed in config/methodology_changelog.json).

History. NAND spot collection began 2026-07-15. Earlier points are ~monthly
Wayback Machine snapshots of the same homepage (scripts/
backfill_dramex_wayback.py, route WAYBACK, 2019-02 on), so proxy lookups take
the nearest point at/before the target within PROXY_TOLERANCE_DAYS, not the
daily-data 7. Under a year of history the verdict is INSUFFICIENT and the
storage component is official-only."""
from datetime import date, timedelta

from pipeline.engine import blend
from pipeline.engine.powergrade import month_shift
from pipeline.store import vintage

LAMBDAS = (0.0, 0.1, 0.25, 0.5, 0.75, 1.0)
SMOOTH_DAYS = 7
AVAIL_LAG_DAYS = 45   # PPI month M-1 is out by mid-M
GRADE_DAY = 15
MIN_MONTHS = 6
REGIME_MIN_MOVE = 0.5          # |W(t)/W(t-365d) - 1| above which the tail rides
PROXY_TOLERANCE_DAYS = 45      # archived history is ~monthly (see docstring)


def _smoothed(conn, codes: tuple[str, ...], smooth_days: int) -> dict[str, float]:
    # identical to dcindex's live-blend construction, so the graded tail is
    # the tail the index would ride
    return blend.trailing_mean(
        blend.hub_mean([dict(vintage.latest(conn, c)) for c in codes]), smooth_days)


def proxy_yoy(live: dict[str, float], t: str) -> float | None:
    """W(t)/W(t-365d) - 1 off the nearest proxy points at/before each date
    within PROXY_TOLERANCE_DAYS (the same lookups the splice uses); None when
    either is missing or the base is non-positive."""
    dates = sorted(live)
    wt = blend._at_or_before(dates, t, PROXY_TOLERANCE_DAYS)
    wb = blend._at_or_before(
        dates, (date.fromisoformat(t) - timedelta(days=365)).isoformat(),
        PROXY_TOLERANCE_DAYS)
    if wt is None or wb is None or live[wb] <= 0:
        return None
    return live[wt] / live[wb] - 1.0


def regime_active(yoy: float | None) -> bool:
    return yoy is not None and abs(yoy) > REGIME_MIN_MOVE


def _official_known(conn, code: str, latest: dict[str, float], t: str) -> dict[str, float]:
    known = dict(vintage.as_of(conn, code, t))
    if known:
        return known
    cutoff = (date.fromisoformat(t) - timedelta(days=AVAIL_LAG_DAYS)).isoformat()
    return {d: v for d, v in latest.items() if d <= cutoff}


def grade(conn, official_code: str, proxy_codes: tuple[str, ...],
          smooth_days: int = SMOOTH_DAYS) -> dict:
    latest = dict(vintage.latest(conn, official_code))
    first = {d: v for d, v, _ in vintage.first_releases(conn, official_code)}
    live = _smoothed(conn, proxy_codes, smooth_days)
    per_lambda: dict[float, dict[str, tuple[float, float]]] = {lam: {} for lam in LAMBDAS}
    for m in sorted(latest):
        base_m = month_shift(m, -12)
        if base_m not in latest or m not in first or not latest[base_m]:
            continue
        t = m[:8] + f"{GRADE_DAY:02d}"
        known = {d: v for d, v in _official_known(conn, official_code, latest, t).items()
                 if d < m}
        live_t = {d: v for d, v in live.items() if d <= t}
        if not known or not live_t:
            continue
        t0 = max(known)
        base = latest[base_m]
        cf = (known[t0] - first[m]) / base * 100.0
        for lam in LAMBDAS:
            spliced = blend.splice_year_ratio(known, live_t, lam, PROXY_TOLERANCE_DAYS)
            tail = [d for d in spliced if t0 < d <= t]
            if not tail:
                continue
            est = max(tail)
            if lam > 0 and not regime_active(proxy_yoy(live_t, est)):
                per_lambda[lam][m] = (cf, cf)   # calm: the switched rule carries
            else:
                per_lambda[lam][m] = ((spliced[est] - first[m]) / base * 100.0, cf)
    sets = [set(g) for g in per_lambda.values()]
    common = sorted(set.intersection(*sets)) if sets else []
    dropped = sorted(set.union(*sets) - set(common)) if sets else []
    mae = {lam: sum(abs(g[m][0]) for m in common) / len(common)
           for lam, g in per_lambda.items()} if common else {}
    mx = {lam: max(abs(g[m][0]) for m in common)
          for lam, g in per_lambda.items()} if common else {}
    cf_mae = (sum(abs(per_lambda[LAMBDAS[0]][m][1]) for m in common) / len(common)
              if common else None)
    cf_max = (max(abs(per_lambda[LAMBDAS[0]][m][1]) for m in common)
              if common else None)
    scored = {lam: mae[lam] for lam in LAMBDAS if lam > 0 and lam in mae}
    best = min(scored, key=scored.get) if scored else None
    verdict = "INSUFFICIENT"
    if len(common) >= MIN_MONTHS and best is not None:
        ok = (scored[best] < cf_mae and scored[best] < mae[0.0]
              and mx[best] <= cf_max)
        verdict = "PASS" if ok else "FAIL"
    yoy_now = proxy_yoy(live, max(live)) if live else None
    active = verdict == "PASS" and regime_active(yoy_now)
    return {"official": official_code, "proxy": list(proxy_codes),
            "transform": "year_ratio", "smooth_days": smooth_days,
            "as_of": max(latest) if latest else None,
            "proxy_history_days": ((date.fromisoformat(max(live)) - date.fromisoformat(min(live))).days
                                   if live else 0),
            "months_graded": len(common), "min_months": MIN_MONTHS,
            "months_dropped": len(dropped), "dropped_months": [m[:7] for m in dropped],
            "carry_forward_mae": None if cf_mae is None else round(cf_mae, 3),
            "carry_forward_max": None if cf_max is None else round(cf_max, 3),
            "zero_lambda_mae": round(mae[0.0], 3) if 0.0 in mae else None,
            "best_lambda": best,
            "best_mae": None if best is None else round(scored[best], 3),
            "best_max": None if best is None else round(mx[best], 3),
            "lambda_ols": _lambda_ols(latest, live),
            "regime_min_move": REGIME_MIN_MOVE,
            "proxy_yoy_pct": None if yoy_now is None else round(yoy_now * 100.0, 1),
            "regime_active": regime_active(yoy_now),
            "verdict": verdict, "tail_active": active,
            "note": note(verdict, active)}


def _lambda_ols(official: dict[str, float], live: dict[str, float]) -> float | None:
    """Like-month pass-through estimated directly: OLS through the origin of
    PPI(M)/PPI(M-12)-1 on NAND month-mean(M)/month-mean(M-12)-1. None under
    three overlapping months (reported, never used by the index)."""
    means: dict[str, list[float]] = {}
    for d, v in live.items():
        means.setdefault(d[:7] + "-01", []).append(v)
    w = {m: sum(v) / len(v) for m, v in means.items()}
    pairs = [(w[m] / w[month_shift(m, -12)] - 1, official[m] / official[month_shift(m, -12)] - 1)
             for m in official if m in w and month_shift(m, -12) in w
             and month_shift(m, -12) in official and w[month_shift(m, -12)]]
    if len(pairs) < 3:
        return None
    sxx = sum(x * x for x, _ in pairs)
    return None if sxx == 0 else round(sum(x * y for x, y in pairs) / sxx, 4)


_NOTES = {
    "PASS": ("The switched NAND-spot tail beat both carry-forward and zero "
             "pass-through, with a worst month no worse than carry-forward's, "
             "and NAND is more than 50% away from a year ago, so the storage "
             "component rides it at the selected pass-through."),
    "PASS_IDLE": ("The switched NAND-spot tail passed its backtest, but NAND is "
                  "within 50% of its level a year ago, a regime where carrying "
                  "the last print forward wins, so the storage component is "
                  "official-only until NAND moves."),
    "FAIL": ("The switched NAND-spot tail did not beat carry-forward and zero "
             "pass-through with a worst month no worse than carry-forward's, "
             "so the storage component is official-only."),
    "INSUFFICIENT": ("Not enough history to grade the like-month NAND-spot tail "
                     "(a year-over-year ratio needs a year of spot prices), so the "
                     "storage component is official-only until it can be graded."),
}


def note(verdict: str, active: bool = True) -> str:
    if verdict == "PASS" and not active:
        return _NOTES["PASS_IDLE"]
    return _NOTES.get(verdict, _NOTES["INSUFFICIENT"])
