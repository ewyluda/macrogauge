"""Offline PR #125 review probes for head 688613e0b68fcdcc37885dbb3cf1ada0babef1a7.

Run against the reviewed source checkout using --repo /path/to/checkout.
Recovery uses hypothetical newly disclosed county cells, not live BLS claims.
The optional UI fixture is illustrative review data, not a production publish.
"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import sys
import tempfile


def recovery(repo):
    from pipeline import collect, dc_markets, registry
    from pipeline.connectors import qcew
    from pipeline.publish import dc_markets as writer
    from pipeline.store import vintage

    sources, series = registry.load_registry()
    subset = [s for s in series if s.source == "QCEW_238222"]
    excluded = {"22083", "32029", "53025"}
    seed = list(csv.DictReader(io.StringIO(
        (repo / "tests/fixtures/qcew_industry238222.csv").read_text())))
    # A published, guard-valid county row is copied under each excluded FIPS.
    prototype = next(r for r in seed if r["area_fips"] == "51107")
    changed = [r for r in seed if r["area_fips"] not in excluded]
    changed += [{**prototype, "area_fips": f} for f in sorted(excluded)]

    class Resp:
        status_code = 200

        def __init__(self, text):
            self.text = text

        def raise_for_status(self):
            pass

    def fake_get(url, **kwargs):
        year, qtr = url.split("/api/")[1].split("/")[:2]
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=seed[0].keys())
        w.writeheader()
        w.writerows({**r, "year": year, "qtr": qtr} for r in changed)
        return Resp(buf.getvalue())

    # Pin the requested quarter range independently of the execution date.
    old_today = qcew.today_et
    qcew.today_et = lambda: "2026-10-16"
    try:
        with tempfile.TemporaryDirectory() as temp:
            result = collect.collect_all(
                {"QCEW_238222": sources["QCEW_238222"]}, subset, {},
                Path(temp), http_get=fake_get)
            conn = vintage.load(Path(temp))
            market_rows = writer._labor(conn, dc_markets.load(), "238222")
            markets = {r["key"]: {k: r[k] for k in (
                "available", "counties_used", "counties_suppressed")}
                for r in market_rows["markets"] if r["key"] in (
                    "richland", "reno", "quincy")}
            lost = {f: len(vintage.latest(conn, f"qcew_wage238222_c{f}"))
                    for f in sorted(excluded)}
            requested = {s.source_id for s in subset}
            control = requested | {f + suffix for f in excluded
                                   for suffix in ("", "~emp", "~aemp")}
            body = fake_get(qcew.QCEW_URL.format(year=2026, qtr=2, naics="238222")).text
            accepted = qcew._parse_quarter(body, control, "2026-10-16", "238222", "QCEW_238222")
            control_counts = {f: sum(o.series_code.split("~")[0] == f for o in accepted)
                              for f in sorted(excluded)}
            assert lost == dict.fromkeys(sorted(excluded), 0)
            assert control_counts == dict.fromkeys(sorted(excluded), 3)
            assert result[0].ok and result[0].error is None
            return {"synthetic_newly_disclosed_counties": sorted(excluded),
                    "source_ok": result[0].ok, "source_error": result[0].error,
                    "stored_wage_observations": lost,
                    "accepted_metrics_if_requested": control_counts,
                    "published_markets": markets}
    finally:
        qcew.today_et = old_today

def trades(repo, fixture_out):
    import sqlite3
    import jsonschema
    from pipeline.publish import labor

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, vintage_date TEXT)")
    points = {
        "ces_constr_ahe": {"2025-08-01": 39.98, "2026-08-01": 41.64, "2026-09-01": 41.69},
        "CES2023821003": {"2025-08-01": 41.04, "2026-08-01": 43.61},
        "CES2023820003": {"2025-08-01": 41.04, "2026-08-01": 43.13},
        "CES2023800201": {"2025-09-01": 2854.9, "2026-09-01": 2939.6},
        "CES2023800101": {"2025-09-01": 2369.1, "2026-09-01": 2340.3},
        "ADPMINDCONNERSA": {"2025-09-01": 8016000, "2026-09-01": 8113000},
        "CIU2022300000000I": {"2025-04-01": 168.655, "2026-04-01": 174.584},
        "CIU2020000430000I": {"2025-04-01": 173.328, "2026-04-01": 179.752},
        "IHLIDXUSTPCONS": {"2025-10-08": 121.4, "2026-10-09": 129.16},
        "IHLIDXUSTPELECENGI": {"2025-10-09": 115.5, "2026-10-09": 152.95472},
        "IHLIDXUSTPINMA": {"2025-10-09": 113.0, "2026-10-09": 117.71},
    }
    conn.executemany("INSERT INTO observations VALUES (?,?,?,'2026-10-16')",
                     [(code, day, value) for code, obs in points.items() for day, value in obs.items()])
    block = labor.build(conn)["dc_trades"]
    assert len(block["rows"]) == 10 and all(r["value"] is not None for r in block["rows"])
    by = {r["key"]: r for r in block["rows"]}
    assert by["electrical_ahe"]["spread_pp"] == 2.11
    assert by["adp_construction_jobs"]["value"] == 8113.0
    payload = json.loads((repo / "site/public/data/labor.json").read_text())
    payload["dc_trades"] = block
    jsonschema.validate(payload, json.loads((repo / "schemas/labor.schema.json").read_text()))
    if fixture_out:
        fixture_out.write_text(json.dumps(payload, indent=2) + "\n")
    conn.execute("DELETE FROM observations WHERE series_code = 'IHLIDXUSTPINMA' AND obs_date < '2026-01-01'")
    degraded = {r["key"]: r for r in labor.build(conn)["dc_trades"]["rows"]}
    assert degraded["postings_install_maint"]["yoy_pct"] is None
    assert degraded["postings_install_maint"]["value"] == 117.7
    return {"fixture_row_count": len(block["rows"]), "schema_valid": True,
            "same_month_spread_pp": by["electrical_ahe"]["spread_pp"],
            "adp_thousands": by["adp_construction_jobs"]["value"],
            "missing_daily_base_yoy": degraded["postings_install_maint"]["yoy_pct"]}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--mode", choices=('recovery', 'trades'), default='recovery')
    parser.add_argument("--fixture-out", type=Path)
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    sys.path.insert(0, str(args.repo))
    os.chdir(args.repo)
    result = trades(args.repo, args.fixture_out) if args.mode == "trades" else recovery(args.repo)
    print(json.dumps(result, indent=2))
