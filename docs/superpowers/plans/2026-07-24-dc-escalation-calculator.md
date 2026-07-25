# DC Escalation Calculator (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking. TDD every task: failing test first, watch it fail, minimal code, full suite green before
> each commit. Commit per task. **Do NOT push without the user's explicit approval (push = production deploy).**

**Goal:** Ship `/escalation` — a calculator where a Project Controls user enters their own base cost and
base month and gets it escalated by the DC Build index, with a component-level bridge that sums exactly
to the headline escalation.

**Architecture:** The escalation math is a pure, unit-agnostic ratio over the DC Build index, so it lives
in `site/src/lib/dcEscalation.ts` with colocated vitest tests (mirrors `lib/since.ts` + `since.test.ts`).
The component bridge needs per-component index *history*, which `datacenter.json` does not publish today —
so Tasks 1–2 add a monthly sample grid to the engine and publisher first. The page is a server component
that slices the monthly arrays out of `datacenter.json` and hands a small prop to a client component
(the `deck/page.tsx` pattern), so there is no client fetch of the 517KB file and no loading state.

**Tech Stack:** Python 3.12 (pipeline, pytest), Next.js static export + TypeScript (site), vitest (unit),
Playwright (e2e).

## Scope, locked

Decided with the user 2026-07-24 — do not re-litigate during implementation:

- **DC Build only.** Not Ops (monthly, lags Build by ~7 weeks), not Hardware (OEM/procurement story,
  explicitly out of scope for this audience per the gap register).
- **Historical only.** Base month → latest publish. **No forward leg.** The forward curve is P3, is a
  sibling engine rather than a re-point, has 8.5% forward-driver coverage, and must clear its own
  backtest gate before publishing. When it lands it plugs into this same lib and component as an
  additional segment — this build is a strict subset, not a throwaway.
- **No location input.** Escalation is national. State parity multipliers are *level* multipliers (cost
  vs national), not escalation rates; the user's base cost for a real site already embeds local pricing,
  so applying `build_mult` would double-count location. Do not add a state selector to this page.
- **No volatility band.** No DC-specific sigma is published. Belongs with P3.

## ⚠ One deviation from "zero pipeline work" — read before starting

The user chose P1 on the understanding it was pure client-side. **Tasks 1–2 are pipeline changes.** Here
is why, and what the fallback is if you want to cut them:

