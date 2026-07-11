from pipeline.models import Observation
from pipeline.publish import composites
from pipeline.store import vintage


def test_build_heatcheck_diff_mode_scores_steepening_spread_as_heating(tmp_path):
    # T10Y2Y accelerating upward from deep inversion is a heating signal; the
    # percent-change path sign-inverts it because the base is negative.
    obs = [Observation("T10Y2Y", f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}",
                       -0.6 + 0.0001 * i * i, "2026-07-01", "FRED", "API")
           for i in range(70)]
    vintage.append(obs, tmp_path)
    heat = composites.build_heatcheck(vintage.load(tmp_path))
    row = next(r for r in heat["indicators"] if r["code"] == "T10Y2Y")
    assert row["z"] > 0


def test_phase4_writers_degrade_cleanly_with_partial_data(tmp_path):
    vintage.append([Observation("SAHMREALTIME", "2026-06-01", 0.6,
                                "2026-07-01", "FRED", "API")], tmp_path)
    conn = vintage.load(tmp_path)
    heat = composites.build_heatcheck(conn)
    recession = composites.build_recession(conn)
    assert heat["coverage_pct"] == 0
    assert recession["available"] == 1
    assert recession["probability_pct"] == 100
