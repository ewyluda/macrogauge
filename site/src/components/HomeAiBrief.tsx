import Link from "next/link";
import dcJson from "../../public/data/datacenter.json";
import computeJson from "../../public/data/compute.json";
import capacityJson from "../../public/data/capacity.json";
import ratesJson from "../../public/data/rates.json";
import { artifact } from "@/lib/artifact";
import { dcTakeaway } from "@/lib/homeBrief";
import { fmtDay, fmtMonth, fmtPp, fmtSigned } from "@/lib/format";
import { KpiCard } from "./KpiCard";
import { TailSpark } from "./TailSpark";

type Reading = {
  key: string;
  href: string;
  label: string;
  value: string;
  context: string;
  spark?: (number | null)[];
};

const gw = (mw: number) => (mw / 1000).toFixed(1);
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

  const readings: Reading[] = [];
  const pjm = dc.power?.hubs.find((h) => h.code === "ice_pjm_west");
  if (pjm?.avg30 != null) {
    readings.push({
      key: "power", href: "/datacenter#dc-power", label: "Power · PJM West",
      value: `$${pjm.avg30.toFixed(2)}/MWh`,
      context: `30-day avg · ${fmtSigned(pjm.avg30_yoy_pct ?? null)} vs a year ago`,
      spark: (pjm.spark ?? []).map((p) => (typeof p[1] === "number" ? p[1] : null)),
    });
  }
  const h100 = compute.gpus.find((g) => g.code === "vast_h100_sxm");
  if (h100?.usd_per_gpu_hr != null) {
    readings.push({
      key: "gpu", href: "/compute", label: "GPU-hour · H100",
      value: `$${h100.usd_per_gpu_hr.toFixed(2)}/hr`,
      context: `vast.ai median · ${fmtSigned(h100.chg_30d_pct)} in 30 days`,
      spark: h100.tail.values,
    });
  }
  const all = capacity.cohorts.all;
  if (all) {
    readings.push({
      key: "capacity", href: "/capacity", label: "AI capacity",
      value: `${gw(all.op)} GW live`,
      context: `of ${gw(all.op + all.con + all.plan)} GW tracked across ${all.companies} companies`,
    });
  }
  const spend = dc.construction;
  if (spend) {
    readings.push({
      key: "construction", href: "/datacenter#dc-construction", label: "DC construction spend",
      value: `$${(spend.latest_saar / 1000).toFixed(1)}B/yr`,
      context: `${fmtSigned(spend.yoy_pct)} YoY · Census · ${fmtMonth(spend.as_of)}`,
      spark: spend.saar.slice(-36),
    });
  }
  const switchgear = build?.components.find((c) => c.code === "switchgear");
  if (switchgear?.yoy_pct != null) {
    readings.push({
      key: "switchgear", href: "/longlead", label: "Switchgear prices",
      value: `${fmtSigned(switchgear.yoy_pct)} YoY`,
      context: `PPI · ${fmtMonth(switchgear.last_obs)} · long-lead package`,
    });
  }
  const t10 = rates.curve.find((c) => c.code === "DGS10");
  if (t10?.value != null) {
    readings.push({
      key: "rates", href: "/rates", label: "Cost of capital · 10y",
      value: `${t10.value.toFixed(2)}%`,
      context: `${fmtPp(t10.chg_1y_pp)} in a year${t10.as_of ? ` · ${fmtDay(t10.as_of)}` : ""}`,
      spark: rates.history.dgs10.slice(-260),
    });
  }

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
