"""Cloud GPU list prices — fixtures are trimmed live responses recorded 2026-10-07
(nebius_prices.html: 2026-10-08, scripts, styles and attributes stripped)."""
import copy
import json
from pathlib import Path

import pytest

from pipeline.connectors import cloudgpu

FX = Path(__file__).parent / "fixtures"
AWS = json.loads((FX / "aws_gpu_prices.json").read_text())
AZURE = json.loads((FX / "azure_gpu_prices.json").read_text())
# eastus2 Reservation + Consumption rows, recorded 2026-10-08
AZURE_RES = json.loads((FX / "azure_gpu_reserved.json").read_text())
OCI = json.loads((FX / "oci_products.json").read_text())
COREWEAVE = (FX / "coreweave_pricing.html").read_text()
NEBIUS = (FX / "nebius_prices.html").read_text()
NEB_IDS = ["NVIDIA HGX H100", "NVIDIA HGX H200", "NVIDIA HGX B200", "NVIDIA HGX B300"]
V = "2026-10-07"


class _R:
    def __init__(self, payload=None, text=None):
        self._payload, self.text = payload, text

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _get(payload=None, text=None, seen=None):
    def get(url, timeout=None, headers=None):
        if seen is not None:
            seen.append(url)
        return _R(payload, text)
    return get


def _by(obs):
    return {o.series_code: o.value for o in obs}


# --- AWS ---------------------------------------------------------------------

def test_aws_divides_the_instance_price_by_its_gpus():
    obs = cloudgpu.fetch_aws(["p5.48xlarge/8", "p5en.48xlarge/8", "p6-b200.48xlarge/8",
                              "p6-b300.48xlarge/8", "p4de.24xlarge/8"], vintage_date=V, http_get=_get(AWS))
    v = _by(obs)
    assert v["p5.48xlarge/8"] == pytest.approx(55.04 / 8)        # $6.88 / H100-hr
    assert v["p6-b200.48xlarge/8"] == pytest.approx(113.9328 / 8, abs=1e-4)
    assert v["p4de.24xlarge/8"] == pytest.approx(27.44705 / 8, abs=1e-4)   # A100 80GB, not p4d's 40GB
    assert {(o.source, o.route, o.obs_date) for o in obs} == {("AWS_GPU", "API", V)}


def test_aws_missing_instance_is_skipped_but_none_found_is_drift():
    assert set(_by(cloudgpu.fetch_aws(["p9.gone/8", "p5.48xlarge/8"], vintage_date=V, http_get=_get(AWS)))) == {"p5.48xlarge/8"}
    with pytest.raises(ValueError, match="structure drift"):
        cloudgpu.fetch_aws(["p9.gone/8"], vintage_date=V, http_get=_get(AWS))
    with pytest.raises(ValueError, match="region map"):
        cloudgpu.fetch_aws(["p5.48xlarge/8"], vintage_date=V, http_get=_get({"regions": {}}))


def test_aws_conflicting_rows_for_a_tracked_instance_are_drift_and_others_are_ignored():
    bad = copy.deepcopy(AWS)
    rows = bad["regions"][cloudgpu.AWS_REGION]
    p5 = next(v for v in rows.values() if v["Instance Type"] == "p5.48xlarge")
    rows["p5 48xlarge capacity block"] = {**p5, "price": "31.464"}
    with pytest.raises(ValueError, match="distinct on-demand prices"):
        cloudgpu.fetch_aws(["p5.48xlarge/8"], vintage_date=V, http_get=_get(bad))
    # a malformed row for an untracked instance can't fail the source
    ok = copy.deepcopy(AWS)
    ok["regions"][cloudgpu.AWS_REGION]["junk"] = {"Instance Type": "c6a.12xlarge", "price": "n/a"}
    assert _by(cloudgpu.fetch_aws(["p5.48xlarge/8"], vintage_date=V, http_get=_get(ok)))


