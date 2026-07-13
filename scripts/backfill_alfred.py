"""One-time ALFRED vintage backfill: seed the vintage-true backtest.

The initial store backfill gave every historical CPI observation the same
collection-day vintage, so backtest.cpi_walk_forward had no pre-release
history to walk and the Forecast Scoreboard published 0 rows. This pulls
every real release vintage from ALFRED (the FRED realtime API) and appends
them under their true release dates. Run locally with FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_alfred.py --store store

Identity-deduped (vintage.append_vintages), so re-running is a no-op. The
latest-vintage-wins read view is unchanged — the daily snapshot still wins;
only first_releases()/as_of() gain real history."""
import argparse
import os
import sys
from pathlib import Path

from pipeline.connectors import fred
from pipeline.store import vintage


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--series", default="CPIAUCNS")
    parser.add_argument("--observation-start", default="2017-01-01")
    parser.add_argument("--realtime-start", default="2016-01-01")
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")
    obs = fred.fetch_vintages(args.series, key,
                              observation_start=args.observation_start,
                              realtime_start=args.realtime_start,
                              http_get=http_get)
    written = vintage.append_vintages(obs, args.store)
    print(f"fetched {len(obs)} vintage rows, wrote {written} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
