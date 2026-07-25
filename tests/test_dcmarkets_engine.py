from pipeline.dc_markets import MarketSpec
from pipeline.engine import dcmarkets

CUR, BASE = "2025-10-01", "2024-10-01"


def _mkt(key, counties, **kw):
    return MarketSpec(key=key, name=key.upper(), counties=tuple(counties),
                      state=kw.get("state", "VA"), iso=kw.get("iso", "PJM"),
                      grid=kw.get("grid"), utility="U", note="")


NAT_WAGE = {BASE: 1727.0, CUR: 1815.0}   # +5.1%
NAT_EMP = {BASE: 8117805.0, CUR: 8195199.0}  # +1.0%


def test_wage_is_employment_weighted_not_a_simple_mean():
    # Two counties, wildly different sizes. A simple mean would give 1500;
    # the employment-weighted answer is dominated by the large county.
    wage = {"51107": {CUR: 2000.0}, "51153": {CUR: 1000.0}}
    emp = {"51107": {CUR: 9000.0}, "51153": {CUR: 1000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["wage"] == 1900.0          # (2000*9000 + 1000*1000) / 10000
    assert row["emp"] == 10000


def test_yoy_uses_a_like_for_like_county_set():
    # 51153 is suppressed in the base quarter. Including it on the current
    # side only would inflate the market's apparent wage growth. It must drop
    # out of BOTH sides — mirrors dcindex.py:192-195 for Louisiana.
    wage = {"51107": {BASE: 2000.0, CUR: 2200.0},
            "51153": {CUR: 500.0}}
    emp = {"51107": {BASE: 1000.0, CUR: 1000.0},
           "51153": {CUR: 1000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["counties_used"] == 1
    assert row["counties_suppressed"] == ["51153"]
    assert row["wage"] == 2200.0                  # 51153 excluded entirely
    assert row["wage_yoy_pct"] == 10.0            # 2200/2000 - 1


def test_spread_is_market_yoy_minus_national_yoy_in_pp():
    wage = {"51107": {BASE: 2000.0, CUR: 2200.0}}
    emp = {"51107": {BASE: 1000.0, CUR: 1200.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert out["national"]["wage_yoy_pct"] == 5.1
    assert out["national"]["emp_yoy_pct"] == 1.0
    assert row["wage_yoy_pct"] == 10.0
    assert row["wage_spread_pp"] == 4.9           # 10.0 - 5.1
    assert row["emp_yoy_pct"] == 20.0
    assert row["emp_spread_pp"] == 19.0           # 20.0 - 1.0


def test_fully_suppressed_market_degrades_to_unavailable_not_zero():
    # Hillsboro's only core county is disclosure-suppressed. The row must
    # render as unavailable — never as a 0 wage or a silent drop.
    out = dcmarkets.market_rows(
        {}, {}, (_mkt("hillsboro", ["41067"], state="OR", iso=None,
                      grid="WECC"),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["available"] is False
    assert row["wage"] is None and row["wage_yoy_pct"] is None
    assert row["emp"] is None and row["emp_yoy_pct"] is None
    assert row["counties_used"] == 0
    assert row["counties_total"] == 1
    assert len(out["markets"]) == 1, "unavailable markets stay in the roster"


def test_thin_base_is_flagged():
    # Richland Parish is 563 construction workers. Its +57% wage YoY is real
    # but must never read as equally reliable to Loudoun's on a 26k base.
    wage = {"22083": {BASE: 1248.0, CUR: 1964.0},
            "51107": {BASE: 2001.0, CUR: 2264.0}}
    emp = {"22083": {BASE: 274.0, CUR: 563.0},
           "51107": {BASE: 22372.0, CUR: 26151.0}}
    out = dcmarkets.market_rows(
        wage, emp,
        (_mkt("richland", ["22083"], state="LA", iso="MISO"),
         _mkt("nova", ["51107"])),
        NAT_WAGE, NAT_EMP)
    by = {r["key"]: r for r in out["markets"]}
    assert by["richland"]["thin_base"] is True
    assert by["nova"]["thin_base"] is False


def test_county_receipts_are_published_per_market():
    wage = {"51107": {BASE: 2001.0, CUR: 2264.0},
            "51153": {BASE: 1856.0, CUR: 2061.0}}
    emp = {"51107": {BASE: 22372.0, CUR: 26151.0},
           "51153": {BASE: 9000.0, CUR: 9900.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    counties = out["markets"][0]["counties"]
    assert [c["fips"] for c in counties] == ["51107", "51153"]
    assert counties[0]["wage"] == 2264.0
    assert counties[0]["emp"] == 26151
    assert counties[0]["wage_yoy_pct"] == 13.1   # 2264/2001 - 1
    assert counties[0]["emp_yoy_pct"] == 16.9


def test_as_of_and_base_date_come_from_the_national_anchor():
    out = dcmarkets.market_rows({}, {}, (), NAT_WAGE, NAT_EMP)
    assert out["as_of"] == CUR
    assert out["base_date"] == BASE


def test_no_national_data_degrades_whole_payload():
    out = dcmarkets.market_rows({}, {}, (_mkt("nova", ["51107"]),), {}, {})
    assert out["as_of"] is None
    assert out["national"]["wage"] is None
    assert out["markets"][0]["available"] is False


def test_thin_base_uses_true_current_size_not_the_yoy_truncated_set():
    # Loudoun (51107) is the dominant county but base-quarter-suppressed;
    # only the small county (51153) has both quarters, so the like-for-like
    # `emp` is a tiny 950 -- well under thin_base on its own. The market's
    # TRUE current size (both counties, 27101) must drive thin_base, or the
    # tightest market in the country reads as thin merely because its
    # biggest county was suppressed a year ago.
    wage = {"51107": {CUR: 2500.0},
            "51153": {BASE: 1800.0, CUR: 1900.0}}
    emp = {"51107": {CUR: 26151.0},
           "51153": {BASE: 900.0, CUR: 950.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["counties_used"] == 1
    assert row["counties_suppressed"] == ["51107"]
    assert row["wage"] == 1900.0            # like-for-like: 51153 alone
    assert row["emp"] == 950
    assert row["emp_cur_total"] == 27101    # true current size: both counties
    assert row["wage_cur"] == 2478.97
    assert row["thin_base"] is False        # NOT thin -- 27101, not 950


def test_fallback_regime_flags_missing_yoy_explicitly():
    # Same fixture as the employment-weighting test above (neither county
    # has ever reported a base quarter), but here we pin the OTHER fields a
    # consumer needs to tell "no YoY exists yet" apart from "YoY exists but
    # came out None" (e.g. a zero-weight base quarter).
    wage = {"51107": {CUR: 2000.0}, "51153": {CUR: 1000.0}}
    emp = {"51107": {CUR: 9000.0}, "51153": {CUR: 1000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["wage_yoy_pct"] is None
    assert row["available"] is True
    assert row["counties_used"] == 2
    assert row["yoy_basis"] is None


def test_multi_county_like_for_like_wage_is_weighted_each_quarter_by_its_own_emp():
    # Employment WEIGHTS shift between quarters -- county 51107's workforce
    # quadruples while 51153's shrinks by 4x. A base-quarter weighted mean
    # that (bug) reused the current quarter's weights would compute
    # wage_yoy_pct == 10.0 instead of the correct 65.0 -- this pins w_base
    # as genuinely weighted by ITS OWN quarter's employment, over more than
    # one county (test_yoy_uses_a_like_for_like_county_set collapses to a
    # single surviving county and never exercises this).
    wage = {"51107": {BASE: 2000.0, CUR: 2200.0},
            "51153": {BASE: 1000.0, CUR: 1100.0}}
    emp = {"51107": {BASE: 2000.0, CUR: 8000.0},
           "51153": {BASE: 8000.0, CUR: 2000.0}}
    out = dcmarkets.market_rows(
        wage, emp, (_mkt("nova", ["51107", "51153"]),), NAT_WAGE, NAT_EMP)
    row = out["markets"][0]
    assert row["wage"] == 1980.0          # (2200*8000 + 1100*2000) / 10000
    assert row["wage_yoy_pct"] == 65.0    # 1980/1200 - 1; base weighted 1200
    assert row["emp_yoy_pct"] == 0.0
