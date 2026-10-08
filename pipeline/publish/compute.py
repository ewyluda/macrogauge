"""Writer for compute.json — the cost of a token and of a GPU-hour.

Display-only unlock (batch 4b, 2026-09-03) of the OpenRouter and vast.ai /
sfcompute series the pipeline already collects daily; never touches the
gauge engine. Two composites:

- token_index: CHAIN-LINKED equal-weight GEOMETRIC mean over the live model
  roster of each model's blended $/Mtok (BLEND_IN:BLEND_OUT tokens in:out):
  each day's move is the geometric mean of the day-over-day relatives of the
  models priced on both days, and the chained level = 100 on the chain's
  first day (the first day MIN_MEMBERS members are priced). A geometric mean keeps a cheap model's
  -50% from being drowned by an expensive model's -5%.
- gpu_index: the same over $/GPU-hour across the tracked SKUs.

Roster policy (the plan's open decision, resolved here): the roster is the
registry (config/series.json) — a member's last obs carries forward at most
its registry staleness limit (max_staleness_days), then it drops out of
`members`. Chain-linking means entry, a missed day or a permanent exit
(a deprecated model id, a retired feed) changes which relatives are averaged,
never the index level, and the index never silently keeps a dead price. A day
with fewer than MIN_MEMBERS members is null; a link with fewer than
MIN_MEMBERS members priced on both days links flat. History starts 2026-07
(first collect), stated in `history_start`.

Every table row (vast.ai and cloud) carries `stale`: its last obs is older
than the registry staleness limit, so the page shows its date and keeps it
out of the current ranges and the cheapest-quote emphasis.

Commitment and capability (Session 5, 2026-10-08): Azure cloud rows carry
`reserved` — its posted 1- and 3-year reservations per GPU-hour beside the
on-demand price — and `reserved_notes` says once why every other cloud's
cell is empty. `capability` prices a unit of compute by GPU generation: the
median fresh cloud list $/GPU-hr (and the 3-year reserved and vast.ai
medians) over dense BF16 PFLOPS from config/gpu_specs.json.
"""
import math
import statistics
from datetime import date
from pathlib import Path

from pipeline.connectors.fred import today_et
from pipeline.freshness import age_days
from pipeline.publish.util import latest_point, pct_change_daily, tail, write_json
from pipeline.registry import load_registry
from pipeline.store import vintage

# The token roster (2026-10-09): the most-used models on OpenRouter by paid
# spend (its rankings payload, week to 2026-10-07; free, stealth and preview
# models excluded), each pinned to a versioned OpenRouter id in
# config/series.json. Models turn over every few months; a deprecated id
# surfaces as per-series staleness, and a refresh is a roster change here plus
# a methodology changelog entry, reviewed monthly against the same rankings.
MODELS = [("claude_opus55", "Claude Opus 5.5"), ("gpt61_sol", "GPT-6.1 Sol"),
          ("kimi_k3", "Kimi K3"), ("glm53", "GLM-5.3"),
          ("deepseek_v41_flash", "DeepSeek V4.1 Flash"), ("gemini38_flash", "Gemini 3.8 Flash"),
          ("gpt6_luna", "GPT-6 Luna")]
# Our tier for each model, after Ramp's frontier / standard / light split of
# enterprise model spend (a16z State of Markets, Sept 2026, p.37): a label for
# the table, never an index weight.
TIERS = {"claude_opus55": "frontier", "gpt61_sol": "frontier", "kimi_k3": "standard",
         "glm53": "standard", "deepseek_v41_flash": "light", "gemini38_flash": "light",
         "gpt6_luna": "light"}
