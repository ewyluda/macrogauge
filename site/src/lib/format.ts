const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-05-01" -> "May 2026" */
export function fmtMonth(isoDate: string): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

/** 2.69 -> "2.7%" (one decimal, as prints are quoted) */
export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** +3.1% / −1.2% / — (1dp) */
export function fmtSigned(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const s = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${s}${Math.abs(pct).toFixed(1)}%`;
}

/** $4.13 · $4,141 · 17.4¢/kWh · 6.31% — display-only formatting */
export function fmtMoney(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "$") {
    return v >= 100
      ? `$${Math.round(v).toLocaleString("en-US")}`
      : `$${v.toFixed(2)}`;
  }
  return `${v.toFixed(2)} ${unit}`;
}

/** semantic: inflation hot = red, cooling = emerald, flat/unknown = muted */
export function yoyColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "var(--muted)";
  if (pct > 0.05) return "var(--accent-red)";
  if (pct < -0.05) return "var(--accent-emerald)";
  return "var(--muted)";
}
