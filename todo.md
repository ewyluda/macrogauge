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
   → **re-ranked by item 14 (P5):** for the Project Controls audience the CSV export is not
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

11. ~~**P2 — DC market panel + capacity-competition join.**~~ **DONE 2026-07-25** — shipped as
    `/markets` on `feat/dc-market-panel` (see Done section below); the capacity-radius join and ISO
    column were refuted by measurement and dropped, see
    `docs/plans/2026-07-24-project-controls-gaps.md` §P2.

12. **P3 — Forward DC escalation curve (12–36mo).** Point the `/outlook` engine at DC Build/Ops;
    publish as an **annual factor table**. Do not ship an unbacktested 36mo horizon.

13. **P4 — Long-lead equipment board.** Vendor backlog / book-to-bill (Eaton, Schneider, ABB, Vertiv,
    Cummins, GE Vernova…) as a *directional* lead-time proxy via the existing FMP connector. The
    primary-source standard that nulled `context.transformer` stands — see the plan doc before restarting.

14. **P5 — Claims-grade artifacts.** Extends item 6: CSV + citation string + monthly PDF +
    a **point-in-time page** (vintage store proves the index was never restated — the claims use case).

15. **P6 — Portfolio/program view.** localStorage projects → escalation exposure. Depends on P1/P3.

16. **P7 — Audience landing page + vocabulary.** Their words (escalation, contingency, long-lead,
    $/MW, energization), not CPI words. Independent and cheap.

17. **P8 — Named contract-reference index (strategic).** Needs a methodology-freeze + versioning policy
    before an index can be named in an escalation clause. Flagged so P1–P7 don't foreclose it.

## /escalation follow-ups (deferred at the 2026-07-25 final review — none block merge)

18. **Strengthen two pipeline fixtures.** `tests/test_dcindex.py`'s monthly-grid fixture is flat
    across interior months, so it pins the Laspeyres identity but not the "last day of month"
    sampling for those months; `tests/test_datacenter_writer.py`'s values are all ≤1dp, so
    `round(x, 4)` is a no-op and a precision regression wouldn't trip. One mid-2017 value change
    and one 6-decimal value close both.

19. **`usd()` polish in `DcEscalationClient.tsx`:** mixes `$X.XXM` with exact dollars across
    adjacent cards (they don't visibly reconcile), and `usd(-0.4)` renders `−$0` — reachable in
    the "Of your delta" column at base costs of a few dollars. Cosmetic.

20. **`<input type="month">` degrades to a text field in Safari** — `min`/`max` stop constraining
    and an unparseable string falls through to the "index starts in 2018-01" message, which is
    misleading on that path. Functional everywhere else.

21. **Unused payload/publish surface:** `asOf`/`rebase` are serialized into the `/escalation`
    client payload but only used server-side; the `ops` and `hardware` `monthly` grids (~11KB of
    the ~58KB added to `datacenter.json`) have no consumer — deliberate, since the publisher is
    one unparametrized path, but worth documenting at the next schema rev alongside item 5.

## /markets follow-ups (deferred at the 2026-07-25 final review — none block merge)

22. **`geo_note` overstates what `approx: true` means.** It says state-centroid placement, but many
    entries are town/county centroids. Correct at the next capacity schema rev — alongside items
    5 and 21.

23. **`pipeline/publish/capacity.py:20`'s `_YEAR = re.compile(r"20(2[5-9])")` expires in 2030.**

24. **`when` is not `required` in `capacity.schema.json`** — this plan declares it but does not make
    it mandatory, which is a separate and riskier change.

25. **`qtrly_estabs` is available in the rows we download and is not ingested.** No column needs
    it yet; revisit if an establishment-count column earns its place.

26. **The power/ops columns are state-resolution and are not on the `/markets` panel.**
    `dcindex.parity_rows()` is key-agnostic and could be re-resolved to market keys, but EIA
    industrial power has no sub-state series, so two markets in one state would share an identical
    `ops_mult`. Adding it needs the resolution label designed first — deferred rather than shipped
    mislabelled.

27. **`tests/test_published_data.py` covers only 18 of 34 artifacts.** `/markets` (`dc_markets`) is
    one of the 18; 16 gaps remain.

## Done (one-liners; details in git log)

- 2026-07-13: ALFRED backtest seeding; STREET → Cleveland ensemble; Manheim → Cox
  Insights re-point (+ Dec 2025–May 2026 backfill).
- 2026-07-14: nowcast component coverage widened (trend + futures-driver slices).
- 2026-07-20: labor.json + /states state-level My Inflation shipped (old item 6).
- 2026-07-21: /capacity tracker merged (PR #3, e7d46e9) + HUT/IREN/CIFR news flags
  applied (5044714).
- 2026-07-25: P1 escalation calculator (`/escalation`) shipped on `feat/dc-escalation` —
  6 TDD tasks + a final-review fix wave (honest KPI precision, contribution-basis
  disclosure, base-month convention; plan:
  docs/superpowers/plans/2026-07-24-dc-escalation-calculator.md). Not yet merged to main.
- 2026-07-25: P2 DC market panel (`/markets`, item 11) shipped on `feat/dc-market-panel` — 20-market
  config-driven roster, county-QCEW construction wage + employment aggregation engine,
  `dc_markets.json` + schema, tenth isolated pipeline phase; the register's capacity-radius join and
  ISO column were refuted by measurement and dropped (see
  `docs/superpowers/specs/2026-07-25-dc-market-panel-design.md` and
  `docs/plans/2026-07-24-project-controls-gaps.md` §P2). Not yet merged to main.
