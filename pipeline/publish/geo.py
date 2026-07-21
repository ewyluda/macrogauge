"""Writer for geo.json — 51-state panel: gas, residential/industrial
electricity, private construction wage, and unemployment.

Display-only (never touches the gauge engine); follows the real_wages/metros
writer contract. Change is own-obs like-month for the monthly series (locked
decision 7: latest obs vs the obs 12 months earlier, null if that base is
absent). Gas is a daily spot graded against the obs exactly 365 days earlier —
so it stays null until a year of AAA_STATE history accrues. Unemployment reports
a percentage-POINT difference (delta_1y_pp), not a percent change: a rate's
year-ago move is a subtraction, and a percent change would mislead. QCEW
suppresses 7 states (ak/dc/ma/mo/ri/sd/vt) for private NAICS 23, so their wage
block is null. A series with no store rows publishes a null block: a new writer
must never be able to take down the publish block.
"""
import json
from datetime import date, timedelta
from pathlib import Path

from pipeline.dates import months_back
from pipeline.store import vintage

# (abbrev, full name) alphabetical by full state name — mirrors
# tests/test_registry.py STATE_ABBREVS; pinned by test_geo_writer.py.
STATES = [
    ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"),
    ("CA", "California"), ("CO", "Colorado"), ("CT", "Connecticut"),
    ("DE", "Delaware"), ("DC", "District of Columbia"), ("FL", "Florida"),
    ("GA", "Georgia"), ("HI", "Hawaii"), ("ID", "Idaho"), ("IL", "Illinois"),
    ("IN", "Indiana"), ("IA", "Iowa"), ("KS", "Kansas"), ("KY", "Kentucky"),
    ("LA", "Louisiana"), ("ME", "Maine"), ("MD", "Maryland"),
    ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"),
    ("MS", "Mississippi"), ("MO", "Missouri"), ("MT", "Montana"),
    ("NE", "Nebraska"), ("NV", "Nevada"), ("NH", "New Hampshire"),
    ("NJ", "New Jersey"), ("NM", "New Mexico"), ("NY", "New York"),
    ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"),
    ("OK", "Oklahoma"), ("OR", "Oregon"), ("PA", "Pennsylvania"),
    ("RI", "Rhode Island"), ("SC", "South Carolina"), ("SD", "South Dakota"),
    ("TN", "Tennessee"), ("TX", "Texas"), ("UT", "Utah"), ("VT", "Vermont"),
    ("VA", "Virginia"), ("WA", "Washington"), ("WV", "West Virginia"),
    ("WI", "Wisconsin"), ("WY", "Wyoming"),
]


def _round(value: float, digits: int):
    return round(value) if digits == 0 else round(value, digits)


def _measure(conn, code: str, digits: int) -> dict:
    """{value, as_of, yoy_pct} — like-month YoY off the obs 12 months earlier;
    null when that base is absent or zero (a zero base can't yield a ratio)."""
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"value": None, "as_of": None, "yoy_pct": None}
    as_of = max(obs)
    base = obs.get(months_back(as_of, 12))
    yoy = None if not base else round((obs[as_of] / base - 1) * 100, 2)
    return {"value": _round(obs[as_of], digits), "as_of": as_of, "yoy_pct": yoy}


def _gas_measure(conn, code: str) -> dict:
    """Daily spot gas: base is the obs nearest 365 days before as_of (±3d).

    AAA collection is weekday-only, so an exact as_of−365 lands on an
    obs-less weekend for part of every week; the small window bridges
    weekends and holiday gaps without reaching a different price regime."""
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"value": None, "as_of": None, "yoy_pct": None}
    as_of = max(obs)
    target = date.fromisoformat(as_of) - timedelta(days=365)
    base = None
    for offset in (0, -1, 1, -2, 2, -3, 3):  # exact first, then nearest
        base = obs.get((target + timedelta(days=offset)).isoformat())
        if base is not None:
            break
    yoy = None if not base else round((obs[as_of] / base - 1) * 100, 2)
    return {"value": round(obs[as_of], 3), "as_of": as_of, "yoy_pct": yoy}


def _rate(conn, code: str) -> dict:
    """{value, as_of, delta_1y_pp} — percentage-point difference vs the obs 12
    months earlier (unemployment is a rate; a percent change would mislead)."""
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"value": None, "as_of": None, "delta_1y_pp": None}
    as_of = max(obs)
    base = obs.get(months_back(as_of, 12))
    delta = None if base is None else round(obs[as_of] - base, 2)
    return {"value": round(obs[as_of], 1), "as_of": as_of, "delta_1y_pp": delta}


def _panel(conn, gas: str, res: str, ind: str, wage: str, ur: str) -> dict:
    return {"gas_regular": _gas_measure(conn, gas),
            "elec_res_cents": _measure(conn, res, 2),
            "elec_ind_cents": _measure(conn, ind, 2),
            "wage_weekly": _measure(conn, wage, 0),
            "unemployment_pct": _rate(conn, ur)}


def build(conn) -> dict:
    states = [{"state": ab, "name": name,
               **_panel(conn, f"aaa_gas_{ab.lower()}", f"eia_elec_res_{ab.lower()}",
                        f"eia_elec_ind_{ab.lower()}", f"qcew_wage23_{ab.lower()}",
                        f"{ab}UR")}
              for ab, name in STATES]
    national = _panel(conn, "aaa_gas_d", "eia_elec_res", "eia_elec_ind_us",
                      "qcew_wage23_us", "UNRATE")
    return {"states": states, "national": national}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "geo.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
