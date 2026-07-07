from dataclasses import dataclass


@dataclass(frozen=True)
class Observation:
    """One value for one series, stamped with the date we learned it."""
    series_code: str
    obs_date: str      # YYYY-MM-DD the observation refers to
    value: float
    vintage_date: str  # YYYY-MM-DD we learned this value
    source: str        # e.g. "FRED"
    route: str         # e.g. "API" | "CSV" | "SCRAPE"
