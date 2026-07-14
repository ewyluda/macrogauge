"""Phase-3 receipts writers: forecasts, releases, grades and backtests."""
import json
from pathlib import Path

from pipeline.dates import prior_month
from pipeline.engine import backtest
from pipeline.models import Observation
from pipeline.publish import validate
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent.parent / "schemas"
# accountability_{cpi,pce,nfp}.json share one schema; every other file's
# schema name is derived from path.stem (see _write) — no hand-maintained map.
ACCOUNTABILITY_SCHEMA = "accountability.schema.json"


def _write(name: str, payload: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps({"published_at": published_at, **payload}, indent=2) + "\n")
    # Validate immediately, one file at a time — a mid-batch failure must never
    # leave a later file written-but-unvalidated on disk (see
    # docs/plans/2026-07-11-phase-3-4-structural-risks.md, Risk 3).
    schema = ACCOUNTABILITY_SCHEMA if name.startswith("accountability_") else f"{path.stem}.schema.json"
    validate.validate_file(path, SCHEMAS / schema)
    return path


def latest_benchmarks(conn, reference_month: str | None) -> dict[str, dict | None]:
    """Benchmark forecasts FOR the nowcast's reference month, with real as-of.

    Rows are keyed obs_date = reference-month first (shared connector
    convention); anything else — old-convention leftovers, a stale prior
    month — is excluded rather than silently blended into the ensemble."""
    codes = {"cleveland": "cleveland_cpi_mom", "kalshi": "kalshi_cpi_mom"}
    if reference_month is None:
        return {name: None for name in codes}
    out = {}
    for name, code in codes.items():
        row = conn.execute(
            "SELECT value, vintage_date FROM observations "
            "WHERE series_code = ? AND obs_date = ? "
            "ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (code, f"{reference_month}-01")).fetchone()
        out[name] = None if row is None else {"value": row[0], "as_of": row[1]}
    return out


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
    if nowcast.get("reference_month") is None:  # degraded nowcast: nothing to record
        return 0
    cpi_month = f"{nowcast['reference_month']}-01"
    nfp = nowcast.get("nfp")
    entries = [("forecast_cpi_mom", cpi_month, nowcast["cpi"]["mom_pct"]),
               ("forecast_pce_mom", cpi_month, nowcast["pce"]["mom_pct"])]
    if nfp is not None:
        entries.append(("forecast_nfp_change",
                        f"{nfp['reference_month']}-01",
                        nfp["change_thousands"]))
    observations = [Observation(code, obs_date, value, vintage_date,
                                "MACROGAUGE", "MODEL")
                    for code, obs_date, value in entries if value is not None]
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
        if actuals[i - 1][0] != prior_month(period):
            continue  # spans a never-published month (2025-10): not a MoM
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
    reference = (nowcast.get("nfp") or {}).get("reference_month") \
        if target == "nfp" else nowcast.get("reference_month")
    pending = [] if forecast is None or forecast.get("status") == "unavailable" else [{
        "reference_period": reference, "badge": "LIVE",
        "forecast": forecast.get("mom_pct", forecast.get("change_thousands")),
        "as_of": forecast.get("as_of", nowcast.get("generated_on")), "actual": None}]
    return {"target": target.upper(), "graded": graded, "pending": pending}


def build_nextprint(nowcast: dict) -> dict:
    # Forecaster rows never carry a null value — an unavailable model is
    # omitted, same convention as unavailable benchmarks.
    candidates = ([{"name": "Macrogauge", "value": nowcast["cpi"]["mom_pct"],
                    "kind": "model", "as_of": nowcast["cpi"]["as_of"]}]
                  if nowcast["cpi"]["mom_pct"] is not None else [])
    candidates += [{"name": name.title(), "value": bench["value"],
                    "kind": "benchmark", "as_of": bench["as_of"]}
                   for name, bench in nowcast["benchmarks"].items()
                   if bench is not None]
    return {"target": "CPI MoM", "release_date": nowcast["release_date"],
            "reference_month": nowcast["reference_month"],
            "ensemble": nowcast["ensemble"], "forecasters": candidates}


BBL_GALLONS = 42  # WTI quotes in $/barrel; the pump price is $/gallon
FUEL_FORMULA_RBOB = "pump + 0.85 × (RBOB_5d_avg − RBOB_prior15d_avg)"
FUEL_FORMULA_WTI = ("pump + 0.85 × (WTI_5d_avg − WTI_prior15d_avg); "
                    "WTI proxy converted at 42 gal/bbl")


def build_fuel(conn) -> dict:
    # Always carry every key (nulled when unavailable) so the artifact has a
    # stable shape regardless of data availability — a differently-shaped
    # valid artifact is what breaks the site's statically-typed JSON imports
    # (docs/plans/2026-07-11-phase-3-4-structural-risks.md, Risk 2).
    pump = vintage.latest(conn, "aaa_gas_d")
    rbob = vintage.latest(conn, "fmp_rbob")
    if len(rbob) >= 2:
        # RBOB quotes in $/gal — no barrel conversion.
        series, divisor = rbob, 1.0
        proxy, formula = "RBOB futures", FUEL_FORMULA_RBOB
    else:
        series, divisor = vintage.latest(conn, "fmp_wti"), BBL_GALLONS
        proxy, formula = "WTI (RBOB unavailable)", FUEL_FORMULA_WTI
    if not pump or len(series) < 2:
        return {"available": False, "formula": FUEL_FORMULA_RBOB,
                "as_of": None, "pump": None, "forward_2wk": None, "proxy": None}
    recent = [v for _, v in series[-5:]]
    prior = [v for _, v in series[-20:-5]] or recent
    change = (sum(recent) / len(recent) - sum(prior) / len(prior)) / divisor
    return {"available": True, "as_of": pump[-1][0], "pump": pump[-1][1],
            "forward_2wk": round(pump[-1][1] + 0.85 * change, 3),
            "proxy": proxy, "formula": formula}


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
