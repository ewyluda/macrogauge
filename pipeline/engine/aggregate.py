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
    if not components:
        return {}
    dates = set.intersection(*(set(c) for c in components.values()))
    total = sum(weights.values())
    return {d: sum(weights[k] * components[k][d] for k in components) / total
            for d in sorted(dates)}


def yoy(index: dict[str, float]) -> dict[str, float | None]:
    """index_t / index_{t-365d} - 1, in percent; None where the base is missing."""
    out: dict[str, float | None] = {}
    for d, v in index.items():
        base = index.get((date.fromisoformat(d) - timedelta(days=365)).isoformat())
        out[d] = (v / base - 1) * 100 if base is not None else None
    return out


def fill_yoy(yoy_at_obs: dict[str, float | None], start: str, end: str
             ) -> dict[str, float | None]:
    """Forward-fill a YoY series computed at a component's own obs dates.

    Unlike fill_daily, None is a real value here (missing YoY base) and is
    carried forward as None — a missing base must not resurrect the prior
    observation's YoY."""
    obs = sorted(yoy_at_obs)
    out: dict[str, float | None] = {}
    d = date.fromisoformat(max(start, obs[0]))
    stop = date.fromisoformat(end)
    idx, cur, seen = 0, None, False
    while d <= stop:
        ds = d.isoformat()
        while idx < len(obs) and obs[idx] <= ds:
            cur, seen = yoy_at_obs[obs[idx]], True
            idx += 1
        if seen:
            out[ds] = cur
        d += timedelta(days=1)
    return out


def weighted_yoy(component_yoys: dict[str, dict[str, float | None]],
                 weights: dict[str, float]) -> dict[str, float | None]:
    """Headline YoY = sum(w_i * yoy_i) on dates every component covers;
    weights renormalize like headline(). None where any component is None."""
    if not component_yoys:
        return {}
    dates = set.intersection(*(set(c) for c in component_yoys.values()))
    total = sum(weights.values())
    out: dict[str, float | None] = {}
    for d in sorted(dates):
        vals = [(weights[k], c[d]) for k, c in component_yoys.items()]
        out[d] = (sum(w * v for w, v in vals) / total
                  if all(v is not None for _, v in vals) else None)
    return out
