"""Engine stage 3: >5% one-day quality gate for live components.

Stateless "hold one day": a spike is held only while it is the just-arrived
last observation inside today's grid — vintage_date == today, or for a
lead-shifted component the first run its shifted date is visible (see
gauge._entered_grid_today). On the next run it is no longer just-arrived and
passes through — a spike that persists was real. Historical jumps always
stand; this protects only the newest incoming point.

Like-month mode (`like_month=True`, year_ratio components — EIA residential
electricity and gas): the tail's step off the last print is last year's
official move for the same months times the like-month change in the live
ratio. The first factor is BLS's own seasonal history, not new information;
gating the raw step would hold a legitimate seasonal turn (the old level
splice held EIA residential gas every spring and autumn — its raw MoM
exceeds 5% in about half of all months). So the move tested is the step
relative to the same step a year earlier: the like-month YoY change.
"""
import bisect
from datetime import date, timedelta

MAX_MOVE = 0.05


def _year_ago(series: dict[str, float], dates: list[str], d: str) -> float | None:
    """Forward-filled value 365 days before `d` (the year_ratio convention)."""
    target = (date.fromisoformat(d) - timedelta(days=365)).isoformat()
    i = bisect.bisect_right(dates, target) - 1
    return series[dates[i]] if i >= 0 else None


def apply_gate(series: dict[str, float], arrived_today: bool,
               max_move: float = MAX_MOVE,
               like_month: bool = False) -> tuple[dict[str, float], bool]:
    dates = sorted(series)
    if len(dates) < 2 or not arrived_today:
        return dict(series), False
    prev, last = series[dates[-2]], series[dates[-1]]
    if not prev:
        return dict(series), False
    move = last / prev - 1
    if like_month:
        base_prev = _year_ago(series, dates, dates[-2])
        base_last = _year_ago(series, dates, dates[-1])
        if base_prev and base_last:
            move = (last / prev) / (base_last / base_prev) - 1
    if abs(move) > max_move:
        held = dict(series)
        held[dates[-1]] = prev
        return held, True
    return dict(series), False
