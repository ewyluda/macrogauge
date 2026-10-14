"""Writer for gauge_daily.json — daily index + YoY per variant (1c hero chart)."""
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START
from pipeline.publish.util import missing_months, write_json


def build(gauge_result: dict) -> dict:
    out = {"rebase": f"{gauge_result['base_month']}=100", "variants": {}}
    for name, v in gauge_result["variants"].items():
        dates = [d for d in sorted(v["index"]) if d >= PUBLISH_START]
        out["variants"][name] = {
            "dates": dates,
            "index": [round(v["index"][d], 2) for d in dates],
            "yoy_pct": [None if v["yoy"][d] is None else round(v["yoy"][d], 2)
                        for d in dates],
            # months any official component never printed (BLS skipped
            # October 2025): the client nulls 3/6-month rates touching them
            "missing_months": sorted({m for c in v.get("components", {}).values()
                                      if c.get("mode") != "live"
                                      for m in missing_months(c.get("obs_dates"))})}
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "gauge_daily.json")
