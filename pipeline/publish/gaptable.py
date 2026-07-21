"""Writer for gaptable.json — per-component gap decomposition (gauge variant).

gap contribution_i = weight_i x (our YoY_i - BLS YoY_i). Ours (component
yoy_pct) is as of each component's own last observation — not the daily-grid
end — so a like-month-to-like-month comparison always holds; bls_cf rows
therefore show gap 0 by construction. BLS is at the latest official print
month — being ahead of the print is the point, and both carry their as-of.

The component decomposition above stays gauge-only; `variants` (added Task
12) is a lightweight per-variant summary (yoy_pct/as_of/coverage_pct) across
all five published cuts — the 2b page chips consume it directly rather than
re-deriving it from gauge_daily.json.
"""
from pathlib import Path

from pipeline.engine import official as official_engine
from pipeline.publish.util import write_json


def _round(x, nd=2):
    return None if x is None else round(x, nd)


def build(gauge_result: dict, conn, comps, official_month: str) -> dict:
    g = gauge_result["variants"]["gauge"]
    rows, total = [], 0.0
    for comp in comps:
        entry = g["components"][comp.code]
        ours = entry["yoy_pct"]
        bls = official_engine.component_summary(conn, comp.official_series)["yoy_pct"]
        gap = None if ours is None else ours - bls
        contribution = None if gap is None else comp.weight * gap
        total += contribution or 0.0
        rows.append({"component": comp.code, "label": comp.label,
                     "weight": comp.weight, "mode": entry["mode"],
                     "ours_yoy_pct": _round(ours), "bls_yoy_pct": round(bls, 2),
                     "gap_pp": _round(gap),
                     "contribution_pp": _round(contribution)})
    rows.sort(key=lambda r: abs(r["contribution_pp"] or 0), reverse=True)
    variant_summary = {
        name: {"yoy_pct": _round(v["yoy"][v["as_of"]]),
               "as_of": v["as_of"],
               "coverage_pct": round(v["coverage_pct"], 2)}
        for name, v in gauge_result["variants"].items()}
    return {"as_of": g["as_of"], "official_month": official_month,
            "rows": rows, "total_gap_pp": round(total, 2),
            "variants": variant_summary}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "gaptable.json")
