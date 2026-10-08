import json
from pathlib import Path

from pipeline.engine.composites import (heat_check, latest_z, momentum,
                                        recession_composite, stress_index)

CONFIG = Path(__file__).parent.parent / "config" / "composites.json"


def test_momentum_diff_mode_keeps_sign_on_negative_series():
    rows = [("2026-01-01", -0.5), ("2026-02-01", -0.25)]
    assert momentum(rows, periods=1, percent=False) == [("2026-02-01", 0.25)]


def test_momentum_percent_skips_non_positive_priors():
    rows = [("d1", -0.1), ("d2", 0.0), ("d3", 200.0), ("d4", 300.0)]
    assert momentum(rows, periods=1) == [("d4", 50.0)]


def test_latest_z_diff_mode():
    rows = [(f"2026-{m:02d}-01", v) for m, v in
            enumerate([-0.5, -0.4, -0.2, 0.1, 0.5], start=1)]
    result = latest_z(rows, periods=1, direction=1, percent=False)
    assert result["momentum"] == 0.4
    assert result["z"] > 0


def test_heatcheck_config_uses_diff_mode_for_rates_and_spreads():
    cfg = json.loads(CONFIG.read_text())["heatcheck"]
    by_code = {item["code"]: item for item in cfg["indicators"]}
    for code in ("T10Y2Y", "T5YIE", "FEDFUNDS", "pmms_30yr", "UNRATE"):
        assert by_code[code].get("mode") == "diff", code
    assert by_code["T10Y2Y"]["periods"] == 63  # daily series ≈ 3 months
    assert by_code["ICSA"]["periods"] == 13    # weekly series ≈ 3 months


def test_latest_z_signs_and_clamps_momentum():
    rows, value = [], 100.0
    for month in range(1, 10):
        value *= 1 + month * month / 100
        rows.append((f"2026-{month:02d}-01", value))
    result = latest_z(rows, periods=1, direction=-1)
    assert -2.5 <= result["z"] < 0
    assert result["as_of"] == "2026-09-01"


def test_latest_z_formula_is_median_mad_value_pinned():
    # changes [1, 2, 3, 4, 6]: median 3, MAD 1 -> z = (6-3)/1.4826 = 2.0234.
    # First value pin on the formula that drives the published heat score.
    levels, total = [], 0.0
    for m, ch in enumerate([0, 1, 2, 3, 4, 6], start=1):
        total += ch
        levels.append((f"2026-{m:02d}-01", total))
    result = latest_z(levels, periods=1, percent=False)
    assert result["z"] == round((6 - 3) / (1.4826 * 1), 4)


def test_latest_z_outlier_era_cannot_mask_a_real_surge():
    # One COVID-sized outlier (+2640, March-2020 claims) in the history:
    # mean/stdev scored a genuine +30 surge at z = -0.33 -- COOLING. The
    # median/MAD baseline scores it at the +2.5 clamp.
    changes = [1, -1, 1, -1, 2640, -1, 1, 30]
    levels, total = [("2025-01-01", 0.0)], 0.0
    for m, ch in enumerate(changes, start=2):
        total += ch
        levels.append((f"2025-{m:02d}-01", total))
    result = latest_z(levels, periods=1, percent=False)
    assert result["z"] == 2.5


def test_composites_config_pins_audit_fixes():
    # audit 2026-07-16: PCUOMFGOMFG carried direction -1 (rising producer
    # prices scored as cooling); REVOLSL was percentile-scored as a raw
    # trending LEVEL (pinned ~100 forever) instead of its growth rate.
    cfg = json.loads(CONFIG.read_text())
    by_code = {item["code"]: item for item in cfg["heatcheck"]["indicators"]}
    assert by_code["PCUOMFGOMFG"]["direction"] == 1
    stress = {item["code"]: item for item in cfg["stress"]}
    assert stress["REVOLSL"].get("transform") == "yoy"


def test_heatcheck_rides_seasonally_adjusted_price_and_housing_inputs():
    # 2026-09-28: NSA CPI/core CPI/Case-Shiller 3-month momentum put a
    # calendar pattern into the z-scores (CPIAUCNS mean z -0.89 in Dec vs
    # +1.03 in Mar on the store); the SA equivalents flatten it to -0.25/+0.35.
    cfg = json.loads(CONFIG.read_text())
    codes = {item["code"] for item in cfg["heatcheck"]["indicators"]}
    assert {"CPIAUCSL", "CPILFESL", "CSUSHPISA"} <= codes
    assert not codes & {"CPIAUCNS", "CPILFENS", "CSUSHPINSA"}