`datacenter.json` publishes components as a **point-in-time snapshot only** — `weight`, `yoy_pct`
(trailing 12mo at the component's own last obs), `contribution_pp`. There is **no per-component index
history**, so a bridge over an arbitrary base month cannot be computed from published data. Verified in
`pipeline/publish/datacenter.py:25-33`.

Headline escalation alone *does* work with zero pipeline change (the `dates`/`index` arrays are already
published). So:

- **Full plan (recommended, this document):** add a monthly sample grid → exact bridge, the feature that
  makes this useful to a cost engineer. Cost: ~20KB added to `datacenter.json`, two small pipeline tasks.
- **Fallback if you want site-only:** implement Tasks 3, 5, 6 only, drop the bridge table, and ship
  headline escalation. Task 4 and the bridge column then become a follow-up. **Say so explicitly if you
  take this path** — the gap register's P1 acceptance criterion ("bridge rows sum to the headline delta")
  would not be met.

## The math, and why the bridge is exact

`pipeline/engine/aggregate.py:23-31` — `headline()` is `Σ(w_k · i_k(d)) / Σw`, and basket weights are
validated to sum to 1.0. So the index is **exactly linear in its components**:

```
I(t) = Σ_c  w_c · i_c(t)
```

Therefore for base month `b` and latest month `T`:

```
headline escalation %      = 100 · (I(T) − I(b)) / I(b)
component c's contribution = 100 · w_c · (i_c(T) − i_c(b)) / I(b)     [pp of the headline]
Σ_c contribution_pp        = headline escalation %                     [exact, by construction]
```

Weights are fixed (Laspeyres, from `config/dc_basket.json`), so there is no weight-drift residual term.
**This identity is the feature.** Task 1 pins it in pytest; Task 4 pins it in vitest.

**Why monthly, not daily.** The identity only holds if the headline and every component are sampled on the
*same* grid day. Publishing a monthly grid where `index[m]` and `components[c][m]` both come from the last
daily-grid date in month `m` guarantees that. It also matches the domain: a cost basis is "our Q1 2024
estimate," not March 14th. The UI therefore takes a **month** input (`<input type="month">`), not a date.

## Global Constraints

Repo invariants from `CLAUDE.md` — every task's requirements implicitly include these:

- **HTTP is injected, never real, in tests.** No test may hit the network.
- **Store rows are append-only and schema-versionless.** Never rewrite a committed partition. (No store
  changes in this plan.)
- **Every published file validates inline against `schemas/<stem>.schema.json`.**
  `jsonschema.ValidationError` re-raises and fails the run — caught *before* the generic `Exception`.
  This ordering is pinned by tests; do not reorder.
- **Schemas must legally allow degraded output** (nulls / empty arrays) — see the datacenter parity
  `mode: "unavailable"` precedent.
- **Engine stages are pure dict→dict functions.** Test them directly, no store needed.
- **Component YoY is computed at each component's OWN last observation, not the grid end.** Do not
  "fix" this while working in `dcindex.py`.
- Full suite must be green before each commit: `pytest -q` (root) and `cd site && npm test`.
- **Do not push.** Push = production deploy and requires explicit user approval.

**Known local hazard:** `npm run e2e` has hit `EPERM` binding port 4173 and Playwright headless-Chromium
sandbox errors on this Mac. If e2e cannot run locally, say so plainly in the task report and rely on CI
(`.github/workflows/ci.yml` runs it) — **do not claim e2e passed if it did not run.**

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `pipeline/engine/dcindex.py` (modify) | Emit a `monthly` sample grid per index: months, headline, per-component | 1 |
| `tests/test_dcindex.py` (modify) | Pin the monthly grid + the Laspeyres identity | 1 |
| `pipeline/publish/datacenter.py` (modify) | Publish `monthly`, filtered to `PUBLISH_START`, rounded | 2 |
| `schemas/datacenter.schema.json` (modify) | Type the `monthly` block | 2 |
| `tests/test_publish_datacenter.py` (modify) | Pin published shape + rounded identity | 2 |
| `site/src/lib/dcEscalation.ts` (create) | Pure escalation + bridge math | 3, 4 |
| `site/src/lib/dcEscalation.test.ts` (create) | Unit tests incl. the sum identity | 3, 4 |
| `site/src/components/DcEscalationClient.tsx` (create) | Inputs, KPI cards, bridge table | 5 |
| `site/src/app/escalation/page.tsx` (create) | Server slice of `datacenter.json` + methodology copy | 5 |
| `site/src/lib/nav.ts` (modify) | Add `/escalation` under the AI Infra group | 5 |
| `site/e2e/smoke.spec.ts` (modify) | Route renders, zero console errors | 6 |

---

### Task 1: Engine — monthly sample grid

**Files:**
- Modify: `pipeline/engine/dcindex.py` (inside `run()`, after `index` is computed — around line 92-128)
- Test: `tests/test_dcindex.py`

**Interfaces:**
- Produces: each `out[name]` gains a `"monthly"` key:
  `{"months": list[str],            # "YYYY-MM", ascending`
  `  "index": list[float],           # headline at that month's sample day`
  `  "components": dict[str, list[float]]}  # code -> level at the same sample day`
  Task 2 consumes this.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_dcindex.py`. Reuse whatever fixture builder the file already uses for `run()`; the
assertions below are what matters.

```python
def test_monthly_grid_samples_last_grid_day_and_preserves_laspeyres_identity():
    """monthly.index[m] must equal sum(w_c * monthly.components[c][m]) exactly —
    the escalation bridge's contributions only sum to the headline because of this."""
    result = _run_dcindex_fixture()          # existing helper in this file
    build = result["indexes"]["build"]
    mo = build["monthly"]

    assert mo["months"] == sorted(mo["months"])
    assert len(mo["index"]) == len(mo["months"])
    for code, vals in mo["components"].items():
        assert len(vals) == len(mo["months"]), f"{code} length mismatch"

    weights = {code: c["weight"] for code, c in build["components"].items()}
    assert set(mo["components"]) == set(weights)
    for i, month in enumerate(mo["months"]):
        recomputed = sum(weights[c] * mo["components"][c][i] for c in weights)
        assert recomputed == pytest.approx(mo["index"][i], abs=1e-9), (
            f"Laspeyres identity broken at {month}")

    # the sample day is the LAST daily-grid date within each month
    last_month = mo["months"][-1]
    assert build["as_of"][:7] == last_month
    assert mo["index"][-1] == pytest.approx(build["index"][build["as_of"]], abs=1e-9)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_dcindex.py::test_monthly_grid_samples_last_grid_day_and_preserves_laspeyres_identity -q`
Expected: FAIL with `KeyError: 'monthly'`

- [ ] **Step 3: Write minimal implementation**

In `pipeline/engine/dcindex.py`, inside the per-index loop, after `index = aggregate.headline(daily, weights)`
and before `out[name] = {...}`, insert:

```python
        # Monthly sample grid for the escalation calculator. The headline and every
        # component are sampled on the SAME day (the last daily-grid date in each
        # month), which is what keeps the Laspeyres identity exact:
        #   monthly.index[m] == sum(w_c * monthly.components[c][m])
        # The escalation bridge's per-component contributions sum to the headline
        # escalation only because of that. Sampling them independently would break it.
        month_days: dict[str, str] = {}
        for d in sorted(index):      # index keys are the all-components-present grid
            month_days[d[:7]] = d    # later date within the month wins
        months_sorted = sorted(month_days)
        monthly = {
            "months": months_sorted,
            "index": [index[month_days[m]] for m in months_sorted],
            "components": {code: [daily[code][month_days[m]] for m in months_sorted]
                           for code in daily},
        }
```

Then add `"monthly": monthly` to the `out[name]` dict literal:

```python
        out[name] = {"index": index,
                     "yoy": aggregate.weighted_yoy(own_yoy, weights),
                     "as_of": end, "gate_flags": flags, "components": components,
                     "monthly": monthly}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_dcindex.py -q`
Expected: PASS, including all pre-existing tests in the file.

Then the full suite: `pytest -q`
Expected: PASS (630+ tests). `test_run_daily.py` exercises the real publisher path; if anything there
fails, it is because the publisher does not yet know about `monthly` — that is Task 2, and this task's
change is additive, so it should not break. If it does, read the failure before proceeding.

- [ ] **Step 5: Commit**

```bash
git add pipeline/engine/dcindex.py tests/test_dcindex.py
git commit -m "feat(dc): monthly sample grid on the DC indexes

Samples the headline and every component on the same daily-grid day (the
last in each month) so the Laspeyres identity holds exactly. Prerequisite
for the /escalation component bridge."
```

---

### Task 2: Publisher + schema — emit `monthly`

**Files:**
- Modify: `pipeline/publish/datacenter.py:14-33` (inside the `for name, v in dc_result["indexes"].items()` loop)
- Modify: `schemas/datacenter.schema.json` (the `indexes.additionalProperties` sub-schema)
- Test: `tests/test_publish_datacenter.py`

**Interfaces:**
- Consumes: `dc_result["indexes"][name]["monthly"]` from Task 1.
- Produces: `datacenter.json` → `indexes.build.monthly` = `{months, index, components}` with values
  rounded to 4dp and filtered to `PUBLISH_START`. Tasks 3–5 consume this.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_publish_datacenter.py`, matching the file's existing fixture style:

```python
def test_publishes_monthly_grid_filtered_and_rounded():
    payload = datacenter.build(_dc_result(), _parity(), {}, None, None, None)
    mo = payload["indexes"]["build"]["monthly"]

    assert mo["months"][0] >= "2018-01"          # PUBLISH_START, no 2017 warmup
    assert mo["months"] == sorted(mo["months"])
    assert len(mo["index"]) == len(mo["months"])
    for vals in mo["components"].values():
        assert len(vals) == len(mo["months"])

    # rounding must not break the identity by more than a hair
    weights = {c["code"]: c["weight"] for c in payload["indexes"]["build"]["components"]}
    assert set(mo["components"]) == set(weights)
    for i in range(len(mo["months"])):
        recomputed = sum(weights[c] * mo["components"][c][i] for c in weights)
        assert recomputed == pytest.approx(mo["index"][i], abs=0.01)


def test_monthly_grid_validates_against_the_schema():
    payload = datacenter.build(_dc_result(), _parity(), {}, None, None, None)
    schema = json.loads((Path("schemas") / "datacenter.schema.json").read_text())
    jsonschema.validate({"published_at": "2026-07-24T00:00:00Z", **payload}, schema)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_publish_datacenter.py -q -k monthly`
Expected: FAIL with `KeyError: 'monthly'`

- [ ] **Step 3: Write minimal implementation**

In `pipeline/publish/datacenter.py`, inside the index loop, after the `out["indexes"][name] = {...}`
assignment and before the `by_group` block, insert:

```python
        # Monthly grid for /escalation. PUBLISH_START is a date ("2018-01-01");
        # compare on its month prefix. 4dp keeps the Laspeyres identity within
        # 0.01 index points across 12 components — the bridge tolerance.
        mo = v["monthly"]
        keep = [i for i, m in enumerate(mo["months"]) if m >= PUBLISH_START[:7]]
        out["indexes"][name]["monthly"] = {
            "months": [mo["months"][i] for i in keep],
            "index": [round(mo["index"][i], 4) for i in keep],
            "components": {code: [round(vals[i], 4) for i in keep]
                           for code, vals in mo["components"].items()},
        }
```

In `schemas/datacenter.schema.json`, add `"monthly"` to the sub-schema's `required` array (alongside
`"components"`), and add this to its `properties`:

