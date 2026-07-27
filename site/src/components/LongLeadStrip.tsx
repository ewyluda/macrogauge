import Link from "next/link";
import { KIND_LABELS, fmtFigure } from "@/lib/longLead";
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
          <strong>{fmtFigure(t.figure.value, t.figure.unit)}</strong>
        </span>
      ))}
      <span className="subtitle">
        {longlead.packages.length} packages · {longlead.build_weight_covered}{" "}
        of Build weight
      </span>
      <Link href="/longlead">Long-Lead Board →</Link>
    </div>
  );
}
