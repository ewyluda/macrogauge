from pathlib import Path

import jsonschema
import pytest

from pipeline.publish import pulse_lite, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

CPI = {"series_code": "CPIAUCNS", "month": "2026-05-01",
       "yoy_pct": 2.691029900332226, "prev_yoy_pct": 2.5, "as_of": "2026-07-07"}


def test_write_rounds_and_validates(tmp_path):
    path = pulse_lite.write(CPI, tmp_path, published_at="2026-07-07T12:40:00Z")
    assert path == tmp_path / "pulse_lite.json"
    validate.validate_file(path, SCHEMAS / "pulse_lite.schema.json")
    import json
    data = json.loads(path.read_text())
    assert data["official_cpi"]["yoy_pct"] == 2.69
    assert data["published_at"] == "2026-07-07T12:40:00Z"


def test_validate_rejects_bad_file(tmp_path):
    bad = tmp_path / "pulse_lite.json"
    bad.write_text('{"published_at": "x"}')
    with pytest.raises(jsonschema.ValidationError):
        validate.validate_file(bad, SCHEMAS / "pulse_lite.schema.json")
