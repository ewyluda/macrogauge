"""Writer for gaptable.json — per-component gap decomposition (gauge variant).

gap contribution_i = weight_i x (our YoY_i - BLS YoY_i). Ours is as of the
daily-grid end; BLS is at the latest official print month — being ahead of
the print is the point, and both carry their as-of.
"""
import json
from pathlib import Path

from pipeline.engine import official as official_engine


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
    return {"as_of": g["as_of"], "official_month": official_month,
            "rows": rows, "total_gap_pp": round(total, 2)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "gaptable.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
