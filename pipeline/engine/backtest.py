"""Vintage-true CPI backtest and live-forecast grading."""
from datetime import date, timedelta

from pipeline.dates import monthly_changes
from pipeline.store import vintage


def _mom(rows):
    """MoM keyed by obs_date from (obs_date, value, ...) tuples — see
    dates.monthly_changes for the month-adjacency guard."""
    return monthly_changes({r[0]: r[1] for r in rows})


def cpi_walk_forward(conn, min_history: int = 3) -> dict:
    releases = sorted(vintage.first_releases(conn, "CPIAUCNS"),
                      key=lambda r: r[2])  # walk in release order
    actual_mom = _mom(sorted(releases))
    # One pass over all vintages instead of an O(months^2) as_of scan per
    # release: rows sorted by vintage feed an incremental latest-known view.
    all_rows = conn.execute(
        "SELECT obs_date, value, vintage_date FROM observations "
        "WHERE series_code = ? ORDER BY vintage_date, rowid",
        ("CPIAUCNS",)).fetchall()
    known: dict[str, float] = {}
    rows, i = [], 0
    for obs_date, actual, release_date in releases:
        cutoff = (date.fromisoformat(release_date) - timedelta(days=1)).isoformat()
        while i < len(all_rows) and all_rows[i][2] <= cutoff:
            known[all_rows[i][0]] = all_rows[i][1]
            i += 1
        known_mom = list(monthly_changes(dict(sorted(known.items()))).values())
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
