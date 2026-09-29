import Link from "next/link";
import { fmtDay, fmtMonth, fmtPp } from "@/lib/format";
import type { Reconciliation } from "@/lib/reconcile";

const pct2 = (v: number) => `${v.toFixed(2)}%`;

/** official print → 14-component reconstruction → ours, with the two
 *  differences between them named (backlog #7). The homepage shows all three
 *  numbers in different panels; this is where they add up. Server-safe. */
export function ReconciliationStrip({
  r,
  officialMonth,
  gaugeAsOf,
}: {
  r: Reconciliation;
  officialMonth: string;
  gaugeAsOf: string;
}) {
  const rounding = Math.abs(r.roundingPp) >= 0.005 ? ` ${fmtPp(r.roundingPp)} rounding` : "";
  return (
    <section className="recon-strip" aria-labelledby="recon-title" data-testid="recon-strip">
      <h2 id="recon-title" className="recon-title">From the official print to ours</h2>
      <ol className="recon-steps">
        <li className="recon-node">
          <span className="recon-label">Official CPI · {fmtMonth(officialMonth)} print</span>
          <strong className="recon-value recon-official" data-testid="recon-official">{pct2(r.officialPct)}</strong>
        </li>
        <li className="recon-edge" data-testid="recon-decomposition-error">
          <span className="recon-delta">{fmtPp(r.decompositionErrorPp)} <span aria-hidden="true">→</span></span>
          <small>basket decomposition error</small>
        </li>
        <li className="recon-node">
          <span className="recon-label">14-component reconstruction</span>
          <strong className="recon-value" data-testid="recon-reconstruction">{pct2(r.reconstructionPct)}</strong>
        </li>
        <li className="recon-edge" data-testid="recon-component-gaps">
          <span className="recon-delta">{fmtPp(r.componentGapPp)} <span aria-hidden="true">→</span></span>
          <small>component gaps, ours − BLS</small>
        </li>
        <li className="recon-node">
          <span className="recon-label">Macrogauge · {fmtDay(gaugeAsOf)}</span>
          <strong className="recon-value recon-gauge" data-testid="recon-gauge">{pct2(r.gaugePct)}</strong>
        </li>
      </ol>
      <p className="recon-foot">
        Headline gap {fmtPp(r.headlineGapPp)} = {fmtPp(r.decompositionErrorPp)} decomposition error (re-weighting
        BLS&apos;s own component YoYs by our 14 basket weights, before any live data) + {fmtPp(r.componentGapPp)}{" "}
        component gaps (Σ weight × ours − BLS; <Link href="/gap">by component</Link>){rounding}.
        {r.stale ? " The reconstruction was graded against an earlier print; it refreshes with the next publish." : ""}
      </p>
    </section>
  );
}
