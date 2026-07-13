"""Versioned 12-month component-level inflation outlook.

The outlook is deliberately deterministic and source-transparent.  It rolls
the existing 14 gauge component levels forward; it never refetches data and
never substitutes a missing forward driver with a zero shock.
"""
from __future__ import annotations

import json
import math
import statistics
from datetime import date
from pathlib import Path

from pipeline.dates import month_first, months_back, next_month, prior_month
from pipeline.store import vintage

DEFAULT_CONFIG = Path(__file__).parent.parent.parent / "config" / "outlook.json"


def _month_values(rows, through_month: str | None = None) -> dict[str, float]:
    """Last observation in each complete month, keyed YYYY-MM."""
    out: dict[str, tuple[str, float]] = {}
    for obs_date, value in rows:
        month = obs_date[:7]
        if through_month is not None and month > through_month:
            continue
        if month not in out or obs_date >= out[month][0]:
            out[month] = (obs_date, float(value))
    return {month: pair[1] for month, pair in sorted(out.items())}


def _month_asof(rows, through_month: str) -> str | None:
    dates = [d for d, _ in rows if d[:7] <= through_month]
    return max(dates) if dates else None


def _adjacent_changes(levels: dict[str, float]) -> list[tuple[str, float]]:
    out = []
    for month, value in levels.items():
        prior = prior_month(f"{month}-01")[:7]
        base = levels.get(prior)
        if base not in (None, 0):
            out.append((month, (value / base - 1) * 100))
    return out


def _median_mom(levels: dict[str, float], window: int, fallback: float = 0.0) -> float:
    changes = [value for _, value in _adjacent_changes(levels)[-window:]]
    return statistics.median(changes) if changes else fallback


def _lookback_return(rows, through_month: str, lookback_months: int) -> tuple[float | None, str | None]:
    levels = _month_values(rows, through_month)
    if not levels:
        return None, None
    end_month = max(levels)
    start_month = months_back(f"{end_month}-01", lookback_months)[:7]
    if start_month not in levels or levels[start_month] == 0:
        return None, end_month
    return (levels[end_month] / levels[start_month] - 1) * 100, end_month


def _fresh_series(rows, code: str, staleness: dict[str, int] | None,
                  today: str | None) -> bool:
    """A stale driver series must not produce a forward shock: its months-old
    move already passed through actual CPI, and _lookback_return anchors at
    the series' own last month, so it would be re-applied as if it just
    happened (published 'live'). Gate on the registry's max_staleness_days;
    with no gating context (unit tests, unregistered code) treat as fresh."""
    if staleness is None or today is None:
        return True
    limit = staleness.get(code)
    if limit is None:
        return True
    last = max((obs_date for obs_date, _ in rows), default=None)
    if last is None:
        return False
    return (date.fromisoformat(today) - date.fromisoformat(last)).days <= limit


def _weighted_signal(conn, series_weights: dict[str, float], through_month: str,
                     lookback_months: int, staleness: dict[str, int] | None = None,
                     today: str | None = None) -> tuple[float | None, list[str], str | None]:
    available: list[tuple[str, float, float, str | None]] = []
    for code, weight in series_weights.items():
        rows = vintage.latest(conn, code)
        if not _fresh_series(rows, code, staleness, today):
            continue
        value, _ = _lookback_return(rows, through_month, lookback_months)
        if value is not None:
            available.append((code, weight, value, _month_asof(rows, through_month)))
    if not available:
        return None, [], None
    total = sum(weight for _, weight, _, _ in available)
    signal = sum(weight * value for _, weight, value, _ in available) / total
    asof = max((date for *_, date in available if date is not None), default=None)
    return signal, [code for code, *_ in available], asof


def _equal_signal(conn, codes: list[str], through_month: str,
                  lookback_months: int, staleness: dict[str, int] | None = None,
                  today: str | None = None) -> tuple[float | None, list[str], str | None]:
    return _weighted_signal(conn, {code: 1.0 for code in codes},
                            through_month, lookback_months, staleness, today)


def _distributed_return(total_return_pct: float, months: int) -> float:
    # A bad upstream price can never turn a component level negative.
    bounded = max(total_return_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / months) - 1) * 100


