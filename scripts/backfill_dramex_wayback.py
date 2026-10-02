"""One-off NAND-spot history backfill from Wayback Machine snapshots of the
DRAMeXchange homepage (2026-10-02).

    python scripts/backfill_dramex_wayback.py --store store [--cache DIR]

Why: the homepage shows the current session only, so live collection
(connectors/dramex.py) started with no history on 2026-07-15 and the storage
tail gate (engine/proxygate.py) needs a year of NAND spot for its like-month
ratio. It would have stayed INSUFFICIENT until ~2027-08. The Internet Archive
holds ~monthly snapshots back to 2016; the "MLC 64Gb 8GBx8" row parses
unchanged from 2019-02 (earlier pages carry a different label and are
skipped).

Each snapshot goes through the NORMAL row parser (dramex.fetch with an
injected http_get), so drift protection and the plausible-range check apply
unchanged. Rows are:
  * obs_date = the flash table's own "Last Update" stamp (the table can lag
    the archive date, and the DRAM table, by days) — the snapshot date only
    when the stamp is missing;
  * vintage_date = today (the day we learned it, like every other backfill:
    this store's vintage is when WE knew a value, not when it was public);
  * route = "WAYBACK", so archived points are distinguishable from the live
    SCRAPE rows forever.
Snapshots dated on/after the first live observation are skipped — live
collection owns that window. vintage.append value-dedupes, so a rerun is a
no-op. Raw HTML is cached under --cache so a rerun never re-fetches.

Licensing: the values were shown free on the public homepage; the owner
approved committing the archived history (educational, not resold).
"""
import argparse
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline import registry                              # noqa: E402
from pipeline.connectors import dramex                     # noqa: E402
from pipeline.connectors.fred import today_et              # noqa: E402
from pipeline.models import Observation                    # noqa: E402
from pipeline.store import vintage                         # noqa: E402

CDX = ("https://web.archive.org/cdx/search/cdx?url=dramexchange.com/"
       "&output=json&filter=statuscode:200&collapse=timestamp:6")
SNAPSHOT = "https://web.archive.org/web/{ts}id_/https://www.dramexchange.com/"
UA = {"User-Agent": "macrogauge research backfill (educational)"}
CODE = "dramex_nand_mlc64"


def _get(url: str, sleep: float) -> str:
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=90, headers=UA)
            if r.status_code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"gave up on {url}")


def parse_snapshot(html: str, label: str, ts: str) -> tuple[str, float]:
    """(obs_date, session average) for one archived page; raises the
    connector's own structure-drift error when the row is missing."""
    obs = dramex.fetch([label], vintage_date="1900-01-01",
                       http_get=lambda *_a, **_k: _Resp(html))
    stamp = dramex.flash_last_update(html)
    return stamp or f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}", obs[0].value


class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--cache", type=Path, required=True,
                    help="raw-HTML cache dir (outside the repo)")
    ap.add_argument("--sleep", type=float, default=3.0)
    args = ap.parse_args(argv)
    args.cache.mkdir(parents=True, exist_ok=True)

    label = next(r.source_id for r in registry.load_registry()[1] if r.code == CODE)
    conn = vintage.load(args.store)
    live = conn.execute("SELECT MIN(obs_date) FROM observations WHERE series_code = ? "
                        "AND route != 'WAYBACK'", (CODE,)).fetchone()[0]
    cdx_path = args.cache / "cdx.json"
    if not cdx_path.exists():
        cdx_path.write_text(_get(CDX, args.sleep))
    header, *cdx_rows = json.loads(cdx_path.read_text())
    stamps = [row[header.index("timestamp")] for row in cdx_rows]

    today = today_et()
    rows, skipped = {}, []
    for ts in stamps:
        page = args.cache / f"{ts}.html"
        if not page.exists():
            try:
                page.write_text(_get(SNAPSHOT.format(ts=ts), args.sleep))
            except RuntimeError as e:   # one dead snapshot never ends the run
                skipped.append((ts, str(e)[:80]))
                continue
            finally:
                time.sleep(args.sleep)
        try:
            obs_date, value = parse_snapshot(page.read_text(errors="ignore"), label, ts)
        except ValueError as e:
            skipped.append((ts, str(e)[:80]))
            continue
        if live and obs_date >= live:
            continue
        rows[obs_date] = value   # two snapshots of one session: same value
    obs = [Observation(CODE, d, v, today, "DRAMEX", "WAYBACK")
           for d, v in sorted(rows.items())]
    written = vintage.append(obs, args.store)
    print(f"{len(stamps)} snapshots, {len(rows)} sessions parsed "
          f"({min(rows) if rows else '-'}..{max(rows) if rows else '-'}), "
          f"{len(skipped)} skipped, {written} rows written; live from {live}")
    for ts, why in skipped:
        print(f"  skipped {ts}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
