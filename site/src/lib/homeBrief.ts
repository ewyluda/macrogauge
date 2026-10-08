// The homepage's AI-infrastructure takeaway, written from the published DC
// indexes so the sentence and the tiles beside it can never disagree.
import { fmtDay, fmtMonth, fmtPp, fmtSigned } from "./format";
import type { ArtifactTypes } from "./generated";

export type BriefComp = { label: string; contribution_pp: number | null };

/** "up 8.5%" / "down 1.2%" / "flat" — one decimal, sign from the rounded value. */
export function moveWords(pct: number): string {
  const r = Number(pct.toFixed(1));
  if (r === 0) return "flat";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r).toFixed(1)}%`;
}

/** Lower-case a label for mid-sentence use, leaving acronyms ("AC & …") alone. */
export function midSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

/**
 * Two sentences: the build index and its two biggest same-direction drivers,
 * then hardware and ops. Drivers move the headline the way it moved, so a
 * falling component never "leads" a rising index. Null when build is missing.
 */
export function dcTakeaway({
  build,
  ops,
  hardware,
  comps,
}: {
  build: number | null;
  ops: number | null;
  hardware: number | null;
  comps: BriefComp[];
}): string | null {
  if (build == null) return null;
  const sign = Math.sign(Number(build.toFixed(1)));
  const leaders = sign === 0 ? [] : comps
    .filter((c): c is { label: string; contribution_pp: number } =>
      c.contribution_pp != null && Math.sign(Number(c.contribution_pp.toFixed(2))) === sign)
    .sort((a, b) => Math.abs(b.contribution_pp) - Math.abs(a.contribution_pp))
    .slice(0, 2)
    .map((c) => `${midSentence(c.label)} (${fmtPp(c.contribution_pp)})`);
  let first = `Data-center build input costs are ${moveWords(build)} on the year`;
  if (leaders.length) first += `, led by ${leaders.join(" and ")}`;
  first += ".";
  const rest: string[] = [];
  if (hardware != null) rest.push(`IT hardware costs are ${moveWords(hardware)}`);
  if (ops != null) rest.push(`${rest.length ? "operating costs" : "Operating costs are"} ${moveWords(ops)}`);
  return rest.length ? `${first} ${rest.join(" and ")}.` : first;
}

export type Reading = {
  key: string;
  href: string;
  label: string;
  value: string;
  context: string;
  spark?: (number | null)[];
};

const gw = (mw: number) => (mw / 1000).toFixed(1);

/** The homepage's row of linked AI-infra readings. Each card carries its OWN
 *  observation date in its context (a homepage publish date cannot vouch for
 *  a hub that last traded two weeks ago), and a quote the source page flags
 *  stale reads as stale here too, without a recent-period change beside it
 *  (audit F3). Every reading degrades to absent rather than "—". */
export function homeReadings(
  dc: ArtifactTypes["datacenter"], compute: ArtifactTypes["compute"],
  capacity: ArtifactTypes["capacity"], rates: ArtifactTypes["rates"],
): Reading[] {
  const readings: Reading[] = [];
  const build = dc.indexes.build;
  const pjm = dc.power?.hubs.find((h) => h.code === "ice_pjm_west");
  if (pjm?.avg30 != null) {
    readings.push({
      key: "power", href: "/power", label: "Power · PJM West",
      value: `$${pjm.avg30.toFixed(2)}/MWh`,
      context: `30-day avg to ${fmtDay(pjm.asof)} · ${fmtSigned(pjm.avg30_yoy_pct ?? null)} vs a year ago`,
      spark: (pjm.spark ?? []).map((p) => (typeof p[1] === "number" ? p[1] : null)),
    });
  }
  const h100 = compute.gpus.find((g) => g.code === "vast_h100_sxm");
  if (h100?.usd_per_gpu_hr != null) {
    const dated = h100.as_of ? fmtDay(h100.as_of) : "date unknown";
    readings.push({
      key: "gpu", href: "/compute", label: "GPU-hour · H100",
      value: `$${h100.usd_per_gpu_hr.toFixed(2)}/hr`,
      context: h100.stale
        ? `vast.ai median · stale, as of ${dated}`
        : `vast.ai median · ${fmtSigned(h100.chg_30d_pct)} in 30 days · ${dated}`,
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
  return readings;
}
