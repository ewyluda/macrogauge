import json
from pathlib import Path

import jsonschema
import pytest

from pipeline.models import Observation
from pipeline.publish import capacity as writer
from pipeline.store import vintage

SCHEMA = json.loads((Path(__file__).parent.parent / "schemas"
                     / "capacity.schema.json").read_text())


def _cfg(companies):
    return {"schema_version": 1, "as_of_curated": "2026-07-21", "note": "n",
            "basis": {"ev": "cap + net debt"}, "companies": companies,
            "tenants": [], "geo": [], "geo_unmapped": [], "geo_note": "g"}


def _co(**kw):
    base = {"t": "AAA", "n": "Aaa Corp", "role": "neocloud", "dupe": None,
            "private": False, "valuation_b": None, "confidence": "filed",
            "op": 100, "con": 200, "plan": 400, "pipe": None, "nd": 10.0,
            "ndflag": None, "bk": 50.0, "flag": None, "dom": None,
            "econ": {}, "sites": [], "src": []}
    base.update(kw)
    return base


def _conn(tmp_path, rows):
    tmp_path.mkdir(parents=True, exist_ok=True)  # empty-store case
    obs = [Observation(series_code=c, obs_date=d, value=v,
                       vintage_date="2026-07-21", source="FMP_EQ", route="API")
           for c, d, v in rows]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_public_row_derived_math(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0),
                            ("fmp_px_aaa", "2026-07-20", 12.5)])
    out = writer.build(conn, _cfg([_co()]))
    row = out["companies"][0]
    assert row["cap"] == 90.0 and row["px"] == 12.5
    assert row["priced_date"] == "2026-07-20" and row["stale"] is False
    assert row["ev"] == 100.0                      # 90 + 10 nd
    assert row["wmw"] == 300.0                     # 100 + 0.5*200 + 0.25*400
    assert row["ev_per_mw"] == pytest.approx(333.3)  # 100*1000/300, $M/MW 1dp
    assert row["pct_energized"] == pytest.approx(14.3)  # 100/700
    assert row["coverage"] == 0.5                  # 50/100
    assert out["priced_date"] == "2026-07-20"


def test_hyperscaler_and_private_suppress_ev_per_mw(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_hhh", "2026-07-20", 3000.0)])
    cfg = _cfg([_co(t="HHH", role="hyperscaler"),
                _co(t="PPP", private=True, valuation_b=200.0)])
    rows = {r["t"]: r for r in writer.build(conn, cfg)["companies"]}
    assert rows["HHH"]["ev"] == 3010.0 and rows["HHH"]["ev_per_mw"] is None
    assert rows["PPP"]["cap"] is None and rows["PPP"]["ev"] is None
    assert rows["PPP"]["ev_per_mw"] is None
    assert rows["PPP"]["valuation_b"] == 200.0
    assert rows["PPP"]["stale"] is False           # private is never "stale"


def test_missing_cap_degrades_not_drops(tmp_path):
    conn = _conn(tmp_path, [])
    row = writer.build(conn, _cfg([_co()]))["companies"][0]
    assert row["cap"] is None and row["stale"] is True
    assert row["ev"] is None and row["ev_per_mw"] is None and row["coverage"] is None
    assert row["pct_energized"] is not None        # MW math never needs a quote


def test_carried_forward_cap_flags_stale(tmp_path):
    # An old quote keeps its value + priced_date (carry-forward is harmless)
    # but must flag stale once it ages past the registry limit — never
    # publish a weeks-old cap as fresh.
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-06-01", 90.0)])
    row = writer.build(conn, _cfg([_co()]), today="2026-07-21",
                       staleness={"fmp_cap_aaa": 7})["companies"][0]
    assert row["stale"] is True
    assert row["cap"] == 90.0 and row["priced_date"] == "2026-06-01"
    assert row["ev"] == 100.0
    conn2 = _conn(tmp_path / "fresh", [("fmp_cap_aaa", "2026-07-20", 90.0)])
    row2 = writer.build(conn2, _cfg([_co()]), today="2026-07-21",
                        staleness={"fmp_cap_aaa": 7})["companies"][0]
    assert row2["stale"] is False


def test_company_tl_lists_dated_construction_events(tmp_path):
    # Per-company parsed events power client-side filtered timelines; same
    # st/mw/window filter as the cohort timeline (shared _events helper).
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(sites=[["S1", 50, "c", "Q3 2026"],
                           ["S2", 20, "c", "2027 Q1"],
                           ["S3", 99, "p", "Q3 2026"],
                           ["S4", 99, "c", "undated"]])])
    row = writer.build(conn, cfg)["companies"][0]
    assert row["tl"] == [["2026Q3", "S1", 50], ["2027Q1", "S2", 20]]


