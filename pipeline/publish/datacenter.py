"""Writer for datacenter.json — DC Build/Ops/Hardware cost indexes, hedonic-gap panel, state parity."""
import json
from pathlib import Path

from pipeline import dc_basket
from pipeline.engine.dcindex import PUBLISH_START


def build(dc_result: dict, parity_result: dict, source_ids: dict[str, str],
          construction: dict | None, power: dict | None) -> dict:
    out = {"rebase": f"{dc_result['base_month']}=100",
           "group_labels": dc_basket.load_group_labels(),
           "indexes": {}, "parity": parity_result}
    for name, v in dc_result["indexes"].items():
        dates = [d for d in sorted(v["index"]) if d >= PUBLISH_START]
        headline = v["yoy"].get(v["as_of"])
        out["indexes"][name] = {
            "as_of": v["as_of"],
            "headline_yoy_pct": None if headline is None else round(headline, 2),
            "gate_flags": v["gate_flags"],
            "dates": dates,
            "index": [round(v["index"][d], 2) for d in dates],
            "yoy_pct": [None if v["yoy"][d] is None else round(v["yoy"][d], 2)
                        for d in dates],
            "components": [
                {"code": code, "label": e["label"], "group": e["group"],
                 "weight": e["weight"], "mode": e["mode"],
                 "last_obs": e["last_obs"],
                 "yoy_pct": None if e["yoy_pct"] is None else round(e["yoy_pct"], 2),
                 "contribution_pp": None if e["yoy_pct"] is None
                     else round(e["weight"] * e["yoy_pct"], 2)}
                for code, e in v["components"].items()]}
    out["hardware_gap"] = [
        {"code": r["code"], "label": r["label"],
         "source_id": source_ids.get(r["series"], r["series"]),
         "yoy_pct": None if r["yoy_pct"] is None else round(r["yoy_pct"], 2),
         "last_obs": r["last_obs"], "in_basket": r["in_basket"]}
        for r in dc_result.get("hardware_gap", [])]
    out["construction"] = None if construction is None else {
        "as_of": construction["as_of"], "unit": construction["unit"],
        "latest_saar": round(construction["latest_saar"], 1),
        "yoy_pct": (None if construction["yoy_pct"] is None
                    else round(construction["yoy_pct"], 1)),
        "yoy_asof": construction["yoy_asof"],
        "vs_2014_avg": (None if construction["vs_2014_avg"] is None
                        else round(construction["vs_2014_avg"], 1)),
        "months": construction["months"],
        "saar": [round(v, 1) for v in construction["saar"]],
        "real": [None if v is None else round(v, 1) for v in construction["real"]]}
    out["power"] = None if power is None else {
        "tail": power["tail"],
        "hubs": [{**h, "latest": round(h["latest"], 2)} for h in power["hubs"]],
        "henry_hub": None if power["henry_hub"] is None else {
            **power["henry_hub"], "latest": round(power["henry_hub"]["latest"], 2)},
        "capacity_auction": power["capacity_auction"]}
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "datacenter.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
