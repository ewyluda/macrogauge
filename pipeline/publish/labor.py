"""Writer for labor.json — jobs-market dashboard (payrolls, unemployment, claims, wages).

Pure store -> writer (the real_wages/geo pattern): display-only, never touches the gauge
engine. Own-obs like-month YoY where computed (null if base absent or zero). Unemployment
reports a percentage-point change (delta_1y_pp), not a percent change. The NFP nowcast and
graded accountability are already published (nowcast_latest.json / accountability_nfp.json)
and are NOT duplicated here — the page imports them directly. Missing data publishes null
blocks: a new writer must never be able to take down the publish block.
"""
from pathlib import Path

from pipeline.dates import months_back, prior_month
from pipeline.publish.real_wages import AHE, CONSTR, WGT
from pipeline.publish.util import write_json, yoy_pct
from pipeline.store import vintage

PAYEMS = "PAYEMS"
UNRATE = "UNRATE"
ICSA = "ICSA"
CCSA = "CCSA"
# construction band: the trades a data-center build competes for (headcount,
# pay against all private workers, JOLTS openings); CONSTR is the AHE series
CONS_EMP, CONS_OPEN, CONS_OPEN_RATE = "USCONS", "JTS2300JOL", "JTS2300JOR"
# production and nonsupervisory employees: the craft workforce, working
# supervisors included; all employees less these is the non-craft staff
CONS_PROD = "CES2000000006"
# average weekly earnings, all employees (from 2006-03) and craft: payroll =
# headcount x weekly earnings, BLS's own aggregate-payroll construction
CONS_AWE, CONS_PROD_AWE = "CES2000000011", "CES2000000030"
MIX_START = "1990-01-01"  # scripts/backfill_construction_mix.py seeds from here
# wage series codes are shared with the real-wages writer — one definition
MONTHLY_TAIL = 36
WEEKLY_TAIL = 52


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _payrolls(payems):
    if not payems:
        return {"level_k": None, "mom_change_k": None, "yoy_pct": None, "as_of": None}
    as_of = max(payems)
    prior = payems.get(prior_month(as_of))
    return {"level_k": round(payems[as_of]),
            "mom_change_k": None if prior is None else round(payems[as_of] - prior),
            "yoy_pct": yoy_pct(payems, as_of),
            "as_of": as_of}


def _unemployment(unrate):
    if not unrate:
        return {"rate": None, "delta_1y_pp": None, "as_of": None}
    as_of = max(unrate)
    base = unrate.get(months_back(as_of, 12))
    return {"rate": round(unrate[as_of], 1),
            "delta_1y_pp": None if base is None else round(unrate[as_of] - base, 2),
            "as_of": as_of}


def _claims(icsa, ccsa):
    initial = avg = i_as_of = continued = c_as_of = None
    if icsa:
        weeks = sorted(icsa)
        i_as_of = weeks[-1]
        initial = round(icsa[i_as_of])
        last4 = weeks[-4:]
        avg = round(sum(icsa[w] for w in last4) / len(last4))
    if ccsa:
        c_as_of = max(ccsa)
        continued = round(ccsa[c_as_of])
    as_of = max([d for d in (i_as_of, c_as_of) if d], default=None)
    return {"initial": initial, "initial_4wk_avg": avg,
            "continued": continued, "as_of": as_of}


def _wages(ahe, wgt):
    ahe_yoy = wgt_pct = None
    as_ofs = []
    if ahe:
        a = max(ahe)
        ahe_yoy = yoy_pct(ahe, a)
        as_ofs.append(a)
    if wgt:
        w = max(wgt)
        wgt_pct = round(wgt[w], 2)
        as_ofs.append(w)
    return {"ahe_yoy_pct": ahe_yoy, "atlanta_wgt_pct": wgt_pct,
            "as_of": max(as_ofs) if as_ofs else None}


