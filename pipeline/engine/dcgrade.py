"""Vintage-true grading of the DC escalation contingency bases.

P3a shipped five named bases and deliberately made no claim about which is
right, because nothing in the repo could grade one. This grades them.

The register and the P3a spec both state a vintage-true DC backtest is
impossible before ~mid-2027. That was inferred from the store (backfilled in
single sweeps) and is wrong: ALFRED carries real release history for all 12
Build components, so scripts/backfill_dc_vintages.py makes point-in-time
reconstruction possible back to 2015-03. See spec 2.1.

Everything here is a pure function of dicts -- no store, no I/O -- like every
other engine stage.
"""
import sqlite3

from pipeline.dates import months_back

# Rebase anchor. MUST match config/dc_basket.json's base_month and rebase.py's
# stage-1 contract: this index is a Laspeyres SUM of separately rebased
# components,
#   H_b(t) = sum_i w_i * I_i(t) / I_i(b)
# so the effective weight of component i is w_i / I_i(b) -- changing b
# reweights the basket and changes GROWTH RATES, not just the level. "The
# rebase constant cancels" is true for one series and false for this sum; a
# different base grades a genuinely different index than the one published on
# the site (measured: basing at 2008-01 diverged from the published grid by
# >1 index point across most months; 2018-01 by ~0.1 at a single month).
#
# This floors the earliest vintage `anchors()` can produce at 2018-01: an
# index based at 2018-01 cannot be reconstructed at a vintage predating its
# own base month's observation. That floor is PRINCIPLED, not a data
# accident -- it isn't usable vintage history being discarded, it's the base
# month simply not existing yet at an earlier vintage.
BASE_MONTH = "2018-01-01"

# First month of the Build sample, set by the two contractor PPIs. The
# long-run basis measures from here.
SAMPLE_START = "2007-12-01"


def load_component_versions(conn: sqlite3.Connection, components
                            ) -> dict[str, dict[str, list[tuple[str, float]]]]:
    """{component_code: {obs_date: [(vintage_date, value), ...]}}, ascending.

    Keyed by the basket component code, reading the store's series code --
    DCComponent.series is the store key, DCComponent.code is the component id,
    and conflating them is a standing trap in this codebase."""
    out: dict[str, dict[str, list[tuple[str, float]]]] = {}
    for comp in components:
        rows = conn.execute(
            "SELECT obs_date, vintage_date, value FROM observations "
            "WHERE series_code = ? ORDER BY obs_date, vintage_date",
            (comp.series,)).fetchall()
        versions: dict[str, list[tuple[str, float]]] = {}
        for obs_date, vintage_date, value in rows:
            versions.setdefault(obs_date, []).append((vintage_date, value))
        out[comp.code] = versions
    return out


def index_asof(comp_versions, vintage_date: str, weights: dict[str, float],
               base_month: str = BASE_MONTH) -> dict[str, float]:
    """Laspeyres Build index using only information known by `vintage_date`.

    Returns {} when any component lacks the base month at this vintage -- an
    index missing a component is not a partial index, it is a different index.
    """
    comps: dict[str, dict[str, float]] = {}
    for code, versions in comp_versions.items():
        vals = {}
        for obs_date, rows in versions.items():
            if obs_date > vintage_date:
                continue      # a release cannot carry a future observation
            known = [v for vd, v in rows if vd <= vintage_date]
            if known:
                vals[obs_date] = known[-1]
        base = vals.get(base_month)
        if not base:
            return {}
        comps[code] = {d: v / base * 100.0 for d, v in vals.items()}
    if not comps:
        return {}
    dates = set.intersection(*(set(c) for c in comps.values()))
    return {d: sum(weights[c] * comps[c][d] for c in comps)
            for d in sorted(dates)}


def anchors(comp_versions, weights: dict[str, float],
            base_month: str = BASE_MONTH) -> list[tuple[str, dict[str, float]]]:
    """[(last_observation_month, index_as_it_read_then)], ascending.

    ONE anchor per distinct last-observation month. Several ALFRED vintages
    routinely land in the same month (a revision to an old obs does not extend
    the series); grading each would inflate n and the independent-draw
    estimate without adding information (spec 5.1). Earliest vintage reaching
    a month wins -- it is the first date a reader could have stood there."""
    vints = sorted({vd for versions in comp_versions.values()
                    for rows in versions.values() for vd, _ in rows})
    out, seen = [], set()
    for vd in vints:
        idx = index_asof(comp_versions, vd, weights, base_month)
        if not idx:
            continue
        last = max(idx)
        if last in seen:
            continue
        seen.add(last)
        out.append((last, idx))
    return out


# Rolling bases only -- the three that are LIVE-COMPUTABLE RULES: standing at
# any anchor you could have computed them with no knowledge of the future.
# The two absolute regimes (GFC, COVID peak) are hindsight-selected windows
# and are deliberately NOT graded anywhere in this module (spec 5.3).
# {key: months of lookback; None means "from SAMPLE_START"}
ROLLING_BASES: dict[str, int | None] = {
    "long_run": None,
    "trailing_3yr": 36,
    "current_momentum": 12,
}


def annualized(index: dict[str, float], start_month: str,
               end_month: str) -> float | None:
    """Annualized % change of an index ratio over [start, end].

    An index RATIO, never a median or mean of YoY prints: only the ratio
    decomposes additively into per-component contributions, which is what
    preserves P1's bridge identity (P3a spec 5.1)."""
    a, b = index.get(start_month), index.get(end_month)
    if a is None or b is None or a <= 0:
        return None
    months = (int(end_month[:4]) - int(start_month[:4])) * 12 + \
             int(end_month[5:7]) - int(start_month[5:7])
    if months <= 0:
        return None
    return ((b / a) ** (12.0 / months) - 1) * 100.0


def bases_at(index: dict[str, float], anchor_month: str,
             sample_start: str = SAMPLE_START) -> dict[str, float | None]:
    """What each live-computable basis said at `anchor_month`."""
    out = {}
    for key, lookback in ROLLING_BASES.items():
        start = sample_start if lookback is None \
            else months_back(anchor_month, lookback)
        out[key] = annualized(index, start, anchor_month)
    return out