def test_aws_implausible_price_raises():
    bad = copy.deepcopy(AWS)
    for row in bad["regions"][cloudgpu.AWS_REGION].values():
        if row["Instance Type"] == "p5.48xlarge":
            row["price"] = "0.0005"
    with pytest.raises(ValueError, match="implausible"):
        cloudgpu.fetch_aws(["p5.48xlarge/8"], vintage_date=V, http_get=_get(bad))


# --- Azure -------------------------------------------------------------------

AZ_IDS = ["Standard_ND96isr_H100_v5/8", "Standard_ND96isr_H200_v5/8", "Standard_ND128isr_NDR_GB200_v6/4"]


def test_azure_reads_linux_pay_as_you_go_and_ignores_windows_and_spot():
    seen = []
    v = _by(cloudgpu.fetch_azure(AZ_IDS, vintage_date=V, http_get=_get(AZURE, seen=seen)))
    assert v["Standard_ND96isr_H100_v5/8"] == pytest.approx(98.32 / 8)
    assert v["Standard_ND96isr_H200_v5/8"] == pytest.approx(84.8 / 8)
    assert v["Standard_ND128isr_NDR_GB200_v6/4"] == pytest.approx(108.16 / 4)
    # one query names every SKU, in the one region
    assert len(seen) == 1 and "eastus2" in seen[0] and "Standard_ND96isr_H200_v5" in seen[0]


def test_azure_two_linux_prices_for_one_sku_is_drift():
    bad = copy.deepcopy(AZURE)
    extra = copy.deepcopy(next(i for i in bad["Items"] if i["armSkuName"] == "Standard_ND96isr_H100_v5"
                               and "Windows" not in i["productName"] and "Spot" not in i["meterName"]
                               and "Low Priority" not in i["meterName"]))
    extra["unitPrice"] = 77.0
    bad["Items"].append(extra)
    with pytest.raises(ValueError, match="distinct Linux on-demand prices"):
        cloudgpu.fetch_azure(AZ_IDS, vintage_date=V, http_get=_get(bad))


def test_azure_follows_next_page_links():
    first = {"Items": AZURE["Items"][:4], "NextPageLink": "https://prices.azure.com/api/retail/prices?page=2"}
    second = {"Items": AZURE["Items"][4:], "NextPageLink": None}
    pages = iter([first, second])
    seen = []

    def get(url, timeout=None, headers=None):
        seen.append(url)
        return _R(next(pages))
    assert len(cloudgpu.fetch_azure(AZ_IDS, vintage_date=V, http_get=get)) == 3
    assert len(seen) == 2


AZ_RES_IDS = [f"{sid}/{y}y" for sid in AZ_IDS for y in (1, 3)]


def test_azure_reserved_converts_the_term_total_to_a_gpu_hour():
    # the API says '1 Hour' but prices the whole term: $551,221 buys one
    # ND96isr H100 v5 (8 GPUs) for a year
    seen = []
    v = _by(cloudgpu.fetch_azure_reserved(AZ_RES_IDS, vintage_date=V, http_get=_get(AZURE_RES, seen=seen)))
    assert v["Standard_ND96isr_H100_v5/8/1y"] == pytest.approx(551221 / 8760 / 8, abs=1e-4)       # $7.87
    assert v["Standard_ND96isr_H100_v5/8/3y"] == pytest.approx(1134310 / (3 * 8760) / 8, abs=1e-4)  # $5.40
    assert v["Standard_ND96isr_H200_v5/8/3y"] == pytest.approx(1109592 / (3 * 8760) / 8, abs=1e-4)
    assert v["Standard_ND128isr_NDR_GB200_v6/4/1y"] == pytest.approx(606388 / 8760 / 4, abs=1e-4)
    assert len(v) == 6
    assert len(seen) == 1 and "eastus2" in seen[0] and "Reservation" in seen[0]


