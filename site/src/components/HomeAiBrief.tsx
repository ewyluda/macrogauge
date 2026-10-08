import Link from "next/link";
import dcJson from "../../public/data/datacenter.json";
import computeJson from "../../public/data/compute.json";
import capacityJson from "../../public/data/capacity.json";
import ratesJson from "../../public/data/rates.json";
import { artifact } from "@/lib/artifact";
import { dcTakeaway, homeReadings } from "@/lib/homeBrief";
import { fmtDay, fmtSigned } from "@/lib/format";
import { KpiCard } from "./KpiCard";
import { TailSpark } from "./TailSpark";

// price-level trails: a neutral stroke, since yoyColor reads a level as a rate
const SPARK = "var(--accent-sky)";

/** The homepage's AI-infrastructure track: the three DC indexes, one
 *  sentence on what moved them, and a row of linked readings into each
 *  AI Infra page. Every reading degrades to absent rather than "—". */
export function HomeAiBrief() {
  const dc = artifact("datacenter", dcJson);
  const compute = artifact("compute", computeJson);
  const capacity = artifact("capacity", capacityJson);
  const rates = artifact("rates", ratesJson);

  const { build, ops, hardware } = dc.indexes;
  const takeaway = build
    ? dcTakeaway({
        build: build.headline_yoy_pct,
        ops: ops?.headline_yoy_pct ?? null,
        hardware: hardware?.headline_yoy_pct ?? null,
        comps: build.components,
      })
    : null;

  const readings = homeReadings(dc, compute, capacity, rates);

  return (
    <section className="home-track" id="ai-infrastructure" aria-labelledby="home-ai-title">
      <div className="home-track-head">
        <h2 id="home-ai-title">AI infrastructure</h2>
        <Link href="/datacenter">Data Center Cost Index →</Link>
      </div>
      {takeaway && <p className="home-track-takeaway" data-testid="ai-takeaway">{takeaway}</p>}
      {build && (
        <div className="home-ai-indexes">
          <KpiCard className="home-ai-primary" label="DC Build · YoY" value={fmtSigned(build.headline_yoy_pct)}
            context={`construction input costs · ${fmtDay(build.as_of)}`} />
          {ops && <KpiCard label="DC Ops · YoY" value={fmtSigned(ops.headline_yoy_pct)}
            context={`operating input costs · ${fmtDay(ops.as_of)}`} />}
          {hardware && <KpiCard label="DC Hardware · YoY" value={fmtSigned(hardware.headline_yoy_pct)}
            context={`IT hardware input costs · ${fmtDay(hardware.as_of)}`} />}
        </div>
      )}
      {readings.length > 0 && (
        <div className="home-ai-pulse" data-testid="ai-pulse">
          {readings.map((r) => (
            <Link key={r.key} href={r.href} className="home-ai-reading">
              <span className="home-ai-label">{r.label}</span>
              <strong>{r.value}</strong>
              <small>{r.context}</small>
              {r.spark && r.spark.length > 1 && <TailSpark tail={r.spark} stroke={SPARK} label={r.label} />}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
