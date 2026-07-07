"""Validate committed published data against schemas — runs in CI on every push."""
from pathlib import Path

import pytest

from pipeline.publish import validate

ROOT = Path(__file__).parent.parent
DATA = ROOT / "site" / "public" / "data"
SCHEMAS = ROOT / "schemas"

CONTRACT = [("pulse_lite.json", "pulse_lite.schema.json"),
            ("qa.json", "qa.schema.json")]


@pytest.mark.parametrize("data_file,schema_file", CONTRACT)
def test_published_file_matches_schema(data_file, schema_file):
    path = DATA / data_file
    if not path.exists():
        pytest.skip(f"{data_file} not published yet")
    validate.validate_file(path, SCHEMAS / schema_file)
