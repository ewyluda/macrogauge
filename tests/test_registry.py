import json
from pathlib import Path

import pytest

from pipeline import registry


def test_load_real_registry():
    sources, series = registry.load_registry()
    assert set(sources) == {"FRED", "BLS", "EIA", "FMP", "TREASURY", "ZILLOW", "PMMS",
                            "APTLIST", "USDA", "AAA", "MND", "MANHEIM",
                            "CLEVELAND", "KALSHI", "EIA_STATE", "QCEW"}
    assert len(series) == 240
    assert sources["BLS"].secret_optional is True
    assert sources["TREASURY"].secret is None
    codes = [s.code for s in series]
    assert len(codes) == len(set(codes))
    fred = [s for s in series if s.source == "FRED"]
    assert len(fred) == 73
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
            "DSPIC96": "DSPIC96", "PPIACO": "PPIACO",
            "IREXPETCOM": "IREXPETCOM", "T5YIE": "T5YIE",
            "CCSA": "CCSA", "PCUOMFGOMFG": "PCUOMFGOMFG",
            "FEDFUNDS": "FEDFUNDS", "HOUST": "HOUST", "PERMIT": "PERMIT",
            "CSUSHPINSA": "CSUSHPINSA", "M2SL": "M2SL", "UMCSENT": "UMCSENT",
            "T10Y2Y": "T10Y2Y", "DRCCLACBS": "DRCCLACBS",
            "TERMCBCCALLNS": "TERMCBCCALLNS", "PSAVERT": "PSAVERT",
            "TDSP": "TDSP", "REVOLSL": "REVOLSL", "DRSFRMACBS": "DRSFRMACBS",
            "SAHMREALTIME": "SAHMREALTIME", "T10Y3M": "T10Y3M",
            "NFCI": "NFCI", "CFNAIMA3": "CFNAIMA3",
            "RECPROUSM156N": "RECPROUSM156N",
            "ces_constr_ahe": "CES2000000003",
            "ppi_elec_contr": "PCU23821X23821X",
            "ppi_plumb_hvac": "PCU23822X23822X",
            "ppi_steel": "WPU1017",
            "ppi_concrete": "PCU327320327320",
            "ppi_copper_wire": "WPU10260314",
            "ppi_alum_shapes": "WPU102501",
            "ppi_switchgear": "WPU1175",
            "ppi_transformer": "WPU1174",
            "ppi_genset": "PCU333611333611",
            "ppi_hvac_equip": "PCU333415333415",
            "ppi_pumps": "WPU1141",
            "ces_dp_ahe": "CES5000000003",
            "ppi_mach_repair": "PCU811310811310",
            "ppi_storage": "PCU334112334112",
            "ppi_semis_components": "PCU33443344",
            "ppi_network_equip": "PCU334210334210",
            "mxp_computers_exsemi": "IR213COM",
            "mxp_semis": "IR21320",
            "mxp_semis_comp_naics": "IZ3344",
            "ppi_semi_headline": "PCU334413334413",
            "ppi_servers": "PCU3341113341115",
            "ppi_ic_packages": "WPU117839",
            "ppi_wafers": "PCU334413334413A",
            "cpi_computers": "CUUR0000SEEE01",
        }
    assert sources["QCEW"].secret is None and sources["QCEW"].route == "CSV"
    assert sources["EIA_STATE"].secret == "EIA_API_KEY"
    assert sum(1 for s in series if s.source == "EIA_STATE") == 52
    assert sum(1 for s in series if s.source == "QCEW") == 52


MONTHLY_MID_MONTH_LAG = (
    # print mid-to-late in the following month: the prior obs is 73–77 days old
    # on the eve of each new print, so limits below 80d false-flag sources_fresh
    # (and gate outlook/dcindex drivers) for ~2 weeks every publication cycle
    "PPIACO", "INDPRO", "RSAFS", "DSPIC96", "PCUOMFGOMFG", "IREXPETCOM",
    "HOUST", "PERMIT", "M2SL", "UMCSENT", "PSAVERT", "REVOLSL",
    "CFNAIMA3", "RECPROUSM156N",
    # DC-index national PPI detail series share the PPI release calendar
    "ppi_elec_contr", "ppi_plumb_hvac", "ppi_steel", "ppi_concrete",
    "ppi_copper_wire", "ppi_alum_shapes", "ppi_switchgear", "ppi_transformer",
    "ppi_genset", "ppi_hvac_equip", "ppi_pumps", "ppi_mach_repair",
)


def test_staleness_limits_cover_publication_lags():
    # Observed live 2026-07-13: every series here sat "stale" purely because its
    # limit undershot the source's own publication cadence.
    _, series = registry.load_registry()
    limits = {s.code: s.max_staleness_days for s in series}
    for code in MONTHLY_MID_MONTH_LAG:
        assert limits[code] >= 80, f"{code} flaps every publication cycle at {limits[code]}d"
    # Case-Shiller lags two months (obs age peaks ~105d)
    assert limits["CSUSHPINSA"] >= 110
    # quarterly bank-condition series release mid-to-late the following quarter (~193d)
    for code in ("DRCCLACBS", "TDSP", "DRSFRMACBS"):
        assert limits[code] >= 210, f"{code} flaps every quarter at {limits[code]}d"
    # continued claims lag two weeks and slip past 14d on holiday weeks
    assert limits["CCSA"] >= 21


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
