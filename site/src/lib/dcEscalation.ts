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
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
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
 *  total project $, or any other denomination all ride the same ratio. */
export function escalate(
  months: string[],
  index: number[],
  baseMonth: string,
  baseCost: number
): EscalationResult | null {
  const i = monthIndexAtOrBefore(months, baseMonth);
  if (i < 0) return null;
  // months/index are always equal length — the monthly grid publishes them
  // together and pins it at publish time (tests/test_datacenter_writer.py).
  // Deriving `last` from `months` here matches bridge()'s convention below.
  const last = months.length - 1;
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
 *  component. */
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
        componentBaseIndex: series[i],
        componentEndIndex: series[last],
        contributionPp: (100 * c.weight * delta) / headlineBase,
        contributionCost: (baseCost * c.weight * delta) / headlineBase,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));
}