# Every earlier roster's models. Link-only members, no table rows: their
# history carries the token index up to their own last observation and never
# past it (their series left config/series.json with the change, so they are
# no longer collected), and the current models join the links as they are
# priced. No rebase: the index keeps its base, and the roster change is a
# change in which relatives are averaged, like any other entry or exit.
ROSTER_SINCE = "2026-10-09"
RETIRED_MODELS = [("gpt56_terra", "GPT-5.6 Terra"), ("claude_sonnet55", "Claude Sonnet 5.5"),
                  ("grok47", "Grok 4.7"), ("qwen38_max", "Qwen3.8 Max"),
                  ("mistral_large4", "Mistral Large 4"), ("llama4_maverick", "Llama 4 Maverick"),
                  ("gpt4o", "GPT-4o"), ("claude_sonnet", "Claude Sonnet 5"),
                  ("llama70b", "Llama 3.1 70B"), ("deepseek", "DeepSeek Chat"),
                  ("gemini_flash", "Gemini 3.5 Flash"), ("mistral_large", "Mistral Large (2024)")]
GPUS = [("vast_h100_sxm", "H100 SXM (vast.ai)"), ("vast_h200", "H200 (vast.ai)"),
        ("vast_b200", "B200 (vast.ai)"), ("vast_a100_sxm", "A100 SXM (vast.ai)"),
        ("vast_rtx4090", "RTX 4090 (vast.ai)"), ("sfc_h100", "H100 (sfcompute spot)"),
        ("vast_b300", "B300 (vast.ai)")]
# Display-only SKUs: priced in the table, kept OUT of gpu_index (vast_b300,
# first collected 2026-09-29, has under a month of history). Admitting a
# member is a roster decision, not a registry side effect.
DISPLAY_ONLY = {"vast_b300"}
# Retired SKUs: still index members (their history is chain-linked into
# gpu_index and drops out after its carry limit), but no longer a table row —
# a frozen price with a 30-day change reads as live.
RETIRED = {"sfc_h100"}
# Cloud list prices (/compute's buyer table): display-only, never index
# members. List prices move in steps a few times a year, and a marketplace
# median and a posted list price are different instruments.
# (code, provider, GPU, instance or part, GPUs per instance)
CLOUD_GPUS = [
    ("aws_h100", "AWS", "H100", "p5.48xlarge", 8), ("aws_h200", "AWS", "H200", "p5en.48xlarge", 8),
    ("aws_b200", "AWS", "B200", "p6-b200.48xlarge", 8), ("aws_b300", "AWS", "B300", "p6-b300.48xlarge", 8),
    ("aws_a100", "AWS", "A100", "p4de.24xlarge", 8),   # the 80GB part (p4d is 40GB)
    ("az_h100", "Azure", "H100", "ND96isr H100 v5", 8), ("az_h200", "Azure", "H200", "ND96isr H200 v5", 8),
    ("az_gb200", "Azure", "GB200", "ND128isr GB200 v6", 4),
    ("oci_h100", "Oracle", "H100", "per-GPU list price", 1), ("oci_h200", "Oracle", "H200", "per-GPU list price", 1),
    ("oci_b200", "Oracle", "B200", "per-GPU list price", 1), ("oci_gb200", "Oracle", "GB200", "per-GPU list price", 1),
    ("oci_b300", "Oracle", "B300", "per-GPU list price", 1), ("oci_a100", "Oracle", "A100", "per-GPU list price", 1),
    ("cw_h100", "CoreWeave", "H100", "HGX H100", 8), ("cw_h200", "CoreWeave", "H200", "HGX H200", 8),
    ("cw_b200", "CoreWeave", "B200", "HGX B200", 8), ("cw_gb200", "CoreWeave", "GB200", "GB200 NVL72", 4),
    ("cw_a100", "CoreWeave", "A100", "A100", 8),
    ("neb_h100", "Nebius", "H100", "per-GPU list price", 1),
    ("neb_h200", "Nebius", "H200", "per-GPU list price", 1),
    ("neb_b200", "Nebius", "B200", "per-GPU list price", 1),
    ("neb_b300", "Nebius", "B300", "per-GPU list price", 1),
]
# Azure's posted reservations (AZURE_GPU_RESERVED): on-demand row -> (years, series)
RESERVED = {"az_h100": [(1, "az_h100_r1y"), (3, "az_h100_r3y")],
            "az_h200": [(1, "az_h200_r1y"), (3, "az_h200_r3y")],
            "az_gb200": [(1, "az_gb200_r1y"), (3, "az_gb200_r3y")]}
