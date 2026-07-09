from pathlib import Path

from pipeline import basket
from pipeline.publish import replay, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

COMP = basket.Component(code="fuel", label="Gasoline", weight=1.0,
                        official_series="OFF_FU", live_blend={"L": 1.0},
                        live_variants=("gauge",))

RESULT = {"base_month": "2018-01", "variants": {"gauge": {
    "index": {"2017-12-31": 99.5, "2018-01-01": 100.0, "2018-01-02": 100.5},
    "yoy": {}, "as_of": "2018-01-02", "coverage_pct": 100.0, "gate_flags": [],
    "components": {"fuel": {
        "weight": 1.0, "mode": "live", "yoy_pct": 2.0, "end_value": 100.5,
        "daily_index": {"2017-12-31": 99.456, "2018-01-01": 100.004,
                        "2018-01-02": 100.456},
        "official_daily_index": {"2017-12-31": 99.0, "2018-01-01": 100.0,
                                 "2018-01-02": 100.111},
        "own_yoy_daily": {"2017-12-31": 1.5, "2018-01-01": 2.0,
                          "2018-01-02": None},
        "official_own_yoy_daily": {"2017-12-31": 0.9, "2018-01-01": 1.0,
                                   "2018-01-02": 1.1}}}}}}


def test_build_clips_rounds_and_pairs_arrays():
    p = replay.build(RESULT, [COMP])
    assert p["rebase"] == "2018-01=100"
    assert p["dates"] == ["2018-01-01", "2018-01-02"]  # 2017 clipped
    c = p["components"][0]
    assert c["code"] == "fuel" and c["label"] == "Gasoline"
    assert c["index"] == [100.0, 100.46]
    assert c["bls_index"] == [100.0, 100.11]
    assert len(c["index"]) == len(c["bls_index"]) == len(p["dates"])


def test_write_is_compact_and_validates(tmp_path):
    path = replay.write(replay.build(RESULT, [COMP]), tmp_path,
                        published_at="2026-07-08T12:00:00Z")
    assert path == tmp_path / "replay.json"
    assert '": ' not in path.read_text()  # compact separators, no indent
    validate.validate_file(path, SCHEMAS / "replay.schema.json")


def test_replay_carries_own_yoy_arrays():
    payload = replay.build(RESULT, [COMP])
    for comp in payload["components"]:
        assert len(comp["yoy"]) == len(payload["dates"])
        assert len(comp["bls_yoy"]) == len(payload["dates"])
    # a date where own_yoy is None must publish null, not a level ratio
    assert None in payload["components"][0]["yoy"]
