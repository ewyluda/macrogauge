import { fmtUsd } from "./format";

export type EscalationAriaInput = {
  baseMonth: string;
  endMonth: string;
  measuredEnd: number;
  forward: null | {
    deliveryMonth: string; label: string; carried: number;
    band: { p10: number; p90: number; p80: number } | null;
  };
};

/** The chart's screen-reader summary, written from the chart's own end
 *  values. The generic chartAriaLabel reads every series' last point, which
 *  here announced the stacked band's invisible p10 floor and its p90−p10
 *  THICKNESS under the range's name (audit F10); this states the endpoints. */
export function escalationAriaLabel(a: EscalationAriaInput): string {
  const to = a.forward ? a.forward.deliveryMonth : a.endMonth;
  let s = `Escalated cost from ${a.baseMonth} to ${to}. Measured on the DC Build index to ${a.endMonth}: ${fmtUsd(a.measuredEnd)}.`;
  if (a.forward) {
    s += ` Carried at ${a.forward.label} to ${a.forward.deliveryMonth}: ${fmtUsd(a.forward.carried)}.`;
    if (a.forward.band) {
      s += ` Realized range (p10–p90) at ${a.forward.deliveryMonth}: ${fmtUsd(a.forward.band.p10)} to ${fmtUsd(a.forward.band.p90)};` +
        ` P80 allowance ${fmtUsd(a.forward.band.p80)}.`;
    }
  }
  return s;
}
