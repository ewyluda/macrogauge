import json

from pipeline import release_calendar


def cfg(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(json.dumps({"cpi": [
        {"release_date": "2026-07-14", "reference_month": "2026-06"},
        {"release_date": "2026-08-12", "reference_month": "2026-07"}]}))
    return p


def test_before_a_release_returns_it(tmp_path):
    assert release_calendar.next_print("2026-07-01", cfg(tmp_path)) == \
        {"date": "2026-07-14", "reference_month": "2026-06"}


def test_on_release_day_still_returns_it(tmp_path):
    assert release_calendar.next_print("2026-07-14", cfg(tmp_path))["date"] == "2026-07-14"


def test_after_release_rolls_to_next(tmp_path):
    assert release_calendar.next_print("2026-07-15", cfg(tmp_path))["reference_month"] == "2026-07"


def test_exhausted_calendar_returns_none(tmp_path):
    assert release_calendar.next_print("2027-01-01", cfg(tmp_path)) is None


def test_default_config_loads_and_is_sorted():
    raw = json.loads(release_calendar.DEFAULT_PATH.read_text())
    dates = [e["release_date"] for e in raw["cpi"]]
    assert dates == sorted(dates) and len(dates) >= 6
