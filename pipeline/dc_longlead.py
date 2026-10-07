"""Long-lead board config — hand-curated vendor order-book figures (P4 spec §5).

Loader precedent: pipeline/dc_context.py. STATED-ONLY is the load-bearing
rule: every figure is something the vendor itself published — verbatim metric
name, verbatim quote, primary-source URL — never a derived book-to-bill or a
summed backlog. "Backlog" is at least three different accounting objects
(ASC-606 RPO, an orders-based order book, an MD&A believed-firm figure), so
each figure carries basis/scope classifiers the site renders as badges;
figures with different bases never share an axis or a sum. A vendor with
nothing at primary-source standard is a published null_note, not an absence
(the context.transformer precedent) — the null IS the finding. A typo'd or
emptied config must fail loudly at load time: in the daily run that is
confined to the longlead phase (longlead_ok=false, exit 0), and the gate that
keeps a bad config off main is CI, where test_load_real_config loads this
very file."""
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "dc_longlead.json"

# Dashed form only: date.fromisoformat also accepts "20260201" and week
# dates, and a compact asof would outrank every dashed date in the publisher's
# lexicographic max(), aging staleness from the wrong figure.
_DASHED_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

KINDS = frozenset({"backlog", "orders", "book_to_bill", "backlog_growth"})
BASES = frozenset({"rpo", "order-backlog", "mdna-backlog"})
SCOPES = frozenset({"group", "segment", "product-line"})
UNITS = frozenset({"usd_b", "eur_b", "jpy_tn", "pct_yoy", "ratio"})
CADENCES = frozenset({"quarterly", "annual"})
# Lead times are stated-only too, and as varied in basis as backlog: an
# industry survey's average weeks, an industry report's average, or a
# vendor's own statement of how far out it is taking orders ("through" a year).
LEAD_BASES = frozenset({"industry-survey", "industry-report", "vendor-statement"})


@dataclass(frozen=True)
class Figure:
    metric: str
    kind: str
    basis: str
    scope: str
    value: float
    unit: str
    period: str      # the date the figure measures (e.g. the quarter end)
    asof: str        # the source document's date; staleness ages on this
    quote: str       # verbatim from the document — the receipt beside the number
    src_label: str
    src_url: str


@dataclass(frozen=True)
class LeadTime:
    item: str            # what the figure covers, e.g. "Power transformers"
    weeks: float | None  # an average lead time in weeks...
    through: str | None  # ...or the year a vendor is taking orders into (exactly one)
    basis: str
    period: str          # the date the figure measures
    asof: str            # the source document's date
    quote: str
    src_label: str
    src_url: str


@dataclass(frozen=True)
class Vendor:
    key: str
    name: str
    ticker: str
    listed: str
    dc_segment: str
    cadence: str
    figures: tuple[Figure, ...]
    null_note: str | None
    # why the newest figures are older than the cadence implies (a vendor
    # that stopped stating a metric) — shown beside the stale flag
    disclosure_note: str | None = None


@dataclass(frozen=True)
class Package:
    code: str
    vendor_keys: tuple[str, ...]
    null_note: str | None
    lead_times: tuple[LeadTime, ...] = ()


@dataclass(frozen=True)
class LongLeadConfig:
    as_of_curated: str
    packages: tuple[Package, ...]
    vendors: dict[str, Vendor]
    teaser: tuple[tuple[str, str], ...]  # (vendor_key, kind) /datacenter strip picks
    lead_time_benchmark: LeadTime | None = None  # one all-equipment reference figure


def _iso(raw, where: str) -> str:
    if not isinstance(raw, str) or not _DASHED_ISO.match(raw):
        raise ValueError(
            f"dc_longlead {where}: must be a YYYY-MM-DD date string, got {raw!r}")
    try:
        date.fromisoformat(raw)
    except ValueError:
        raise ValueError(f"dc_longlead {where}: not an ISO date: {raw!r}") from None
    return raw


