"""Transparent Phase-4 macro composite calculations."""
from __future__ import annotations

import statistics


def momentum(series: list[tuple[str, float]], periods: int = 3,
             percent: bool = True) -> list[tuple[str, float]]:
    """Period change series, retaining the end observation date."""
    out = []
    for i in range(periods, len(series)):
        current, prior = series[i][1], series[i - periods][1]
        if percent and prior:
            value = (current / prior - 1) * 100
        else:
            value = current - prior
        out.append((series[i][0], value))
    return out


def latest_z(series: list[tuple[str, float]], periods: int = 3,
             direction: int = 1) -> dict | None:
    changes = momentum(series, periods)
    if len(changes) < 3:
        return None
    values = [value for _, value in changes]
    stdev = statistics.stdev(values)
    z = 0.0 if stdev == 0 else (values[-1] - statistics.mean(values)) / stdev
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
    score = (0.0 if not active_weight else
             sum(row["z"] * row["active_weight"] for row in groups.values()) /
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
        rows.append({**item, "score": round(score, 1)})
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
