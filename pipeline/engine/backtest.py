"""Vintage-true CPI backtest and live-forecast grading."""
from datetime import date, timedelta

from pipeline.store import vintage


def _mom(rows):
    out = {}
    for i in range(1, len(rows)):
        d, v = rows[i][0], rows[i][1]
        prior = rows[i - 1][1]
        if prior:
            out[d] = (v / prior - 1) * 100
    return out


def cpi_walk_forward(conn, min_history: int = 3) -> dict:
    releases = vintage.first_releases(conn, "CPIAUCNS")
    actual_mom = _mom(releases)
    rows = []
    for obs_date, actual, release_date in releases:
        cutoff = (date.fromisoformat(release_date) - timedelta(days=1)).isoformat()
        known = vintage.as_of(conn, "CPIAUCNS", cutoff)
        known_mom = list(_mom(known).values())
        if len(known_mom) < min_history or obs_date not in actual_mom:
            continue
        ours = sum(known_mom[-3:]) / 3
        naive = known_mom[-1]
        actual_change = actual_mom[obs_date]
        rows.append({"target_month": obs_date[:7], "cutoff": cutoff,
                     "release_date": release_date, "badge": "BT",
                     "forecast_mom_pct": round(ours, 2),
                     "naive_mom_pct": round(naive, 2),
                     "actual_mom_pct": round(actual_change, 2),
                     "error_pp": round(ours - actual_change, 2)})
    def mae(key):
        return (None if not rows else
                round(sum(abs(r[key] - r["actual_mom_pct"]) for r in rows) / len(rows), 3))
    return {"model": "cpi_3m_vintage_true", "rows": rows,
            "summary": {"observations": len(rows), "mae_pp": mae("forecast_mom_pct"),
                        "naive_mae_pp": mae("naive_mom_pct")}}
