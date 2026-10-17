"""Offline PR #127 review probes; writes only explicitly requested outputs.

Use --repo with an export of reviewed head 0d676106 and --base-config with
config/capacity.json from base 18d83d9b. No network or vintage-store writes.
Counterfactuals isolate data effects; they are not proposed production data.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--artifacts-out", type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    sys.path.insert(0, str(repo))
    import jsonschema
    from pipeline import capacity, dc_markets, dc_market_pipeline, power_deals
    from pipeline.publish import capacity as cap_writer, dc_markets as market_writer
    from pipeline.store import vintage

    cfg_path = repo / "config/capacity.json"
    head = capacity.load_capacity(cfg_path)
    base = capacity.load_capacity(args.base_config)
    conn = vintage.load(repo / "store")
    today = "2026-10-17"
    stamp = "2026-10-17T16:00:00Z"  # Fixed offline review timestamp.
    deals = power_deals.load(tickers={c["t"] for c in head["companies"]})
    payload = cap_writer.build(conn, head, today=today, power_deals=deals)
    baseline = cap_writer.build(conn, base, today=today, power_deals=deals)
    markets = dc_markets.load()
    broker = dc_market_pipeline.load(market_keys={m.key for m in markets})
    market_payload = market_writer.build(conn, markets, head, dc_markets.meta(),
                                         pipeline=broker, today=today)
    for name, data in [("capacity", payload), ("dc_markets", market_payload)]:
        jsonschema.validate({"published_at": stamp, **data},
                            json.loads((repo / f"schemas/{name}.schema.json").read_text()))
    by = {c["t"]: c for c in head["companies"]}
    published_by = {c["t"]: c for c in payload["companies"]}

    def curve(data, cohort="all"):
        return {p["q"]: p["cum_mw"] for p in data["timeline"][cohort]["points"]}

    # Oracle: four full-campus MW values paired to first-delivery dates.
    oracle = [s for s in by["ORCL"]["sites"] if s[0].startswith(
        ("Shackelford", "Doña Ana", "Saline", "Port Washington"))]
    assert sum(s[1] for s in oracle) == 4800
    assert all(s[4] in ("2027Q2", "2027Q4") for s in oracle)
    without_oracle = copy.deepcopy(head)
    for c in without_oracle["companies"]:
        if c["t"] == "ORCL":
            for s in c["sites"]:
                if s in oracle:
                    s[4] = None
    counter = cap_writer.build(conn, without_oracle, today=today)
    oracle_effect = {q: round(curve(payload)[q] - curve(counter)[q], 3)
                     for q in ("2027Q2", "2027Q4", "2028Q4")}
    assert oracle_effect == {"2027Q2": 2400, "2027Q4": 4800, "2028Q4": 4800}

    # Independent phasing example: two 96 MW buildings in H1'27, one in H1'28.
    nova = next(s for s in by["DLR"]["sites"] if s[0].startswith("Northern Virginia"))
    assert nova[1] == 288 and nova[4] == "2027Q2"
    split = copy.deepcopy(head)
    dlr = next(c for c in split["companies"] if c["t"] == "DLR")
    dlr["sites"].remove(nova)
    dlr["sites"] += [["Review control: first two buildings", 192, "c", "H1 2027", "2027Q2"],
                     ["Review control: third building", 96, "c", "H1 2028", "2028Q2"]]
    split_payload = cap_writer.build(conn, split, today=today)
    nova_effect = {q: round(curve(payload)[q] - curve(split_payload)[q], 3)
                   for q in ("2027Q2", "2027Q4", "2028Q2")}
    assert nova_effect == {"2027Q2": 96, "2027Q4": 96, "2028Q2": 0}

    # New numeric grid-only disclosures are emitted through the IT-MW field.
    iren_names = ("Kiowa OK", "Bundey, South Australia")
    iren = [s for s in by["IREN"]["sites"] if s[0].startswith(iren_names)]
    old_iren = next(c for c in base["companies"] if c["t"] == "IREN")
    assert sum(s[1] for s in iren) == 2400
    assert all(s not in old_iren["sites"] for s in iren)
    assert any(s[0] == "Kiowa OK + Bundey Australia" and s[1] is None
               for s in old_iren["sites"])
    map_rows = [g for g in head["geo"] + head["geo_unmapped"]
                if g["t"] == "IREN" and g["site"].startswith(("Kiowa", "Bundey"))]

    # A dated finish is present, but explicit null suppresses all A901 events.
    a901 = next(s for s in by["BTDR"]["sites"] if "A901" in s[0])
    assert a901[4] is None
    assert not any("A901" in event[1] for event in published_by["BTDR"]["tl"])
    a901_full = copy.deepcopy(head)
    for c in a901_full["companies"]:
        if c["t"] == "BTDR":
            next(s for s in c["sites"] if "A901" in s[0])[4] = "2027Q2"
    a901_payload = cap_writer.build(conn, a901_full, today=today)

    result = {
        "reviewed_head": "0d67610676f1384018116391375be01326ec6975",
        "reviewed_base": "18d83d9bf2f60cf7c61b997dbed263ca2b322a22",
        "head_config_sha256": hashlib.sha256(cfg_path.read_bytes()).hexdigest(),
        "base_config_sha256": hashlib.sha256(args.base_config.read_bytes()).hexdigest(),
        "schemas_valid": ["capacity", "dc_markets"],
        "cohorts": {"base": baseline["cohorts"], "head": payload["cohorts"]},
        "timeline": {"base": curve(baseline), "head": curve(payload)},
        "oracle_full_campuses": {"rows": oracle, "timeline_contribution_mw": oracle_effect},
        "dlr_phases": {"row": nova, "excess_vs_split_control_mw": nova_effect},
        "new_iren_grid_only": {"rows": iren, "map_rows": map_rows, "mw_total": 2400},
        "a901_undated": {"row": a901, "timeline_entries": published_by["BTDR"]["tl"],
                         "mw_omitted_by_2027Q2": round(curve(a901_payload)["2027Q2"] - curve(payload)["2027Q2"], 3)},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    if args.artifacts_out:
        cap_writer.write(payload, args.artifacts_out, stamp)
        market_writer.write(market_payload, args.artifacts_out, stamp)
    print(json.dumps({"schemas_valid": result["schemas_valid"], "oracle_mw": oracle_effect,
                      "dlr_mw": nova_effect, "new_iren_grid_only_mw": 2400,
                      "a901_omitted_mw": result["a901_undated"]["mw_omitted_by_2027Q2"]}, indent=2))


if __name__ == "__main__":
    main()
