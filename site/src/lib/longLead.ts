import type { BacklogMonths, LeadTime, LongLeadFigure } from "./types";

// Number formatting only — the values themselves are company-stated and
// pass through verbatim from the artifact (stated-only, spec §3).
const trim = (v: number) => {
  const rounded = Number(v.toFixed(1));
  return `${rounded}`;
};

export function fmtFigure(value: number, unit: LongLeadFigure["unit"]): string {
  switch (unit) {
    case "usd_b":
      return `$${trim(value)}B`;
    case "eur_b":
      return `€${trim(value)}B`;
    case "jpy_tn":
      return `¥${trim(value)}tn`;
    case "pct_yoy": {
      // Sign the ROUNDED value (a -0.04 that rounds to 0 must not print
      // "-0"), with the U+2212 minus the other DC-page formatters use.
      const r = Number(value.toFixed(1));
      const sign = r > 0 ? "+" : r < 0 ? "−" : "";
      return `${sign}${Math.abs(r)}% YoY`;
    }
    case "ratio":
      // up to two decimals, as stated: 2.65 is stored as 2.6499..., so a
      // one-decimal toFixed would print a stated 2.65 as "2.6x"
      return `${Number(value.toFixed(2))}x`;
    case "gw":
      return `${trim(value)} GW`;
  }
}

// Package weights and build_weight_covered are fractions in the artifact;
// every other weight on the DC pages renders as a percentage — so do these.
export function fmtWeightPct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(1))}%`;
}

// Three different accounting objects — rendered as badges, never summed,
// never on one axis (spec §2.4).
export const BASIS_LABELS: Record<LongLeadFigure["basis"], string> = {
  rpo: "RPO",
  "order-backlog": "Order backlog",
  "mdna-backlog": "MD&A backlog",
};

export const KIND_LABELS: Record<LongLeadFigure["kind"], string> = {
  backlog: "Backlog",
  orders: "Orders",
  book_to_bill: "Book-to-bill",
  backlog_growth: "Backlog growth",
};

// Null notes are prose receipts that cite SEC URLs inline; the page renders
// those citations as anchors so a null finding is as traceable by click as a
// figure's source link (spec acceptance §10.1). Pure split, prose untouched.
export type NoteSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; url: string };

export function noteSegments(note: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  let last = 0;
  // stop before whitespace and the ")," that closes an inline citation;
  // sentence-final punctuation is prose, not URL — a note ending "…htm."
  // must not emit a link with a trailing dot (404 on EDGAR).
  for (const m of note.matchAll(/https:\/\/[^\s),]+/g)) {
    const url = m[0].replace(/[.;:!?]+$/, "");
    if (m.index > last) out.push({ kind: "text", text: note.slice(last, m.index) });
    out.push({ kind: "link", url });
    last = m.index + url.length;
  }
  if (last < note.length) out.push({ kind: "text", text: note.slice(last) });
  return out;
}

// --- lead times (2026-10-07) -------------------------------------------------

export const LEAD_BASIS_LABELS: Record<LeadTime["basis"], string> = {
  "industry-survey": "Industry survey",
  "industry-report": "Industry report",
  "vendor-statement": "Vendor statement",
};

/** "128 wk" / "orders into 2028" */
export function fmtLead(lt: Pick<LeadTime, "weeks" | "through">): string {
  return lt.weeks != null ? `${Math.round(lt.weeks)} wk` : `orders into ${lt.through}`;
}

const quarter = (d: string) => `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}`;
const bare = (item: string) => item.replace(/, US average$/, "");
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const when = (l: LeadTime) => `(${LEAD_BASIS_LABELS[l.basis].toLowerCase()}, ${quarter(l.period)})`;

/**
 * The board's opening line, written from the stated lead times. Survey weeks
 * come first, grouped by the source reading they share (basis + period), each
 * group dated; then vendors' order horizons, each dated. A partial refresh
 * (one package moved to a newer survey) therefore keeps every date, never
 * mixing two readings under none. Null with no lead times.
 * "Generator step-up transformers average 143 weeks from order, power
 * transformers 128, switchgear 44 (industry survey, Q2 2025); Caterpillar
 * diesel standby gen sets: orders taken into 2028 (vendor statement, Q2 2026)."
 */
export function leadTakeaway(leads: LeadTime[]): string | null {
  const weeks = leads.filter((l) => l.weeks != null).sort((a, b) => b.weeks! - a.weeks!);
  const groups = new Map<string, LeadTime[]>();
  for (const l of weeks) {
    const k = `${l.basis}|${l.period}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const parts: string[] = [];
  [...groups.values()].forEach((g, gi) => {
    const [first, ...rest] = g;
    const lead = gi === 0
      ? `${bare(first.item)} average ${Math.round(first.weeks!)} weeks from order`
      : `${lower(bare(first.item))} ${Math.round(first.weeks!)} weeks`;
    parts.push(lead + rest.map((l) => `, ${lower(bare(l.item))} ${Math.round(l.weeks!)}`).join("") + ` ${when(first)}`);
  });
  for (const l of leads.filter((x) => x.through != null)) {
    parts.push(`${l.item}: orders taken into ${l.through} ${when(l)}`);
  }
  return parts.length ? `${parts.join("; ")}.` : null;
}

/** "7.2 months, down 1.3 in a year: shipments +19.4%, unfilled orders +1.4%" —
 *  which leg moved the ratio. Both are measured (a shipments flow, an
 *  unfilled-orders stock); neither is new orders, so this describes the ratio
 *  and never claims demand rose or cooled. A leg the writer omitted (an
 *  undefined change off a zero base) is simply left out. */
export function backlogMove(b: BacklogMonths): string {
  const head = `${b.latest.toFixed(1)} months`;
  if (b.change_1y == null) return head;
  const d = b.change_1y;
  const move = Math.abs(d) < 0.05 ? "flat on the year" : `${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)} in a year`;
  const sign = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  const parts = [
    b.shipments_yoy_pct != null ? `shipments ${sign(b.shipments_yoy_pct)}` : null,
    b.unfilled_yoy_pct != null ? `unfilled orders ${sign(b.unfilled_yoy_pct)}` : null,
  ].filter(Boolean);
  const legs = parts.length ? `: ${parts.join(", ")}` : "";
  return `${head}, ${move}${legs}`;
}
