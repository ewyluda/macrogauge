"""Offline PR #135 review: rebuild both capacity consumers at the reviewed head.

Only writes explicit output paths; never mutates the config or observation store.
Use an archive of HEAD_SHA and a base config exported from BASE_SHA.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

HEAD_SHA = "13b38d175953fa0672f9ea459fad0e907bb4eaab"
BASE_SHA = "8f806b8743c02ecf45a57d6a324bb8a7c99141d0"
TODAY = "2026-10-21"
STAMP = "2026-10-21T15:00:00Z"  # Fixed offline review timestamp, not a live publish.


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

    head_path = repo / "config/capacity.json"
    head = capacity.load_capacity(head_path)
    base = capacity.load_capacity(args.base_config)
    conn = vintage.load(repo / "store")
    deals = power_deals.load(repo / "config/power_deals.json",
                             tickers={c["t"] for c in head["companies"]})
    published = cap_writer.build(conn, head, today=TODAY, power_deals=deals)
    baseline = cap_writer.build(conn, base, today=TODAY, power_deals=deals)
    markets = dc_markets.load()
    broker = dc_market_pipeline.load(market_keys={m.key for m in markets})
    market = market_writer.build(conn, markets, head, dc_markets.meta(),
                                 pipeline=broker, today=TODAY)
    old_market = market_writer.build(conn, markets, base, dc_markets.meta(),
                                     pipeline=broker, today=TODAY)
    for name, data in [("capacity", published), ("dc_markets", market)]:
        jsonschema.validate({"published_at": STAMP, **data},
                            json.loads((repo / f"schemas/{name}.schema.json").read_text()))

    def xai(data):
        return next(c for c in data["companies"] if c["t"] == "XAI")

    def inventory(data):
        return [g for g in data["geo"] + data["geo_unmapped"] if g["t"] == "XAI"]

    def construction_mw(rows):
        return sum(r["mw"] or 0 for r in rows if r["st"] == "c")

    old, new = xai(baseline), xai(published)
    old_geo, new_geo = inventory(baseline), inventory(published)
    assert old["con"] == construction_mw(old_geo) == 400
    assert new["con"] == sum(e[2] for e in new["tl"]) == 800
    assert construction_mw(new_geo) == 400
    assert new["tl"] == [["2026Q4", "Colossus 2 - Q4'26 ramp (to 2.5–3 GW fleet)", 800]]

    # A counterfactual repairs only the stale unmapped representation. It must
    # not change company/cohort/timeline totals, or count the ramp twice.
    control = copy.deepcopy(head)
    ramp = next(s for s in xai(head)["sites"] if s[2] == "c")
    unmapped = next(g for g in control["geo_unmapped"] if g["t"] == "XAI")
    unmapped.update(site=ramp[0], mw=ramp[1], why=ramp[3] + "; building allocation undisclosed")
    control_payload = cap_writer.build(conn, control, today=TODAY, power_deals=deals)
    assert construction_mw(inventory(control_payload)) == 800
    for key in ("companies", "cohorts", "timeline", "reference"):
        assert published[key] == control_payload[key]

    delta = {k: published["cohorts"]["all"][k] - baseline["cohorts"]["all"][k]
             for k in ("op", "con", "plan")}
    assert delta == {"op": 300, "con": 400, "plan": 0}
    assert (old["wmw"], new["wmw"]) == (1775.0, 2275.0)
    assert new["ev_per_mw"] is None and new["ev"] is None
    assert sum(g["mw"] or 0 for g in new_geo if g["st"] == "o") == new["op"] == 1700
    memphis = next(m for m in market["markets"] if m["key"] == "memphis")
    old_memphis = next(m for m in old_market["markets"] if m["key"] == "memphis")
    assert memphis["mw_disclosed"] - old_memphis["mw_disclosed"] == 300

    # This date is rendered as 'MW data as of' and 'Estimated MW as curated',
    # not described as the date of the last full-roster review.
    source_date = "2026-10-20"
    assert published["as_of_curated"] == "2026-10-17" < source_date
    assert "10/20" in new["pipe"]
    evidence = {
        "reviewed_head": HEAD_SHA,
        "reviewed_base": BASE_SHA,
        "head_config_sha256": hashlib.sha256(head_path.read_bytes()).hexdigest(),
        "base_config_sha256": hashlib.sha256(args.base_config.read_bytes()).hexdigest(),
        "schemas_valid": ["capacity", "dc_markets"],
        "geo_ramp_mismatch": {
            "base_company_con_mw": old["con"],
            "base_geo_con_mw": construction_mw(old_geo),
            "head_company_con_mw": new["con"],
            "head_timeline": new["tl"],
            "head_geo_con_mw": construction_mw(new_geo),
            "head_unmapped": [g for g in published["geo_unmapped"] if g["t"] == "XAI"],
            "missing_from_geo_mw": new["con"] - construction_mw(new_geo),
            "control_geo_con_mw": construction_mw(inventory(control_payload)),
            "control_preserves_aggregate_totals": True,
        },
        "curation_date": {
            "published_as_of": published["as_of_curated"],
            "new_source_date": source_date,
            "days_source_after_as_of": 3,
        },
        "passing_controls": {
            "cohort_delta_mw": delta,
            "base_wmw": old["wmw"], "head_wmw": new["wmw"],
            "head_xai": new,
            "memphis_disclosed_mw_delta": memphis["mw_disclosed"] - old_memphis["mw_disclosed"],
            "private_ev_suppressed": True,
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    if args.artifacts_out:
        cap_writer.write(published, args.artifacts_out, STAMP)
        market_writer.write(market, args.artifacts_out, STAMP)
    print(json.dumps({"schemas_valid": evidence["schemas_valid"],
                      "geo_missing_mw": evidence["geo_ramp_mismatch"]["missing_from_geo_mw"],
                      "curation_date": evidence["curation_date"],
                      "cohort_delta_mw": delta}, indent=2))


if __name__ == "__main__":
    main()
