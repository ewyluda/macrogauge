import Link from "next/link";
import dcJson from "../../public/data/datacenter.json";
import computeJson from "../../public/data/compute.json";
import capacityJson from "../../public/data/capacity.json";
import { artifact } from "@/lib/artifact";
import { fmtDay, fmtMonth } from "@/lib/format";
import { DC_WEIGHT_BASIS, DC_WEIGHT_REVIEWED, type DcIndexKey } from "@/lib/dcWeightBasis";
import { midSentence } from "@/lib/homeBrief";

const INDEXES: { key: DcIndexKey; title: string; prices: string }[] = [
  { key: "build", title: "DC Build", prices: "what goes into the facility: site labor, materials, electrical and mechanical equipment" },
  { key: "ops", title: "DC Ops", prices: "running the facility: industrial power, facilities labor and maintenance" },
  { key: "hardware", title: "DC Hardware", prices: "the IT equipment inside: servers and components, storage, network gear" },
];

const pct = (w: number) => `${+(w * 100).toFixed(1)}%`;
/** "A, b and c" — sentence-cased list of component labels. */
const listOf = (labels: string[]) => {
  const words = labels.map((l, i) => (i === 0 ? l : midSentence(l)));
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
};

/** The data-center and AI-infra half of /methodology, generated from the
 *  published datacenter / compute / capacity artifacts. Only the weight
 *  rationale is hand-written (lib/dcWeightBasis.ts, drift-tested). */
