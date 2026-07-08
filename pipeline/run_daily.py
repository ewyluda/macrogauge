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
from pipeline.publish import official as official_json
from pipeline.publish import (compare, gaptable, gauge_daily, pulse, qa,
                              replay, sources_status, validate)
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

    _, comps = basket_mod.load_basket()

    cpi = gauge_qa = None
    engine_error = None
    try:
        cpi = official.latest_yoy(conn, "CPIAUCNS")
        staleness = {s.code: s.max_staleness_days for s in series}
        gauge_result = gauge_engine.run(conn, today=today, staleness=staleness)

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

        compare_payload = compare.build(gauge_result, conn)
        cmp_path = compare.write(compare_payload, args.out,
                                 published_at=published_at)
        validate.validate_file(cmp_path, SCHEMAS / "compare.schema.json")
        print(f"published: {cmp_path} "
              f"(tracker corr {compare_payload['validation']['tracker']['corr']})")

        gt_path = gaptable.write(
            gaptable.build(gauge_result, conn, comps,
                           official_month=cpi["month"]),
            args.out, published_at=published_at)
        validate.validate_file(gt_path, SCHEMAS / "gaptable.schema.json")
        print(f"published: {gt_path}")

        official_path = official_json.write(official_json.build(conn, series),
                                            args.out,
                                            published_at=published_at)
        validate.validate_file(official_path, SCHEMAS / "official.schema.json")
        print(f"published: {official_path}")

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
    except jsonschema.ValidationError:
        raise  # contract violation must fail the run — never deploy invalid JSON
    except Exception as e:  # engine isolation: failure surfaces in qa, never blocks
        engine_error = f"{type(e).__name__}: {e}"
        print(f"ENGINE/PUBLISH FAILED — {engine_error}")

    freshness = [{"code": s.code, "latest_obs": vintage.max_obs_date(conn, s.code),
                  "limit_days": s.max_staleness_days} for s in series]
    qa_path = qa.write(qa.run_checks(cpi, today=today, source_results=results,
                                     freshness=freshness, gauge=gauge_qa,
                                     engine_error=engine_error),
                       args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
