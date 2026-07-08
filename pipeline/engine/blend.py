"""Engine stage 2: blend live sources; splice live data onto official history."""


def blend(sources: dict[str, dict[str, float]],
          weights: dict[str, float]) -> dict[str, float]:
    """Weighted arithmetic mean over the union date grid.

    Each source forward-fills its last value; at every date, weights
    renormalize over the sources that have contributed so far — so a basket
    declared {zori .5, aptlist .3, redfin .2} with only ZORI in the store
    rides 100% ZORI, and Phase-2 sources phase in without code changes.
    """
    avail = {n: s for n, s in sources.items() if s}
    if not avail:
        raise ValueError("blend: no sources available")
    dates = sorted(set().union(*(s.keys() for s in avail.values())))
    out: dict[str, float] = {}
    last: dict[str, float] = {}
    for d in dates:
        for n, s in avail.items():
            if d in s:
                last[n] = s[d]
        total = sum(weights[n] for n in last)
        out[d] = sum(weights[n] * v for n, v in last.items()) / total
    return out


def splice(official: dict[str, float], live: dict[str, float]) -> dict[str, float]:
    """Official history before the live start; live (scaled to match) after.

    Scale = official value at/before the live start divided by the live value
    there, so the assembled series is continuous at the splice point.
    """
    if not live:
        return dict(official)
    t0 = min(live)
    prior = [official[d] for d in sorted(official) if d <= t0]
    scale = (prior[-1] / live[t0]) if prior else 1.0
    out = {d: v for d, v in official.items() if d < t0}
    out.update({d: v * scale for d, v in live.items()})
    return out
