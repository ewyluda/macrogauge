"""One-time backfill: the December-2016 value of CPI-U and the 13 official
component indexes, so the "other" CPI residual (pipeline/derived.py) can chain
from the first BLS relative-importance table (December 2016) and 2017's
months — the YoY bases for 2018 — have a residual. The store otherwise starts
at 2017-01. Run locally with FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_base_dec2016.py --store store

Value-deduped (vintage.append), so re-running is a no-op."""
import argparse
import os
import sys
from pathlib import Path

from pipeline import basket as basket_mod, registry
from pipeline.connectors import fred
from pipeline.models import Observation
from pipeline.store import vintage

BASE = "2016-12-01"


def main(argv=None, http_get=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True, type=Path)
    args = ap.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")
    _, comps = basket_mod.load_basket()
    _, series = registry.load_registry()
    by_code = {s.code: s for s in series}
    codes = ["CPIAUCNS"] + [c.official_series for c in comps if c.official_series in by_code]
    wire = {by_code[c].source_id: c for c in codes}
    obs = fred.fetch(list(wire), key, observation_start=BASE, http_get=http_get)
    rows = [Observation(wire.get(o.series_code, o.series_code), o.obs_date, o.value,
                        o.vintage_date, o.source, o.route)
            for o in obs if o.obs_date == BASE]
    written = vintage.append(rows, args.store)
    print(f"{len(rows)} Dec-2016 rows fetched, {written} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
