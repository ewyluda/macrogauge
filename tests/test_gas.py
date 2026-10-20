import copy
import json
import re
from datetime import date, timedelta
from pathlib import Path

import jsonschema
import pytest

from pipeline import dc_power, gas_config, power_deals
from pipeline.models import Observation
from pipeline.publish import gas
from pipeline.store import vintage

ROOT = Path(__file__).parent.parent
REAL = json.loads(gas_config.DEFAULT_PATH.read_text())
SCHEMA = json.loads((ROOT / "schemas" / "gas.schema.json").read_text())


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s)


def _load(tmp_path, fn):
    raw = copy.deepcopy(REAL)
    fn(raw)
    p = tmp_path / "gas.json"
    p.write_text(json.dumps(raw))
    return gas_config.load(p)


def _conn(tmp_path, rows, vintages=None):
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date=(vintages or {}).get((c, d), "2026-01-01"),
                       source="T", route="API") for c, d, v in rows]
    vintage.append(obs, tmp_path / "store")
    return vintage.load(tmp_path / "store")


def _daily(code, start, end, value):
    d, out = date.fromisoformat(start), []
    while d <= date.fromisoformat(end):
        v = value(d) if callable(value) else value
        out.append((code, d.isoformat(), v))
        d += timedelta(days=1)
    return out


# --- the real config -----------------------------------------------------------

def test_real_config_heat_rates_and_heat_content():
    c = gas_config.load()
    assert {h.key: h.btu_per_kwh for h in c.heat_rates} == {
        "combined_cycle": 7548, "recip_engine": 8924, "gas_turbine": 10999}
    assert c.btu_per_cf == 1036 and c.heat_content_year == 2025


def test_every_quote_is_in_its_committed_evidence():
    c = gas_config.load()
    for h in c.heat_rates:
        assert _norm(h.quote) in _norm((ROOT / h.evidence).read_text()), h.key
    ev = _norm((ROOT / c.heat_content_evidence).read_text())
    assert _norm(c.heat_content_quote) in ev
    assert _norm(REAL["column_quote"]) in _norm((ROOT / c.heat_rates[0].evidence).read_text())


def test_a_figure_from_another_column_fails_at_load(tmp_path):
    # 9,702 is the Petroleum column of the same Combined Cycle row
    with pytest.raises(ValueError, match="Natural Gas column"):
        _load(tmp_path, lambda r: r["heat_rates"][0].update(btu_per_kwh=9702))


def test_a_quote_from_another_year_fails_at_load(tmp_path):
    with pytest.raises(ValueError, match="not the 2023 row"):
        _load(tmp_path, lambda r: r["heat_rates"][0].update(year=2023))


def test_heat_content_must_be_the_named_years_us_value(tmp_path):
    with pytest.raises(ValueError, match="heat content"):
        _load(tmp_path, lambda r: r["heat_content"].update(btu_per_cf=1037))
    with pytest.raises(ValueError, match="heat content"):
        _load(tmp_path, lambda r: r["heat_content"].update(year=2024))


# --- writer ----------------------------------------------------------------------

def test_henry_hub_window_average_and_yoy(tmp_path):
    rows = (_daily(gas.HH, "2025-09-01", "2025-10-31", 2.0)
            + _daily(gas.HH, "2026-09-01", "2026-10-14", 3.0))
    hh = gas.henry_hub(_conn(tmp_path, rows))
    assert hh["as_of"] == "2026-10-14" and hh["latest"] == 3.0
    assert hh["avg30"] == 3.0 and hh["avg30_year_ago"] == 2.0 and hh["avg30_yoy_pct"] == 50.0
    assert hh["low_52w"] == 2.0 and hh["high_52w"] == 3.0   # 2025-10-15.. is inside the year


