"""One-time deep-history backfill for the /labor non-craft share.

The daily FRED fetch starts at 2017-01, which leaves the share of construction
jobs held by non-craft staff (all employees − production and nonsupervisory
employees) with no baseline before the 2017 build-out it is meant to put in
context. Both BLS series reach back decades; 1990 covers the flat 1990s, the
2006 housing peak, the 2011 trough and the recovery. The payroll share also
needs average weekly earnings for both groups; all-employee earnings begin
2006-03, so that pair is checked against 2006-03. Run locally with
FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_construction_mix.py --store store

Appends under today's vintage via vintage.append, which value-dedupes, so
re-running is a no-op. Rows before 2017 then never revise; CES benchmark
revisions reach back about five years, so that history is final in practice.
"""
import argparse
import os
import sys
from pathlib import Path

from pipeline.connectors import fred
from pipeline.publish.labor import CONS_AWE, CONS_EMP, CONS_PROD, CONS_PROD_AWE
from pipeline.registry import load_registry
from pipeline.store import vintage
from scripts.backfill_dc_history import coverage, shortfalls

OBSERVATION_START = "1990-01-01"
EARNINGS_START = "2006-03-01"  # first month of all-employee CES earnings
HEADCOUNT, EARNINGS = (CONS_EMP, CONS_PROD), (CONS_AWE, CONS_PROD_AWE)
CODES = HEADCOUNT + EARNINGS


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--observation-start", default=OBSERVATION_START)
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")

    _, registry = load_registry()
    entries = [s for s in registry if s.code in CODES]
    if {s.code for s in entries} != set(CODES) or any(s.source != "FRED" for s in entries):
        sys.exit(f"registry must carry {CODES} as FRED series")
    # both codes equal their FRED ids, so no id -> code remap is needed
    assert all(s.code == s.source_id for s in entries)

    obs = fred.fetch([s.source_id for s in entries], key,
                     observation_start=args.observation_start, http_get=http_get)
    # the shares are ratios of these: one short series shortens them, and the
    # store is append-only, so verify both before writing anything
    cover = coverage(obs)
    short = (shortfalls([s for s in entries if s.code in HEADCOUNT], cover, args.observation_start)
             + shortfalls([s for s in entries if s.code in EARNINGS], cover,
                          max(args.observation_start, EARNINGS_START)))
    if short:
        sys.exit("incomplete coverage — NOTHING written.\n  " + "\n  ".join(short))

    for s in entries:
        earliest, rows = cover[s.code]
        print(f"  {s.code:<16} {earliest}  {rows:>5} rows")
    written = vintage.append(obs, args.store)
    print(f"wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
