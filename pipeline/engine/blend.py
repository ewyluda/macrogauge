"""Engine stage 2: blend live sources; splice live data onto official history."""
import bisect
from datetime import date, timedelta


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


def hub_mean(series_list: list[dict[str, float]]) -> dict[str, float]:
    """Per-date equal-weight mean over the series that HAVE that date — one
    hub missing a day must not drop the day (same-concept sources; mirrors
    blend()'s renormalize-on-missing semantics)."""
    dates = set().union(*(set(s) for s in series_list)) if series_list else set()
    return {d: sum(s[d] for s in series_list if d in s)
               / sum(1 for s in series_list if d in s)
            for d in sorted(dates)}


def trailing_mean(series: dict[str, float], days: int) -> dict[str, float]:
    """Calendar-window trailing mean at each obs date: mean of the values at
    obs dates within [d-days+1, d] that exist. Gaps shrink the sample —
    never fabricate. days<=1 is the identity."""
    if days <= 1:
        return dict(series)
    dates = sorted(series)
    out = {}
    for d in dates:
        lo = (date.fromisoformat(d) - timedelta(days=days - 1)).isoformat()
        window = [series[x] for x in dates if lo <= x <= d]
        out[d] = sum(window) / len(window)
    return out


def _at_or_before(dates: list[str], target: str,
                  tolerance_days: int | None = None) -> str | None:
    """Latest date in sorted `dates` at/before `target`; None when none
    exists or the nearest is more than tolerance_days older than target."""
    i = bisect.bisect_right(dates, target) - 1
    if i < 0:
        return None
    d = dates[i]
    if tolerance_days is not None:
        gap = (date.fromisoformat(target) - date.fromisoformat(d)).days
        if gap > tolerance_days:
            return None
    return d


def splice_year_ratio(official: dict[str, float], live: dict[str, float],
                      passthrough: float,
                      tolerance_days: int = 7) -> dict[str, float]:
    """Official everywhere it exists; after the last print T0, a like-month
    year-ratio nowcast tail:

        model(t) = official_ffill(t-365d) * (1 + passthrough*(W(t)/W(t-365d) - 1))
        tail(t)  = model(t) * official(T0)/model(T0)

    Contrast splice_anchored(): a LEVEL splice imports the proxy's own
    seasonality into the tail — wholesale power swings ~2.8x spring→summer
    while tariff-smoothed retail is seasonally flat, which exploded ops YoY
    +6.2→+52.3% (wave-4 §10). The year ratio compares W to itself a year ago,
    so seasonality divides out by construction; `passthrough` (λ) states how
    much of the remaining like-month wholesale move retail inherits. The
    residual anchor at T0 keeps the tail continuous at the print and
    re-anchors every print — correcting one month of model error, never a
    seasonal gap.

    Never fabricate: W lookups take the nearest obs at/before the target
    within tolerance_days; official year-ago lookups forward-fill the sparse
    monthly backbone with no tolerance (monthly cadence is that series' own
    resolution). A tail date whose lookups fail — or whose W denominator or
    model value is non-positive (negative smoothed wholesale is real) — is
    skipped; when the anchor itself can't be built, official returns alone."""
    if not official or not live:
        return dict(official)
    t0 = max(official)
    off_dates, live_dates = sorted(official), sorted(live)

    def model(t: str) -> float | None:
        base_date = (date.fromisoformat(t) - timedelta(days=365)).isoformat()
        ob = _at_or_before(off_dates, base_date)
        wt = _at_or_before(live_dates, t, tolerance_days)
        wb = _at_or_before(live_dates, base_date, tolerance_days)
        if ob is None or wt is None or wb is None or live[wb] <= 0:
            return None
        return official[ob] * (1.0 + passthrough * (live[wt] / live[wb] - 1.0))

    m0 = model(t0)
    if m0 is None or m0 <= 0:
        return dict(official)
    anchor = official[t0] / m0
    out = dict(official)
    for t in live_dates:
        if t <= t0:
            continue
        m = model(t)
        if m is not None and m > 0:
            out[t] = m * anchor
    return out