def _src(raw: dict, where: str) -> tuple[str, str]:
    src = raw.get("src")
    if (not isinstance(src, list) or len(src) != 2
            or not all(isinstance(s, str) and s for s in src)):
        raise ValueError(f"dc_longlead {where}: src must be [label, url]")
    if not src[1].startswith("https://"):
        raise ValueError(f"dc_longlead {where}: src url must be https")
    return src[0], src[1]


def _lead_time(raw: dict, where: str) -> LeadTime:
    if raw.get("basis") not in LEAD_BASES:
        raise ValueError(f"dc_longlead {where}: basis must be one of {sorted(LEAD_BASES)}")
    for key in ("item", "quote"):
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"dc_longlead {where}: {key} must be non-empty")
    weeks, through = raw.get("weeks"), raw.get("through")
    if (weeks is None) == (through is None):
        raise ValueError(f"dc_longlead {where}: exactly one of weeks or through")
    if weeks is not None and (not isinstance(weeks, (int, float)) or isinstance(weeks, bool) or weeks <= 0):
        raise ValueError(f"dc_longlead {where}: weeks must be a positive number")
    if through is not None and not (isinstance(through, str) and re.fullmatch(r"\d{4}", through)):
        raise ValueError(f"dc_longlead {where}: through must be a year string like '2028'")
    label, url = _src(raw, where)
    return LeadTime(item=raw["item"], weeks=None if weeks is None else float(weeks),
                    through=through, basis=raw["basis"],
                    period=_iso(raw.get("period"), f"{where}.period"),
                    asof=_iso(raw.get("asof"), f"{where}.asof"),
                    quote=raw["quote"], src_label=label, src_url=url)


def _figure(raw: dict, where: str) -> Figure:
    for key, allowed in (("kind", KINDS), ("basis", BASES),
                         ("scope", SCOPES), ("unit", UNITS)):
        if raw.get(key) not in allowed:
            raise ValueError(
                f"dc_longlead {where}: {key} must be one of {sorted(allowed)}")
    value = raw.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"dc_longlead {where}: value must be numeric")
    for key in ("metric", "quote"):
        if not raw.get(key) or not isinstance(raw[key], str):
            raise ValueError(f"dc_longlead {where}: {key} must be non-empty")
    src = _src(raw, where)
    return Figure(metric=raw["metric"], kind=raw["kind"], basis=raw["basis"],
                  scope=raw["scope"], value=float(value), unit=raw["unit"],
                  period=_iso(raw.get("period"), f"{where}.period"),
                  asof=_iso(raw.get("asof"), f"{where}.asof"),
                  quote=raw["quote"], src_label=src[0], src_url=src[1])


def _vendor(key: str, raw: dict) -> Vendor:
    for field in ("name", "ticker", "listed", "dc_segment"):
        if not raw.get(field) or not isinstance(raw[field], str):
            raise ValueError(
                f"dc_longlead vendor {key}: {field} must be non-empty")
    if raw.get("cadence") not in CADENCES:
        raise ValueError(
            f"dc_longlead vendor {key}: cadence must be one of {sorted(CADENCES)}")
    figures = raw.get("figures") or []
    null_note = raw.get("null_note")
    # a vendor either shows receipts or states why there are none — never both,
    # never neither (the null IS a finding and must be written down)
    if bool(figures) == bool(null_note):
        raise ValueError(
            f"dc_longlead vendor {key}: exactly one of figures or null_note")
    if null_note is not None and not isinstance(null_note, str):
        raise ValueError(f"dc_longlead vendor {key}: null_note must be a string")
    disclosure = raw.get("disclosure_note")
    if disclosure is not None and not (isinstance(disclosure, str) and disclosure):
        raise ValueError(f"dc_longlead vendor {key}: disclosure_note must be a non-empty string")
    return Vendor(key=key, name=raw["name"], ticker=raw["ticker"],
                  listed=raw["listed"], dc_segment=raw["dc_segment"],
                  cadence=raw["cadence"],
                  figures=tuple(_figure(f, f"vendor {key} figure {i}")
                                for i, f in enumerate(figures)),
                  null_note=null_note, disclosure_note=disclosure)


