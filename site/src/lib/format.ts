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
