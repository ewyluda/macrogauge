"""DC context-layer config — hand-seeded demand-side cards (spec §3).

Loader precedent: pipeline/dc_power.py. Every card carries asof + source so
staleness stays visible on-site; a typo'd or emptied config must fail loudly
at load time, never publish a blank or garbled card. Fail-loud means a
ValueError here: in the daily run that is confined to the datacenter phase
(datacenter_ok=false in qa, exit 0 — run_daily's isolation contract, same as
a bad basket or capacity config), and the gate that actually keeps a bad
config off main is CI, where test_load_real_config loads this very file. The transformer card is
OPTIONAL end-to-end: it ships only when a primary source confirmed it
(spike-gated, spec §2).

**Omit, do not label.** That transformer precedent governs `peers` too: a peer
whose figure cannot be traced to a fetched page and a verbatim quote is simply
ABSENT from the array. There is deliberately no `confidence` field to hide
behind — see docs/plans/2026-07-26-dc-peer-panel.md, which is the evidence gate
every seeded row passed through. `quote` carries that evidence into git next to
the number so a reviewer can diff a figure against its source without leaving
the repo.
"""
import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_context.json"

REQUIRED = {
    "colo": ("rate_kw_mo", "yoy_pct", "vacancy_pct", "under_construction_gw"),
    "queue": ("generation_gw", "storage_gw"),
    "transformer": ("weeks",),
}

# Which side of the contract the peer's number sits on. This is the load-bearing
# label on the panel: we price INPUTS, and almost every available peer prices
# BIDS (what an owner pays at tender) or OUTPUT (what a contractor receives).
# In a margin-compression year those diverge and neither is wrong.
BASES = frozenset({"input_cost", "bid_price", "output_price", "cost_model"})
# What the peer actually prices — never assume "construction index" means ours.
SCOPES = frozenset({"dc", "nonres_building", "office_building"})
# Which arithmetic produced the annual %. Mixing these silently in one column
# is the quietest error available: RLB's own level series yields 5.2% or 4.7%
# for the same year depending only on this choice.
PERIOD_BASES = frozenset({"calendar_year", "annual_average", "dec_over_dec"})
GEOGRAPHIES = frozenset({"us", "global"})

PEER_TEXT = ("key", "firm", "short", "publication", "source", "asof", "caveat", "quote")
PEER_ENUMS = (("scope", SCOPES), ("basis", BASES),
              ("period_basis", PERIOD_BASES), ("geography", GEOGRAPHIES))


@dataclass(frozen=True)
class Card:
    fields: dict   # the card's numeric values (REQUIRED[name] keys only)
    asof: str
    source: str


@dataclass(frozen=True)
class Peer:
    """One external calibration series. `rows` are ascending
    {"year": int, "escalation_pct": float}; `derived` marks a peer whose
    percentages we computed ourselves from published levels (BLS), so the UI
    can say so rather than implying the publisher printed them."""
    key: str
    firm: str
    short: str
    publication: str
    source: str
    asof: str
    scope: str
    basis: str
    period_basis: str
    geography: str
    derived: bool
    caveat: str
    quote: str
    rows: tuple[dict, ...]


@dataclass(frozen=True)
class ContextConfig:
    colo: Card
    queue: Card
    peers: tuple[Peer, ...]
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


def _peer(raw: dict, i: int) -> Peer:
    where = f"dc_context peers[{i}]"
    for key in PEER_TEXT:
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"{where}: {key} must be a non-empty string")
    for key, allowed in PEER_ENUMS:
        if raw.get(key) not in allowed:
            raise ValueError(f"{where} ({raw['key']}): {key} must be one of "
                             f"{sorted(allowed)}, got {raw.get(key)!r}")
    if not isinstance(raw.get("derived"), bool):
        raise ValueError(f"{where} ({raw['key']}): derived must be a bool")
    rows = raw.get("rows") or []
    if not rows:
        raise ValueError(f"{where} ({raw['key']}): rows must be non-empty")
    years = [r.get("year") for r in rows]
    if (not all(isinstance(y, int) and not isinstance(y, bool) for y in years)
            or years != sorted(years) or len(set(years)) != len(years)):
        raise ValueError(f"{where} ({raw['key']}): rows need ascending unique "
                         "integer years")
    for r in rows:
        if (not isinstance(r.get("escalation_pct"), (int, float))
                or isinstance(r.get("escalation_pct"), bool)):
            raise ValueError(f"{where} ({raw['key']}): escalation_pct must be numeric")
    return Peer(rows=tuple(rows),
                **{k: raw[k] for k in PEER_TEXT},
                **{k: raw[k] for k, _ in PEER_ENUMS},
                derived=raw["derived"])


def load(path: Path | None = None) -> ContextConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    peers_raw = raw.get("peers") or []
    if not peers_raw:
        raise ValueError("dc_context peers: must be non-empty")
    peers = tuple(_peer(p, i) for i, p in enumerate(peers_raw))
    keys = [p.key for p in peers]
    if len(set(keys)) != len(keys):
        raise ValueError(f"dc_context peers: keys must be unique, got {keys}")
    transformer = raw.get("transformer")
    return ContextConfig(
        colo=_card(raw["colo"], "colo"),
        queue=_card(raw["queue"], "queue"),
        peers=peers,
        transformer=None if transformer is None else _card(transformer, "transformer"))