def load(path: Path | None = None,
         build_codes: set[str] | None = None) -> LongLeadConfig:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    if raw.get("schema_version") != 1:
        raise ValueError("dc_longlead: schema_version must be 1")
    as_of = _iso(raw.get("as_of_curated"), "as_of_curated")
    vendors_raw = raw.get("vendors")
    if not isinstance(vendors_raw, dict) or not vendors_raw:
        raise ValueError("dc_longlead: vendors must be a non-empty object")
    vendors = {k: _vendor(k, v) for k, v in vendors_raw.items()}
    packages_raw = raw.get("packages")
    if not isinstance(packages_raw, list) or not packages_raw:
        raise ValueError("dc_longlead: packages must be a non-empty list")
    packages: list[Package] = []
    seen: set[str] = set()
    referenced: set[str] = set()
    for p in packages_raw:
        code = p.get("code")
        if not code or not isinstance(code, str):
            raise ValueError("dc_longlead package: code must be non-empty")
        if code in seen:
            raise ValueError(f"dc_longlead package {code}: duplicate code")
        seen.add(code)
        if build_codes is not None and code not in build_codes:
            raise ValueError(
                f"dc_longlead package {code}: not a Build component code")
        keys = p.get("vendors") or []
        null_note = p.get("null_note")
        if bool(keys) == bool(null_note):
            raise ValueError(
                f"dc_longlead package {code}: exactly one of vendors or null_note")
        if null_note is not None and not isinstance(null_note, str):
            raise ValueError(
                f"dc_longlead package {code}: null_note must be a string")
        for k in keys:
            if k not in vendors:
                raise ValueError(
                    f"dc_longlead package {code}: unknown vendor {k!r}")
            referenced.add(k)
        lead_raw = p.get("lead_times") or []
        if not isinstance(lead_raw, list):
            raise ValueError(f"dc_longlead package {code}: lead_times must be a list")
        packages.append(Package(code=code, vendor_keys=tuple(keys),
                                null_note=null_note,
                                lead_times=tuple(_lead_time(lt, f"package {code} lead_time {i}")
                                                 for i, lt in enumerate(lead_raw))))
    unreferenced = set(vendors) - referenced
    if unreferenced:
        raise ValueError(
            f"dc_longlead: unreferenced vendors {sorted(unreferenced)}")
    teaser: list[tuple[str, str]] = []
    for entry in raw.get("teaser") or []:
        if not isinstance(entry, str) or entry.count(":") != 1:
            raise ValueError(
                f"dc_longlead teaser: entries are 'vendor_key:kind', got {entry!r}")
        vkey, kind = entry.split(":")
        vendor = vendors.get(vkey)
        if vendor is None:
            raise ValueError(f"dc_longlead teaser: unknown vendor {vkey!r}")
        matches = [f for f in vendor.figures if f.kind == kind]
        if not matches:
            raise ValueError(f"dc_longlead teaser: {vkey} has no {kind!r} figure")
        # The publisher resolves a teaser by first kind match — with two
        # figures of one kind (ABB carries segment AND group backlog) the
        # pick would be silently order-dependent. Force the curator to a
        # vendor whose kind is unambiguous.
        if len(matches) > 1:
            raise ValueError(
                f"dc_longlead teaser: {vkey} has {len(matches)} {kind!r} figures "
                f"({', '.join(f.scope for f in matches)}) — teaser pick is ambiguous")
        teaser.append((vkey, kind))
    bench = raw.get("lead_time_benchmark")
    return LongLeadConfig(as_of_curated=as_of, packages=tuple(packages),
                          vendors=vendors, teaser=tuple(teaser),
                          lead_time_benchmark=None if bench is None
                          else _lead_time(bench, "lead_time_benchmark"))
