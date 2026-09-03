"""Writer for compute.json — the cost of a token and of a GPU-hour.

Display-only unlock (batch 4b, 2026-09-03) of the OpenRouter and vast.ai /
sfcompute series the pipeline already collects daily; never touches the
gauge engine. Two composites:

- token_index: equal-weight GEOMETRIC mean over the live model roster of each
  model's blended $/Mtok (BLEND_IN:BLEND_OUT tokens in:out), rebased so the
  first day every member has a value = 100. A geometric mean keeps a cheap
  model's -50% from being drowned by an expensive model's -5%.
- gpu_index: the same over $/GPU-hour across the tracked SKUs.

Roster policy (the plan's open decision, resolved here): the roster is the
registry (config/series.json) — a deprecated model id goes stale (7d limit),
drops out of `members` for the days it lacks a value, and the mean
renormalizes over the members present (blend.py's rule), so the index never
silently keeps a dead price. A day with fewer than MIN_MEMBERS members is
null. History starts 2026-07 (first collect), stated in `history_start`.
"""
import math
from pathlib import Path

from pipeline.publish.util import latest_point, pct_change_daily, tail, write_json
from pipeline.store import vintage

MODELS = [("gpt4o", "GPT-4o"), ("claude_sonnet", "Claude Sonnet"),
          ("llama70b", "Llama 3.1 70B"), ("deepseek", "DeepSeek"),
          ("gemini_flash", "Gemini Flash"), ("mistral_large", "Mistral Large")]
GPUS = [("vast_h100_sxm", "H100 SXM (vast.ai)"), ("vast_h200", "H200 (vast.ai)"),
        ("vast_b200", "B200 (vast.ai)"), ("vast_a100_sxm", "A100 SXM (vast.ai)"),
        ("vast_rtx4090", "RTX 4090 (vast.ai)"), ("sfc_h100", "H100 (sfcompute spot)")]
BLEND_IN, BLEND_OUT = 0.75, 0.25
MIN_MEMBERS = 3
TAIL_OBS = 90


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _blended(inp: dict, out: dict) -> dict:
    return {d: BLEND_IN * inp[d] + BLEND_OUT * out[d] for d in inp if d in out}


def _index(members: dict[str, dict]) -> dict:
    """Equal-weight geometric mean, renormalized over present members, rebased
    to the first date on which EVERY member has a value."""
    dates = sorted(set().union(*(set(s) for s in members.values()))) if members else []
    full = [d for d in dates if all(d in s for s in members.values())]
    if not full:
        return {"base_date": None, "history": {"dates": [], "index": [], "members": []},
                "value": None, "as_of": None, "chg_30d_pct": None}
    base_date = full[0]
    logs_base = {k: math.log(s[base_date]) for k, s in members.items()}
    index, count = [], []
    for d in dates:
        present = [k for k, s in members.items() if d in s and s[d] > 0]
        if len(present) < MIN_MEMBERS:
            index.append(None)
            count.append(len(present))
            continue
        # each member relative to its own base, then geometric mean -> a
        # member dropping out changes the average, never the base
        lg = sum(math.log(members[k][d]) - logs_base[k] for k in present) / len(present)
        index.append(round(100 * math.exp(lg), 3))
        count.append(len(present))
    series = {d: v for d, v in zip(dates, index) if v is not None}
    as_of, value = latest_point(series, nd=3)
    return {"base_date": base_date,
            "history": {"dates": dates, "index": index, "members": count},
            "value": value, "as_of": as_of,
            "chg_30d_pct": pct_change_daily(series, as_of, 30) if as_of else None}


def _model_rows(conn):
    rows, members = [], {}
    for key, label in MODELS:
        inp, out = _rows(conn, f"or_{key}_in"), _rows(conn, f"or_{key}_out")
        blended = _blended(inp, out)
        as_of, value = latest_point(blended)
        if as_of is not None:
            members[key] = blended
        rows.append({"key": key, "label": label,
                     "in_usd_mtok": None if as_of is None else round(inp[as_of], 4),
                     "out_usd_mtok": None if as_of is None else round(out[as_of], 4),
                     "blended_usd_mtok": value, "as_of": as_of,
                     "chg_30d_pct": pct_change_daily(blended, as_of, 30) if as_of else None,
                     "tail": tail(blended, TAIL_OBS)})
    return rows, members


def _gpu_rows(conn):
    rows, members = [], {}
    for code, label in GPUS:
        obs = _rows(conn, code)
        as_of, value = latest_point(obs)
        if as_of is not None:
            members[code] = obs
        rows.append({"code": code, "label": label, "usd_per_gpu_hr": value, "as_of": as_of,
                     "chg_30d_pct": pct_change_daily(obs, as_of, 30) if as_of else None,
                     "tail": tail(obs, TAIL_OBS)})
    return rows, members


def build(conn) -> dict:
    model_rows, model_members = _model_rows(conn)
    gpu_rows, gpu_members = _gpu_rows(conn)
    all_dates = [d for m in list(model_members.values()) + list(gpu_members.values()) for d in m]
    return {"history_start": min(all_dates) if all_dates else None,
            "blend": {"in": BLEND_IN, "out": BLEND_OUT, "min_members": MIN_MEMBERS,
                      "method": "equal-weight geometric mean of each member relative to its "
                                "own base-date price; renormalized over members present"},
            "models": model_rows, "token_index": _index(model_members),
            "gpus": gpu_rows, "gpu_index": _index(gpu_members)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "compute.json")
