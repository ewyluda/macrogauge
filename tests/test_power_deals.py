import copy
import json
import re
from pathlib import Path

import pytest

from pipeline import power_deals

ROOT = Path(__file__).parent.parent
REAL = json.loads(power_deals.DEFAULT_PATH.read_text())
TICKERS = {c["t"] for c in json.loads((ROOT / "config/capacity.json").read_text())["companies"]}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s)


def _load(tmp_path, fn):
    raw = copy.deepcopy(REAL)
    fn(raw)
    p = tmp_path / "deals.json"
    p.write_text(json.dumps(raw))
    return power_deals.load(p, tickers=TICKERS)


# --- the real config (the CI gate for a bad curation edit) -----------------

def test_real_config_loads_against_the_capacity_roster():
    cfg = power_deals.load(tickers=TICKERS)
    assert len(cfg.deals) == 26
    signed = sum(d.mw_total for d in cfg.deals if d.status == "signed")
    assert signed == 20087
    # most signed MW is not a literal PPA: the page must say which is which
    assert sum(d.mw_total for d in cfg.deals if d.status == "signed" and d.kind == "ppa") == 9550


def test_every_quote_is_verbatim_in_its_committed_evidence():
    for d in power_deals.load(tickers=TICKERS).deals:
        text = _norm((ROOT / d.evidence).read_text())
        assert _norm(d.quote) in text, f"{d.t}/{d.counterparty}: quote not in {d.evidence}"


def test_pending_regulator_approval_is_never_counted_as_signed():
    hyperion = [d for d in power_deals.load(tickers=TICKERS).deals
                if d.counterparty == "Entergy Louisiana" and d.mw == 5200]
    assert [d.status for d in hyperion] == ["pending"]


def test_a_per_site_figure_multiplies_by_its_sites():
    elementl = next(d for d in power_deals.load(tickers=TICKERS).deals if d.counterparty == "Elementl Power")
    assert (elementl.mw, elementl.sites, elementl.mw_total) == (600, 3, 1800)


@pytest.mark.parametrize("mw,quote,ok", [
    (1121, "the 1,121-megawatt Clinton plant", True),
    (3000, "up to 3 gigawatts of new generation", True),
    (2300, "will deploy 2,300 megawatts (MW)", True),
    (3000, "up to 30 gigawatts", False),
    (835, "approximately 8350 megawatts", False),
])
def test_mw_in_quote(mw, quote, ok):
    assert power_deals.mw_in_quote(mw, quote) is ok


# --- rejections --------------------------------------------------------------

def test_a_figure_missing_from_its_quote_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="does not appear in its quote"):
        _load(tmp_path, lambda r: r["deals"][0].update(mw=900))


def test_an_unknown_ticker_status_or_kind_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="not a capacity company"):
        _load(tmp_path, lambda r: r["deals"][0].update(t="NOPE"))
    with pytest.raises(ValueError, match="status"):
        _load(tmp_path, lambda r: r["deals"][0].update(status="rumored"))
    with pytest.raises(ValueError, match="kind"):
        _load(tmp_path, lambda r: r["deals"][0].update(kind="swap"))


def test_a_deal_under_100_mw_or_with_a_bad_date_is_rejected(tmp_path):
    with pytest.raises(ValueError, match=">= 100"):
        _load(tmp_path, lambda r: r["deals"][0].update(mw=50))
    with pytest.raises(ValueError, match="announced"):
        _load(tmp_path, lambda r: r["deals"][0].update(announced="Sept 2024"))


def test_a_duplicate_row_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        _load(tmp_path, lambda r: r["deals"].append(copy.deepcopy(r["deals"][0])))