```json
"monthly": {
  "type": "object",
  "required": ["months", "index", "components"],
  "properties": {
    "months":     { "type": "array", "items": { "type": "string" } },
    "index":      { "type": "array", "items": { "type": "number" } },
    "components": {
      "type": "object",
      "additionalProperties": { "type": "array", "items": { "type": "number" } }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_publish_datacenter.py -q`
Expected: PASS

Run: `pytest -q`
Expected: PASS. `test_run_daily.py` validates the real artifact against the schema inline — if `monthly`
is required but some path does not emit it, that is where it surfaces.

- [ ] **Step 5: Regenerate the local artifact so the site has data to render**

```bash
FRED_API_KEY=${FRED_API_KEY:?set this} python -m pipeline.run_daily --store store --out site/public/data
```

Then confirm the new block landed and measure the size cost:

```bash
python3 -c "
import json; d=json.load(open('site/public/data/datacenter.json'))
mo=d['indexes']['build']['monthly']
print('months', len(mo['months']), mo['months'][0], '->', mo['months'][-1])
print('components', len(mo['components']))
w={c['code']:c['weight'] for c in d['indexes']['build']['components']}
i=len(mo['months'])-1
print('identity check:', round(sum(w[c]*mo['components'][c][i] for c in w),4), 'vs', mo['index'][i])
"
ls -la site/public/data/datacenter.json
```

