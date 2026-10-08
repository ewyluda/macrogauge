"""config/issuer_bonds.json loader and the /rates issuers block."""
import json
from pathlib import Path

import pytest

from pipeline import issuer_bonds
from pipeline.publish import rates

URL = "https://www.sec.gov/Archives/edgar/data/1/x.htm"


def _deal(**over):
    d = {"issuer": "MSFT", "name": "Microsoft", "cohort": "hyperscaler", "deal_date": "2026-02-03",
         "instrument": "senior notes", "tranche": "4.500% Notes due 2036", "coupon": 4.5,
         "maturity": "2036-02-06", "amount_usd_b": 3.0, "yield_pct": 4.55, "spread_bp": 75,
         "benchmark": "UST 4.250% due November 15, 2035",
         "quote": "4.500% Notes due 2036 ... Yield to Maturity: 4.550% ... Spread to Benchmark Treasury: +75 bps",
         "src": ["Microsoft FWP", URL]}
    d.update(over)
    return d


def _write(tmp_path, deals, **top):
    p = tmp_path / "issuer_bonds.json"
    p.write_text(json.dumps({"schema_version": 1, "as_of_curated": "2026-10-08", "note": "n", "deals": deals, **top}))
    return p


def test_loads_and_flags_convertibles_not_comparable(tmp_path):
    cfg = issuer_bonds.load(_write(tmp_path, [_deal(), _deal(
        issuer="NBIS", name="Nebius", cohort="neocloud", instrument="convertible notes", tranche="1.00% notes due 2030",
        coupon=1.0, maturity="2030-09-15", yield_pct=None, spread_bp=None, benchmark=None,
        quote="1.00% Convertible Senior Notes due 2030")]))
    assert [d.comparable for d in cfg.deals] == [True, False]


@pytest.mark.parametrize("bad,match", [
    ({"cohort": "bank"}, "cohort"),
    ({"instrument": "term loan"}, "instrument"),
    ({"maturity": "2025-01-01"}, "maturity must follow"),
    ({"deal_date": "20260203"}, "YYYY-MM-DD"),
    ({"coupon": 5.25}, "does not appear in its quote"),
    ({"src": ["x", "http://insecure"]}, "src"),
    ({"quote": ""}, "missing"),
])
def test_rejects_a_bad_deal(tmp_path, bad, match):
    with pytest.raises(ValueError, match=match):
        issuer_bonds.load(_write(tmp_path, [_deal(**bad)]))


def test_coupon_matches_the_filing_s_print():
    assert issuer_bonds._coupon_in_quote(9.0, "9.000% Senior Notes due 2031")
    assert issuer_bonds._coupon_in_quote(4.5, "the 4.50 % notes")
    assert not issuer_bonds._coupon_in_quote(4.5, "14.500% notes")   # never a tail of a longer number


DGS = {"DGS5": {"2026-02-02": 4.0}, "DGS10": {"2026-02-02": 4.5}, "DGS30": {"2026-02-02": 5.0}}


def test_treasury_curve_interpolates_on_the_pricing_date():
    assert rates.treasury_at(DGS, "2026-02-03", 7.5) == pytest.approx(4.25)    # Monday reads Friday... and between 5Y and 10Y
    assert rates.treasury_at(DGS, "2026-02-03", 40) == 5.0                      # flat past the long end
    assert rates.treasury_at({"DGS10": {"2026-02-02": 4.5}}, "2026-02-03", 10) is None


def test_issuers_block_states_or_computes_the_spread_and_says_which(tmp_path):
    cfg = issuer_bonds.load(_write(tmp_path, [
        _deal(),
        _deal(issuer="CRWV", name="CoreWeave", cohort="neocloud", tranche="9.000% Senior Notes due 2031", coupon=9.0,
              deal_date="2026-02-03", maturity="2031-02-03", yield_pct=None, spread_bp=None, benchmark=None,
              issued_at_par=True, quote="$2.0 billion of 9.000% Senior Notes due 2031 at par"),
        _deal(issuer="NBIS", name="Nebius", cohort="neocloud", instrument="convertible notes", coupon=1.0,
              tranche="1.00% notes due 2030", maturity="2030-09-15", yield_pct=None, spread_bp=None, benchmark=None,
              issued_at_par=True, quote="1.00% Convertible Senior Notes due 2030"),
    ]))
    block = rates._issuers(DGS, cfg)
    msft, crwv, nbis = block["deals"]
    assert (msft["yield_pct"], msft["yield_basis"], msft["spread_bp"], msft["spread_basis"]) == (4.55, "stated", 75, "stated")
    # par coupon 9.0 - the curve at 5.0y on the pricing date (DGS5 = 4.0)
    assert (crwv["yield_pct"], crwv["yield_basis"], crwv["spread_bp"], crwv["spread_basis"]) == (9.0, "par coupon", 500, "computed")
    # a convertible's coupon prices an equity option: no yield, no spread
    assert (nbis["comparable"], nbis["yield_pct"], nbis["spread_bp"]) == (False, None, None)


def test_a_broken_config_nulls_the_block_never_the_panel(monkeypatch):
    def broken():
        raise ValueError("issuer_bonds: schema_version must be 1")
    monkeypatch.setattr(issuer_bonds, "load", broken)
    assert rates._issuers_or_none(DGS) is None


def test_real_config_loads_and_publishes_a_schema_valid_block(tmp_path):
    cfg = issuer_bonds.load()
    assert {d.cohort for d in cfg.deals} <= set(issuer_bonds.COHORTS)
    # every hyperscaler row is a stated term-sheet figure, never computed
    for d in cfg.deals:
        if d.cohort == "hyperscaler":
            assert d.yield_pct is not None and d.spread_bp is not None and d.benchmark, d.issuer
    block = rates._issuers(DGS, cfg)
    assert len(block["deals"]) == len(cfg.deals)
    path = rates.write({"curve": [], "spreads": {}, "breakevens": {}, "credit": {}, "dollar": None, "gdpnow": None,
                        "auto_loan_60m": None, "liquidity": None, "mortgage": None, "history": {}, "issuers": block},
                       tmp_path, "2026-10-08T12:00:00Z")
    import json as _json
    schema = _json.loads((Path(__file__).parent.parent / "schemas" / "rates.schema.json").read_text())
    import jsonschema
    jsonschema.validate(_json.loads(path.read_text())["issuers"], schema["properties"]["issuers"])
