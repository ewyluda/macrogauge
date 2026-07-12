"""Month/date helpers — the single source of truth.

Consolidates the former official._months_back, backtest.prior_month,
nowcast.models._month_start/_previous_month/_next_month/_monthly_changes and
connectors.util.month_first (now a re-export). Monthly rows are YYYY-MM-01.
"""


def month_first(period: str) -> str:
    """'2026-05' or '2026-05-31' -> '2026-05-01'."""
    return f"{period[:7]}-01"


def months_back(obs_date: str, n: int) -> str:
    """First-of-month date n months before obs_date (n may be negative)."""
    year, month = int(obs_date[:4]), int(obs_date[5:7])
    total = year * 12 + (month - 1) - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}-01"


def prior_month(obs_date: str) -> str:
    return months_back(obs_date, 1)


def next_month(obs_date: str) -> str:
    return months_back(obs_date, -1)


def monthly_changes(levels: dict[str, float]) -> dict[str, float]:
    """Percent change between calendar-adjacent months only: a pair spanning
    a missing month (the never-published 2025-10 print) is a 2-month change,
    not a MoM — it must neither grade a target nor enter model inputs.
    Preserves the input's iteration order."""
    out = {}
    for month, value in levels.items():
        prior = prior_month(month)
        if levels.get(prior):
            out[month] = (value / levels[prior] - 1) * 100
    return out
