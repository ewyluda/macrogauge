"""Shared drift guards for the day-ahead LMP connectors (ercot, spp, nyiso).

Each grid operator publishes hourly day-ahead prices in its own file format;
once a connector has pulled one hub's hourly values for one delivery day, the
checks are identical: 23-25 hours (DST days included, slop to 20-28), every
cell numeric, and a daily mean inside the operator's plausible range. A
redesigned file fails here with a "structure drift?" error that collect_all's
failure isolation catches — never a silently wrong average."""
from datetime import date, timedelta

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

ROW_RANGE = (20, 28)   # hourly rows per delivery day, incl. DST slop


def window(days: int, end_offset: int = 0) -> list[str]:
    """Delivery dates oldest-first, ending today-ET + end_offset. Day-ahead
    files for today are posted the day before, so today is always available;
    the window heals the weekend days a weekday-only schedule never lands on."""
    anchor = date.fromisoformat(today_et()) + timedelta(days=end_offset)
    return [(anchor - timedelta(days=k)).isoformat() for k in range(days - 1, -1, -1)]


def daily_obs(source: str, hub: str, day: str, raw: list[str], vintage: str,
              plausible: tuple[float, float]) -> Observation:
    values = []
    for cell in raw:
        try:
            values.append(float(str(cell).strip()))
        except ValueError:
            raise ValueError(f"{source.lower()} {hub}: malformed price cell {cell!r} "
                             "(structure drift?)") from None
    if not ROW_RANGE[0] <= len(values) <= ROW_RANGE[1]:
        raise ValueError(f"{source.lower()} {hub} {day}: {len(values)} hourly rows outside "
                         f"{ROW_RANGE} (structure drift?)")
    mean = round(sum(values) / len(values), 2)
    if not plausible[0] <= mean <= plausible[1]:
        raise ValueError(f"{source.lower()} {hub} {day}: mean {mean} outside {plausible} "
                         "— structure drift?")
    return Observation(series_code=hub, obs_date=day, value=mean,
                       vintage_date=vintage, source=source, route="CSV")
