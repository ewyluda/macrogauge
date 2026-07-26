"""One-time deep-history backfill for the DC Build index components.

The original DC backfill fetched from 2017-01-01, which left the Build index
with 102 usable months — a sample containing exactly one month of negative
YoY and no construction downturn at all. Every horizon-matched percentile
band computed on it collapsed with horizon, because 100% of 48-month windows
contained the 2021-22 spike.

All twelve Build components are FRED series and ten of them reach back
decades; the binding constraints are the two contractor PPIs, which begin at
2007-12 (their BLS index base, Dec 2007 = 100). Fetching from there gives a
common span of 222 months spanning the GFC collapse as well as the COVID
spike. Run locally with FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_dc_history.py --store store

Appends under today's vintage via vintage.append, which value-dedupes, so
re-running is a no-op. Ops and Hardware components are deliberately NOT
backfilled — this is a Build-index change (spec §7).
"""
import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

from pipeline import dc_basket
from pipeline.connectors import fred
from pipeline.registry import load_registry
from pipeline.store import vintage

OBSERVATION_START = "2007-12-01"


def build_series_codes(basket_path: Path | None = None) -> list[str]:
    """Internal series codes backing the Build index, in basket order."""
    _, baskets = dc_basket.load_baskets(basket_path)
    return [c.series for c in baskets["build"]]


def coverage(observations) -> dict[str, tuple[str, int]]:
    """{series_code: (earliest obs_date, row count)} over fetched observations."""
    out: dict[str, tuple[str, int]] = {}
    for o in observations:
        prev = out.get(o.series_code)
        if prev is None:
            out[o.series_code] = (o.obs_date, 1)
        else:
            out[o.series_code] = (min(prev[0], o.obs_date), prev[1] + 1)
    return out


def shortfalls(entries, cover: dict[str, tuple[str, int]],
               required_start: str) -> list[str]:
    """Requested series that came back absent or shallower than asked for.

    `fred.fetch` tolerates per-series failures by design — it collects errors
    and raises only when EVERY series failed — so 11 of 12 succeeding returns
    normally, and a series can also come back present-but-empty. Neither can
    be allowed to read as success here: the Build headline is the
    INTERSECTION of its components' dates (aggregate.headline), so a single
    short component silently drags the whole index back to its start and the
    GFC-era bases vanish from /escalation while the script exits 0.
    """
    out = []
    for s in entries:
        got = cover.get(s.code)
        if got is None:
            out.append(f"{s.code} ({s.source_id}): no rows returned")
        elif got[0] > required_start:
            out.append(f"{s.code} ({s.source_id}): earliest row {got[0]}, "
                       f"asked for {required_start}")
    return out


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--observation-start", default=OBSERVATION_START)
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")

    wanted = set(build_series_codes())
    # load_registry() returns (sources, series) — a TUPLE, not a list. Iterating
    # it directly silently yields the sources dict and blows up downstream.
    _, registry = load_registry()
    entries = [s for s in registry if s.code in wanted]
    missing = wanted - {s.code for s in entries}
    if missing:
        sys.exit(f"series missing from registry: {sorted(missing)}")
    non_fred = [s.code for s in entries if s.source != "FRED"]
    if non_fred:
        sys.exit(f"not FRED-sourced, cannot backfill here: {sorted(non_fred)}")

    obs = fred.fetch([s.source_id for s in entries], key,
                     observation_start=args.observation_start,
                     http_get=http_get)
    # fred.fetch stamps the FRED id; the store keys on our internal code.
    # Same remap as pipeline/collect.py:210-212.
    id_map = {s.source_id: s.code for s in entries}
    obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
           for o in obs]

    # Verify coverage BEFORE appending. The store is append-only, so a partial
    # backfill cannot be taken back — and a half-deep basket is worse than no
    # backfill at all, because it looks like it worked.
    cover = coverage(obs)
    short = shortfalls(entries, cover, args.observation_start)
    if short:
        sys.exit(
            "incomplete coverage — NOTHING written.\n  "
            + "\n  ".join(short)
            + "\nThe Build index takes the intersection of its components' "
              "dates, so one short component shortens the whole index and the "
              "early bases silently disappear. Re-run: fred.fetch tolerates "
              "per-series failures by design, so this is usually transient.")

    print(f"fetched {len(obs)} rows across {len(entries)} series "
          f"(from {args.observation_start}); coverage verified:")
    for s in entries:
        earliest, rows = cover[s.code]
        print(f"  {s.code:<24} {earliest}  {rows:>5} rows")
    written = vintage.append(obs, args.store)
    print(f"wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
