"""Tests for pipeline/publish/matrix.py — matrix.json grouped measures (P2 T8)."""
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import matrix, validate
from pipeline.registry import load_registry
from pipeline.store import vintage

SCHEMA = Path(__file__).parent.parent / "schemas" / "matrix.schema.json"


def _store_with(tmp_path, code_to_rows):
    obs = [Observation(series_code=code, obs_date=d, value=v,
                       vintage_date="2026-07-01", source="FRED", route="API")
           for code, rows in code_to_rows.items() for d, v in rows.items()]
    vintage.append(obs, tmp_path)
    return vintage.load(tmp_path)


def test_group_and_row_order_pinned(tmp_path):
    p = matrix.build(_store_with(tmp_path, {}))
    assert [g["group"] for g in p["groups"]] == \
        ["UNDERLYING", "PIPELINE", "EXPECTATIONS"]
    codes = [r["code"] for g in p["groups"] for r in g["rows"]]
    assert codes == ["MEDCPIM158SFRBCLE", "TRMMEANCPIM158SFRBCLE",
                     "CORESTICKM159SFRBATL", "PCETRIM12M159SFRBDAL",
                     "PPIACO", "IREXPETCOM", "T5YIE", "T10YIE", "MICH"]


def test_rows_reference_registered_codes():
    _, series = load_registry()
    codes = {s.code for s in series}
    for _, rows in matrix.GROUPS:
        for code, *_ in rows:
            assert code in codes


def test_verbatim_and_computed_values(tmp_path):
    conn = _store_with(tmp_path, {
        "MEDCPIM158SFRBCLE": {"2026-05-01": 2.0, "2026-06-01": 2.107},
        "PPIACO": {"2025-06-01": 250.0, "2026-06-01": 262.5},
        "IREXPETCOM": {"2026-06-01": 130.0},   # no 12-mo base -> null
        "T5YIE": {"2026-07-16": 2.354}})
    rows = {r["code"]: r for g in matrix.build(conn)["groups"] for r in g["rows"]}
    # verbatim latest obs, 2dp
    assert rows["MEDCPIM158SFRBCLE"]["value"] == 2.11
    assert rows["MEDCPIM158SFRBCLE"]["as_of"] == "2026-06-01"
    assert rows["MEDCPIM158SFRBCLE"]["unit"] == "% ann. rate (MoM)"
    assert rows["MEDCPIM158SFRBCLE"]["cadence"] == "monthly"
    # PIPELINE row publishes a COMPUTED like-month YoY: (262.5/250 - 1)*100 = 5.0
    assert rows["PPIACO"]["value"] == 5.0
    assert rows["PPIACO"]["as_of"] == "2026-06-01"
    assert rows["PPIACO"]["unit"] == "% YoY (computed)"
    # computed row with no base -> null value, as_of still present
    assert rows["IREXPETCOM"]["value"] is None
    assert rows["IREXPETCOM"]["as_of"] == "2026-06-01"
    # verbatim daily expectation series
    assert rows["T5YIE"]["value"] == 2.35
    assert rows["T5YIE"]["as_of"] == "2026-07-16"
    assert rows["T5YIE"]["cadence"] == "daily"


def test_missing_series_degrade_to_null_but_keep_metadata(tmp_path):
    p = matrix.build(_store_with(tmp_path, {}))
    for g in p["groups"]:
        for r in g["rows"]:
            assert r["value"] is None
            assert r["as_of"] is None
            assert r["label"] and r["unit"] and r["cadence"]


def test_written_file_validates(tmp_path):
    conn = _store_with(tmp_path, {"MICH": {"2026-05-01": 4.8}})
    payload = matrix.build(conn)
    path = matrix.write(payload, tmp_path / "out", "2026-07-17T12:00:00Z")
    assert path.name == "matrix.json"
    validate.validate_file(path, SCHEMA)
    text = path.read_text()
    assert text.startswith('{\n  "published_at"')
    assert text.endswith("\n")
