"""Writer for compute.json — the cost of a token and of a GPU-hour.

Display-only unlock (batch 4b, 2026-09-03) of the OpenRouter and vast.ai /
sfcompute series the pipeline already collects daily; never touches the
gauge engine. Two composites:

- token_index: CHAIN-LINKED equal-weight GEOMETRIC mean over the live model
  roster of each model's blended $/Mtok (BLEND_IN:BLEND_OUT tokens in:out):
  each day's move is the geometric mean of the day-over-day relatives of the
  models priced on both days, and the chained level is rebased so the first
  day every member has a value = 100. A geometric mean keeps a cheap model's
  -50% from being drowned by an expensive model's -5%.
- gpu_index: the same over $/GPU-hour across the tracked SKUs.

Roster policy (the plan's open decision, resolved here): the roster is the
registry (config/series.json) — a member's last obs carries forward at most
its registry staleness limit (max_staleness_days), then it drops out of
`members`. Chain-linking means entry, a missed day or a permanent exit
(a deprecated model id, a retired feed) changes which relatives are averaged,
never the index level, and the index never silently keeps a dead price. A day
with fewer than MIN_MEMBERS members is null. History starts 2026-07 (first
collect), stated in `history_start`.
"""
import math
from datetime import date
from pathlib import Path

from pipeline.publish.util import latest_point, pct_change_daily, tail, write_json
from pipeline.registry import load_registry
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
# carry limit for a member the registry doesn't list (e.g. a retired series
# whose registry row was removed) — the registry's own 7-day market limit
DEFAULT_CARRY_DAYS = 7


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _blended(inp: dict, out: dict) -> dict:
    return {d: BLEND_IN * inp[d] + BLEND_OUT * out[d] for d in inp if d in out}


def _carried(obs: dict, dates: list[str], limit_days: int) -> dict:
    """The member's value on every grid date: its last obs at/before the date,
    carried forward at most `limit_days` (its registry staleness limit). Past
    that it is absent — a dead price is never carried indefinitely."""
    out, own = {}, sorted(obs)
    j, last = 0, None
    for d in dates:
        while j < len(own) and own[j] <= d:
            last = own[j]
            j += 1
        if last is None or obs[last] <= 0:
            continue
        if (date.fromisoformat(d) - date.fromisoformat(last)).days <= limit_days:
            out[d] = obs[last]
    return out


def _index(members: dict[str, dict], limits: dict[str, int] | None = None) -> dict:
    """Chain-linked equal-weight geometric mean, rebased to 100 on the first
    date on which EVERY member has a value.

    Each link's move is the geometric mean of the day-over-day relatives of
    the members present on BOTH days (a member's last obs carries forward at
    most its staleness limit, DEFAULT_CARRY_DAYS when unlisted). So a member
    entering, going missing for a day, or leaving for good (sfc_h100 retired
    after 2026-09-24) changes WHICH relatives are averaged, never the level:
    the old fixed-base mean re-averaged each member's level-vs-base over
    whoever was present, so a day missing the two dearest SKUs jumped the
    index (+7.0% 2026-09-24 -> 09-25 on membership alone). A date with fewer
    than MIN_MEMBERS present is null and the next date links back to the last
    non-null one."""
    dates = sorted(set().union(*(set(s) for s in members.values()))) if members else []
    full = [d for d in dates if all(d in s for s in members.values())]
    if not full:
        return {"base_date": None, "history": {"dates": [], "index": [], "members": []},
                "value": None, "as_of": None, "chg_30d_pct": None}
    base_date = full[0]
    limits = limits or {}
    eff = {k: _carried(s, dates, limits.get(k, DEFAULT_CARRY_DAYS))
           for k, s in members.items()}
    level: dict[str, float] = {}
    count: list[int] = []
    prev = None                      # last date with a chained level
    for d in dates:
        present = [k for k in members if d in eff[k]]
        count.append(len(present))
        if len(present) < MIN_MEMBERS:
            continue
        if prev is None:
            level[d] = 1.0           # chain start
            prev = d
            continue
        common = [k for k in present if prev in eff[k]]
        if len(common) < MIN_MEMBERS:
            continue                 # link too thin: null, keep prev
        lg = sum(math.log(eff[k][d] / eff[k][prev]) for k in common) / len(common)
        level[d] = level[prev] * math.exp(lg)
        prev = d
    base = level.get(base_date)
    index = [None if base is None or d not in level else round(100 * level[d] / base, 3)
             for d in dates]
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


def _limits(staleness: dict[str, int] | None) -> tuple[dict, dict]:
    """Per-member carry limits off the registry's max_staleness_days. A token
    member is two series (in/out); it carries only as long as BOTH would."""
    if staleness is None:
        _, series = load_registry()
        staleness = {s.code: s.max_staleness_days for s in series}
    model_lim = {k: min(staleness.get(f"or_{k}_in", DEFAULT_CARRY_DAYS),
                        staleness.get(f"or_{k}_out", DEFAULT_CARRY_DAYS))
                 for k, _ in MODELS}
    gpu_lim = {c: staleness.get(c, DEFAULT_CARRY_DAYS) for c, _ in GPUS}
    return model_lim, gpu_lim


def build(conn, staleness: dict[str, int] | None = None) -> dict:
    """staleness: {series_code: max_staleness_days}; None reads the registry."""
    model_rows, model_members = _model_rows(conn)
    gpu_rows, gpu_members = _gpu_rows(conn)
    model_lim, gpu_lim = _limits(staleness)
    all_dates = [d for m in list(model_members.values()) + list(gpu_members.values()) for d in m]
    return {"history_start": min(all_dates) if all_dates else None,
            "blend": {"in": BLEND_IN, "out": BLEND_OUT, "min_members": MIN_MEMBERS,
                      "method": "chain-linked equal-weight geometric mean: each day's move "
                                "is the geometric mean of the day-over-day price relatives "
                                "of the members priced on both days (a member's last price "
                                "carries at most its staleness limit), rebased to 100 on "
                                "the first day every member was priced"},
            "models": model_rows, "token_index": _index(model_members, model_lim),
            "gpus": gpu_rows, "gpu_index": _index(gpu_members, gpu_lim)}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "compute.json")