export function DcMethodology() {
  const dc = artifact("datacenter", dcJson);
  const compute = artifact("compute", computeJson);
  const capacity = artifact("capacity", capacityJson);
  const groupLabel = (g: string) => String(dc.group_labels[g] ?? g);
  const tailed = INDEXES.flatMap(({ key }) =>
    (dc.indexes[key]?.components ?? []).filter((c) => c.mode === "official+proxy").map((c) => c.label));
  const { w_labor: wl, w_power: wp } = dc.parity;
  const gpusInIndex = compute.gpus.filter((g) => g.in_index !== false).length;
  const all = capacity.cohorts.all;

  return (
    <div className="dc-method-doc">
      <p className="dc-method-lede">
        Three daily input-price indexes, rebased {dc.rebase}. Each is a fixed-weight basket of official price
        series. They track the cost of the inputs, not contractor bids: margin and bid climate sit outside them,
        which is why <Link href="/datacenter#dc-context">/datacenter</Link> shows Turner, Turner &amp; Townsend
        and the BLS office-building PPI beside them. No official data-center price index exists.
      </p>

      {INDEXES.map(({ key, title, prices }) => {
        const ix = dc.indexes[key];
        if (!ix) return null;
        return (
          <div className="table-card dc-method-index" key={key} id={`method-${key}`}>
            <h3>
              {title} <span>prices {prices} · {ix.components.length} components · as of {fmtDay(ix.as_of)}</span>
            </h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Component</th>
                    <th>Weight</th>
                    <th style={{ textAlign: "left" }}>Data</th>
                    <th>Latest print</th>
                  </tr>
                </thead>
                {ix.groups.map((g) => {
                  const basis = DC_WEIGHT_BASIS[key][g.group];
                  return (
                    <tbody key={g.group}>
                      <tr className="dc-method-group">
                        <td colSpan={4} style={{ textAlign: "left" }}>
                          <strong>{groupLabel(g.group)} · {pct(g.weight)}</strong>
                          {basis && (
                            <span className="dc-method-basis">
                              {basis.note}
                              {basis.cites.length > 0 && (
                                <> Sources:{" "}
                                  {basis.cites.map((c, i) => (
                                    <span key={c.href}>
                                      {i > 0 && "; "}
                                      <a href={c.href} target="_blank" rel="noopener noreferrer">{c.label}</a>
                                    </span>
                                  ))}.
                                </>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                      {ix.components.filter((c) => c.group === g.group).map((c) => (
                        <tr key={c.code}>
                          <td style={{ textAlign: "left" }}>{c.label}</td>
                          <td>{pct(c.weight)}</td>
                          <td style={{ textAlign: "left" }}>
                            <span className={c.mode === "official" ? "badge badge-muted" : "badge"}>
                              {c.mode === "official" ? "official" : "official + live tail"}
                            </span>
                          </td>
                          <td>
                            {fmtMonth(c.last_obs)}
                            {c.stale && <span className="badge badge-muted dc-method-stale">late</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            <p className="dc-method-reviewed">Weights last checked against the sources: {fmtDay(DC_WEIGHT_REVIEWED[key])}.</p>
          </div>
        );
      })}

      <h3 className="dc-method-sub">Rules every DC index follows</h3>
      <ul className="dc-method-rules">
        <li>
          <b>Fixed weights.</b> A component whose next print is late carries its last value forward. Its weight is
          never handed to the other components, so the basket always means the same thing.
        </li>
        {tailed.length > 0 && (
          <li>
            <b>Live tails.</b> {listOf(tailed)} {tailed.length === 1 ? "rides" : "ride"} a daily market price
            after the last official print. The tail is spliced onto the official series at that print and re-anchored
            at the next, so market data never overwrites official history. Copper and aluminum use front-month
            futures. Storage uses NAND spot prices, and only while NAND is more than 50% away from its level a
            year earlier, the regime where its backtest beat carrying the last print forward.
          </li>
        )}
        <li>
          <b>Facility boundary.</b> DC Build excludes servers and GPUs. They sit in DC Hardware, which prices
          them with BLS import and producer price indexes. Those are constant-quality indexes: BLS removes
          performance and feature changes (with hedonic models where it needs them), so DC Hardware tracks the
          price of like-for-like equipment, not the dollars a buyer spends as each generation gets faster.
        </li>
        <li>
          <b>Quality hold.</b> The same one-day gate as the CPI gauge, on the live-proxy tail only: a
          just-arrived futures or spot point that moves more than 5% waits a day before it enters the index.
          Official prints are never held.
        </li>
        <li>
          <b>State parity.</b> Nationally priced inputs stay at the national level. Build multiplier ={" "}
          <code>{wl} × state construction wage ÷ national + {(1 - wl).toFixed(2)}</code>; Ops multiplier ={" "}
          <code>{wp} × state industrial power price ÷ national + {(1 - wp).toFixed(2)}</code>.
        </li>
      </ul>

      <h3 className="dc-method-sub" id="method-compute">Compute price indexes</h3>
      <p className="dc-method-text">
        Two indexes on <Link href="/compute">/compute</Link>: one for tokens across {compute.models.length} models
        and one for GPU-hours across {gpusInIndex} GPU types
        {compute.gpus.length > gpusInIndex ? ` (${compute.gpus.length - gpusInIndex} more shown for reference only)` : ""}.
        A model&apos;s price is {pct(compute.blend.in)} input and {pct(compute.blend.out)} output per million
        tokens. Each index is a {compute.blend.method}. An index publishes only on days when at least{" "}
        {compute.blend.min_members} members are priced
        {compute.history_start ? `, with history from ${fmtDay(compute.history_start)}` : ""}.
      </p>

      <h3 className="dc-method-sub" id="method-capacity">AI capacity tracker</h3>
      <p className="dc-method-text">
        Hand-curated critical-IT megawatts for {all ? `${all.companies} companies` : "each company"}, last reviewed{" "}
        {fmtDay(capacity.as_of_curated)}, split into operational, under construction and planned, each row tagged
        filed or estimate. Hyperscaler megawatts are estimates because none of them discloses a filing-grade
        critical-IT split. Market values reprice daily. Derived columns on{" "}
        <Link href="/capacity">/capacity</Link>:
      </p>
      <ul className="dc-method-rules">
        {Object.entries(capacity.basis).map(([k, v]) => (
          <li key={k}><code>{k}</code> = <code>{String(v)}</code></li>
        ))}
      </ul>
    </div>
  );
}
