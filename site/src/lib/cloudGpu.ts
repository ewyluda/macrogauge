import type { CloudGpu, Compute } from "./types";

/** /compute's buyer table: cloud list prices per GPU-hour pivoted to one row
 *  per GPU, one column per provider, beside the vast.ai marketplace median. */

export const PROVIDERS = ["AWS", "Azure", "Oracle", "CoreWeave"] as const;
export const GPU_ORDER = ["H100", "H200", "B200", "B300", "GB200", "A100"] as const;
/** the vast.ai row each GPU is compared with (no marketplace row for GB200) */
const MARKET: Record<string, string> = {
  H100: "vast_h100_sxm", H200: "vast_h200", B200: "vast_b200", B300: "vast_b300", A100: "vast_a100_sxm",
};

export type CloudRow = {
  gpu: string;
  cells: Record<string, CloudGpu | null>;
  low: number | null;
  high: number | null;
  market: number | null;
};

export function cloudRows(data: Pick<Compute, "gpus" | "cloud_gpus">): CloudRow[] {
  const cloud = (data.cloud_gpus ?? []).filter((c) => c.usd_per_gpu_hr != null);
  return GPU_ORDER.map((gpu): CloudRow => {
    const cells = Object.fromEntries(
      PROVIDERS.map((p) => [p, cloud.find((c) => c.gpu === gpu && c.provider === p) ?? null]),
    ) as Record<string, CloudGpu | null>;
    const vals = Object.values(cells).filter((c): c is CloudGpu => !!c).map((c) => c.usd_per_gpu_hr!);
    const m = MARKET[gpu] ? data.gpus.find((g) => g.code === MARKET[gpu])?.usd_per_gpu_hr ?? null : null;
    return { gpu, cells, low: vals.length ? Math.min(...vals) : null, high: vals.length ? Math.max(...vals) : null, market: m };
  }).filter((r) => r.low != null);
}

const $ = (v: number) => `$${v.toFixed(2)}`;

/** "An H100 lists at $6.16–$12.29 per GPU-hour across 4 clouds, against a
 *  $1.92 vast.ai marketplace median." — the lead GPU with the most quotes. */
export function cloudTakeaway(rows: CloudRow[]): string | null {
  const lead = rows.find((r) => r.gpu === "H100") ?? rows[0];
  if (!lead || lead.low == null || lead.high == null) return null;
  const n = Object.values(lead.cells).filter(Boolean).length;
  const range = lead.low === lead.high ? $(lead.low) : `${$(lead.low)}–${$(lead.high)}`;
  const article = /^[AEIOU8]|^H\d/.test(lead.gpu) ? "An" : "A";
  return `${article} ${lead.gpu} lists at ${range} per GPU-hour across ${n} cloud${n === 1 ? "" : "s"}` +
    (lead.market != null ? `, against a ${$(lead.market)} vast.ai marketplace median.` : ".");
}
