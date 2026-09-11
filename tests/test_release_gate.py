import json
from pathlib import Path

from pipeline import release_calendar, release_gate


def _cal(tmp_path):
    p = tmp_path / "cal.json"
    p.write_text(json.dumps({
        "cpi": [{"release_date": "2026-09-11", "reference_month": "2026-08"}],
        "ppi": [{"release_date": "2026-09-10", "reference_month": "2026-08"},
                {"release_date": "2026-09-11", "reference_month": "2026-08"}],
    }))
    return p


def _store(tmp_path, rows):
    obs = tmp_path / "store" / "obs"
    obs.mkdir(parents=True)
    (obs / "2026-09.jsonl").write_text("".join(
        json.dumps({"obs_date": d, "route": "API", "series_code": c, "source": "FRED",
                    "value": 1.0, "vintage_date": "2026-09-11"}) + "\n" for c, d in rows))
    return tmp_path / "store"


def test_due_today_spans_keys_and_ignores_other_days(tmp_path):
    due = release_calendar.due_today("2026-09-11", _cal(tmp_path))
    assert [(d["key"], d["reference_month"]) for d in due] == [("cpi", "2026-08"), ("ppi", "2026-08")]
    assert release_calendar.due_today("2026-09-12", _cal(tmp_path)) == []


def test_missing_when_anchor_row_absent(tmp_path):
    store = _store(tmp_path, [("PPIACO", "2026-08-01")])
    missing = release_gate.missing_prints("2026-09-11", store, _cal(tmp_path))
    assert [(m["key"], m["series_code"], m["obs_date"]) for m in missing] == \
        [("cpi", "CPIAUCNS", "2026-08-01")]


def test_nothing_missing_once_both_prints_landed(tmp_path):
    store = _store(tmp_path, [("PPIACO", "2026-08-01"), ("CPIAUCNS", "2026-08-01")])
    assert release_gate.missing_prints("2026-09-11", store, _cal(tmp_path)) == []


def test_non_release_day_never_republishes(tmp_path):
    store = _store(tmp_path, [])
    assert release_gate.missing_prints("2026-09-14", store, _cal(tmp_path)) == []


def test_prior_month_row_does_not_satisfy(tmp_path):
    # A July row must not be mistaken for the August print.
    store = _store(tmp_path, [("CPIAUCNS", "2026-07-01"), ("PPIACO", "2026-07-01")])
    keys = sorted(m["key"] for m in release_gate.missing_prints("2026-09-11", store, _cal(tmp_path)))
    assert keys == ["cpi", "ppi"]


def test_cli_prints_republish_flag(tmp_path, capsys):
    store = _store(tmp_path, [("PPIACO", "2026-08-01")])
    assert release_gate.main(["--store", str(store), "--today", "2026-09-11",
                              "--calendar", str(_cal(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert "missing today's CPI print: CPIAUCNS 2026-08" in out
    assert out.strip().endswith("republish=true")
    assert release_gate.main(["--store", str(store), "--today", "2026-09-14",
                              "--calendar", str(_cal(tmp_path))]) == 0
    assert capsys.readouterr().out.strip() == "republish=false"


def test_default_calendar_has_sorted_ppi_dates_aligned_with_cpi_months():
    raw = json.loads(release_calendar.DEFAULT_PATH.read_text())
    ppi = [e["release_date"] for e in raw["ppi"]]
    assert ppi == sorted(ppi) and len(ppi) >= 6
    assert {e["reference_month"] for e in raw["ppi"]} == {e["reference_month"] for e in raw["cpi"]}
    assert set(release_gate.ANCHORS) <= set(raw)


def test_live_store_shape_is_readable():
    # The real store must be scannable by the stdlib reader (no sqlite, no deps).
    store = Path(__file__).parent.parent / "store"
    if not (store / "obs").exists():
        return
    assert release_gate._has_obs(store, "CPIAUCNS", "2018-01-01")
