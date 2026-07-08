"""Engine stage 4: daily forward-fill grid, Laspeyres aggregate, YoY."""
from datetime import date, timedelta


def fill_daily(series: dict[str, float], start: str, end: str) -> dict[str, float]:
    """Forward-fill onto every day in [max(start, first obs), end]."""
    obs = sorted(series)
    out: dict[str, float] = {}
    d = date.fromisoformat(max(start, obs[0]))
    stop = date.fromisoformat(end)
    idx, cur = 0, None
    while d <= stop:
        ds = d.isoformat()
        while idx < len(obs) and obs[idx] <= ds:
            cur = series[obs[idx]]
            idx += 1
        if cur is not None:
            out[ds] = cur
        d += timedelta(days=1)
    return out


def headline(components: dict[str, dict[str, float]],
             weights: dict[str, float]) -> dict[str, float]:
    """Laspeyres on dates where every component has a value; weights sum to 1."""
    dates = set.intersection(*(set(c) for c in components.values()))
    total = sum(weights.values())
    return {d: sum(weights[k] * components[k][d] for k in components) / total
            for d in sorted(dates)}


def yoy(index: dict[str, float]) -> dict[str, float | None]:
    """index_t / index_{t-365d} - 1, in percent; None where the base is missing."""
    out: dict[str, float | None] = {}
    for d, v in index.items():
        base = index.get((date.fromisoformat(d) - timedelta(days=365)).isoformat())
        out[d] = (v / base - 1) * 100 if base else None
    return out
