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


def test_yoy_transform_is_month_aligned():
    rows = [("2018-01-01", 100.0), ("2018-02-01", 100.0),
            ("2019-01-01", 105.0), ("2019-02-01", 110.0),
            ("2019-04-01", 120.0)]  # 2019-04 has no 2018-04 base -> dropped
    assert composites._yoy(rows) == [("2019-01-01", 5.0), ("2019-02-01", 10.0)]


def test_build_stress_scores_revolsl_growth_not_level(tmp_path):
    # Nine Januaries: +10%/yr seven times, then +2%. As a LEVEL the latest
    # obs is the all-time max (percentile 100 forever, the audit bug); as
    # GROWTH it is the historical minimum -> percentile 1/8 = 12.5.
    level, rows = 100.0, [("2018-01-01", 100.0)]
    for year, pct in zip(range(2019, 2027), [10] * 7 + [2]):
        level *= 1 + pct / 100
        rows.append((f"{year}-01-01", level))
    vintage.append([Observation("REVOLSL", d, v, "2026-07-01", "FRED", "API")
                    for d, v in rows], tmp_path)
    stress = composites.build_stress(vintage.load(tmp_path))
    row = next(r for r in stress["indicators"] if r["code"] == "REVOLSL")
    assert row["value"] == 2.0    # YoY %, not the ~199 level
    assert row["score"] == 12.5


def test_phase4_writers_degrade_cleanly_with_partial_data(tmp_path):
    vintage.append([Observation("SAHMREALTIME", "2026-06-01", 0.6,
                                "2026-07-01", "FRED", "API")], tmp_path)
    conn = vintage.load(tmp_path)
    heat = composites.build_heatcheck(conn)
    recession = composites.build_recession(conn)
    assert heat["coverage_pct"] == 0
    assert recession["available"] == 1
    assert recession["probability_pct"] == 100
