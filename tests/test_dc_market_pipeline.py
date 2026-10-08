import copy
import json
import re
from pathlib import Path

import pytest

from pipeline import dc_market_pipeline as pipe
from pipeline import dc_markets

ROOT = Path(__file__).parent.parent
EVIDENCE = ROOT / "docs/research/evidence/2026-10-cw-americas-h1-2026-searchtext.json"
REAL = json.loads(pipe.DEFAULT_PATH.read_text())
ROSTER = {m.key for m in dc_markets.load()}


def _write(tmp_path, raw) -> Path:
    p = tmp_path / "pipe.json"
    p.write_text(json.dumps(raw))
    return p


def _mutate(tmp_path, fn):
    raw = copy.deepcopy(REAL)
    fn(raw)
    return _write(tmp_path, raw)


def _row(raw, key):
    return next(m for m in raw["markets"] if m["key"] == key)


# --- the real config (the CI gate for a bad curation edit) -----------------

def test_real_config_covers_the_roster_once():
    cfg = pipe.load(market_keys=ROSTER)
    assert set(cfg.markets) == ROSTER
    nulls = {k for k, f in cfg.markets.items() if f.null_note}
    assert nulls == {"newcarlisle", "mtpleasant", "richland", "memphis", "councilbluffs"}
    assert cfg.source.doc_date == "2026-09-14" and cfg.source.period == "2026-06-30"


def test_every_quote_is_verbatim_on_its_flipbook_page():
    # The receipt check: each quote (whitespace-normalized) sits on the page
    # the config names in C&W's published text layer, committed as evidence.
    pages = {p["@ID"]: re.sub(r"\s+", " ", p.get("#text", ""))
             for p in json.loads(EVIDENCE.read_text())["pages"]["page"]}
    for key, f in pipe.load(market_keys=ROSTER).markets.items():
        if f.null_note:
            continue
        assert re.sub(r"\s+", " ", f.quote) in pages[f.page], f"{key}: quote not on page {f.page}"


def test_virginia_is_named_statewide_never_northern_virginia():
    # 7,355 MW is statewide Virginia (Culpeper, Richmond, Danville too); the
    # label the page shows beside it must say so.
    nova = pipe.load(market_keys=ROSTER).markets["nova"]
    assert (nova.mw_uc, nova.fit) == (7355, "wider")
    assert nova.label == "Virginia (statewide)"


def test_close_fit_is_only_claimed_where_the_region_is_the_metro():
    cfg = pipe.load(market_keys=ROSTER).markets
    assert {k for k, f in cfg.items() if f.fit == "close"} == {
        "dfw", "phoenix", "columbus", "slc", "cheyenne", "reno"}
    assert cfg["abilene"].fit == "proxy"


# --- rejections --------------------------------------------------------------

def test_a_market_missing_from_the_roster_is_rejected(tmp_path):
    p = _mutate(tmp_path, lambda r: r["markets"].pop())
    with pytest.raises(ValueError, match="missing \\['hillsboro'\\]"):
        pipe.load(p, market_keys=ROSTER)


def test_an_unknown_market_is_rejected(tmp_path):
    p = _mutate(tmp_path, lambda r: r["markets"].append({"key": "nowhere", "null_note": "x"}))
    with pytest.raises(ValueError, match="unknown \\['nowhere'\\]"):
        pipe.load(p, market_keys=ROSTER)


def test_a_figure_that_is_not_in_its_quote_is_rejected(tmp_path):
    p = _mutate(tmp_path, lambda r: _row(r, "nova").update(mw_uc=7335))
    with pytest.raises(ValueError, match="mw_uc 7335 does not appear in its quote"):
        pipe.load(p, market_keys=ROSTER)


def test_text_layer_digit_splits_still_match():
    # "5,52 3MW" is 5,523 MW and "39,340M W" is 39,340 -- but a split never
    # lets a figure match across two different numbers
    assert pipe._in_quote(5523, "5,52 3MW Planned")
    assert pipe._in_quote(39340, "39,340M W Planned")
    assert not pipe._in_quote(552, "5,52 3MW Planned")


def test_a_row_with_both_figures_and_a_null_note_is_rejected(tmp_path):
    p = _mutate(tmp_path, lambda r: _row(r, "nova").update(null_note="x"))
    with pytest.raises(ValueError, match="exactly one of figures or null_note"):
        pipe.load(p, market_keys=ROSTER)


def test_a_null_row_cannot_carry_a_stray_figure(tmp_path):
    p = _mutate(tmp_path, lambda r: _row(r, "memphis").update(mw_uc=0))
    with pytest.raises(ValueError, match="exactly one of figures or null_note"):
        pipe.load(p, market_keys=ROSTER)


@pytest.mark.parametrize("field,value,match", [
    ("fit", "metro", "fit must be one of"),
    ("mw_uc", 7355.0, "non-negative integer"),
    ("page", 0, "page must be a positive integer"),
    ("label", "", "label: must be a non-empty string"),
])
def test_bad_figure_fields_are_rejected(tmp_path, field, value, match):
    p = _mutate(tmp_path, lambda r: _row(r, "nova").update({field: value}))
    with pytest.raises(ValueError, match=match):
        pipe.load(p, market_keys=ROSTER)


@pytest.mark.parametrize("field,value,match", [
    ("doc_date", "20260914", "YYYY-MM-DD"),
    ("period", "2026-02-30", "not an ISO date"),
    ("url", "http://example.com", "must be https"),
])
def test_bad_source_fields_are_rejected(tmp_path, field, value, match):
    p = _mutate(tmp_path, lambda r: r["source"].update({field: value}))
    with pytest.raises(ValueError, match=match):
        pipe.load(p, market_keys=ROSTER)


def test_a_second_basis_is_rejected(tmp_path):
    # one basis for the whole column: a colocation-only figure must not land
    p = _mutate(tmp_path, lambda r: r.update(basis="colo-only"))
    with pytest.raises(ValueError, match="basis must be one of"):
        pipe.load(p, market_keys=ROSTER)


def test_stale_ages_from_the_document_date():
    assert not pipe.is_stale("2026-09-14", "2027-11-18")   # day 430
    assert pipe.is_stale("2026-09-14", "2027-11-19")       # day 431
