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


def test_next_target_reads_any_key(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(json.dumps({
        "cpi": [{"release_date": "2026-09-11", "reference_month": "2026-08"},
                {"release_date": "2026-10-14", "reference_month": "2026-09"}],
        "pce": [{"release_date": "2026-09-30", "reference_month": "2026-08"},
                {"release_date": "2026-10-29", "reference_month": "2026-09"}]}))
    # between the two prints: CPI targets Sept, PCE still Aug
    assert release_calendar.next_target("2026-09-28", p) == \
        {"date": "2026-10-14", "reference_month": "2026-09"}
    assert release_calendar.next_target("2026-09-28", p, key="pce") == \
        {"date": "2026-09-30", "reference_month": "2026-08"}
    # past the calendar: Oct PCE normally prints in late Nov -> still the target 11-20
    assert release_calendar.next_target("2026-11-20", p, key="pce") == \
        {"date": None, "reference_month": "2026-10"}
    assert release_calendar.next_target("2026-11-20", p, key="nfp") is None


def test_default_config_seeds_pce_release_dates():
    raw = json.loads(release_calendar.DEFAULT_PATH.read_text())
    months = [e["reference_month"] for e in raw["pce"]]
    assert months[:3] == ["2026-06", "2026-07", "2026-08"]
