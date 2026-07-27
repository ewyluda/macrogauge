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
