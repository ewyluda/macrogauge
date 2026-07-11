"""Daily publish run: collect (isolated) -> store -> engine -> publish -> validate.

Connector failures never block publication — they surface in
sources_status.json and qa.json, and stale series carry forward.

sources_status publishes FIRST (right after collect): a broken engine must
never hide a broken source. The strict engine+writer block (cpi -> gauge ->
pulse/gauge_daily/compare/gaptable/official) is wrapped in try/except so an
engine failure still publishes status+qa (rc 0, failure visible on-site via
engine_ok) — but a jsonschema.ValidationError re-raises and fails the run: a
schema-invalid artifact must never deploy.
"""
import argparse
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import jsonschema

from pipeline import basket as basket_mod
from pipeline import collect, registry, release_calendar
from pipeline.connectors import fred
from pipeline.engine import gauge as gauge_engine
from pipeline.engine import official
from pipeline.engine.nowcast import build_latest as build_nowcast
from pipeline.publish import official as official_json
from pipeline.publish import (compare, composites as composite_json, gaptable, gauge_daily, grocery, methodology,
                              phase3, pulse, qa, quilt, real_wages, replay, sources_status,
                              validate)
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def main(argv=None, http_get=None, http_post=None) -> int:
    parser = argparse.ArgumentParser(description="macrogauge daily publish run")
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    if not os.environ.get("FRED_API_KEY"):
        sys.exit("FRED_API_KEY not set (empty or missing env var)")

    sources, series = registry.load_registry()
    secrets = {src.secret: os.environ.get(src.secret, "")
               for src in sources.values() if src.secret}

    results = collect.collect_all(sources, series, secrets, args.store,
                                  http_get=http_get, http_post=http_post)
    for r in results:
        print(f"source {r.source}: "
              + (f"ok, {r.fetched} fetched, {r.new_rows} new" if r.ok
                 else f"FAILED — {r.error}"))

    conn = vintage.load(args.store)

    # sources_status FIRST: a broken engine must never hide a broken source
    status = sources_status.build(results, sources, series, conn)
    status_path = sources_status.write(status, args.out)
    validate.validate_file(status_path, SCHEMAS / "sources_status.schema.json")
    print(f"published: {status_path}")

    today = fred.today_et()
    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Fuel cross-check reads only the store (outside the engine try): AAA daily
    # pump prices vs EIA weekly survey, flagged if they diverge beyond design.
    # Zero-guard: a zero stored value would crash here (outside engine try),
    # violating the never-block-publication invariant. Compute only if both are truthy.
    fuel_div = None
    aaa_rows = vintage.latest(conn, "aaa_gas_d")
    eia_rows = vintage.latest(conn, "eia_gasreg_w")
    if aaa_rows and eia_rows:
        week = [v for d, v in aaa_rows[-7:]]
        aaa_avg, eia_last = sum(week) / len(week), eia_rows[-1][1]
        if aaa_avg and eia_last:
            fuel_div = {"aaa_wk_avg": round(aaa_avg, 3), "eia": round(eia_last, 3),
                        "rel": abs(aaa_avg / eia_last - 1), "n_obs": len(week)}

    cpi = gauge_qa = artifacts = None
    engine_error = None
    try:
        cpi = official.latest_yoy(conn, "CPIAUCNS")
        staleness = {s.code: s.max_staleness_days for s in series}
        gauge_result = gauge_engine.run(conn, today=today, staleness=staleness)
        _, comps = basket_mod.load_basket()  # inside try: config errors -> qa

        pulse_path = pulse.write(
            pulse.build(gauge_result, cpi,
                        next_print=release_calendar.next_print(today)),
            args.out, published_at=published_at)
        validate.validate_file(pulse_path, SCHEMAS / "pulse.schema.json")
        g = gauge_result["variants"]["gauge"]
        print(f"published: {pulse_path} (gauge YoY "
              f"{round(g['yoy'][g['as_of']], 2)}%, official "
              f"{round(cpi['yoy_pct'], 2)}%, coverage {round(g['coverage_pct'])}%)")

        gd_path = gauge_daily.write(gauge_daily.build(gauge_result), args.out,
                                    published_at=published_at)
        validate.validate_file(gd_path, SCHEMAS / "gauge_daily.schema.json")
        print(f"published: {gd_path}")

        replay_path = replay.write(replay.build(gauge_result, comps), args.out,
                                   published_at=published_at)
        validate.validate_file(replay_path, SCHEMAS / "replay.schema.json")
        print(f"published: {replay_path}")

        quilt_payload = quilt.build(gauge_result, comps)
        quilt_paths = quilt.write(quilt_payload, args.out,
                                  published_at=published_at)
        for qp in quilt_paths:
            validate.validate_file(qp, SCHEMAS / "quilt.schema.json")
            print(f"published: {qp}")

        grocery_payload = grocery.build(conn, series)
        gr_path = grocery.write(grocery_payload, args.out,
                                published_at=published_at)
        validate.validate_file(gr_path, SCHEMAS / "grocery_basket.schema.json")
        print(f"published: {gr_path} ({len(grocery_payload['items'])} items, "
              f"{len(grocery_payload['skipped'])} skipped)")

        compare_payload = compare.build(gauge_result, conn)
        cmp_path = compare.write(compare_payload, args.out,
                                 published_at=published_at)
        validate.validate_file(cmp_path, SCHEMAS / "compare.schema.json")
        print(f"published: {cmp_path} "
              f"(tracker corr {compare_payload['validation']['tracker']['corr']})")

        gaptable_payload = gaptable.build(gauge_result, conn, comps,
                                          official_month=cpi["month"])
        gt_path = gaptable.write(gaptable_payload, args.out,
                                 published_at=published_at)
        validate.validate_file(gt_path, SCHEMAS / "gaptable.schema.json")
        print(f"published: {gt_path}")

        meth_path = methodology.write(
            methodology.build(gauge_result, conn, sources, series, comps,
                              compare_payload["validation"], gaptable_payload,
                              cpi, today),
            args.out, published_at=published_at)
        validate.validate_file(meth_path, SCHEMAS / "methodology.schema.json")
        print(f"published: {meth_path}")

        official_path = official_json.write(official_json.build(conn, series),
                                            args.out,
                                            published_at=published_at)
        validate.validate_file(official_path, SCHEMAS / "official.schema.json")
        print(f"published: {official_path}")

        rw_path = real_wages.write(real_wages.build(conn, gauge_result),
                                   args.out, published_at=published_at)
        validate.validate_file(rw_path, SCHEMAS / "real_wages.schema.json")
        print(f"published: {rw_path}")

        next_release = release_calendar.next_print(today)
        nowcast_payload = build_nowcast(
            conn, gauge_result, next_release,
            benchmarks=phase3.latest_benchmarks(conn))
        phase3.record_forecasts(nowcast_payload, conn, args.store, today)
        phase3_paths = phase3.write_all(nowcast_payload, conn, args.out,
                                        published_at)
        schema_by_name = {
            "nowcast_latest.json": "nowcast_latest.schema.json",
            "nextprint.json": "nextprint.schema.json",
            "releases.json": "releases.schema.json",
            "backtest.json": "backtest.schema.json",
            "fuel.json": "fuel.schema.json",
        }
        for path in phase3_paths:
            schema = ("accountability.schema.json" if path.name.startswith("accountability_")
                      else schema_by_name[path.name])
            validate.validate_file(path, SCHEMAS / schema)
            print(f"published: {path}")

        composite_paths = composite_json.write_all(conn, args.out, published_at)
        for path in composite_paths:
            validate.validate_file(path, SCHEMAS / f"{path.stem}.schema.json")
            print(f"published: {path}")

        gauge_qa = {"as_of": g["as_of"], "coverage_pct": g["coverage_pct"],
                    "null_components": [
                        c for c, e in g["components"].items()
                        if e["end_value"] is None
                        or not math.isfinite(e["end_value"])],
                    "gate_flags": g["gate_flags"],
                    "weights_sum": sum(e["weight"]
                                       for e in g["components"].values()),
                    "tracker_corr":
                        compare_payload["validation"]["tracker"]["corr"]}

        quilt_aligned = all(
            len(c["ours_yoy_pct"]) == len(quilt_payload["months"])
            and len(c["official_yoy_pct"]) == len(quilt_payload["months"])
            for c in quilt_payload["components"])
        artifacts = {"quilt_months": len(quilt_payload["months"]),
                     "quilt_aligned": quilt_aligned,
                     "grocery_items": len(grocery_payload["items"]),
                     "grocery_skipped": len(grocery_payload["skipped"]),
                     "nowcast": nowcast_payload}
    except jsonschema.ValidationError:
        raise  # contract violation must fail the run — never deploy invalid JSON
    except Exception as e:  # engine isolation: failure surfaces in qa, never blocks
        engine_error = f"{type(e).__name__}: {e}"
        print(f"ENGINE/PUBLISH FAILED — {engine_error}")

    freshness = [{"code": s.code, "latest_obs": vintage.max_obs_date(conn, s.code),
                  "limit_days": s.max_staleness_days} for s in series]
    qa_path = qa.write(qa.run_checks(cpi, today=today, source_results=results,
                                     freshness=freshness, gauge=gauge_qa,
                                     engine_error=engine_error,
                                     fuel_divergence=fuel_div,
                                     artifacts=artifacts),
                       args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
