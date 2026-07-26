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

# Rebase anchor. IMMATERIAL to every published number: each basis and each
# realized value is a ratio, so the rebase constant cancels exactly. It is
# deliberately NOT 2018-01 -- requiring that base would floor the earliest
# anchor at 2018-06 and discard three years of usable vintages (spec 5.1).
BASE_MONTH = "2008-01-01"

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
