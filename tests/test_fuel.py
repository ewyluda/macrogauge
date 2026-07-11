from pathlib import Path

from pipeline.models import Observation
from pipeline.publish import phase3
from pipeline.store import vintage


def test_fuel_forward_converts_wti_barrels_to_gallons(tmp_path: Path):
    obs = [Observation("aaa_gas_d", "2026-07-10", 3.0, "2026-07-10", "AAA", "SCRAPE")]
    for day in range(1, 21):
        price = 70.0 if day <= 15 else 74.2  # +$4.20/bbl == +$0.10/gal
        obs.append(Observation("fmp_wti", f"2026-06-{day:02d}", price,
                               "2026-07-10", "FMP", "API"))
    vintage.append(obs, tmp_path)
    fuel = phase3.build_fuel(vintage.load(tmp_path))
    assert fuel["forward_2wk"] == 3.085  # 3.00 + 0.85 × 0.10, not 3.00 + 0.85 × 4.20
    assert "42" in fuel["formula"]
