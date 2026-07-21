"""EIA connector — v2 seriesid compatibility route.

https://api.eia.gov/v2/seriesid/<SERIES_ID>?api_key=... returns response.data[]
rows keyed by period plus a dataset-specific value column — most datasets call
it 'value', but electricity retail-sales (ELEC.PRICE.*) calls it 'price'.
Monthly periods are 'YYYY-MM', weekly/daily are 'YYYY-MM-DD'.
"""
import requests

from pipeline.connectors.fred import today_et
from pipeline.connectors.util import month_first, warn_partial
from pipeline.models import Observation

EIA_URL = "https://api.eia.gov/v2/seriesid/{sid}"


def fetch(series_ids: list[str], api_key: str, vintage_date: str | None = None,
          http_get=None) -> list[Observation]:
    http_get = http_get or requests.get
    vintage = vintage_date or today_et()
    out: list[Observation] = []
    loaded, errors = 0, []
    for sid in series_ids:
        try:
            resp = http_get(EIA_URL.format(sid=sid), params={"api_key": api_key},
                            timeout=60)
            resp.raise_for_status()
            rows = []
            for row in resp.json()["response"]["data"]:
                val = row.get("value", row.get("price"))
                if val is None:
                    continue
                period = str(row["period"])
                obs_date = period if len(period) == 10 else month_first(period)
                rows.append(Observation(series_code=sid, obs_date=obs_date,
                                        value=float(val), vintage_date=vintage,
                                        source="EIA", route="API"))
        except Exception as e:  # per-series: one bad id must not kill the source row
            errors.append((sid, e))
            continue
        loaded += 1
        out.extend(rows)
    if not loaded and errors:
        if len(errors) == 1:  # nothing was isolated — surface the real exception
            raise errors[0][1]
        raise RuntimeError("EIA: no series loaded — " + "; ".join(
            f"{sid}: {type(e).__name__}" for sid, e in errors))
    warn_partial("EIA", errors)
    return out
