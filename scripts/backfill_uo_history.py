"""One-time deep-history backfill for the three unfilled-orders series
powering P3c's lead-lag study (pipeline/engine/dcleadlag.py).

fred.fetch defaults to observation_start=2017-01-01 and pipeline/collect.py
does not override it, so the daily run would only ever accumulate about 9
years for these series. FRED carries all three back to 1992-01 (verified live
2026-07-26) -- a 34-year sample that is materially DEEPER than the DC Build
components these drivers get correlated against in dcleadlag.study() (whose
own common span starts 2007-12, per scripts/backfill_dc_history.py). That
depth is the entire reason unfilled orders are worth using as a candidate
leading indicator in the first place; collecting them from 2017 the way the
daily run would have shrunk the study to a 9-year sample. Run locally with
FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_uo_history.py --store store

Appends under today's vintage via vintage.append, which value-dedupes, so
re-running is a no-op.

Deliberately NOT built as an extension of scripts/backfill_dc_history.py:
that script derives its series list from the DC Build basket
(dc_basket.load_baskets), which has no notion of these three driver series --
routing them through that path would mean contorting a basket-shaped script
to backfill series that belong to no basket. This is a small, focused script
with its own hardcoded three-series list instead.
"""
import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

from pipeline.connectors import fred
from pipeline.registry import load_registry
from pipeline.store import vintage

OBSERVATION_START = "1992-01-01"

# The three P3c driver series (dcleadlag.MAPPINGS' "series" keys), not derived
# from any basket -- see module docstring.
SERIES_CODES = ["fred_uo_electrical", "fred_uo_hvac", "fred_uo_turbines"]


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

    `fred.fetch` tolerates per-series failures by design -- it collects
    errors and raises only when EVERY series failed -- so 2 of 3 succeeding
    returns normally, and a series can also come back present-but-empty.
    Neither can be allowed to read as success here: the store is append-only,
    so a partial backfill silently and irreversibly truncates the deep sample
    this script exists to create, while the script still exits 0.
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

    wanted = set(SERIES_CODES)
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
    # Same remap as pipeline/collect.py:210-212 and backfill_dc_history.py.
    id_map = {s.source_id: s.code for s in entries}
    obs = [replace(o, series_code=id_map.get(o.series_code, o.series_code))
           for o in obs]

    # Verify coverage BEFORE appending. The store is append-only, so a partial
    # backfill cannot be taken back -- and a shallow driver series is worse
    # than no backfill at all, because it looks like it worked while quietly
    # capping the study's sample at whatever depth happened to come back.
    cover = coverage(obs)
    short = shortfalls(entries, cover, args.observation_start)
    if short:
        sys.exit(
            "incomplete coverage — NOTHING written.\n  "
            + "\n  ".join(short)
            + "\nRe-run: fred.fetch tolerates per-series failures by design, "
              "so this is usually transient.")

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
