"""USDA AMS Market News — national staple food prices (weekly).

Feeds the food_home composite: each staple is its own store series; the
within-component mix lives in config/basket.json live_blend and renormalizes
over whatever subset is fresh (spec 2a §3). Missing prices are skipped, never
zero-filled.

Access spike (2026-07-09), recorded reality vs. the plan's assumptions:
- Auth is HTTP Basic, key as username, empty password (confirmed).
- There is no single "national boxed beef/pork cutout" report in this API's
  public catalog (checked all 1049 report titles/market_types) — the
  candidates that exist and carry a pre-aggregated "NATIONAL"/"National" row
  are the "Weekly Grocery Store <X> Feature Activity" retail reports (eggs,
  dairy, beef, pork) plus the wholesale "Weekly National Chicken Report"
  (broiler). All five rebase to their own 2018-01=100 (rebase.py), so the
  retail-vs-wholesale price-*level* difference washes out; only each
  series' own trend feeds the blend.
- Every feature-activity report reports MULTIPLE rows per (date, national
  region) — one per package_size/quality_grade/etc — so a clean single price
  needs a store_count-weighted mean across whatever sub-rows match the
  chosen type/environment/condition that week. The API also returns a
  handful of byte-identical duplicate rows; those are deduped before
  weighting (same date+price+weight = the same observation).
- The API enforces a 100,000-row cap per request (`stats.totalRows`); a
  request that would exceed it silently truncates rather than erroring, so
  wide-open queries against the densest reports (pork, unfiltered beef) are
  unsafe and must be scoped by a compound `q` filter or windowed by year.
- Report taxonomies drift over time: beef/pork grew a `package_size`
  breakdown (~Sep 2024, previously a single null-package row); eggs'
  `type` was renamed+reordered ("WHITE LARGE" -> "Large White", same date);
  pork's legacy label embeds the pack size in the string itself
  ("SLICED BACON, 1 LB PKG") and — because it contains a comma — cannot be
  used as a server-side `q` filter value (comma breaks the filter's own
  field-separator syntax), so pork's pre-2024 history is fetched by date
  window only (no type filter) and matched by prefix client-side.
- Each report also uses its own field names: date is `report_date` except
  dairy (`report_end_date` — dairy rows carry no `report_date` at all);
  price is `price_avg` (retail reports) or `wtd_avg_price` (dairy, broiler);
  weight is `store_count` (retail) or `volume` (broiler).
"""
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

REPORT_URL = "https://marsapi.ams.usda.gov/services/v1.2/reports/{slug}/{section}"
START = "01/01/2017"

