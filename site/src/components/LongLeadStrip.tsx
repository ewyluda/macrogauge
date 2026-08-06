import Link from "next/link";
import { BASIS_LABELS, KIND_LABELS, fmtFigure, fmtWeightPct } from "@/lib/longLead";
import type { LongLead } from "@/lib/types";

// Chips are the config-curated `teaser` picks (spec §5) — the site never
// chooses or computes a highlight itself.
export function LongLeadStrip({ longlead }: { longlead: LongLead }) {
  return (
    <div className="table-card strip-row" data-testid="longlead-strip">
      <span className="badge">Long-lead</span>
      {longlead.teaser.map((t) => (
        <span key={`${t.vendor}:${t.figure.kind}`}>
          {t.name} {KIND_LABELS[t.figure.kind].toLowerCase()}{" "}
          <strong>{fmtFigure(t.figure.value, t.figure.unit)}</strong>{" "}
          {/* Basis badge mirrors the board (spec §2.4): GE Vernova's figure
              is RPO, and RPO ≠ backlog — the strip must not flatten the
              distinction the board's "Reading the bases" section draws. */}
          <span className="badge badge-muted">{BASIS_LABELS[t.figure.basis]}</span>{" "}
          <span className="subtitle">{t.figure.period}</span>{" "}
          {t.stale && <span className="badge">stale</span>}
        </span>
      ))}
      <span className="subtitle">
        {longlead.packages.length} packages ·{" "}
        {fmtWeightPct(longlead.build_weight_covered)} of Build weight
      </span>
      <Link href="/longlead">Long-Lead Board →</Link>
    </div>
  );
}
