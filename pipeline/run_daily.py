"""Daily publish run: collect (isolated) -> store -> engine -> publish -> validate.

Connector failures never block publication — they surface in
sources_status.json and qa.json, and stale series carry forward.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pipeline import collect, registry
from pipeline.connectors import fred
from pipeline.engine import official
from pipeline.publish import pulse_lite, qa, sources_status, validate
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
    cpi = official.latest_yoy(conn, "CPIAUCNS")

    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pulse_path = pulse_lite.write(cpi, args.out, published_at=published_at)
    validate.validate_file(pulse_path, SCHEMAS / "pulse_lite.schema.json")
    print(f"published: {pulse_path} (CPI YoY {round(cpi['yoy_pct'], 2)}%, month {cpi['month']})")

    status = sources_status.build(results, sources, series, conn)
    status_path = sources_status.write(status, args.out)
    validate.validate_file(status_path, SCHEMAS / "sources_status.schema.json")
    print(f"published: {status_path}")

    freshness = [{"code": s.code, "latest_obs": vintage.max_obs_date(conn, s.code),
                  "limit_days": s.max_staleness_days} for s in series]
    qa_path = qa.write(qa.run_checks(cpi, today=fred.today_et(),
                                     source_results=results, freshness=freshness),
                       args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
