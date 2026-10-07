import {
  BASIS_LABELS,
  HORIZONS,
  basisShortfallRanges,
  fmtRange,
  formatHorizonList,
  horizonKey,
  pairedShortfall,
  type GradeLegs,
  type LegShortfall,
} from "@/lib/dcGrades";

const LEGS = [
  { key: "strict", name: "Vintage-true", cls: "strict" },
  { key: "extended", name: "Final-revision", cls: "extended" },
] as const;

/** One cell, classified by pairedShortfall() — the only sanctioned read of a
 *  leg's shortfall rate — so these bars can never disagree with the verdict
 *  line on the same page: a bar for a graded figure, the editorial reason for
 *  a withheld one, plain words for a real absence. */
function LegBar({ state, draws, name, cls }: { state: LegShortfall; draws: number | null; name: string; cls: string }) {
  if (state.status === "withheld") {
    return (
      <div className="br-bar br-withheld" title={state.reason}>
        <span className="br-leg">{name}</span><span className="br-note">withheld</span>
      </div>
    );
  }
  if (state.status === "not_gradeable") {
    return <div className="br-bar"><span className="br-leg">{name}</span><span className="br-note">not gradeable</span></div>;
  }
  return (
    <div className="br-bar" title={draws != null ? `${draws.toFixed(1)} independent draws` : undefined}>
      <span className="br-leg">{name}</span>
      <span className="br-track"><span className={`br-fill br-${cls}`} style={{ width: `${state.shortfallPct}%` }} /></span>
      <span className="br-val">{state.shortfallPct.toFixed(0)}%</span>
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
            {HORIZONS.map((h) => {
              const pair = pairedShortfall(grades, basis, h);
              return (
                <div className="br-row" key={h}>
                  <span className="br-h">{h} mo</span>
                  <div className="br-pair">
                    {LEGS.map((l) => (
                      <LegBar key={l.key} state={pair[l.key]} name={l.name} cls={l.cls}
                        draws={grades.legs?.[l.key]?.grades?.[basis]?.[horizonKey(h)]?.independent_draws ?? null} />
                    ))}
                  </div>
                </div>
              );
            })}
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
