"""ERCOT / SPP / NYISO day-ahead connectors against real recorded files.

Fixtures are real downloads from 2026-10-04 (trimmed where the originals run
to megabytes); the expected daily means were computed from the full files
when the samples were taken and must survive the trim."""
import io
import json
import pathlib
import zipfile

import pytest

from pipeline.connectors import ercot, lmp, nyiso, spp

FIX = pathlib.Path(__file__).parent / "fixtures"


class _R:
    def __init__(self, text="", status_code=200, content=None, payload=None):
        self.text = text
        self.status_code = status_code
        self.content = content if content is not None else text.encode()
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")


# ---- NYISO -----------------------------------------------------------------

def test_nyiso_zone_means_from_real_file():
    text = (FIX / "nyiso_damlbmp_zone_20261005.csv").read_text()
    obs = nyiso.fetch(["N.Y.C.", "WEST"], vintage_date="2026-10-04", market_date="2026-10-05",
                      http_get=lambda url, timeout=None: _R(text))
    assert [(o.series_code, o.obs_date, o.value) for o in obs] == [
        ("N.Y.C.", "2026-10-05", 43.84), ("WEST", "2026-10-05", 31.37)]
    assert {o.source for o in obs} == {"NYISO"}


def test_nyiso_fall_back_day_averages_25_hours():
    text = (FIX / "nyiso_damlbmp_zone_20251102.csv").read_text()
    obs = nyiso.fetch(["N.Y.C."], vintage_date="2025-11-02", market_date="2025-11-02",
                      http_get=lambda url, timeout=None: _R(text))
    assert obs[0].value == 49.36


def test_nyiso_404_is_a_skip_not_an_error():
    assert nyiso.fetch(["N.Y.C."], market_date="2026-10-06",
                       http_get=lambda url, timeout=None: _R(status_code=404)) == []


def test_nyiso_missing_zone_is_drift():
    text = (FIX / "nyiso_damlbmp_zone_20261005.csv").read_text()
    with pytest.raises(ValueError, match="structure drift"):
        nyiso.fetch(["ATLANTIS"], market_date="2026-10-05", http_get=lambda url, timeout=None: _R(text))


def test_nyiso_url_is_the_daily_zone_file():
    seen = []
    nyiso.fetch(["N.Y.C."], market_date="2026-10-05",
                http_get=lambda url, timeout=None: seen.append(url) or _R(status_code=404))
    assert seen == ["https://mis.nyiso.com/public/csv/damlbmp/20261005damlbmp_zone.csv"]


# ---- SPP -------------------------------------------------------------------

def test_spp_hub_means_from_real_file():
    text = (FIX / "spp_da_lmp_sl_20261004.csv").read_text()
    seen = []
    obs = spp.fetch(["SPPNORTH_HUB", "SPPSOUTH_HUB"], vintage_date="2026-10-04",
                    market_date="2026-10-04",
                    http_get=lambda url, timeout=None: seen.append(url) or _R(text))
    assert [(o.series_code, o.value) for o in obs] == [("SPPNORTH_HUB", 36.05), ("SPPSOUTH_HUB", 32.16)]
    assert seen == ["https://portal.spp.org/file-browser-api/download/da-lmp-by-settlement-location"
                    "?path=/2026/10/By_Day/DA-LMP-SL-202610040100.csv"]


def test_spp_ignores_non_spp_baa_rows():
    head = "Interval,GMTIntervalEnd,BAA,Settlement Location,Pnode,LMP,MLC,MCC,MEC\n"
    rows = "".join(f"10/04/2026 {h:02d}:00:00,x,SPP,SPPNORTH_HUB,p,10.0,0,0,0\n" for h in range(1, 25))
    rows += "".join(f"10/04/2026 {h:02d}:00:00,x,SWPW,SPPNORTH_HUB,p,999.0,0,0,0\n" for h in range(1, 25))
    obs = spp.fetch(["SPPNORTH_HUB"], market_date="2026-10-04", http_get=lambda url, timeout=None: _R(head + rows))
    assert obs[0].value == 10.0


