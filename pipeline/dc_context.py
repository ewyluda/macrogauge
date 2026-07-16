"""DC context-layer config — hand-seeded demand-side cards (spec §3).

Loader precedent: pipeline/dc_power.py. Every card carries asof + source so
staleness stays visible on-site; a typo'd or emptied config must fail loudly
at load time, never publish a blank or garbled card. The transformer card is
OPTIONAL end-to-end: it ships only when a primary source confirmed it
(spike-gated, spec §2)."""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_context.json"

REQUIRED = {
    "colo": ("rate_kw_mo", "yoy_pct", "vacancy_pct", "under_construction_gw"),
    "queue": ("generation_gw", "storage_gw"),
    "transformer": ("weeks",),
}


@dataclass(frozen=True)
class Card:
    fields: dict   # the card's numeric values (REQUIRED[name] keys only)
    asof: str
    source: str


@dataclass(frozen=True)
class ContextConfig:
    colo: Card
    queue: Card
    tnt_rows: tuple[dict, ...]   # ascending {"year": int, "escalation_pct": float}
    tnt_asof: str
    tnt_source: str
    transformer: Card | None


def _card(raw: dict, name: str) -> Card:
    for key in REQUIRED[name]:
        if not isinstance(raw.get(key), (int, float)) or isinstance(raw.get(key), bool):
            raise ValueError(f"dc_context {name}: {key} must be numeric")
    for key in ("asof", "source"):
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"dc_context {name}: {key} must be a non-empty string")
    return Card(fields={k: raw[k] for k in REQUIRED[name]},
                asof=raw["asof"], source=raw["source"])


def load(path: Path | None = None) -> ContextConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    tnt = raw["tnt"]
    rows = tnt.get("rows", [])
    if not rows:
        raise ValueError("dc_context tnt: rows must be non-empty")
    years = [r.get("year") for r in rows]
    if not all(isinstance(y, int) for y in years) or years != sorted(years):
        raise ValueError("dc_context tnt: rows need ascending integer years")
    for r in rows:
        if not isinstance(r.get("escalation_pct"), (int, float)):
            raise ValueError("dc_context tnt: escalation_pct must be numeric")
    if not tnt.get("asof") or not tnt.get("source"):
        raise ValueError("dc_context tnt: asof and source required")
    transformer = raw.get("transformer")
    return ContextConfig(
        colo=_card(raw["colo"], "colo"),
        queue=_card(raw["queue"], "queue"),
        tnt_rows=tuple(rows), tnt_asof=tnt["asof"], tnt_source=tnt["source"],
        transformer=None if transformer is None else _card(transformer, "transformer"))
