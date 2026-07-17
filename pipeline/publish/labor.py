"""Writer for labor.json — jobs-market dashboard (payrolls, unemployment, claims, wages).

Pure store -> writer (the real_wages/geo pattern): display-only, never touches the gauge
engine. Own-obs like-month YoY where computed (null if base absent or zero). Unemployment
reports a percentage-point change (delta_1y_pp), not a percent change. The NFP nowcast and
graded accountability are already published (nowcast_latest.json / accountability_nfp.json)
and are NOT duplicated here — the page imports them directly. Missing data publishes null
blocks: a new writer must never be able to take down the publish block.
"""
import json
from pathlib import Path

from pipeline.dates import months_back, prior_month
from pipeline.store import vintage

PAYEMS = "PAYEMS"
UNRATE = "UNRATE"
ICSA = "ICSA"
CCSA = "CCSA"
AHE = "CES0500000003"       # avg hourly earnings, total private ($/hr) — YoY computed here
WGT = "FRBATLWGT3MMAUMHWGO"  # Atlanta Fed wage growth — already a 12-mo growth %
MONTHLY_TAIL = 36
WEEKLY_TAIL = 52


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _payrolls(payems):
    if not payems:
        return {"level_k": None, "mom_change_k": None, "yoy_pct": None, "as_of": None}
    as_of = max(payems)
    prior = payems.get(prior_month(as_of))
    base = payems.get(months_back(as_of, 12))
    return {"level_k": round(payems[as_of]),
            "mom_change_k": None if prior is None else round(payems[as_of] - prior),
            "yoy_pct": None if not base else round((payems[as_of] / base - 1) * 100, 2),
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
        base = ahe.get(months_back(a, 12))
        ahe_yoy = None if not base else round((ahe[a] / base - 1) * 100, 2)
        as_ofs.append(a)
    if wgt:
        w = max(wgt)
        wgt_pct = round(wgt[w], 2)
        as_ofs.append(w)
    return {"ahe_yoy_pct": ahe_yoy, "atlanta_wgt_pct": wgt_pct,
            "as_of": max(as_ofs) if as_ofs else None}


def _history(payems, unrate, icsa):
    months = sorted(set(payems) | set(unrate))[-MONTHLY_TAIL:]

    def p_yoy(m):
        base = payems.get(months_back(m, 12))
        if m not in payems or not base:
            return None
        return round((payems[m] / base - 1) * 100, 2)

    weeks = sorted(icsa)[-WEEKLY_TAIL:]
    return {"monthly": {"months": months,
                        "payrolls_yoy_pct": [p_yoy(m) for m in months],
                        "unemployment_rate": [None if m not in unrate
                                              else round(unrate[m], 1) for m in months]},
            "weekly": {"dates": weeks,
                       "initial_claims": [round(icsa[w]) for w in weeks]}}


def build(conn) -> dict:
    payems, unrate = _rows(conn, PAYEMS), _rows(conn, UNRATE)
    icsa, ccsa = _rows(conn, ICSA), _rows(conn, CCSA)
    ahe, wgt = _rows(conn, AHE), _rows(conn, WGT)
    return {"payrolls": _payrolls(payems),
            "unemployment": _unemployment(unrate),
            "claims": _claims(icsa, ccsa),
            "wages": _wages(ahe, wgt),
            "history": _history(payems, unrate, icsa)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "labor.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
