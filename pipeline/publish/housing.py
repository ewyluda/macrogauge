"""Writer for housing.json — prices, rents, sales, and a payment-to-income
affordability line (batch 4d, 2026-09-03).

Display-only, pure store -> writer. The affordability construction reuses
the col variant's marginal-buyer idea (variants.py: 0.80 x ZHVI financed at
the 30-year rate) and divides the resulting monthly principal-and-interest
payment by a monthly EARNINGS proxy: average hourly earnings, total private
(CES0500000003) x HOURS_PER_YEAR / 12. That is one average private earner,
not median household income — stated in `parameters` and on the page. The
monthly rate is the mean of the PMMS weekly prints inside the month; a month
with no print carries the prior month's rate.
"""
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import latest_point, write_json, yoy_pct
from pipeline.store import vintage

LTV = 0.80
TERM_MONTHS = 360
HOURS_PER_YEAR = 2080
AHE = "CES0500000003"


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _monthly(conn, code, label, unit):
    obs = _rows(conn, code)
    as_of, value = latest_point(obs, nd=2)
    return {"code": code, "label": label, "unit": unit, "value": value, "as_of": as_of,
            "yoy_pct": yoy_pct(obs, as_of) if as_of else None}


def payment(price: float, annual_rate_pct: float, term: int = TERM_MONTHS) -> float:
    r = annual_rate_pct / 100.0 / 12.0
    if r <= 0:
        return price / term
    return price * r / (1 - (1 + r) ** (-term))


def _monthly_rate(pmms: dict) -> dict[str, float]:
    by_month: dict[str, list[float]] = {}
    for d, v in pmms.items():
        by_month.setdefault(d[:7], []).append(v)
    return {m: sum(v) / len(v) for m, v in by_month.items()}


def _affordability(zhvi, pmms, ahe):
    rate_by_month = _monthly_rate(pmms)
    months = sorted(m for m in zhvi if m >= PUBLISH_START)
    out = {"months": [], "price": [], "rate_pct": [], "payment": [], "income": [], "share_pct": []}
    last_rate = None
    for m in months:
        r = rate_by_month.get(m[:7], last_rate)
        last_rate = r if r is not None else last_rate
        inc = ahe.get(m)
        if r is None or inc is None:
            continue
        price = LTV * zhvi[m]
        pay = payment(price, r)
        income = inc * HOURS_PER_YEAR / 12.0
        out["months"].append(m)
        out["price"].append(round(price))
        out["rate_pct"].append(round(r, 3))
        out["payment"].append(round(pay))
        out["income"].append(round(income))
        out["share_pct"].append(round(pay / income * 100, 2))
    latest = {k: (v[-1] if v else None) for k, v in out.items()}
    base = out["share_pct"][0] if out["share_pct"] else None
    return {"as_of": latest["months"], "price": latest["price"], "rate_pct": latest["rate_pct"],
            "payment": latest["payment"], "income": latest["income"],
            "share_pct": latest["share_pct"],
            "share_2018_01_pct": base,
            "history": out}


def build(conn) -> dict:
    zhvi, pmms, ahe = _rows(conn, "zhvi_us"), _rows(conn, "pmms_30yr"), _rows(conn, AHE)
    mnd = _rows(conn, "mnd_30y_d")
    mnd_as_of, mnd_val = latest_point(mnd)
    pmms_as_of, pmms_val = latest_point(pmms)
    return {"prices": {"case_shiller": _monthly(conn, "CSUSHPINSA", "Case-Shiller national", "index"),
                       "fhfa": _monthly(conn, "USSTHPI", "FHFA US HPI (quarterly)", "index"),
                       "zhvi": _monthly(conn, "zhvi_us", "Zillow Home Value Index", "$")},
            "rents": {"zori": _monthly(conn, "zori_us", "Zillow Observed Rent Index", "$/mo"),
                      "aptlist": _monthly(conn, "aptlist_us", "Apartment List national rent", "$/mo")},
            "sales": _monthly(conn, "EXHOSLUSM495S", "Existing home sales (SAAR)", "units"),
            "mortgage": {"pmms_30yr": {"value": pmms_val, "as_of": pmms_as_of},
                         "mnd_30yr_daily": {"value": mnd_val, "as_of": mnd_as_of}},
            "affordability": _affordability(zhvi, pmms, ahe),
            "parameters": {"ltv": LTV, "term_months": TERM_MONTHS,
                           "hours_per_year": HOURS_PER_YEAR,
                           "income_proxy": f"{AHE} (avg hourly earnings, total private) x "
                                           f"{HOURS_PER_YEAR} / 12 — one average private "
                                           "earner, not median household income",
                           "rate": "PMMS 30-year, monthly mean of weekly prints"}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "housing.json")