def test_azure_reserved_skips_a_term_the_api_does_not_list():
    # H100 is the only SKU with a 5-year term; asking for H200's skips that series
    v = _by(cloudgpu.fetch_azure_reserved(["Standard_ND96isr_H200_v5/8/5y", "Standard_ND96isr_H100_v5/8/5y"],
                                          vintage_date=V, http_get=_get(AZURE_RES)))
    assert set(v) == {"Standard_ND96isr_H100_v5/8/5y"}


def test_azure_reserved_rejects_an_hourly_rate_republished_as_the_term_price():
    # a reservation row that is suddenly a true hourly rate would divide down
    # to cents: below a tenth of on-demand, so it is drift, never stored
    bad = copy.deepcopy(AZURE_RES)
    for it in bad["Items"]:
        if it["type"] == "Reservation" and it["armSkuName"] == "Standard_ND96isr_H100_v5":
            it["unitPrice"] = 62.92
    with pytest.raises(ValueError, match="not a term total"):
        cloudgpu.fetch_azure_reserved(["Standard_ND96isr_H100_v5/8/1y"], vintage_date=V, http_get=_get(bad))


def test_azure_reserved_rejects_an_unknown_term_and_a_malformed_id():
    bad = copy.deepcopy(AZURE_RES)
    next(it for it in bad["Items"] if it["type"] == "Reservation")["reservationTerm"] = "6 Months"
    with pytest.raises(ValueError, match="reservation term"):
        cloudgpu.fetch_azure_reserved(AZ_RES_IDS, vintage_date=V, http_get=_get(bad))
    with pytest.raises(ValueError, match="malformed"):
        cloudgpu.fetch_azure_reserved(["Standard_ND96isr_H100_v5/8/1yr"], vintage_date=V, http_get=_get(AZURE_RES))


def test_azure_reserved_without_any_tracked_reservation_is_drift():
    only_od = {"Items": [it for it in AZURE_RES["Items"] if it["type"] == "Consumption"], "NextPageLink": None}
    with pytest.raises(ValueError, match="no tracked SKU"):
        cloudgpu.fetch_azure_reserved(AZ_RES_IDS, vintage_date=V, http_get=_get(only_od))


# --- Oracle ------------------------------------------------------------------

def test_oci_reads_per_gpu_hour_pay_as_you_go():
    v = _by(cloudgpu.fetch_oci(["B98415:H100", "B110519:H200", "B110978:B200", "B110979:GB200",
                                "B112237:B300", "B95907:A100"], vintage_date=V, http_get=_get(OCI)))
    assert v == {"B98415:H100": 10.0, "B110519:H200": 10.0, "B110978:B200": 14.0,
                 "B110979:GB200": 16.0, "B112237:B300": 15.0, "B95907:A100": 4.0}


def test_oci_reassigned_part_number_is_drift():
    # B109480 is the H100T line, not plain H100
    with pytest.raises(ValueError, match="structure drift"):
        cloudgpu.fetch_oci(["B109480:B200"], vintage_date=V, http_get=_get(OCI))


# --- CoreWeave ---------------------------------------------------------------

CW_IDS = ["NVIDIA HGX H100/8", "NVIDIA HGX H200/8", "NVIDIA HGX B200/8", "NVIDIA GB200 NVL72/4", "NVIDIA A100/8"]


def test_coreweave_node_price_per_gpu():
    obs = cloudgpu.fetch_coreweave(CW_IDS, vintage_date=V, http_get=_get(text=COREWEAVE))
    v = _by(obs)
    assert v["NVIDIA HGX H100/8"] == pytest.approx(49.24 / 8)
    assert v["NVIDIA GB200 NVL72/4"] == pytest.approx(42.0 / 4)
    assert v["NVIDIA A100/8"] == pytest.approx(21.6 / 8)
    assert {(o.source, o.route) for o in obs} == {("COREWEAVE", "SCRAPE")}


