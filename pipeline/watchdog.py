"""Publish watchdog: fail loudly when a weekday closed without a publish, or
when the latest publish has a failing CRITICAL qa check.

The daily workflow exits 0 when gated out and run_daily always returns 0 —
correct for isolation, but it meant 2026-08-28 (no publish at all) and every
critical-qa day stayed green. A red scheduled run is what triggers GitHub's
failure email, so this module's only job is to turn those states red.

Stdlib only.
"""
import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline.publish_gate import WINDOW_END_HOUR, published_on

ET = ZoneInfo("America/New_York")


def last_closed_weekday(now_et: datetime) -> date:
    """The most recent weekday whose publish window has fully closed."""
    d = now_et.date()
    if now_et.hour <= WINDOW_END_HOUR:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def critical_failures(qa: dict) -> list[str]:
    return [f"{c['name']}: {c.get('detail', '')}" for c in qa.get("checks", [])
            if c.get("critical") and not c.get("pass")]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--qa", type=Path, default=Path("site/public/data/qa.json"))
    ap.add_argument("--ref", default="origin/main")
    ap.add_argument("--now", default=None, help="ISO datetime override (tests)")
    ap.add_argument("--skip-publish-check", action="store_true",
                    help="only check qa (used right after a publish)")
    args = ap.parse_args(argv)
    now = (datetime.fromisoformat(args.now).astimezone(ET) if args.now
           else datetime.now(ET))
    problems = []
    if not args.skip_publish_check:
        day = last_closed_weekday(now).isoformat()
        if published_on(day, args.ref):
            print(f"publish found for {day}")
        else:
            problems.append(f"no 'data: daily publish {day}' commit on {args.ref}")
    fails = critical_failures(json.loads(args.qa.read_text()))
    problems += [f"critical qa check failing — {f}" for f in fails]
    for p in problems:
        print(f"::error::{p}")
    if not problems:
        print("watchdog: ok")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