Expected: ~103 months, 12 components, identity matches within 0.01, file grew ~20KB.

**If you cannot run the pipeline** (no `FRED_API_KEY`), say so and stop here — Tasks 3–6 need the
regenerated artifact. Do not hand-edit `datacenter.json`.

- [ ] **Step 6: Commit**

```bash
git add pipeline/publish/datacenter.py schemas/datacenter.schema.json \
        tests/test_publish_datacenter.py site/public/data/datacenter.json
git commit -m "feat(dc): publish the monthly index grid in datacenter.json

Adds indexes.*.monthly {months,index,components} filtered to PUBLISH_START
and rounded to 4dp. Schema updated and pinned. ~20KB."
```

---

### Task 3: Site lib — headline escalation math

**Files:**
- Create: `site/src/lib/dcEscalation.ts`
- Test: `site/src/lib/dcEscalation.test.ts`

**Interfaces:**
- Produces: `escalate(months, index, baseMonth, baseCost) -> EscalationResult | null` and the exported
  `EscalationResult` type. Task 4 adds `bridge()` to the same file; Task 5 imports both.

- [ ] **Step 1: Write the failing test**

Create `site/src/lib/dcEscalation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escalate } from "./dcEscalation";

// 2 years, index 100 -> 114.49 (a plausible DC Build path)
const MONTHS = ["2024-03", "2025-03", "2026-03"];
const INDEX = [100, 106.81, 114.49];

describe("escalate", () => {
  it("escalates a base cost by the index ratio", () => {
    const r = escalate(MONTHS, INDEX, "2024-03", 9_000_000)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.endMonth).toBe("2026-03");
    expect(r.monthsElapsed).toBe(24);
    expect(r.pct).toBeCloseTo(14.49, 2);
    expect(r.escalatedCost).toBeCloseTo(10_304_100, 0);   // 9M * 1.1449
    expect(r.deltaCost).toBeCloseTo(1_304_100, 0);
    expect(r.annualizedPct).toBeCloseTo(7.0, 1);           // 1.1449^(12/24) - 1
  });

  it("uses the nearest month at or before the base", () => {
    const r = escalate(MONTHS, INDEX, "2024-11", 100)!;
    expect(r.baseMonth).toBe("2024-03");
    expect(r.escalatedCost).toBeCloseTo(114.49, 2);
  });

  it("returns null before the series starts", () => {
    expect(escalate(MONTHS, INDEX, "2024-02", 100)).toBeNull();
  });

  it("does not divide by zero when base is the last month", () => {
    const r = escalate(MONTHS, INDEX, "2026-03", 100)!;
    expect(r.monthsElapsed).toBe(0);
    expect(r.pct).toBeCloseTo(0, 6);
    expect(r.annualizedPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/dcEscalation.test.ts`
