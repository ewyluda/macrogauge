# PR 95 — reconciliation of the PR 71–93 findings

Reviewed on **2026-10-08**. **11 of 13 findings are reconciled; F3 and F12 are partially reconciled.** No P0/P1 issue or additional unrelated regression was established in this review.

- PR: [#95 — fix: reconcile the 13 findings of the PR 71–93 review](https://github.com/ewyluda/macrogauge/pull/95)
- Frozen head: `c655fc772af78dd2c4b09f756e1c78f4519d1c10`
- PR base: `53462dec10ba776e78f9548892e4d275529e5fdf`
- Fix diff: `49a8c7c566bd02be56dd1e68aaad0524ec76220e..c655fc772af78dd2c4b09f756e1c78f4519d1c10` — 31 files, 364 additions, 73 deletions. The other PR commit contains the original review artifacts.
- Original report: [2026-10-08-pr-71-93-review.md](/Users/ericwyluda/Development/macrogauge/docs/reviews/2026-10-08-pr-71-93-review.md)
- Evidence: [2026-10-08-pr-95-evidence.json](/Users/ericwyluda/Development/macrogauge/docs/reviews/2026-10-08-pr-95-evidence.json)

The PR head was checked again after testing and remained unchanged. Findings below are deterministic supported-input cases, not claims that the current production data exhibits them. Review artifacts are the only files added by this review; application code and the original evidence are unchanged.

## Remaining findings, in priority order

### R1 · P2 · F3 partially reconciled — Matching end dates still permits incompatible annual baselines

**Location:** [ratesHeadline.ts:41–42 at the reviewed commit](https://github.com/ewyluda/macrogauge/blob/c655fc772af78dd2c4b09f756e1c78f4519d1c10/site/src/lib/ratesHeadline.ts#L41-L42).

The new guard correctly removes the attribution when the shared yield/OAS window ends before the yield's own latest date. It does not establish that the **start dates** match. The publisher's `_level()` selects the yield's own year-ago observation, while `_bbb_move()` selects a date present in both yield and OAS within the allowed three-day tolerance. See [rates.py:123–153](https://github.com/ewyluda/macrogauge/blob/c655fc772af78dd2c4b09f756e1c78f4519d1c10/pipeline/publish/rates.py#L123-L153).

An offline fixture passed through those actual producer functions gives:

| Observation date | BBB yield | BBB OAS |
| --- | ---: | ---: |
| 2025-10-03 | 5.22% | 1.02% |
| 2025-10-06 | 5.00% | missing |
| 2026-10-06 | 5.10% | 0.90% |

Both latest dates are October 6, 2026. The standalone yield rises **10bp** from October 6, 2025, while the shared-window yield and spread both fall **12bp** from October 3, 2025. The new guard passes and the actual helper renders:

> BBB corporate debt yields 5.10%, up 10bp on the year, mostly from the credit spread

The detail describes the spread moving **−12bp** of the index yield's **−12bp**. Thus the title still attributes a rise using a different window's decline. The original lagged-end reproduction now passes; this historical-gap case exposes the remaining part of the same contract failure.

**Correction:** establish a shared start and end for the attributed move, or use the shared-window yield change and disclose its window. Otherwise retain the attribution only in the separate dated detail. Add a producer-to-headline test with matching end dates, a missing year-ago OAS observation, and opposite yield-change signs. Checking only `as_of` is insufficient.

**Evidence:** `python_probe.F3_shared_end_different_baselines` and `frontend_probe.remaining.F3_baseline_mismatch` in the evidence JSON.

### R2 · P3 · F12 partially reconciled — A single global legend mislabels mixed Headline/Core weighting

**Location:** [ForecasterDots.tsx:60](https://github.com/ewyluda/macrogauge/blob/c655fc772af78dd2c4b09f756e1c78f4519d1c10/site/src/components/ForecasterDots.tsx#L60), using [ensembleLabel:9–14](https://github.com/ewyluda/macrogauge/blob/c655fc772af78dd2c4b09f756e1c78f4519d1c10/site/src/components/ForecasterDots.tsx#L9-L14).

Single-row equal and unequal weights are now labeled correctly. However, the chart displays both Headline CPI and Core CPI, and `ensembleLabel(live.map(...))` changes their one shared legend to “ensemble, weighted by past accuracy” as soon as **any** row has unequal weights.

This mixed state is supported by the actual producer: [models.py:451–459](https://github.com/ewyluda/macrogauge/blob/c655fc772af78dd2c4b09f756e1c78f4519d1c10/pipeline/engine/nowcast/models.py#L451-L459) supplies earned errors to the headline ensemble but explicitly supplies `None` errors to the core ensemble, keeping Core equal-weighted. With calls of 0.10% and 0.40%:

| Target | Weights | Actual ensemble |
| --- | --- | ---: |
| Headline CPI, errors 0.10/0.40 | 80% / 20% | 0.16% |
| Core CPI, errors unavailable | 50% / 50% | 0.25% |

Rendering the real component with these actual `ensemble()` outputs produces both rows and only the accuracy-weighted legend. There is no equal-weight disclosure for Core. Once Headline earns weights, readers are given the wrong methodology for Core's tick; the forecast values themselves are not changed by this display defect.

**Correction:** label the weighting method per target, or use a neutral shared “ensemble” legend with row-specific methodology. Add a rendered mixed-mode test that distinguishes the headline's earned weights from Core's equal weights. The new test expecting one weighted legend for a mixed array currently preserves this ambiguity.

**Evidence:** `python_probe.F12_real_producer_modes` and `frontend_probe.remaining.F12_mixed_legend`.

## Reconciliation of all original findings

| Original finding | Status | Verification / remaining issue |
| --- | --- | --- |
| F1 · P2 · generated movers break the browser gate | Reconciled | Stable `components-table` selector passes against regenerated `changes.json` with 30 movers: one changed and 29 unchanged. The full generated-data browser suite passes. |
| F2 · P2 · hardware comparison links discard the component | Reconciled | All five hardware components are present in the actual calculator server props, with data capped at each component's last observation. Browser coverage follows every DC component link and verifies both selected rows remain, without missing-level output. |
| F3 · P2 · BBB headline combines different change windows | **Partial — R1** | Lagged end-date case passes; same end with different historical baselines still yields contradictory attribution. |
| F4 · P2 · scoreboard compares unequal samples | Reconciled | Actual rows are intersected before MAE ranking. Independent unequal-count and different-missing-month cases select the common-sample winner; no overlap returns no claim. |
| F5 · P2 · multiword places merge distinct news | Reconciled | New York/New Jersey, North Carolina/North Dakota, and San Jose/San Antonio stay separate. Same-place New York/New York State remains grouped. This is evidence for the reported defect, not a guarantee of general geographic entity recognition. |
| F6 · P2 · negative power base reverses change direction | Reconciled | Eight producer/schema cases cover negative, zero, positive, and sign-crossing prices. Nonpositive bases use absolute $/MWh; consumer wording follows the actual direction. |
| F7 · P2 · hub map produces NaN geometry | Reconciled | Real component rendering has finite SVG coordinates/radii for mixed signs, all zero, all negative, and one missing price; signed prices remain readable. |
| F8 · P2 · unsupported base-effect explanation | Reconciled | Independent denominator calculations cover flat, opposing, small, and dominant effects. The strong claim appears only in the dominant supported case; the other cases quantify rather than overstate the effect. |
| F9 · P2 · cost-of-living rise called rate-driven | Reconciled | Annotation is now the neutral “cost-of-living jump”; reviewed page and chart labels remove the unsupported causal claim. |
| F10 · P3 · latest calculator month treated as absent | Reconciled | Helper and browser show 0% change, original amount, and “no time elapsed.” Future/missing months remain unavailable. |
| F11 · P3 · invalid amount changes on reload | Reconciled | Browser checks blank, zero, negative, and oversized inputs: explicit error, no monetary result, last valid URL retained. A subsequent valid amount produces an identical result after reload. |
| F12 · P3 · forecast legend misstates ensemble weights | **Partial — R2** | Single-target modes pass; simultaneous weighted Headline and equal Core share the wrong global description. |
| F13 · P3 · personal-inflation gap axis uses percent | Reconciled | Actual component execution with recorded replay data produces `{value}pp` axis labels and a `pp` tooltip. Only transport/canvas boundaries were stubbed. |

## Verification and limits

The review read the complete fix diff, affected producers and consumers, and existing/new regression tests. It used a `git archive` snapshot of the exact head at `/tmp/macrogauge-pr95-review/snapshot`, with the checkout's installed dependencies. All generated-data mutation happened inside that snapshot. No live source collection, production modification, or application fix was performed.

| Check | Result |
| --- | --- |
| `pytest -q` | **1,295 passed**, 48.73s |
| `npm test` | **464 tests / 68 files passed**, 1.97s |
| `npm run lint` | Passed |
| Offline regeneration | **13 artifacts schema-valid**; frozen store plus recorded OpenRouter/Nebius fixtures, in-memory SQLite |
| `GITHUB_SHA=c655fc772af78dd2c4b09f756e1c78f4519d1c10 npm run build` | Passed on the regenerated artifacts |
| `npm run e2e` | **236 passed**, 48.8s, against that generated static export |
| Independent Python and JS reconciliation probes | Passed all their review assertions, including assertions reproducing R1/R2 |
| GitHub pipeline/site and Vercel checks | SUCCESS at the reviewed head, independently rechecked after local verification |

The custom probes deliberately assert the two remaining defects so this record is reproducible. A future correct fix should invalidate those defect assertions; they are review evidence, not permanent green application tests. Full suite success does not resolve the two semantic failures above. These checks establish behavior on frozen and controlled inputs, not the future availability or accuracy of live data providers. Existing frontend dependencies were reused; a fresh dependency installation was not part of this review.

## Reproduce the independent evidence

From the repository root, export the reviewed SHA to an otherwise empty directory, install or link the locked frontend dependencies, then run the saved scripts. The export must have no `.git` directory; the regeneration script refuses a working checkout. Substitute your own absolute snapshot directory and use Python with the repository's locked requirements installed.

```bash
git archive c655fc772af78dd2c4b09f756e1c78f4519d1c10 | tar -x -C "$snapshot"
ln -s "$PWD/site/node_modules" "$snapshot/site/node_modules"
.venv/bin/python docs/reviews/2026-10-08-pr-71-93-regenerate.py "$snapshot"
.venv/bin/python docs/reviews/2026-10-08-pr-95-reconcile.py "$snapshot" > /tmp/pr95-python.json
node docs/reviews/2026-10-08-pr-95-reconcile.cjs "$snapshot" /tmp/pr95-python.json > /tmp/pr95-frontend.json
```

Run the normal site test/lint/build/browser commands from the snapshot's `site/` directory, supplying the reviewed `GITHUB_SHA` to the build because an archive has no Git metadata. Original PR 71–93 probes remain unchanged as the historical record.
