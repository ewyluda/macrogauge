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
