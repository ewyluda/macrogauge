"""Phase-3 receipts writers: forecasts, releases, grades and backtests."""
import json
from pathlib import Path

from pipeline.engine import backtest
from pipeline.models import Observation
from pipeline.store import vintage


def _write(name: str, payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps({"published_at": published_at, **payload}, indent=2) + "\n")
    return path


def latest_benchmarks(conn) -> dict[str, float | None]:
    codes = {"cleveland": "cleveland_cpi_mom", "street": "street_cpi_mom",
             "kalshi": "kalshi_cpi_mom"}
    return {name: (rows[-1][1] if (rows := vintage.latest(conn, code)) else None)
            for name, code in codes.items()}


def build_releases(conn) -> dict:
    targets = {"cpi": "CPIAUCNS", "pce": "PCEPI", "nfp": "PAYEMS"}
    return {"releases": [
        {"target": target, "reference_period": obs[:7], "value": value,
         "first_release_date": released}
        for target, code in targets.items()
        for obs, value, released in vintage.first_releases(conn, code)[-24:]
    ]}


def record_forecasts(nowcast: dict, conn, store_dir: Path, vintage_date: str) -> int:
    """Persist today's live forecasts so later grades never reconstruct history."""
    target_date = f"{nowcast['reference_month']}-01"
    values = {"forecast_cpi_mom": nowcast["cpi"]["mom_pct"],
              "forecast_pce_mom": nowcast["pce"]["mom_pct"],
              "forecast_nfp_change": (None if nowcast["nfp"] is None else
                                      nowcast["nfp"]["change_thousands"])}
    observations = [Observation(code, target_date, value, vintage_date,
                                "MACROGAUGE", "MODEL")
                    for code, value in values.items() if value is not None]
    written = vintage.append(observations, store_dir)
    conn.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
                     [(o.series_code, o.obs_date, o.value, o.vintage_date,
                       o.source, o.route) for o in observations])
    conn.commit()
    return written


def build_accountability(target: str, nowcast: dict, conn) -> dict:
    """Grade last pre-release live forecast against the first-release actual."""
    key = "cpi" if target == "cpi" else target
    forecast = nowcast.get(key)
    forecast_codes = {"cpi": "forecast_cpi_mom", "pce": "forecast_pce_mom",
                      "nfp": "forecast_nfp_change"}
    actual_codes = {"cpi": "CPIAUCNS", "pce": "PCEPI", "nfp": "PAYEMS"}
    actuals = vintage.first_releases(conn, actual_codes[target])
    actual_changes = {}
    for i in range(1, len(actuals)):
        period, value, released = actuals[i]
        previous = actuals[i - 1][1]
        actual_changes[period] = ((value / previous - 1) * 100 if target in ("cpi", "pce")
                                  else value - previous, released)
    graded = []
    for period, (actual, release_date) in actual_changes.items():
        row = conn.execute(
            "SELECT value, vintage_date FROM observations "
            "WHERE series_code = ? AND obs_date = ? AND vintage_date < ? "
            "ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (forecast_codes[target], period, release_date)).fetchone()
        if row is None:
            continue
        value, forecast_date = row
        graded.append({"reference_period": period[:7], "badge": "LIVE",
                       "forecast": round(value, 2), "as_of": forecast_date,
                       "actual": round(actual, 2),
                       "error": round(value - actual, 2),
                       "release_date": release_date})
    pending = [] if forecast is None else [{
        "reference_period": nowcast.get("reference_month"), "badge": "LIVE",
        "forecast": forecast.get("mom_pct", forecast.get("change_thousands")),
        "as_of": forecast.get("as_of", nowcast.get("generated_on")), "actual": None}]
    return {"target": target.upper(), "graded": graded, "pending": pending}


def build_nextprint(nowcast: dict) -> dict:
    candidates = [{"name": "Macrogauge", "value": nowcast["cpi"]["mom_pct"],
                   "kind": "model", "as_of": nowcast["cpi"]["as_of"]}]
    candidates += [{"name": name.title(), "value": value, "kind": "benchmark",
                    "as_of": nowcast["generated_on"]}
                   for name, value in nowcast["benchmarks"].items() if value is not None]
    return {"target": "CPI MoM", "release_date": nowcast["release_date"],
            "reference_month": nowcast["reference_month"],
            "ensemble": nowcast["ensemble"], "forecasters": candidates}


def build_fuel(conn) -> dict:
    pump = vintage.latest(conn, "aaa_gas_d")
    rbob = vintage.latest(conn, "fmp_wti")  # WTI proxy until RBOB is registered
    if not pump or len(rbob) < 2:
        return {"available": False, "formula":
                "pump + 0.85 × (RBOB_5d_avg − RBOB_prior15d_avg)"}
    recent = [v for _, v in rbob[-5:]]
    prior = [v for _, v in rbob[-20:-5]] or recent
    change = sum(recent) / len(recent) - sum(prior) / len(prior)
    return {"available": True, "as_of": pump[-1][0], "pump": pump[-1][1],
            "forward_2wk": round(pump[-1][1] + 0.85 * change, 3),
            "proxy": "WTI (RBOB unavailable)",
            "formula": "pump + 0.85 × (RBOB_5d_avg − RBOB_prior15d_avg)"}


def write_all(nowcast: dict, conn, out_dir: Path, published_at: str) -> list[Path]:
    releases = build_releases(conn)
    payloads = {
        "nowcast_latest.json": nowcast,
        "nextprint.json": build_nextprint(nowcast),
        "releases.json": releases,
        "backtest.json": backtest.cpi_walk_forward(conn),
        "fuel.json": build_fuel(conn),
        **{f"accountability_{target}.json": build_accountability(target, nowcast, conn)
           for target in ("cpi", "pce", "nfp")},
    }
    return [_write(name, payload, out_dir, published_at) for name, payload in payloads.items()]
