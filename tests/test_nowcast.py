from pipeline.engine.nowcast.models import ensemble, nfp_nowcast, pce_bridge


def test_pce_bridge_fits_linear_relationship():
    cpi, pce = [], []
    cpi_level = pce_level = 100.0
    for year in (2024, 2025):
        for month in range(1, 13):
            key = f"{year}-{month:02d}-01"
            move = 0.1 + month / 100
            cpi_level *= 1 + move / 100
            pce_level *= 1 + (0.05 + 0.8 * move) / 100
            cpi.append((key, cpi_level)); pce.append((key, pce_level))
    result = pce_bridge(0.3, cpi, pce)
    assert abs(result["mom_pct"] - 0.29) < 0.02
    assert result["parameters"]["observations"] >= 20


def test_nfp_model_returns_transparent_inputs_and_coefficients():
    payroll = [(f"2024-{m:02d}-01", 150000 + m * m * 10) for m in range(1, 13)]
    claims = [(f"2024-01-{d:02d}", 200 + d) for d in range(1, 13)]
    result = nfp_nowcast(payroll, claims)
    assert isinstance(result["change_thousands"], int)
    assert set(result["parameters"]) == {"a", "b", "c", "window_months"}


def test_ensemble_omits_missing_benchmarks_and_normalizes_weights():
    result = ensemble({"ours": 0.2, "cleveland": None, "street": 0.3},
                      {"ours": 0.1, "street": 0.2})
    assert set(result["weights"]) == {"ours", "street"}
    assert abs(sum(result["weights"].values()) - 1) < 1e-3
