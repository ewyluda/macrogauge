from pathlib import Path

import pytest

from pipeline.connectors import sfcompute

FIXTURE = (Path(__file__).parent / "fixtures" / "sfcompute.html").read_text()


class _R:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _get(text):
    return lambda url, timeout=None: _R(text)


def test_happy_path_emits_daily_history():
    obs = sfcompute.fetch(["H100"], vintage_date="2026-07-15",
                          http_get=_get(FIXTURE))
    assert len(obs) >= 3                       # fixture keeps >=3 rows per type
    dates = [o.obs_date for o in obs]
    assert dates == sorted(dates) or dates == sorted(dates, reverse=True)
    assert all(o.series_code == "H100" for o in obs)
    assert all(sfcompute.PLAUSIBLE[0] <= o.value <= sfcompute.PLAUSIBLE[1]
               for o in obs)
    assert all(o.vintage_date == "2026-07-15" for o in obs)
    assert {(o.source, o.route) for o in obs} == {("SFCOMPUTE", "SCRAPE")}


def test_all_types_parse():
    # H100 has real data; H200/B200 rows are all avg=0 so they produce no
    # observations. Fixture's real zero-avg rows test the skip semantics.
    obs = sfcompute.fetch(["H100", "H200", "B200"], vintage_date="2026-07-15",
                          http_get=_get(FIXTURE))
    # H100 must be present; H200/B200 sections parse without error but emit
    # nothing (zero-average skip at work)
    assert {"H100"} <= {o.series_code for o in obs}
    assert all(o.value > 0 for o in obs)  # zeros never stored


def test_missing_section_is_structure_drift():
    with pytest.raises(ValueError, match="structure drift"):
        sfcompute.fetch(["GB300"], vintage_date="2026-07-15",
                        http_get=_get(FIXTURE))


def test_zero_rows_is_structure_drift():
    # a section that exists but matches no rows (escaping drifted)
    html = FIXTURE.replace("avg", "mangled")
    with pytest.raises(ValueError, match="structure drift"):
        sfcompute.fetch(["H100"], vintage_date="2026-07-15", http_get=_get(html))


def test_zero_average_rows_skipped_not_error():
    # spike-observed: H200/B200 carry avg=0 on no-trade days — a real market
    # state; rows parse (no drift) but produce no observations
    obs = sfcompute.fetch(["H200"], vintage_date="2026-07-15",
                          http_get=_get(FIXTURE))
    assert all(o.value > 0 for o in obs)   # zeros never stored
