import pytest

from pipeline.publish import grocery
from pipeline.models import Observation
from pipeline.registry import Series
from pipeline.store import vintage


def _store_with(tmp_path, code_to_rows):
    """Helper: populate a vintage store from {code: {date: value}} fixture."""
    obs = []
    for code, rows in code_to_rows.items():
        for obs_date, value in rows.items():
            obs.append(Observation(series_code=code, obs_date=obs_date, value=value,
                                   vintage_date="2026-07-01", source="BLS", route="API"))
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def _series_row(code, name):
    """Helper: create a Series registry row for testing."""
    return Series(code=code, source="BLS", source_id=code, name=name, max_staleness_days=80)


def test_build_prices_changes_and_sorting(tmp_path):
    conn = _store_with(tmp_path, {
        "APU0000708111": {"2025-06-01": 2.50, "2026-05-01": 3.90, "2026-06-01": 4.00},
        "APU0000709112": {"2025-06-01": 4.00, "2026-05-01": 4.10, "2026-06-01": 4.20},
    })
    series = [_series_row("APU0000708111", "Avg price: eggs, grade A, dozen"),
              _series_row("APU0000709112", "Avg price: milk, whole, gallon")]
    payload = grocery.build(conn, series)
    # Items sorted by name, so eggs comes first
    assert [i["code"] for i in payload["items"]] == ["APU0000708111", "APU0000709112"]
    eggs = payload["items"][0]
    assert eggs["price"] == 4.00 and eggs["month"] == "2026-06-01"
    # Hand-computed: YoY = (4.00 / 2.50 - 1) * 100 = 60.00
    assert eggs["yoy_pct"] == 60.00
    # Hand-computed: MoM = (4.00 / 3.90 - 1) * 100 = 2.56 (rounded to 2 decimals)
    assert eggs["mom_pct"] == 2.56
    assert payload["skipped"] == []
    assert payload["as_of"] == "2026-06-01"


def test_series_without_yoy_base_is_skipped_not_fatal(tmp_path):
    conn = _store_with(tmp_path, {"APU0000711211": {"2026-06-01": 0.62}})
    payload = grocery.build(conn, [_series_row("APU0000711211", "Avg price: bananas, lb")])
    assert payload["items"] == [] and payload["skipped"] == ["APU0000711211"]


def test_non_ap_series_ignored(tmp_path):
    conn = _store_with(tmp_path, {"CPIAUCNS": {"2026-06-01": 320.0}})
    payload = grocery.build(conn, [_series_row("CPIAUCNS", "CPI-U all items (NSA)")])
    assert payload["items"] == [] and payload["skipped"] == []