Expected: FAIL — cannot resolve `./dcEscalation`

- [ ] **Step 3: Write minimal implementation**

Create `site/src/lib/dcEscalation.ts`:

```ts
export type EscalationResult = {
  baseMonth: string;
  endMonth: string;
  monthsElapsed: number;
  baseIndex: number;
  endIndex: number;
  pct: number;
  annualizedPct: number;
  escalatedCost: number;
  deltaCost: number;
};

/** Whole months between two "YYYY-MM" strings. */
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Index of the nearest month at or before `target`; -1 if target predates the series. */
export function monthIndexAtOrBefore(months: string[], target: string): number {
  let i = -1;
  for (let j = 0; j < months.length; j++) {
    if (months[j] <= target) i = j;
    else break;
  }
  return i;
}

/** Escalate a base cost by the index ratio. Unit-agnostic — the caller's $/MW,
 *  total project $, or any other denomination all ride the same ratio. */
export function escalate(
  months: string[],
  index: number[],
  baseMonth: string,
  baseCost: number
): EscalationResult | null {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return null;
  const last = index.length - 1;
  const ratio = index[last] / index[i];
  const monthsElapsed = monthDiff(months[i], months[last]);
  return {
    baseMonth: months[i],
    endMonth: months[last],
    monthsElapsed,
    baseIndex: index[i],
    endIndex: index[last],
    pct: (ratio - 1) * 100,
    annualizedPct: monthsElapsed > 0 ? (Math.pow(ratio, 12 / monthsElapsed) - 1) * 100 : 0,
    escalatedCost: baseCost * ratio,
    deltaCost: baseCost * (ratio - 1),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/dcEscalation.ts site/src/lib/dcEscalation.test.ts
git commit -m "feat(site): dcEscalation.escalate — unit-agnostic index-ratio escalation"
```

---

### Task 4: Site lib — component bridge

**Files:**
- Modify: `site/src/lib/dcEscalation.ts` (append)
- Test: `site/src/lib/dcEscalation.test.ts` (append)

**Interfaces:**
- Consumes: `monthIndexAtOrBefore` and `escalate` from Task 3.
- Produces: `bridge(months, componentIndex, components, baseMonth, baseCost) -> BridgeRow[]`, sorted by
  absolute contribution descending. Task 5 renders it.

- [ ] **Step 1: Write the failing test**

Append to `site/src/lib/dcEscalation.test.ts`:

```ts
import { bridge } from "./dcEscalation";

// two components, weights summing to 1 — headline is their weighted mean
const B_MONTHS = ["2024-03", "2025-03", "2026-03"];
const B_COMPONENTS = [
  { code: "steel", label: "Steel mill products", group: "materials", weight: 0.6 },
  { code: "switchgear", label: "Switchgear & switchboard", group: "electrical", weight: 0.4 },
];
const B_INDEX = {
  steel: [100, 110, 125],
  switchgear: [100, 102, 105],
};
// headline: .6*100+.4*100 = 100 -> .6*125+.4*105 = 117
const B_HEADLINE = [100, 106.8, 117];

describe("bridge", () => {
  it("contributions sum exactly to the headline escalation", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const headline = escalate(B_MONTHS, B_HEADLINE, "2024-03", 1_000_000)!;
    const summed = rows.reduce((a, r) => a + r.contributionPp, 0);
    expect(summed).toBeCloseTo(headline.pct, 6);   // 17.00
  });

  it("computes per-component escalation and cost attribution", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    const steel = rows.find((r) => r.code === "steel")!;
    expect(steel.componentPct).toBeCloseTo(25, 6);           // 100 -> 125
    expect(steel.contributionPp).toBeCloseTo(15, 6);         // 100 * .6 * 25 / 100
    expect(steel.contributionCost).toBeCloseTo(150_000, 0);  // 1M * .6 * 25 / 100
  });

  it("sorts by absolute contribution, largest first", () => {
    const rows = bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-03", 1_000_000);
    expect(rows.map((r) => r.code)).toEqual(["steel", "switchgear"]);
  });

  it("returns an empty array before the series starts", () => {
    expect(bridge(B_MONTHS, B_INDEX, B_COMPONENTS, "2024-02", 100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/dcEscalation.test.ts`
