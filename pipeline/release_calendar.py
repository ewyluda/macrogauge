"""BLS CPI/PPI release calendar — static config, refreshed by hand once a year
(FRED release calendars rid=10 CPI, rid=46 PPI).

A date column for the gap table (1c spec §7), not a nowcast; nextprint.json
(countdown, who's-where) stays Phase 3."""
import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "release_calendar.json"


def next_print(today: str, path: Path | None = None) -> dict | None:
    """First CPI release on/after today; None once the calendar is exhausted."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    for entry in sorted(raw["cpi"], key=lambda e: e["release_date"]):
        if entry["release_date"] >= today:
            return {"date": entry["release_date"],
                    "reference_month": entry["reference_month"]}
    return None


def due_today(today: str, path: Path | None = None) -> list[dict]:
    """Every release (any key: cpi, ppi, ...) scheduled exactly on `today`.

    Feeds the workflow's release-day republish guard, not the nowcast."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    return [{"key": key, "date": e["release_date"], "reference_month": e["reference_month"]}
            for key, entries in sorted(raw.items())
            for e in entries if e["release_date"] == today]