def test_cohort_totals_dedupe_and_split(tmp_path):
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(t="AAA", op=100, con=0, plan=0),
                _co(t="BBB", op=50, con=0, plan=0, dupe="tenant"),
                _co(t="HHH", op=900, con=0, plan=0, role="hyperscaler")])
    cohorts = writer.build(conn, cfg)["cohorts"]
    assert cohorts["neocloud"] == {"companies": 2, "op": 100, "con": 0, "plan": 0}
    assert cohorts["hyperscaler"] == {"companies": 1, "op": 900, "con": 0, "plan": 0}
    assert cohorts["all"] == {"companies": 3, "op": 1000, "con": 0, "plan": 0}


@pytest.mark.parametrize("when,expected", [
    ("Q3 2026", 2026 * 4 + 2),
    ("phased from 2026", 2026 * 4 + 3),      # bare year -> Q4
    ("early 2027", 2027 * 4 + 0),
    # parentheticals are ignored: H2 -> Q4 (was Q3 off the "(Sep)" aside —
    # the old parser read a keyword ANYWHERE; a date in an aside must be
    # curated as energize_q instead)
    ("majority H2 2026 (Sep)", 2026 * 4 + 3),
    ("mid-2026", 2026 * 4 + 1),
    ("operating", None),
    (None, None),
    # --- the misdates the old parser produced (live config strings) ---
    # first year anywhere + first quarter keyword anywhere -> 2026Q2
    ("signed Aug 2026; initial 96 MW Dec 2027, full 191 MW by Jun 2028", 2027 * 4 + 3),
    # "(2 mo early)" matched `early` -> Q1
    ("initial capacity live Aug 2026 (2 mo early), rent commenced", 2026 * 4 + 2),
    # "(slipped from Q3)" matched q3
    ("delivery Q4 2026 (slipped from Q3); ~0.3 GW IT delivered in 2026", 2026 * 4 + 3),
    # half-years: 1H -> Q2, 2H -> Q4 (old: bare-year default Q4 for 1H)
    ("initial ops 1H 2028", 2028 * 4 + 1),
    ("AMD delivery 2H 2027", 2027 * 4 + 3),
    # the regex could not see 2030 (todo #23)
    ("first power Q1 2030", 2030 * 4 + 0),
    ("phased to 2039", 2039 * 4 + 3),
    ("2040", None),
    # a deal-close date loses to a delivery milestone
    ("closed 2026-08-14 (~$444M); next ~82 MW 2H 2027", 2027 * 4 + 3),
    # construction start loses to first data hall
    ("advanced to construction Aug 2026; initial data hall Q2 2028", 2028 * 4 + 1),
    # earliest first-power milestone, not full build-out
    ("1H 2027 – 1H 2028; full 530 MW by end-2028", 2027 * 4 + 1),
    # "may" is not a month unless adjacent to a year
    ("2027-28 (timing TBD); MW attribution may be generous", 2027 * 4 + 3),
    ("YE 2026 target", 2026 * 4 + 3),
    ("~summer 2028", 2028 * 4 + 2),
    ("construction launched Q1'26", 2026 * 4 + 0),
    ("Oct-2025", 2025 * 4 + 3),
    ("decision 2027", 2027 * 4 + 3),          # not "Dec 2027"
])
def test_parse_quarter(when, expected):
    assert writer.parse_quarter(when) == expected


@pytest.mark.parametrize("site,expected", [
    (["S", 100, "c", "signed Aug 2026", "2027Q4"], 2027 * 4 + 3),  # curated wins
    (["S", 100, "c", "Q3 2026", None], None),     # curated null = undated
    (["S", 100, "c", "Q3 2026"], 2026 * 4 + 2),   # no field -> free-text parse
])
def test_site_quarter_prefers_curated_energize_q(site, expected):
    assert writer.site_quarter(site) == expected