# Why no other cloud has a reserved price here (checked 2026-10-08)
RESERVED_NOTES = {
    "AWS": "AWS publishes commitment prices only in a ~437 MB Savings Plan price file, which is not collected.",
    "Oracle": "Oracle's public price list is pay-as-you-go only.",
    "CoreWeave": "CoreWeave quotes reserved capacity on request.",
    "Nebius": "Nebius offers commitment discounts on request, without published prices.",
}
# The vast.ai marketplace row each GPU generation is compared with (none for GB200)
MARKET_GPU = {"A100": "vast_a100_sxm", "H100": "vast_h100_sxm", "H200": "vast_h200",
              "B200": "vast_b200", "B300": "vast_b300"}
CLOUD_REGION = {"AWS": "US East (N. Virginia)", "Azure": "East US 2", "Oracle": "list price, all regions",
                "CoreWeave": "list price", "Nebius": "list price"}
BLEND_IN, BLEND_OUT = 0.75, 0.25
MIN_MEMBERS = 3
TAIL_OBS = 90
# carry limit for a member the registry doesn't list (e.g. a retired series
# whose registry row was removed) — the registry's own 7-day market limit
DEFAULT_CARRY_DAYS = 7


def _rows(conn, code):
    return dict(vintage.latest(conn, code))


def _stale(as_of: str | None, limit: int, today: str) -> bool:
    return as_of is None or age_days(as_of, today) > limit


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


def _index(members: dict[str, dict], limits: dict[str, int] | None = None,
           retired: frozenset[str] = frozenset()) -> dict:
    """Chain-linked equal-weight geometric mean, rebased to 100 on the chain's
    first day: the first date at least MIN_MEMBERS members are priced.

    Each link's move is the geometric mean of the day-over-day relatives of
    the members present on BOTH days (a member's last obs carries forward at
    most its staleness limit, DEFAULT_CARRY_DAYS when unlisted). So a member
    entering, going missing for a day, or leaving for good (sfc_h100 retired
    after 2026-09-24) changes WHICH relatives are averaged, never the level:
    the old fixed-base mean re-averaged each member's level-vs-base over
    whoever was present, so a day missing the two dearest SKUs jumped the
    index (+7.0% 2026-09-24 -> 09-25 on membership alone). A date with fewer
    than MIN_MEMBERS present is null.

    A roster change needs no special base: the base stays the chain's first
    day and the new members simply join the links. `retired` members are
    never carried past their own last observation, so a retired model leaves
    the chain the day after it was last collected instead of dragging seven
    flat relatives into the new roster's moves. A link with fewer than
    MIN_MEMBERS members priced on both days (a changeover with no overlapping
    day, or a long outage) links FLAT, so the index carries its level across
    the gap instead of stalling at the last linked day forever."""
    dates = sorted(set().union(*(set(s) for s in members.values()))) if members else []
    limits = limits or {}
    eff = {k: _carried(s, dates, limits.get(k, DEFAULT_CARRY_DAYS))
           for k, s in members.items()}
    for k in retired & set(eff):
        last = max(members[k]) if members[k] else ""
        eff[k] = {d: v for d, v in eff[k].items() if d <= last}
    level: dict[str, float] = {}
    count: list[int] = []
    prev = None                      # last date with a chained level
    for d in dates:
        present = [k for k in members if d in eff[k]]
        count.append(len(present))
        if len(present) < MIN_MEMBERS:
            continue
        if prev is None:
            level[d] = 1.0           # chain start = base
            prev = d
            continue
        common = [k for k in present if prev in eff[k]]
        lg = (sum(math.log(eff[k][d] / eff[k][prev]) for k in common) / len(common)
              if len(common) >= MIN_MEMBERS else 0.0)   # too thin to measure: flat
        level[d] = level[prev] * math.exp(lg)
        prev = d
    if not level:
        return {"base_date": None, "history": {"dates": [], "index": [], "members": []},
                "value": None, "as_of": None, "chg_30d_pct": None}
    base_date = min(level)
    index = [None if d not in level else round(100 * level[d], 3) for d in dates]
    series = {d: v for d, v in zip(dates, index) if v is not None}
    as_of, value = latest_point(series, nd=3)
    return {"base_date": base_date,
            "history": {"dates": dates, "index": index, "members": count},
            "value": value, "as_of": as_of,
            "chg_30d_pct": pct_change_daily(series, as_of, 30) if as_of else None}


