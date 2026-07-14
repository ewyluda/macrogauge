"""One-time Manheim UVVI backfill: fill the dead-scrape gap, Dec 2025–May 2026.

The old scrape target (site.manheim.com) froze at the Mid-December 2025
report while Cox kept publishing on coxautoinc.com/insights — see the
re-point note in pipeline/connectors/manheim.py. That left manheim_uvvi_m
with no observations between 2025-12 and 2026-06, so the daily grid
forward-fills a flat 206.0 across six months and then cliffs. The full-month
posts are still up under a stable slug; fetch each, extract with the
connector's pinned regex, and append under today's vintage:

    python scripts/backfill_manheim.py --store store

Identity-deduped (vintage.append_vintages), so re-running is a no-op. The
full-month December value supersedes the stored mid-December 206.0 on read
(latest-vintage-wins)."""
import argparse
import sys
from datetime import datetime
from pathlib import Path

import requests

from pipeline.connectors import manheim
from pipeline.connectors.fred import today_et
from pipeline.connectors.util import get_text
from pipeline.models import Observation
from pipeline.store import vintage

MONTHS = ("December 2025", "January 2026", "February 2026",
          "March 2026", "April 2026", "May 2026")
POST_URL = ("https://www.coxautoinc.com/insights/"
            "manheim-used-vehicle-value-index-{slug}-trends/")


def main(argv=None, http_get=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True, type=Path)
    args = parser.parse_args(argv)
    http_get = http_get or requests.get
    vint = today_et()
    obs = []
    for month in MONTHS:
        slug = month.lower().replace(" ", "-")
        html = get_text(POST_URL.format(slug=slug), http_get)
        obs_date, value = manheim.parse_post(html)
        expected = datetime.strptime(month, "%B %Y").strftime("%Y-%m-01")
        if obs_date != expected:
            raise ValueError(f"{month}: post heading says {obs_date}")
        obs.append(Observation(
            series_code="manheim_uvvi_m", obs_date=obs_date, value=value,
            vintage_date=vint, source="MANHEIM", route="SCRAPE"))
    written = vintage.append_vintages(obs, args.store)
    print(f"fetched {len(obs)} months, wrote {written} new rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
