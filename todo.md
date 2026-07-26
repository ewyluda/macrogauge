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
Suggested order P1→P7; P7 and the item-6 CSV export are pullable forward anytime. **P1 and P2 have
since shipped (2026-07-25)** — P3 or P7 is the next pick.

11. ~~**P2 — DC market panel + capacity-competition join.**~~ **DONE 2026-07-25** — shipped as
    `/markets` on `feat/dc-market-panel` (see Done section below); the register's **radius-based**
    capacity join and **derived** ISO column were refuted by measurement — both ship instead as
    hand-curated/denominated fields (demoted, not dropped), see
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

28. **Sortable `<th>` headers are mouse-only** across `MarketsClient.tsx`, `ParityTable.tsx`, and
    `QuiltHeatmap.tsx` — `onClick` with no keyboard equivalent, sitewide.

29. **`role="button"` on a `<tr>` overrides its implicit `row` role** (affects `/markets` and
    `/capacity`) — AT table-navigation commands may not treat the row as part of the table. A
    `<button>` scoped inside the market-name cell would preserve native row/cell semantics.

30. **`site/` has no ESLint config at all**, so no `jsx-a11y` gate exists to catch either of the
    two items above recurring, or to prevent the next one.

31. **Schema tightening pass (capacity + dc_markets).** `additionalProperties` is unset on
    `capacity.schema.json`'s `geo.items`, so it defaults to true — that is the mechanism that let
    `when` ship on all 112 entries while appearing nowhere in the schema. The 2026-07-25 branch
    declared `when`/`market` but did not close the class of gap. Also: `market` is validated by the
    loader on `geo_unmapped` entries but never declared on `geo_unmapped.items`, so tagging one is a
    silent no-op; and `dc_markets.schema.json` omits `additionalProperties: false` even though its
    `required` list already enumerates every key (9 of 30 repo schemas also omit it, so this is a
    convention gap, not a violation).

32. **`dc_markets` loader + phase polish.** `load_capacity` now transitively loads the market roster
    by default, so a malformed `config/dc_markets.json` degrades both `capacity_ok` and `markets_ok`
    and the markets phase reads config three times per run — pass `market_keys` explicitly from
    `_capacity_phase` to decouple both. Also: the `state` 2-alpha check in `pipeline/dc_markets.py`
    has zero test coverage; `note=m.get("note","")` silently defaults while every sibling field
    raises `KeyError`; and `int(sum(mw))` in the writer truncates fractional MW (none curated today).

33. **No automated test covers `/markets` rendered output.** vitest covers only `dcMarkets.ts` client
    math by project convention, and the e2e smoke test asserts one body marker plus zero console
    errors. The MW-cell defects found in the 2026-07-25 whole-branch review (a site count labelled
    "MW", and a hard "0 MW" where MW was merely undisclosed) were caught by review, not by a test,
    and nothing would catch a recurrence.

