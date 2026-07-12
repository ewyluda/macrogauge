from scripts import backfill_fmp


def test_backfill_symbol_map_includes_outlook_contracts():
    mapping = backfill_fmp.registry_id_map()
    expected = {
        "RBUSD": "fmp_rbob",
        "NGUSD": "fmp_natgas",
        "ZCUSD": "fmp_corn",
        "ZWUSD": "fmp_wheat",
        "ZSUSD": "fmp_soybeans",
        "ZLUSD": "fmp_soybean_oil",
        "KCUSD": "fmp_coffee",
        "SBUSD": "fmp_sugar",
        "CCUSD": "fmp_cocoa",
        "LEUSD": "fmp_live_cattle",
    }
    assert {symbol: mapping[symbol] for symbol in expected} == expected
