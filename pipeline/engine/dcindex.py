"""DC cost index engine: three input-cost indexes (build, ops, hardware) + state parity + hedonic-gap panel.

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
            if comp.live_proxy_blend:
                live = blend_mod.trailing_mean(
                    blend_mod.hub_mean(
                        [_series(conn, c) for c in comp.live_proxy_blend]),
                    comp.live_proxy_smooth_days or 1)
            else:
                live = _series(conn, comp.live_proxy) if comp.live_proxy else {}
            tail_active = False
            if live:
                live_idx = rebase.rebase(live, base_month)
                official_end = max(idx)
                idx = blend_mod.splice_anchored(idx, live_idx)
                last = max(idx)
                tail_active = last > official_end
                # Gate only a real proxy tail. When the proxy has no points
                # past the last official print, `last` IS an official print:
                # official data is trusted (never held), matching the gauge —
                # otherwise a proxy vintage correction dated at the print
                # could hold a legitimate official month-over-month move.
                if tail_active:
                    proxies = comp.live_proxy_blend or (comp.live_proxy,)
                    idx, flagged = gate.apply_gate(
                        idx, any(_arrived_today(conn, c, last, today)
                                 for c in proxies))
                    if flagged:
                        flags.append(f"{comp.code}@{last}")
            built[comp.code] = idx
            # a proxy that contributes no tail must not advertise one — the
            # page's "Data" column reflects what today's series actually is
            modes[comp.code] = "official+proxy" if tail_active else "official"
        end = min(max(max(s) for s in built.values()), today)
        daily = {k: aggregate.fill_daily(s, GRID_START, end)
                 for k, s in built.items()}
        weights = {c.code: c.weight for c in comps}
        index = aggregate.headline(daily, weights)
        own_yoy = {}
        for code, s in built.items():
            at_obs = aggregate.yoy_at_obs(s, daily[code])
            if not at_obs:
                raise ValueError(
                    f"dc-index component {code}: no observations on the daily "
                    f"grid (all outside {GRID_START}..{end})")
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
    # Hedonic-gap panel: YoY at each series' OWN last observation, same
    # like-month honesty as basket components (yoy_at_obs omits month-hole
    # bases). A panel-only series with no store rows degrades to a missing
    # row — it must never take the whole index down (unlike basket
    # components, whose absence raises above).
    panel = []
    for row in dc_basket.load_hardware_gap(basket_path):
        s = _series(conn, row.series)
        if not s:
            continue
        last = max(s)
        filled = aggregate.fill_daily(s, GRID_START, last)
        panel.append({"code": row.code, "label": row.label, "series": row.series,
                      "in_basket": row.in_basket,
                      "yoy_pct": aggregate.yoy_at_obs(s, filled).get(last),
                      "last_obs": last})
    return {"base_month": base_month, "indexes": out, "hardware_gap": panel}


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
        # like-for-like quarters only: a state whose newest quarter is
        # disclosure-suppressed keeps its prior-quarter wage in the store —
        # dividing it by the newer national quarter would bias build_mult
        # low by a quarter of wage growth, so treat it as missing instead
        if w and nat_wage and nat_wage[1] and w[0] == nat_wage[0]:
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
        # accept only 2-letter state suffixes: the open LIKE prefix would
        # otherwise sweep any future series family sharing the prefix
        # (e.g. eia_elec_ind_res_tx) into the parity table as a bogus state
        if st == "us" or len(st) != 2 or not st.isalpha():
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


def construction_block(saar: dict[str, float], nsa: dict[str, float],
                       build_index: dict[str, float]) -> dict | None:
    """Census C30 DC construction: nominal SAAR, real SAAR (constant 2018-01
    dollars via the DC Build deflator sampled at month-firsts), and NSA
    same-month YoY. Returns None when either series is absent from the store
    (pre-first-collect / test contexts) — never raises; the page hides the
    section. Month arithmetic, not the 365-day daily grid: this series never
    joins an index basket."""
    if not saar or not nsa:
        return None
    months = sorted(saar)
    real = []
    for m in months:
        deflator = build_index.get(m)
        real.append(None if deflator is None else saar[m] / (deflator / 100.0))
    nsa_last = max(nsa)
    base = nsa.get(f"{int(nsa_last[:4]) - 1}{nsa_last[4:]}")
    y2014 = [v for m, v in saar.items() if m.startswith("2014-")]
    latest = months[-1]
    return {"as_of": latest, "unit": "$M",
            "latest_saar": saar[latest],
            "yoy_pct": None if base is None else (nsa[nsa_last] / base - 1) * 100.0,
            "yoy_asof": nsa_last,
            "vs_2014_avg": (saar[latest] / (sum(y2014) / len(y2014))
                            if y2014 else None),
            "months": months,
            "saar": [saar[m] for m in months],
            "real": real}


def construction_from_store(conn: sqlite3.Connection, dc_result: dict) -> dict | None:
    """Store-driven wrapper (parity_from_store pattern): the two Census series
    plus the Build daily grid already computed in dc_result as the deflator."""
    return construction_block(
        _series(conn, "census_dc_constr_saar"),
        _series(conn, "census_dc_constr_nsa"),
        dc_result["indexes"]["build"]["index"])


def power_block(conn: sqlite3.Connection, dc_result: dict, cfg,
                basket_path: Path | None = None) -> dict | None:
    """DC Ops "power bill" panel (spec §5): latest obs for each configured
    wholesale hub + Henry Hub, plus the smoothed-tail config and the
    hand-seeded PJM capacity-auction rows. tail.active is the ops power
    component's mode, passed through from dc_result VERBATIM — never
    recomputed here, dc_result's engine run is the single source of truth.
    smooth_days/hubs describe the live splice tail (dc_basket config), which
    may differ from the wider hub list carried in cfg (e.g. ICE is
    panel-only, never a splice input). Returns None only when NO configured
    hub has any store rows yet (pre-backfill bootstrap) — Henry Hub alone
    having data is not enough, this is a wholesale-power panel."""
    hub_rows = []
    for h in cfg.hubs:
        row = _latest_row(conn, h.code)
        if row:
            hub_rows.append({"code": h.code, "label": h.label,
                             "latest": row[1], "asof": row[0], "unit": "$/MWh"})
    if not hub_rows:
        return None
    henry_row = _latest_row(conn, cfg.henry_hub.code)
    henry = None if not henry_row else {
        "code": cfg.henry_hub.code, "label": cfg.henry_hub.label,
        "latest": henry_row[1], "asof": henry_row[0], "unit": "$/MMBtu"}
    _, baskets = dc_basket.load_baskets(basket_path)
    power_comp = next(c for c in baskets["ops"] if c.code == "power")
    active = dc_result["indexes"]["ops"]["components"]["power"]["mode"] == "official+proxy"
    return {"tail": {"active": active,
                     "smooth_days": power_comp.live_proxy_smooth_days,
                     "hubs": list(power_comp.live_proxy_blend or ())},
           "hubs": hub_rows,
           "henry_hub": henry,
           "capacity_auction": cfg.capacity_auction}
