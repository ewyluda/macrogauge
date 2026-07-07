"""Daily publish run: collect -> store -> engine -> write JSONs -> validate.

Failures in this Phase-0 version abort the run (single source). From Phase 1,
per-connector failures are isolated and lower coverage instead.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pipeline.connectors import fred
from pipeline.engine import official
from pipeline.publish import pulse_lite, qa, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"
SERIES = ["CPIAUCNS"]  # official CPI-U NSA — headline YoY as printed


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser(description="macrogauge daily publish run")
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    api_key = os.environ["FRED_API_KEY"]
    observations = fred.fetch(SERIES, api_key, http_get=http_get)
    written = vintage.append(observations, args.store)
    print(f"store: {len(observations)} fetched, {written} new rows")

    conn = vintage.load(args.store)
    cpi = official.latest_yoy(conn, "CPIAUCNS")

    published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pulse_path = pulse_lite.write(cpi, args.out, published_at=published_at)
    validate.validate_file(pulse_path, SCHEMAS / "pulse_lite.schema.json")
    print(f"published: {pulse_path} (CPI YoY {round(cpi['yoy_pct'], 2)}%, month {cpi['month']})")

    qa_path = qa.write(qa.run_checks(cpi, today=fred.today_et()), args.out)
    validate.validate_file(qa_path, SCHEMAS / "qa.schema.json")
    print(f"qa: {qa_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
