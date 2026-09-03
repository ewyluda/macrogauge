# TODO — active backlog

Last audited **2026-08-10** against `main` (`c49b3ca`) and the current working tree.
Only actionable work remains in the active sections. Completed, superseded, deprecated, and
declined items are recorded once in the disposition ledger at the end; full implementation
narratives belong in the linked plans and git history.

For the Project Controls roadmap, P1–P4 have shipped or concluded. The next product pick is
**P5 (claims-grade artifacts)** or **P7 (audience landing page)**. The full gap register and
methodology constraints remain in
[`docs/plans/2026-07-24-project-controls-gaps.md`](docs/plans/2026-07-24-project-controls-gaps.md).

## Correctness and operations

- [ ] **#2 — Pin commodities-schema failures at the orchestration boundary.** Every other
  isolated `run_daily` phase proves that `jsonschema.ValidationError` aborts the run rather than
  degrading into an `*_ok: false` QA result. Add the commodities equivalent of
  `test_capacity_schema_violation_fails_run`; the generic commodities-failure test does not cover
  this contract.

- [ ] **#4 — Refresh Cipher Digital milestones, then wait for filed operating evidence.**
  `config/capacity.json` still says Black Pearl Phase I rent starts in August 2026. Cipher's 2025
  10-K superseded that target: initial Phase I rent is targeted for **Q4 2026**, initial Phase II
  rent for **Q1 2027**, and full ramp for **Q1 2027**. Update the curation text now, but keep the
  MW in construction until a filing confirms rent actually commenced. Evidence:
  [2025 10-K](https://www.sec.gov/Archives/edgar/data/1819989/000181998926000009/cifr-20251231.htm)
  and [Q1 2026 10-Q](https://www.sec.gov/Archives/edgar/data/1819989/000181998926000028/cifr-20260331.htm).

- [ ] **#9 — Move GitHub Actions off the Node 20 action runtime.** Upgrade
  `actions/checkout@v4` and `actions/setup-node@v4` to current supported majors (both are v6 as of
  this audit), confirming the GitHub-hosted runner satisfies their minimum runner versions.
  `actions/setup-python@v5` is a separate action and is not part of this item.

- [ ] **#10 — Model expected absence separately from real staleness.** `sources_fresh` still mixes
  disclosure-suppressed QCEW rows and structurally absent series with genuine regressions. Add an
  explicit registry/status policy for expected absence; do not hardcode the old “8 states” count,
  which has already drifted.

- [ ] **#23 — Remove the 2030 capacity-timeline time bomb.**
  `pipeline/publish/capacity.py` only recognizes years 2025–2029 via
  `_YEAR = re.compile(r"20(2[5-9])")`. Accept valid four-digit years (with a bounded policy if
  needed) and pin 2030+ parsing.

- [ ] **#27 — Validate every committed published artifact in CI.**
  `tests/test_published_data.py` currently covers **19 of 36** committed JSON files; 17 artifacts
  still rely only on phase/writer tests. Build the contract list from explicit data→schema pairs
  (including the three accountability files and three quilt files) so new artifacts cannot silently
  fall out of the committed-data guard.

- [ ] **#32 — Decouple capacity and markets config loading.** `_capacity_phase` transitively loads
  the market roster, while `_markets_phase` loads the market config and capacity config again.
  Resolve `market_keys` once and pass them explicitly so malformed market config does not degrade
  `capacity_ok` and the markets phase does not parse config three times. While there, pin the
  two-letter state validation, require `note` instead of defaulting it, and preserve fractional MW
  instead of truncating with `int(sum(...))`.

## Contract and payload cleanup

- [ ] **#5 / #21 / #24 / #31 — Make one versioned capacity/DC payload cleanup pass.** Treat these
  as one contract change instead of four independent chores:

  - decide whether `capacity.json.timeline` remains a public compatibility field or is removed;
    the site now builds filtered timelines from per-company `tl`;
  - stop serializing unused `asOf`/`rebase` fields into the `/escalation` client payload, and decide
    whether the unconsumed Ops/Hardware monthly grids remain public API surface;
  - require `when` where the capacity contract promises it, declare `market` on
    `geo_unmapped.items`, and add `additionalProperties: false` at the capacity/DC-markets object
    boundaries that are intended to be closed;
  - document compatibility/migration decisions before deleting any field that an external JSON
    consumer could use.

- [ ] **#22 — Correct `geo_note`'s meaning of `approx`.** Many `approx: true` rows use known
  town/county centroids, not state-only placement. Define it as approximate/centroid coordinates
  rather than “only the state/country is public,” and keep the dashed-map legend aligned.

## Product and coverage roadmap

- [ ] **#47 — Missing measures/visuals/capabilities, seven batches.** Plan at
  [`docs/plans/2026-09-03-missing-measures-visuals-capabilities.md`](docs/plans/2026-09-03-missing-measures-visuals-capabilities.md):
  share/export foundation → render dead artifact fields → momentum/contribution/breadth →
  five pipeline unlocks (rates, compute, USDA, housing, what-changed) → receipts surfaces →
  Project Controls P7/P6 → hygiene. Absorbs P5 (#14), P6 (#15), P7 (#16) and #7.

- [x] **#14 (absorbs #6) — P5 claims-grade artifacts.** *(done 2026-09-03, batches 1 + 5: CSV/JSON export, citation string, `/as-of` ledger, `/data`; the monthly PDF is deliberately not built — print CSS covers it)* Ship CSV/Excel export, a stable citation
  string, a monthly one-page PDF, and a point-in-time page backed by the append-only vintage store.
  Treat export as the claims workflow, not a standalone hygiene task.

- [x] **#15 — P6 portfolio/program view.** *(done 2026-09-03, batch 6: `/portfolio`)* Let readers define local projects (market, MW, base
  estimate/date, delivery date) and aggregate escalation exposure in localStorage/URL state. P1 and
  P3 are now complete; the forward leg must remain a reader-selected historical contingency basis,
  not an unstated forecast.

- [x] **#16 — P7 Project Controls landing page and vocabulary.** *(done 2026-09-03, batch 6: `/project-controls`)* Create a dedicated entry surface
  using escalation, basis of estimate, contingency, long-lead, $/MW, and energization language;
  route into `/datacenter`, `/escalation`, `/markets`, `/longlead`, and `/capacity`.

- [ ] **#17 — P8 named contract-reference index decision.** Do not schedule product work until a
  methodology-freeze, versioning, correction, and compliance policy is explicitly approved.

- [ ] **#26 — Decide whether market-level power/ops belongs on `/markets`.** EIA power is only
  state-resolution, so multiple markets in one state would share an identical `ops_mult`. Design
  and display the resolution label before re-keying `dcindex.parity_rows()` to markets.

## Capacity curation

- [ ] **#34 — Split operating campuses with active expansions.** Curate operating and
  under-construction MW as separate rows, following the ORCL Abilene precedent. The known review
  set includes Project Rainier, Prometheus, Council Bluffs, and four other operating-tagged sites
  whose `when` text describes active expansion. Do not change the status schema to encode two states
  in one row.

## UX and accessibility

- [ ] **#7 — Add explicit scoreboard empty/degraded states.** The page now explains BT versus LIVE,
  so that half of the old item is complete. What remains is visible copy when any graded/pending or
  backtest collection is empty instead of rendering a blank table body.

- [x] **#19 — Normalize escalation currency formatting.** *(done 2026-09-03, batch 6: `fmtUsd`)* Reconcile `$X.XXM` with adjacent exact
  dollars and prevent small negative amounts from rendering as `−$0`.

- [x] **#20 — Validate month inputs independently of native browser support.** *(done 2026-09-03, batch 6: `lib/monthInput.ts`)* Safari may render
  `<input type="month">` as text and ignore `min`/`max`; invalid text currently falls through to a
  misleading “index starts in 2018-01” message. Parse and report invalid/out-of-range values in the
  client.

- [ ] **#28 — Finish sortable-header accessibility in `ParityTable.tsx`.** `/markets` was fixed in
  `982d0a8` with a native button inside each `<th>` plus `aria-sort`. `QuiltHeatmap` has no sortable
  `<th>` and was incorrectly named in the original item. Apply the proven pattern to the one real
  remaining table.

- [ ] **#29 — Preserve native row semantics on expandable tables.** `/markets` and `/capacity`
  still put `role="button"` on `<tr>`, which removes its implicit row role. Move the interactive
  control into a button in the identifying cell while retaining keyboard and expanded-state
  behavior.

- [ ] **#30 — Add an actual ESLint/a11y gate.** `site/` has no ESLint config or ESLint dependencies,
  while `npm run lint` still invokes `next lint`. Install/configure the supported Next/ESLint path
  and `jsx-a11y` rules so #28/#29 cannot recur.

- [ ] **#33 — Add `/markets` rendered-value regression coverage.** Playwright now covers route
  smoke and sortable-header semantics, while unit tests cover the sort keys. It still does not pin
  the two review failures at the rendered-cell boundary: site count mislabeled as MW and undisclosed
  MW rendered as an affirmative `0 MW`.

## Focused engineering follow-ups

- [ ] **#18 — Strengthen two DC index fixtures.** Give `tests/test_dcindex.py` an interior-month
  value change so last-day-of-month sampling is observable, and give
  `tests/test_datacenter_writer.py` a six-decimal value so the 4dp publishing contract can fail.

- [x] **#37 — Extract the “What you could carry” block from `DcEscalationClient.tsx`.** *(done 2026-09-03, batch 6: `CarryTable.tsx`)* The file is
  still roughly 460 lines; the basis table/band section remains a clean, copy-stable component seam.

- [ ] **#40 — Finish the useful P3a test tightening.** The absolute-end guard now has a regression
  test. Remaining useful pins are the exact spike-overlap share, exact negative-carry math, and a
  shared annualization helper for `band()`/`bases()`. Do not add a synthetic grid-gap test unless the
  production contiguity invariant stops being guaranteed by construction.

## Peer-panel follow-ups

- [ ] **#43 — Second peer wave: RLB and Mortenson.** RLB requires an `index_level` row type plus an
  explicit derivation basis; Mortenson requires honest blank-year handling and must not annualize
  quarterly metro prints. Preserve the traps and evidence in
  `docs/plans/2026-07-26-dc-peer-panel.md`.

- [ ] **#44 — Promote BLS `PCU236223236223` to a registry connector.** Publish revisable monthly
  levels from the keyless BLS API and derive YoY at the site/publisher boundary, replacing the only
  hand-seeded derived peer column.

- [ ] **#45 — Run the two bounded peer spikes.** Spend at most one human-hour each on (a) Cushman &
  Wakefield's US Data Center Development Cost Guide, including stated exclusions, and (b) T&T's DCCI
  per-market US$/W table. Stop rather than laundering inaccessible or scope-mismatched numbers.

## Disposition ledger from the 2026-08-10 audit

| Old item | Disposition | Reason / evidence |
|---|---|---|
| #1 | **Completed 2026-07-11** | `2ac79f4` added honest base-hole walk-back plus engine→gaptable regression coverage, well before the November deadline. |
| #3 | **Superseded / invalid** | The proposed Barber Lake “+39 MW to 246” double-counted Phase II. The current 207 critical-IT estimate already combines 168 MW IT for the 244 MW-gross Phase I with ~39 MW estimated IT for the remaining 56 MW-gross Phase II; the 2025 10-K pins the gross split at 244 + 56 = 300 MW. |
| #6 | **Superseded by #14** | CSV/export is part of the P5 claims-grade workflow, not a separate product item. |
| #8 | **Completed** | `site/src/app/icon.svg` has existed since `603cf92`; App Router metadata serves it as the site icon. |
| #11 | **Completed 2026-07-25** | P2 shipped as `/markets`; radius join and derived ISO were replaced by measured, denominated alternatives. |
| #12 | **Completed/concluded 2026-07-26** | P3a and P3b shipped; P3c published a negative result and correctly did not become a forecast model. |
| #13 | **Completed 2026-07-27** | P4 shipped in PR #9 as `longlead.json`, `/longlead`, and the `/datacenter` teaser strip. |
| #25 | **Removed until demanded** | `qtrly_estabs` has no product consumer. Re-open only when an establishment-count column has an approved use. |
| #35 | **Completed 2026-08-10 (current working tree)** | `/states` now uses the national QCEW latest quarter as the shared comparison date; missing-state quarters degrade to null and the production-shaped regression is pinned. |
| #36 | **Closed — keep by design** | `bridge()` is a harmless compatibility wrapper over `bridgeWindow()` with tests and an explicit code comment; deleting it creates churn without product value. |
| #38 | **Completed 2026-07-26** | `addMonths` moved to `site/src/lib/dcEscalation.ts`, handles negative shifts, and has colocated tests. |
| #39 | **Declined** | Recomputing one `band()` over roughly 220 months per render is immaterial; memoization would add state complexity without a measured user impact. |
| #41 | **Deprecated / no further polish** | `backfill_dc_history.py` was a completed one-shot migration. Its depth guard is tested; ordering, interior-gap, and dead-guard polish should not compete with production work unless a new backfill is authorized. |
| #42 | **Closed — accepted behavior** | Allowing the disclosed trailing stub month as a base was ruled a spec defect, not a code defect; the math is defined and tested. |
| #46 | **Removed until evidence is surfaced** | `quote` is review-only and does not render. Design a structured evidence list if/when the UI exposes it; a speculative schema migration has no current consumer. |