def _model_rows(conn):
    rows, members = [], {}
    for key, _ in RETIRED_MODELS:
        blended = _blended(_rows(conn, f"or_{key}_in"), _rows(conn, f"or_{key}_out"))
        if blended:
            members[key] = blended
    for key, label in MODELS:
        inp, out = _rows(conn, f"or_{key}_in"), _rows(conn, f"or_{key}_out")
        blended = _blended(inp, out)
        as_of, value = latest_point(blended)
        if as_of is not None:
            members[key] = blended
        rows.append({"key": key, "label": label, "tier": TIERS[key],
                     "in_usd_mtok": None if as_of is None else round(inp[as_of], 4),
                     "out_usd_mtok": None if as_of is None else round(out[as_of], 4),
                     "blended_usd_mtok": value, "as_of": as_of,
                     "chg_30d_pct": pct_change_daily(blended, as_of, 30) if as_of else None,
                     "tail": tail(blended, TAIL_OBS)})
    return rows, members


def _gpu_rows(conn, limits: dict, today: str):
    rows, members = [], {}
    for code, label in GPUS:
        obs = _rows(conn, code)
        as_of, value = latest_point(obs)
        in_index = code not in DISPLAY_ONLY
        if as_of is not None and in_index:
            members[code] = obs
        if code in RETIRED:
            continue
        rows.append({"code": code, "label": label, "usd_per_gpu_hr": value, "as_of": as_of,
                     "chg_30d_pct": pct_change_daily(obs, as_of, 30) if as_of else None,
                     "tail": tail(obs, TAIL_OBS), "in_index": in_index,
                     "stale": _stale(as_of, limits[code], today)})
    return rows, members


def _reserved(conn, code: str, on_demand: float | None, staleness: dict, today: str) -> list[dict]:
    out = []
    for years, rcode in RESERVED[code]:
        as_of, value = latest_point(_rows(conn, rcode))
        out.append({"term_years": years, "usd_per_gpu_hr": value, "as_of": as_of,
                    "discount_pct": None if value is None or not on_demand
                    else round(100 * (1 - value / on_demand), 1),
                    "stale": _stale(as_of, staleness.get(rcode, DEFAULT_CARRY_DAYS), today)})
    return out


def _cloud_rows(conn, staleness: dict, today: str):
    rows = []
    for code, provider, gpu, instance, per in CLOUD_GPUS:
        obs = _rows(conn, code)
        as_of, value = latest_point(obs)
        row = {"code": code, "provider": provider, "gpu": gpu, "instance": instance,
               "gpus_per_instance": per, "region": CLOUD_REGION[provider],
               "usd_per_gpu_hr": value,
               "usd_per_instance_hr": None if value is None else round(value * per, 2),
               "as_of": as_of,
               "chg_30d_pct": pct_change_daily(obs, as_of, 30) if as_of else None,
               "stale": _stale(as_of, staleness.get(code, DEFAULT_CARRY_DAYS), today)}
        if code in RESERVED:
            row["reserved"] = _reserved(conn, code, value, staleness, today)
        rows.append(row)
    return rows


def _median(vals: list[float]) -> float | None:
    return round(statistics.median(vals), 4) if vals else None


def _per_pflop(usd: float | None, pflops: float) -> float | None:
    return None if usd is None else round(usd / pflops, 2)


