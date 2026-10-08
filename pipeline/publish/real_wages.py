"""Writer for real_wages.json — wage growth vs the gauge (2b real-wages page).

Wage series pass store -> writer directly (the official.py pattern): they are
not basket components and never touch the engine. The gauge/official numbers
the page also shows come from pulse.json/compare.json — one published source
per number, nothing duplicated here. Missing wage data publishes null kpis and
empty series (a new writer must never be able to take down the publish block).
"""
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import write_json
from pipeline.store import vintage

WGT = "FRBATLWGT3MMAUMHWGO"  # already a 12-mo growth rate (%), 3mo MA median
AHE = "CES0500000003"        # $/hr level — YoY computed here
# construction trades' $/hr (CES2000000003, the store code DC Build's labor
# leg already collects): the wage the AI build-out bids up, beside the
# all-private series (/labor's real-wage panel, 2026-10-08)
CONSTR = "ces_constr_ahe"


def _yoy(levels: dict) -> dict:
    """{month: % change vs the same month a year earlier} where the base exists."""
    out = {}
    for m, v in levels.items():
        base = f"{int(m[:4]) - 1:04d}-{m[5:7]}-01"
        if base in levels and levels[base]:
            out[m] = (v / levels[base] - 1) * 100
    return out


def build(conn, gauge_result) -> dict:
    wgt = dict(vintage.latest(conn, WGT))
    ahe = dict(vintage.latest(conn, AHE))
    ahe_yoy = _yoy(ahe)
    constr_yoy = _yoy(dict(vintage.latest(conn, CONSTR)))
    months = sorted(m for m in set(wgt) | set(ahe) if m >= PUBLISH_START)
    wage_months = [m for m in months if m in wgt]
    latest = wage_months[-1] if wage_months else None
    g = gauge_result["variants"]["gauge"]
    gauge_yoy = g["yoy"].get(g["as_of"])
    real = None
    if latest is not None and gauge_yoy is not None:
        real = ((1 + wgt[latest] / 100) / (1 + gauge_yoy / 100) - 1) * 100
    return {"kpis": {
                "wage_growth_pct": None if latest is None else round(wgt[latest], 2),
                "wage_as_of": latest,
                "real_wage_growth_pct": None if real is None else round(real, 2)},
            "series": {
                "months": months,
                "atlanta_wgt_yoy_pct": [None if m not in wgt else round(wgt[m], 2)
                                        for m in months],
                "ahe_yoy_pct": [None if m not in ahe_yoy else round(ahe_yoy[m], 2)
                                for m in months],
                "construction_ahe_yoy_pct": [None if m not in constr_yoy else round(constr_yoy[m], 2)
                                             for m in months]}}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "real_wages.json")
