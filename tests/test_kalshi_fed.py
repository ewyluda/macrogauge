"""KXFED market-implied Fed path (backlog #10a). Fixture: live open + settled
KXFED responses recorded 2026-09-28 (trimmed to the fields the connector
reads), when the upper bound in effect was 4.00% (Sep 16 hike)."""
import json
from pathlib import Path

import pytest

from pipeline.connectors import kalshi

FX = json.loads((Path(__file__).parent / "fixtures" / "kalshi_fed.json").read_text())


class _R:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(open_payload=None, settled_payload=None, calls=None):
    def get(url, params=None, timeout=None):
        if calls is not None:
            calls.append(params)
        assert params["series_ticker"] == "KXFED"
        if params["status"] == "settled":
            return _R(settled_payload if settled_payload is not None else FX["settled"])
        return _R(open_payload if open_payload is not None else FX["open"])
    return get


def _by(obs):
    return {(o.series_code, o.obs_date): o.value for o in obs}


def test_recorded_session_publishes_liquid_meetings_only():
    obs = kalshi.fetch_fed(vintage_date="2026-09-28", http_get=_get())
    got = _by(obs)
    assert got[("kalshi_fed_ref_upper", "2026-09-28")] == 4.0   # KXFED-26SEP settled 4.00%
    meetings = sorted(d for c, d in got if c == "kalshi_fed_upper")
    # 11 open meetings; only Oct + Dec 2026 have tight two-sided quotes
    # bracketing the distribution — the 2027 ladders are resting 0.03/0.99
    assert meetings == ["2026-10-28", "2026-12-09"]
    assert got[("kalshi_fed_upper", "2026-10-28")] == pytest.approx(4.1787, abs=1e-4)
    assert got[("kalshi_fed_p_hike", "2026-10-28")] == pytest.approx(0.705, abs=1e-4)
    assert got[("kalshi_fed_p_hold", "2026-10-28")] == pytest.approx(0.2875, abs=1e-4)
    assert got[("kalshi_fed_p_cut", "2026-10-28")] == pytest.approx(0.0075, abs=1e-4)
    for d in meetings:   # the per-meeting "quoted on this fetch" stamp
        assert got[("kalshi_fed_quoted", d)] == 20260928.0
        total = sum(got[(f"kalshi_fed_p_{k}", d)] for k in ("cut", "hold", "hike"))
        assert total == pytest.approx(1.0, abs=1e-6)
    assert all(o.source == "KALSHI_FED" and o.vintage_date == "2026-09-28" for o in obs)


def test_expected_upper_on_the_25bp_grid():
    # adjacent rungs: mass between a and b sits at b; top mass one step past
    curve = [(3.75, 1.0), (4.0, 0.5), (4.25, 0.0)]
    assert kalshi._fed_expected(curve) == pytest.approx(0.5 * 4.0 + 0.5 * 4.25)
    # a dropped rung leaves a gap: mass spreads over the grid points a+.25..b
    gap = [(3.5, 1.0), (4.0, 0.0)]
    assert kalshi._fed_expected(gap) == pytest.approx((3.75 + 4.0) / 2)


def test_pav_forces_a_monotone_survival_curve():
    assert kalshi._pav_nonincreasing([0.9, 0.5, 0.7, 0.1]) == pytest.approx(
        [0.9, 0.6, 0.6, 0.1])


def test_wide_spread_rungs_are_dropped_and_unbracketed_meeting_skipped():
    ev, close = "KXFED-26OCT", "2026-10-28T17:55:00Z"
    wide = {"markets": [
        {"event_ticker": ev, "floor_strike": s, "yes_bid_dollars": b,
         "yes_ask_dollars": a, "close_time": close}
        for s, b, a in ((3.75, "0.97", "0.99"), (4.0, "0.10", "0.90"),
                        (4.25, "0.05", "0.95"))]}
    with pytest.raises(ValueError, match="no meeting ladder liquid enough"):
        kalshi.fetch_fed(vintage_date="2026-09-28", http_get=_get(open_payload=wide))


def test_past_meetings_are_ignored():
    obs = kalshi.fetch_fed(vintage_date="2026-11-01", http_get=_get())
    assert sorted(d for c, d in _by(obs) if c == "kalshi_fed_upper") == ["2026-12-09"]


def test_off_grid_strike_is_structure_drift():
    bad = {"markets": [{"event_ticker": "KXFED-26OCT", "floor_strike": 4.1,
                        "yes_bid_dollars": "0.5", "yes_ask_dollars": "0.52",
                        "close_time": "2026-10-28T17:55:00Z"}]}
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_fed(vintage_date="2026-09-28", http_get=_get(open_payload=bad))


def test_unexpected_event_ticker_is_structure_drift():
    bad = {"markets": [{"event_ticker": "FED-26OCT", "floor_strike": 4.0,
                        "yes_bid_dollars": "0.5", "yes_ask_dollars": "0.52",
                        "close_time": "2026-10-28T17:55:00Z"}]}
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_fed(vintage_date="2026-09-28", http_get=_get(open_payload=bad))


def test_reference_must_parse_as_percent():
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_fed(vintage_date="2026-09-28", http_get=_get(
            settled_payload={"markets": [{"close_time": "2026-09-16T17:55:00Z",
                                          "expiration_value": "four percent"}]}))
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_fed(vintage_date="2026-09-28",
                         http_get=_get(settled_payload={"markets": []}))


def test_missing_markets_key_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        kalshi.fetch_fed(vintage_date="2026-09-28",
                         http_get=_get(open_payload={"unexpected": []}))
