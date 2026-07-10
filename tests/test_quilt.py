from pathlib import Path
from datetime import datetime, timedelta

from pipeline import basket
from pipeline.publish import quilt, validate

SCHEMAS = Path(__file__).parent.parent / "schemas"

COMP = basket.Component(code="fuel", label="Gasoline", weight=1.0,
                        official_series="OFF_FU", live_blend={"L": 1.0},
                        live_variants=("gauge",))


def _fake_gauge_result():
    """Generate fake gauge_result with >=26 months of daily dates.

    Dates span 2018-01-01 through 2018-03-01 (90 days, ~3 months).
    To get 26+ months for the 24-window test, we need more data.
    Let's span 2018-01-01 through 2020-03-31 (≥27 months).
    """
    dates = []
    current = datetime(2018, 1, 1)
    end = datetime(2020, 4, 1)
    while current < end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    # Build daily_index and own_yoy_daily for each date
    daily_index = {}
    official_daily_index = {}
    own_yoy_daily = {}
    official_own_yoy_daily = {}

    for i, d in enumerate(dates):
        daily_index[d] = 100.0 + (i * 0.01)
        official_daily_index[d] = 100.0 + (i * 0.005)
        # YoY only valid after ~365 days, else None
        if i >= 365:
            own_yoy_daily[d] = 2.0 + (i % 100) * 0.01
            official_own_yoy_daily[d] = 1.5 + (i % 100) * 0.008
        else:
            own_yoy_daily[d] = None
            official_own_yoy_daily[d] = None

    return {
        "base_month": "2018-01",
        "variants": {
            "gauge": {
                "index": {d: 100.0 + (dates.index(d) * 0.01) for d in dates},
                "yoy": {},
                "as_of": dates[-1],
                "coverage_pct": 100.0,
                "gate_flags": [],
                "components": {
                    "fuel": {
                        "weight": 1.0,
                        "mode": "live",
                        "yoy_pct": 2.0,
                        "end_value": daily_index[dates[-1]],
                        "daily_index": daily_index,
                        "official_daily_index": official_daily_index,
                        "own_yoy_daily": own_yoy_daily,
                        "official_own_yoy_daily": official_own_yoy_daily
                    }
                }
            }
        }
    }


def _fake_comps():
    """Return a list containing the fake component."""
    return [COMP]


def test_build_samples_month_ends():
    payload = quilt.build(_fake_gauge_result(), _fake_comps())
    assert payload["months"] == sorted(payload["months"])
    assert payload["months"][0] >= "2018-01"
    for comp in payload["components"]:
        assert len(comp["ours_yoy_pct"]) == len(payload["months"])
        assert len(comp["official_yoy_pct"]) == len(payload["months"])


def test_write_emits_three_windows(tmp_path):
    payload = quilt.build(_fake_gauge_result(), _fake_comps())
    paths = quilt.write(payload, tmp_path, published_at="2026-07-10T00:00:00Z")
    names = sorted(p.name for p in paths)
    assert names == ["quilt_months_24.json", "quilt_months_48.json",
                     "quilt_months_all.json"]
    import json
    p24 = json.loads((tmp_path / "quilt_months_24.json").read_text())
    p48 = json.loads((tmp_path / "quilt_months_48.json").read_text())
    pall = json.loads((tmp_path / "quilt_months_all.json").read_text())
    assert p24["window_months"] == 24 and pall["window_months"] is None
    assert len(p24["months"]) == min(24, len(pall["months"]))
    assert p24["months"] == pall["months"][-len(p24["months"]):]
    assert all(len(c["ours_yoy_pct"]) == len(p24["months"])
               for c in p24["components"])
    # p48 mirrors the p24-vs-pall tail-alignment assertions
    assert p48["window_months"] == 48
    assert len(p48["months"]) == min(48, len(pall["months"]))
    assert p48["months"] == pall["months"][-len(p48["months"]):]
    assert all(len(c["ours_yoy_pct"]) == len(p48["months"])
               for c in p48["components"])


def test_write_output_validates_against_schema(tmp_path):
    """All three window files must validate against quilt.schema.json — this
    exercises the file's validate/SCHEMAS imports, otherwise dead."""
    payload = quilt.build(_fake_gauge_result(), _fake_comps())
    paths = quilt.write(payload, tmp_path, published_at="2026-07-10T00:00:00Z")
    assert len(paths) == 3
    for path in paths:
        validate.validate_file(path, SCHEMAS / "quilt.schema.json")


def _fake_gauge_result_all_null_yoy():
    """Same shape as _fake_gauge_result but own_yoy_daily / official_own_yoy_daily
    are all None throughout — a component that never reaches YoY-valid dates.
    Confirms the schema's nullable YoY items accept an all-null series, not
    just a partially-null one."""
    result = _fake_gauge_result()
    fuel = result["variants"]["gauge"]["components"]["fuel"]
    fuel["own_yoy_daily"] = {d: None for d in fuel["own_yoy_daily"]}
    fuel["official_own_yoy_daily"] = {d: None for d in fuel["official_own_yoy_daily"]}
    return result


def test_write_all_null_component_validates(tmp_path):
    payload = quilt.build(_fake_gauge_result_all_null_yoy(), _fake_comps())
    for comp in payload["components"]:
        assert all(v is None for v in comp["ours_yoy_pct"])
        assert all(v is None for v in comp["official_yoy_pct"])
    paths = quilt.write(payload, tmp_path, published_at="2026-07-10T00:00:00Z")
    for path in paths:
        validate.validate_file(path, SCHEMAS / "quilt.schema.json")
