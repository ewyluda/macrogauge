"""Tests for pipeline/publish/labor.py — labor.json jobs artifact (todo #6)."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import labor, validate
from pipeline.store import vintage

SCHEMA = Path(__file__).parent.parent / "schemas" / "labor.schema.json"


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FRED", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_payrolls_block_hand_computed(tmp_path):
    conn = _store_with(tmp_path, {"PAYEMS": {
        "2025-06-01": 159000.0, "2026-05-01": 161500.0, "2026-06-01": 161650.0}})
    p = labor.build(conn)["payrolls"]
    assert p["level_k"] == 161650
    assert p["mom_change_k"] == 150            # 161650 - 161500
    assert p["yoy_pct"] == 1.67                # (161650/159000 - 1)*100 = 1.6667
    assert p["as_of"] == "2026-06-01"


def test_unemployment_delta_not_pct(tmp_path):
    conn = _store_with(tmp_path, {"UNRATE": {"2025-06-01": 4.1, "2026-06-01": 4.34}})
    u = labor.build(conn)["unemployment"]
    assert u == {"rate": 4.3, "delta_1y_pp": 0.24, "as_of": "2026-06-01"}


def test_claims_block_4wk_avg(tmp_path):
    conn = _store_with(tmp_path, {
        "ICSA": {"2026-06-06": 220000.0, "2026-06-13": 230000.0,
                 "2026-06-20": 240000.0, "2026-06-27": 250000.0,
                 "2026-07-04": 210000.0},
        "CCSA": {"2026-06-27": 1800000.0}})
    c = labor.build(conn)["claims"]
    assert c["initial"] == 210000
    # last 4 weeks: 230k,240k,250k,210k -> avg 232500
    assert c["initial_4wk_avg"] == 232500
    assert c["continued"] == 1800000
    assert c["as_of"] == "2026-07-04"


def test_wages_block(tmp_path):
    conn = _store_with(tmp_path, {
        "CES0500000003": {"2025-06-01": 30.0, "2026-06-01": 31.2},
        "FRBATLWGT3MMAUMHWGO": {"2026-06-01": 4.3}})
    w = labor.build(conn)["wages"]
    assert w["ahe_yoy_pct"] == 4.0             # (31.2/30 - 1)*100
    assert w["atlanta_wgt_pct"] == 4.3
    assert w["as_of"] == "2026-06-01"


def test_history_tails_capped(tmp_path):
    payems = {f"{2022 + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}-01": 150000.0 + m * 100
              for m in range(1, 49)}  # 48 months -> monthly tail keeps last 36
    conn = _store_with(tmp_path, {"PAYEMS": payems,
                                  "ICSA": {f"2026-{w:02d}-01": 200000.0 + w
                                           for w in range(1, 13)}})
    h = labor.build(conn)["history"]
    assert len(h["monthly"]["months"]) == 36
    assert len(h["monthly"]["payrolls_yoy_pct"]) == 36
    assert len(h["weekly"]["dates"]) <= 52


def test_empty_store_degrades_and_validates(tmp_path):
    conn = _store_with(tmp_path, {})
    payload = labor.build(conn)
    assert payload["payrolls"]["level_k"] is None
    assert payload["unemployment"]["delta_1y_pp"] is None
    path = labor.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
    assert path.name == "labor.json"


def test_written_file_validates(tmp_path):
    conn = _store_with(tmp_path, {
        "PAYEMS": {"2025-06-01": 159000.0, "2026-06-01": 161650.0},
        "UNRATE": {"2026-06-01": 4.3}})
    payload = labor.build(conn)
    path = labor.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
    text = path.read_text()
    assert text.startswith('{\n  "published_at"')
    assert text.endswith("\n")
