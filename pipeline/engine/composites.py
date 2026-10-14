"""Transparent Phase-4 macro composite calculations."""
from __future__ import annotations

import statistics

from pipeline.dates import months_back


def _is_monthly(series: list[tuple[str, float]]) -> bool:
    if len(series) < 2 or any(d[8:10] != "01" for d, _ in series):
        return False
    steps = [months_back(b, 1) == a for (a, _), (b, _) in zip(series, series[1:])]
    return sum(steps) > len(steps) / 2  # mostly one-month steps: not quarterly


def momentum(series: list[tuple[str, float]], periods: int = 3,
             percent: bool = True) -> list[tuple[str, float]]:
    """Period change series, retaining the end observation date. A monthly
    series steps back `periods` CALENDAR months (BLS never published October
    2025 — a row count would bridge it as a longer change); daily and weekly
    series count observations."""
    by_date = dict(series) if _is_monthly(series) else None
    out = []
    for i in range(periods, len(series)):
        if by_date is not None:
            prior = by_date.get(months_back(series[i][0], periods))
            if prior is None:
                continue
            current = series[i][1]
        else:
            current, prior = series[i][1], series[i - periods][1]
        if percent:
            if prior <= 0:
                continue  # % change off a non-positive base flips sign/explodes
            value = (current / prior - 1) * 100
        else:
            value = current - prior
        out.append((series[i][0], value))
    return out


def latest_z(series: list[tuple[str, float]], periods: int = 3,
             direction: int = 1, percent: bool = True) -> dict | None:
    changes = momentum(series, periods, percent)
    if len(changes) < 3:
        return None
    values = [value for _, value in changes]
    # Robust baseline (median/MAD, 1.4826 = normal-consistency factor so the
    # ±2.5 clamp keeps its calibration): one outlier era poisons mean/stdev
    # for the whole history -- March-2020 claims (+2640%) inflated ICSA's
    # stdev to 249 so flat prints read as mild heating and a real 30% surge
    # would have scored z ~ 0.
    center = statistics.median(values)
    mad = statistics.median(abs(v - center) for v in values)
    z = 0.0 if mad == 0 else (values[-1] - center) / (1.4826 * mad)
    signed = max(-2.5, min(2.5, z * direction))
    return {"as_of": changes[-1][0], "momentum": round(values[-1], 4),
            "z": round(signed, 4)}


def heat_check(indicators: list[dict], group_weights: dict[str, float]) -> dict:
    """Weighted group z-score mapped to the design's -100..100 scale."""
    rows = [row for row in indicators if row.get("z") is not None]
    groups = {}
    for group, weight in group_weights.items():
        members = [row for row in rows if row["group"] == group]
        expected = sum(row["group"] == group for row in indicators)
        if members:
            groups[group] = {"z": sum(row["z"] for row in members) / len(members),
                             "weight": weight, "available": len(members),
                             "expected": expected,
                             "active_weight": weight * len(members) / expected}
    active_weight = sum(row["active_weight"] for row in groups.values())
    # No data is not a neutral economy: 0.0 reads as "perfectly balanced",
    # so a fully dark heat check publishes null (as stress_index does).
    if not active_weight:
        return {"score": None, "coverage_pct": 0.0, "groups": groups,
                "indicators": rows}
    score = (sum(row["z"] * row["active_weight"] for row in groups.values()) /
             active_weight * 50)
    return {"score": round(max(-100, min(100, score)), 1),
            "coverage_pct": round(active_weight, 1), "groups": groups,
            "indicators": rows}


def percentile(value: float, history: list[float]) -> float:
    if not history:
        raise ValueError("percentile history is empty")
    return 100 * sum(item <= value for item in history) / len(history)


def stress_index(indicators: list[dict]) -> dict:
    """Direction-adjusted weighted percentile consumer stress score."""
    rows, weighted, active = [], 0.0, 0.0
    for item in indicators:
        history = item.get("history", [])
        if not history:
            continue
        score = percentile(item["value"], history)
        if item.get("direction", 1) < 0:
            score = 100 - score
        rows.append({**{k: v for k, v in item.items() if k != "history"},
                     "score": round(score, 1)})
        weighted += score * item["weight"]
        active += item["weight"]
    return {"score": None if not active else round(weighted / active, 1),
            "coverage_pct": round(active, 1), "indicators": rows}


def recession_composite(signals: list[dict]) -> dict:
    """Equal-weight share of named binary recession rules currently triggered."""
    available = [signal for signal in signals if signal.get("triggered") is not None]
    triggered = sum(bool(signal["triggered"]) for signal in available)
    return {"probability_pct": None if not available else
            round(triggered / len(available) * 100, 1),
            "triggered": triggered, "available": len(available), "signals": signals}