def test_heat_check_renormalizes_available_groups():
    result = heat_check([
        {"code": "a", "group": "prices", "z": 1.0},
        {"code": "b", "group": "real", "z": -1.0}],
        {"prices": 25, "real": 25, "housing": 50})
    assert result["score"] == 0
    assert result["coverage_pct"] == 50


def test_stress_index_direction_adjusts_and_weights():
    result = stress_index([
        {"code": "bad", "value": 4, "history": [1, 2, 3, 4], "direction": 1, "weight": 20},
        {"code": "good", "value": 4, "history": [1, 2, 3, 4], "direction": -1, "weight": 10}])
    assert result["score"] == 66.7
    assert result["coverage_pct"] == 30


def test_stress_index_rows_do_not_embed_history():
    # history is scoring input, not display data — embedding ~1800 daily
    # values per indicator bloats stress.json for zero site benefit
    indicators = [{"code": "X", "weight": 1.0, "direction": 1, "value": 5.0,
                   "as_of": "2026-07-01", "history": [1.0, 2.0, 3.0, 4.0, 5.0]}]
    result = stress_index(indicators)
    assert "history" not in result["indicators"][0]
    assert result["indicators"][0]["score"] == 100.0


def test_recession_composite_uses_available_signals_only():
    result = recession_composite([
        {"name": "one", "triggered": True}, {"name": "two", "triggered": False},
        {"name": "missing", "triggered": None}])
    assert result["probability_pct"] == 50
    assert result["available"] == 2


def test_month_ends_run_oldest_first_across_a_year_boundary():
    from pipeline.publish.composites import _month_ends
    assert _month_ends("2026-02-10", 3) == ["2025-12-31", "2026-01-31", "2026-02-28"]


def test_histories_end_on_today_s_reading_and_replay_truncated_data(tmp_path):
    """The last history point is the published score at its own date; an
    earlier month-end replays only the observations on or before it."""
    from pipeline.models import Observation
    from pipeline.publish import composites as pc
    from pipeline.store import vintage
    import json as _json
    cfg = {"heatcheck": {"group_weights": {"prices": 1.0},
                         "indicators": [{"code": "X", "group": "prices", "direction": 1}]},
           "stress": [{"code": "Y", "weight": 100, "direction": 1}]}
    path = tmp_path / "composites.json"
    path.write_text(_json.dumps(cfg))
    months = [f"{2019 + i // 12}-{i % 12 + 1:02d}-01" for i in range(84)]
    obs = [Observation(series_code="X", obs_date=m, value=100 + i * (1 if i < 60 else 3),
                       vintage_date="2026-01-01", source="FRED", route="API") for i, m in enumerate(months)]
    obs += [Observation(series_code="Y", obs_date=m, value=float(i), vintage_date="2026-01-01",
                        source="FRED", route="API") for i, m in enumerate(months)]
    vintage.append(obs, tmp_path / "store")
    conn = vintage.load(tmp_path / "store")
    h = pc.build_heatcheck(conn, path, history_months=12)
    assert len(h["history"]["dates"]) == 12 and h["history"]["dates"][-1] == months[-1]
    assert h["history"]["score"][-1] == h["score"]
    s = pc.build_stress(conn, path, history_months=12)
    assert s["history"]["score"][-1] == s["score"]
    # a rising series percentile-scores at the top at every month-end
    assert all(v == s["score"] for v in s["history"]["score"])


def test_recession_rules_publish_their_numeric_test(tmp_path):
    from pipeline.models import Observation
    from pipeline.publish import composites as pc
    from pipeline.store import vintage
    vintage.append([Observation(series_code="T10Y3M", obs_date="2026-10-07", value=-0.2,
                                vintage_date="2026-10-07", source="FRED", route="API")], tmp_path)
    sig = {s["code"]: s for s in pc.build_recession(vintage.load(tmp_path))["signals"]}
    assert (sig["T10Y3M"]["op"], sig["T10Y3M"]["threshold"], sig["T10Y3M"]["triggered"]) == ("<", 0.0, True)
    assert (sig["CFNAIMA3"]["op"], sig["CFNAIMA3"]["threshold"]) == ("<", -0.7)
    assert sig["SAHMREALTIME"]["triggered"] is None          # no data, still states its rule
