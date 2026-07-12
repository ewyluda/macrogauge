"""One-time FMP history backfill (Phase 2a). Run locally with FMP_API_KEY set:

    FMP_API_KEY=... python scripts/backfill_fmp.py --store store \
      --symbols RBUSD NGUSD ZCUSD ZWUSD ZSUSD ZLUSD KCUSD SBUSD CCUSD LEUSD

Appends requested FMP closes since 2017 with TODAY's vintage; the store's
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

from pipeline import registry
from pipeline.connectors import fmp
from pipeline.store import vintage

DEFAULT_SYMBOLS = ["GCUSD", "CLUSD"]


def registry_id_map() -> dict[str, str]:
    _, series = registry.load_registry()
    return {row.source_id: row.code for row in series if row.source == "FMP"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--symbols", nargs="+", default=DEFAULT_SYMBOLS)
    parser.add_argument("--from-date", default="2017-01-01")
    args = parser.parse_args(argv)
    key = os.environ.get("FMP_API_KEY")
    if not key:
        sys.exit("FMP_API_KEY not set")
    id_map = registry_id_map()
    unknown = sorted(set(args.symbols) - set(id_map))
    if unknown:
        parser.error("symbols absent from config/series.json: " + ", ".join(unknown))
    obs = fmp.fetch_history(args.symbols, key, from_date=args.from_date)
    # store rows keep the registry's internal codes, mirroring collect_all's id_map
    from dataclasses import replace
    obs = [replace(o, series_code=id_map[o.series_code]) for o in obs]
    written = vintage.append(obs, args.store)
    print(f"fetched {len(obs)}, wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
