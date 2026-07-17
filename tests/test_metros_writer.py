"""Tests for pipeline/publish/metros.py — metros.json writer (P2 T6)."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import metros, validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMA = Path(__file__).parent.parent / "schemas" / "metros.schema.json"


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="ZILLOW", route="CSV")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


# --- METROS const consistency vs the registry (locked decision 1/2) ---------

def test_metros_const_matches_registry_zori_family():
    _, series = load_registry()
    zori = [s for s in series
            if s.code.startswith("zori_") and s.code != "zori_us"]
    assert [rid for rid, _ in metros.METROS] == \
        [s.code.split("_", 1)[1] for s in zori]
    # names derive from the registry: "ZORI rent index (New York, NY)"
    assert [name for _, name in metros.METROS] == \
        [s.name[s.name.index("(") + 1:-1] for s in zori]
    assert len(metros.METROS) == 50


def test_every_metro_has_a_zhvi_twin():
    _, series = load_registry()
    zhvi_codes = {s.code for s in series if s.code.startswith("zhvi_")}
    for rid, _ in metros.METROS:
        assert f"zhvi_{rid}" in zhvi_codes


# --- build() ----------------------------------------------------------------

def test_build_happy_path_hand_computed(tmp_path):
    conn = _store_with(tmp_path, {
        "zori_394913": {"2025-06-01": 3000.0, "2026-05-01": 3100.04,
                        "2026-06-01": 3150.0},
        "zhvi_394913": {"2025-06-01": 500000.0, "2026-06-01": 512345.6},
        "zori_us": {"2025-06-01": 2000.0, "2026-06-01": 2100.06},
        "zhvi_us": {"2025-06-01": 360000.0, "2026-06-01": 358000.4}})
    p = metros.build(conn)
    rows = {r["region_id"]: r for r in p["metros"]}
    ny = rows["394913"]
    assert ny["name"] == "New York, NY"
    # zori: 1dp value; yoy hand-computed (3150/3000 - 1)*100 = 5.0
    assert ny["zori"]["value"] == 3150.0
    assert ny["zori"]["as_of"] == "2026-06-01"
    assert ny["zori"]["yoy_pct"] == 5.0
    # tail = all 3 available obs months ascending; yoy null where base missing
    assert ny["zori"]["yoy_tail"] == {
        "months": ["2025-06-01", "2026-05-01", "2026-06-01"],
        "yoy_pct": [None, None, 5.0]}
    # zhvi: 0dp value; yoy (512345.6/500000 - 1)*100 = 2.46912 -> 2.47
    assert ny["zhvi"]["value"] == 512346
    assert ny["zhvi"]["yoy_pct"] == 2.47
    # national rides zori_us/zhvi_us
    assert p["national"]["zori"]["value"] == 2100.1
    assert p["national"]["zori"]["yoy_pct"] == 5.0
    assert p["national"]["zhvi"]["value"] == 358000
    # (358000.4/360000 - 1)*100 = -0.55544... -> -0.56
    assert p["national"]["zhvi"]["yoy_pct"] == -0.56


def test_rows_in_metros_sizerank_order(tmp_path):
    conn = _store_with(tmp_path, {})
    p = metros.build(conn)
    assert [r["region_id"] for r in p["metros"]] == \
        [rid for rid, _ in metros.METROS]
    assert [r["name"] for r in p["metros"]] == \
        [name for _, name in metros.METROS]


def test_tail_is_exactly_last_24_obs_months(tmp_path):
    # 26 monthly obs 2024-05..2026-06: tail keeps the latest 24 only
    rows = {f"{2024 + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}-01": 100.0 + m
            for m in range(5, 31)}
    conn = _store_with(tmp_path, {"zori_394913": rows})
    tail = metros.build(conn)["metros"][0]["zori"]["yoy_tail"]
    assert len(tail["months"]) == 24
    assert tail["months"][0] == "2024-07-01"
    assert tail["months"][-1] == "2026-06-01"
    # 2025-07 (m=19, value 119) vs 2024-07 (m=7, value 107):
    # (119/107 - 1)*100 = 11.2149... -> 11.21
    assert tail["yoy_pct"][tail["months"].index("2025-07-01")] == 11.21
    # earliest tail months have no 12-mo base in store
    assert tail["yoy_pct"][0] is None


def test_missing_metro_degrades_to_nulls(tmp_path):
    conn = _store_with(tmp_path, {
        "zori_394913": {"2026-06-01": 3150.0}})
    p = metros.build(conn)
    la = next(r for r in p["metros"] if r["region_id"] == "753899")
    for block in (la["zori"], la["zhvi"]):
        assert block == {"value": None, "as_of": None, "yoy_pct": None,
                         "yoy_tail": {"months": [], "yoy_pct": []}}
    # single-obs metro: value present, yoy null (no 12-mo base)
    ny = next(r for r in p["metros"] if r["region_id"] == "394913")
    assert ny["zori"]["value"] == 3150.0
    assert ny["zori"]["yoy_pct"] is None


# --- write() + schema -------------------------------------------------------

def test_written_file_validates_against_schema(tmp_path):
    conn = _store_with(tmp_path, {
        "zori_394913": {"2025-06-01": 3000.0, "2026-06-01": 3150.0},
        "zhvi_us": {"2026-06-01": 358000.4}})
    payload = metros.build(conn)
    path = metros.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    assert path.name == "metros.json"
    validate.validate_file(path, SCHEMA)
    text = path.read_text()
    assert text.startswith('{\n  "published_at"')
    assert text.endswith("\n")


def test_empty_store_degrades_and_validates(tmp_path):
    conn = _store_with(tmp_path, {})
    payload = metros.build(conn)
    assert len(payload["metros"]) == 50
    assert payload["national"]["zori"]["value"] is None
    assert payload["national"]["zhvi"]["yoy_tail"] == {"months": [],
                                                       "yoy_pct": []}
    path = metros.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
