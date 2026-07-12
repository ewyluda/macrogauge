"""DC cost index engine: two input-cost indexes (build, ops) + state parity.

Composes the existing pure stages per component: rebase -> (anchored splice of
a futures proxy, if configured) -> gate -> aggregate. Weights live at the
series level (dc_basket): a stale component carries forward on the daily grid
and NEVER hands its weight to its neighbors. Component YoY is computed at each
component's OWN last observation (aggregate.yoy_at_obs) — the PPI components
lag 1-2 months and must compare like-month-to-like-month.

A component whose backbone series has no store rows raises (rebase's empty-
series ValueError): the run_daily datacenter block catches it and surfaces
datacenter_ok=false rather than publishing a silently mis-weighted index.
"""
import sqlite3
from pathlib import Path

from pipeline import dc_basket
from pipeline.engine import aggregate, gate, rebase
from pipeline.engine import blend as blend_mod
from pipeline.store import vintage

GRID_START = "2017-01-01"    # internal grid start: feeds 365d YoY bases for 2018
PUBLISH_START = "2018-01-01"  # writers publish from here


def _series(conn: sqlite3.Connection, code: str) -> dict[str, float]:
    return dict(vintage.latest(conn, code))


def _arrived_today(conn, code: str, obs_date: str, today: str) -> bool:
    # mirrors gauge._arrived_today for a single series (kept local: the
    # 14-component gauge engine is deliberately untouched by this feature)
    row = conn.execute(
        "SELECT MAX(vintage_date) FROM observations "
        "WHERE series_code = ? AND obs_date = ?", (code, obs_date)).fetchone()
    return row[0] == today


def run(conn: sqlite3.Connection, today: str,
        basket_path: Path | None = None) -> dict:
    base_month, baskets = dc_basket.load_baskets(basket_path)
    out = {}
    for name, comps in baskets.items():
        built, flags, modes = {}, [], {}
        for comp in comps:
            official = _series(conn, comp.series)
            idx = rebase.rebase(official, base_month)
            live = _series(conn, comp.live_proxy) if comp.live_proxy else {}
            if live:
                live_idx = rebase.rebase(live, base_month)
                idx = blend_mod.splice_anchored(idx, live_idx)
                last = max(idx)
                idx, flagged = gate.apply_gate(
                    idx, _arrived_today(conn, comp.live_proxy, last, today))
                if flagged:
                    flags.append(f"{comp.code}@{last}")
            built[comp.code] = idx
            modes[comp.code] = "official+proxy" if live else "official"
        end = min(max(max(s) for s in built.values()), today)
        daily = {k: aggregate.fill_daily(s, GRID_START, end)
                 for k, s in built.items()}
        weights = {c.code: c.weight for c in comps}
        index = aggregate.headline(daily, weights)
        own_yoy = {}
        for code, s in built.items():
            at_obs = aggregate.yoy_at_obs(s, daily[code])
            own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
        components = {}
        for c in comps:
            own_end = max(d for d in built[c.code] if d <= end)
            components[c.code] = {
                "label": c.label, "group": c.group, "weight": c.weight,
                "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "last_obs": own_end}
        out[name] = {"index": index,
                     "yoy": aggregate.weighted_yoy(own_yoy, weights),
                     "as_of": end, "gate_flags": flags, "components": components}
    return {"base_month": base_month, "indexes": out}
