"""P3c -- do manufacturers' unfilled orders LEAD DC input prices?

This is a measurement, not a model. It publishes lead structure and nothing
downstream of it: no transfer coefficient, no elasticity, no forecast. Turning
a correlation into a price forecast requires an estimated elasticity, and
fitting one on this sample is precisely the overfit the gap register warns
about (spec 6).

The stability gate is stated here, in code, before any number is computed: a
lead counts only if the best lag agrees in sign and within +/-3 months across
both halves of the sample. Otherwise the finding is that backlogs do not
usefully lead these prices -- and that publishes as a negative result, the
same way the year-ratio power nowcast did.
"""
import sqlite3
from statistics import fmean, pstdev

from pipeline.dates import months_back
from pipeline.publish.util import yoy_pct
from pipeline.store import vintage

MAX_LAG = 24
MIN_OVERLAP = 36          # months; below this a correlation is noise
LAG_TOLERANCE = 3         # months of drift allowed between sample halves

# 0.45 of Build weight. Exact-or-near NAICS matches, at zero connector cost.
# concrete, constr_wages, elec_contractors and plumb_hvac_contractors (0.35 of
# weight) have no forward market of any kind and are out of scope.
MAPPINGS = [
    {"series": "fred_uo_electrical", "label": "Electrical equipment",
     "components": ["switchgear", "transformers"], "weight": 0.26},
    {"series": "fred_uo_hvac", "label": "Ventilation, heating & AC",
     "components": ["hvac_equip"], "weight": 0.10},
    {"series": "fred_uo_turbines", "label": "Turbines & generators",
     "components": ["generators"], "weight": 0.09},
]


def _yoy_series(obs: dict[str, float]) -> dict[str, float]:
    """{month: YoY %} -- seasonality cancels, so NSA inputs are safe."""
    return {m: y for m in obs if (y := yoy_pct(obs, m)) is not None}


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < MIN_OVERLAP:
        return None
    sx, sy = pstdev(xs), pstdev(ys)
    if not sx or not sy:
        return None
    mx, my = fmean(xs), fmean(ys)
    cov = fmean([(x - mx) * (y - my) for x, y in zip(xs, ys)])
    return cov / (sx * sy)


def correlate(driver_yoy: dict[str, float], target_yoy: dict[str, float],
              max_lag: int = MAX_LAG) -> list[tuple[int, float | None]]:
    """[(lag_months, correlation)] for lag in 0..max_lag.

    A positive lag means the driver LEADS: driver at month m-lag is paired
    with the target at month m."""
    out = []
    for lag in range(max_lag + 1):
        xs, ys = [], []
        for m, tv in sorted(target_yoy.items()):
            dv = driver_yoy.get(months_back(m, lag))
            if dv is not None:
                xs.append(dv)
                ys.append(tv)
        out.append((lag, _pearson(xs, ys)))
    return out


def stable(first_lag: int | None, second_lag: int | None,
           first_corr: float | None, second_corr: float | None) -> bool:
    """The gate, stated before the numbers exist.

    34 years of monthly data will produce SOME peak at SOME lag for any pair.
    A lead counts only if both halves agree in sign and the best lag drifts by
    no more than LAG_TOLERANCE months."""
    if first_lag is None or second_lag is None:
        return False
    if first_corr is None or second_corr is None:
        return False
    if (first_corr > 0) != (second_corr > 0):
        return False
    return abs(first_lag - second_lag) <= LAG_TOLERANCE


def _best(profile) -> tuple[int | None, float | None]:
    scored = [(lag, c) for lag, c in profile if c is not None]
    if not scored:
        return None, None
    lag, corr = max(scored, key=lambda p: abs(p[1]))
    return lag, round(corr, 3)


def study(conn: sqlite3.Connection, components, mappings=MAPPINGS) -> dict:
    """Per mapping: lead profile, best lag, and the split-half verdict."""
    by_code = {c.code: c for c in components}
    rows = []
    for m in mappings:
        driver = _yoy_series(dict(vintage.latest(conn, m["series"])))
        for comp_code in m["components"]:
            comp = by_code.get(comp_code)
            if comp is None:
                continue
            target = _yoy_series(dict(vintage.latest(conn, comp.series)))
            profile = correlate(driver, target)
            best_lag, best_corr = _best(profile)

            months = sorted(target)
            mid = months[len(months) // 2] if months else None
            first = correlate(driver, {k: v for k, v in target.items()
                                       if mid and k < mid})
            second = correlate(driver, {k: v for k, v in target.items()
                                        if mid and k >= mid})
            f_lag, f_corr = _best(first)
            s_lag, s_corr = _best(second)
            rows.append({
                "driver": m["series"], "driver_label": m["label"],
                "component": comp_code, "component_label": comp.label,
                "weight": comp.weight,
                "months": len(target),
                "span": [months[0][:7], months[-1][:7]] if months else [None, None],
                "best_lag_months": best_lag,
                "best_correlation": best_corr,
                "profile": [{"lag": lag, "corr": None if c is None else round(c, 3)}
                            for lag, c in profile],
                "first_half": {"best_lag_months": f_lag, "best_correlation": f_corr},
                "second_half": {"best_lag_months": s_lag, "best_correlation": s_corr},
                "stable": stable(f_lag, s_lag, f_corr, s_corr),
            })
    supported = [r for r in rows if r["stable"]]
    return {
        "mappings": rows,
        "weight_covered": round(sum(m["weight"] for m in mappings), 3),
        "weight_stable": round(sum(r["weight"] for r in supported), 3),
        "verdict": ("A stable lead was found for "
                    f"{len(supported)} of {len(rows)} mappings."
                    if supported else
                    "No mapping showed a lead stable across both halves of "
                    "the sample. Backlogs do not usefully lead these prices, "
                    "and no forward model is warranted on this evidence."),
        "gate": ("A lead counts only if the best lag agrees in sign and "
                 f"within {LAG_TOLERANCE} months across both sample halves. "
                 "Stated before the numbers were computed."),
    }
