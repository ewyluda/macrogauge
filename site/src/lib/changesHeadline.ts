import type { Mover } from "./types";

const money = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** A reading in its own unit: "$85.72/MWh", "96.3", "5.27%", "$243B",
 *  "41,476 MW", "$6.63/lb"; a YoY reads signed ("+12.3%"). */
export function fmtReading(m: Pick<Mover, "kind" | "unit">, v: number | null): string {
  if (v == null) return "—";
  if (m.kind === "yoy") return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(m.unit === "%" && Math.abs(v) < 10 ? 2 : 1)}%`;
  switch (m.unit) {
    case "%": return `${v.toFixed(2)}%`;
    case "$/MWh": return `${money(v)}/MWh`;
    case "$/lb": return `${money(v)}/lb`;
    case "$B": return `$${Math.round(v).toLocaleString("en-US")}B`;
    case "MW": return `${Math.round(v).toLocaleString("en-US")} MW`;
    default: return v.toFixed(1);
  }
}

/** "+4.0%", "−12bp", "+0.30pp". */
export function fmtDelta(m: Pick<Mover, "delta" | "delta_unit">): string {
  if (m.delta == null) return "new";
  const s = m.delta > 0 ? "+" : m.delta < 0 ? "−" : "";
  const a = Math.abs(m.delta);
  return m.delta_unit === "bp" ? `${s}${Math.round(a)}bp` : m.delta_unit === "pp" ? `${s}${a.toFixed(2)}pp` : `${s}${a.toFixed(1)}%`;
}

/** Movers (changed since the previous publish, already ranked by the
 *  writer) and the rest (unchanged, or with no previous reading). */
export function partitionMovers(movers: Mover[]): { moved: Mover[]; unchanged: Mover[] } {
  const moved = movers.filter((m) => m.delta != null && m.delta !== 0);
  return { moved, unchanged: movers.filter((m) => !moved.includes(m)) };
}

/** The page's one-sentence lead: the biggest AI-infra move since the last
 *  publish, or an honest quiet day when nothing cleared its notable
 *  threshold. Null without movers to read. */
export function changesHeadline(movers: Mover[] | undefined): string | null {
  if (!movers?.length) return null;
  const top = partitionMovers(movers).moved.find((m) => m.section === "AI Infra");
  if (!top) return movers.some((m) => m.prev_value != null) ? "No AI-infra reading changed since the last publish." : null;
  const up = top.delta! > 0;
  const by = fmtDelta({ ...top, delta: Math.abs(top.delta!) }).replace(/^\+/, "");
  const to = fmtReading(top, top.value);
  return (top.significance ?? 0) >= 1
    ? `The biggest AI-infra move since the last publish: ${top.label} ${up ? "rose" : "fell"} ${by} to ${to}.`
    : `A quiet day for AI infrastructure: the largest move, ${top.label}, was ${up ? "up" : "down"} ${by} to ${to}, within its usual range.`;
}
