"""Gauge engine orchestrator: store -> five stages -> per-variant results."""
import sqlite3
from datetime import date
from pathlib import Path

from pipeline import basket as basket_mod
from pipeline.engine import aggregate, gate, variants
from pipeline.store import vintage

GRID_START = "2017-01-01"    # internal grid start: feeds 365d YoY bases for 2018
PUBLISH_START = "2018-01-01"  # writers publish from here


def _series(conn: sqlite3.Connection, code: str) -> dict[str, float]:
    return dict(vintage.latest(conn, code))


def _arrived_today(conn, codes: list[str], obs_date: str, today: str) -> bool:
    q = ",".join("?" * len(codes))
    row = conn.execute(
        f"SELECT MAX(vintage_date) FROM observations "
        f"WHERE series_code IN ({q}) AND obs_date = ?",
        (*codes, obs_date)).fetchone()
    return row[0] == today


def _fresh(conn, blend_codes, staleness: dict[str, int], today: str) -> bool:
    """A component is fresh when ANY blend source is within its staleness."""
    for code in blend_codes:
        latest_obs = vintage.max_obs_date(conn, code)
        limit = staleness.get(code)
        if latest_obs is not None and limit is not None and \
                (date.fromisoformat(today) - date.fromisoformat(latest_obs)).days <= limit:
            return True
    return False


def run(conn: sqlite3.Connection, today: str, basket_path: Path | None = None,
        staleness: dict[str, int] | None = None) -> dict:
    base_month, comps = basket_mod.load_basket(basket_path)
    staleness = staleness or {}
    weights = {c.code: c.weight for c in comps}
    out = {}
    for variant in variants.VARIANTS:
        built, modes, flags = {}, {}, []
        for comp in comps:
            official_series = _series(conn, comp.official_series)
            live_sources = ({name: _series(conn, name) for name in comp.live_blend}
                            if comp.live_blend else {})
            idx, mode = variants.build_component(comp, variant,
                                                 official_series, live_sources)
            if mode == "live":
                last = max(idx)
                arrived = _arrived_today(conn, list(comp.live_blend), last, today)
                idx, flagged = gate.apply_gate(idx, arrived)
                if flagged:
                    flags.append(f"{comp.code}@{last}")
            built[comp.code], modes[comp.code] = idx, mode
        end = max(max(c) for c in built.values())
        daily = {k: aggregate.fill_daily(c, GRID_START, end)
                 for k, c in built.items()}
        index = aggregate.headline(daily, weights)
        # Headline YoY (Option A, 1c spec §3): each component's YoY is honest
        # only at its OWN observation dates (like-month vs like-month); the
        # last computed YoY carries forward between obs. Aggregating filled
        # LEVELS at the grid end compared a stale print against a
        # different-month base a year ago -- the between-print sawtooth.
        own_yoy = {}
        for code, series_by_date in built.items():
            filled_yoy = aggregate.yoy(daily[code])
            at_obs = {d: filled_yoy[d] for d in series_by_date
                      if d in filled_yoy}
            own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
        coverage = sum(c.weight for c in comps
                       if modes[c.code] == "live"
                       and _fresh(conn, c.live_blend, staleness, today))
        components = {}
        for c in comps:
            own_end = max(built[c.code])  # this component's own last-observation
            # date, not the grid end -- lagging components (e.g. EIA natgas,
            # CPI) must compare like-month-to-like-month on their own filled
            # daily series, never a forward-filled value against a
            # different-month base a year ago.
            components[c.code] = {
                "weight": c.weight, "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "end_value": daily[c.code][end]}  # end_value stays at grid end; QA uses it
        out[variant] = {
            "index": index, "yoy": aggregate.weighted_yoy(own_yoy, weights),
            "as_of": end, "coverage_pct": coverage * 100, "gate_flags": flags,
            "components": components}
    return {"base_month": base_month, "variants": out}
