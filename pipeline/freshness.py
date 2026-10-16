"""Freshness classification — one verdict per series, shared by qa + methodology.

A series is *fresh* when its latest observation is within `max_staleness_days`
of today. Some series are legitimately absent for longer than that and must
not read as regressions: a source that suppresses small cells (QCEW
disclosure), publishes a series only in months with enough quotes (BLS
average prices), or has stopped publishing it altogether. Those carry an
explicit `absence` policy in the registry (`registry.Absence`) and are
classified here into their own bucket — never silently folded into "fresh",
never counted as "stale".

Every policy is verified, not trusted: it fails when it has passed its
`review_by` date, when a `suppressed`/`discontinued` series prints again
(the policy is now wrong — remove it), or when an `intermittent` series stays
absent longer than its `max_absence_days`. Counts are always derived from the
registry, never hardcoded.
"""
from datetime import date

from pipeline.registry import Absence

FRESH = "fresh"
STALE = "stale"                      # past max_staleness_days, no policy
NEVER = "never"                      # no observation in the store at all
EXPECTED_ABSENT = "expected_absent"  # past the limit, covered by a policy
POLICY_EXPIRED = "policy_expired"    # review_by has passed — re-affirm or drop
POLICY_RESUMED = "policy_resumed"    # suppressed/discontinued series printed again
ABSENCE_EXCEEDED = "absence_exceeded"  # intermittent gap longer than max_absence_days

# Statuses that mean "the registry policy needs attention" — these fail the
# expected_absence QA check. NEVER is listed too: a policy on a series that
# has no history at all is a wiring error, not an expected gap.
POLICY_FAILURES = frozenset({POLICY_EXPIRED, POLICY_RESUMED, ABSENCE_EXCEEDED, NEVER})
# Kinds whose absence is open-ended: any new print means the policy is wrong.
_RESUME_KINDS = frozenset({"suppressed", "discontinued"})


def age_days(latest_obs: str | None, today: str) -> int | None:
    if latest_obs is None:
        return None
    return (date.fromisoformat(today) - date.fromisoformat(latest_obs)).days


def classify(latest_obs: str | None, limit_days: int, absence: Absence | None,
             today: str) -> str:
    """Return one of the status constants above for a single series."""
    age = age_days(latest_obs, today)
    if age is None:
        return NEVER
    within_limit = age <= limit_days
    if absence is None:
        return FRESH if within_limit else STALE
    if absence.review_by is not None and today > absence.review_by:
        return POLICY_EXPIRED
    if (within_limit and absence.kind in _RESUME_KINDS
            and (absence.since is None or latest_obs > absence.since)):
        return POLICY_RESUMED
    if (absence.max_absence_days is not None
            and age > absence.max_absence_days):
        return ABSENCE_EXCEEDED
    return FRESH if within_limit else EXPECTED_ABSENT


def summarize(rows, today: str) -> dict[str, int]:
    """The one freshness count qa (sources_fresh) and methodology publish.

    rows: (latest_obs, limit_days, absence) per registry series. `fresh` is
    strict: within the staleness window, policy or not. `expected_absent` is
    past the window and covered by a policy that still holds. `stale` is past
    the window, or never seen, with no policy. A failing policy past its window
    is in none of the three; qa's expected_absence check reports it. Until
    2026-10-15 qa counted only no-policy series (849/849) while methodology
    counted all of them (862/870), so /status and /methodology disagreed."""
    out = {"total": 0, "fresh": 0, "expected_absent": 0, "stale": 0}
    for latest_obs, limit_days, absence in rows:
        out["total"] += 1
        age = age_days(latest_obs, today)
        if age is not None and age <= limit_days:
            out["fresh"] += 1
        elif classify(latest_obs, limit_days, absence, today) == EXPECTED_ABSENT:
            out["expected_absent"] += 1
        elif absence is None:
            out["stale"] += 1
    return out


def absence_from_row(raw: dict | None) -> Absence | None:
    """Rebuild an Absence from its dict form (run_daily passes plain dicts)."""
    if raw is None:
        return None
    if isinstance(raw, Absence):
        return raw
    return Absence(kind=raw["kind"], note=raw["note"],
                   review_by=raw.get("review_by"),
                   max_absence_days=raw.get("max_absence_days"),
                   since=raw.get("since"))
