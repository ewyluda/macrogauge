"""Writer for grocery_basket.json — BLS average-price staples (~25 items).

Price + m/m + y/y per item off the latest computable month. Items whose YoY
base is missing (new series, shutdown holes) are skipped and listed — the
grocery card never shows a fake change."""
import json
from pathlib import Path

from pipeline.engine import official
from pipeline.store import vintage


def build(conn, series) -> dict:
    items, skipped = [], []
    for s in series:
        if s.source != "BLS" or not s.code.startswith("APU"):
            continue
        try:
            summary = official.component_summary(conn, s.code)
        except ValueError:
            skipped.append(s.code)
            continue
        month = summary["month"]
        price = dict(vintage.latest(conn, s.code))[month]
        items.append({"code": s.code, "name": s.name, "month": month,
                      "price": round(price, 3),
                      "mom_pct": round(summary["mom_pct"], 2),
                      "yoy_pct": round(summary["yoy_pct"], 2)})
    items.sort(key=lambda i: i["name"])
    return {"as_of": max((i["month"] for i in items), default=None),
            "items": items, "skipped": sorted(skipped)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "grocery_basket.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