34. **`st` cannot express "operating campus with active expansion"** (found fixing the /markets
    MW-in-flight defect, 2026-07-25). Seven operating-tagged sites carry 3,975 disclosed MW with
    explicit expansion language in `when` — AMZN Project Rainier 1,725 MW ("Ph1 Oct-2025; 345kV
    Dec-2026"), META Prometheus 700 MW ("631 MW IT live May-2026 → 854 Q4-2026"), GOOGL Council
    Bluffs 500 MW ("expanding $7B"), and four others — and land entirely in the operating bucket,
    understating real construction. Fix is curation, following the ORCL Abilene precedent (the
    only site of 112 already split into a 300 MW `o` row + a 900 MW `c` row): split each such site
    into its operating and under-construction MW rather than changing the schema.

35. **`/states` mixes QCEW quarters in one column and one choropleth.** `pipeline/publish/geo.py`'s
    `_measure()` anchors on `as_of = max(obs)` — each series' OWN latest observation — so a state
    whose newest quarter is BLS-disclosure-suppressed reports an older quarter beside everyone
    else's newest, with no per-row as-of rendered. Live today: Louisiana shows its 2025Q3 level
    ($1,585) next to 43 states' 2025Q4 levels, reading **~12.7% low** and ranking 35/44 instead of
    ~18/44 in both `site/src/app/states/page.tsx`'s table and `GeoStateMap`. This is the only
    user-visible wrongness in the QCEW area — it predates the 2026-07-25 `/markets` work and is
    **not** fixed by the `N_QUARTERS` 8→10 widening (that fixed the YoY, which no page renders).
    Three options: surface `as_of` per row; flag off-quarter states visually; or adopt the
    shared-as-of like-for-like discipline `pipeline/engine/dcmarkets.py` and
    `pipeline/engine/dcindex.py:193` already use, so every state reports the same quarter and a
    suppressed state degrades to null rather than to a stale level. The third is the most
    consistent with the rest of the codebase but drops LA's level entirely — decide which failure
    mode is more honest for a choropleth before implementing.

## /escalation P3a follow-ups (triaged FINE TO DEFER at the 2026-07-26 final review — none block merge)

36. **`bridgeWindow`'s `endMonth` generality is production-dead.** `DcEscalationClient.tsx` only ever
    passes `[baseMonth, lastMonth]` — the reader's own measured window — so no basis-window bridge
    exists in the UI, and `bridge()` itself now has no production call site (tests only). The spec was
    amended to describe what shipped rather than the reverse. The obvious use for the generality is a
    bridge decomposing whichever basis the reader selects in CARRY ("the COVID-regime carry is
    +8.61%/yr, of which switchgear +2.4pp") — a real product idea, not just dead-code cleanup.
    Either build that or drop the wrapper and re-point its tests.

37. **`DcEscalationClient.tsx` is ~460 lines.** Natural seam: the "What you could carry" block (basis
    table + band sentence + short-window caption) has no dependency on the bridge table above it and
    would take `basisRows`, `chosen`, `bandRow`, `deliveryValid`, `horizon`, `anchor` as props.
    Deliberately not done on a copy-critical branch.

38. ~~**`addMonths` is pure calendar logic living in a UI file with no unit test.**~~ **RESOLVED
    2026-07-26** — moved to `site/src/lib/dcEscalation.ts` with 7 colocated tests, and made total for
    negative shifts (the original `(t % 12) + 1` returned `"2025-00"` for `addMonths("2026-01", -1)`,
    since JS `%` is sign-preserving; now a floored remainder). Promoted because the DELIVER BY `min`
    bound now depends on it.

39. **`capBand` recomputes `band()` on every render** (`DcEscalationClient.tsx:85`) though it is only
    read inside the out-of-range branch. O(n) over ~220 months; correctness is fine.

40. **Small test-tightening set on the P3a libs.** The spike-overlap test asserts only
    `> 0 && <= 100` rather than the exact share; `"handles a negative carry rate"` asserts
    `toBeLessThan` while its positive sibling pins exact values; no test exercises the grid-gap case
    the `months[i] !== w.start` guard exists for (the contiguity invariant it relies on is itself
    pinned elsewhere); the absolute-**end**-month guard is asymmetric with the start guard and
    unreachable under that invariant. Also: `annualize(ratio, months)` is written out in both
    `band()` and `bases()`.

41. **Backfill-script polish** (`scripts/backfill_dc_history.py`, one-shot): `build_series_codes()`'s
    docstring promises "in basket order" but `main()` `set()`s it away; the `missing`/`non_fred`
    registry fail-fast guards are still untested (the new coverage guard *is* tested). The unused
    test imports and the dead `sid` local were removed 2026-07-26 while adding coverage validation.
    Also: `coverage()` validates *depth* (each series' earliest returned date) and prints row counts
    for eyeballing, but does not enforce *contiguity* — a series present at 2007-12, absent for a
    stretch, and resuming later would pass. Not a realistic FRED failure mode for official series,
    but "coverage verified" should not be read as "no interior gaps".

42. **`/escalation` still permits the trailing stub month as a base** (`max={lastMonth}`), so spec
    §5.3.1's "reject a base date after the last complete month" is not enforced — acceptance
    criterion 5 is recorded PARTIAL / NOT MET for that reason. **Ruled a spec defect, not a code
    defect** (2026-07-26): P1 shipped this, the methodology copy discloses the partial-month window
    end, no `NaN` or silent clamp occurs, and `escalate()` handles `base === last` correctly with a
    unit test. Revisit only if the disclosure stops being adequate.

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
  `dc_markets.json` + schema, tenth isolated pipeline phase; the register's **radius-based** capacity
  join and **derived** ISO column were refuted by measurement — both ship instead as
  hand-curated/denominated fields (demoted, not dropped; see
  `docs/superpowers/specs/2026-07-25-dc-market-panel-design.md` and
  `docs/plans/2026-07-24-project-controls-gaps.md` §P2). Not yet merged to main.
