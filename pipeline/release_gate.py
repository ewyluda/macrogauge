"""Release-day republish guard for the daily workflow.

The once-per-day publish gate caused a real miss on 2026-09-10: GitHub's cron
slip landed the run at 12:38 ET, FRED posted the August PPI at 12:54 ET, and
the backup cron then no-op'd because "already published today". This module
answers one question for the gate: is a print that was released today still
missing from the store? If so, a later scheduled firing may publish again.

Stdlib only, on purpose — the workflow calls it before pip install.
"""
import argparse
import json
from pathlib import Path

from pipeline import release_calendar

# Anchor series per calendar key: the headline index whose reference-month row
# proves the print was ingested.
ANCHORS = {"cpi": "CPIAUCNS", "ppi": "PPIACO"}


def _has_obs(store_dir: Path, series_code: str, obs_date: str) -> bool:
    needle_code = f'"series_code": "{series_code}"'
    needle_date = f'"obs_date": "{obs_date}"'
    for part in sorted((store_dir / "obs").glob("*.jsonl")):
        with part.open() as fh:
            for line in fh:
                if needle_code in line and needle_date in line:
                    row = json.loads(line)
                    if row["series_code"] == series_code and row["obs_date"] == obs_date:
                        return True
    return False


def missing_prints(today: str, store_dir: Path,
                   calendar_path: Path | None = None) -> list[dict]:
    """Releases due today whose anchor row for the reference month is absent."""
    out = []
    for rel in release_calendar.due_today(today, calendar_path):
        series = ANCHORS.get(rel["key"])
        if series is None:
            continue
        obs_date = f"{rel['reference_month']}-01"
        if not _has_obs(store_dir, series, obs_date):
            out.append({**rel, "series_code": series, "obs_date": obs_date})
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--today", required=True, help="ET calendar date, YYYY-MM-DD")
    ap.add_argument("--calendar", type=Path, default=None)
    args = ap.parse_args(argv)
    missing = missing_prints(args.today, args.store, args.calendar)
    for m in missing:
        print(f"missing today's {m['key'].upper()} print: {m['series_code']} "
              f"{m['reference_month']} not in store")
    print(f"republish={'true' if missing else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
