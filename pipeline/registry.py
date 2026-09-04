"""Series registry — the single source of truth for what the pipeline collects."""
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "series.json"


@dataclass(frozen=True)
class Source:
    name: str
    route: str            # "API" | "CSV" | "SCRAPE"
    cadence: str          # human-readable: "daily" | "weekly" | "monthly"
    secret: str | None    # env var holding the API key, if any
    secret_optional: bool


# Expected-absence policy kinds. A policy says "this series is allowed to sit
# past max_staleness_days, and here is why" — it is verified on every run by
# pipeline/freshness.py, never trusted blindly.
#   suppressed    — the source withholds the latest value(s) (QCEW small-cell
#                   disclosure suppression). Open-ended; a new print means the
#                   policy is stale and must be removed.
#   intermittent  — the source publishes only some months (BLS average prices
#                   need enough quotes). Bounded by max_absence_days (required).
#   discontinued  — the source stopped the series; history is kept. Open-ended;
#                   a new print means the policy is wrong.
ABSENCE_KINDS = ("suppressed", "intermittent", "discontinued")


@dataclass(frozen=True)
class Absence:
    kind: str                       # one of ABSENCE_KINDS
    note: str                       # why — published verbatim in qa.json
    review_by: str | None = None    # ISO date; policy fails QA after this
    max_absence_days: int | None = None  # intermittent: longest tolerated gap


@dataclass(frozen=True)
class Series:
    code: str             # internal, filename-safe
    source: str           # key into sources
    source_id: str        # provider-side identifier
    name: str
    max_staleness_days: int
    absence: Absence | None = None  # expected-absence policy, if any


def _parse_absence(code: str, raw: dict | None, limit: int) -> Absence | None:
    if raw is None:
        return None
    kind = raw.get("kind")
    if kind not in ABSENCE_KINDS:
        raise ValueError(f"series {code}: absence.kind must be one of "
                         f"{ABSENCE_KINDS}, got {kind!r}")
    note = raw.get("note")
    if not isinstance(note, str) or not note.strip():
        raise ValueError(f"series {code}: absence.note is required")
    review_by = raw.get("review_by")
    if review_by is not None:
        try:
            date.fromisoformat(review_by)
        except (TypeError, ValueError):
            raise ValueError(f"series {code}: absence.review_by must be an "
                             f"ISO date, got {review_by!r}") from None
    max_gap = raw.get("max_absence_days")
    if kind == "intermittent" and max_gap is None:
        raise ValueError(f"series {code}: intermittent absence needs "
                         f"max_absence_days")
    if max_gap is not None and (not isinstance(max_gap, int) or max_gap <= limit):
        raise ValueError(f"series {code}: absence.max_absence_days must be an "
                         f"int > max_staleness_days ({limit}), got {max_gap!r}")
    return Absence(kind=kind, note=note.strip(), review_by=review_by,
                   max_absence_days=max_gap)


def load_registry(path: Path | None = None) -> tuple[dict[str, Source], list[Series]]:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    sources = {n: Source(name=n, route=s["route"], cadence=s["cadence"],
                         secret=s.get("secret"),
                         secret_optional=s.get("secret_optional", False))
               for n, s in raw["sources"].items()}
    series = [Series(code=s["code"], source=s["source"], source_id=s["source_id"],
                     name=s["name"], max_staleness_days=s["max_staleness_days"],
                     absence=_parse_absence(s["code"], s.get("absence"),
                                            s["max_staleness_days"]))
              for s in raw["series"]]
    codes = [s.code for s in series]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"duplicate series codes: {sorted(dupes)}")
    for s in series:
        if s.source not in sources:
            raise ValueError(f"series {s.code} references unknown source {s.source}")
    return sources, series