Expected: FAIL — `bridge` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `site/src/lib/dcEscalation.ts`:

```ts
export type BridgeComponent = {
  code: string;
  label: string;
  group: string;
  weight: number;
};

export type BridgeRow = BridgeComponent & {
  componentPct: number;      // the component's own escalation over the window
  contributionPp: number;    // its share of the headline escalation, in pp
  contributionCost: number;  // its share of the dollar delta
};

/** Decompose the headline escalation into per-component contributions.
 *
 *  The index is exactly linear in its components — aggregate.headline() is
 *  sum(w_c * i_c) with weights summing to 1 — so:
 *      contribution_c = 100 * w_c * (i_c(T) - i_c(b)) / I(b)
 *  and the contributions sum to the headline escalation with no residual.
 *  Weights are fixed (Laspeyres), so there is no weight-drift term.
 *
 *  I(b) is rebuilt from the components rather than read from the published
 *  headline so the identity survives the two arrays being rounded independently. */
export function bridge(
  months: string[],
  componentIndex: Record<string, number[]>,
  components: BridgeComponent[],
  baseMonth: string,
  baseCost: number
): BridgeRow[] {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return [];
  const last = months.length - 1;
  const headlineBase = components.reduce(
    (acc, c) => acc + c.weight * componentIndex[c.code][i],
    0
  );
  if (headlineBase === 0) return [];
  return components
    .map((c) => {
      const series = componentIndex[c.code];
      const delta = series[last] - series[i];
      return {
        ...c,
        componentPct: (series[last] / series[i] - 1) * 100,
        contributionPp: (100 * c.weight * delta) / headlineBase,
        contributionCost: (baseCost * c.weight * delta) / headlineBase,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd site && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/dcEscalation.ts site/src/lib/dcEscalation.test.ts
git commit -m "feat(site): dcEscalation.bridge — exact per-component decomposition

Contributions sum to the headline escalation with no residual, because the
DC index is linear in its components with fixed Laspeyres weights."
```

---

### Task 5: Page + client component + nav

**Files:**
- Create: `site/src/components/DcEscalationClient.tsx`
- Create: `site/src/app/escalation/page.tsx`
- Modify: `site/src/lib/nav.ts` (AI Infra group)

**Interfaces:**
- Consumes: `escalate`, `bridge`, `EscalationResult`, `BridgeRow`, `BridgeComponent` from Tasks 3–4;
  `KpiCard` (`label`, `value`, `context`, `accent`) and `Section` (`title`, `children`) from
  `@/components/*`; `fmtSigned`, `fmtPp` from `@/lib/format`.
- Produces: the `/escalation` route. Task 6 asserts it renders.

- [ ] **Step 1: Create the client component**

Create `site/src/components/DcEscalationClient.tsx`:

