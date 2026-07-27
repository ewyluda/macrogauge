import type { LongLeadFigure } from "./types";

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
    case "pct_yoy":
      return `${value >= 0 ? "+" : ""}${trim(value)}% YoY`;
    case "ratio":
      return `${value.toFixed(1)}x`;
  }
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
  // stop before whitespace and the ")," that closes an inline citation
  for (const m of note.matchAll(/https:\/\/[^\s),]+/g)) {
    if (m.index > last) out.push({ kind: "text", text: note.slice(last, m.index) });
    out.push({ kind: "link", url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < note.length) out.push({ kind: "text", text: note.slice(last) });
  return out;
}
