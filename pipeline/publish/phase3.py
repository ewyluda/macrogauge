"""Phase-3 receipts writers: forecasts, releases, grades and backtests."""
from pathlib import Path

from pipeline.dates import prior_month
from pipeline.engine import backtest
from pipeline.models import Observation
from pipeline.publish import validate
from pipeline.publish.util import write_json
from pipeline.store import vintage

SCHEMAS = Path(__file__).parent.parent.parent / "schemas"
# accountability_{cpi,pce,nfp}.json share one schema; every other file's
# schema name is derived from path.stem (see _write) — no hand-maintained map.
ACCOUNTABILITY_SCHEMA = "accountability.schema.json"


def _write(name: str, payload: dict, out_dir: Path, published_at: str) -> Path:
    path = write_json({"published_at": published_at, **payload}, out_dir, name)
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
    return _benchmarks(conn, reference_month,
                       {"cleveland": "cleveland_cpi_mom", "kalshi": "kalshi_cpi_mom"})


def latest_core_benchmarks(conn, reference_month: str | None) -> dict[str, dict | None]:
    """Core CPI benchmarks for the same reference month (Cleveland's core
    nowcast was collected but never published; Kalshi's KXCPICORE ladder)."""
    return _benchmarks(conn, reference_month,
                       {"cleveland": "cleveland_core_cpi_mom", "kalshi": "kalshi_core_cpi_mom"})


def _benchmarks(conn, reference_month, codes):
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
    # forecast_cpi_mom stays the NSA call (its history is NSA);
    # forecast_cpi_mom_sa is the headline SA call graded against CPIAUCSL.
    entries = [("forecast_cpi_mom", cpi_month,
                nowcast["cpi"].get("mom_nsa_pct", nowcast["cpi"]["mom_pct"])),
               ("forecast_pce_mom", cpi_month, nowcast["pce"]["mom_pct"])]
    if nowcast["cpi"].get("basis") == "SA":
        entries.append(("forecast_cpi_mom_sa", cpi_month, nowcast["cpi"]["mom_pct"]))
    core = nowcast["cpi"].get("core")
    if core and core.get("basis") == "SA":
        entries.append(("forecast_core_cpi_mom_sa", cpi_month, core["mom_pct"]))
    # Frozen per-component rows (NSA MoM, the model's native unit): after the
    # print, each component's miss can be attributed against its own CUUR
    # series. Value-deduped by vintage.append, so an unchanged row costs nothing.
    for row in nowcast["cpi"].get("components") or []:
        entries.append((f"forecast_cpi_comp_{row['component']}", cpi_month, row["mom_pct"]))
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


