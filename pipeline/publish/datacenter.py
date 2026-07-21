"""Writer for datacenter.json — DC Build/Ops/Hardware cost indexes, hedonic-gap panel, state parity."""
from pathlib import Path

from pipeline import dc_basket
from pipeline.engine.dcindex import PUBLISH_START
from pipeline.publish.util import write_json


def build(dc_result: dict, parity_result: dict, source_ids: dict[str, str],
          construction: dict | None, power: dict | None, context: dict | None) -> dict:
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
                     else round(e["weight"] * e["yoy_pct"], 2),
                 "stale": e["stale"]}
                for code, e in v["components"].items()]}
        by_group: dict[str, dict] = {}
        for code, e in v["components"].items():
            g = by_group.setdefault(e["group"], {"group": e["group"], "weight": 0.0,
                                                  "contribution_pp": 0.0,
                                                  "_null": False})
            g["weight"] += e["weight"]
            if e["yoy_pct"] is None:
                # a single unknowable member makes the group sum unknowable —
                # never publish a silently-partial sum
                g["_null"] = True
            else:
                g["contribution_pp"] += e["weight"] * e["yoy_pct"]
        out["indexes"][name]["groups"] = [
            {"group": g["group"], "weight": round(g["weight"], 4),
             "contribution_pp": (None if g["_null"]
                                 else round(g["contribution_pp"], 2))}
            for g in by_group.values()]
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
    out["context"] = context
    return out


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir,
                      "datacenter.json")
