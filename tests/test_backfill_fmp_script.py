from scripts import backfill_fmp


def test_backfill_symbol_map_includes_outlook_contracts():
    mapping = backfill_fmp.registry_id_map()
    # Exchange-suffixed ids verified against FMP /stable/commodities-list —
    # the plain -USD forms for these six return nothing from batch-quote.
    expected = {
        "RBUSD": "fmp_rbob",
        "NGUSD": "fmp_natgas",
        "ZCUSX": "fmp_corn",
        "KEUSX": "fmp_wheat",
        "ZSUSX": "fmp_soybeans",
        "ZLUSX": "fmp_soybean_oil",
        "KCUSX": "fmp_coffee",
        "SBUSD": "fmp_sugar",
        "CCUSD": "fmp_cocoa",
        "LEUSX": "fmp_live_cattle",
    }
    assert {symbol: mapping[symbol] for symbol in expected} == expected
