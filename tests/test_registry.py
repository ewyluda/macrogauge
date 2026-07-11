import json
from pathlib import Path

import pytest

from pipeline import registry


def test_load_real_registry():
    sources, series = registry.load_registry()
    assert set(sources) == {"FRED", "BLS", "EIA", "FMP", "TREASURY", "ZILLOW", "PMMS",
                            "APTLIST", "USDA", "AAA", "MND", "MANHEIM",
                            "CLEVELAND", "KALSHI", "STREET"}
    assert len(series) == 99
    assert sources["BLS"].secret_optional is True
    assert sources["TREASURY"].secret is None
    codes = [s.code for s in series]
    assert len(codes) == len(set(codes))
    fred = [s for s in series if s.source == "FRED"]
    assert len(fred) == 47
    # Pin the FRED wire ids — 5 registry codes map to different real FRED series ids
    # (the CUUR0000SA{M,A,R,E,G} whole-category codes don't exist on FRED; verified
    # live 2026-07-07). A bad id fails the whole FRED batch, so lock these down.
    fred_ids = {s.code: s.source_id for s in fred}
    assert fred_ids == {
        "CPIAUCNS": "CPIAUCNS",
        "CPILFENS": "CPILFENS",
        "PCEPI": "PCEPI",
        "CUUR0000SAF11": "CUUR0000SAF11",
        "CUUR0000SEFV": "CUUR0000SEFV",
        "CUUR0000SAM": "CPIMEDNS",
        "CUUR0000SAA": "CPIAPPNS",
        "CUUR0000SAR": "CPIRECNS",
        "CUUR0000SAE": "CPIEDUNS",
        "CUUR0000SAG": "CPIOGSNS",
        "CUUR0000SETA01": "CUUR0000SETA01",
        "CUUR0000SETA02": "CUUR0000SETA02",
        "CUUR0000SEHA": "CUUR0000SEHA",
        "CUUR0000SEHC": "CUUR0000SEHC",
        "CUUR0000SEHF01": "CUUR0000SEHF01",
        "CUUR0000SEHF02": "CUUR0000SEHF02",
        "CUUR0000SETB01": "CUUR0000SETB01",
        "FRBATLWGT3MMAUMHWGO": "FRBATLWGT3MMAUMHWGO",
            "CES0500000003": "CES0500000003",
            "PAYEMS": "PAYEMS",
            "ICSA": "ICSA",
            "UNRATE": "UNRATE", "INDPRO": "INDPRO", "RSAFS": "RSAFS",
            "DSPIC96": "DSPIC96", "PPIACO": "PPIACO", "T5YIE": "T5YIE",
            "CCSA": "CCSA", "PCUOMFGOMFG": "PCUOMFGOMFG",
            "FEDFUNDS": "FEDFUNDS", "HOUST": "HOUST", "PERMIT": "PERMIT",
            "CSUSHPINSA": "CSUSHPINSA", "M2SL": "M2SL", "UMCSENT": "UMCSENT",
            "T10Y2Y": "T10Y2Y", "DRCCLACBS": "DRCCLACBS",
            "TERMCBCCALLNS": "TERMCBCCALLNS", "PSAVERT": "PSAVERT",
            "TDSP": "TDSP", "REVOLSL": "REVOLSL", "DRSFRMACBS": "DRSFRMACBS",
            "SAHMREALTIME": "SAHMREALTIME", "T10Y3M": "T10Y3M",
            "NFCI": "NFCI", "CFNAIMA3": "CFNAIMA3",
            "RECPROUSM156N": "RECPROUSM156N",
        }


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
