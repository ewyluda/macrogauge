"""Cost-of-Living owned shelter: the marginal buyer's monthly payment.

P = L*r*(1+r)^360 / ((1+r)^360 - 1), L = 0.80 * ZHVI, r = 30yr rate / 12
(spec §5 variant table). Pure function of two store series; the result is
rebased and spliced downstream exactly like any live source."""
from bisect import bisect_right

N = 360  # 30-year fixed, monthly payments
LTV = 0.80


def payment_index(zhvi: dict[str, float], rate_pct: dict[str, float]
                  ) -> dict[str, float]:
    if not zhvi:
        return {}
    z_dates = sorted(zhvi)
    out: dict[str, float] = {}
    for d in sorted(rate_pct):
        i = bisect_right(z_dates, d)
        if i == 0:
            continue  # no home value known yet
        loan = LTV * zhvi[z_dates[i - 1]]
        r = rate_pct[d] / 100.0 / 12.0
        if r == 0:
            out[d] = loan / N
            continue
        growth = (1 + r) ** N
        out[d] = loan * r * growth / (growth - 1)
    return out
