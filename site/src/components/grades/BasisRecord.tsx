import {
  BASIS_LABELS,
  HORIZONS,
  WITHHELD_REASON,
  basisShortfallRanges,
  fmtRange,
  formatHorizonList,
  horizonKey,
  type GradeLegs,
} from "@/lib/dcGrades";
import type { Leg } from "@/lib/types";

const LEGS = [
  { key: "strict", name: "Vintage-true", cls: "strict" },
  { key: "extended", name: "Final-revision", cls: "extended" },
] as const;

/** One cell: a bar for a graded figure, the editorial reason for a withheld
 *  one, a plain dash for a real absence. The three never look alike — the
 *  same three states pairedShortfall() keeps apart. */
function LegBar({ leg, basis, h, name, cls }: { leg?: Leg; basis: string; h: number; name: string; cls: string }) {
  if (leg && !leg.published_horizons.includes(h)) {
    return (
      <div className="br-bar br-withheld" title={WITHHELD_REASON}>
        <span className="br-leg">{name}</span><span className="br-note">withheld</span>
      </div>
    );
  }
  const s = leg?.grades?.[basis]?.[horizonKey(h)];
  if (!s) {
    return <div className="br-bar"><span className="br-leg">{name}</span><span className="br-note">not gradeable</span></div>;
  }
  return (
    <div className="br-bar" title={`${s.independent_draws.toFixed(1)} independent draws`}>
      <span className="br-leg">{name}</span>
      <span className="br-track"><span className={`br-fill br-${cls}`} style={{ width: `${s.shortfall_rate_pct}%` }} /></span>
      <span className="br-val">{s.shortfall_rate_pct.toFixed(0)}%</span>
    </div>
  );
}

/** /escalation's answer to "did the basis I carry hold up?": one sentence,
 *  then every rule × horizon × sample as small multiples. Each figure sits
 *  beside its counterpart sample (the paired-legs rule); the full tables,
 *  the inversion and the method live in the disclosure below it. */
export function BasisRecord({ grades }: { grades: GradeLegs }) {
  const strict = grades.legs?.strict;
  const extended = grades.legs?.extended;
  const { horizons, rows } = basisShortfallRanges(grades);
  return (
    <div className="basis-record">
      {rows.length > 0 && (
        <p className="basis-record-lead" data-testid="basis-record-lead">
          Carried as contingency over {formatHorizonList(horizons)} windows,{" "}
          {rows.map((r, i) => (
            <span key={r.basis}>
              {i > 0 && (i === rows.length - 1 ? ", and " : ", ")}
              the {r.label.toLowerCase()} rate ran short in <b>{fmtRange(r)}</b>
            </span>
          ))}{" "}
          of past windows, across both samples.
        </p>
      )}
      <div className="br-grid">
        {Object.keys(BASIS_LABELS).map((basis) => (
          <div className="br-card" key={basis}>
            <h3>{BASIS_LABELS[basis]}</h3>
            {HORIZONS.map((h) => (
              <div className="br-row" key={h}>
                <span className="br-h">{h} mo</span>
                <div className="br-pair">
                  {LEGS.map((l) => (
                    <LegBar key={l.key} leg={l.key === "strict" ? strict : extended} basis={basis} h={h} name={l.name} cls={l.cls} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="chart-caption">
        Share of past windows where escalation outran the carried rate. Vintage-true:
        {strict ? ` ${strict.anchors_n} anchors, ${strict.span[0]} to ${strict.span[1]}, each month read as it was first published${strict.contains_downturn ? "" : ", no downturn in the sample"}.` : " unavailable this publish."}{" "}
        Final-revision:
        {extended ? ` ${extended.anchors_n} anchors, ${extended.span[0]} to ${extended.span[1]}, today's revised data${extended.contains_downturn ? ", including a downturn" : ""}.` : " unavailable this publish."}{" "}
        Longer horizons rest on fewer independent windows (hover a bar for the count).
      </p>
    </div>
  );
}
