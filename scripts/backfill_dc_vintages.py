"""One-off ALFRED vintage backfill for the 12 DC Build components.

    FRED_API_KEY=... python scripts/backfill_dc_vintages.py --store store

The initial DC backfill (2026-07-12/15) gave every historical observation the
same collection-day vintage, so there was no point-in-time history to walk and
the register concluded a vintage-true DC backtest was impossible before
mid-2027. ALFRED has the real release history for all 12 components -- this
loads it, which is what makes pipeline/engine/dcgrade.py possible.

Identity-deduped (vintage.append_vintages), so re-running is a no-op.

THE LATEST-VINTAGE-WINS VIEW IS *MOSTLY* UNCHANGED, NOT GUARANTEED
UNCHANGED. Where the daily snapshot already carries a value for (series,
obs_date), its later vintage still wins and nothing moves. But where the
snapshot has a HOLE -- an observation the agency has since retracted, which
current FRED serves as "." and fred.py filters out -- this backfill's
historical vintage becomes the only value the store holds, and latest()
starts returning a print the agency later withdrew, permanently (append-only
store, no tombstones, and no future daily fetch can supersede a value FRED
no longer serves).

Measured on the 2026-07-26 run, exactly one such case landed inside the
published grid intersection: ppi_copper_wire 2020-07 (292.9, vintage
2020-08-11; the 2026-07-12 snapshot skips that month). The published Build
index at 2020-07 moved 106.4733 -> 106.5814 (+0.1081) when the artifact was
next regenerated, with the usual YoY echo twelve months later. Disclosed
here and in the spec rather than silently absorbed: an actual (later
retracted) July print is a more honest July value than June forward-filled,
but a moved published number is a revision and gets said out loud.
"""
import argparse
import os
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline import dc_basket                             # noqa: E402
from pipeline.connectors import fred                       # noqa: E402
from pipeline.models import Observation                    # noqa: E402
from pipeline.registry import load_registry                # noqa: E402
from pipeline.store import vintage                         # noqa: E402

# A component with real ALFRED history returns >100 distinct vintages (the
# probed minimum across the 12 was 135). 50 is a floor well clear of that and
# well clear of the single-vintage failure this guard exists to catch.
MIN_VINTAGES = 50
OBSERVATION_START = "2007-01-01"
REALTIME_START = "1990-01-01"   # must predate the first release, or ALFRED
                                # clamps the earliest window and the true
                                # first-release date is lost


def build_series_entries():
    """Registry entries for the 12 DC Build components, in basket order."""
    _, baskets = load_baskets_safely()
    wanted = {c.series for c in baskets["build"]}
    _, series = load_registry()
    entries = [s for s in series if s.code in wanted]
    missing = wanted - {s.code for s in entries}
    if missing:
        sys.exit(f"series missing from registry: {sorted(missing)}")
    return entries


def load_baskets_safely():
    _, series = load_registry()
    return dc_basket.load_baskets(registry_codes={s.code for s in series})


def coverage(observations: list[Observation]) -> dict[str, tuple[str, str, int]]:
    """{series_code: (earliest obs_date, latest obs_date, distinct vintages)}."""
    out: dict[str, tuple[str, str, set]] = {}
    for o in observations:
        lo, hi, vints = out.get(o.series_code, (o.obs_date, o.obs_date, set()))
        out[o.series_code] = (min(lo, o.obs_date), max(hi, o.obs_date),
                              vints | {o.vintage_date})
    return {c: (lo, hi, len(v)) for c, (lo, hi, v) in out.items()}


def shortfalls(cov: dict[str, tuple[str, str, int]], expected_codes: set,
               min_vintages: int = MIN_VINTAGES) -> list[str]:
    """Codes that are absent or came back with too few distinct vintages.

    fred.fetch_vintages is single-series so it cannot partially fail the way
    fred.fetch does -- but a loop over 12 series reintroduces exactly that
    trap, and the store is append-only, so this must run BEFORE any write."""
    return sorted(c for c in expected_codes
                  if c not in cov or cov[c][2] < min_vintages)


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--min-vintages", type=int, default=MIN_VINTAGES)
    args = parser.parse_args(argv)
    key = os.environ.get("FRED_API_KEY")
    if not key:
        sys.exit("FRED_API_KEY not set")

    entries = build_series_entries()
    id_map = {s.source_id: s.code for s in entries}
    obs: list[Observation] = []
    for s in entries:
        rows = fred.fetch_vintages(s.source_id, key,
                                   observation_start=OBSERVATION_START,
                                   realtime_start=REALTIME_START,
                                   http_get=http_get)
        # Remap provider id -> registry code. Skipping this writes a parallel
        # series under the FRED id that the engine never reads (spec risk 2).
        obs.extend(replace(o, series_code=id_map.get(o.series_code, o.series_code))
                   for o in rows)
        print(f"  {s.code:<26} {len(rows):>5} rows")

    cov = coverage(obs)
    bad = shortfalls(cov, set(id_map.values()), args.min_vintages)
    if bad:
        sys.exit("refusing to append -- short vintage history for: "
                 f"{bad}. The store is append-only; a partial load cannot "
                 "be undone.")

    written = vintage.append_vintages(obs, args.store)
    print(f"fetched {len(obs)} vintage rows across {len(cov)} series, "
          f"wrote {written} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