def _annualized(return_pct: float, months: int) -> float:
    bounded = max(return_pct, -95.0)
    return ((1 + bounded / 100) ** (12 / months) - 1) * 100


def _monthly_from_annual(annual_pct: float) -> float:
    bounded = max(annual_pct, -95.0)
    return ((1 + bounded / 100) ** (1 / 12) - 1) * 100


def _blend_label(series_weights: dict[str, float], used: list[str],
                 display: dict[str, str]) -> str:
    # Label the composition that actually produced the number: a missing leg
    # renormalizes the rest, so the configured 60/40 must not be claimed when
    # only one series had data. With nothing available (fallback), show the
    # configured composition.
    subset = {code: series_weights[code] for code in used} or series_weights
    total = sum(subset.values())
    return " / ".join(f"{display.get(code, code)} {round(100 * weight / total)}%"
                      for code, weight in subset.items())


def _driver(key: str, name: str, value: float | None, unit: str,
            as_of: str | None, status: str, effect: str,
            sources: list[str]) -> dict:
    reading = "fallback" if value is None else f"{value:+.2f}{unit}"
    return {"key": key, "name": name, "value": None if value is None else round(value, 4),
            "unit": unit, "reading": reading, "as_of": as_of,
            "status": status, "effect": effect, "sources": sources}


def _status(found: int, expected: int) -> str:
    if found == 0:
        return "fallback"
    return "live" if found == expected else "partial"


def _component_trend_levels(component: dict, origin_month: str) -> dict[str, float]:
    # Trend estimation must stop at the component's own last real observation:
    # past it the daily grid is pure forward-fill, so every adjacent-month
    # "change" is a fabricated 0.0 that drags the trailing median toward zero
    # (the same like-month rule behind the gauge's own component YoY).
    last_real_month = component["last_obs"][:7]
    return _month_values(component["daily_index"].items(),
                         min(origin_month, last_real_month))


def _headline_monthly(index: dict[str, float], origin_month: str) -> dict[str, float]:
    return _month_values(index.items(), origin_month)


