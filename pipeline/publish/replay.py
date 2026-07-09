"""Writer for replay.json — per-component daily indexes for the treemap replay.

Compact JSON (no indent): ~14 components x ~3.1k daily points x 2 arrays.
The five treemap modes (YoY / MoM-ann / vs-BLS / 1-day / WoW) are client-side
display transforms of these two index arrays — the deliberate, bounded
exception to "the site only formats" (1c spec §6.3)."""
import json
from pathlib import Path

from pipeline.engine.gauge import PUBLISH_START


def build(gauge_result: dict, comps) -> dict:
    g = gauge_result["variants"]["gauge"]
    dates = [d for d in sorted(g["index"]) if d >= PUBLISH_START]
    components = []
    for comp in comps:
        e = g["components"][comp.code]
        components.append({
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            "index": [round(e["daily_index"][d], 2) for d in dates],
            "bls_index": [round(e["official_daily_index"][d], 2)
                          for d in dates],
            "yoy": [None if e["own_yoy_daily"].get(d) is None
                    else round(e["own_yoy_daily"][d], 2) for d in dates],
            "bls_yoy": [None if e["official_own_yoy_daily"].get(d) is None
                        else round(e["official_own_yoy_daily"][d], 2)
                        for d in dates]})
    return {"rebase": f"{gauge_result['base_month']}=100",
            "dates": dates, "components": components}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "replay.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               separators=(",", ":")) + "\n")
    return path
