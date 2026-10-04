"""ERCOT day-ahead settlement point prices — hub daily average.

Keyless via the public MIS (api.ercot.com needs a subscription key; this
does not). Report 12331 "DAM Settlement Point Prices" (NP4-190-CD): one zip
per delivery day holding one CSV, posted ~12:30-14:00 CT the day before,
kept 31 days. Download URLs use opaque document IDs, so a fetch is two
steps: the JSON document list, then each zip.

Gotchas pinned by research/iso-samples (verified 2026-10-04):
- a bad or expired DocID returns HTTP 200 with an XML "Error Downloading
  Content" body — the body must start with the zip magic `PK`;
- prices carry a leading space;
- the delivery date comes from the DeliveryDate column, never the publish
  date in the file name;
- fall-back DST days carry 25 rows (DSTFlag=Y on the repeated hour);
- ERCOT's offer cap is $5,000/MWh, so the plausible range is wider than the
  other grids'.
Verified: HB_NORTH 2026-10-04 = 37.03, HB_HUBAVG = 37.28."""
import csv
import io
import zipfile
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.lmp import daily_obs

LIST_URL = "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=12331"
DOC_URL = "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc}"
CSV_FRIENDLY = "DAMSPNP4190_csv"
DATE_COL, POINT_COL, PRICE_COL = "DeliveryDate", "SettlementPoint", "SettlementPointPrice"
PLAUSIBLE = (-250.0, 5000.0)
CATCHUP_DOCS = 5   # newest delivery days; each doc is one day


def _default_get(url, timeout=60):
    return requests.get(url, timeout=timeout, headers={"User-Agent": "macrogauge (data pipeline)"})


def fetch(source_ids: list[str], vintage_date: str | None = None,
          http_get=None, docs: int = CATCHUP_DOCS) -> list:
    """source_id = the SettlementPoint name (e.g. HB_NORTH)."""
    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    resp = http_get(LIST_URL, timeout=60)
    resp.raise_for_status()
    try:
        listing = resp.json()["ListDocsByRptTypeRes"]["DocumentList"]
    except (KeyError, TypeError, ValueError):
        raise ValueError("ercot: document list missing ListDocsByRptTypeRes.DocumentList "
                         "(structure drift?)") from None
    csv_docs = [d["Document"] for d in listing
                if d.get("Document", {}).get("FriendlyName") == CSV_FRIENDLY]
    if not csv_docs:
        raise ValueError(f"ercot: no {CSV_FRIENDLY} documents listed (structure drift?)")
    csv_docs.sort(key=lambda d: d.get("PublishDate", ""), reverse=True)
    out = []
    for doc in reversed(csv_docs[:docs]):   # oldest first
        r = http_get(DOC_URL.format(doc=doc["DocID"]), timeout=60)
        r.raise_for_status()
        if not r.content.startswith(b"PK"):
            raise ValueError(f"ercot doc {doc['DocID']}: not a zip (expired document id?)")
        out.extend(parse_zip(r.content, source_ids, vintage))
    return out


def parse_zip(blob: bytes, source_ids: list[str], vintage: str) -> list:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise ValueError(f"ercot: expected one CSV in the zip, got {names} (structure drift?)")
        text = zf.read(names[0]).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    cols = reader.fieldnames or []
    if DATE_COL not in cols or POINT_COL not in cols or PRICE_COL not in cols:
        raise ValueError(f"ercot: columns {cols} lack {DATE_COL}/{POINT_COL}/{PRICE_COL} "
                         "(structure drift?)")
    by_hub: dict[str, list[str]] = {h: [] for h in source_ids}
    days = set()
    for r in reader:
        pt = (r.get(POINT_COL) or "").strip()
        if pt in by_hub:
            by_hub[pt].append(r[PRICE_COL])
            days.add(r[DATE_COL].strip())
    if len(days) != 1:
        raise ValueError(f"ercot: expected one delivery date, got {sorted(days)} (structure drift?)")
    day = datetime.strptime(days.pop(), "%m/%d/%Y").date().isoformat()
    out = []
    for hub in source_ids:
        if not by_hub[hub]:
            raise ValueError(f"ercot {hub}: settlement point not found (structure drift?)")
        out.append(daily_obs("ERCOT", hub, day, by_hub[hub], vintage, PLAUSIBLE))
    return out


HIST_LIST_URL = "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=13060"
HIST_COLS = ("Delivery Date", "Settlement Point", "Settlement Point Price")


def fetch_year(source_ids: list[str], year: int | str, vintage_date: str | None = None,
               http_get=None) -> list:
    """Backfill: report 13060 "Historical DAM Load Zone and Hub Prices" — one
    zip per year holding an xlsx with a sheet per month (keyless, 2015 on).
    The daily MIS report only keeps 31 days, so YoY history comes from here."""
    import openpyxl

    http_get = http_get or _default_get
    vintage = vintage_date or today_et()
    resp = http_get(HIST_LIST_URL, timeout=60)
    resp.raise_for_status()
    docs = [d["Document"] for d in resp.json()["ListDocsByRptTypeRes"]["DocumentList"]]
    doc = next((d for d in docs if f"_{year}" in d.get("ConstructedName", "")), None)
    if doc is None:
        raise ValueError(f"ercot: no historical DAM workbook listed for {year}")
    r = http_get(DOC_URL.format(doc=doc["DocID"]), timeout=180)
    r.raise_for_status()
    if not r.content.startswith(b"PK"):
        raise ValueError(f"ercot history {year}: not a zip (expired document id?)")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".xlsx"))
        wb = openpyxl.load_workbook(io.BytesIO(zf.read(name)), read_only=True, data_only=True)
    by_day: dict[tuple[str, str], list] = {}
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = [str(c).strip() if c is not None else "" for c in next(rows, ())]
        if not header or not all(c in header for c in HIST_COLS):
            continue   # an unfilled future month carries no header
        di, pi, vi = (header.index(c) for c in HIST_COLS)
        for row in rows:
            pt = (row[pi] or "").strip() if isinstance(row[pi], str) else row[pi]
            if pt in source_ids and row[di]:
                d = row[di]
                day = (d.date().isoformat() if hasattr(d, "date")
                       else datetime.strptime(str(d).strip(), "%m/%d/%Y").date().isoformat())
                by_day.setdefault((pt, day), []).append(row[vi])
    return [daily_obs("ERCOT", pt, day, vals, vintage, PLAUSIBLE)
            for (pt, day), vals in sorted(by_day.items(), key=lambda kv: (kv[0][1], kv[0][0]))]
