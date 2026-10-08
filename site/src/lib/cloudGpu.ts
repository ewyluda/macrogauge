import type { Capability, CloudGpu, Compute, ReservedTerm } from "./types";

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

export type ReservedRow = { gpu: string; provider: string; instance: string; onDemand: CloudGpu;
                            terms: Record<number, ReservedTerm | undefined> };

/** /compute's commitment table: one row per SKU whose provider posts reservations (Azure today),
 *  on-demand beside each term. A row with no priced term is left out. */
export function reservedRows(data: Pick<Compute, "cloud_gpus">): ReservedRow[] {
  return GPU_ORDER.flatMap((gpu) => (data.cloud_gpus ?? [])
    .filter((c) => c.gpu === gpu && (c.reserved ?? []).some((t) => t.usd_per_gpu_hr != null))
    .map((c) => ({ gpu, provider: c.provider, instance: c.instance, onDemand: c,
                   terms: Object.fromEntries((c.reserved ?? []).map((t) => [t.term_years, t])) })));
}

/** "A 3-year Azure reservation cuts an H100 GPU-hour from $12.29 on demand to $5.40, 56% less." —
 *  the lead GPU with a fresh on-demand price and a fresh 3-year term. */
export function reservedTakeaway(rows: ReservedRow[]): string | null {
  const live = rows.filter((r) => !r.onDemand.stale && r.onDemand.usd_per_gpu_hr != null &&
    r.terms[3]?.usd_per_gpu_hr != null && !r.terms[3]?.stale && r.terms[3]?.discount_pct != null);
  const lead = live.find((r) => r.gpu === "H100") ?? live[0];
  if (!lead) return null;
  const t = lead.terms[3]!;
  const label = GPU_LABEL[lead.gpu] ?? lead.gpu;
  const article = /^[AEIOU8]|^H\d/.test(label) ? "an" : "a";
  return `A 3-year ${lead.provider} reservation cuts ${article} ${label} GPU-hour from ${$(lead.onDemand.usd_per_gpu_hr!)} ` +
    `on demand to ${$(t.usd_per_gpu_hr!)}, ${Math.round(t.discount_pct!)}% less.`;
}

/** "A B200 delivers the cheapest dense BF16 PFLOP-hour on cloud list prices, $6.22, 43% below an
 *  A100's $10.99." — the cheapest generation against the oldest one priced. */
export function capabilityTakeaway(cap: Capability | undefined): string | null {
  const priced = (cap?.by_generation ?? []).filter((g) => g.list_usd_per_pflop_hr != null);
  if (priced.length < 2) return null;
  const oldest = priced[0];
  const cheapest = priced.reduce((a, b) => (b.list_usd_per_pflop_hr! < a.list_usd_per_pflop_hr! ? b : a));
  const an = (g: string) => (/^[AEIOU8]|^H\d/.test(g) ? `an ${g}` : `a ${g}`);
  const cap1 = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (cheapest.gpu === oldest.gpu)
    return `${cap1(an(oldest.gpu))} still delivers the cheapest dense BF16 PFLOP-hour on cloud list prices, ${$(oldest.list_usd_per_pflop_hr!)}.`;
  const pct = Math.round(100 * (1 - cheapest.list_usd_per_pflop_hr! / oldest.list_usd_per_pflop_hr!));
  return `${cap1(an(cheapest.gpu))} delivers the cheapest dense BF16 PFLOP-hour on cloud list prices, ` +
    `${$(cheapest.list_usd_per_pflop_hr!)}, ${pct}% below ${an(oldest.gpu)}'s ${$(oldest.list_usd_per_pflop_hr!)}.`;
}
