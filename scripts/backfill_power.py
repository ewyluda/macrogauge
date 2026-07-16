"""One-time CAISO/MISO wholesale-power backfill (Wave 4b). Task 6 runs two passes:

    python scripts/backfill_power.py --store store --sources caiso,miso --to-date <last_friday>
    python scripts/backfill_power.py --store store --sources miso                  # weekends

Fetches CAISO SP15 (one windowed SingleZip request per trade date, >=5s sleep
— OASIS throttles) and MISO Indiana Hub (one CSV per market date, >=1s sleep;
404s are calendar skips; weekends included per Task 4's single-day contract)
through the NORMAL connectors with today's vintage, appended via vintage.append
(value-dedupe: re-running is a no-op).

Scope is splice overlap, not YoY: the spliced power component takes its YoY base
from official retail territory, so the backfill only needs to reach at/before the
last retail print (2026-04-01 today) with margin. Wave 4b deepens the window to
2024-07-01 — the year-ratio transform needs W(t−365d), and the backtest gate
(spec §6) grades ~10 realized prints.
"""
import argparse
import sys
import time
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline import registry                              # noqa: E402
from pipeline.connectors import caiso, miso                # noqa: E402
from pipeline.store import vintage                         # noqa: E402


def id_map(source: str) -> dict[str, str]:
    _, series = registry.load_registry()
    return {r.source_id: r.code for r in series if r.source == source}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--from-date", default="2026-01-01")
    parser.add_argument("--to-date", default=None,
                        help="last market date to fetch (default: yesterday)")
    parser.add_argument("--sources", default="caiso,miso",
                        help="comma list: caiso,miso (weekend repair = miso only)")
    parser.add_argument("--caiso-sleep", type=float, default=5.0)
    parser.add_argument("--miso-sleep", type=float, default=1.0)
    args = parser.parse_args(argv)

    caiso_map, miso_map = id_map("CAISO"), id_map("MISO")
    start = date.fromisoformat(args.from_date)
    end = (date.fromisoformat(args.to_date) if args.to_date
           else date.today() - timedelta(days=1))
    wanted = {s.strip() for s in args.sources.split(",")}
    total_new = 0

    d = start
    while d <= end:
        ds = d.isoformat()
        # CAISO trades every calendar day
        if "caiso" in wanted:
            try:
                obs = caiso.fetch(list(caiso_map), trade_date=ds)
                obs = [replace(o, series_code=caiso_map.get(o.series_code,
                                                               o.series_code))
                       for o in obs]
                total_new += vintage.append(obs, args.store)
            except Exception as e:  # noqa: BLE001 — backfill logs and continues
                print(f"caiso {ds}: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(args.caiso_sleep)
        # MISO's DA market runs every day, weekends included; a 404 inside
        # fetch is the only calendar signal (the old weekday skip here is
        # what punched the 56 Sat/Sun holes the store carried into wave 4b)
        if "miso" in wanted:
            try:
                obs = miso.fetch(list(miso_map), market_date=ds)
                obs = [replace(o, series_code=miso_map.get(o.series_code,
                                                               o.series_code))
                       for o in obs]
                total_new += vintage.append(obs, args.store)
            except Exception as e:  # noqa: BLE001
                print(f"miso {ds}: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(args.miso_sleep)
        d += timedelta(days=1)

    print(f"backfill complete: {total_new} new rows through {end.isoformat()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
