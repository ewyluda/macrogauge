"""Validate committed published data against schemas — runs in CI on every push."""
import json
from pathlib import Path

import pytest

from pipeline.publish import validate

ROOT = Path(__file__).parent.parent
DATA = ROOT / "site" / "public" / "data"
SCHEMAS = ROOT / "schemas"

CONTRACT = [("pulse.json", "pulse.schema.json"),
            ("gauge_daily.json", "gauge_daily.schema.json"),
            ("compare.json", "compare.schema.json"),
            ("gaptable.json", "gaptable.schema.json"),
            ("replay.json", "replay.schema.json"),
            ("qa.json", "qa.schema.json"),
            ("sources_status.json", "sources_status.schema.json"),
            ("official.json", "official.schema.json"),
            ("methodology.json", "methodology.schema.json"),
            ("quilt_months_24.json", "quilt.schema.json"),
            ("quilt_months_48.json", "quilt.schema.json"),
            ("quilt_months_all.json", "quilt.schema.json"),
            ("grocery_basket.json", "grocery_basket.schema.json"),
            ("real_wages.json", "real_wages.schema.json"),
            ("outlook.json", "outlook.schema.json"),
            ("datacenter.json", "datacenter.schema.json")]


@pytest.mark.parametrize("data_file,schema_file", CONTRACT)
def test_published_file_matches_schema(data_file, schema_file):
    path = DATA / data_file
    validate.validate_file(path, SCHEMAS / schema_file)


def test_pulse_gap_consistent():
    path = DATA / "pulse.json"
    pulse = json.loads(path.read_text())
    expected = pulse["gauge"]["yoy_pct"] - pulse["official"]["yoy_pct"]
    assert abs(pulse["gap_pp"] - expected) <= 0.011  # rounding tolerance


QUILT_FILES = ["quilt_months_24.json", "quilt_months_48.json", "quilt_months_all.json"]


@pytest.mark.parametrize("data_file", QUILT_FILES)
def test_quilt_arrays_match_months_length(data_file):
    """Every quilt component's ours_yoy_pct/official_yoy_pct array must be exactly
    as long as the file's own months array — a length mismatch would silently
    misalign the heatmap x-axis against its data."""
    quilt = json.loads((DATA / data_file).read_text())
    n = len(quilt["months"])
    for c in quilt["components"]:
        assert len(c["ours_yoy_pct"]) == n, (
            f"{data_file}: {c['code']} ours_yoy_pct len {len(c['ours_yoy_pct'])} != months {n}")
        assert len(c["official_yoy_pct"]) == n, (
            f"{data_file}: {c['code']} official_yoy_pct len {len(c['official_yoy_pct'])} != months {n}")


def test_grocery_basket_items():
    """At least 20 items published, and every published item has a real price —
    the grocery card would rather skip an item (see 'skipped') than show a null."""
    grocery = json.loads((DATA / "grocery_basket.json").read_text())
    assert len(grocery["items"]) >= 20
    assert all(item["price"] is not None for item in grocery["items"])


def test_grocery_series_aligned():
    """Sparkline arrays must align and the card price must equal the series
    value at the item's own month — a mismatch would draw a sparkline that
    contradicts the printed price."""
    grocery = json.loads((DATA / "grocery_basket.json").read_text())
    for it in grocery["items"]:
        s = it["series"]
        assert len(s["months"]) == len(s["prices"]) > 0, it["code"]
        assert s["months"] == sorted(s["months"]), it["code"]
        assert it["price"] == s["prices"][s["months"].index(it["month"])], it["code"]
