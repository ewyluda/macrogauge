"""Engine stage 3: >5% one-day quality gate for live components.

Stateless "hold one day": a spike is held only while it is the just-arrived
last observation inside today's grid — vintage_date == today, or for a
lead-shifted component the first run its shifted date is visible (see
gauge._entered_grid_today). On the next run it is no longer just-arrived and
passes through — a spike that persists was real. Historical jumps always
stand; this protects only the newest incoming point.
"""

MAX_MOVE = 0.05


def apply_gate(series: dict[str, float], arrived_today: bool,
               max_move: float = MAX_MOVE) -> tuple[dict[str, float], bool]:
    dates = sorted(series)
    if len(dates) < 2 or not arrived_today:
        return dict(series), False
    prev, last = series[dates[-2]], series[dates[-1]]
    if prev and abs(last / prev - 1) > max_move:
        held = dict(series)
        held[dates[-1]] = prev
        return held, True
    return dict(series), False
