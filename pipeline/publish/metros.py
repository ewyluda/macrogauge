"""Writer for metros.json — top-50 metro ZORI/ZHVI KPIs + 24-month YoY tails.

Metro series pass store -> writer directly (the real_wages.py pattern): they
are display-only and never touch the gauge engine. YoY is own-obs like-month
(latest obs vs the obs exactly 12 calendar months earlier; null if the base
month has no obs) — the same rule the gauge component loop uses. A metro with
no store rows publishes null value/as_of/yoy and an empty tail: a new writer
must never be able to take down the publish block.
"""
import json
from pathlib import Path

from pipeline.dates import months_back
from pipeline.store import vintage

TAIL_MONTHS = 24

# (region_id, name) in Zillow SizeRank order — mirrors the registry's
# zori_{region_id} family order; pinned by tests/test_metros_writer.py.
METROS = [
    ("394913", "New York, NY"),
    ("753899", "Los Angeles, CA"),
    ("394463", "Chicago, IL"),
    ("394514", "Dallas, TX"),
    ("394692", "Houston, TX"),
    ("395209", "Washington, DC"),
    ("394974", "Philadelphia, PA"),
    ("394856", "Miami, FL"),
    ("394347", "Atlanta, GA"),
    ("394404", "Boston, MA"),
    ("394976", "Phoenix, AZ"),
    ("395057", "San Francisco, CA"),
    ("395025", "Riverside, CA"),
    ("394532", "Detroit, MI"),
    ("395078", "Seattle, WA"),
    ("394865", "Minneapolis, MN"),
    ("395056", "San Diego, CA"),
    ("395148", "Tampa, FL"),
    ("394530", "Denver, CO"),
    ("394358", "Baltimore, MD"),
    ("395121", "St. Louis, MO"),
    ("394943", "Orlando, FL"),
    ("394458", "Charlotte, NC"),
    ("395055", "San Antonio, TX"),
    ("394998", "Portland, OR"),
    ("395045", "Sacramento, CA"),
    ("394982", "Pittsburgh, PA"),
    ("394466", "Cincinnati, OH"),
    ("394355", "Austin, TX"),
    ("394775", "Las Vegas, NV"),
    ("394735", "Kansas City, MO"),
    ("394492", "Columbus, OH"),
    ("394705", "Indianapolis, IN"),
    ("394475", "Cleveland, OH"),
    ("395059", "San Jose, CA"),
    ("394902", "Nashville, TN"),
    ("395194", "Virginia Beach, VA"),
    ("395005", "Providence, RI"),
    ("394714", "Jacksonville, FL"),
    ("394862", "Milwaukee, WI"),
    ("394935", "Oklahoma City, OK"),
    ("395012", "Raleigh, NC"),
    ("394849", "Memphis, TN"),
    ("395022", "Richmond, VA"),
    ("394807", "Louisville, KY"),
    ("394910", "New Orleans, LA"),
    ("395053", "Salt Lake City, UT"),
    ("394669", "Hartford, CT"),
    ("394425", "Buffalo, NY"),
    ("394388", "Birmingham, AL"),
]


def _block(conn, code: str, digits: int) -> dict:
    obs = dict(vintage.latest(conn, code))
    if not obs:
        return {"value": None, "as_of": None, "yoy_pct": None,
                "yoy_tail": {"months": [], "yoy_pct": []}}
    months = sorted(obs)
    as_of = months[-1]

    def yoy(month):
        base = obs.get(months_back(month, 12))
        return None if not base else round((obs[month] / base - 1) * 100, 2)

    tail = months[-TAIL_MONTHS:]
    return {"value": round(obs[as_of], digits) if digits else round(obs[as_of]),
            "as_of": as_of,
            "yoy_pct": yoy(as_of),
            "yoy_tail": {"months": tail,
                         "yoy_pct": [yoy(m) for m in tail]}}


def build(conn) -> dict:
    def pair(zori_code, zhvi_code):
        return {"zori": _block(conn, zori_code, digits=1),
                "zhvi": _block(conn, zhvi_code, digits=0)}
    return {"metros": [{"region_id": rid, "name": name,
                        **pair(f"zori_{rid}", f"zhvi_{rid}")}
                       for rid, name in METROS],
            "national": pair("zori_us", "zhvi_us")}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "metros.json"
    path.write_text(json.dumps({"published_at": published_at, **payload},
                               indent=2) + "\n")
    return path