def test_coreweave_price_must_be_the_labelled_on_demand_one():
    # a page whose table cell no longer matches the on-demand label (a column
    # reorder putting Spot first) fails instead of storing the spot price
    swapped = COREWEAVE.replace("<div>$49.24</div>", "<div>$19.71</div>")
    assert swapped != COREWEAVE
    with pytest.raises(ValueError, match="labelled on-demand"):
        cloudgpu.fetch_coreweave(["NVIDIA HGX H100/8"], vintage_date=V, http_get=_get(text=swapped))


def test_coreweave_wrong_gpu_count_and_redesign_are_drift():
    with pytest.raises(ValueError, match="GPUs per node"):
        cloudgpu.fetch_coreweave(["NVIDIA HGX H100/4"], vintage_date=V, http_get=_get(text=COREWEAVE))
    with pytest.raises(ValueError, match="structure drift"):
        cloudgpu.fetch_coreweave(CW_IDS, vintage_date=V, http_get=_get(text="<html>Contact sales</html>"))
    # "Contact sales" rows (no price) are skipped, not misread
    assert cloudgpu.fetch_coreweave(["NVIDIA HGX B300/8", "NVIDIA HGX H100/8"], vintage_date=V,
                                    http_get=_get(text=COREWEAVE))[0].series_code == "NVIDIA HGX H100/8"


def test_nebius_uses_the_column_in_effect_on_the_vintage_date():
    # the page carries today's on-demand column and a scheduled one
    # ("GPU-hour (Effective October 1, 2026)"): from that date it is the price
    after = cloudgpu.fetch_nebius(NEB_IDS, vintage_date="2026-10-08", http_get=_get(text=NEBIUS))
    assert {o.series_code: o.value for o in after} == {
        "NVIDIA HGX H100": 4.5, "NVIDIA HGX H200": 5.4, "NVIDIA HGX B200": 8.5, "NVIDIA HGX B300": 9.5}
    assert {o.source for o in after} == {"NEBIUS"} and {o.route for o in after} == {"SCRAPE"}
    before = cloudgpu.fetch_nebius(NEB_IDS, vintage_date="2026-09-30", http_get=_get(text=NEBIUS))
    assert {o.series_code: o.value for o in before}["NVIDIA HGX H100"] == 3.85


def test_nebius_reads_only_the_on_demand_table():
    # the spot table below repeats every row "from $0.79": never a list price
    obs = cloudgpu.fetch_nebius(["NVIDIA HGX H100"], vintage_date=V, http_get=_get(text=NEBIUS))
    assert [o.value for o in obs] == [4.5]
    assert cloudgpu.fetch_nebius(["NVIDIA HGX H100", "NVIDIA HGX X999"], vintage_date=V,
                                 http_get=_get(text=NEBIUS))[0].series_code == "NVIDIA HGX H100"


def test_nebius_redesign_is_drift():
    for page, why in (
        ("<html>Contact sales</html>", "no on-demand"),
        (NEBIUS.replace("GPU-hour (Effective October 1, 2026)", "Reserved, GPU-hour"), "unexpected price column"),
        (NEBIUS.replace("Preemptible", "Spot-market", 1), "no spot table"),
    ):
        with pytest.raises(ValueError, match=why):
            cloudgpu.fetch_nebius(NEB_IDS, vintage_date=V, http_get=_get(text=page))
    # a tracked row that stops quoting a flat on-demand rate fails loudly
    i = NEBIUS.index("NVIDIA HGX H100")
    j = NEBIUS.index("$4.50", i)
    with pytest.raises(ValueError, match="not a flat on-demand rate"):
        cloudgpu.fetch_nebius(NEB_IDS, vintage_date=V,
                              http_get=_get(text=NEBIUS[:j] + "from $4.50" + NEBIUS[j + 5:]))
    with pytest.raises(ValueError, match="no tracked SKU"):
        cloudgpu.fetch_nebius(["NVIDIA HGX X999"], vintage_date=V, http_get=_get(text=NEBIUS))

