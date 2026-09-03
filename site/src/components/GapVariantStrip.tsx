import { fmtMonth, fmtPct, fmtPp } from "@/lib/format";

type VariantSummary = { yoy_pct: number | null; as_of: string; coverage_pct: number };

const LABELS: Record<string, { label: string; vs: string; href?: string }> = {
  gauge: { label: "Macrogauge (CPI-comparable)", vs: "official CPI" },
  tracker: { label: "CPI-Tracker", vs: "official CPI", href: "/vs-bls" },
  col: { label: "Cost of Living", vs: "official CPI", href: "/cost-of-living" },
  supercore: { label: "Supercore", vs: "core CPI", href: "/supercore" },
  pce: { label: "PCE-weighted", vs: "PCEPI", href: "/pce" },
};

/** Every variant's headline gap in one strip. gaptable.json publishes the
 *  row-level decomposition for the main gauge only; the other variants carry
 *  a summary (YoY, as-of, live coverage) — that is what this shows, with the
 *  gap vs official CPI only where CPI is the variant's reference. */
export function GapVariantStrip({
  variants,
  officialYoy,
}: {
  variants: Record<string, VariantSummary>;
  officialYoy: { yoy_pct: number; month: string };
}) {
  return (
    <div className="quote-board" style={{ margin: "12px 0 16px" }}>
      {Object.entries(variants).map(([key, v]) => {
        const meta = LABELS[key] ?? { label: key, vs: "official" };
        const cpiRef = meta.vs === "official CPI";
        const gap = cpiRef && v.yoy_pct != null ? v.yoy_pct - officialYoy.yoy_pct : null;
        return (
          <div className="quote-tile" key={key}>
            <div className="quote-group">{meta.vs}</div>
            <div className="quote-label">{meta.href ? <a href={meta.href}>{meta.label}</a> : meta.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {v.yoy_pct == null ? "—" : fmtPct(v.yoy_pct)}
            </div>
            <div className="quote-meta" style={{ fontSize: 11, color: "var(--muted)" }}>
              {gap != null ? `${fmtPp(gap)} vs ${fmtMonth(officialYoy.month)} print · ` : ""}
              {v.coverage_pct.toFixed(0)}% live · {v.as_of}
            </div>
          </div>
        );
      })}
    </div>
  );
}