```tsx
"use client";
import { useState } from "react";
import { KpiCard } from "./KpiCard";
import { bridge, escalate, type BridgeComponent } from "@/lib/dcEscalation";
import { fmtPp, fmtSigned } from "@/lib/format";

export type EscalationData = {
  months: string[];
  index: number[];
  componentIndex: Record<string, number[]>;
  components: BridgeComponent[];
  asOf: string;
  rebase: string;
};

const usd = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : `$${Math.round(v).toLocaleString("en-US")}`;

export function DcEscalationClient({ data }: { data: EscalationData }) {
  const firstMonth = data.months[0];
  const lastMonth = data.months[data.months.length - 1];
  const [baseMonth, setBaseMonth] = useState(
    data.months[Math.max(0, data.months.length - 25)]
  );
  const [baseCost, setBaseCost] = useState(9_000_000);

  const result = escalate(data.months, data.index, baseMonth, baseCost);
  const rows = bridge(
    data.months,
    data.componentIndex,
    data.components,
    baseMonth,
    baseCost
  );
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.contributionPp)), 0.01);

  const input: React.CSSProperties = {
    background: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          BASE MONTH{" "}
          <input
            type="month"
            min={firstMonth}
            max={lastMonth}
            value={baseMonth}
            onChange={(e) => setBaseMonth(e.target.value)}
            style={input}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          BASE COST ($){" "}
          <input
            type="number"
            min={1}
            step={100000}
            value={baseCost}
            onChange={(e) => setBaseCost(Number(e.target.value))}
            style={{ ...input, width: 140 }}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          your own $/MW, or the whole project — the math is a ratio, so the unit is yours
        </span>
      </div>

      {!result && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: 24 }}>
          The index starts in {firstMonth}. Pick a later base month.
        </div>
      )}

      {result && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <KpiCard
              label={`Escalated to ${result.endMonth}`}
              value={usd(result.escalatedCost)}
              context={`from ${usd(baseCost)} in ${result.baseMonth} · DC Build index`}
              accent="sky"
            />
            <KpiCard
              label="Total escalation"
              value={fmtSigned(result.pct)}
              context={`${result.monthsElapsed} months · index ${result.baseIndex.toFixed(1)} → ${result.endIndex.toFixed(1)}`}
              accent={result.pct >= 0 ? "red" : "emerald"}
            />
            <KpiCard
              label="Annualized rate"
              value={`${result.annualizedPct.toFixed(2)}%/yr`}
              context="compound, over the window you chose"
              accent="violet"
            />
            <KpiCard
              label="Escalation dollars"
              value={usd(result.deltaCost)}
              context="the delta the bridge below decomposes"
              accent="amber"
            />
          </div>

          <div className="table-card" style={{ marginTop: 16 }}>
            <h2>
              What drove it{" "}
              <span className="subtitle">
                contributions sum to {fmtSigned(result.pct)} — the headline, exactly
              </span>
            </h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Weight</th>
                  <th>Its own escalation</th>
                  <th>Contribution</th>
                  <th>Of your delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td>{r.label}</td>
                    <td>{(r.weight * 100).toFixed(1)}%</td>
                    <td>{fmtSigned(r.componentPct)}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          verticalAlign: "middle",
                          height: 8,
                          borderRadius: 2,
                          width: `${(Math.abs(r.contributionPp) / maxAbs) * 90}px`,
                          background:
                            r.contributionPp >= 0
                              ? "var(--accent-red)"
                              : "var(--accent-emerald)",
                        }}
                      />
                      <span style={{ marginLeft: 6 }}>{fmtPp(r.contributionPp)}</span>
                    </td>
                    <td>{usd(r.contributionCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

Create `site/src/app/escalation/page.tsx`:

```tsx
import type { Metadata } from "next";
import dc from "../../../public/data/datacenter.json";
import { Section } from "@/components/Section";
import {
  DcEscalationClient,
  type EscalationData,
} from "@/components/DcEscalationClient";

export const metadata: Metadata = {
  title: "DC Escalation Calculator",
  description:
    "Escalate your own data-center cost basis by the DC Build index, with a component bridge that sums exactly to the headline.",
};

const build = dc.indexes.build;

// Slice only what the calculator needs — the monthly grid, not the 3,124-point
// daily series — so the page ships ~20KB instead of fetching the 517KB artifact.
const data: EscalationData = {
  months: build.monthly.months,
  index: build.monthly.index,
  componentIndex: build.monthly.components,
  components: build.components.map((c) => ({
    code: c.code,
    label: c.label,
    group: c.group,
    weight: c.weight,
  })),
  asOf: build.as_of,
  rebase: dc.rebase,
};

export default function Escalation() {
  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "24px 0 0" }}>
        DC Escalation Calculator{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 16 }}>
          escalate your own base cost by the DC Build index — and see exactly which
          packages moved it
        </span>
      </h1>
      <div style={{ marginTop: 24 }}>
        <DcEscalationClient data={data} />
      </div>
      <Section title="Methodology">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          This escalates <em>your</em> number. We publish an input-price index
          ({data.rebase}), not a turnkey $/MW quote — so the base cost is yours to supply,
          and the calculator only applies the ratio between two months of the DC Build
          index. Because the index is a fixed-weight Laspeyres aggregate, it is exactly
          linear in its components: each row&apos;s contribution is{" "}
          <code>weight × (component index change) ÷ base index</code>, and the rows sum to
          the headline escalation with no residual.
          {" "}The window runs to the index&apos;s latest observation ({data.asOf}).
          Escalation is national — state parity multipliers on{" "}
          <a href="/datacenter" style={{ color: "var(--accent-sky)" }}>/datacenter</a> are{" "}
          <em>level</em> multipliers (cost relative to the national average), not escalation
          rates; your base cost for a real site already embeds its location, so applying them
          here would count location twice.
          {" "}This is history, not a forecast: it measures what input prices have already
          done, and stops at the last print. See{" "}
          <a href="/methodology" style={{ color: "var(--accent-sky)" }}>methodology</a> for
          component sources and weights.
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Add the nav entry**