def _capability(specs, cloud_rows: list[dict], gpu_rows: list[dict]) -> dict:
    """$ per dense-BF16 PFLOP-hour by GPU generation. Only FRESH quotes count:
    the cloud list median over providers, the 3-year reservation median (Azure
    alone today) and the vast.ai marketplace median for the same GPU."""
    market = {g["code"]: g for g in gpu_rows}
    rows = []
    for gpu, spec in specs.gpus.items():
        pflops = spec.dense_bf16_tflops / 1000
        cloud = [r for r in cloud_rows if r["gpu"] == gpu]
        lst = [r["usd_per_gpu_hr"] for r in cloud if r["usd_per_gpu_hr"] is not None and not r["stale"]]
        res3 = [t["usd_per_gpu_hr"] for r in cloud for t in r.get("reserved", [])
                if t["term_years"] == 3 and t["usd_per_gpu_hr"] is not None and not t["stale"]]
        m = market.get(MARKET_GPU.get(gpu, ""))
        mkt = m["usd_per_gpu_hr"] if m and not m["stale"] else None
        list_med, res_med = _median(lst), _median(res3)
        rows.append({"gpu": gpu, "dense_bf16_tflops": spec.dense_bf16_tflops, "spec_url": spec.url,
                     "list_median_usd_per_gpu_hr": list_med, "list_quotes": len(lst),
                     "list_usd_per_pflop_hr": _per_pflop(list_med, pflops),
                     "reserved_3y_usd_per_pflop_hr": _per_pflop(res_med, pflops),
                     "market_usd_per_pflop_hr": _per_pflop(mkt, pflops)})
    return {"basis": specs.basis, "basis_note": specs.basis_note, "publisher": specs.publisher,
            "as_of_curated": specs.as_of_curated, "by_generation": rows}


def _limits(staleness: dict[str, int]) -> tuple[dict, dict]:
    """Per-member carry limits off the registry's max_staleness_days. A token
    member is two series (in/out); it carries only as long as BOTH would."""
    model_lim = {k: min(staleness.get(f"or_{k}_in", DEFAULT_CARRY_DAYS),
                        staleness.get(f"or_{k}_out", DEFAULT_CARRY_DAYS))
                 for k, _ in MODELS + RETIRED_MODELS}
    gpu_lim = {c: staleness.get(c, DEFAULT_CARRY_DAYS) for c, _ in GPUS}
    return model_lim, gpu_lim


def build(conn, staleness: dict[str, int] | None = None, today: str | None = None,
          specs=None) -> dict:
    """staleness: {series_code: max_staleness_days}; None reads the registry.
    today: the publish date the table rows' `stale` flags are judged against.
    specs: the gpu_specs table; None publishes without `capability`."""
    if staleness is None:
        _, series = load_registry()
        staleness = {s.code: s.max_staleness_days for s in series}
    today = today or today_et()
    model_lim, gpu_lim = _limits(staleness)
    model_rows, model_members = _model_rows(conn)
    gpu_rows, gpu_members = _gpu_rows(conn, gpu_lim, today)
    all_dates = [d for m in list(model_members.values()) + list(gpu_members.values()) for d in m]
    cloud_rows = _cloud_rows(conn, staleness, today)
    extra = {} if specs is None else {"capability": _capability(specs, cloud_rows, gpu_rows)}
    return {"history_start": min(all_dates) if all_dates else None,
            "blend": {"in": BLEND_IN, "out": BLEND_OUT, "min_members": MIN_MEMBERS,
                      "method": "chain-linked equal-weight geometric mean: each day's move "
                                "is the geometric mean of the day-over-day price relatives "
                                "of the members priced on both days (a member's last price "
                                "carries at most its staleness limit; a retired model's "
                                "never past its last observation), = 100 on the chain's "
                                "first day; a link with fewer than the minimum members "
                                "priced on both days is flat"},
            "models": model_rows,
            "token_index": _index(model_members, model_lim,
                                  retired=frozenset(k for k, _ in RETIRED_MODELS)),
            "token_roster": {"since": ROSTER_SINCE, "retired": [label for _, label in RETIRED_MODELS]},
            "gpus": gpu_rows, "gpu_index": _index(gpu_members, gpu_lim),
            "cloud_gpus": cloud_rows, "reserved_notes": RESERVED_NOTES, **extra}


def write(payload: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **payload}, out_dir, "compute.json")
