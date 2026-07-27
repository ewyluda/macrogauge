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

A POSITIVE result never publishes bare (spec 6.1). `study()` returns
`caveats` (a `[{key, text}, ...]` list -- structured data, not prose buried
inside `verdict`, so a consumer can render them without parsing English) and
`conclusion` (the standing finding that no forward model is warranted on this
evidence) alongside `verdict`. Two reasons drive the caveats, both measured,
not assumed: (a) the one mapping that has ever cleared this gate recovers a
0-2 month lag -- contemporaneous, not a lead, and this study exists to decide
whether a forward model is buildable at 12-48 month horizons; (b) that
mapping's stability is itself a split-sample-midpoint artifact -- deepening
the target history moved the split point and folded a genuine sub-period
disagreement out of view rather than resolving it. The gate is deliberately
NOT strengthened in response: tuning a pre-registered test after it produces
a positive is the failure mode stating the gate up front exists to prevent.
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

# --- Caveats and the standing conclusion (spec 6.1) -----------------------
#
# Measured 2026-07-26: on the deep (402-month) sample 1 of 4 mappings clears
# the gate (U35CUO -> transformers, weight 0.12). That "1 of 4" is dangerous
# published bare, for two reasons that were MEASURED, not guessed -- and both
# must travel with any positive gate result everywhere it is rendered, as
# structured fields a consumer can render without parsing English, not a
# footnote a reader can skip.

# (a) is re-derivable from THIS run's own numbers, per mapping: a lag inside
# this window is contemporaneous by definition, and this study exists to
# decide whether a forward model is buildable at 12-48 MONTH horizons -- a
# same-month correlation cannot support that at any gate strictness, and is
# equally consistent with both series reacting to a shared shock (a
# commodity input cost, a supply-chain disruption) as with genuine
# backlog-to-price transmission.
CONTEMPORANEOUS_LAG_MAX = 2  # months; spec 6.1(a)'s measured 0-2mo finding

# (b) is NOT re-derivable from a single sample -- it required re-running the
# SAME gate at two sample depths and comparing which mappings crossed it.
# That comparison was made once, by hand, 2026-07-26 (spec 6.1(b)): on a
# shallower 222-month sample (targets at store depth) the split midpoint fell
# near 2017-03 and the study's one currently-stable pairing FAILED the gate
# there -- its two halves genuinely disagreed (2008-2017 peaked at lag 24
# months, r=0.327; 2017-2026 at lag 0, r=0.784). Backfilling the same targets
# to 1992 (402 months) moved the midpoint to roughly 2009-09, folding that
# entire disagreement inside ONE half where the gate no longer exercises it
# -- the specific instability was moved out of view, not resolved. The gate
# was deliberately NOT strengthened after seeing this: a sub-period
# robustness check would catch the artifact, but adding one now -- after the
# pre-registered test produced a positive -- would be tuning the instrument
# to the answer, the exact failure mode stating the gate up front exists to
# prevent. This is a measured historical fact about the METHOD, hardcoded
# with its reasoning exactly the way dcgrade.REVISION_DISCLOSURE_PP is, not a
# live computation -- there is no second sample depth available at runtime
# to re-derive it from.
_SPLIT_ARTIFACT_CAVEAT = (
    "A positive result under this gate is not guaranteed stable to where the "
    "sample happens to be split in half. Measured 2026-07-26: on a shallower "
    "222-month sample the split midpoint fell near 2017-03 and this study's "
    "one currently-stable pairing FAILED the gate there -- its two halves "
    "genuinely disagreed (2008-2017 peaked at lag 24 months, r=0.327; "
    "2017-2026 at lag 0, r=0.784). Deepening the sample to 1992 (402 months) "
    "moved the midpoint to roughly 2009-09, folding that entire disagreement "
    "inside one half where the gate no longer exercises it. The instability "
    "was moved out of view, not resolved -- and the gate was deliberately "
    "NOT strengthened after seeing this, because tuning a pre-registered "
    "test after it produces a positive is the exact failure mode stating it "
    "up front exists to prevent.")

# Independent of the literal gate outcome: one near-contemporaneous
# correlation (or none at all) covering at most 0.45 of Build weight is not
# a forecasting input. Published unconditionally, the same way the negative
# branch of `verdict` below already states it.
_NO_FORWARD_MODEL_CONCLUSION = "No forward model is warranted on this evidence."


def _caveats(supported: list[dict]) -> list[dict]:
    """Structured {key, text} caveats for a positive gate result.

    Deliberately structured data, not prose buried inside `verdict` -- a page
    that renders `weight_stable` without these misleads (spec 6.1). Empty
    when no mapping cleared the gate: there is no positive result to caveat,
    and the negative branch of `verdict` already states the standing
    conclusion in full."""
    out = []
    # ONE entry, however many mappings qualify. Keys are identity here: a
    # consumer keys a rendered list on them (the site does), and two entries
    # sharing "contemporaneous_not_lead" would be a duplicate key plus a
    # paragraph repeated verbatim but for the pairing name. Latent while
    # exactly one mapping clears the gate -- but the gate is re-run every
    # publish and nothing pins that count, so the list is built to hold any
    # number from the start.
    near = [r for r in supported
            if r["best_lag_months"] is not None
            and abs(r["best_lag_months"]) <= CONTEMPORANEOUS_LAG_MAX]
    if near:
        pairs = "; ".join(
            f"{r['driver_label']} -> {r['component_label']} at "
            f"{r['best_lag_months']} month(s)" for r in near)
        out.append({
            "key": "contemporaneous_not_lead",
            "text": (
                f"The recovered best lag is contemporaneous, not a lead "
                f"({pairs}). This study exists to decide whether a forward "
                "model is buildable at 12-48 month horizons; a same-month "
                "correlation cannot support that at any gate strictness, and "
                "is equally consistent with both series reacting to a shared "
                "shock as with backlog-to-price transmission.")})
    if supported:
        out.append({"key": "split_artifact", "text": _SPLIT_ARTIFACT_CAVEAT})
    return out


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
        # A positive branch here must not read as an unqualified endorsement
        # -- it points at `caveats` rather than asserting a conclusion the
        # caveats then have to walk back (spec 6.1).
        "verdict": (f"A stable lead was found for {len(supported)} of "
                    f"{len(rows)} mappings by the pre-registered gate -- see "
                    "caveats before treating this as forecasting evidence."
                    if supported else
                    "No mapping showed a lead stable across both halves of "
                    "the sample. Backlogs do not usefully lead these prices, "
                    "and no forward model is warranted on this evidence."),
        "gate": ("A lead counts only if the best lag agrees in sign and "
                 f"within {LAG_TOLERANCE} months across both sample halves. "
                 "Stated before the numbers were computed."),
        "caveats": _caveats(supported),
        "conclusion": _NO_FORWARD_MODEL_CONCLUSION,
    }
