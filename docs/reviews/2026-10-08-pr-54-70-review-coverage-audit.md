# October 7 shipping audit: review coverage and remaining defects

Audit performed October 8, 2026. This report preserves the findings delivered in the review conversation before any remediation was authorized.

- **Reviewed revision:** [`f58df0da95289e395548722f0931b4fc1a9e8dae`](https://github.com/ewyluda/macrogauge/commit/f58df0da95289e395548722f0931b4fc1a9e8dae), the final October 7 daily publication.
- **Shipping window:** October 7, 2026, America/New_York: `2026-10-07T04:00:00Z` through, but excluding, `2026-10-08T04:00:00Z`.
- **Request:** identify work shipped yesterday without an independent Codex/Astra review, audit that work for defects, and report findings in priority order without changing application code.
- **Result:** six PRs without an independent review record found; ten later PRs with implementation changes after their last recorded independent review; **eight P2 findings and two P3 findings** at the reviewed revision. No P0/P1 issue established.
- **Status:** findings only. No application, configuration, published-data, or store fixes were made by this audit. Saving this report does not mark any finding resolved. No commit or push is included in the report-saving task.

The checkout advanced to `4ccd8068cfb65f130cbf3ce68f0f84fecf9c563c` and acquired unrelated work in progress before this report was saved. The findings, source links, numerical examples, and validation results below refer to the frozen reviewed revision, not to that later checkout. Unrelated changes were left untouched.

## 1. How review coverage was established

The audit compared the live GitHub merged-PR history and local first-parent history with repository review reports, available Codex chats, and local session records. For PRs #60–70, session turn metadata confirmed `gpt-6-astra`; a chat title alone was not treated as proof of the reviewing model. Reviewed application hashes were compared with subsequent implementation commits.

“No record found” means no independent review was located in those available records. It does not prove that no review occurred in another account, deleted session, or unavailable environment. An empty GitHub Reviews list also does not establish absence of review, because this workflow saved reviews in Codex and the repository. The Claude-authored review-pass comment on #59 was not counted as an independent Astra review.

Coverage is classified at the PR/revision level. Some shared code was inspected in later reviews—for example, the #60 report includes the live-feed parser originally introduced by #54. The gap therefore does not mean that every line in #54–59 had never been read by an independent reviewer; it means a review covering each shipped PR could not be established.

There were **17 merged PRs, #54–70**, in the window. PR #54 merged at 00:00:27 Eastern on October 7; its preceding-evening implementation is included because the request concerns what shipped yesterday.

| PR | Shipped work | Independent coverage found | Gap audited here |
| --- | --- | --- | --- |
| [#54](https://github.com/ewyluda/macrogauge/pull/54) | Live AI/data-center news export, pipeline, page, and strip | No record found | Entire PR and integration with the later news presentation |
| [#55](https://github.com/ewyluda/macrogauge/pull/55) | Remove portfolio/project-controls; reorganize navigation | No record found | Entire PR |
| [#56](https://github.com/ewyluda/macrogauge/pull/56) | AI-first homepage and DC methodology | No record found | Entire PR, current promoted readings, and methodology claims |
| [#57](https://github.com/ewyluda/macrogauge/pull/57) | Clip stale ECharts painter overflow | No record found | Chart containment change |
| [#58](https://github.com/ewyluda/macrogauge/pull/58) | Resize charts using ResizeObserver | No record found | Chart sizing/lifecycle change |
| [#59](https://github.com/ewyluda/macrogauge/pull/59) | Escalation path chart, default horizon, and merged grading page | No record found | Entire PR, including its implementation follow-up |
| [#60](https://github.com/ewyluda/macrogauge/pull/60) | News clustering, relevance, and headline presentation | Astra through `d14b0aa` | Later fix `7634ceb` |
| [#61](https://github.com/ewyluda/macrogauge/pull/61) | Compute roster and cloud GPU prices | Astra through `360b7a6` | Later fix `b1a954b` and integration |
| [#62](https://github.com/ewyluda/macrogauge/pull/62) | Data-center hub and Power & Tariffs page | Astra through `4399a5c` | Later fix `7deef31` |
| [#63](https://github.com/ewyluda/macrogauge/pull/63) | Lead times, backlog, and mobile board | Astra through `7111a57` | Later fix `717b0ff` |
| [#64](https://github.com/ewyluda/macrogauge/pull/64) | Capacity headline, business groups, and valuation scatter | Astra through `41d62f2` | Later fix `1f6d04e` |
| [#65](https://github.com/ewyluda/macrogauge/pull/65) | Build Inputs page and dated stand-ins | Astra through `ef04f26` | Later fix `6818d26` |
| [#66](https://github.com/ewyluda/macrogauge/pull/66) | Market headcount trends and capacity labeling | Astra through `502c882` | Later fix `522e752` |
| [#67](https://github.com/ewyluda/macrogauge/pull/67) | State site-cost comparisons | Astra through `5414ab9` | Later fix `2a46cbc` |
| [#68](https://github.com/ewyluda/macrogauge/pull/68) | Cost of Capital page and rates data | Astra through `cbd0be9` | Later fix `84f86d5` |
| [#69](https://github.com/ewyluda/macrogauge/pull/69) | Index Ledger and provenance links | Astra through `79623ff` | Later fix `9f78e48` |
| [#70](https://github.com/ewyluda/macrogauge/pull/70) | C&W market construction totals | Astra reviewed `bca5c27`, implemented and validated `8b31f93` | No equivalent unreviewed implementation gap found |

The post-review fixes in #60–69 were intended to address the prior findings. Their existence is not itself a defect; it establishes that the final implementation was not covered by the earlier reviewed hash. This audit checked those changes and their resulting integration. The existing reports remain useful historical evidence, rather than certificates for later commits.

The three daily publication commits in the window were `215951b` (08:49 Eastern), `7936a6a` (14:52), and `f58df0d` (23:33). Validation used the last publication so newly published data could exercise features that earlier PR tests had skipped or run against older artifacts.

## 2. Findings, ordered by priority

P2 denotes a defect that should be corrected in normal development; P3 denotes a lower-priority accuracy or accessibility defect. Ordering within a severity reflects the practical impact assessed in this audit. Controlled headlines below are synthetic test inputs, not assertions that those business events occurred.

### F1 — P2: Edited escalation links lose the default forward estimate

**Origin:** #59. **Evidence:** reproduced through the built application in the browser, using the committed data.

**Location:** [`site/src/components/DcEscalationClient.tsx:97–112`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/DcEscalationClient.tsx#L97-L112).

On a bare visit, `deliveryRaw === "auto"` produces a delivery month 24 months beyond the last full print. That effective month is never written to the URL. `bareVisit` is determined once, on mount, from the presence of any calculator-state query parameter. Editing cost subsequently writes `?cost=...` while leaving the current session's automatic delivery intact. Loading that same address anew interprets the absent delivery as a historical-only link.

**Reproduction:**

1. Open `/escalation` with no query parameters.
2. At the reviewed publication, the base month is `2024-08` and automatic delivery is `2028-08`.
3. Change base cost from $9,000,000 to $10,000,000 without editing delivery.
4. The address becomes `/escalation?cost=10000000`; the displayed projected cost is **$12,925,764**, with the forward leg and P80 information.
5. Reload that address, or open it in a new tab.
6. Delivery is now empty. The forward result/P80 disappear; only the measured **$11,545,291** cost remains.

**Impact:** a shared/bookmarked calculator URL does not reproduce the estimate its sender saw. This is not rounding or a changed data publication: the browser reproduction used the same static export.

**Correction:** serialize the effective delivery when a user creates calculator state from an automatic-default visit, or explicitly encode the automatic mode. Preserve any intentional compatibility behavior for genuinely older links lacking delivery.

**Acceptance check:** start bare, modify cost/base/index/basis separately, reopen each resulting address in a fresh page, and require the same effective delivery, projected result, and allowance. Retain a separate test for the intended semantics of pre-existing historical-only links.

### F2 — P2: Hardware methodology falsely distinguishes its inputs from quality-adjusted indexes

**Origin:** #56. **Evidence:** the published wording, configured series, and primary BLS methodology.

**Location:** [`site/src/components/DcMethodology.tsx:127–129`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/DcMethodology.tsx#L127-L129); [`config/dc_basket.json:32–36`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/config/dc_basket.json#L32-L36).

The new explanation says DC Hardware uses transaction-based import and producer prices rather than quality-adjusted computer indexes, then uses that distinction to explain why it would avoid understating what buyers pay. The configured basket includes a **38% weight in imported computers/peripherals excluding semiconductors (`IR213COM`)**, as well as semiconductor, storage, and network producer/import series.

BLS states that its computer import prices are adjusted for product quality, including use of hedonic models when respondent estimates are unavailable. BLS also describes PPI as a constant-quality index and explains that changes in item quality are removed from measured price changes. Being based on transactions does not make a series free of quality adjustment. Sources checked October 8, 2026: [BLS computer import/export methodology](https://www.bls.gov/mxp/publications/additional-publications/computer-facts.htm) and [BLS PPI quality adjustment](https://www.bls.gov/ppi/quality-adjustment/home.htm).

**Impact:** readers may interpret DC Hardware as measuring unadjusted procurement dollars on a premise that the underlying source definitions do not support. This finding establishes a disclosure/interpretation error; it does **not** establish an arithmetic error in the aggregate or independently quantify the adjustment's effect on this basket.

**Correction:** describe the actual constant-quality source measures and their limitations for nominal procurement budgets. Any stronger claim that this basket tracks buyers' cash costs better needs separate evidence.

**Acceptance check:** reconcile the methodology with each configured source's definition; remove the implication that importing transaction-based PPI/MXP data eliminates quality adjustment.

### F3 — P2: Homepage promotion drops source dates and stale status

**Origin:** #56, including integration with the stale GPU flag added in #61. **Evidence:** committed PJM artifact plus a schema-valid controlled GPU fixture rendered through the actual homepage component.

**Location:** [`site/src/components/HomeAiBrief.tsx:45–61`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/HomeAiBrief.tsx#L45-L61).

The PJM homepage reading uses `avg30` and `avg30_yoy_pct` without displaying its own `asof`. The H100 reading uses its quote and 30-day change without consulting `stale` or displaying `as_of`. Publication elsewhere on the homepage cannot establish freshness for these individual observations.

**Observed/controlled evidence:**

| Case | Source state | Homepage result |
| --- | --- | --- |
| Committed PJM Western Hub | `asof: 2026-09-29`, `avg30: 85.72`, `avg30_yoy_pct: 61.9` | `$85.72/MWh`, `30-day avg · +61.9% vs a year ago`; no observation date |
| Controlled H100 | Existing `vast_h100_sxm` quote, with `stale: true` and `as_of: 2026-09-01` | `$2.18/hr`, `vast.ai median · +36.0% in 30 days`; no quote date or stale qualification |

The GPU fixture was changed only in memory, validated against the reviewed compute schema, and rendered using `HomeAiBrief`. No published artifact was overwritten. The stale GPU scenario is a supported degraded state, not a claim that the committed GPU quote was actually stale.

**Impact:** delayed or explicitly stale data is presented with the same appearance and recent-period wording as a current observation. Corrections to detailed-page freshness do not fix this independently constructed homepage summary.

**Correction:** carry observation dates and freshness state into each promoted reading; qualify or omit stale comparisons consistently with the detailed page.

**Acceptance check:** render mixed-date hub data and a schema-valid stale GPU quote; require the dates/stale status in the corresponding card itself, not merely somewhere else on the page.

### F4 — P2: A malformed timestamp accepted from the live feed crashes rendering

**Origin:** #54. **Evidence:** controlled malformed input executed through the actual parser and story/day grouping functions.

**Location:** [`site/src/lib/news.ts:31–34`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/news.ts#L31-L34), [`news.ts:109–116`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/news.ts#L109-L116).

`parsePost` checks the timestamp's string pattern, not whether it describes a valid date. A normal infrastructure post with `ts: "2026-99-99T12:00:00Z"` passes this check. The live object bypasses the Python publication pipeline, making the browser parser the relevant boundary.

**Reproduction sequence:**

```text
parseLiveFeed(valid feed envelope containing the invalid-date post)
  -> accepts one post
clusterStories(accepted.posts)
groupByEtDay(stories, story => story.latest)
  -> RangeError: Invalid time value
```

The exception occurs while formatting an invalid `Date`. The asynchronous fetch `try/catch` does not protect the later React render. News rendering paths call these date helpers, including the `/news` page and data-center news display.

**Impact:** one malformed upstream timestamp can replace otherwise usable content with a rendering failure. No production incident was observed; this is a demonstrated input-validation failure.

**Correction:** validate actual date/time values before accepting a post; if strict calendar validity is intended, reject normalized impossible dates as well as `NaN` parses. Keep valid posts or the prior snapshot available.

**Acceptance check:** feed a mixture of valid and malformed dates through parsing and actual presentation helpers; invalid posts should be rejected without throwing or discarding valid items.

### F5 — P2: A future-dated feed prevents recovery through normal polling

**Origin:** #54. **Evidence:** controlled feed-selection reproduction; status rendering verified against its code path.

**Location:** [`site/src/lib/news.ts:65–94`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/news.ts#L65-L94); [`site/src/components/NewsFeed.tsx:65–75`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/NewsFeed.tsx#L65-L75).

`parseLiveFeed` accepts any parseable `generated_at`; it has no future-time bound. `pickNewer` thereafter accepts only strictly later timestamps. A negative age also satisfies the status component's `ageH <= 1` test, and relative time clamps it to “just now.”

**Reproduction:** start with a valid 2026 feed, offer an otherwise valid feed generated `2030-01-01T00:00:00Z`, then offer a healthy feed generated in 2026. The selected timestamp is 2030 after both updates. Subsequent healthy publications cannot displace that selection while the component retains its state.

**Impact:** an erroneous future timestamp can freeze an open page's news while it appears live. This was a controlled test, not an observed production outage.

**Correction:** enforce a reasonable future-clock allowance at the client boundary, consistent with producer policy, and allow recovery if the currently selected feed itself violates validity/freshness rules. Do not classify a materially future timestamp as live.

**Acceptance check:** inject the clock, reject excessive future timestamps, allow reasonable skew if required, and demonstrate that a healthy feed can recover from an invalid currently selected feed.

### F6 — P2: Sentence-case cancellation flashes are still treated as stubs

**Origin:** #60's final remediation. **Evidence:** controlled headline fixtures executed through `noiseReason`, `infraScore`, and `isInfra`.

**Location:** [`site/src/lib/newsTape.ts:53–60`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/newsTape.ts#L53-L60).

The substantive-name heuristic looks for capitalized words only **after the first word**. Headline-only posts under eight words are classified as stubs when there is no digit, cashtag, or qualifying later capitalized word. A properly capitalized company name at the start therefore does not count.

| Controlled headline (`points: []`) | `noiseReason` | Infrastructure score | `isInfra` |
| --- | --- | --- | --- |
| `Nvidia halts chip shipments` | `stub` | 2 | false |
| `Microsoft cancels nuclear power agreement` | `stub` | 2 | false |
| `NVIDIA HALTS CHIP SHIPMENTS` | null | 2 | true |

**Impact:** substantive supply interruptions/cancellations disappear from the default infrastructure view based on capitalization. The noise classification also prevents the item from joining a fuller report. The earlier review caught the short-flash problem; the final fix admits uppercase examples but leaves this sentence-case variant.

**Correction:** recognize the subject/action independently of presentation case and first-word placement, using available ticker/entity context where appropriate while retaining genuine section-title exclusions.

**Acceptance check:** require equivalent sentence-case and uppercase company/action flashes to survive with empty points, while short non-story section headers remain excluded.

### F7 — P2: Separate campuses still collapse into one story when their capacities match

**Origin:** #60's final remediation. **Evidence:** controlled pair executed through `sameStory` and `clusterStories`.

**Location:** [`site/src/lib/newsTape.ts:225–233`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/newsTape.ts#L225-L233).

The fix vetoes disjoint capacities/deal amounts, but matching figures require only modest word overlap. Generic project wording is enough to merge events whose locations differ.

**Reproduction:** give the following two posts the same MSFT ticker and timestamp:

```text
Microsoft opens 500 MW data center in Texas
Microsoft opens 500 MW data center in Finland
```

`sameStory` returns `true`; `clusterStories` returns one story.

**Impact:** separate projects become one counted story, with one moved into folded updates; project figures and default presentation can be understated. This is a residual event-identity problem after the original clustering review, not proof that every similar headline should remain separate.

**Correction:** matching company, amount, and generic verbs should not override conflicting project/location identity. Use a conservative merge rule when distinct entities or sites are present.

**Acceptance check:** two equal-capacity campuses in different named locations remain separate; true rewrites of the same named project still cluster.

### F8 — P2: The numbers strip discards distinct deals even when clustering separates them

**Origin:** #60's final remediation. **Evidence:** controlled infrastructure stories executed through the full helper sequence.

**Location:** [`site/src/lib/newsTape.ts:298–307`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/lib/newsTape.ts#L298-L307).

After clustering, `topFigures` applies an independent deduplication rule: equal figure value plus any shared ticker means duplicate. It does not require the stories to describe the same event.

**Reproduction:** same MSFT ticker and timestamp, empty supporting points:

```text
Microsoft signs $5 billion contract with Duke Energy for nuclear electricity
Microsoft acquires chipmaking startup for $5 billion to expand semiconductor fabrication
```

Both qualify as infrastructure. `sameStory` is `false` and clustering produces **two stories**. Nevertheless, `topFigures(stories, "dollars", 4)` produces only **one $5 billion figure**. The available four slots do not explain the omission.

**Impact:** the numbers strip silently suppresses independent transactions, even after the story classifier has correctly kept them separate. This is distinct from F7 and requires fixing the second deduplication stage.

**Correction:** tie deduplication to event identity rather than company/amount equality alone. Preserve the intended handling of repeated reports of one deal across days.

**Acceptance check:** retain both equal-sized independent transactions, while repeated reports of a single transaction still occupy one slot.

### F9 — P3: Quality-hold documentation promises a broader gate than the engine implements

**Origin:** #56. **Evidence:** direct documentation/engine comparison and the existing official-print control test.

**Location:** [`site/src/components/DcMethodology.tsx:132–133`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/DcMethodology.tsx#L132-L133); [`pipeline/engine/dcindex.py:160–171`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/pipeline/engine/dcindex.py#L160-L171).

The methodology says a newly arrived observation moving more than 5% waits one day before entering the index. The implementation invokes the gate only for an active live-proxy tail; official observations are expressly trusted and never held. `test_official_print_not_gated_when_proxy_tail_is_empty` in `tests/test_dcindex.py` protects that deliberate distinction.

**Impact:** readers are promised a data-quality protection that does not apply to official series. This is a documentation mismatch, not evidence that the engine should change its official-data policy.

**Correction:** state explicitly that the gate concerns qualifying live-proxy-tail observations, with official prints outside that hold.

**Acceptance check:** reconcile the published description with both the proxy-tail hold test and the official-print bypass test.

### F10 — P3: The escalation chart's accessible summary reports band thickness as the range

**Origin:** #59. **Evidence:** browser accessibility output plus inspection of the stacked chart series.

**Location:** [`site/src/components/EscalationPathChart.tsx:59–66`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/EscalationPathChart.tsx#L59-L66), [`EscalationPathChart.tsx:94–97`](https://github.com/ewyluda/macrogauge/blob/f58df0da95289e395548722f0931b4fc1a9e8dae/site/src/components/EscalationPathChart.tsx#L94-L97).

The visual interval is implemented as an invisible p10 floor plus a stacked `p90 - p10` shading series. The generic accessible summary reads the raw shading-series value under its name, “Realized range (p10–p90),” because this chart supplies a title but no semantic override for those internal series.

**Observed default example:** the accessible description reports approximately **$10,323,446** for p10 and **$2,083,088** as the realized range. The actual endpoints are approximately **$10,323,446–$12,406,534**; $2,083,088 is the width of the interval, not the projected cost range. In the $10 million base-cost case, the analogous values are $11,470,495 and a $2,314,542 gap.

**Impact:** screen-reader users receive an incorrect representation of the uncertainty interval even though the stacked chart can look correct.

**Correction:** supply an accessible chart summary with the p10/p90 endpoint costs and labels, excluding the internal shading series from the semantic description.

**Acceptance check:** assert the actual endpoint values in the accessible name/description and ensure the shading gap is not labeled as the range itself.

## 3. Verification performed and passing controls

Tests ran against a temporary export of the reviewed Git revision. Existing installed dependencies were reused. The application checkout and committed artifacts/store were not rewritten for fixtures or builds. Synthetic probes executed the actual TypeScript helpers and rendered the actual homepage component rather than implementing substitutes for their behavior.

| Check | Result at the reviewed revision |
| --- | --- |
| Python suite (`python -m pytest -q`, using the repository virtual environment) | **1,265 passed** in 61.08 seconds |
| Frontend unit tests (`npm test`, from `site/`) | **388 passed**, 50 files |
| ESLint (`npm run lint`) | Passed |
| Static production export (`npm run build`) | Passed |
| Full browser suite (`npm run e2e`) | **229 passed, 1 failed**; failure was the expected build-SHA link missing from an archive with no `.git` metadata |
| Rebuild with `VERCEL_GIT_COMMIT_SHA=f58df0da95289e395548722f0931b4fc1a9e8dae`, then rerun the affected Index Ledger browser test | **1 passed** |
| Independent reconstruction of ledger provenance mappings from pinned Git artifacts | **74 checked, zero mismatches** |
| Browser calculator interaction | Confirmed F1 and the accessible-summary issue in F10 |
| Actual-helper controlled inputs | Confirmed F4–F8 |
| Schema validation and homepage rendering of stale GPU fixture | Confirmed F3's supported stale-data path |
| BLS primary methodology comparison | Confirmed F2 |

The browser result is deliberately reported as a full run plus an environment-corrected targeted rerun, **not** as a single uninterrupted 230-test passing run. The missing SHA was specific to the audit archive; no application change was needed to address it.

The suites do not cover the adverse states and semantic mistakes in every finding above. Passing them establishes useful controls but does not invalidate the independently reproduced defects.

No additional actionable regression was established in the navigation removals (#55), chart clipping/resizing changes (#57–58), or the reviewed remediation paths in #62–69. The #69 provenance follow-up received an independent content check: `row_from_artifacts` reconstructed all 74 mapped records from their cited Git artifacts without a mismatch. The earlier broken-provenance finding is therefore not repeated as unresolved in this report.

## 4. Reproduction guidance for a remediation pass

Use the pinned revision when reproducing these historical findings; do not assume today's generated data will produce the same dollar values. A temporary `git archive` export is sufficient for pure-helper and rendering checks. For browser checks in such an export, supply the reviewed commit through `VERCEL_GIT_COMMIT_SHA` so that the lack of a `.git` directory does not create the audit-only ledger failure.

For the controlled news cases, the audit used this common post shape, changing the headline, timestamp, or feed-generation timestamp as described in each finding:

```javascript
const post = {
  id: "unique-per-post",
  ts: "2026-10-07T12:00:00Z",
  category: "company",
  kind: "text",
  headline: "Microsoft opens 500 MW data center",
  points: [],
  tickers: [{ ticker: "MSFT", layer: "Cloud Delivery" }],
  impacted: [],
  url: null,
  has_media: false,
};
const feed = {
  schema: "macrogauge.ai_news.v1",
  generated_at: "2026-10-08T12:00:00Z",
  source: { tape_last_post_at: "2026-10-07T12:00:00Z" },
  posts: [post],
};
// parseLiveFeed(feed, ["Cloud Delivery"])
// For pairs, assign distinct IDs to both posts.
```

The ticker metadata was held constant to isolate headline filtering/clustering behavior; these are mechanical fixtures, not real ticker/event attribution. For F6, the relevant functions' observed difference is caused by headline case, as shown in its table.

For F3, clone the pinned `compute.json` in memory, find `gpus[].code === "vast_h100_sxm"`, set `stale = true` and `as_of = "2026-09-01"`, validate the clone against `schemas/compute.schema.json`, and provide it to the unchanged `HomeAiBrief` renderer. Inspect the `/compute` reading itself; an unrelated date elsewhere in the complete homepage does not qualify that GPU card.

The initial audit kept probe scripts and full suite logs in temporary storage. This report preserves their relevant inputs, outputs, counts, and reproduction steps; it does not depend on those temporary files remaining available and does not claim they were committed as evidence sidecars.

## 5. Review-record references and limits

Existing repository reports for the independently reviewed PRs:

- [PR #60 review](2026-10-07-pr-60-review.md)
- [PR #61 review](2026-10-07-pr-61-review.md)
- [PR #62 review](2026-10-07-pr-62-review.md)
- [PR #63 review](2026-10-07-pr-63-review.md)
- [PR #64 review](2026-10-07-pr-64-review.md)
- [PR #65 review](2026-10-07-pr-65-review.md)
- [PR #66 review](2026-10-07-pr-66-review.md)
- [PR #67 review](2026-10-07-pr-67-review.md)
- [PR #68 review](2026-10-07-pr-68-review.md)
- [PR #69 review](2026-10-07-pr-69-review.md)
- [PR #70 review](2026-10-07-pr-70-review.md)

For traceability, the corresponding local Codex session IDs checked were:

| PR | Session ID |
| --- | --- |
| #60 | `01a1172b-ec05-7c82-91ac-fd9d5408d875` |
| #61 | `01a1177b-6edc-76d0-ad60-0ab53b5c154d` |
| #62 | `01a1182a-04e7-7151-9943-deb22dd2ba31` |
| #63 | `01a11854-bd83-7703-998f-2f5d97cd8b1e` |
| #64 | `01a118a4-009b-7470-baa5-41e0be3ffdc4` |
| #65 | `01a118d9-d8e4-7213-84c8-6c3c9f5ed9b4` |
| #66 | `01a118fa-3239-7212-9581-151485938f9b` |
| #67 | `01a11915-1d33-7d21-aa30-fab6ae6a4b89` |
| #68 | `01a11935-e0d5-74d2-ac69-b6d0bf2fb906` |
| #69 | `01a11955-7fe0-7c52-bc96-2a4c844f5fa3` |
| #70 | `01a1197b-92cc-7f23-8e11-9b507c344c17` |

Coverage conclusions are bounded by accessible records. Runtime findings distinguish observed committed-data behavior from controlled adverse-input behavior; neither the malformed/future feed fixtures nor synthetic news headlines establish that a corresponding production incident occurred. This audit is not a new verification of every historical economic input, a complete security audit, or a certification that no additional bugs exist. Later data/code changes need their own validation before any finding is marked resolved.