def test_storage_five_year_average_uses_the_same_iso_week(tmp_path):
    # one Friday print per week; value = 1000 + year offset so each year is distinct
    rows, d = [], date(2020, 1, 3)
    while d <= date(2026, 10, 9):
        rows.append((gas.STORAGE, d.isoformat(), 1000.0 + (d.year - 2020) * 100))
        d += timedelta(days=7)
    st = gas.storage(_conn(tmp_path, rows))
    assert st["as_of"] == "2026-10-09" and st["bcf"] == 1600
    assert st["avg5_bcf"] == 1300            # mean of 2021..2025 = 1100..1500
    assert st["year_ago_bcf"] == 1500 and st["vs_year_ago_pct"] == pytest.approx(6.7)
    assert st["chg_week_bcf"] == 0
    assert len(st["history"]["dates"]) == gas.STORAGE_WEEKS


def test_storage_five_year_average_needs_all_five_years(tmp_path):
    rows = [(gas.STORAGE, "2025-10-10", 3700.0), (gas.STORAGE, "2026-10-09", 3567.0)]
    st = gas.storage(_conn(tmp_path, rows))
    assert st["avg5_bcf"] is None and st["vs_avg5_pct"] is None
    assert st["year_ago_bcf"] == 3700


def test_demand_converts_mmcf_to_bcf_per_day_and_trailing_twelve(tmp_path):
    rows = []
    for y in (2024, 2025, 2026):
        for m in range(1, 13):
            if (y, m) > (2026, 7):
                continue
            days = [31, 29 if y == 2024 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
            per_day = 30.0 if y < 2025 or (y == 2025 and m <= 7) else 33.0
            rows.append((gas.BURN, f"{y}-{m:02d}-01", per_day * days * 1000))
    d = gas.demand(_conn(tmp_path, rows))
    pb = d["power_burn"]
    assert pb["as_of"] == "2026-07-01" and pb["bcf_d"] == 33.0
    assert pb["yoy_pct"] == 10.0
    assert pb["ttm_bcf_d"] == 33.0 and pb["ttm_yoy_pct"] == 10.0
    assert d["lng_exports"] is None
    assert len(d["history"]["months"]) == 31          # every month, under the DEMAND_MONTHS cap


def test_power_vs_gas_divides_on_the_hubs_own_window(tmp_path):
    hub = dc_power.HubSpec(code="ice_pjm_west", label="PJM", grid="PJM", region="r", product="On-peak")
    cfg = dc_power.PowerConfig(hubs=(hub,), henry_hub=dc_power.HubSpec(code=gas.HH, label="HH"),
                               capacity_auction={}, capacity_markets={}, tariffs=())
    rows = (_daily("ice_pjm_west", "2025-09-10", "2025-10-13", 40.0)
            + _daily("ice_pjm_west", "2026-09-10", "2026-10-13", 90.0)
            + _daily(gas.HH, "2025-09-10", "2025-10-13", 4.0)
            # gas the hub has NOT reached yet must not enter its window
            + _daily(gas.HH, "2026-09-10", "2026-10-13", 3.0)
            + _daily(gas.HH, "2026-10-14", "2026-10-19", 99.0))
    (r,) = gas.power_vs_gas(_conn(tmp_path, rows), cfg, 7.548)
    assert r["gas_avg30"] == 3.0 and r["ratio"] == 30.0 and r["ratio_year_ago"] == 10.0
    assert r["power_yoy_pct"] == 125.0 and r["gas_yoy_pct"] == -25.0 and r["ratio_yoy_pct"] == 200.0
    assert r["vs_cc_fuel"] == pytest.approx(3.97, abs=0.01)


def test_outlook_dates_the_release_by_vintage_and_goes_stale(tmp_path):
    months = [f"2026-{m:02d}-01" for m in range(9, 13)] + [f"2027-{m:02d}-01" for m in range(1, 13)]
    rows = [(gas.STEO, m, 3.0 + i * 0.1) for i, m in enumerate(months)]
    vint = {(gas.STEO, m): "2026-10-07" for m in months}
    vint[(gas.STEO, "2026-09-01")] = "2026-10-15"   # a past month's later revision never dates the forecast
    conn = _conn(tmp_path, rows, vint)
    o = gas.outlook(conn, "2026-10-19")
    assert o["release_seen"] == "2026-10-07" and o["stale"] is False
    assert o["months"][0] == "2026-10-01" and o["next12_to"] == "2027-09-01"
    assert o["next12_avg"] == pytest.approx(sum(3.1 + i * 0.1 for i in range(12)) / 12, abs=0.005)
    assert gas.outlook(conn, "2026-12-01")["stale"] is True


def test_fuel_cost_arithmetic_and_stale_forward(tmp_path):
    fuel = gas_config.load()
    spot = {"avg30": 3.0, "as_of": "2026-10-14"}
    fc = gas.fuel_cost(fuel, spot, {"stale": False, "next12_avg": 4.0})
    cc = next(r for r in fc["heat_rates"] if r["key"] == "combined_cycle")
    assert cc["fuel_usd_mwh"] == 22.64 and cc["fuel_usd_mwh_forward"] == 30.19
    assert cc["usd_per_mw_year"] == round(3.0 * 7.548 * 8760)
    assert cc["per_dollar_usd_mwh"] == 7.55
    assert gas.fuel_cost(fuel, spot, {"stale": True, "next12_avg": 4.0})["forward_price"] is None
    assert gas.fuel_cost(None, spot, None) is None


def test_ai_gas_deals_full_output_burn():
    fuel, deals = gas_config.load(), power_deals.load()
    block = gas.ai_gas_deals(deals, fuel, {"power_burn": {"ttm_bcf_d": 36.0}})
    # 1 GW at 7,548 Btu/kWh for 24h = 181,152 MMBtu/d / 1.036 MMBtu per Mcf
    assert gas._bcf_d_full_output(1000, fuel, fuel.heat_rates[0]) == pytest.approx(0.17486, abs=1e-4)
    assert all(d["status"] for d in block["deals"])
    gas_deals = [d for d in deals.deals if d.technology == "gas"]
    assert {d["facility"] for d in block["deals"]} == {d.facility for d in gas_deals}
    assert block["signed_mw"] == sum(d.mw_total for d in gas_deals if d.status == "signed")
    assert block["signed_share_of_power_burn_pct"] == round(block["signed_bcf_d"] / 36.0 * 100, 1)
    # signed first
    statuses = [d["status"] == "signed" for d in block["deals"]]
    assert statuses == sorted(statuses, reverse=True)


def test_empty_store_publishes_null_blocks_that_validate(tmp_path):
    conn = _conn(tmp_path, [("unrelated", "2026-01-01", 1.0)])
    payload = gas.build(conn, "2026-10-19", power_cfg=dc_power.load(),
                        gas_cfg=gas_config.load(), deals_cfg=power_deals.load())
    for k in ("henry_hub", "futures", "outlook", "storage", "demand", "fuel_cost"):
        assert payload[k] is None, k
    assert payload["power_vs_gas"] is None
    assert payload["ai_gas_deals"]["power_burn_ttm_bcf_d"] is None
    jsonschema.validate({"published_at": "x", **payload}, SCHEMA)


def test_full_payload_validates(tmp_path):
    rows = (_daily(gas.HH, "2025-01-01", "2026-10-14", 3.0)
            + _daily(gas.FUT, "2025-01-01", "2026-10-17", 3.2)
            + _daily("ercot_north_da", "2025-01-01", "2026-10-17", 40.0)
            + [(gas.STORAGE, "2026-10-09", 3567.0), (gas.BURN, "2026-07-01", 1531221.0),
               (gas.LNG, "2026-07-01", 518777.0), (gas.STEO, "2026-11-01", 3.2)])
    conn = _conn(tmp_path, rows)
    payload = gas.build(conn, "2026-10-19", power_cfg=dc_power.load(),
                        gas_cfg=gas_config.load(), deals_cfg=power_deals.load())
    jsonschema.validate({"published_at": "x", **payload}, SCHEMA)
    assert payload["power_vs_gas"][0]["code"] == "ercot_north_da"
    assert payload["futures"]["vs_spot"] == pytest.approx(0.2)
