"""Release calendar — BLS CPI/PPI (+ BEA Personal Income & Outlays, BLS
Employment Situation) release dates.

Two layers, merged on read:
  * config/release_calendar.json — the hand-seeded calendar (stays as the
    floor; tests and the stdlib release-day guard can run on it alone);
  * store/calendar/releases.json — refreshed every run from FRED's
    release/dates API (pipeline/calendar_refresh.py), so new years appear as
    soon as the agencies publish their schedules. Before 2026-09-26 the
    calendar was hand-refreshed once a year and would have run out after the
    2026-12-10 CPI print: the nowcast would have gone "unavailable", forecasts
    would have stopped recording, and the RSS route would have failed the
    static build.

A date column for the gap table (1c spec §7), not a nowcast; nextprint.json
(countdown, who's-where) stays Phase 3. Stdlib only — the workflow's gate
imports this before pip install."""
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
DEFAULT_PATH = ROOT / "config" / "release_calendar.json"
REFRESHED_PATH = ROOT / "store" / "calendar" / "releases.json"


def use_store(store_dir: Path) -> None:
    """Point the merged read at a run's --store (run_daily calls this; the
    default already matches the repo layout the workflow uses)."""
    global REFRESHED_PATH
    REFRESHED_PATH = Path(store_dir) / "calendar" / "releases.json"


def load(path: Path | None = None, refreshed_path: Path | None = None) -> dict[str, list[dict]]:
    """{key: [{release_date, reference_month}, ...]} sorted by release date.

    With the default config path, the FRED-refreshed store file is merged
    over it (a refreshed date replaces the seeded one for the same reference
    month — agencies occasionally reschedule). An explicit `path` reads that
    file alone unless `refreshed_path` is also given."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    extra_path = refreshed_path if refreshed_path is not None else (
        REFRESHED_PATH if path is None else None)
    if extra_path is not None and extra_path.exists():
        for key, entries in json.loads(extra_path.read_text()).items():
            if key.startswith("_"):
                continue
            by_month = {e["reference_month"]: e for e in raw.get(key, [])}
            by_month.update({e["reference_month"]: e for e in entries})
            raw[key] = list(by_month.values())
    return {k: sorted(v, key=lambda e: e["release_date"])
            for k, v in raw.items() if not k.startswith("_")}


def next_print(today: str, path: Path | None = None) -> dict | None:
    """First CPI release on/after today; None once the calendar is exhausted."""
    for entry in load(path).get("cpi", []):
        if entry["release_date"] >= today:
            return {"date": entry["release_date"],
                    "reference_month": entry["reference_month"]}
    return None


def _add_month(ym: str, n: int = 1) -> str:
    y, m = map(int, ym.split("-"))
    y, m = divmod(y * 12 + m - 1 + n, 12)
    return f"{y:04d}-{m + 1:02d}"


def next_target(today: str, path: Path | None = None) -> dict | None:
    """The CPI release the nowcast should target. Same as next_print while the
    calendar has a future entry; once it is exhausted, infer the reference
    month (the month after the last scheduled one whose mid-following-month
    release has not passed) with an unknown release date — so forecasts keep
    recording and grading (which reads actual release vintages) keeps working."""
    nxt = next_print(today, path)
    if nxt is not None:
        return nxt
    cpi = load(path).get("cpi", [])
    if not cpi:
        return None
    ref = cpi[-1]["reference_month"]
    while True:
        ref = _add_month(ref)
        if f"{_add_month(ref)}-15" >= today:
            return {"date": None, "reference_month": ref}


def horizon_days(today: str, key: str = "cpi", path: Path | None = None) -> int | None:
    """Days from today to the last scheduled release for `key` (negative once
    exhausted) — feeds the calendar_horizon qa check."""
    from datetime import date
    entries = load(path).get(key, [])
    if not entries:
        return None
    return (date.fromisoformat(entries[-1]["release_date"]) - date.fromisoformat(today)).days


def due_today(today: str, path: Path | None = None) -> list[dict]:
    """Every release (any key: cpi, ppi, pce, nfp) scheduled exactly on `today`.

    Feeds the workflow's release-day republish guard, not the nowcast."""
    return [{"key": key, "date": e["release_date"], "reference_month": e["reference_month"]}
            for key, entries in sorted(load(path).items())
            for e in entries if e["release_date"] == today]
