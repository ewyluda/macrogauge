"""Validate committed published data against schemas — runs in CI on every push."""
from pathlib import Path

import pytest

from pipeline.publish import validate

ROOT = Path(__file__).parent.parent
DATA = ROOT / "site" / "public" / "data"
SCHEMAS = ROOT / "schemas"

CONTRACT = [("pulse.json", "pulse.schema.json"),
            ("gauge_daily.json", "gauge_daily.schema.json"),
            ("compare.json", "compare.schema.json"),
            ("gaptable.json", "gaptable.schema.json"),
            ("replay.json", "replay.schema.json"),
            ("qa.json", "qa.schema.json"),
            ("sources_status.json", "sources_status.schema.json"),
            ("official.json", "official.schema.json")]


@pytest.mark.parametrize("data_file,schema_file", CONTRACT)
def test_published_file_matches_schema(data_file, schema_file):
    path = DATA / data_file
    if not path.exists():
        pytest.skip(f"{data_file} not published yet")
    validate.validate_file(path, SCHEMAS / schema_file)


def test_pulse_gap_consistent():
    import json
    path = DATA / "pulse.json"
    if not path.exists():
        pytest.skip("pulse.json not published yet")
    pulse = json.loads(path.read_text())
    expected = pulse["gauge"]["yoy_pct"] - pulse["official"]["yoy_pct"]
    assert abs(pulse["gap_pp"] - expected) <= 0.011  # rounding tolerance
