import json

from pipeline.publish.util import write_json, yoy_pct


def test_yoy_pct_like_month_base():
    obs = {"2025-06-01": 100.0, "2026-06-01": 103.5}
    assert yoy_pct(obs, "2026-06-01") == 3.5


def test_yoy_pct_none_without_base_or_value():
    assert yoy_pct({"2026-06-01": 103.5}, "2026-06-01") is None   # no base
    assert yoy_pct({"2025-06-01": 100.0}, "2026-06-01") is None   # no value
    assert yoy_pct({"2025-06-01": 0.0, "2026-06-01": 5.0},
                   "2026-06-01") is None                          # zero base


def test_write_json_envelope(tmp_path):
    path = write_json({"published_at": "x", "a": 1}, tmp_path / "sub", "t.json")
    assert path.name == "t.json" and path.parent.name == "sub"
    text = path.read_text()
    assert text.endswith("\n") and json.loads(text) == {"published_at": "x", "a": 1}


def test_pct_change_daily_exact_and_weekend_tolerance():
    from pipeline.publish.util import pct_change_daily
    obs = {"2025-07-18": 3.0, "2026-07-20": 3.3}
    # 2026-07-20 minus 365 = 2025-07-20 (no obs); Fri 2025-07-18 within ±3d
    assert pct_change_daily(obs, "2026-07-20", 365) == 10.0
    exact = {"2025-07-16": 3.25, "2026-07-16": 3.575, "2025-07-15": 9.9}
    assert pct_change_daily(exact, "2026-07-16", 365) == 10.0  # exact wins


def test_pct_change_daily_null_beyond_tolerance_or_zero_base():
    from pipeline.publish.util import pct_change_daily
    assert pct_change_daily({"2025-07-10": 3.0, "2026-07-20": 3.3},
                            "2026-07-20", 365) is None  # 6d off
    assert pct_change_daily({"2025-07-20": 0.0, "2026-07-20": 3.3},
                            "2026-07-20", 365) is None  # zero base
