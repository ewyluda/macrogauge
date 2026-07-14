import json
import re
from pathlib import Path

import pytest

from scripts import backfill_manheim

FIXTURE = Path(__file__).parent / "fixtures" / "manheim_post.html"


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def fake_get(url, timeout=None):
    # Serve the recorded June 2026 post re-headed to whichever month the
    # script requested, so the heading↔slug cross-check is exercised.
    m = re.fullmatch(
        r"https://www\.coxautoinc\.com/insights/"
        r"manheim-used-vehicle-value-index-([a-z]+)-(\d{4})-trends/", url)
    assert m, f"unexpected url {url}"
    month = f"{m.group(1).capitalize()} {m.group(2)}"
    return FakeResponse(FIXTURE.read_text().replace("June 2026", month))


def test_backfill_fills_dead_scrape_gap(tmp_path, capsys):
    rc = backfill_manheim.main(["--store", str(tmp_path)], http_get=fake_get)
    assert rc == 0
    rows = [json.loads(ln)
            for part in sorted((tmp_path / "obs").glob("*.jsonl"))
            for ln in part.read_text().splitlines()]
    assert [r["obs_date"] for r in rows] == [
        "2025-12-01", "2026-01-01", "2026-02-01",
        "2026-03-01", "2026-04-01", "2026-05-01"]
    assert all(r["series_code"] == "manheim_uvvi_m" and r["source"] == "MANHEIM"
               for r in rows)
    assert "wrote 6 new" in capsys.readouterr().out

    # re-running is a no-op: identity-deduped, no partition growth
    assert backfill_manheim.main(["--store", str(tmp_path)],
                                 http_get=fake_get) == 0
    assert "wrote 0 new" in capsys.readouterr().out


def test_backfill_raises_when_heading_disagrees_with_slug(tmp_path):
    def wrong_month_get(url, timeout=None):
        return FakeResponse(FIXTURE.read_text())  # always the June post

    with pytest.raises(ValueError, match="post heading says 2026-06-01"):
        backfill_manheim.main(["--store", str(tmp_path)],
                              http_get=wrong_month_get)
