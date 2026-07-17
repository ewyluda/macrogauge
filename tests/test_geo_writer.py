"""Tests for pipeline/publish/geo.py — geo.json writer (P2 T7)."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import geo, validate
from pipeline.registry import load_registry
from pipeline.store import vintage
from tests.test_registry import STATE_ABBREVS

SCHEMA = Path(__file__).parent.parent / "schemas" / "geo.schema.json"

# Permanently disclosure-suppressed in QCEW — wage trio stays null forever.
QCEW_ABSENT = {"AK", "DC", "MA", "MO", "RI", "SD", "VT"}

NULL_MEASURE = {"value": None, "as_of": None, "yoy_pct": None}
NULL_RATE = {"value": None, "as_of": None, "delta_1y_pp": None}


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="TEST", route="TEST")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


# --- STATES const consistency vs test_registry + the registry families ------

def test_states_const_matches_state_abbrevs_order():
    assert [ab for ab, _ in geo.STATES] == list(STATE_ABBREVS)
    assert len(geo.STATES) == 51
    names = [name for _, name in geo.STATES]
    assert names == sorted(names)  # alphabetical by full state name
    assert dict(geo.STATES)["DC"] == "District of Columbia"


def test_states_const_families_exist_in_registry():
    _, series = load_registry()
    codes = {s.code for s in series}
    for ab, _ in geo.STATES:
        st = ab.lower()
        assert f"aaa_gas_{st}" in codes
        assert f"eia_elec_res_{st}" in codes
        assert f"eia_elec_ind_{st}" in codes
        assert f"{ab}UR" in codes
        # qcew coverage is exactly the non-suppressed 44 states
        assert (f"qcew_wage23_{st}" in codes) == (ab not in QCEW_ABSENT)


# --- build() ----------------------------------------------------------------

def test_build_happy_path_hand_computed(tmp_path):
    conn = _store_with(tmp_path, {
        # gas: daily spot; 2025-07-16 is exactly 365 days before 2026-07-16
        "aaa_gas_tx": {"2025-07-16": 3.25, "2026-07-16": 3.575},
        "eia_elec_res_tx": {"2025-05-01": 14.0, "2026-05-01": 15.123},
        "eia_elec_ind_tx": {"2025-05-01": 8.0, "2026-05-01": 8.5},
        "qcew_wage23_tx": {"2024-10-01": 1500.0, "2025-10-01": 1575.4},
        "TXUR": {"2025-06-01": 4.0, "2026-06-01": 4.14},
        "aaa_gas_d": {"2026-07-16": 3.2},
        "eia_elec_res": {"2025-05-01": 16.0, "2026-05-01": 16.8},
        "eia_elec_ind_us": {"2026-05-01": 9.0},
        "qcew_wage23_us": {"2024-10-01": 1400.0, "2025-10-01": 1470.0},
        "UNRATE": {"2025-06-01": 4.1, "2026-06-01": 3.9}})
    p = geo.build(conn)
    tx = next(r for r in p["states"] if r["state"] == "TX")
    assert tx["name"] == "Texas"
    # gas 3dp; yoy (3.575/3.25 - 1)*100 = 10.0
    assert tx["gas_regular"] == {"value": 3.575, "as_of": "2026-07-16",
                                 "yoy_pct": 10.0}
    # elec 2dp; yoy (15.123/14 - 1)*100 = 8.0214... -> 8.02
    assert tx["elec_res_cents"] == {"value": 15.12, "as_of": "2026-05-01",
                                    "yoy_pct": 8.02}
    assert tx["elec_ind_cents"] == {"value": 8.5, "as_of": "2026-05-01",
                                    "yoy_pct": 6.25}
    # wage 0dp (int); yoy (1575.4/1500 - 1)*100 = 5.0293... -> 5.03
    assert tx["wage_weekly"] == {"value": 1575, "as_of": "2025-10-01",
                                 "yoy_pct": 5.03}
    assert isinstance(tx["wage_weekly"]["value"], int)
    # unemployment 1dp; pp difference (not percent change): 4.14 - 4.0 = 0.14
    assert tx["unemployment_pct"] == {"value": 4.1, "as_of": "2026-06-01",
                                      "delta_1y_pp": 0.14}
    n = p["national"]
    assert n["gas_regular"] == {"value": 3.2, "as_of": "2026-07-16",
                                "yoy_pct": None}
    assert n["elec_res_cents"] == {"value": 16.8, "as_of": "2026-05-01",
                                   "yoy_pct": 5.0}
    assert n["elec_ind_cents"] == {"value": 9.0, "as_of": "2026-05-01",
                                   "yoy_pct": None}
    assert n["wage_weekly"] == {"value": 1470, "as_of": "2025-10-01",
                                "yoy_pct": 5.0}
    assert n["unemployment_pct"] == {"value": 3.9, "as_of": "2026-06-01",
                                     "delta_1y_pp": -0.2}


def test_rows_in_state_abbrevs_order(tmp_path):
    conn = _store_with(tmp_path, {})
    p = geo.build(conn)
    assert [r["state"] for r in p["states"]] == list(STATE_ABBREVS)
    assert [r["name"] for r in p["states"]] == [n for _, n in geo.STATES]


def test_gas_yoy_null_without_exact_365d_base(tmp_path):
    # nearby-but-not-exact old obs must NOT be used as a base
    conn = _store_with(tmp_path, {
        "aaa_gas_ca": {"2025-07-20": 4.0, "2026-07-15": 4.6, "2026-07-16": 4.5}})
    ca = next(r for r in geo.build(conn)["states"] if r["state"] == "CA")
    assert ca["gas_regular"] == {"value": 4.5, "as_of": "2026-07-16",
                                 "yoy_pct": None}


def test_zero_base_yields_null_yoy_not_crash(tmp_path):
    conn = _store_with(tmp_path, {
        "eia_elec_res_al": {"2025-05-01": 0.0, "2026-05-01": 15.0}})
    al = next(r for r in geo.build(conn)["states"] if r["state"] == "AL")
    assert al["elec_res_cents"] == {"value": 15.0, "as_of": "2026-05-01",
                                    "yoy_pct": None}


def test_qcew_suppressed_state_publishes_null_wage(tmp_path):
    conn = _store_with(tmp_path, {"MAUR": {"2026-06-01": 4.5}})
    ma = next(r for r in geo.build(conn)["states"] if r["state"] == "MA")
    assert ma["wage_weekly"] == NULL_MEASURE
    # single-obs UR: value present, delta null (no 12-mo base)
    assert ma["unemployment_pct"] == {"value": 4.5, "as_of": "2026-06-01",
                                      "delta_1y_pp": None}


# --- write() + schema -------------------------------------------------------

def test_written_file_validates_against_schema(tmp_path):
    conn = _store_with(tmp_path, {
        "aaa_gas_tx": {"2026-07-16": 3.575},
        "UNRATE": {"2025-06-01": 4.1, "2026-06-01": 3.9}})
    payload = geo.build(conn)
    path = geo.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    assert path.name == "geo.json"
    validate.validate_file(path, SCHEMA)
    text = path.read_text()
    assert text.startswith('{\n  "published_at"')
    assert text.endswith("\n")


def test_empty_store_degrades_and_validates(tmp_path):
    conn = _store_with(tmp_path, {})
    payload = geo.build(conn)
    assert len(payload["states"]) == 51
    for row in payload["states"]:
        for key in ("gas_regular", "elec_res_cents", "elec_ind_cents",
                    "wage_weekly"):
            assert row[key] == NULL_MEASURE
        assert row["unemployment_pct"] == NULL_RATE
    assert payload["national"]["gas_regular"] == NULL_MEASURE
    assert payload["national"]["unemployment_pct"] == NULL_RATE
    path = geo.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    validate.validate_file(path, SCHEMA)
