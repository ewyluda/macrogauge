from pipeline import freshness as fr
from pipeline.registry import Absence

T = "2026-09-04"


def test_no_policy():
    assert fr.classify(None, 80, None, T) == fr.NEVER
    assert fr.classify("2026-07-01", 80, None, T) == fr.FRESH
    assert fr.classify("2026-06-01", 80, None, T) == fr.STALE  # 95d
    assert fr.age_days("2026-06-01", T) == 95 and fr.age_days(None, T) is None


def test_suppressed_and_discontinued_are_open_ended_until_they_print():
    for kind in ("suppressed", "discontinued"):
        a = Absence(kind=kind, note="n", review_by="2027-03-31")
        assert fr.classify("2025-04-01", 400, a, T) == fr.EXPECTED_ABSENT
        assert fr.classify("2026-09-01", 400, a, T) == fr.POLICY_RESUMED
        assert fr.classify(None, 400, a, T) == fr.NEVER


def test_intermittent_is_bounded_and_fresh_in_season():
    a = Absence(kind="intermittent", note="n", max_absence_days=200)
    assert fr.classify("2026-08-01", 80, a, T) == fr.FRESH
    assert fr.classify("2026-06-01", 80, a, T) == fr.EXPECTED_ABSENT   # 95d
    assert fr.classify("2026-02-16", 80, a, T) == fr.EXPECTED_ABSENT   # 200d, at the bound
    assert fr.classify("2026-02-15", 80, a, T) == fr.ABSENCE_EXCEEDED  # 201d


def test_review_by_expiry_wins_over_everything():
    a = Absence(kind="suppressed", note="n", review_by="2026-09-03")
    assert fr.classify("2025-04-01", 400, a, T) == fr.POLICY_EXPIRED
    assert fr.classify("2026-09-01", 400, a, T) == fr.POLICY_EXPIRED
    ok = Absence(kind="suppressed", note="n", review_by="2026-09-04")  # inclusive
    assert fr.classify("2025-04-01", 400, ok, T) == fr.EXPECTED_ABSENT


def test_absence_from_row_roundtrip():
    a = Absence(kind="intermittent", note="n", max_absence_days=200)
    assert fr.absence_from_row(None) is None
    assert fr.absence_from_row(a) is a
    assert fr.absence_from_row({"kind": "intermittent", "note": "n",
                                "max_absence_days": 200}) == a
    assert fr.absence_from_row({"kind": "suppressed", "note": "n"}) == Absence(
        kind="suppressed", note="n")


def test_policy_failures_set_is_exactly_the_attention_states():
    assert fr.POLICY_FAILURES == {fr.POLICY_EXPIRED, fr.POLICY_RESUMED,
                                  fr.ABSENCE_EXCEEDED, fr.NEVER}
