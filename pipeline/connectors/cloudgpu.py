"""Cloud GPU list prices — on-demand $/GPU-hour from the big clouds.

Four source keys, one per provider, for failure isolation (the kalshi.py
pattern): a redesigned pricing page or a renamed SKU at one provider never
fails another's row.

  AWS_GPU    EC2 on-demand, Linux, US East (N. Virginia). The JSON the public
             pricing page reads (b0.p.awsstatic.com) — keyless but
             undocumented, so it carries drift protection like a scrape.
  AZURE_GPU  Azure Retail Prices API (documented, keyless): pay-as-you-go
             Linux VMs in East US 2, which lists every SKU tracked here.
  OCI_GPU    Oracle Cloud's public price list API (documented, keyless). OCI
             prices GPU shapes per GPU-hour already.
  COREWEAVE  coreweave.com/pricing (scrape): the largest neocloud's on-demand
             node prices.
  NEBIUS     nebius.com/prices (scrape): the on-demand GPU table, already per
             GPU-hour. A scheduled price change is published as a second
             column "GPU-hour (Effective <date>)"; that column is the list
             price from its date on.

source_id = "<instance or part>/<gpus per instance>" for AWS, Azure and
CoreWeave (the stored value is the instance price divided by its GPU count),
"<part number>:<GPU name>" for OCI (already per GPU; the name guards against a
part number being reassigned), "<row name>" for Nebius (already per GPU). A SKU missing from a response skips its series
(it then surfaces as staleness); a response that doesn't parse, or matches no
tracked SKU at all, raises "structure drift?" into the collect-layer
isolation. Every value is range-checked per GPU-hour.

These are LIST prices: what a buyer pays with no commitment. Reserved and
committed-use discounts are deeper and not published per SKU.
"""
import html
import re
import urllib.parse
from datetime import datetime

import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

PLAUSIBLE = (0.5, 80.0)   # $/GPU-hr, list on-demand
UA = {"User-Agent": "Mozilla/5.0 (macrogauge.vercel.app daily collect)"}

AWS_URL = ("https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/"
           "ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json")
AWS_REGION = "US East (N. Virginia)"
AZURE_URL = "https://prices.azure.com/api/retail/prices"
AZURE_REGION = "eastus2"
OCI_URL = "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD"
COREWEAVE_URL = "https://www.coreweave.com/pricing"
NEBIUS_URL = "https://nebius.com/prices"


def _split(sid: str, sep: str) -> tuple[str, str]:
    key, _, rest = sid.rpartition(sep)
    if not key or not rest:
        raise ValueError(f"cloudgpu: malformed source_id {sid!r}")
    return key, rest


def _obs(sid: str, value: float, vintage: str, source: str, route: str) -> Observation:
    value = round(value, 4)
    if not (PLAUSIBLE[0] <= value <= PLAUSIBLE[1]):
        raise ValueError(f"{source} {sid}: ${value}/GPU-hr implausible (range {PLAUSIBLE}) — structure drift?")
    return Observation(series_code=sid, obs_date=vintage, value=value, vintage_date=vintage,
                       source=source, route=route)


def _need(out: list, source: str) -> list:
    if not out:
        raise ValueError(f"{source}: no tracked SKU found in the response (structure drift?)")
    return out


