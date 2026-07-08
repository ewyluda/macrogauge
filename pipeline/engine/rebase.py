"""Engine stage 1: index any series so its base-month mean = 100.

Rebasing makes price levels ($/gal, cents/kWh, $ rent) unitless and
comparable. Anchor = mean of the series' observations dated within the base
month (robust for weekly series). A series with no base-month rows anchors on
its FIRST month instead — late starters are spliced and re-anchored
downstream, and short-history fixture stores must still run; in production
every basket series has 2017+ history, so the fallback never fires.
"""

BASE_MONTH = "2018-01"


def rebase(series: dict[str, float], base_month: str = BASE_MONTH) -> dict[str, float]:
    if not series:
        raise ValueError("rebase: empty series")
    months = sorted({d[:7] for d in series})
    anchor_month = base_month if base_month in months else months[0]
    vals = [v for d, v in series.items() if d[:7] == anchor_month]
    anchor = sum(vals) / len(vals)
    if anchor == 0:
        raise ValueError("rebase: zero anchor value")
    return {d: v / anchor * 100 for d, v in series.items()}
