from pipeline.models import Observation
from pipeline.publish import composites
from pipeline.store import vintage


def test_phase4_writers_degrade_cleanly_with_partial_data(tmp_path):
    vintage.append([Observation("SAHMREALTIME", "2026-06-01", 0.6,
                                "2026-07-01", "FRED", "API")], tmp_path)
    conn = vintage.load(tmp_path)
    heat = composites.build_heatcheck(conn)
    recession = composites.build_recession(conn)
    assert heat["coverage_pct"] == 0
    assert recession["available"] == 1
    assert recession["probability_pct"] == 100
