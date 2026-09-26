"""Derived official series computed from the store — today one: the CPI-U
residual that backs the basket's "other" component.

Why: until 2026-09-26 "other" (the ~18% of CPI outside the 13 named
components — household furnishings, motor-vehicle insurance and repair,
airfares, water/sewer, lodging, alcohol, tobacco, personal care, ...) rode
CUUR0000SAG "Other goods and services", a ~3% tobacco-and-personal-care
aggregate. With the seed weights, the 14 official component YoYs rebuilt
Aug-2026 CPI at 3.58% vs the actual 3.40% — a +0.19pp basket bias larger
than the gauge-vs-official gap the homepage reports.

The residual is exact Laspeyres arithmetic on BLS's own aggregation. For a
month t in year Z, with base d0 = December of Z-1 and RI = BLS relative
importance for that December (config/cpi_relative_importance.json):

    100 * CPI_t / CPI_d0 = sum_i RI_i * I_i,t / I_i,d0 + RI_other * R_t

so R_t (the residual's relative to d0) is solved from CPI-U and the 13
component indexes, and chained December to December into a level index
(December 2016 = 100). December relative-importance tables carry the weights
in force for the following year, so the identity holds up to the 3-decimal
rounding of the published RI.

Injected into the in-memory store connection (source DERIVED) right after
vintage.load, so every consumer that reads official series — gauge, gap
table, quilt, nowcast, outlook — sees it like any other series.
"""
import json
from pathlib import Path

from pipeline.store import vintage

RI_PATH = Path(__file__).parent.parent / "config" / "cpi_relative_importance.json"
RESIDUAL_CODE = "cpi_other_residual"
RESIDUAL_COMPONENT = "other"  # basket component the residual backs
HEADLINE = "CPIAUCNS"


def load_ri(path: Path | None = None) -> dict[int, dict[str, float]]:
    raw = json.loads((path or RI_PATH).read_text())["december"]
    out = {}
    for year, weights in raw.items():
        w = dict(weights)
        w["other"] = 100.0 - sum(weights.values())
        out[int(year)] = w
    return out


def residual_index(series: dict[str, dict[str, float]], components: dict[str, str],
                   ri: dict[int, dict[str, float]]) -> dict[str, float]:
    """{obs_date: level} for the residual. `series` maps store code ->
    {obs_date: value}; `components` maps basket code -> official store code
    for the 13 named components (not "other"). Months missing any input
    (the never-published 2025-10) are skipped; a missing December base breaks
    the chain until the next complete December."""
    cpi = series.get(HEADLINE, {})
    out: dict[str, float] = {}

    def rel(t: str, b: str, w: dict[str, float]) -> float:
        named = sum(w[code] * series[s][t] / series[s][b] for code, s in components.items())
        return (100.0 * cpi[t] / cpi[b] - named) / w["other"]

    for t in sorted(cpi):
        w = ri.get(int(t[:4]) - 1)
        if w is None:
            continue
        d0 = f"{int(t[:4]) - 1}-12-01"
        # Exact base: the prior December (its RI table is the weight set in
        # force for t). Fallbacks — only where the store lacks that December
        # (short test stores): the latest earlier residual month, else anchor
        # the chain at t = 100.
        if d0 in out:
            base = d0
        else:
            earlier = [m for m in out if m < t]
            base = max(earlier) if earlier else None
        try:
            if base is None:
                if d0 in cpi:
                    rel(t, d0, w)  # inputs complete at the December base?
                    out[d0] = 100.0
                    base = d0
                else:
                    for code in components.values():
                        series[code][t]  # noqa: B018 — inputs present at t?
                    out[t] = 100.0
                    continue
            out[t] = out[base] * rel(t, base, w)
        except (KeyError, ZeroDivisionError):
            continue  # a missing input month (the never-published 2025-10)
    return out


def inject(conn, basket_components, ri_path: Path | None = None) -> int:
    """Compute the residual from `conn`'s latest values and insert it as
    store rows (source DERIVED). Each row's vintage is the latest vintage
    among that month's inputs. Returns rows inserted."""
    components = {c.code: c.official_series for c in basket_components
                  if c.code != RESIDUAL_COMPONENT}
    codes = [HEADLINE, *components.values()]
    series = {code: dict(vintage.latest(conn, code)) for code in codes}
    levels = residual_index(series, components, load_ri(ri_path))
    if not levels:
        return 0
    vint = {}
    for code in codes:
        for d, vd in conn.execute(
                "SELECT obs_date, MAX(vintage_date) FROM observations "
                "WHERE series_code = ? GROUP BY obs_date", (code,)).fetchall():
            vint[d] = max(vint.get(d, vd), vd)
    conn.executemany("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)",
                     [(RESIDUAL_CODE, d, round(v, 4), vint[d], "DERIVED", "MODEL")
                      for d, v in levels.items()])
    conn.commit()
    return len(levels)


def ensure(conn, basket_components=None) -> int:
    """inject() once per connection — engine entry points call this so any
    caller holding a raw vintage.load() connection gets the residual."""
    if conn.execute("SELECT 1 FROM observations WHERE series_code = ? LIMIT 1",
                    (RESIDUAL_CODE,)).fetchone():
        return 0
    if basket_components is None:
        from pipeline import basket as basket_mod
        basket_components = basket_mod.load_basket()[1]
    return inject(conn, basket_components)


def effective_weights(conn, basket_components, month: str,
                      ri_path: Path | None = None) -> dict[str, float] | None:
    """BLS relative importance price-updated to `month` (YYYY-MM), normalized
    to sum 1 over the basket — the expenditure shares in force at that month:

        w_i(m) ∝ RI_i,Dec(Y) * I_i,m / I_i,Dec(Y),   Y = year(m) - 1

    Used as the headline's YoY weights at the YoY base month (t - 12): a
    Σ w·yoy decomposition is exact within a weight year with these, where the
    December table itself missed Aug-2026 CPI by -0.08pp and the seed weights
    by +0.19pp. None when any input is missing at `month` (callers keep the
    configured December weights)."""
    ensure(conn, basket_components)
    ri = load_ri(ri_path)
    year = int(month[:4]) - 1
    w = ri.get(year)
    if w is None:
        return None
    d0, m = f"{year}-12-01", f"{month}-01"
    raw = {}
    for c in basket_components:
        s = dict(vintage.latest(conn, c.official_series))
        if d0 not in s or m not in s or c.code not in w or not s[d0]:
            return None
        raw[c.code] = w[c.code] * s[m] / s[d0]
    total = sum(raw.values())
    return {k: v / total for k, v in raw.items()}
