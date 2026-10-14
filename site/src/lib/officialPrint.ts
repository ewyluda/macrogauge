import { fmtMonth } from "./format";

type HeadlineRow = { month: string; prev_yoy_pct: number; latest_month?: string; prev_month?: string };

function monthBefore(iso: string, n: number): string {
  const total = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Caption under an official CPI YoY tile. BLS never published October 2025
 *  (shutdown), so the October 2026 print has no YoY base: the published YoY
 *  walks back to September (`month`) while `latest_month` is October — say
 *  so instead of calling September the latest print. At the next print the
 *  "previous" YoY is two months back (`prev_month`), so name it. */
export function officialContext(row: HeadlineRow, pct: (v: number) => string): string {
  const prev = row.prev_month && row.prev_month !== monthBefore(row.month, 1)
    ? `previous (${fmtMonth(row.prev_month)}) ${pct(row.prev_yoy_pct)}`
    : `previous ${pct(row.prev_yoy_pct)}`;
  if (row.latest_month && row.latest_month > row.month) {
    return `${fmtMonth(row.month)} YoY · ${fmtMonth(row.latest_month)} printed, but ${fmtMonth(monthBefore(row.latest_month, 12))} never was · ${prev}`;
  }
  return `${fmtMonth(row.month)} print · ${prev}`;
}
