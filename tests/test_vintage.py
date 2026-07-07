import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.store import vintage


def obs(code="CPIAUCNS", date="2026-05-01", value=320.5, vintage="2026-07-07"):
    return Observation(series_code=code, obs_date=date, value=value,
                       vintage_date=vintage, source="FRED", route="API")


def test_append_writes_monthly_partition(tmp_path):
    n = vintage.append([obs()], tmp_path)
    assert n == 1
    part = tmp_path / "obs" / "2026-07.jsonl"
    assert part.exists()
    row = json.loads(part.read_text().strip())
    assert row == {"series_code": "CPIAUCNS", "obs_date": "2026-05-01",
                   "value": 320.5, "vintage_date": "2026-07-07",
                   "source": "FRED", "route": "API"}


def test_append_dedupes_same_value(tmp_path):
    vintage.append([obs()], tmp_path)
    n = vintage.append([obs(vintage="2026-07-08")], tmp_path)  # same value, new day
    assert n == 0
    lines = (tmp_path / "obs" / "2026-07.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1


def test_append_keeps_revisions(tmp_path):
    vintage.append([obs(value=320.5)], tmp_path)
    n = vintage.append([obs(value=321.0, vintage="2026-08-02")], tmp_path)
    assert n == 1
    assert (tmp_path / "obs" / "2026-08.jsonl").exists()
