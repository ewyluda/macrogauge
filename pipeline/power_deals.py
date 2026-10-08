"""Power deals — the PPAs and other dedicated supply deals behind the
/capacity companies' data centers (Session 5 Option 2, 2026-10-08;
research docs/research/2026-10-capacity-ppas.md).

Hand-curated from each deal's own release or filing, the
pipeline/issuer_bonds.py pattern: every deal carries the verbatim quote it was
read from, its MW figure must appear in that quote (as MW, or as GW for a
"3 gigawatts" quote), and the evidence text is committed under
docs/research/evidence/ (checked verbatim in tests/test_power_deals.py).

`status` says how firm a deal is (signed; pending regulator approval; MOU,
LOI or option) and `kind` what it is (a PPA; utility-built supply under a
service agreement or tariff; a development or funding deal with energy
rights; other), because most of the signed MW is not a literal PPA. `sites`
multiplies a per-site figure ("three sites, each at least 600 MW").

A broken config raises at load; the capacity phase catches it and publishes
the tracker without the block, and CI loads the real file."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "power_deals.json"

STATUSES = ("signed", "pending", "mou", "loi", "option")
KINDS = ("ppa", "utility supply", "development / funding", "other")
TECHNOLOGIES = frozenset({"nuclear (existing)", "nuclear (restart)", "nuclear (SMR/advanced)", "gas",
                          "geothermal", "solar", "wind", "storage", "hydro", "other"})
MW_BASES = frozenset({"contracted", "nameplate"})
_DATE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
_REQUIRED = ("t", "counterparty", "facility", "technology", "mw", "mw_basis", "status", "kind",
             "instrument", "announced", "source", "evidence", "quote")


@dataclass(frozen=True)
class PowerDeal:
    t: str
    counterparty: str
    facility: str
    technology: str
    mw: float               # the quoted figure
    sites: int
    mw_basis: str
    status: str
    kind: str
    instrument: str         # the source's own description of the agreement
    announced: str          # YYYY-MM-DD, or YYYY-MM when the source gives no day
    term_years: int | None
    start: str | None       # free text as the source states it
    src_publisher: str
    src_title: str
    src_url: str
    evidence: str
    quote: str
    note: str | None

    @property
    def mw_total(self) -> float:
        return self.mw * self.sites


def mw_in_quote(mw: float, quote: str) -> bool:
    """The figure as the source prints it: "1,121 MW", "835 megawatts",
    "2,300 megawatts (MW)" or, for whole gigawatts, "3 gigawatts" / "3 GW"."""
    joined = re.sub(r"(?<=\d),(?=\d)", "", quote)
    if re.search(rf"(?<![\d.]){re.escape(f'{mw:g}')}(?![\d.])", joined):
        return True
    gw = mw / 1000
    return re.search(rf"(?<![\d.]){re.escape(f'{gw:g}')}\s?(GW|gigawatts?)\b", joined, re.I) is not None


def _deal(raw: dict, i: int, tickers: set[str] | None) -> PowerDeal:
    where = f"power_deals deal {i} ({raw.get('t')}/{raw.get('counterparty')})"
    missing = [k for k in _REQUIRED if raw.get(k) in (None, "")]
    if missing:
        raise ValueError(f"{where}: missing {missing}")
    if tickers is not None and raw["t"] not in tickers:
        raise ValueError(f"{where}: ticker {raw['t']!r} is not a capacity company")
    for field, allowed in (("status", STATUSES), ("kind", KINDS), ("technology", TECHNOLOGIES),
                           ("mw_basis", MW_BASES)):
        if raw[field] not in allowed:
            raise ValueError(f"{where}: {field} {raw[field]!r} not in {sorted(allowed)}")
    mw, sites = raw["mw"], raw.get("sites", 1)
    if not isinstance(mw, (int, float)) or isinstance(mw, bool) or mw < 100:
        raise ValueError(f"{where}: mw must be a number >= 100, got {mw!r}")
    if not isinstance(sites, int) or isinstance(sites, bool) or sites < 1:
        raise ValueError(f"{where}: sites must be a positive integer")
    if not mw_in_quote(mw, raw["quote"]):
        raise ValueError(f"{where}: {mw:g} MW does not appear in its quote")
    if not _DATE.match(raw["announced"]):
        raise ValueError(f"{where}: announced must be YYYY-MM-DD or YYYY-MM")
    src = raw["source"]
    if not all(src.get(k) for k in ("publisher", "title", "url")):
        raise ValueError(f"{where}: source needs publisher, title and url")
    return PowerDeal(t=raw["t"], counterparty=raw["counterparty"], facility=raw["facility"],
                     technology=raw["technology"], mw=mw, sites=sites, mw_basis=raw["mw_basis"],
                     status=raw["status"], kind=raw["kind"], instrument=raw["instrument"],
                     announced=raw["announced"], term_years=raw.get("term_years"),
                     start=raw.get("start"), src_publisher=src["publisher"], src_title=src["title"],
                     src_url=src["url"], evidence=raw["evidence"], quote=raw["quote"],
                     note=raw.get("note"))


@dataclass(frozen=True)
class Config:
    as_of_curated: str
    basis: str
    mw_note: str
    deals: tuple[PowerDeal, ...]


def load(path: Path | None = None, tickers: set[str] | None = None) -> Config:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    deals = tuple(_deal(d, i, tickers) for i, d in enumerate(raw["deals"]))
    keys = [(d.t, d.counterparty, d.facility) for d in deals]
    if len(keys) != len(set(keys)):
        raise ValueError("power_deals: duplicate (ticker, counterparty, facility) row")
    return Config(as_of_curated=raw["as_of_curated"], basis=raw["basis"], mw_note=raw["mw_note"],
                  deals=deals)
