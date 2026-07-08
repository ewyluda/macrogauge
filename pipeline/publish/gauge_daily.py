"""Writer for gauge_daily.json — daily index + YoY per variant (1c hero chart)."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START


def build(gauge_result: dict) -> dict:
    out = {"rebase": f"{gauge_result['base_month']}=100", "variants": {}}
    for name, v in gauge_result["variants"].items():
        dates = [d for d in sorted(v["index"]) if d >= PUBLISH_START]
        out["variants"][name] = {
            "dates": dates,
            "index": [round(v["index"][d], 2) for d in dates],
            "yoy_pct": [None if v["yoy"][d] is None else round(v["yoy"][d], 2)
                        for d in dates]}
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "gauge_daily.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
