"""Writer for grocery_basket.json — BLS average-price staples (~25 items).

Price + m/m + y/y per item off the latest computable month, plus each item's full
monthly price series since 2018 — the 2b sparkline cards render it directly. Items
whose YoY base is missing (new series, shutdown holes) are skipped and listed — the
grocery card never shows a fake change."""
from pathlib import Path

from pipeline.engine import official, gauge
from pipeline.publish.util import pct_change_daily, tail, write_json
from pipeline.store import vintage


# USDA weekly wholesale staples paired with the BLS retail item they feed
# (batch 4c, 2026-09-03): the farm-to-shelf spread is retail YoY minus
# wholesale YoY. Units differ by design (¢/lb vs $/lb) — only the YoYs are
# compared, never the levels. YoY on a weekly series uses the ±3d window
# (publish.util.pct_change_daily) at 364 days so the base lands on the same
# weekday.
WHOLESALE = [("usda_eggs_w", "Shell eggs, large white (USDA)", "APU0000708111"),
             ("usda_milk_w", "Whole milk, gallon (USDA)", "APU0000709112"),
             ("usda_beef_w", "Ground beef 80-89% (USDA)", "APU0000703112"),
             ("usda_pork_w", "Sliced bacon (USDA)", "APU0000704111"),
             ("usda_broiler_w", "Broiler/fryer composite (USDA)", "APU0000706111")]
WHOLESALE_TAIL_WEEKS = 104


def _wholesale(conn, items_by_code):
    rows = []
    for code, name, retail_code in WHOLESALE:
        obs = dict(vintage.latest(conn, code))
        if not obs:
            rows.append({"code": code, "name": name, "retail_code": retail_code,
                         "as_of": None, "value": None, "yoy_pct": None,
                         "retail_yoy_pct": None, "spread_pp": None,
                         "series": {"dates": [], "values": []}})
            continue
        as_of = max(obs)
        yoy = pct_change_daily(obs, as_of, 364)
        retail = items_by_code.get(retail_code)
        r_yoy = retail["yoy_pct"] if retail else None
        rows.append({"code": code, "name": name, "retail_code": retail_code,
                     "as_of": as_of, "value": round(obs[as_of], 3), "yoy_pct": yoy,
                     "retail_yoy_pct": r_yoy,
                     "spread_pp": None if yoy is None or r_yoy is None else round(r_yoy - yoy, 2),
                     "series": tail(obs, WHOLESALE_TAIL_WEEKS, nd=3)})
    return rows


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
            "items": items, "skipped": sorted(skipped),
            "wholesale": _wholesale(conn, {i["code"]: i for i in items})}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "grocery_basket.json")
