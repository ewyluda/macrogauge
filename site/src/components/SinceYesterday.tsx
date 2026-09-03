import Link from "next/link";
import changesJson from "../../public/data/changes.json";
import { fmtPp, fmtSigned, fmtStamp } from "@/lib/format";
import type { Changes } from "@/lib/types";

export const CHANGES = changesJson as Changes;

const sign = (v: number | null) => (v == null ? "var(--muted)" : v > 0.005 ? "var(--accent-red)" : v < -0.005 ? "var(--accent-emerald)" : "var(--muted)");

/** One line of "what moved since the previous publish", or the honest
 *  first-reading state when there is no previous publish to diff against. */
export function SinceYesterdayStrip() {
  const c = CHANGES;
  if (!c.prev_published_at) {
    return (
      <div className="since-strip">
        <span className="since-label">Since yesterday</span>
        <span style={{ color: "var(--muted)" }}>first reading on this publish — the diff starts with the next daily run</span>
        <Link href="/changes" className="since-link">what changed →</Link>
      </div>
    );
  }
  const moved = c.headline.filter((h) => h.delta_pp != null && Math.abs(h.delta_pp) >= 0.005);
  const topComp = c.components.filter((x) => x.delta_pp != null && Math.abs(x.delta_pp) >= 0.05).slice(0, 3);
  const quiet = moved.length === 0 && topComp.length === 0;
  return (
    <div className="since-strip">
      <span className="since-label">Since yesterday</span>
      {c.official?.new_print && <span className="badge">new CPI print {c.official.month?.slice(0, 7)}</span>}
      {quiet && !c.official?.new_print && <span style={{ color: "var(--muted)" }}>no headline moved by 0.01pp or more</span>}
      {moved.slice(0, 4).map((h) => (
        <span key={h.key}><span style={{ color: "var(--muted)" }}>{h.label}</span> <b style={{ color: sign(h.delta_pp) }}>{fmtPp(h.delta_pp)}</b></span>
      ))}
      {topComp.map((x) => (
        <span key={x.component}><span style={{ color: "var(--muted)" }}>{x.label}</span> <b style={{ color: sign(x.delta_pp) }}>{fmtPp(x.delta_pp)}</b></span>
      ))}
      {c.sources_landed.length > 0 && (
        <span style={{ color: "var(--muted)" }}>{c.sources_landed.length} source{c.sources_landed.length === 1 ? "" : "s"} landed new rows</span>
      )}
      {c.gate_holds.length > 0 && <span className="badge">{c.gate_holds.length} gate hold{c.gate_holds.length === 1 ? "" : "s"}</span>}
      <Link href="/changes" className="since-link">full diff →</Link>
      <span style={{ color: "var(--muted)", fontSize: 11 }}>vs {fmtStamp(c.prev_published_at)}</span>
    </div>
  );
}

/** Plain-text body for the RSS item (feed.xml). */
export function sinceYesterdayText(): string {
  const c = CHANGES;
  if (!c.prev_published_at) return "First reading on this publish.";
  const parts: string[] = [];
  if (c.official?.new_print) parts.push(`New official CPI print for ${c.official.month?.slice(0, 7)} (${fmtSigned(c.official.yoy_pct)} YoY).`);
  const moved = c.headline.filter((h) => h.delta_pp != null && Math.abs(h.delta_pp) >= 0.005);
  if (moved.length) parts.push("Moved: " + moved.map((h) => `${h.label} ${fmtPp(h.delta_pp)} to ${fmtSigned(h.value)}`).join("; ") + ".");
  const comps = c.components.filter((x) => x.delta_pp != null && Math.abs(x.delta_pp) >= 0.05).slice(0, 5);
  if (comps.length) parts.push("Components: " + comps.map((x) => `${x.label} ${fmtPp(x.delta_pp)}`).join(", ") + ".");
  if (c.sources_landed.length) parts.push(`Sources landing new rows: ${c.sources_landed.map((s) => s.source).join(", ")}.`);
  if (c.sources_failed.length) parts.push(`Sources failed: ${c.sources_failed.join(", ")}.`);
  if (!parts.length) parts.push("No headline moved by 0.01pp or more since the previous publish.");
  return parts.join(" ");
}
