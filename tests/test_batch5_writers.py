"""Batch 5 writers (2026-09-03): revisions (first print vs latest) and the
append-only publish ledger."""
import json
from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import ledger, revisions, validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def _obs(code, d, v, vd):
    return Observation(series_code=code, obs_date=d, value=v, vintage_date=vd,
                       source="FRED", route="API")


def test_revisions_first_vs_latest_and_yoy_revision(tmp_path):
    obs = [
        # base month a year earlier, single vintage
        _obs("CPIAUCNS", "2025-06-01", 300.0, "2025-07-15"),
        _obs("CPIAUCNS", "2025-05-01", 298.0, "2025-06-15"),
        # 2026-06: first print 309.0, revised to 309.6
        _obs("CPIAUCNS", "2026-06-01", 309.0, "2026-07-15"),
        _obs("CPIAUCNS", "2026-06-01", 309.6, "2026-08-15"),
        # payrolls: first 150,000 then revised down 20k; prior month single vintage
        _obs("PAYEMS", "2026-05-01", 159_000.0, "2026-06-05"),
        _obs("PAYEMS", "2026-06-01", 159_150.0, "2026-07-03"),
        _obs("PAYEMS", "2026-06-01", 159_130.0, "2026-08-07"),
    ]
    vintage.append(obs, tmp_path)
    conn = vintage.load(tmp_path)
    p = revisions.build(conn)
    cpi = {r["reference_period"]: r for r in p["targets"]["cpi"]["rows"]}
    r = cpi["2026-06"]
    assert r["first_value"] == 309.0 and r["latest_value"] == 309.6
    assert r["first_release_date"] == "2026-07-15" and r["latest_vintage"] == "2026-08-15"
    assert r["n_vintages"] == 2
    assert r["revision_pct"] == round((309.6 / 309.0 - 1) * 100, 3)
    assert r["yoy_first_pct"] == 3.0 and r["yoy_latest_pct"] == 3.2 and r["yoy_revision_pp"] == 0.2
    assert cpi["2025-06"]["yoy_first_pct"] is None  # no base a year earlier
    nfp = {r["reference_period"]: r for r in p["targets"]["nfp"]["rows"]}
    n = nfp["2026-06"]
    assert n["revision_k"] == -20.0
    assert n["change_first_k"] == 150.0 and n["change_latest_k"] == 130.0 and n["change_revision_k"] == -20.0
    assert p["targets"]["pce"]["rows"] == [] and p["targets"]["pce"]["summary"]["n"] == 0
    s = p["targets"]["cpi"]["summary"]
    assert s["n_revised"] == 1 and s["mean_abs_yoy_revision_pp"] == 0.2
    path = revisions.write(p, tmp_path / "out", "2026-09-03T12:00:00Z")
    validate.validate_file(path, SCHEMAS / "revisions.schema.json")


def _write(out, name, payload):
    out.mkdir(parents=True, exist_ok=True)
    (out / name).write_text(json.dumps(payload))


def test_ledger_appends_once_per_publish_and_publishes_all_rows(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    assert ledger.build(store, out)["rows"] == []  # nothing published yet -> no row, no crash
    _write(out, "pulse.json", {"published_at": "2026-09-03T16:00:00Z",
                               "gauge": {"yoy_pct": 3.0, "as_of": "2026-09-03", "coverage_pct": 42.6},
                               "tracker": {"yoy_pct": 3.6, "as_of": "2026-09-03"},
                               "official": {"yoy_pct": 3.4, "month": "2026-07-01"}})
    _write(out, "gaptable.json", {"variants": {"col": {"yoy_pct": 3.5, "as_of": "2026-09-03"}}})
    _write(out, "datacenter.json", {"indexes": {"build": {"headline_yoy_pct": 9.3, "as_of": "2026-09-03"}}})
    p1 = ledger.build(store, out)
    assert p1["appended_today"] is True and len(p1["rows"]) == 1
    row = p1["rows"][0]
    assert row["date"] == "2026-09-03" and row["gauge_yoy_pct"] == 3.0 and row["col_yoy_pct"] == 3.5
    assert row["supercore_yoy_pct"] is None and row["dc_build_yoy_pct"] == 9.3 and row["dc_ops_yoy_pct"] is None
    assert row["coverage_pct"] == 42.6 and row["official_month"] == "2026-07-01"
    # same publish again (re-run): no duplicate
    p2 = ledger.build(store, out)
    assert p2["appended_today"] is False and len(p2["rows"]) == 1
    # a later publish appends and rows come back in order
    _write(out, "pulse.json", {"published_at": "2026-09-04T16:00:00Z",
                               "gauge": {"yoy_pct": 3.1, "as_of": "2026-09-04", "coverage_pct": 42.6},
                               "tracker": {"yoy_pct": 3.6, "as_of": "2026-09-04"},
                               "official": {"yoy_pct": 3.4, "month": "2026-07-01"}})
    p3 = ledger.build(store, out)
    assert [r["date"] for r in p3["rows"]] == ["2026-09-03", "2026-09-04"]
    assert p3["first_publish"] == "2026-09-03T16:00:00Z"
    path = ledger.write(p3, out, "2026-09-04T16:00:00Z")
    validate.validate_file(path, SCHEMAS / "ledger.schema.json")
    # the store file is append-only JSONL, one row per line
    lines = (store / "ledger" / "pulse.jsonl").read_text().splitlines()
    assert len(lines) == 2


def test_ledger_read_rows_union_merges_duplicates(tmp_path):
    p = tmp_path / "ledger" / "pulse.jsonl"
    p.parent.mkdir(parents=True)
    p.write_text('{"published_at": "A", "date": "2026-09-01", "gauge_yoy_pct": 1}\n'
                 '{"published_at": "A", "date": "2026-09-01", "gauge_yoy_pct": 2}\n')
    rows = ledger.read_rows(tmp_path)
    assert rows == [{"published_at": "A", "date": "2026-09-01", "gauge_yoy_pct": 2}]  # last-seen wins