def _construction(emp, c_ahe, ahe, openings, rate):
    jobs = _payrolls(emp)
    w = max(c_ahe) if c_ahe else None
    o = max(openings) if openings else None
    base = None if o is None else openings.get(months_back(o, 12))
    return {"employment_k": jobs["level_k"], "mom_change_k": jobs["mom_change_k"],
            "employment_yoy_pct": jobs["yoy_pct"], "employment_as_of": jobs["as_of"],
            "ahe": None if w is None else round(c_ahe[w], 2),
            "ahe_yoy_pct": None if w is None else yoy_pct(c_ahe, w),
            # all-private AHE at the construction series' own month: like months
            "private_ahe_yoy_pct": None if w is None else yoy_pct(ahe, w),
            "ahe_as_of": w,
            "openings_k": None if o is None else round(openings[o]),
            "openings_1y_ago_k": None if base is None else round(base),
            "openings_rate": None if o is None or o not in rate else round(rate[o], 1),
            "openings_as_of": o}


def _construction_mix(emp, prod, awe, prod_awe):
    """Non-craft share of construction jobs: managers, project managers,
    estimators, engineers and office staff, as all employees less production
    and nonsupervisory employees. Monthly from MIX_START over months both
    series report. The payroll share prices each group at its weekly
    earnings; null in months without both (all-employee earnings start
    2006-03)."""
    months = sorted(m for m in emp if m in prod and m >= MIX_START)
    noncraft = [emp[m] - prod[m] for m in months]
    share = [round(100 * n / emp[m], 2) for n, m in zip(noncraft, months)]
    a = months[-1] if months else None
    base = None if a is None else months_back(a, 12)

    def pay(m):  # (non-craft share of payroll %, non-craft pay / craft pay)
        total, craft = emp[m] * awe[m], prod[m] * prod_awe[m]
        heads = emp[m] - prod[m]  # 0 only in fakes, but must not take labor.json down
        return (100 * (total - craft) / total,
                (total - craft) / heads / prod_awe[m] if heads > 0 else None)
    paid = [m for m in months if m in awe and m in prod_awe]
    p = paid[-1] if paid else None
    return {"as_of": a,
            "craft_k": None if a is None else round(prod[a]),
            "noncraft_k": None if a is None else round(noncraft[-1]),
            "noncraft_share_pct": share[-1] if months else None,
            "noncraft_per_100_craft": None if a is None else round(100 * noncraft[-1] / prod[a], 1),
            "share_1y_ago_pct": share[months.index(base)] if base in months else None,
            "payroll_as_of": p,
            "noncraft_payroll_share_pct": None if p is None else round(pay(p)[0], 2),
            "noncraft_pay_ratio": None if p is None or pay(p)[1] is None else round(pay(p)[1], 2),
            "history": {"months": months,
                        "craft_k": [round(prod[m]) for m in months],
                        "noncraft_k": [round(n) for n in noncraft],
                        "noncraft_share_pct": share,
                        "noncraft_payroll_share_pct": [
                            round(pay(m)[0], 2) if m in awe and m in prod_awe else None
                            for m in months]}}


def _history(payems, unrate, icsa, cons):
    months = sorted(set(payems) | set(unrate))[-MONTHLY_TAIL:]

    weeks = sorted(icsa)[-WEEKLY_TAIL:]
    return {"monthly": {"months": months,
                        "payrolls_yoy_pct": [yoy_pct(payems, m) for m in months],
                        "construction_yoy_pct": [yoy_pct(cons, m) for m in months],
                        "unemployment_rate": [None if m not in unrate
                                              else round(unrate[m], 1) for m in months]},
            "weekly": {"dates": weeks,
                       "initial_claims": [round(icsa[w]) for w in weeks]}}


def build(conn) -> dict:
    payems, unrate = _rows(conn, PAYEMS), _rows(conn, UNRATE)
    icsa, ccsa = _rows(conn, ICSA), _rows(conn, CCSA)
    ahe, wgt = _rows(conn, AHE), _rows(conn, WGT)
    cons = _rows(conn, CONS_EMP)
    return {"payrolls": _payrolls(payems),
            "unemployment": _unemployment(unrate),
            "claims": _claims(icsa, ccsa),
            "wages": _wages(ahe, wgt),
            "construction": _construction(cons, _rows(conn, CONSTR), ahe,
                                          _rows(conn, CONS_OPEN), _rows(conn, CONS_OPEN_RATE)),
            "construction_mix": _construction_mix(cons, _rows(conn, CONS_PROD), _rows(conn, CONS_AWE),
                                                  _rows(conn, CONS_PROD_AWE)),
            "history": _history(payems, unrate, icsa, cons)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "labor.json")