def run(conn, gauge_result: dict, config_path: Path | None = None,
        staleness: dict[str, int] | None = None, today: str | None = None) -> dict:
    config = json.loads((config_path or DEFAULT_CONFIG).read_text())
    variant = gauge_result["variants"]["gauge"]
    as_of = variant["as_of"]
    origin_month = prior_month(month_first(as_of))[:7]
    headline = _headline_monthly(variant["index"], origin_month)
    if origin_month not in headline:
        raise ValueError(f"outlook: no complete-month gauge level for {origin_month}")

    horizon = int(config["horizon_months"])
    neutral_mom = _monthly_from_annual(float(config["baseline_annual_pct"]))
    trailing_window = int(config["trailing_median_months"])
    component_levels = {
        code: _month_values(component["daily_index"].items(), origin_month)
        for code, component in variant["components"].items()
    }
    # Base rates come from real observations only (see _component_trend_levels);
    # a component with no computable change gets the neutral baseline drift, not
    # frozen prices, and the cap keeps a spiky NSA window (winter utility gas)
    # from being annualized into an implausible year-long path.
    trend_cap = float(config["component_trend_annual_cap_pct"])
    cap_low, cap_high = _monthly_from_annual(-trend_cap), _monthly_from_annual(trend_cap)
    base_mom = {
        code: min(cap_high, max(cap_low, _median_mom(
            _component_trend_levels(component, origin_month), trailing_window,
            fallback=neutral_mom)))
        for code, component in variant["components"].items()
    }

    # Forward drivers. Every unavailable value remains None and is disclosed;
    # component paths then use their own trailing median.
    fuel_cfg = config["fuel"]
    fuel_value, fuel_sources, fuel_asof = _weighted_signal(
        conn, fuel_cfg["series"], origin_month, fuel_cfg["lookback_months"],
        staleness, today)

    food_cfg = config["food_home"]
    food_value, food_sources, food_asof = _equal_signal(
        conn, food_cfg["series"], origin_month, food_cfg["lookback_months"],
        staleness, today)

    gas_cfg = config["nat_gas"]
    gas_rows = vintage.latest(conn, gas_cfg["series"])
    gas_value = None
    if _fresh_series(gas_rows, gas_cfg["series"], staleness, today):
        gas_value, _ = _lookback_return(gas_rows, origin_month, gas_cfg["lookback_months"])
    gas_asof = _month_asof(gas_rows, origin_month)

    used_cfg = config["used_vehicles"]
    used_rows = vintage.latest(conn, used_cfg["series"])
    used_value = None
    if _fresh_series(used_rows, used_cfg["series"], staleness, today):
        used_value, _ = _lookback_return(used_rows, origin_month, used_cfg["lookback_months"])
    used_asof = _month_asof(used_rows, origin_month)

    wage_cfg = config["wages"]
    wage_rows = vintage.latest(conn, wage_cfg["series"])
    wage_value = None
    if _fresh_series(wage_rows, wage_cfg["series"], staleness, today):
        wage_months = _month_values(wage_rows, origin_month)
        wage_value = wage_months[max(wage_months)] if wage_months else None
    wage_asof = _month_asof(wage_rows, origin_month)

    pipe_cfg = config["goods_pipeline"]
    pipe_values, pipe_sources, pipe_dates = [], [], []
    for code in pipe_cfg["series"]:
        rows = vintage.latest(conn, code)
        if not _fresh_series(rows, code, staleness, today):
            continue
        value, _ = _lookback_return(rows, origin_month, pipe_cfg["lookback_months"])
        if value is not None:
            pipe_values.append(_annualized(value, pipe_cfg["lookback_months"]))
            pipe_sources.append(code)
            date = _month_asof(rows, origin_month)
            if date:
                pipe_dates.append(date)
    pipeline_tilt = None
    if pipe_values:
        raw = (statistics.median(pipe_values) - config["baseline_annual_pct"]) * pipe_cfg["strength"]
        pipeline_tilt = max(-pipe_cfg["annual_cap_pp"], min(pipe_cfg["annual_cap_pp"], raw))
    pipeline_asof = max(pipe_dates) if pipe_dates else None

    rent_dates = [_month_asof(vintage.latest(conn, code), origin_month)
                  for code in ("zori_us", "aptlist_us")]
    rent_asof = max((date for date in rent_dates if date is not None), default=None)

    # Every numeric claim in a driver name/effect interpolates the config knob
    # that drives the math — a tuned knob must never leave a stale receipt.
    fuel_label = _blend_label(fuel_cfg["series"], fuel_sources,
                              {"fmp_rbob": "RBOB", "fmp_wti": "WTI"})
    drivers = [
        _driver("fuel", f"Fuel futures ({fuel_label}, {fuel_cfg['lookback_months']}mo)",
                fuel_value, "%", fuel_asof,
                _status(len(fuel_sources), len(fuel_cfg["series"])),
                f"{fuel_cfg['pass_through']:.0%} pass-through over "
                f"{fuel_cfg['horizon_months']} months, then flat", fuel_sources),
        _driver("shelter", f"New-lease rents (ZORI + Apartment List, {trailing_window}mo median)",
                base_mom.get("shelter_rent"), "%/mo", rent_asof,
                "live" if rent_asof else "fallback",
                f"drives rent and CPI-comparable OER; "
                f"{config['shelter_half_life_months']}-month half-life",
                ["zori_us", "aptlist_us"]),
        _driver("food_home", f"Agricultural futures composite "
                f"({len(food_cfg['series'])} contracts, {food_cfg['lookback_months']}mo)",
                food_value, "%", food_asof,
                _status(len(food_sources), len(food_cfg["series"])),
                f"{food_cfg['pass_through']:.0%} farm-share pass-through over "
                f"{food_cfg['horizon_months']} months", food_sources),
        _driver("nat_gas", f"Henry Hub natural gas ({gas_cfg['lookback_months']}mo)",
                gas_value, "%", gas_asof,
                "live" if gas_value is not None else "fallback",
                f"{gas_cfg['pass_through']:.0%} pass-through into utility rates "
                f"in months {gas_cfg['start_month']}–{gas_cfg['end_month']}",
                [gas_cfg["series"]] if gas_value is not None else []),
        _driver("used_vehicles", f"Manheim used wholesale ({used_cfg['lookback_months']}mo)",
                used_value, "%", used_asof,
                "live" if used_value is not None else "fallback",
                f"{used_cfg['pass_through']:.0%} retail pass-through over "
                f"{used_cfg['horizon_months']} months",
                [used_cfg["series"]] if used_value is not None else []),
        _driver("new_vehicles", "New vehicles (own complete-month trend)",
                base_mom.get("new_vehicles"), "%/mo", origin_month + "-01", "fallback",
                "KBB ATP is not yet a stable production input", ["CUUR0000SETA01"]),
        _driver("wages", "Atlanta Fed wage growth", wage_value, "%/yr", wage_asof,
                "live" if wage_value is not None else "fallback",
                f"{wage_cfg['anchor_weight']:.0%} terminal anchor for food-away "
                f"and sticky services",
                [wage_cfg["series"]] if wage_value is not None else []),
        _driver("goods_pipeline", f"Ex-energy pipeline (PPI + imports, "
                f"{pipe_cfg['strength']:g}× strength)",
                pipeline_tilt, "pp/yr", pipeline_asof,
                _status(len(pipe_sources), len(pipe_cfg["series"])),
                f"tilt capped at ±{pipe_cfg['annual_cap_pp']:g}pp/yr on "
                f"{', '.join(pipe_cfg['components'])}", pipe_sources),
    ]

    driver_scores = {"live": 1.0, "partial": 0.5, "fallback": 0.0}
    driver_coverage = 100 * sum(driver_scores[d["status"]] for d in drivers) / len(drivers)

    component_moms: dict[str, list[float]] = {}
    shelter_codes = {"shelter_rent", "shelter_owned"}
    service_codes = set(wage_cfg["service_components"])
    goods_codes = set(pipe_cfg["components"])
    for code in component_levels:
        own = base_mom[code]
        path = [own] * horizon
        if code in shelter_codes:
            half_life = config["shelter_half_life_months"]
            # (h + 1): forecast month 1 already decays one step, so the excess
            # over neutral actually halves at the disclosed half-life month
            # (the wage ramp below indexes months the same way).
            path = [neutral_mom + (own - neutral_mom) * 0.5 ** ((h + 1) / half_life)
                    for h in range(horizon)]
        elif code == "fuel" and fuel_value is not None:
            shock = _distributed_return(fuel_value * fuel_cfg["pass_through"],
                                        fuel_cfg["horizon_months"])
            path = [shock if h < fuel_cfg["horizon_months"] else 0.0
                    for h in range(horizon)]
        elif code == "food_home" and food_value is not None:
            shock = _distributed_return(food_value * food_cfg["pass_through"],
                                        food_cfg["horizon_months"])
            path = [own + (shock if h < food_cfg["horizon_months"] else 0.0)
                    for h in range(horizon)]
        elif code == "nat_gas" and gas_value is not None:
            count = gas_cfg["end_month"] - gas_cfg["start_month"] + 1
            shock = _distributed_return(gas_value * gas_cfg["pass_through"], count)
            path = [own + (shock if gas_cfg["start_month"] <= h + 1 <= gas_cfg["end_month"] else 0.0)
                    for h in range(horizon)]
        elif code == "used_vehicles" and used_value is not None:
            shock = _distributed_return(used_value * used_cfg["pass_through"],
                                        used_cfg["horizon_months"])
            path = [own + (shock if h < used_cfg["horizon_months"] else 0.0)
                    for h in range(horizon)]

        if code in service_codes and wage_value is not None:
            own_annual = (1 + own / 100) ** 12 * 100 - 100
            target_annual = ((1 - wage_cfg["anchor_weight"]) * own_annual
                             + wage_cfg["anchor_weight"] * wage_value)
            target_monthly = _monthly_from_annual(target_annual)
            path = [value + (target_monthly - own) * ((h + 1) / horizon)
                    for h, value in enumerate(path)]
        if code in goods_codes and pipeline_tilt is not None:
            path = [value + _monthly_from_annual(pipeline_tilt) for value in path]
        component_moms[code] = path

    weights = {code: component["weight"] for code, component in variant["components"].items()}
    total_weight = sum(weights.values())
    current_levels = {code: levels[origin_month] for code, levels in component_levels.items()}
    nonpositive = [code for code, level in current_levels.items()
                   if not math.isfinite(level) or level <= 0]
    if nonpositive:
        raise ValueError("outlook: non-positive component anchor — " + ", ".join(nonpositive))
    component_paths = {code: [] for code in current_levels}
    previous_headline = headline[origin_month]
    forecast = []
    future_month = next_month(f"{origin_month}-01")
    for h in range(1, horizon + 1):
        month = future_month[:7]
        for code in current_levels:
            mom = component_moms[code][h - 1]
            current_levels[code] *= 1 + mom / 100
            component_paths[code].append({"month": month, "mom_pct": round(mom, 4),
                                          "index": round(current_levels[code], 6)})
        level = sum(weights[code] * current_levels[code] for code in current_levels) / total_weight
        base_month = months_back(future_month, 12)[:7]
        if base_month not in headline:
            raise ValueError(f"outlook: missing actual base level for {base_month}")
        central = (level / headline[base_month] - 1) * 100
        mom = (level / previous_headline - 1) * 100
        forecast.append({"month": month, "central_yoy_pct": central, "mom_pct": mom})
        previous_headline = level
        future_month = next_month(future_month)

    actual_yoy = []
    for month, level in headline.items():
        base = headline.get(months_back(f"{month}-01", 12)[:7])
        if base:
            actual_yoy.append((month, (level / base - 1) * 100))
    if not actual_yoy:
        raise ValueError("outlook: gauge history has fewer than 13 complete months — "
                         "no actual YoY to anchor the outlook")
    history = actual_yoy[-int(config["history_months"]):]
    vol_levels = actual_yoy[-(int(config["volatility_lookback_months"]) + 1):]
    diffs = [b[1] - a[1] for a, b in zip(vol_levels, vol_levels[1:])]
    realized = len(diffs) >= 12
    sigma = statistics.stdev(diffs) if realized else float(config["volatility_fallback_pp"])

    for h, row in enumerate(forecast, 1):
        width = sigma * math.sqrt(h)
        row["central_yoy_pct"] = round(row["central_yoy_pct"], 2)
        row["mom_pct"] = round(row["mom_pct"], 3)
        row["low_yoy_pct"] = round(row["central_yoy_pct"] - width, 2)
        row["high_yoy_pct"] = round(row["central_yoy_pct"] + width, 2)

    baseline = []
    baseline_level = headline[origin_month]
    future_month = next_month(f"{origin_month}-01")
    for _ in range(horizon):
        month = future_month[:7]
        baseline_level *= 1 + neutral_mom / 100
        base_month = months_back(future_month, 12)[:7]
        baseline.append({"month": month,
                         "yoy_pct": round((baseline_level / headline[base_month] - 1) * 100, 2)})
        future_month = next_month(future_month)

    return {
        "model": config["model"], "as_of": as_of,
        "origin_month": origin_month, "horizon_months": horizon,
        "latest_complete_month_yoy_pct": round(actual_yoy[-1][1], 2),
        "history": [{"month": month, "yoy_pct": round(value, 2)} for month, value in history],
        "forecast": forecast, "base_effects_only": baseline,
        "sigma_monthly_pp": round(sigma, 4),
        # 0 = the configured fallback sigma, not a stdev over some tiny window
        "sigma_window_months": len(diffs) if realized else 0,
        "driver_coverage_pct": round(driver_coverage, 1),
        "drivers": drivers, "component_paths": component_paths,
        "parameters": config,
        "method": (f"Each of the 14 gauge components receives a {horizon}-month path from forward "
                   f"drivers or the {trailing_window}-month median of its own real complete-month "
                   f"changes (stopped at its last observation, capped at ±{trend_cap:g}%/yr). "
                   "Component index levels are CPI-weighted; YoY uses actual year-ago levels, "
                   "so base effects are exact."),
        "disclaimer": ("Model projection, not a promise or investment advice. The shaded range is a "
                       "realized-volatility band, not a calibrated confidence interval."),
    }
