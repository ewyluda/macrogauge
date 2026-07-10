"""Gauge engine orchestrator: store -> five stages -> per-variant results."""
import sqlite3
from datetime import date
from pathlib import Path

from pipeline import basket as basket_mod
from pipeline.engine import aggregate, gate, variants
from pipeline.engine import blend as blend_mod
from pipeline.engine import payment as payment_mod
from pipeline.store import vintage

GRID_START = "2017-01-01"    # internal grid start: feeds 365d YoY bases for 2018
PUBLISH_START = "2018-01-01"  # writers publish from here
ENGINE_VERSION = "1.0"           # bumped on methodology-changing engine math


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
    supercore = basket_mod.load_supercore_components(basket_path)
    payment_series: dict[str, float] | None = None
    out = {}
    for variant in variants.VARIANTS:
        # supercore iterates a renormalized subset; every other variant
        # (including pce) iterates all 14 components. Which weight a
        # component carries is also variant-dependent: pce uses the
        # hand-seeded BEA-share weight, everything else the BLS weight.
        comps_v = [c for c in comps
                   if variant != "supercore" or c.code in supercore]
        weights = {c.code: (c.pce_weight if variant == "pce" else c.weight)
                   for c in comps_v}
        built, modes, flags = {}, {}, []
        official_rebased = {}
        for comp in comps_v:
            official_series = _series(conn, comp.official_series)
            live_sources = ({name: blend_mod.shift_days(
                                 _series(conn, name),
                                 (comp.lead_days or {}).get(name, 0))
                             for name in comp.live_blend}
                            if comp.live_blend else {})
            # col's shelter_owned rides the marginal-buyer payment index
            # (spec §5) instead of the market-rent blend; every other
            # component/variant combination uses the component's configured
            # blend (live_blend stays None -> build_component's default).
            live_blend = None
            if variant == "col" and comp.code == "shelter_owned":
                if payment_series is None:
                    zhvi = _series(conn, "zhvi_us")
                    rate = {**_series(conn, "pmms_30yr"),
                            **_series(conn, "mnd_30y_d")}
                    payment_series = payment_mod.payment_index(zhvi, rate)
                if payment_series:
                    live_sources = {"col_payment": payment_series}
                    live_blend = {"col_payment": 1.0}
                # else: no ZHVI/rate data yet -- fall through to shelter_owned's
                # configured market-rent blend (or bls_cf if that's absent too).
            idx, mode, official_idx = variants.build_component(
                comp, variant, official_series, live_sources, live_blend)
            if mode == "live":
                last = max(idx)
                arrived = _arrived_today(conn, list(comp.live_blend), last, today)
                idx, flagged = gate.apply_gate(idx, arrived)
                if flagged:
                    flags.append(f"{comp.code}@{last}")
            built[comp.code], modes[comp.code] = idx, mode
            official_rebased[comp.code] = official_idx
        end = min(max(max(c) for c in built.values()), today)
        daily = {k: aggregate.fill_daily(c, GRID_START, end)
                 for k, c in built.items()}
        official_daily = {k: aggregate.fill_daily(v, GRID_START, end)
                          for k, v in official_rebased.items()}
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
        official_own_yoy = {}
        for code, off_idx in official_rebased.items():
            filled = aggregate.yoy(official_daily[code])
            at_obs = {d: filled[d] for d in off_idx if d in filled}
            official_own_yoy[code] = aggregate.fill_yoy(at_obs, GRID_START, end)
        # coverage renormalizes over the variant's own weights -- supercore's
        # subset weights don't sum to 1 (they're a slice of the full basket).
        total_w = sum(weights.values())
        coverage = sum(weights[c.code] for c in comps_v
                       if modes[c.code] == "live"
                       and _fresh(conn, c.live_blend, staleness, today)) / total_w
        components = {}
        for c in comps_v:
            own_end = max(d for d in built[c.code] if d <= end)
            # this component's own last-observation date AT OR BEFORE the
            # clamped grid end, not the grid end itself -- lagging components
            # (e.g. EIA natgas, CPI) must compare like-month-to-like-month on
            # their own filled daily series, never a forward-filled value
            # against a different-month base a year ago. Clamping to `end`
            # also excludes lead-shifted observations that land beyond
            # today's `end` (a +30d shift can push a component's latest
            # engine-view date past today) -- those stay in `built` and enter
            # the grid naturally as later runs' `today` catches up.
            components[c.code] = {
                "weight": weights[c.code], "mode": modes[c.code],
                "yoy_pct": own_yoy[c.code].get(own_end),
                "end_value": daily[c.code][end],  # end_value stays at grid end; QA uses it
                "daily_index": daily[c.code],
                "official_daily_index": official_daily[c.code],
                "own_yoy_daily": own_yoy[c.code],
                "official_own_yoy_daily": official_own_yoy[c.code]}
        out[variant] = {
            "index": index, "yoy": aggregate.weighted_yoy(own_yoy, weights),
            "as_of": end, "coverage_pct": coverage * 100, "gate_flags": flags,
            "components": components}
    return {"base_month": base_month, "variants": out}
