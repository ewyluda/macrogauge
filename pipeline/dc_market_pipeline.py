"""Market pipeline config — one broker's per-market MW under construction
for the /markets "Market pipeline" column (research 2026-10-07:
docs/research/2026-10-markets-construction-totals.md).

Loader precedent: pipeline/dc_longlead.py. ONE source fills the column, on
ONE basis, stated once at the top of the config: figures on different bases
(CBRE's colocation-only inventory, utility contracted load, county square
feet) never share it. A broker market is a named region, not our county
list, so each figure carries its region and a `fit` (close: the same metro;
wider: a larger region containing our counties; proxy: a region in which our
market is one of several named places) and the page names the region
whenever the fit is not close. A market the source does not break out
carries a null_note naming what was checked -- never a zero.

Every figure must appear beside its own MW measure in the verbatim quote:
operating MW, operator counts and vacancy rates cannot validate construction
MW. The quote is the receipt beside the number. The
text layer the quotes come from runs digits together ("39,340M W",
"5,52 3MW"); matching ignores a space or comma between two digits only.

A broken config raises at load; the markets phase catches that and publishes
the panel without the column (pipeline/run_daily.py), and CI loads the real
file (tests/test_dc_market_pipeline.py)."""
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_market_pipeline.json"

FITS = frozenset({"close", "wider", "proxy"})
BASES = frozenset({"colo+hyperscale-self-build"})
# A semi-annual report is stale once the edition after next is due: C&W's
# H2 edition lands ~5 months after its H1 one, so ~14 months past doc_date.
STALE_AFTER_DAYS = 430

_DASHED_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FIGURE_KEYS = ("region", "label", "fit", "mw_uc", "mw_operating", "mw_planned",
                "page", "quote")
_OPTIONAL_KEYS = ("map_labels", "region_note")
_QUOTE_LABELS = {
    "mw_uc": r"(?:Under\s+Construction|U/C)",
    "mw_operating": r"In\s+Operation",
    "mw_planned": r"Planned",
}


@dataclass(frozen=True)
class Source:
    publisher: str
    doc: str
    doc_date: str
    period: str
    url: str


@dataclass(frozen=True)
class MarketFigure:
    key: str
    region: str | None = None        # the broker's market name, verbatim
    label: str | None = None         # how the page names that region
    fit: str | None = None
    map_labels: tuple[str, ...] = ()
    region_note: str | None = None
    mw_uc: int | None = None         # the column
    mw_operating: int | None = None  # same box, shown beside it, never summed
    mw_planned: int | None = None
    page: int | None = None          # the flipbook page the quote is on
    quote: str | None = None
    null_note: str | None = None


@dataclass(frozen=True)
class PipelineConfig:
    as_of_curated: str
    source: Source
    basis: str
    basis_note: str
    markets: dict[str, MarketFigure]


def _iso(raw, where: str) -> str:
    if not isinstance(raw, str) or not _DASHED_ISO.match(raw):
        raise ValueError(f"dc_market_pipeline {where}: must be a YYYY-MM-DD date, got {raw!r}")
    try:
        date.fromisoformat(raw)
    except ValueError:
        raise ValueError(f"dc_market_pipeline {where}: not an ISO date: {raw!r}") from None
    return raw


def _text(raw, where: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"dc_market_pipeline {where}: must be a non-empty string")
    return raw


def _in_quote(n: int, quote: str, field: str) -> bool:
    joined = re.sub(r"(?<=\d)[ ,](?=\d)", "", quote)
    return re.search(
        rf"(?<![\d.,+\-]){n}\s*M\s*W\s+{_QUOTE_LABELS[field]}\b",
        joined, re.IGNORECASE) is not None


