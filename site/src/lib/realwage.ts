/** real = (1 + raise) / (1 + inflation) − 1, in percent terms.
 *  The exact formula printed on the page and used by the pipeline KPI. */
export function realRaisePct(raisePct: number, inflationPct: number): number {
  return ((1 + raisePct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
