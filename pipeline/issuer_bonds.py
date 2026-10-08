"""Issuer bond pricing — what the AI builders paid on their latest USD debt
(/rates "What the builders pay to borrow"; plan D3,
docs/plans/2026-10-08-annotation-review-plan.md PR 5).

New-issue terms only, hand-curated from each issuer's own filing: an SEC
pricing term sheet (FWP) or 424B2 prospectus supplement for the shelf
issuers, an 8-K/6-K or its press-release exhibit for 144A deals. Never a
secondary-market quote (no free daily source was usable: TradingView's bond
scanner rate-limits, FINRA TRACE needs credentials). A deal is a dated
receipt, not a live yield.

Every deal carries the verbatim quote it was read from, and the coupon must
appear in it. A spread stated by the term sheet publishes as stated; else
the writer computes yield minus the Treasury curve on the pricing date at the
bond's maturity, and says so. Convertible notes are listed but flagged not
comparable: their coupon prices an equity option, not credit.

A broken config raises at load; the rates phase catches it and publishes the
panel without the block (pipeline/publish/rates.py), and CI loads the real
file (tests/test_issuer_bonds.py)."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "issuer_bonds.json"

COHORTS = ("hyperscaler", "neocloud")
INSTRUMENTS = frozenset({"senior notes", "convertible notes"})
_DASHED_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_REQUIRED = ("issuer", "name", "cohort", "deal_date", "instrument", "tranche", "coupon",
             "maturity", "amount_usd_b", "quote", "src")


@dataclass(frozen=True)
class Deal:
    issuer: str
    name: str
    cohort: str
    deal_date: str        # pricing date
    instrument: str
    tranche: str
    coupon: float         # % per year
    maturity: str
    amount_usd_b: float
    yield_pct: float | None       # re-offer yield as stated; None when not stated
    spread_bp: float | None       # spread to the benchmark Treasury as stated
    benchmark: str | None
    issued_at_par: bool           # the source says par: yield at issue = coupon
    quote: str
    src_label: str
    src_url: str

    @property
    def comparable(self) -> bool:
        return self.instrument == "senior notes"


@dataclass(frozen=True)
class Config:
    as_of_curated: str
    note: str
    deals: tuple[Deal, ...]


def _coupon_in_quote(coupon: float, quote: str) -> bool:
    """The coupon as the filing prints it: 4.5 matches "4.500%", "4.50%",
    "4.5%" or "4 1/2%"-free decimals; a space before % is tolerated."""
    forms = {f"{coupon:.3f}", f"{coupon:.2f}", f"{coupon:g}", f"{coupon:.1f}"}
    return any(re.search(rf"(?<![\d.]){re.escape(f)}\s?%", quote) for f in forms)


def _deal(raw: dict, i: int) -> Deal:
    where = f"issuer_bonds deal {i}"
    missing = [k for k in _REQUIRED if raw.get(k) in (None, "")]
    if missing:
        raise ValueError(f"{where}: missing {missing}")
    if raw["cohort"] not in COHORTS:
        raise ValueError(f"{where}: cohort {raw['cohort']!r} not in {COHORTS}")
    if raw["instrument"] not in INSTRUMENTS:
        raise ValueError(f"{where}: instrument {raw['instrument']!r} not in {sorted(INSTRUMENTS)}")
    for k in ("deal_date", "maturity"):
        if not _DASHED_ISO.match(str(raw[k])):
            raise ValueError(f"{where}: {k} must be YYYY-MM-DD")
    if raw["maturity"] <= raw["deal_date"]:
        raise ValueError(f"{where}: maturity must follow the deal date")
    coupon = float(raw["coupon"])
    if not 0 <= coupon <= 25:
        raise ValueError(f"{where}: coupon {coupon}% implausible")
    if not _coupon_in_quote(coupon, raw["quote"]):
        raise ValueError(f"{where}: coupon {coupon}% does not appear in its quote")
    src = raw["src"]
    if not (isinstance(src, list) and len(src) == 2 and str(src[1]).startswith("https://")):
        raise ValueError(f"{where}: src must be [label, https url]")
    y, sp = raw.get("yield_pct"), raw.get("spread_bp")
    return Deal(issuer=raw["issuer"], name=raw["name"], cohort=raw["cohort"], deal_date=raw["deal_date"],
                instrument=raw["instrument"], tranche=raw["tranche"], coupon=coupon,
                maturity=raw["maturity"], amount_usd_b=float(raw["amount_usd_b"]),
                yield_pct=None if y is None else float(y), spread_bp=None if sp is None else float(sp),
                benchmark=raw.get("benchmark"), issued_at_par=raw.get("issued_at_par") is True,
                quote=raw["quote"], src_label=src[0], src_url=src[1])


def load(path: Path = DEFAULT_PATH) -> Config:
    raw = json.loads(Path(path).read_text())
    if raw.get("schema_version") != 1:
        raise ValueError("issuer_bonds: schema_version must be 1")
    if not _DASHED_ISO.match(str(raw.get("as_of_curated", ""))):
        raise ValueError("issuer_bonds: as_of_curated must be YYYY-MM-DD")
    deals = tuple(_deal(d, i) for i, d in enumerate(raw.get("deals") or []))
    if not deals:
        raise ValueError("issuer_bonds: deals must be a non-empty list")
    return Config(as_of_curated=raw["as_of_curated"], note=raw.get("note", ""), deals=deals)
