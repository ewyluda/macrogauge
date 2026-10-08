import type { CloudGpu, Compute } from "./types";

/** /compute's buyer table: cloud list prices per GPU-hour pivoted to one row
 *  per GPU, one column per provider, beside the vast.ai marketplace median.
 *  A quote flagged `stale` (older than its registry staleness limit) stays in
 *  its cell with its date but never counts toward the current range, the
 *  cheapest-price mark or the takeaway. */

export const PROVIDERS = ["AWS", "Azure", "Oracle", "CoreWeave", "Nebius"] as const;
export const GPU_ORDER = ["H100", "H200", "B200", "B300", "GB200", "A100"] as const;
/** every cloud A100 row is the 80GB part (AWS p4de, not the 40GB p4d) */
export const GPU_LABEL: Record<string, string> = { A100: "A100 80GB" };
/** the vast.ai row each GPU is compared with (no marketplace row for GB200) */
const MARKET: Record<string, string> = {
  H100: "vast_h100_sxm", H200: "vast_h200", B200: "vast_b200", B300: "vast_b300", A100: "vast_a100_sxm",
};

export type MarketQuote = { usd: number; as_of: string | null; stale: boolean };
export type CloudRow = {
  gpu: string;
  cells: Record<string, CloudGpu | null>;
  /** the range over FRESH quotes only; null when every quote is stale */
  low: number | null;
  high: number | null;
  fresh: number;
  market: MarketQuote | null;
};

export function cloudRows(data: Pick<Compute, "gpus" | "cloud_gpus">): CloudRow[] {
  const cloud = (data.cloud_gpus ?? []).filter((c) => c.usd_per_gpu_hr != null);
  return GPU_ORDER.map((gpu): CloudRow => {
    const cells = Object.fromEntries(
      PROVIDERS.map((p) => [p, cloud.find((c) => c.gpu === gpu && c.provider === p) ?? null]),
    ) as Record<string, CloudGpu | null>;
    const vals = Object.values(cells).filter((c): c is CloudGpu => !!c && !c.stale).map((c) => c.usd_per_gpu_hr!);
    const g = MARKET[gpu] ? data.gpus.find((x) => x.code === MARKET[gpu]) : undefined;
    const market = g?.usd_per_gpu_hr != null ? { usd: g.usd_per_gpu_hr, as_of: g.as_of, stale: !!g.stale } : null;
    return { gpu, cells, low: vals.length ? Math.min(...vals) : null, high: vals.length ? Math.max(...vals) : null,
             fresh: vals.length, market };
  }).filter((r) => Object.values(r.cells).some(Boolean));
}

/** The providers with at least one quote in the table, in PROVIDERS order: a
 *  provider added to the pipeline gets a column from its first publish, never
 *  an all-dash column before it. */
export function cloudProviders(rows: CloudRow[]): string[] {
  return PROVIDERS.filter((p) => rows.some((r) => r.cells[p]));
}

/** "AWS, Azure and Oracle" */
export function listOf(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const $ = (v: number) => `$${v.toFixed(2)}`;

/** "An H100 lists at $6.16–$12.29 per GPU-hour across 4 clouds, against a
 *  $1.92 vast.ai marketplace median." — the lead GPU with current quotes. */
export function cloudTakeaway(rows: CloudRow[]): string | null {
  const live = rows.filter((r) => r.low != null);
  const lead = live.find((r) => r.gpu === "H100") ?? live[0];
  if (!lead || lead.low == null || lead.high == null) return null;
  const n = lead.fresh;
  const range = lead.low === lead.high ? $(lead.low) : `${$(lead.low)}–${$(lead.high)}`;
  const label = GPU_LABEL[lead.gpu] ?? lead.gpu;
  const article = /^[AEIOU8]|^H\d/.test(label) ? "An" : "A";
  return `${article} ${label} lists at ${range} per GPU-hour across ${n} cloud${n === 1 ? "" : "s"}` +
    (lead.market && !lead.market.stale ? `, against a ${$(lead.market.usd)} vast.ai marketplace median.` : ".");
}