# One entry per staple. `queries` is a list of server-side filter dicts (safe,
# comma-free field values only — see module docstring); an optional "_range"
# key overrides the default (START, <today>) window for that query. Rows are
# always additionally filtered client-side by `type_match` (region-national
# filtering is unconditional, applied outside this table).
STAPLE_CONFIG = {
    "eggs": {
        "slug": "2757", "section": "Report Details",
        "date_field": "report_date", "price_field": "price_avg",
        "weight_field": "store_count", "type_field": "type",
        "type_match": lambda t: t.strip().upper() in ("WHITE LARGE", "LARGE WHITE"),
        "queries": [
            {"type": "WHITE LARGE", "environment": "Conventional", "condition": "Fresh"},
            {"type": "Large White", "environment": "Conventional", "condition": "Fresh"},
        ],
    },
    "milk": {
        "slug": "2995", "section": "Report Details",
        "date_field": "report_end_date", "price_field": "wtd_avg_price",
        "weight_field": "store_count", "type_field": "type",
        "type_match": lambda t: t.strip().upper() == "ALL FAT TESTS",
        "queries": [
            {"commodity": "Milk", "type": "All Fat Tests", "package": "Gallon",
             "organic": "No"},
        ],
    },
    "beef": {
        "slug": "3228", "section": "Report Details",
        "date_field": "report_date", "price_field": "price_avg",
        "weight_field": "store_count", "type_field": "type",
        "type_match": lambda t: t.strip().upper() == "GROUND BEEF 80-89%",
        "queries": [
            {"type": "Ground Beef 80-89%", "environment": "Conventional",
             "condition": "Fresh"},
        ],
    },
    "pork": {
        "slug": "2868", "section": "Report Details",
        "date_field": "report_date", "price_field": "price_avg",
        "weight_field": "store_count", "type_field": "type",
        # Prefix match bridges "SLICED BACON, 1 LB PKG" (pre-2024) and
        # "Sliced Bacon" (current) — the legacy label's comma can't be used
        # as a server-side filter value, so these windows carry no type
        # filter at all and rely on this client-side check.
        "type_match": lambda t: t.strip().upper().startswith("SLICED BACON"),
        "queries": [
            {"environment": "Conventional", "condition": "Fresh",
             "_range": ("01/01/2017", "12/31/2019")},
            {"environment": "Conventional", "condition": "Fresh",
             "_range": ("01/01/2020", "12/31/2022")},
            {"environment": "Conventional", "condition": "Fresh",
             "_range": ("01/01/2023", None)},
        ],
    },
    "broiler": {
        "slug": "3646", "section": "Report Detail",
        "date_field": "report_date", "price_field": "wtd_avg_price",
        "weight_field": "volume", "type_field": "item",
        "type_match": lambda t: t.strip().upper() == "RTC BROILER/FRYER",
        "queries": [
            {"item": "RTC Broiler/Fryer", "environment": "Conventional",
             "size": "ALL Sizes"},
        ],
    },
}


def _mmddyyyy(iso: str) -> str:
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%m/%d/%Y")


def _to_iso(mmddyyyy: str) -> str:
    return datetime.strptime(mmddyyyy, "%m/%d/%Y").strftime("%Y-%m-%d")


def _fetch_rows(slug, section, filters, start, end, api_key, http_get):
    q = f"report_begin_date={start}:{end}" + "".join(
        f";{k}={v}" for k, v in filters.items())
    resp = http_get(REPORT_URL.format(slug=slug, section=section),
                    params={"q": q}, auth=(api_key, ""), timeout=120)
    resp.raise_for_status()
    return resp.json().get("results", [])


def fetch(series_ids: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    default_end = _mmddyyyy(vintage)
    out: list[Observation] = []
    for sid in series_ids:
        slug, key = sid.split(":", 1)
        cfg = STAPLE_CONFIG[key]
        rows = []
        for q_filters in cfg["queries"]:
            filters = dict(q_filters)
            q_start, q_end = filters.pop("_range", (START, default_end))
            rows.extend(_fetch_rows(cfg["slug"], cfg["section"], filters,
                                    q_start, q_end or default_end,
                                    api_key, http_get))
        seen: set[tuple] = set()
        grouped: dict[str, list[tuple[float, float]]] = {}
        for row in rows:
            if (row.get("region") or "").strip().upper() != "NATIONAL":
                continue
            if not cfg["type_match"](row.get(cfg["type_field"]) or ""):
                continue
            price = row.get(cfg["price_field"])
            if price in (None, "", "N/A"):
                continue
            date_raw = row.get(cfg["date_field"])
            if not date_raw:
                continue
            weight = row.get(cfg["weight_field"]) or 0
            dedupe_key = (date_raw, price, weight)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            grouped.setdefault(date_raw, []).append((float(price), float(weight)))
        for date_raw, vals in grouped.items():
            tot_w = sum(w for _, w in vals)
            value = (sum(p * w for p, w in vals) / tot_w if tot_w > 0
                     else sum(p for p, _ in vals) / len(vals))
            out.append(Observation(series_code=sid, obs_date=_to_iso(date_raw),
                                   value=value, vintage_date=vintage,
                                   source="USDA", route="API"))
    return sorted(out, key=lambda o: (o.series_code, o.obs_date))
