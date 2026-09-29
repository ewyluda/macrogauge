import Link from "next/link";
import { fmtMonth, fmtPp } from "@/lib/format";
import { VARIANT_REF, variantGap, type VariantRef } from "@/lib/reconcile";

type VariantSummary = { yoy_pct: number | null; as_of: string; coverage_pct: number };
export type RefPrint = { yoy_pct: number | null; month: string };

const LABELS: Record<string, { label: string; href?: string }> = {
  gauge: { label: "Macrogauge (CPI-comparable)" },
  tracker: { label: "CPI-Tracker", href: "/vs-bls" },
  col: { label: "Cost of Living", href: "/cost-of-living" },
  supercore: { label: "Supercore", href: "/supercore" },
  pce: { label: "PCE-weighted", href: "/pce" },
};

const REF_LABEL: Record<VariantRef, string> = { cpi: "official CPI", core: "core CPI", pce: "PCEPI" };

/** Every variant's headline gap in one strip. gaptable.json publishes the
 *  row-level decomposition for the main gauge only; the other variants carry
 *  a summary (YoY, as-of, live coverage) — that is what this shows, each gap
 *  taken against the variant's OWN reference print: CPI for the CPI-comparable
 *  variants, core CPI for supercore, PCEPI for the PCE-weighted gauge
 *  (official.json headline). */
export function GapVariantStrip({
  variants,
  refs,
}: {
  variants: Record<string, VariantSummary>;
  refs: Record<VariantRef, RefPrint>;
}) {
  return (
    <div className="quote-board" style={{ margin: "12px 0 16px" }} data-testid="gap-variant-strip">
      {Object.entries(variants).map(([key, v]) => {
        const meta = LABELS[key] ?? { label: key };
        const refKey = VARIANT_REF[key];
        const ref = refKey ? refs[refKey] : undefined;
        const gap = variantGap(v.yoy_pct, ref);
        return (
          <div className="quote-tile" key={key} data-variant={key}>
            <div className="quote-group">vs {refKey ? REF_LABEL[refKey] : "official"}</div>
            <div className="quote-label">{meta.href ? <Link href={meta.href}>{meta.label}</Link> : meta.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {v.yoy_pct == null ? "—" : `${v.yoy_pct.toFixed(2)}%`}
            </div>
            <div className="quote-meta" style={{ fontSize: 11, color: "var(--muted)" }}>
              {gap != null && ref?.yoy_pct != null && refKey
                ? `${fmtPp(gap)} vs ${fmtMonth(ref.month)} ${REF_LABEL[refKey]} ${ref.yoy_pct.toFixed(2)}% · `
                : ""}
              {v.coverage_pct.toFixed(0)}% live · {v.as_of}
            </div>
          </div>
        );
      })}
    </div>
  );
}
