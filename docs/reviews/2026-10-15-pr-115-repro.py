"""Offline PR #115 review: registry migration controls and CPI base-backfill regression.

Run from the repository root with .venv/bin/python <this file>.
Only temporary stores are written. All HTTP responses are injected fixtures.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch
import warnings

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pipeline import basket, derived, registry
from pipeline.collect import collect_all
from pipeline.connectors.util import PartialFetchWarning
from pipeline.models import Observation
from pipeline.store import vintage
from scripts import backfill_base_dec2016

HEAD = "c9724a992ce7df63714da95ba49b378da813958b"
BASE = "340da5000c438be707185de88f91b59c77a8e891"


class Response:
    def __init__(self, payload, error=None):
        self.payload, self.error = payload, error

    def raise_for_status(self):
        if self.error:
            raise RuntimeError(self.error)

    def json(self):
        return self.payload


def main():
    base_raw = subprocess.check_output(
        ["git", "show", f"{BASE}:config/series.json"], cwd=ROOT, text=True)
    sources, current = registry.load_registry()
    bls_series = [s for s in current if s.source == "BLS"]
    by_id = {s.source_id: (s.code, 100.0 + i) for i, s in enumerate(bls_series)}
    report = {"reviewed_head": HEAD, "merge_base": BASE}

    with tempfile.TemporaryDirectory(prefix="pr115-review-") as tmp:
        tmp = Path(tmp)
        base_path = tmp / "base-registry.json"
        base_path.write_text(base_raw)
        old_sources, old_series = registry.load_registry(base_path)
        old_by_code = {s.code: s for s in old_series}
        moved = [s for s in bls_series if old_by_code[s.code].source == "FRED"]
        assert len(moved) == 35
        calls = []

        def post(url, json=None, timeout=None):
            calls.append(json["seriesid"])
            rows = []
            for sid in json["seriesid"]:
                code, value = by_id[sid]
                data = [{"year": "2026", "period": "M08", "value": str(value)},
                        {"year": "2025", "period": "M10", "value": "-"},
                        {"year": "2025", "period": "M13", "value": "100"}]
                if code == "PPIACO":
                    data[0]["value"] = str(value + 1)
                    data.append({"year": "2026", "period": "M09", "value": str(value + 2)})
                rows.append({"seriesID": sid, "data": data})
            return Response({"status": "REQUEST_SUCCEEDED", "Results": {"series": rows}})

        store = tmp / "migration"
        seed = [Observation(s.code, "2026-08-01", by_id[s.source_id][1], "2026-10-14",
                            old_by_code[s.code].source, "API") for s in bls_series]
        vintage.append(seed, store)
        with patch("pipeline.connectors.bls.today_et", return_value="2026-10-15"):
            result = collect_all({"BLS": sources["BLS"]}, current, {}, store, http_post=post)[0]
        assert result.ok and result.new_rows == 2
        assert [len(c) for c in calls] == [25, 25, 13]
        conn = vintage.load(store)
        stored = {r[0] for r in conn.execute("SELECT DISTINCT series_code FROM observations")}
        assert stored == {s.code for s in bls_series}
        assert conn.execute("SELECT COUNT(*) FROM observations WHERE obs_date='2025-10-01'").fetchone()[0] == 0
        report["migration_control"] = {"moved_series": len(moved), "batch_sizes": [len(c) for c in calls],
                                       "fetched": result.fetched, "new_rows": result.new_rows,
                                       "raw_id_leaks": [], "missing_and_annual_rows_skipped": True}
        conn.close()

        def refused(url, json=None, timeout=None):
            return Response({"status": "REQUEST_NOT_PROCESSED", "Results": {},
                             "message": ["daily threshold for total number of requests reached"]})

        failed = collect_all({"BLS": sources["BLS"]}, current, {}, store, http_post=refused)[0]
        assert not failed.ok and failed.new_rows == 0 and "REQUEST_NOT_PROCESSED" in failed.error
        report["refusal_control"] = {"ok": failed.ok, "new_rows": failed.new_rows, "error": failed.error}

        # The fake FRED endpoint recognizes the pre-migration FRED IDs. It
        # rejects BLS-only IDs, as FRED does; values come from the real store.
        comps = basket.load_basket()[1]
        codes = ["CPIAUCNS"] + [c.official_series for c in comps if c.official_series in old_by_code]
        real = vintage.load(ROOT / "store")
        histories = {c: dict(vintage.latest(real, c)) for c in codes}
        real.close()
        fred_ids = {old_by_code[c].source_id: c for c in codes}
        backfills = {}
        for label, reg in [("before", (old_sources, old_series)), ("after", (sources, current))]:
            requested, rejected = [], []

            def get(url, params=None, timeout=None):
                sid = params["series_id"]
                requested.append(sid)
                if sid not in fred_ids:
                    rejected.append(sid)
                    return Response({}, f"400: series {sid} does not exist")
                return Response({"observations": [{"date": "2016-12-01",
                    "value": str(histories[fred_ids[sid]]["2016-12-01"])}]})

            output = io.StringIO()
            with patch.dict(os.environ, {"FRED_API_KEY": "offline-fixture-key"}), \
                    patch.object(registry, "load_registry", return_value=reg), \
                    contextlib.redirect_stdout(output), warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", PartialFetchWarning)
                rc = backfill_base_dec2016.main(["--store", str(tmp / label)], http_get=get)
            conn = vintage.load(tmp / label)
            present = {r[0] for r in conn.execute("SELECT DISTINCT series_code FROM observations")}
            conn.close()
            backfills[label] = {"exit_code": rc, "requested": len(requested),
                               "stored": len(present), "rejected_ids": rejected,
                               "missing_codes": sorted(set(codes) - present),
                               "stdout": output.getvalue().strip(),
                               "warnings": [str(w.message) for w in caught]}
        assert backfills["before"]["stored"] == 14
        assert backfills["after"]["stored"] == 9 and backfills["after"]["exit_code"] == 0
        report["cpi_base_backfill"] = backfills

        components = {c.code: c.official_series for c in comps if c.code != "other"}
        baseline = derived.residual_index(histories, components, derived.load_ri())
        incomplete = {code: {d: v for d, v in rows.items()
                            if d != "2016-12-01" or code not in backfills["after"]["missing_codes"]}
                      for code, rows in histories.items()}
        regressed = derived.residual_index(incomplete, components, derived.load_ri())
        report["residual_control"] = {
            "before_start": min(baseline), "after_start": min(regressed),
            "before_jan2017": baseline["2017-01-01"], "after_jan2017": regressed["2017-01-01"]}
        assert min(baseline) == "2016-12-01" and min(regressed) == "2017-01-01"
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
