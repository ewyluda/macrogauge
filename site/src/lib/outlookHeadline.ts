import { fmtMonth } from "./format";

type Step = { month: string; central_yoy_pct: number };

export type OutlookShape = {
  title: string;
  /** the hump's top, when the path rises and then falls back */
  peak: { month: string; yoy: number } | null;
  /** the year-ago moves the hump replaces, from the gauge's monthly averages */
  baseNote: string | null;
};

const HUMP_PP = 0.3; // a peak must clear both ends by this much to be a hump
const pct = (v: number) => `${v.toFixed(1)}%`;
const mon = (m: string) => fmtMonth(`${m}-01`);
function back12(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${y - 1}-${String(mo).padStart(2, "0")}`;
}
function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** /outlook's chart title as its takeaway, plus the hump and what drives it.
 *  `monthly` is the gauge index by calendar month (YYYY-MM -> level). */
export function outlookShape(originMonth: string, nowYoy: number, forecast: Step[], monthly: Record<string, number>): OutlookShape {
  const end = forecast[forecast.length - 1];
  let p = 0;
  forecast.forEach((s, i) => { if (s.central_yoy_pct > forecast[p].central_yoy_pct) p = i; });
  const top = forecast[p];
  const hump = p < forecast.length - 1 && top.central_yoy_pct - nowYoy >= HUMP_PP && top.central_yoy_pct - end.central_yoy_pct >= HUMP_PP;
  if (!hump) {
    const verb = end.central_yoy_pct > nowYoy + 0.05 ? "rises" : end.central_yoy_pct < nowYoy - 0.05 ? "eases" : "holds";
    return { title: `Inflation ${verb} from ${pct(nowYoy)} to ${pct(end.central_yoy_pct)} by ${mon(end.month)}`, peak: null, baseNote: null };
  }
  // the low after the peak; the down-leg runs from the peak to it
  let t = p + 1;
  for (let i = p + 1; i < forecast.length; i++) if (forecast[i].central_yoy_pct < forecast[t].central_yoy_pct) t = i;
  const low = forecast[t];
  const title = `Inflation climbs to a ${pct(top.central_yoy_pct)} peak in ${mon(top.month)}, then eases to ${pct(end.central_yoy_pct)} by ${mon(end.month)}`;
  // year-ago legs: the months each YoY leg stops comparing against
  const a0 = monthly[back12(originMonth)], a1 = monthly[back12(top.month)], a2 = monthly[back12(low.month)];
  let baseNote: string | null = null;
  if (a0 && a1 && a2) {
    const up = (a1 / a0 - 1) * 100;
    const down = (a2 / a1 - 1) * 100;
    const moved = (v: number) => `${v < 0 ? "fell" : "rose"} ${Math.abs(v).toFixed(1)}%`;
    baseNote = `Much of the hump is base effect. The climb to ${mon(top.month)} drops ${mon(addMonths(back12(originMonth), 1))}–${mon(back12(top.month))} out of the comparison, when the gauge ${moved(up)}; the fall to ${mon(low.month)} drops ${mon(addMonths(back12(top.month), 1))}–${mon(back12(low.month))}, when it ${moved(down)}.`;
  }
  return { title, peak: { month: top.month, yoy: top.central_yoy_pct }, baseNote };
}
