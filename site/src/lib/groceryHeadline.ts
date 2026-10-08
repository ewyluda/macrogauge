/** BLS average-price codes in the grocery set that are household utilities,
 *  not groceries: electricity per kWh, utility (piped) gas per therm. /grocery
 *  keeps them in its CSV (the artifact's own rows) but not on the shelf. */
export const UTILITY_CODES = new Set(["APU000072610", "APU000072620"]);

type Spread = { name: string; spread_pp: number | null };

/** /grocery's lead: where the shelf is outrunning the farm gate most, and
 *  where it lags most (spread = retail YoY − wholesale YoY). */
export function spreadTakeaway(rows: Spread[], short: (name: string) => string): string | null {
  const live = rows.filter((r): r is { name: string; spread_pp: number } => r.spread_pp != null);
  if (live.length === 0) return null;
  const sorted = [...live].sort((a, b) => b.spread_pp - a.spread_pp);
  const pp = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}pp`;
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  const parts: string[] = [];
  if (top.spread_pp > 0) parts.push(`${short(top.name)}'s shelf price is outrunning its wholesale price by ${pp(top.spread_pp)} a year`);
  if (low.spread_pp < 0 && low !== top) parts.push(`${short(low.name)}'s shelf price trails wholesale by ${pp(low.spread_pp).replace("−", "")}`);
  if (parts.length === 0) return `Shelf and wholesale prices are moving within ${Math.max(...live.map((r) => Math.abs(r.spread_pp))).toFixed(1)}pp of each other.`;
  const s = parts.join("; ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
