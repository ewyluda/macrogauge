"""Writer for replay.json — per-component daily indexes for the treemap replay.

Compact JSON (no indent): ~14 components x ~3.1k daily points x 2 arrays.
The five treemap modes (YoY / MoM-ann / vs-BLS / 1-day / WoW) are client-side
display transforms of these two index arrays — the deliberate, bounded
exception to "the site only formats" (1c spec §6.3)."""
import json
from pathlib import Path

from pipeline.engine import aggregate
from pipeline.engine.gauge import PUBLISH_START


def build(gauge_result: dict, comps) -> dict:
    g = gauge_result["variants"]["gauge"]
    dates = [d for d in sorted(g["index"]) if d >= PUBLISH_START]
    # Time-varying weights (backlog #4): the headline at date d uses the
    # weights of d's YoY base month (aggregate.base_month). Publish exactly
    # the months the published dates need, so lib/contribution.ts reproduces
    # Σ w·yoy at every date, not just the latest.
    wbm = g.get("weights_by_month")
    months = (sorted({aggregate.base_month(d) for d in dates})
              if wbm and dates else [])
    components = []
    for comp in comps:
        e = g["components"][comp.code]
        row = {
            "code": comp.code, "label": comp.label, "weight": comp.weight,
            "mode": e["mode"],
            # batch 5a (2026-09-03): the component's own last observation and
            # any gate holds naming it, so /components/[code] can show the
            # receipts without a second artifact
            "last_obs": e.get("last_obs"),
            "gate_flags": [f for f in g.get("gate_flags", []) if f.startswith(f"{comp.code}@")],
            "index": [round(e["daily_index"][d], 2) for d in dates],
            "bls_index": [round(e["official_daily_index"][d], 2)
                          for d in dates],
            "yoy": [None if e["own_yoy_daily"].get(d) is None
                    else round(e["own_yoy_daily"][d], 2) for d in dates],
            "bls_yoy": [None if e["official_own_yoy_daily"].get(d) is None
                        else round(e["official_own_yoy_daily"][d], 2)
                        for d in dates]}
        if months:
            row["weights_by_month"] = {m: round(wbm[m][comp.code], 6)
                                       for m in months if m in wbm}
        components.append(row)
    return {"rebase": f"{gauge_result['base_month']}=100",
            "dates": dates, "components": components}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "replay.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               separators=(",", ":")) + "\n")
    return path
