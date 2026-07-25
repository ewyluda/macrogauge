# TODO — recommended enhancements (ranked)

Backlog last groomed 2026-07-24 (Project Controls gap register added).
Full narratives for completed items live in the commit history.

## Analytics / correctness

1. **Gaptable base-hole fix — HARD DEADLINE 2026-11-12.** The 2018 YoY base window
   runs out; fix the base-month derivation before then (tracked since 2026-07-11).

2. **Commodities phase ValidationError test pin** (found in PR #3 review, 2026-07-21):
   every isolated `run_daily` phase pins that a schema-invalid artifact fails the run —
   except commodities. One test, mirrors `test_capacity_schema_violation_fails_run`.

## /capacity curation follow-ups

3. **CIFR Barber Lake +39 MW Fluidstack expansion** (critical IT, to 246 MW / full
   300 MW site) — surfaced in the 2026-07-21 news sweep but not date-verified, so
   deliberately not applied with the HUT/IREN/CIFR flags. Verify the 8-K, then apply.

4. **CIFR Black Pearl AWS phase 1 con→op** once rent commences (Aug 2026) or the next
   filing discloses the phase split — go-live wording applied 2026-07-21, MW not moved.

5. **capacity.json top-level `timeline` is now client-unused** (the page aggregates
   per-company `tl` since e7d46e9) — kept for API consumers; drop or document at the
   next schema rev.

## Product / coverage (phase 5 candidates)

6. **Exports:** headline/components CSV, `feed.xml` RSS daily brief, open-data page
   documenting all published JSONs (sketched in docs/macrogauge-design.md §6/§8).
   → **re-ranked by item 15 (P5):** for the Project Controls audience the CSV export is not
   hygiene, it's the use case. Build them together.

7. **Scoreboard empty/degraded state copy** explaining vintage-true grading — the BT
   vs LIVE distinction deserves one sentence on-page.

## Hygiene (quick wins)

8. **Add a favicon** to `site/src/app` or `site/public` — kills the 404 on every page load.

9. **daily.yml/ci.yml action bumps:** `actions/checkout@v4` / `actions/setup-node@v4`
   ride the deprecated Node 20 runtime (the weekday cron gate itself is done).

10. **Silence expected staleness noise:** the 8 disclosure-suppressed QCEW states and
    never-seen series read as failures in `sources_status` — mark them expected-absent so
    real regressions stand out.

## Project Controls audience — DC campaign (added 2026-07-24)

Full gap register, rationale, data paths, and invariants:
**`docs/plans/2026-07-24-project-controls-gaps.md`** (register only — promote an item to its own
plan doc before implementing). One line each here so nothing falls off this list.
Suggested order P1→P7; P7 and the item-6 CSV export are pullable forward anytime.

11. **P1 — Escalation calculator ($/MW bridge).** User supplies the base; we escalate it and show a
    component-level bridge. **PLANNED 2026-07-24 →
    `docs/superpowers/plans/2026-07-24-dc-escalation-calculator.md`** (6 TDD tasks, ready to execute).
    Scope locked: Build only, historical only, no location input. Note it is *not* pure client-side —
    the bridge needs a monthly component grid added to `datacenter.json` (2 small pipeline tasks).

12. **P2 — DC market panel + capacity-competition join.** ~15–20 real DC markets at county-QCEW
    resolution, plus announced MW within ~60mi from `capacity.json` `geo[]`. The join exists nowhere
    else. (`metros.json` is Zillow consumer shelter — does not serve this.)

13. **P3 — Forward DC escalation curve (12–36mo).** Point the `/outlook` engine at DC Build/Ops;
    publish as an **annual factor table**. Do not ship an unbacktested 36mo horizon.

14. **P4 — Long-lead equipment board.** Vendor backlog / book-to-bill (Eaton, Schneider, ABB, Vertiv,
    Cummins, GE Vernova…) as a *directional* lead-time proxy via the existing FMP connector. The
    primary-source standard that nulled `context.transformer` stands — see the plan doc before restarting.

15. **P5 — Claims-grade artifacts.** Extends item 6: CSV + citation string + monthly PDF +
    a **point-in-time page** (vintage store proves the index was never restated — the claims use case).

16. **P6 — Portfolio/program view.** localStorage projects → escalation exposure. Depends on P1/P3.

17. **P7 — Audience landing page + vocabulary.** Their words (escalation, contingency, long-lead,
    $/MW, energization), not CPI words. Independent and cheap.

18. **P8 — Named contract-reference index (strategic).** Needs a methodology-freeze + versioning policy
    before an index can be named in an escalation clause. Flagged so P1–P7 don't foreclose it.

## Done (one-liners; details in git log)

- 2026-07-13: ALFRED backtest seeding; STREET → Cleveland ensemble; Manheim → Cox
  Insights re-point (+ Dec 2025–May 2026 backfill).
- 2026-07-14: nowcast component coverage widened (trend + futures-driver slices).
- 2026-07-20: labor.json + /states state-level My Inflation shipped (old item 6).
- 2026-07-21: /capacity tracker merged (PR #3, e7d46e9) + HUT/IREN/CIFR news flags
  applied (5044714).
