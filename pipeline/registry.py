"""Series registry — the single source of truth for what the pipeline collects."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "series.json"


@dataclass(frozen=True)
class Source:
    name: str
    route: str            # "API" | "CSV" | "SCRAPE"
    cadence: str          # human-readable: "daily" | "weekly" | "monthly"
    secret: str | None    # env var holding the API key, if any
    secret_optional: bool


@dataclass(frozen=True)
class Series:
    code: str             # internal, filename-safe
    source: str           # key into sources
    source_id: str        # provider-side identifier
    name: str
    max_staleness_days: int


def load_registry(path: Path | None = None) -> tuple[dict[str, Source], list[Series]]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    sources = {n: Source(name=n, route=s["route"], cadence=s["cadence"],
                         secret=s.get("secret"),
                         secret_optional=s.get("secret_optional", False))
               for n, s in raw["sources"].items()}
    series = [Series(code=s["code"], source=s["source"], source_id=s["source_id"],
                     name=s["name"], max_staleness_days=s["max_staleness_days"])
              for s in raw["series"]]
    codes = [s.code for s in series]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"duplicate series codes: {sorted(dupes)}")
    for s in series:
        if s.source not in sources:
            raise ValueError(f"series {s.code} references unknown source {s.source}")
    return sources, series
