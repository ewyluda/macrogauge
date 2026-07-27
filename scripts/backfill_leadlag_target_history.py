"""Deep-history backfill for the four Build-index PPI components dcleadlag's
MAPPINGS correlate against -- the "target" side of P3c's lead-lag study
(pipeline/engine/dcleadlag.py).

The design spec promises the study runs "over the full common sample
(1992-2026 where the component PPI reaches back that far)." The three
unfilled-orders DRIVER series were backfilled to 1992-01 by
scripts/backfill_uo_history.py, but running dcleadlag.study() against the
real store still produced only a 222-month common sample (2008-01 to
2026-06): the four TARGET components below were only ever collected from
2007-12 onward (scripts/backfill_dc_history.py's OBSERVATION_START, set by
the two contractor PPIs that floor the full 12-component Build index). All
four targets individually reach much further back on FRED itself --
WPU1175/WPU1174 to 1947-01, PCU333415333415 to 1977-12, PCU333611333611 to
1982-06 (verified live 2026-07-26) -- so the 2008 floor in dcleadlag.study()
was a STORE-CONTENT limit, not a FRED data limit. This closes that gap for
exactly the four components the study reads, matching the drivers'
1992-01-01 depth so both sides of the correlation reach as far back as the
spec advertises. Run locally with FRED_API_KEY set:

    FRED_API_KEY=... python scripts/backfill_leadlag_target_history.py --store store

Appends under today's vintage via vintage.append, which value-dedupes (most
of the fetched range 2007-2026 already matches what's stored, so only the
genuinely new 1992-2006 rows -- plus any real revisions -- actually write),
so re-running is a no-op.

IMPORTANT, and checked, not assumed (this exact failure mode has bitten this
project before): adding pre-2007 history to 4 of the Build index's 12
components must NOT move the published Build index. aggregate.headline
intersects component dates across ALL 12, and the other 8 (crucially
ppi_elec_contr / ppi_plumb_hvac, the two contractor PPIs) still start
2007-12, so the 12-way intersection cannot extend earlier no matter how deep
these 4 alone go. Verified after running this for real: dcindex.run()'s
build.monthly.index start month and every published value are unchanged
(diffed the JSON before/after -- see the backfill's fix report for the
exact command and output).

Deliberately its own script, not an extension of scripts/backfill_dc_history.py
or scripts/backfill_uo_history.py: the former backfills all 12 Build
components to 2007-12 (a different, shallower depth, for a different
purpose -- the published index's own history), and contorting either
existing script to carry a THIRD distinct (series-list, observation_start)
pairing would make both harder to read. This one hardcodes its own
four-series list and 1992-01-01 start instead.
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

# The four Build components dcleadlag.MAPPINGS names as targets (switchgear,
# transformers, hvac_equip, generators) -- not derived from dc_basket, so a
# change to the basket can't silently change what this backfills.
SERIES_CODES = ["ppi_switchgear", "ppi_transformer", "ppi_hvac_equip", "ppi_genset"]


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
    errors and raises only when EVERY series failed -- so 3 of 4 succeeding
    returns normally, and a series can also come back present-but-empty.
    Neither can be allowed to read as success here: the store is append-only,
    so a partial backfill silently and irreversibly leaves a subset of the
    Build index's components short while the script exits 0.
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
    # backfill cannot be taken back -- and a shallow target series is worse
    # than no backfill at all, because it looks like it worked while quietly
    # capping the lead-lag study's common sample at whatever depth came back.
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