def test_spp_pre_expansion_file_without_baa_column():
    # 2025 files predate the western expansion: no BAA column, every row is SPP
    head = "Interval,GMTIntervalEnd,Settlement Location,Pnode,LMP,MLC,MCC,MEC\n"
    rows = "".join(f"09/23/2025 {h:02d}:00:00,x,SPPNORTH_HUB,p,{20 + h % 2}.0,0,0,0\n" for h in range(1, 25))
    obs = spp.fetch(["SPPNORTH_HUB"], market_date="2025-09-23", http_get=lambda url, timeout=None: _R(head + rows))
    assert obs[0].value == 20.5


def test_spp_upper_snake_case_headers():
    head = "INTERVAL,GMTINTERVALEND,BAA,SETTLEMENT_LOCATION,PNODE,LMP,MLC,MCC,MEC\n"
    rows = "".join(f"06/04/2026 {h:02d}:00:00,x,SPP,SPPNORTH_HUB,p,30.0,0,0,0\n" for h in range(1, 25))
    obs = spp.fetch(["SPPNORTH_HUB"], market_date="2026-06-04", http_get=lambda url, timeout=None: _R(head + rows))
    assert obs[0].value == 30.0


def test_spp_404_is_a_skip():
    assert spp.fetch(["SPPNORTH_HUB"], market_date="2026-10-06",
                     http_get=lambda url, timeout=None: _R(status_code=404)) == []


# ---- ERCOT -----------------------------------------------------------------

def _ercot_get(zip_bytes):
    listing = json.loads((FIX / "ercot_doclist_12331.json").read_text())
    seen = []

    def get(url, timeout=None):
        seen.append(url)
        if "IceDocListJsonWS" in url:
            return _R(payload=listing)
        return _R(content=zip_bytes)
    return get, seen


def test_ercot_hub_means_from_real_file_and_csv_docs_only():
    blob = (FIX / "ercot_dam_spp_20261004.zip").read_bytes()
    get, seen = _ercot_get(blob)
    obs = ercot.fetch(["HB_NORTH", "HB_HUBAVG"], vintage_date="2026-10-04", http_get=get, docs=1)
    assert [(o.series_code, o.obs_date, o.value) for o in obs] == [
        ("HB_NORTH", "2026-10-04", 37.03), ("HB_HUBAVG", "2026-10-04", 37.28)]
    # list first, then only the newest *_csv document (never the XML twin)
    assert seen[1] == "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId=1282050068"


def test_ercot_error_body_with_200_is_rejected():
    get, _ = _ercot_get(b"<root>Error Downloading Content - NO Results</root>")
    with pytest.raises(ValueError, match="not a zip"):
        ercot.fetch(["HB_NORTH"], http_get=get, docs=1)


def test_ercot_listing_drift():
    with pytest.raises(ValueError, match="structure drift"):
        ercot.fetch(["HB_NORTH"], http_get=lambda url, timeout=None: _R(payload={"nope": 1}))


def test_ercot_missing_point_is_drift():
    blob = (FIX / "ercot_dam_spp_20261004.zip").read_bytes()
    get, _ = _ercot_get(blob)
    with pytest.raises(ValueError, match="structure drift"):
        ercot.fetch(["HB_ATLANTIS"], http_get=get, docs=1)


# ---- shared guards ---------------------------------------------------------

def test_implausible_mean_is_drift():
    with pytest.raises(ValueError, match="structure drift"):
        lmp.daily_obs("SPP", "X", "2026-10-04", ["9999"] * 24, "2026-10-04", (-100, 3000))


def test_too_few_hours_is_drift():
    with pytest.raises(ValueError, match="hourly rows"):
        lmp.daily_obs("SPP", "X", "2026-10-04", ["10"] * 12, "2026-10-04", (-100, 3000))


def test_ercot_zip_with_two_dates_is_drift():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        rows = "".join(f"10/0{4 + (h > 12)}/2026,{h:02d}:00,HB_NORTH, 30.0,N\n" for h in range(1, 25))
        zf.writestr("x.csv", "DeliveryDate,HourEnding,SettlementPoint,SettlementPointPrice,DSTFlag\n" + rows)
    with pytest.raises(ValueError, match="one delivery date"):
        ercot.parse_zip(buf.getvalue(), ["HB_NORTH"], "2026-10-04")