def _market(key: str, raw: dict) -> MarketFigure:
    where = f"market {key}"
    has_figure = any(k in raw for k in _FIGURE_KEYS)
    if has_figure == ("null_note" in raw):
        raise ValueError(f"dc_market_pipeline {where}: exactly one of figures or null_note")
    if not has_figure:
        stray = set(raw) - {"key", "null_note"}
        if stray:
            raise ValueError(f"dc_market_pipeline {where}: a null row carries {sorted(stray)}")
        return MarketFigure(key=key, null_note=_text(raw["null_note"], f"{where}.null_note"))
    missing = [k for k in _FIGURE_KEYS if k not in raw]
    if missing:
        raise ValueError(f"dc_market_pipeline {where}: missing {missing}")
    stray = set(raw) - {"key", *_FIGURE_KEYS, *_OPTIONAL_KEYS}
    if stray:
        raise ValueError(f"dc_market_pipeline {where}: unknown fields {sorted(stray)}")
    if raw["fit"] not in FITS:
        raise ValueError(f"dc_market_pipeline {where}: fit must be one of {sorted(FITS)}")
    quote = _text(raw["quote"], f"{where}.quote")
    mw = {}
    for k in ("mw_uc", "mw_operating", "mw_planned"):
        v = raw[k]
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise ValueError(f"dc_market_pipeline {where}: {k} must be a non-negative integer MW")
        if not _in_quote(v, quote, k):
            raise ValueError(
                f"dc_market_pipeline {where}: {k} {v} does not appear in its quote "
                "with its MW measure label")
        mw[k] = v
    page = raw["page"]
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise ValueError(f"dc_market_pipeline {where}: page must be a positive integer")
    labels = raw.get("map_labels", [])
    if not isinstance(labels, list) or not all(isinstance(s, str) and s for s in labels):
        raise ValueError(f"dc_market_pipeline {where}: map_labels must be a list of strings")
    note = raw.get("region_note")
    return MarketFigure(
        key=key, region=_text(raw["region"], f"{where}.region"),
        label=_text(raw["label"], f"{where}.label"), fit=raw["fit"],
        map_labels=tuple(labels),
        region_note=None if note is None else _text(note, f"{where}.region_note"),
        page=page, quote=quote, **mw)


def load(path: Path | None = None, market_keys: set[str] | None = None) -> PipelineConfig:
    """market_keys: the /markets roster (config/dc_markets.json). The column
    covers every market exactly once -- a figure or a null_note."""
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if not isinstance(raw, dict):
        raise ValueError("dc_market_pipeline: config must be an object")
    if raw.get("schema_version") != 1:
        raise ValueError("dc_market_pipeline: schema_version must be 1")
    src = raw.get("source")
    if not isinstance(src, dict):
        raise ValueError("dc_market_pipeline: source must be an object")
    url = _text(src.get("url"), "source.url")
    if not url.startswith("https://"):
        raise ValueError("dc_market_pipeline source.url: must be https")
    source = Source(publisher=_text(src.get("publisher"), "source.publisher"),
                    doc=_text(src.get("doc"), "source.doc"),
                    doc_date=_iso(src.get("doc_date"), "source.doc_date"),
                    period=_iso(src.get("period"), "source.period"), url=url)
    if raw.get("basis") not in BASES:
        raise ValueError(f"dc_market_pipeline: basis must be one of {sorted(BASES)}")
    rows = raw.get("markets")
    if not isinstance(rows, list) or not rows:
        raise ValueError("dc_market_pipeline: markets must be a non-empty list")
    markets: dict[str, MarketFigure] = {}
    for r in rows:
        if not isinstance(r, dict):
            raise ValueError("dc_market_pipeline: market row must be an object")
        key = _text(r.get("key"), "market key")
        if key in markets:
            raise ValueError(f"dc_market_pipeline market {key}: duplicate key")
        markets[key] = _market(key, r)
    if market_keys is not None and set(markets) != set(market_keys):
        raise ValueError(
            "dc_market_pipeline: keys must match the /markets roster -- "
            f"missing {sorted(set(market_keys) - set(markets))}, "
            f"unknown {sorted(set(markets) - set(market_keys))}")
    return PipelineConfig(as_of_curated=_iso(raw.get("as_of_curated"), "as_of_curated"),
                          source=source, basis=raw["basis"],
                          basis_note=_text(raw.get("basis_note"), "basis_note"),
                          markets=markets)


def is_stale(doc_date: str, today: str) -> bool:
    return (date.fromisoformat(today) - date.fromisoformat(doc_date)).days > STALE_AFTER_DAYS
