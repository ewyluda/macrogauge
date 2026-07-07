from pathlib import Path

from pipeline.collect import SourceResult
from pipeline.models import Observation
from pipeline.publish import sources_status, validate
from pipeline.registry import Series, Source
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent / "schemas"


def test_build_and_write(tmp_path):
    vintage.append([Observation("a1", "2026-07-01", 1.0, "2026-07-07", "A", "API")],
                   tmp_path)
    conn = vintage.load(tmp_path)
    sources = {"A": Source("A", "API", "daily", None, False),
               "B": Source("B", "CSV", "weekly", None, False)}
    series = [Series("a1", "A", "a1", "a one", 7),
              Series("b1", "B", "b1", "b one", 21)]
    results = [
        SourceResult("A", True, 1, 1, None, "2026-07-07T12:41:00Z"),
        SourceResult("B", False, 0, 0, "HTTPError: 503", "2026-07-07T12:41:02Z"),
    ]
    status = sources_status.build(results, sources, series, conn)
    by = {s["name"]: s for s in status["sources"]}
    assert by["A"]["ok"] is True and by["A"]["latest_obs"] == "2026-07-01"
    assert by["B"]["ok"] is False and by["B"]["error"] == "HTTPError: 503"
    assert by["B"]["latest_obs"] is None
    assert by["A"]["series_count"] == 1

    path = sources_status.write(status, tmp_path / "out")
    validate.validate_file(path, SCHEMAS / "sources_status.schema.json")
