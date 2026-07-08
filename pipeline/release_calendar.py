"""BLS CPI release calendar — static config, refreshed by hand once a year.

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
