export type ForwardSegment = {
  /** Always the historical leg's end month — the two segments are contiguous. */
  fromMonth: string;
  deliveryMonth: string;
  monthsAhead: number;
  /** The basis rate the reader chose to carry. */
  annualizedPct: number;
  factor: number;
  pct: number;
};

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
  /** null unless the caller supplied a forward leg. */
  forward: ForwardSegment | null;
  /** Historical ratio x forward factor. Equals 1 + pct/100 when forward is null. */
  totalFactor: number;
  totalPct: number;
  totalCost: number;
};

/** Whole months between two "YYYY-MM" strings. */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Shift a "YYYY-MM" string by `n` whole months. "2026-12" + 1 -> "2027-01".
 *
 *  Uses a floored modulo rather than JS's `%`, which is sign-preserving: a
 *  naive `(t % 12) + 1` yields "2025-00" for addMonths("2026-01", -1).
 *  Negative shifts are not used by the UI today, but the function is exported
 *  and cheap to make total. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  const year = Math.floor(t / 12);
  const mo = t - year * 12; // floored remainder: always 0..11
  return `${year}-${String(mo + 1).padStart(2, "0")}`;
}

/** Index of the nearest month at or before `target`; -1 if target predates the series.
 *  Shared with dcContingency.ts, which resolves the same "YYYY-MM" grid. */
export function monthIndexAtOrBefore(months: string[], target: string): number {
  let i = -1;
  for (let j = 0; j < months.length; j++) {
    if (months[j] <= target) i = j;
    else break;
  }
  return i;
}

/** Escalate a base cost by the index ratio. Unit-agnostic — the caller's $/MW,
 *  total project $, or any other denomination all ride the same ratio.
 *
 *  The optional `forward` leg compounds a chosen annual rate from the END of
 *  the measured history to a delivery month. The two segments are contiguous
 *  by construction (forward.fromMonth === endMonth), so nothing is double
 *  counted and nothing is skipped. The rate is the caller's choice of basis —
 *  this function asserts nothing about which regime will obtain. */
export function escalate(
  months: string[],
  index: number[],
  baseMonth: string,
  baseCost: number,
  forward?: { deliveryMonth: string; annualizedPct: number } | null
): EscalationResult | null {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return null;
  // months/index are always equal length — the monthly grid publishes them
  // together and pins it at publish time (tests/test_datacenter_writer.py).
  // Deriving `last` from `months` here matches bridgeWindow()'s convention.
  const last = months.length - 1;
  const ratio = index[last] / index[i];
  const monthsElapsed = monthDiff(months[i], months[last]);

  let fwd: ForwardSegment | null = null;
  if (forward) {
    const monthsAhead = monthDiff(months[last], forward.deliveryMonth);
    if (monthsAhead > 0) {
      const factor = Math.pow(1 + forward.annualizedPct / 100, monthsAhead / 12);
      fwd = {
        fromMonth: months[last],
        deliveryMonth: forward.deliveryMonth,
        monthsAhead,
        annualizedPct: forward.annualizedPct,
        factor,
        pct: (factor - 1) * 100,
      };
    }
  }
  const totalFactor = ratio * (fwd ? fwd.factor : 1);

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
    forward: fwd,
    totalFactor,
    totalPct: (totalFactor - 1) * 100,
    totalCost: baseCost * totalFactor,
  };
}

export type BridgeComponent = {
  code: string;
  label: string;
  group: string;
  weight: number;
};

export type BridgeRow = BridgeComponent & {
  componentPct: number;        // the component's own escalation over the window
  componentBaseIndex: number;  // the component's own index level at the base month
  componentEndIndex: number;   // the component's own index level at the end month
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
 *  NOTE — denominator: I(b) above is the HEADLINE's base index, not the
 *  component's own (componentBaseIndex). contributionPp and componentPct are
 *  deliberately denominated differently and only coincide when every
 *  component equals 100 at the base month. Callers must not present
 *  `weight * componentPct` as if it were contributionPp — see the on-page
 *  note this powers in DcEscalationClient.tsx.
 *
 *  I(b) is rebuilt from the components rather than read from the published
 *  headline so the identity survives the two arrays being rounded independently.
 *
 *  componentIndex[c.code] assumes every components[].code has a matching key —
 *  true by construction, because both are sliced from the same datacenter.json
 *  `indexes.build` object and the publisher pins set(monthly.components) ==
 *  set(weights) at publish time (tests/test_datacenter_writer.py). An
 *  unmatched code would throw a TypeError here rather than silently drop a
 *  component.
 *
 *  `endMonth` need not be the grid end — bridgeWindow() decomposes an
 *  arbitrary [baseMonth, endMonth] window, which is what lets `bridge()`
 *  below stay a thin wrapper over "base month to grid end" while the same
 *  math also answers "what changed between any two months." When endMonth
 *  resolves to the same month index as baseMonth (a user-selected base equal
 *  to the last available month), this deliberately falls through to a full
 *  row set with zero contributions rather than returning [] — DcEscalationClient.tsx
 *  renders bridgeWindow()'s rows without a length guard, and an empty array
 *  would silently blank the table body while leaving its headers and TOTAL row. */
export function bridgeWindow(
  months: string[],
  componentIndex: Record<string, number[]>,
  components: BridgeComponent[],
  baseMonth: string,
  endMonth: string,
  baseCost: number
): BridgeRow[] {
  const i = monthIndexAtOrBefore(months, baseMonth);
  const last = monthIndexAtOrBefore(months, endMonth);
  if (i < 0 || last < 0 || last < i) return [];
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
        componentBaseIndex: series[i],
        componentEndIndex: series[last],
        contributionPp: (100 * c.weight * delta) / headlineBase,
        contributionCost: (baseCost * c.weight * delta) / headlineBase,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));
}

/** Decompose the headline escalation from `baseMonth` to the end of the
 *  published grid. Thin wrapper over bridgeWindow() for the "base month to
 *  grid end" case. DcEscalationClient.tsx now calls bridgeWindow() directly
 *  with its own [baseMonth, lastMonth] window (P3a's forward-leg UI needs the
 *  more general signature), so this wrapper has NO production call site
 *  today — it is exercised only by dcEscalation.test.ts. Kept, not deleted:
 *  it is still the right shape for any future caller that only ever wants
 *  "base month to grid end," and deleting it or re-pointing the client
 *  carries regression risk for no gain. */
export function bridge(
  months: string[],
  componentIndex: Record<string, number[]>,
  components: BridgeComponent[],
  baseMonth: string,
  baseCost: number
): BridgeRow[] {
  return bridgeWindow(
    months, componentIndex, components, baseMonth,
    months[months.length - 1], baseCost
  );
}