def _graded_rows(conn, forecast_code: str, actual_code: str, pct: bool) -> dict[str, dict]:
    """{obs_date: graded row} — last pre-release recorded forecast vs the
    change AS THE RELEASE REPORTED IT: t's first print over t-1 as known on
    t's release date. BLS/BEA revise t-1 in the same release, so first(t) -
    first(t-1) mixes two vintages (Aug-2026 payrolls read +217k that way vs
    the release's own +162k; July -126k vs -23k)."""
    out = {}
    for period, value, released in vintage.first_releases(conn, actual_code):
        known = dict(vintage.as_of(conn, actual_code, released))
        previous = known.get(prior_month(period))
        if previous is None:
            continue  # prior month never published (2025-10): not a MoM
        actual = (value / previous - 1) * 100 if pct else value - previous
        row = conn.execute(
            "SELECT value, vintage_date FROM observations "
            "WHERE series_code = ? AND obs_date = ? AND vintage_date < ? "
            "ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (forecast_code, period, released)).fetchone()
        if row is None:
            continue
        fv, forecast_date = row
        out[period] = {"reference_period": period[:7], "badge": "LIVE",
                       "forecast": round(fv, 2), "as_of": forecast_date,
                       "actual": round(actual, 2), "error": round(fv - actual, 2),
                       "release_date": released}
    return out


def build_accountability(target: str, nowcast: dict, conn) -> dict:
    """Grade last pre-release live forecast against the first-release actual.

    CPI grades on the seasonally adjusted basis (forecast_cpi_mom_sa vs
    CPIAUCSL) from 2026-09-26 on — the basis Cleveland and Kalshi quote;
    earlier recorded calls were NSA and keep grading against CPIAUCNS. Each
    row says which (`basis`)."""
    key = "cpi" if target == "cpi" else target
    forecast = nowcast.get(key)
    forecast_codes = {"cpi": "forecast_cpi_mom", "pce": "forecast_pce_mom",
                      "nfp": "forecast_nfp_change"}
    actual_codes = {"cpi": "CPIAUCNS", "pce": "PCEPI", "nfp": "PAYEMS"}
    actuals = vintage.first_releases(conn, actual_codes[target])
    pct = target in ("cpi", "pce")
    rows = _graded_rows(conn, forecast_codes[target], actual_codes[target], pct)
    if target == "cpi":
        rows = {p: {**r, "basis": "NSA"} for p, r in rows.items()}
        rows.update({p: {**r, "basis": "SA"} for p, r in
                     _graded_rows(conn, "forecast_cpi_mom_sa", "CPIAUCSL", True).items()})
        sa_recorded = conn.execute("SELECT 1 FROM observations WHERE series_code = "
                                   "'forecast_cpi_mom_sa' LIMIT 1").fetchone()
        if sa_recorded:
            forecast_codes["cpi"] = "forecast_cpi_mom_sa"  # pending calls are SA now
    graded = [rows[p] for p in sorted(rows)]
    reference = (nowcast.get("nfp") or {}).get("reference_month") \
        if target == "nfp" else nowcast.get("reference_month")
    live = [] if forecast is None or forecast.get("status") == "unavailable" else [{
        "reference_period": reference, "badge": "LIVE",
        "forecast": forecast.get("mom_pct", forecast.get("change_thousands")),
        "as_of": forecast.get("as_of", nowcast.get("generated_on")), "actual": None}]
    # Every recorded call still awaiting its print, not only the current
    # target: the PCE call for month t freezes when the CPI nowcast rolls to
    # t+1 (~mid-month) but PCE for t prints ~2 weeks later — it was invisible.
    released = {p for p, _, _ in actuals}
    live_periods = {r["reference_period"] for r in live}
    frozen = []
    for period, value, as_of in conn.execute(
            "SELECT obs_date, value, vintage_date FROM ("
            " SELECT obs_date, value, vintage_date, ROW_NUMBER() OVER ("
            "  PARTITION BY obs_date ORDER BY vintage_date DESC, rowid DESC) rn"
            " FROM observations WHERE series_code = ?) WHERE rn = 1 ORDER BY obs_date",
            (forecast_codes[target],)).fetchall():
        if period in released or period[:7] in live_periods or (
                released and period <= max(released)):
            continue  # graded, current, or skipped by the agency (2025-10 CPI)
        frozen.append({"reference_period": period[:7], "badge": "LIVE",
                       "forecast": round(value, 2), "as_of": as_of, "actual": None})
    pending = frozen + live
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
    core = (nowcast["cpi"] or {}).get("core")
    core_rows = ([{"name": "Macrogauge", "value": core["mom_pct"], "kind": "model",
                   "as_of": nowcast["cpi"]["as_of"]}] if core else [])
    core_rows += [{"name": name.title(), "value": b["value"], "kind": "benchmark",
                   "as_of": b["as_of"]}
                  for name, b in (nowcast.get("core_benchmarks") or {}).items()]
    return {"target": "CPI MoM", "release_date": nowcast["release_date"],
            "reference_month": nowcast["reference_month"],
            "basis": (nowcast["cpi"] or {}).get("basis", "NSA"),
            "ensemble": nowcast["ensemble"], "forecasters": candidates,
            "core": {"ensemble": nowcast.get("core_ensemble") or {"value": None, "weights": {}},
                     "forecasters": core_rows}}


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


LEADERBOARD_MIN_N = 6  # graded prints each forecaster needs before weights are earned
LEADERBOARD_WINDOW = 12


def build_leaderboard(conn) -> dict:
    """Head-to-head CPI MoM track record on ONE basis (seasonally adjusted,
    as first released): each forecaster's last value before the release vs
    CPIAUCSL t over t-1 as known on release day. Our pre-2026-09-26 calls
    were recorded NSA and are converted with the same seasonal factors the
    live model now uses (seasonal_mom), flagged `converted`."""
    from pipeline.engine.nowcast.models import seasonal_mom
    releases = {p: r for p, _, r in vintage.first_releases(conn, "CPIAUCNS")}
    sources = {"macrogauge": ("forecast_cpi_mom_sa", "forecast_cpi_mom"),
               "cleveland": ("cleveland_cpi_mom", None),
               "kalshi": ("kalshi_cpi_mom", None)}

    def last_before(code, period, released):
        row = conn.execute(
            "SELECT value FROM observations WHERE series_code = ? AND obs_date = ? "
            "AND vintage_date < ? ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (code, period, released)).fetchone()
        return None if row is None else row[0]

    rows = []
    for period in sorted(releases)[-LEADERBOARD_WINDOW:]:
        released = releases[period]
        known = dict(vintage.as_of(conn, "CPIAUCSL", released))
        prev = known.get(prior_month(period))
        if prev is None or period not in known:
            continue
        actual = (known[period] / prev - 1) * 100
        entry = {"reference_period": period[:7], "release_date": released,
                 "actual_sa_mom_pct": round(actual, 3), "forecasts": {}}
        for name, (code, legacy) in sources.items():
            value, converted = last_before(code, period, released), False
            if value is None and legacy:
                nsa = last_before(legacy, period, released)
                value = None if nsa is None else seasonal_mom(nsa, conn, period)
                converted = value is not None
            if value is not None:
                entry["forecasts"][name] = {"value": round(value, 3),
                                            "error": round(value - actual, 3),
                                            "converted": converted}
        if entry["forecasts"]:
            rows.append(entry)
    stats = {}
    for name in sources:
        errs = [r["forecasts"][name]["error"] for r in rows if name in r["forecasts"]]
        stats[name] = {"n": len(errs),
                       "mae_pp": round(sum(abs(e) for e in errs) / len(errs), 3) if errs else None,
                       "bias_pp": round(sum(errs) / len(errs), 3) if errs else None}
    earned = all(v["n"] >= LEADERBOARD_MIN_N for v in stats.values())
    return {"basis": "SA, first release", "window": LEADERBOARD_WINDOW,
            "min_n_for_weights": LEADERBOARD_MIN_N, "weights_earned": earned,
            "stats": stats, "rows": rows}


def build_component_misses(conn, basket_components=None) -> dict | None:
    """Miss attribution for the latest released CPI month: each frozen
    component row (forecast_cpi_comp_<code>, NSA MoM) vs that component's own
    official NSA MoM as released. None until a print lands after component
    rows started being recorded (2026-09-26)."""
    from pipeline import basket as basket_mod
    comps = basket_components or basket_mod.load_basket()[1]
    releases = vintage.first_releases(conn, "CPIAUCNS")
    if not releases:
        return None
    period, _, released = releases[-1]
    rows = []
    for c in comps:
        f = conn.execute(
            "SELECT value FROM observations WHERE series_code = ? AND obs_date = ? "
            "AND vintage_date < ? ORDER BY vintage_date DESC, rowid DESC LIMIT 1",
            (f"forecast_cpi_comp_{c.code}", period, released)).fetchone()
        known = dict(vintage.as_of(conn, c.official_series, released)) \
            or dict(vintage.latest(conn, c.official_series))
        prev = known.get(prior_month(period))
        if f is None or prev is None or period not in known:
            continue
        actual = (known[period] / prev - 1) * 100
        rows.append({"component": c.code, "label": c.label, "weight": round(c.weight, 5),
                     "forecast_nsa_mom_pct": round(f[0], 3),
                     "actual_nsa_mom_pct": round(actual, 3),
                     "miss_contribution_pp": round(c.weight * (f[0] - actual), 3)})
    if not rows:
        return None
    rows.sort(key=lambda r: -abs(r["miss_contribution_pp"]))
    return {"reference_period": period[:7], "release_date": released, "rows": rows}


def ensemble_errors(leaderboard: dict) -> dict[str, float | None]:
    """Per-forecaster MAE for inverse-error ensemble weights — only once every
    forecaster has LEADERBOARD_MIN_N graded prints; equal weights until then."""
    if not leaderboard.get("weights_earned"):
        return {}
    return {k: v["mae_pp"] for k, v in leaderboard["stats"].items()}


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
    payloads["accountability_cpi.json"]["leaderboard"] = build_leaderboard(conn)
    payloads["accountability_cpi.json"]["last_print_components"] = build_component_misses(conn)
    return [_write(name, payload, out_dir, published_at) for name, payload in payloads.items()]
