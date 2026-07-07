"""Treasury FiscalData — Debt to the Penny (keyless, no rate limit drama).

https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.models import Observation

DEBT_URL = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
            "/v2/accounting/od/debt_to_penny")


def fetch(vintage_date: str | None = None, http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    resp = http_get(DEBT_URL, params={
        "fields": "record_date,tot_pub_debt_out_amt",
        "filter": "record_date:gte:2017-01-01",
        "sort": "-record_date",
        "page[size]": "10000"}, timeout=60)
    resp.raise_for_status()
    return [Observation(series_code="fiscal_debt_total", obs_date=row["record_date"],
                        value=float(row["tot_pub_debt_out_amt"]), vintage_date=vintage,
                        source="TREASURY", route="API")
            for row in resp.json()["data"]]
