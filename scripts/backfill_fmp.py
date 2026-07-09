"""One-time FMP history backfill (Phase 2a). Run locally with FMP_API_KEY set:

    FMP_API_KEY=... python scripts/backfill_fmp.py --store store

Appends daily GCUSD/CLUSD closes since 2017 with TODAY's vintage; the store's
value-dedupe skips rows that already match, so re-running is harmless.

**Same-vintage overlap:** The backfill refetches the full range including days
already collected by the daily quote route. Where the EOD value differs from the
same-day intraday quote (e.g., fmp_gold 2026-07-09: quote 4133.6 vs EOD 4133.4),
the append-only store records both rows under the same vintage_date. On read, the
store's tiebreak (latest vintage, then rowid—last-seen wins) means the EOD row
supersedes the intraday quote. This is deliberate: the EOD value is the better
daily close. Future targeted backfills should pass a bounded `from_date` to avoid
refetching and superseding at scale (e.g., `fetch_history(..., from_date='2025-01-01')
to avoid re-doing years already published)."""
import argparse
import os
import sys
from pathlib import Path

from pipeline.connectors import fmp
from pipeline.store import vintage


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    args = parser.parse_args(argv)
    key = os.environ.get("FMP_API_KEY")
    if not key:
        sys.exit("FMP_API_KEY not set")
    obs = fmp.fetch_history(["GCUSD", "CLUSD"], key)
    # store rows keep the registry's internal codes, mirroring collect_all's id_map
    id_map = {"GCUSD": "fmp_gold", "CLUSD": "fmp_wti"}
    from dataclasses import replace
    obs = [replace(o, series_code=id_map[o.series_code]) for o in obs]
    written = vintage.append(obs, args.store)
    print(f"fetched {len(obs)}, wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
