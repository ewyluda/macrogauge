"""Engine stage 2: blend live sources; splice live data onto official history."""


def blend(sources: dict[str, dict[str, float]],
          weights: dict[str, float]) -> dict[str, float]:
    """Weighted arithmetic mean over the union date grid.

    Each source forward-fills its last value; at every date, weights
    renormalize over the sources that have contributed so far — so a basket
    declared {zori .5, aptlist .3, redfin .2} with only ZORI in the store
    rides 100% ZORI, and Phase-2 sources phase in without code changes.

    A source whose first observation arrives AFTER the blend has started is
    scaled at entry to the incumbents' blended level on that date (entry
    splice): rebase() anchors late starters on their own first month = 100,
    a different basis than incumbents' 2018-01 = 100 — entering unscaled
    would step the blend to the new source's arbitrary anchor level (the
    2026-07 fuel cliff: AAA at ~100 joining EIA at ~148 faked a −23% day).
    Scaled entry keeps the blend continuous; the entrant contributes its
    relative movement from then on.
    """
    avail = {n: s for n, s in sources.items() if s}
    if not avail:
        raise ValueError("blend: no sources available")
    dates = sorted(set().union(*(s.keys() for s in avail.values())))
    out: dict[str, float] = {}
    last: dict[str, float] = {}
    scale: dict[str, float] = {}
    for d in dates:
        entering = [n for n in avail if d in avail[n] and n not in scale]
        for n, s in avail.items():
            if d in s and n not in entering:
                last[n] = s[d] * scale[n]
        if entering:
            if last:
                total_inc = sum(weights[n] for n in last)
                anchor = (sum(weights[n] * v for n, v in last.items())
                          / total_inc)
            else:
                anchor = None  # blend's first date — no incumbents to match
            for n in entering:
                v0 = avail[n][d]
                scale[n] = 1.0 if anchor is None or v0 == 0 else anchor / v0
                last[n] = v0 * scale[n]
        total = sum(weights[n] for n in last)
        out[d] = sum(weights[n] * v for n, v in last.items()) / total
    return out


def shift_days(series: dict[str, float], days: int) -> dict[str, float]:
    """Date-shift view of a series (config lead_days): wholesale sources that
    lead retail are read `days` later. A view over the store — stored
    observation dates are never rewritten."""
    if not days:
        return dict(series)
    from datetime import date, timedelta
    return {(date.fromisoformat(d) + timedelta(days=days)).isoformat(): v
            for d, v in series.items()}


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


def splice_anchored(official: dict[str, float], live: dict[str, float]) -> dict[str, float]:
    """Official everywhere it exists; live tail only AFTER the last official
    obs, scaled to be continuous there — re-anchored every run as new prints
    land.

    Contrast splice(): that anchors ONCE at the live series' first obs and
    drops official data after it — right for the gauge's independent
    re-pricing (live replaces official), wrong for a proxy that merely
    nowcasts an official backbone (DC index): raw futures are an input to a
    fabricated-product PPI, not a measure of it, so proxy volatility and
    contract-roll drift must stay confined to the ~1-2 month tail."""
    if not official:
        return dict(live)
    t0 = max(official)
    overlap = [d for d in live if d <= t0]
    if not overlap or not live[max(overlap)]:
        return dict(official)  # nothing to scale on (or zero): official only
    scale = official[t0] / live[max(overlap)]
    out = dict(official)
    out.update({d: v * scale for d, v in live.items() if d > t0})
    return out
