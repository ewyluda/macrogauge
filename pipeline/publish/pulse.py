"""Writer for pulse.json — the homepage KPI feed (gauge + official headline)."""
import json
from pathlib import Path


def build(gauge_result: dict, cpi: dict) -> dict:
    def block(v):
        return {"yoy_pct": round(v["yoy"][v["as_of"]], 2), "as_of": v["as_of"],
                "coverage_pct": round(v["coverage_pct"], 2)}

    g = gauge_result["variants"]["gauge"]
    return {"gauge": block(g),
            "tracker": block(gauge_result["variants"]["tracker"]),
            "official": {"yoy_pct": round(cpi["yoy_pct"], 2),
                         "prev_yoy_pct": round(cpi["prev_yoy_pct"], 2),
                         "month": cpi["month"]},
            "gap_pp": round(g["yoy"][g["as_of"]] - cpi["yoy_pct"], 2)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "pulse.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
