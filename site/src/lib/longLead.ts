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
    case "pct_yoy": {
      // Sign the ROUNDED value (a -0.04 that rounds to 0 must not print
      // "-0"), with the U+2212 minus the other DC-page formatters use.
      const r = Number(value.toFixed(1));
      const sign = r > 0 ? "+" : r < 0 ? "−" : "";
      return `${sign}${Math.abs(r)}% YoY`;
    }
    case "ratio":
      return `${value.toFixed(1)}x`;
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
