import { SITE_NAME, SITE_URL } from "./site";

/** The stable reference string a reader can paste into a document:
 *    MacroGauge DC Build Index, 2026-07-21, 2018-01=100, +6.81% YoY — https://…/datacenter
 *  `path` is the route (with any ?state); `rebase` is optional for
 *  quantities that are not index levels. */
export function cite(c: {
  series: string;
  asOf: string;
  value: string;
  path: string;
  rebase?: string | null;
}): string {
  const parts = [`${SITE_NAME} ${c.series}`, c.asOf];
  if (c.rebase) parts.push(c.rebase);
  parts.push(c.value);
  return `${parts.join(", ")} — ${SITE_URL}${c.path}`;
}
