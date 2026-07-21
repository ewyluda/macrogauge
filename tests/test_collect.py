import pytest

from pipeline import collect
from pipeline.models import Observation
from pipeline.registry import Series, Source
from pipeline.store import vintage


def src(name, secret=None, optional=False):
    return Source(name=name, route="API", cadence="daily", secret=secret,
                  secret_optional=optional)


def ser(code, source, source_id=None):
    return Series(code=code, source=source, source_id=source_id or code,
                  name=code, max_staleness_days=7)


def ok_fetcher(subset, key, http):
    return [Observation(series_code=s.source_id, obs_date="2026-07-01", value=1.0,
                        vintage_date="2026-07-07", source=s.source, route="API")
            for s in subset]


def boom_fetcher(subset, key, http):
    raise RuntimeError("connector exploded")


def test_isolation_one_source_fails_others_append(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher, "B": boom_fetcher})
    sources = {"A": src("A"), "B": src("B")}
    series = [ser("a1", "A"), ser("b1", "B")]
    results = collect.collect_all(sources, series, {}, tmp_path)
    by = {r.source: r for r in results}
    assert by["A"].ok and by["A"].new_rows == 1
    assert not by["B"].ok and "connector exploded" in by["B"].error
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "a1") == [("2026-07-01", 1.0)]


def test_missing_required_secret_is_error_not_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A", secret="A_KEY")}
    results = collect.collect_all(sources, [ser("a1", "A")], {"A_KEY": ""}, tmp_path)
    assert not results[0].ok and "missing secret A_KEY" in results[0].error


def test_optional_secret_proceeds_when_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A", secret="A_KEY", optional=True)}
    results = collect.collect_all(sources, [ser("a1", "A")], {}, tmp_path)
    assert results[0].ok and results[0].new_rows == 1


def test_provider_ids_remapped_to_internal_codes(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "FETCHERS", {"A": ok_fetcher})
    sources = {"A": src("A")}
    results = collect.collect_all(sources, [ser("nice_code", "A", "UGLY.ID")],
                                  {}, tmp_path)
    assert results[0].ok
    conn = vintage.load(tmp_path)
    assert vintage.latest(conn, "nice_code") == [("2026-07-01", 1.0)]


def test_error_messages_redact_api_keys(tmp_path, monkeypatch):
    def leaky_fetcher(subset, key, http):
        raise RuntimeError(
            "500 for url: https://api.eia.gov/v2/seriesid/X?api_key=SECRET123&x=1 "
            "and https://api.stlouisfed.org/obs?apikey=TOPSECRET&series_id=Y "
            "and registrationkey=ALSOSECRET end")
    monkeypatch.setattr(collect, "FETCHERS", {"A": leaky_fetcher})
    results = collect.collect_all({"A": src("A")}, [ser("a1", "A")], {}, tmp_path)
    err = results[0].error
    assert "SECRET123" not in err and "TOPSECRET" not in err and "ALSOSECRET" not in err
    assert "api_key=REDACTED" in err and "apikey=REDACTED" in err and "registrationkey=REDACTED" in err
    assert "RuntimeError" in err


def test_error_messages_redact_secret_values(tmp_path, monkeypatch):
    def leaky_fetcher(subset, key, http):
        raise RuntimeError('BLS said: {"registrationkey": "VALSECRET99"} rejected')
    monkeypatch.setattr(collect, "FETCHERS", {"A": leaky_fetcher})
    sources = {"A": src("A", secret="A_KEY")}
    results = collect.collect_all(sources, [ser("a1", "A")],
                                  {"A_KEY": "VALSECRET99"}, tmp_path)
    assert "VALSECRET99" not in results[0].error
    assert "REDACTED" in results[0].error


def test_partial_connector_warning_surfaces_in_result(tmp_path, monkeypatch):
    # A connector that tolerated per-item failures warns; the source stays ok
    # but the sanitized detail is published instead of silently discarded.
    import warnings as _warnings

    def partial_fetcher(subset, key, http):
        _warnings.warn("2 series failed — X: HTTPError url apikey=SECRETX; Y: ValueError",
                       collect.PartialFetchWarning)
        return ok_fetcher(subset, key, http)

    monkeypatch.setattr(collect, "FETCHERS", {"A": partial_fetcher})
    results = collect.collect_all({"A": src("A")}, [ser("a1", "A")], {}, tmp_path)
    r = results[0]
    assert r.ok and r.new_rows == 1
    assert r.error is not None and r.error.startswith("partial: ")
    assert "X: HTTPError" in r.error
    assert "SECRETX" not in r.error and "apikey=REDACTED" in r.error