In `site/src/lib/nav.ts`, in the `AI Infra` group's `items` array, add after the `/capacity` entry:

```ts
          { href: "/escalation", label: "Escalation", emoji: "📐" },
```

- [ ] **Step 4: Verify the build and the unit suite**

```bash
cd site && npm run build && npm test
```

Expected: static export succeeds (`/escalation` appears in the route list), all vitest suites pass.
If the build fails on `build.monthly` being absent from the JSON type, Task 2's regeneration step did
not run — go back and run it.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/DcEscalationClient.tsx site/src/app/escalation/page.tsx site/src/lib/nav.ts
git commit -m "feat(site): /escalation — DC escalation calculator with component bridge"
```

---

### Task 6: e2e coverage + final verification

**Files:**
- Modify: `site/e2e/smoke.spec.ts`

- [ ] **Step 1: Add the route to the smoke list**

In `site/e2e/smoke.spec.ts`, add to the `ROUTES` array (the marker must be unique to the page body —
nav labels appear hidden on every page, so "Escalation" alone would match the nav link):

```ts
  ["/escalation", "the math is a ratio, so the unit is yours"],
```

- [ ] **Step 2: Add an interaction test**

Append to `site/e2e/smoke.spec.ts`, following the existing `my-inflation` interaction test's shape:

```ts
test("escalation calculator responds to a new base month", async ({ page }) => {
  await page.goto("/escalation");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Total escalation")).toBeVisible();
  await expect(page.getByText("What drove it")).toBeVisible();

  const before = await page.getByText("Total escalation").locator("..").innerText();
  await page.locator('input[type="month"]').fill("2019-01");
  const after = await page.getByText("Total escalation").locator("..").innerText();
  expect(after).not.toEqual(before);
});
```

- [ ] **Step 3: Run e2e**

Run: `cd site && npm run e2e`
Expected: all routes pass, zero console errors.

**If this fails with `EPERM` on port 4173 or a Playwright sandbox error**, that is the known local
hazard — report it plainly, note that CI covers e2e, and do not claim the suite passed.

- [ ] **Step 4: Full verification before reporting done**

Run all three, and paste the actual output in the task report:

```bash
pytest -q
cd site && npm run build && npm test && npm run e2e
```

Expected: pipeline suite green, static export succeeds, vitest green, Playwright green (or the
documented EPERM caveat).

- [ ] **Step 5: Commit**

```bash
git add site/e2e/smoke.spec.ts
git commit -m "test(site): e2e coverage for /escalation"
```

---

## Follow-ups this plan deliberately leaves open

- **P3 forward leg.** When the forward curve clears its backtest gate, it extends `escalate()` with a
  second segment (latest month → delivery month) and adds a band. The UI grows a "deliver by" input;
  nothing here is rebuilt. If P3 fails its gate, `/escalation` still stands on its own.
- **`/datacenter` cross-link.** A "escalate your own basis →" link from the DC Build KPI card. One line,
  not worth a task.
- **CSV export of the bridge** — folds into P5 (todo.md #15), not here.
- **Ops and Hardware escalation.** Deliberately out of scope; the monthly grid published in Task 2 already
  covers all three indexes, so adding an index selector later is a UI change only.

## Self-review notes

- **Scope coverage:** every locked decision above maps to a task — Build-only (Task 5 slices
  `dc.indexes.build`), historical-only (no forward input anywhere), no location (no state selector; the
  methodology copy explains why), no band (absent). The register's acceptance criterion — "bridge rows sum
  to the headline delta" — is pinned twice, in pytest (Task 1, exact) and vitest (Task 4, exact).
- **Type consistency:** `BridgeComponent` is defined in Task 4 and consumed by name in Task 5's
  `EscalationData`. `monthIndexAtOrBefore` is exported in Task 3 and reused in Task 4. `EscalationResult`
  fields used in Task 5's JSX (`escalatedCost`, `pct`, `annualizedPct`, `deltaCost`, `baseMonth`,
  `endMonth`, `monthsElapsed`, `baseIndex`, `endIndex`) all exist in Task 3's type.
- **Known gap:** Task 2 Step 5 requires `FRED_API_KEY` to regenerate the artifact. If the implementer
  lacks it, Tasks 3–6 are blocked on real data. This is called out in the task rather than hidden.
