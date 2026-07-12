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


def parity_rows(power: dict[str, tuple[str, float]],
                wage: dict[str, tuple[str, float]],
                nat_power: tuple[str, float] | None,
                nat_wage: tuple[str, float] | None,
                w_labor: float, w_power: float) -> dict:
    """Pinned parity formula (spec §6): mult = w x state_relative + (1 - w).
    Inputs that don't vary by state are pinned at relative 1.0. Pure function;
    inputs are {state: (obs_date, value)} plus national (obs_date, value)."""
    national = {
        "power": None if not nat_power else {"value": nat_power[1], "as_of": nat_power[0]},
        "wage": None if not nat_wage else {"value": nat_wage[1], "as_of": nat_wage[0]}}
    base = {"w_labor": w_labor, "w_power": w_power, "national": national}
    if not nat_power or not nat_power[1]:
        return {"mode": "unavailable", "states": [], **base}
    mode = "full" if nat_wage and nat_wage[1] and wage else "ops_only"
    states = []
    for st in sorted(power):
        p_date, p_val = power[st]
        power_rel = p_val / nat_power[1]
        row = {"state": st.upper(), "power_rel": round(power_rel, 4),
               "ops_mult": round(w_power * power_rel + (1 - w_power), 4),
               "power_asof": p_date,
               "wage_rel": None, "build_mult": None, "wage_asof": None}
        w = wage.get(st)
        if w and nat_wage and nat_wage[1]:
            wage_rel = w[1] / nat_wage[1]
            row["wage_rel"] = round(wage_rel, 4)
            row["build_mult"] = round(w_labor * wage_rel + (1 - w_labor), 4)
            row["wage_asof"] = w[0]
        states.append(row)
    return {"mode": mode, "states": states, **base}


def _latest_row(conn, code: str) -> tuple[str, float] | None:
    rows = vintage.latest(conn, code)
    return rows[-1] if rows else None


def _by_state(conn, prefix: str) -> dict[str, tuple[str, float]]:
    codes = [r[0] for r in conn.execute(
        "SELECT DISTINCT series_code FROM observations WHERE series_code LIKE ?",
        (prefix + "%",))]
    out = {}
    for code in codes:
        st = code[len(prefix):]
        if st == "us":
            continue
        row = _latest_row(conn, code)
        if row:
            out[st] = row
    return out


def parity_from_store(conn: sqlite3.Connection,
                      basket_path: Path | None = None) -> dict:
    """Store-driven parity: states are discovered from what actually exists in
    the store (a missing state degrades to a missing row, never an error)."""
    _, baskets = dc_basket.load_baskets(basket_path)
    w_labor, w_power = dc_basket.parity_shares(baskets)
    return parity_rows(_by_state(conn, "eia_elec_ind_"),
                       _by_state(conn, "qcew_wage23_"),
                       _latest_row(conn, "eia_elec_ind_us"),
                       _latest_row(conn, "qcew_wage23_us"),
                       w_labor, w_power)
