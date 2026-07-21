"""Writer for grocery_basket.json — BLS average-price staples (~25 items).

Price + m/m + y/y per item off the latest computable month, plus each item's full
monthly price series since 2018 — the 2b sparkline cards render it directly. Items
whose YoY base is missing (new series, shutdown holes) are skipped and listed — the
grocery card never shows a fake change."""
from pathlib import Path

from pipeline.engine import official, gauge
from pipeline.publish.util import write_json
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
        rows = [(d, v) for d, v in vintage.latest(conn, s.code)
                if d >= gauge.PUBLISH_START]
        items.append({"code": s.code, "name": s.name, "month": month,
                      "price": round(price, 3),
                      "mom_pct": round(summary["mom_pct"], 2),
                      "yoy_pct": round(summary["yoy_pct"], 2),
                      "series": {"months": [d for d, _ in rows],
                                 "prices": [round(v, 3) for _, v in rows]}})
    items.sort(key=lambda i: i["name"])
    return {"as_of": max((i["month"] for i in items), default=None),
            "items": items, "skipped": sorted(skipped)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "grocery_basket.json")
