import json

import pytest

from pipeline import calendar_refresh, release_calendar


def _cfg(tmp_path, cpi):
    p = tmp_path / "cal.json"
    p.write_text(json.dumps({"cpi": cpi, "ppi": []}))
    return p


CPI_2026 = [{"release_date": "2026-11-10", "reference_month": "2026-10"},
            {"release_date": "2026-12-10", "reference_month": "2026-11"}]


def test_next_target_matches_next_print_while_scheduled(tmp_path):
    cfg = _cfg(tmp_path, CPI_2026)
    assert release_calendar.next_target("2026-11-11", cfg) == \
        {"date": "2026-12-10", "reference_month": "2026-11"}


@pytest.mark.parametrize("today,ref", [
    ("2026-12-11", "2026-12"),   # day after the last scheduled print
    ("2027-01-15", "2026-12"),   # Dec print (~mid-Jan) not yet assumed out
    ("2027-01-16", "2027-01"),
    ("2027-03-02", "2027-02"),
])
def test_next_target_infers_month_once_calendar_exhausted(tmp_path, today, ref):
    cfg = _cfg(tmp_path, CPI_2026)
    assert release_calendar.next_print(today, cfg) is None
    assert release_calendar.next_target(today, cfg) == {"date": None, "reference_month": ref}


def test_refreshed_file_extends_and_overrides_config(tmp_path):
    cfg = _cfg(tmp_path, CPI_2026)
    extra = tmp_path / "releases.json"
    extra.write_text(json.dumps({
        "_refreshed": "2026-10-20",
        "cpi": [{"release_date": "2026-12-11", "reference_month": "2026-11"},  # rescheduled
                {"release_date": "2027-01-13", "reference_month": "2026-12"}]}))
    cal = release_calendar.load(cfg, refreshed_path=extra)
    assert [e["release_date"] for e in cal["cpi"]] == ["2026-11-10", "2026-12-11", "2027-01-13"]
    assert "_refreshed" not in cal


def test_horizon_days(tmp_path):
    cfg = _cfg(tmp_path, CPI_2026)
    assert release_calendar.horizon_days("2026-09-26", path=cfg) == 75
    assert release_calendar.horizon_days("2026-12-20", path=cfg) == -10


class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def test_fetch_maps_release_month_minus_one(tmp_path):
    dates = {10: ["2026-09-11", "2026-10-14", "2027-01-13"], 46: ["2026-10-15"],
             54: ["2026-09-30"], 50: ["2026-10-02"]}
    seen = []

    def fake_get(url, timeout=None):
        seen.append(url)
        rid = int(url.split("release_id=")[1].split("&")[0])
        return _Resp(json.dumps({"release_dates": [{"release_id": rid, "date": d}
                                                   for d in dates[rid]]}))

    cal = calendar_refresh.fetch("KEY", "2026-09-26", http_get=fake_get)
    assert cal["cpi"][-1] == {"release_date": "2027-01-13", "reference_month": "2026-12"}
    assert cal["pce"] == [{"release_date": "2026-09-30", "reference_month": "2026-08"}]
    assert cal["nfp"] == [{"release_date": "2026-10-02", "reference_month": "2026-09"}]
    assert all("include_release_dates_with_no_data=true" in u for u in seen)
    out = calendar_refresh.write(cal, tmp_path / "calendar" / "releases.json", "2026-09-26")
    written = json.loads(out.read_text())
    assert written["_refreshed"] == "2026-09-26" and written["cpi"] == cal["cpi"]


def test_fetch_raises_on_empty_release():
    def fake_get(url, timeout=None):
        return _Resp(json.dumps({"release_dates": []}))
    with pytest.raises(ValueError, match="structure drift"):
        calendar_refresh.fetch("KEY", "2026-09-26", http_get=fake_get)