def test_energize_q_drives_tl_and_timeline_and_is_not_published(tmp_path):
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(op=100, sites=[["S1", 50, "c", "signed Aug 2026", "2027Q4"],
                                   ["S2", 30, "c", "Q3 2026", None],
                                   ["S3", 20, "c", "Q3 2026"]])])
    out = writer.build(conn, cfg)
    row = out["companies"][0]
    assert row["tl"] == [["2027Q4", "S1", 50], ["2026Q3", "S3", 20]]
    # published sites keep the 4-element shape the page destructures
    assert all(len(s) == 4 for s in row["sites"])
    tl = {p["q"]: p for p in out["timeline"]["all"]["points"]}
    assert tl["2026Q3"]["add_mw"] == 20 and tl["2027Q4"]["add_mw"] == 50
    assert tl["2027Q4"]["cum_mw"] == 170   # S2 (curated undated) excluded


def test_timeline_cumulative_from_construction_sites(tmp_path):
    conn = _conn(tmp_path, [])
    cfg = _cfg([_co(op=100, sites=[["S1", 50, "c", "Q3 2026"],
                                   ["S2", 30, "c", "Q3 2026"],
                                   ["S3", 20, "c", "2027 Q1"],
                                   ["S4", 99, "p", "Q3 2026"],      # planned: excluded
                                   ["S5", 99, "c", "undated"]])])   # unparseable: excluded
    tl = writer.build(conn, cfg)["timeline"]["all"]
    assert tl["base_mw"] == 100
    assert tl["points"][0] == {"q": "2026Q2", "add_mw": 0, "cum_mw": 100}
    qmap = {p["q"]: p for p in tl["points"]}
    assert qmap["2026Q3"]["add_mw"] == 80 and qmap["2026Q3"]["cum_mw"] == 180
    assert qmap["2027Q1"]["cum_mw"] == 200
    assert tl["milestones"]["2026Q3"] == [["AAA", "S1", 50], ["AAA", "S2", 30]]


def test_reference_block(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_nvda", "2026-07-20", 4150.0),
                            ("fmp_cap_aaa", "2026-07-20", 90.0)])
    out = writer.build(conn, _cfg([_co()]))
    assert out["reference"] == {"nvda_cap_b": 4150.0, "cohort_ev_b": 100.0}


def test_cohort_ev_excludes_rows_whose_ev_per_mw_is_suppressed(tmp_path):
    # A hyperscaler's conglomerate EV is suppressed per row (ev_per_mw null)
    # as misleading over an AI-DC slice — the combined figure must not sum it
    # back in. AAA (neocloud) counts; HHH (hyperscaler) does not.
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0),
                            ("fmp_cap_hhh", "2026-07-20", 3000.0)])
    out = writer.build(conn, _cfg([_co(), _co(t="HHH", role="hyperscaler")]))
    hhh = next(r for r in out["companies"] if r["t"] == "HHH")
    assert hhh["ev"] == 3010.0 and hhh["ev_per_mw"] is None
    assert out["reference"]["cohort_ev_b"] == 100.0


def test_write_validates_against_schema(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0)])
    payload = writer.build(conn, _cfg([_co()]))
    path = writer.write(payload, tmp_path, "2026-07-21T12:00:00Z")
    jsonschema.validate(json.loads(path.read_text()), SCHEMA)
    # degraded payload (empty store) must validate too
    conn2 = _conn(tmp_path / "empty", [])
    p2 = writer.write(writer.build(conn2, _cfg([_co()])), tmp_path, "2026-07-21T12:00:00Z")
    jsonschema.validate(json.loads(p2.read_text()), SCHEMA)


def test_zero_backlog_publishes_zero_coverage(tmp_path):
    conn = _conn(tmp_path, [("fmp_cap_aaa", "2026-07-20", 90.0)])
    row = writer.build(conn, _cfg([_co(bk=0.0)]))["companies"][0]
    assert row["coverage"] == 0.0
