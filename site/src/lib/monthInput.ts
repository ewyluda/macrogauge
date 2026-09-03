/** Client-side month validation independent of native <input type="month">
 *  support (todo #20): Safari renders it as free text and ignores min/max,
 *  so a typed "2024-13" or "March 2024" must be reported as invalid, and an
 *  in-shape month outside the grid as out of range — never fall through to
 *  a misleading "index starts in 2018-01". */
export type MonthCheck =
  | { ok: true; month: string }
  | { ok: false; reason: "empty" | "format" | "range"; message: string };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function checkMonth(raw: string, min: string, max: string, label = "month"): MonthCheck {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty", message: `Enter a ${label} as YYYY-MM.` };
  if (!MONTH.test(s)) return { ok: false, reason: "format", message: `"${s}" is not a month — use YYYY-MM (for example ${max}).` };
  if (s < min || s > max) return { ok: false, reason: "range", message: `${s} is outside the index — pick a ${label} between ${min} and ${max}.` };
  return { ok: true, month: s };
}
