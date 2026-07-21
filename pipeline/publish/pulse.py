"""Writer for pulse.json — the homepage KPI feed (gauge + official headline)."""
from pathlib import Path
from pipeline.publish.util import write_json


def build(gauge_result: dict, cpi: dict, next_print: dict | None = None) -> dict:
    def block(v):
        return {"yoy_pct": round(v["yoy"][v["as_of"]], 2), "as_of": v["as_of"],
                "coverage_pct": round(v["coverage_pct"], 2)}

    g = gauge_result["variants"]["gauge"]
    t = gauge_result["variants"]["tracker"]
    return {"gauge": block(g),
            "tracker": block(t),
            "official": {"yoy_pct": round(cpi["yoy_pct"], 2),
                         "prev_yoy_pct": round(cpi["prev_yoy_pct"], 2),
                         "month": cpi["month"]},
            "gap_pp": round(g["yoy"][g["as_of"]] - cpi["yoy_pct"], 2),
            "tracker_gap_pp": round(t["yoy"][t["as_of"]] - cpi["yoy_pct"], 2),
            "next_print": next_print}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "pulse.json")