def fetch_aws(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """source_id = '<instance type>/<gpus>' e.g. 'p5.48xlarge/8'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(AWS_URL, timeout=90, headers=UA)
    resp.raise_for_status()
    regions = resp.json().get("regions")
    if not isinstance(regions, dict) or AWS_REGION not in regions:
        raise ValueError(f"AWS_GPU: no {AWS_REGION!r} region map (structure drift?)")
    tracked = {_split(sid, "/")[0] for sid in source_ids}
    # Only tracked instance types are read, so a malformed row for any of the
    # other ~1,300 instances can't fail the source; a tracked type listed
    # twice at different prices is drift (as on Azure), never last-row-wins.
    prices: dict[str, set[float]] = {}
    for row in regions[AWS_REGION].values():
        inst = row.get("Instance Type") if isinstance(row, dict) else None
        if inst in tracked and row.get("price") not in (None, ""):
            prices.setdefault(inst, set()).add(float(row["price"]))
    out = []
    for sid in source_ids:
        inst, gpus = _split(sid, "/")
        found = prices.get(inst)
        if not found:
            continue
        if len(found) > 1:
            raise ValueError(f"AWS_GPU {inst}: {len(found)} distinct on-demand prices "
                             f"{sorted(found)} (structure drift?)")
        out.append(_obs(sid, found.pop() / int(gpus), vintage, "AWS_GPU", "API"))
    return _need(out, "AWS_GPU")


def fetch_azure(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """source_id = '<armSkuName>/<gpus>' e.g. 'Standard_ND96isr_H100_v5/8'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    skus = [_split(sid, "/")[0] for sid in source_ids]
    flt = (f"serviceName eq 'Virtual Machines' and armRegionName eq '{AZURE_REGION}' "
           "and priceType eq 'Consumption' and ("
           + " or ".join(f"armSkuName eq '{s}'" for s in skus) + ")")
    url = f"{AZURE_URL}?$filter={urllib.parse.quote(flt)}"
    prices: dict[str, set[float]] = {}
    pages = 0
    while url:
        pages += 1
        if pages > 10:
            raise ValueError("AZURE_GPU: more than 10 result pages (structure drift?)")
        resp = http_get(url, timeout=60, headers=UA)
        resp.raise_for_status()
        body = resp.json()
        items = body.get("Items")
        if not isinstance(items, list):
            raise ValueError("AZURE_GPU: no 'Items' list (structure drift?)")
        for it in items:
            product, meter = str(it.get("productName", "")), str(it.get("meterName", ""))
            # Linux pay-as-you-go only: the Windows product and the Spot /
            # Low Priority meters are separate rows of the same SKU
            if "Windows" in product or "Spot" in meter or "Low Priority" in meter:
                continue
            if it.get("unitOfMeasure") not in (None, "1 Hour"):
                continue
            prices.setdefault(it.get("armSkuName"), set()).add(float(it["unitPrice"]))
        url = body.get("NextPageLink")
    out = []
    for sid in source_ids:
        sku, gpus = _split(sid, "/")
        found = prices.get(sku)
        if not found:
            continue
        if len(found) > 1:
            raise ValueError(f"AZURE_GPU {sku}: {len(found)} distinct Linux on-demand prices "
                             f"{sorted(found)} (structure drift?)")
        out.append(_obs(sid, found.pop() / int(gpus), vintage, "AZURE_GPU", "API"))
    return _need(out, "AZURE_GPU")


def fetch_oci(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """source_id = '<part number>:<GPU name>' e.g. 'B98415:H100'."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(OCI_URL, timeout=60, headers=UA)
    resp.raise_for_status()
    items = resp.json().get("items")
    if not isinstance(items, list):
        raise ValueError("OCI_GPU: no 'items' list (structure drift?)")
    by_part = {it.get("partNumber"): it for it in items if isinstance(it, dict)}
    out = []
    for sid in source_ids:
        part, gpu = _split(sid, ":")
        it = by_part.get(part)
        if it is None:
            continue
        name = str(it.get("displayName", ""))
        # the part number must still be this GPU's per-GPU-hour line
        if not re.search(rf"\bGPU\b.*\b{re.escape(gpu)}\b", name) or it.get("metricName") != "GPU Per Hour":
            raise ValueError(f"OCI_GPU {part}: now {name!r} / {it.get('metricName')!r}, "
                             f"not {gpu} per GPU-hour (structure drift?)")
        payg = [p for loc in it.get("currencyCodeLocalizations") or [] if loc.get("currencyCode") == "USD"
                for p in loc.get("prices") or [] if p.get("model") == "PAY_AS_YOU_GO"]
        if len(payg) != 1:
            raise ValueError(f"OCI_GPU {part}: {len(payg)} USD pay-as-you-go prices (structure drift?)")
        out.append(_obs(sid, float(payg[0]["value"]), vintage, "OCI_GPU", "API"))
    return _need(out, "OCI_GPU")


def fetch_coreweave(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """source_id = '<row name>/<gpus>' e.g. 'NVIDIA HGX H100/8'. The row's GPU
    count on the page must equal the source_id's, so a reconfigured node
    (a different GPU count) fails loudly instead of mispricing per GPU. The
    price is the one the page LABELS on-demand ("<name> On-Demand Price: $X /
    Hour"), and the table cell must agree with it — a reordered or added
    price column (spot, reserved) fails loudly instead of being stored."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(COREWEAVE_URL, timeout=60, headers=UA)
    resp.raise_for_status()
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", resp.text))
    if "On-Demand Price" not in text:
        raise ValueError("COREWEAVE: no 'On-Demand Price' on the pricing page (structure drift?)")
    out = []
    for sid in source_ids:
        name, gpus = _split(sid, "/")
        # "<name> <GPU count>[^footnote] <VRAM> <vCPUs> <RAM> <storage TB> $<price>"
        m = re.search(rf"{re.escape(name)} (\d+)(?:\^\d+)? \d+ \d+ [\d,]+ [\d.]+ \$([\d,]+\.\d{{2}})", text)
        if not m:
            continue
        if m.group(1) != gpus:
            raise ValueError(f"COREWEAVE {name}: page lists {m.group(1)} GPUs per node, "
                             f"source_id says {gpus} (structure drift?)")
        label = re.search(rf"{re.escape(name)} On-Demand Price: \$([\d,]+\.\d{{2}}) / Hour", text)
        if not label:
            raise ValueError(f"COREWEAVE {name}: no labelled on-demand price (structure drift?)")
        cell, labelled = (float(x.replace(",", "")) for x in (m.group(2), label.group(1)))
        if cell != labelled:
            raise ValueError(f"COREWEAVE {name}: table ${cell} vs labelled on-demand ${labelled} "
                             "(structure drift?)")
        out.append(_obs(sid, labelled / int(gpus), vintage, "COREWEAVE", "SCRAPE"))
    return _need(out, "COREWEAVE")


def _cells(page: str) -> list[str]:
    """The page's visible text as an ordered list of non-empty cells."""
    page = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    return [c for c in (html.unescape(x).strip() for x in re.split(r"<[^>]+>", page)) if c]


def fetch_nebius(source_ids: list[str], vintage_date: str | None = None, http_get=None) -> list[Observation]:
    """source_id = '<row name>' e.g. 'NVIDIA HGX H100'. Only the on-demand
    table is read: it runs from the 'NVIDIA GPU Instances' header row
    (Item | vCPUs | RAM, GB | <price columns>) to the 'Preemptible' (spot)
    table. Each price column must be 'On-demand, GPU-hour' or 'GPU-hour
    (Effective <Month D, YYYY>)'; the price used is the latest column already
    in effect on the vintage date. Any other header, a row of the wrong width
    or a tracked row priced as 'from $X' / 'Contact us' fails loudly."""
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(NEBIUS_URL, timeout=60, headers=UA)
    resp.raise_for_status()
    cells = _cells(resp.text)
    head = ["NVIDIA GPU Instances", "Item", "vCPUs", "RAM, GB"]
    start = next((i for i in range(len(cells) - 3) if cells[i:i + 4] == head), None)
    if start is None:
        raise ValueError("NEBIUS: no on-demand 'NVIDIA GPU Instances' table (structure drift?)")
    i, effective = start + 4, []           # effective date per price column ("" = on-demand)
    while i < len(cells) and not cells[i].startswith("NVIDIA "):
        h = cells[i]
        m = re.fullmatch(r"GPU-hour \(Effective (\w+ \d{1,2}, \d{4})\)", h)
        if h == "On-demand, GPU-hour":
            effective.append("")
        elif m:
            effective.append(datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat())
        else:
            raise ValueError(f"NEBIUS: unexpected price column {h!r} (structure drift?)")
        i += 1
    if not effective or effective[0] != "":
        raise ValueError("NEBIUS: first price column is not 'On-demand, GPU-hour' (structure drift?)")
    col = max(k for k, d in enumerate(effective) if d <= vintage)
    end = next((j for j in range(i, len(cells)) if cells[j].startswith("Preemptible")), None)
    if end is None:
        raise ValueError("NEBIUS: no spot table after the on-demand table (structure drift?)")
    width = 3 + len(effective)
    rows = {}
    while i < end:
        if not cells[i].startswith("NVIDIA ") or i + width > end:
            raise ValueError(f"NEBIUS: row at {cells[i]!r} is not {width} cells wide (structure drift?)")
        rows[cells[i]] = cells[i + 3:i + width]
        i += width
    out = []
    for sid in source_ids:
        prices = rows.get(sid)
        if prices is None:
            continue
        m = re.fullmatch(r"\$(\d+\.\d{2})", prices[col])
        if not m:
            raise ValueError(f"NEBIUS {sid}: price {prices[col]!r} is not a flat on-demand rate (structure drift?)")
        out.append(_obs(sid, float(m.group(1)), vintage, "NEBIUS", "SCRAPE"))
    return _need(out, "NEBIUS")
