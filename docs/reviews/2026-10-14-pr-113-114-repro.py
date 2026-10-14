"""Offline review probes. Writes representative artifacts only to --out.

Run from a checkout of c1aa251:
  .venv/bin/python docs/reviews/2026-10-14-pr-113-114-repro.py --out /tmp/pr114-data
  node docs/reviews/2026-10-14-pr-113-114-repro.cjs /tmp/pr114-data
"""
import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pipeline import basket, derived, registry
from pipeline.engine import composites, dcindex, gauge, outlook, signals, variants
from pipeline.publish import gauge_daily, replay, validate
from pipeline.publish.util import missing_months
from pipeline.store import vintage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    assert args.out.resolve() != (ROOT / "site/public/data").resolve()
    conn = vintage.load(ROOT / "store")  # in-memory database; no store writes
    _, comps = basket.load_basket()
    derived.inject(conn, comps)
    _, series = registry.load_registry()
    result = gauge.run(conn, today="2026-10-14",
                       staleness={s.code: s.max_staleness_days for s in series})
    rep = replay.build(result, comps)
    daily = gauge_daily.build(result)
    for name, payload, writer in (("replay", rep, replay), ("gauge_daily", daily, gauge_daily)):
        path = writer.write(payload, args.out, "2026-10-14T23:00:00Z")
        validate.validate_file(path, ROOT / f"schemas/{name}.schema.json")

    used = result["variants"]["gauge"]["components"]["used_vehicles"]
    used_published = next(c for c in rep["components"] if c["code"] == "used_vehicles")
    gaps = missing_months(used["obs_dates"])
    assert "2026-04" in gaps and used_published["missing_months"] == []
    assert used["daily_index"]["2026-04-01"] == used["daily_index"]["2026-03-31"]

    # A hybrid component's live tail must not erase the official history's gap.
    electricity = next(c for c in comps if c.code == "electricity")
    months = [f"{y}-{m:02d}-01" for y in (2024, 2025, 2026) for m in range(1, 13)]
    official = {m: 100 + i for i, m in enumerate(months)
                if m <= "2026-08-01" and m != "2025-10-01"}
    live = {m: 10 + i / 10 for i, m in enumerate(months) if m <= "2026-09-01"}
    assembled, mode, _ = variants.build_component(electricity, "gauge", official,
                                                 {"eia_elec_res": live})
    assert mode == "live" and "2025-10" in missing_months(assembled)
    hybrid_result = copy.deepcopy(result)
    hybrid = hybrid_result["variants"]["gauge"]["components"]["electricity"]
    hybrid.update(mode=mode, obs_dates=sorted(assembled))
    # Only the metadata inputs vary; other arrays are irrelevant to this probe.
    hybrid_published = next(c for c in replay.build(hybrid_result, comps)["components"]
                            if c["code"] == "electricity")["missing_months"]
    assert hybrid_published == []

    # PR 113 controls: distinguish an honest 3-month interval from row offsets,
    # and check the partial-basket interpolation, not just an all-equal basket.
    rows = [("2025-07-01", 100), ("2025-08-01", 103), ("2025-09-01", 107),
            ("2025-11-01", 113), ("2025-12-01", 118), ("2026-01-01", 120),
            ("2026-02-01", 121)]
    assert dict(composites.momentum(rows, percent=False)) == {
        "2025-11-01": 10, "2025-12-01": 11, "2026-02-01": 8}
    levels = {"2025-08": 100, "2025-09": 101, "2025-11": 108, "2025-12": 109}
    assert abs(signals.median_mom(levels, 3) - (109 / 108 - 1) * 100) < 1e-10
    components = {"a": {"weight": .25, "obs_dates": ["2025-09-01", "2025-11-01"]},
                  "b": {"weight": .75, "obs_dates": ["2025-09-01", "2025-10-01", "2025-11-01"]}}
    component_levels = {"a": {"2025-09": 100, "2025-10": 100, "2025-11": 144},
                        "b": {"2025-09": 200, "2025-10": 210, "2025-11": 220}}
    headline = {m: .25 * component_levels["a"][m] + .75 * component_levels["b"][m]
                for m in component_levels["a"]}
    patched = outlook._patch_hole_months(headline, components, component_levels)
    assert patched["2025-10"] == .25 * 120 + .75 * 210
    monthly = {"months": list(headline), "index": list(headline.values()),
               "components": {k: list(v.values()) for k, v in component_levels.items()}}
    dcindex._interpolate_monthly_holes(monthly,
        {k: {d: 1 for d in v["obs_dates"]} for k, v in components.items()}, {"a": .25, "b": .75})
    assert monthly["index"][1] == patched["2025-10"]
    evidence = {
        "as_of": "2026-10-14", "head": "c1aa25123dec48fe7a2c7a53b59b5031bc56fa3a",
        "used_vehicles": {"mode": used["mode"], "last_obs": used["last_obs"],
                          "actual_gaps": gaps, "published_gaps": used_published["missing_months"],
                          "april_base_is_carried_march": True},
        "hybrid_electricity": {"mode": mode, "actual_gaps": missing_months(assembled),
                               "published_gaps": hybrid_published},
        "pr113_controls": "calendar momentum, calendar median and partial-basket interpolation passed",
    }
    (args.out / "python-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
