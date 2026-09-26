"""Once-per-day publish gate for the daily workflow.

Moved out of inline shell (2026-09-26) so the window, the already-published
check and the release-day guard are unit-tested. Stdlib only — the workflow
calls it before pip install.

Why the window is so wide: GitHub's cron slip grew from ~45 min (mid-August)
to a 4-5.5h weekly median by late September 2026, and on 2026-08-28 every
firing landed after the old 15:59 ET cutoff, so no publish happened at all.
The already-published check is what prevents double publishes — the window
only excludes the EST cron's pre-8:00 firing during EDT and runs so late
that they'd collide with the next morning's.
"""
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline import release_gate

ET = ZoneInfo("America/New_York")
WINDOW_START_HOUR = 8   # inclusive
WINDOW_END_HOUR = 21    # inclusive: 21:59 ET is the last publishing minute
GATED_EVENTS = {"schedule", "repository_dispatch"}


def decide(event: str, hour: int, published_today: bool,
           republish_needed: bool) -> tuple[bool, str]:
    """(run?, reason). workflow_dispatch always runs — a human asked for it."""
    if event not in GATED_EVENTS:
        return True, f"{event}: ungated"
    if hour < WINDOW_START_HOUR or hour > WINDOW_END_HOUR:
        return False, (f"outside ET window (hour {hour}; publishes "
                       f"{WINDOW_START_HOUR}:00-{WINDOW_END_HOUR}:59 ET)")
    if published_today:
        if republish_needed:
            return True, ("already published today, but today's print is still "
                          "missing — republishing")
        return False, "already published today"
    return True, "first publish today"


def published_on(day: str, ref: str = "origin/main", cwd: Path | None = None) -> bool:
    """Does `ref` carry a `data: daily publish <day>` commit? Reads the REMOTE
    ref (fetched by the caller), not HEAD: a queued run's checkout is pinned
    to the commit that existed when the run was created, which can predate
    today's publish."""
    out = subprocess.run(
        ["git", "log", ref, "--since=7 days ago", "--format=%s",
         f"--grep=^data: daily publish {day}"],
        cwd=cwd, capture_output=True, text=True, check=True).stdout
    return bool(out.strip())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--event", required=True)
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--ref", default="origin/main")
    ap.add_argument("--now", default=None, help="ISO datetime override (tests)")
    args = ap.parse_args(argv)
    now = (datetime.fromisoformat(args.now).astimezone(ET) if args.now
           else datetime.now(ET))
    today = now.date().isoformat()
    published = args.event in GATED_EVENTS and published_on(today, args.ref)
    republish = False
    if published:
        missing = release_gate.missing_prints(today, args.store)
        for m in missing:
            print(f"missing today's {m['key'].upper()} print: {m['series_code']} "
                  f"{m['reference_month']} not in store")
        republish = bool(missing)
    run, reason = decide(args.event, now.hour, published, republish)
    print(reason)
    print(f"run={'true' if run else 'false'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
