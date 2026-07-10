import json
from pathlib import Path

from pipeline.connectors import bls, util
from pipeline.connectors.fred import today_et

FIXTURE = Path(__file__).parent / "fixtures" / "bls_ap.json"


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
        self.text = json.dumps(payload)

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def fake_post(url, json=None, timeout=None):
    assert "api.bls.gov" in url
    assert json["seriesid"] == ["APU0000708111", "APU0000709112"]
    assert json["startyear"] == str(max(2017, int(today_et()[:4]) - 9))
    assert json.get("registrationkey") == "bls-key"
    import json as j
    return FakeResponse(j.loads(FIXTURE.read_text()))


def test_month_first():
    assert util.month_first("2026-05") == "2026-05-01"
    assert util.month_first("2026-05-31") == "2026-05-01"


def test_fetch_parses_and_skips_annual():
    obs = bls.fetch(["APU0000708111", "APU0000709112"], "bls-key",
                    vintage_date="2026-07-07", http_post=fake_post)
    assert len(obs) == 3  # M13 annual + M10 "-" (lapse in appropriations) skipped
    eggs = [o for o in obs if o.series_code == "APU0000708111"]
    assert [(o.obs_date, o.value) for o in eggs] == [("2026-05-01", 4.126),
                                                     ("2026-04-01", 4.055)]
    assert obs[0].source == "BLS" and obs[0].route == "API"


def test_fetch_omits_key_when_none():
    def post_no_key(url, json=None, timeout=None):
        assert "registrationkey" not in json
        import json as j
        return FakeResponse(j.loads(FIXTURE.read_text()))
    obs = bls.fetch(["APU0000708111", "APU0000709112"], None,
                    vintage_date="2026-07-07", http_post=post_no_key)
    assert len(obs) == 3


def test_fetch_chunks_large_series_lists():
    """Keyless BLS v2 caps at 25 series/request — fetch must chunk."""
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append(list(json["seriesid"]))
        return FakeResponse({"Results": {"series": [
            {"seriesID": sid, "data": []} for sid in json["seriesid"]]}})

    ids = [f"APU0000{i:06d}" for i in range(30)]
    bls.fetch(ids, api_key=None, http_post=fake_post)
    assert len(calls) == 2
    assert all(len(c) <= 25 for c in calls)
    assert [s for c in calls for s in c] == ids
