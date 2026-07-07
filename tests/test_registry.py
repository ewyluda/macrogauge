import json
from pathlib import Path

import pytest

from pipeline import registry


def test_load_real_registry():
    sources, series = registry.load_registry()
    assert set(sources) == {"FRED", "BLS", "EIA", "FMP", "TREASURY", "ZILLOW", "PMMS"}
    assert len(series) == 31
    assert sources["BLS"].secret_optional is True
    assert sources["TREASURY"].secret is None
    codes = [s.code for s in series]
    assert len(codes) == len(set(codes))
    fred = [s for s in series if s.source == "FRED"]
    assert len(fred) == 16


def test_duplicate_code_rejected(tmp_path):
    bad = {"sources": {"X": {"route": "API", "cadence": "daily"}},
           "series": [
               {"code": "a", "source": "X", "source_id": "1", "name": "a", "max_staleness_days": 7},
               {"code": "a", "source": "X", "source_id": "2", "name": "a2", "max_staleness_days": 7}]}
    p = tmp_path / "series.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate"):
        registry.load_registry(p)


def test_unknown_source_rejected(tmp_path):
    bad = {"sources": {"X": {"route": "API", "cadence": "daily"}},
           "series": [{"code": "a", "source": "NOPE", "source_id": "1", "name": "a",
                       "max_staleness_days": 7}]}
    p = tmp_path / "series.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="unknown source"):
        registry.load_registry(p)
