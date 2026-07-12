"""Vintage-true CPI backtest and live-forecast grading."""
from datetime import date, timedelta

from pipeline.dates import monthly_changes, prior_month  # noqa: F401 (prior_month re-exported for phase3)
from pipeline.store import vintage


def _mom(rows):
    """MoM keyed by obs_date from (obs_date, value, ...) tuples — see
    dates.monthly_changes for the month-adjacency guard."""
    return monthly_changes({r[0]: r[1] for r in rows})


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
