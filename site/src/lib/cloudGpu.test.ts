import { describe, expect, it } from "vitest";
import { capabilityTakeaway, cloudProviders, cloudRows, cloudTakeaway, listOf, reservedRows, reservedTakeaway } from "./cloudGpu";
import type { Capability, CloudGpu, ReservedTerm } from "./types";

const c = (provider: string, gpu: string, v: number | null, stale = false): CloudGpu => ({
  code: `${provider}_${gpu}`, provider, gpu, instance: "x", gpus_per_instance: 8, region: "r",
  usd_per_gpu_hr: v, usd_per_instance_hr: v == null ? null : v * 8, as_of: "2026-10-07", chg_30d_pct: null, stale,
});
const tail = { dates: [], values: [] };
const gpus = [
  { code: "vast_h100_sxm", label: "H100", usd_per_gpu_hr: 1.92, as_of: "2026-10-07", chg_30d_pct: null, tail },
];

describe("cloudRows", () => {
  it("pivots to one row per GPU with the range and the marketplace median", () => {
    const rows = cloudRows({ gpus, cloud_gpus: [c("AWS", "H100", 6.88), c("Azure", "H100", 12.29),
      c("CoreWeave", "H100", 6.155), c("Oracle", "GB200", 16), c("AWS", "B300", null)] });
    expect(rows.map((r) => r.gpu)).toEqual(["H100", "GB200"]);       // B300 had no price
    expect(rows[0].low).toBe(6.155);
    expect(rows[0].high).toBe(12.29);
    expect(rows[0].market).toEqual({ usd: 1.92, as_of: "2026-10-07", stale: false });
    expect(rows[0].cells.Oracle).toBeNull();
    expect(rows[1].market).toBeNull();                                 // no marketplace GB200 row
  });

  it("keeps a stale quote in its cell but out of the current range", () => {
    // the review's Oct 21 case: an Oct 7 AWS quote must not undercut today's Azure one
    const rows = cloudRows({ gpus, cloud_gpus: [c("AWS", "H100", 6.88, true), c("Azure", "H100", 12.29)] });
    expect(rows[0].cells.AWS?.usd_per_gpu_hr).toBe(6.88);
    expect([rows[0].low, rows[0].high, rows[0].fresh]).toEqual([12.29, 12.29, 1]);
    // every quote stale: the row stays (dated cells), the range is empty
    const old = cloudRows({ gpus, cloud_gpus: [c("AWS", "B200", 14.2, true)] });
    expect(old.map((r) => [r.gpu, r.low])).toEqual([["B200", null]]);
  });

  it("is empty on a file published before cloud prices existed", () => {
    expect(cloudRows({ gpus })).toEqual([]);
  });

  it("gives a column only to providers with a quote, in provider order", () => {
    const rows = cloudRows({ gpus, cloud_gpus: [c("Nebius", "H100", 4.5), c("AWS", "H100", 6.88), c("Oracle", "B300", null)] });
    expect(cloudProviders(rows)).toEqual(["AWS", "Nebius"]);         // Oracle's only row has no price
    expect(listOf(["AWS", "Azure", "Oracle", "CoreWeave", "Nebius"])).toBe("AWS, Azure, Oracle, CoreWeave and Nebius");
    expect(listOf(["AWS"])).toBe("AWS");
  });
});

describe("cloudTakeaway", () => {
  it("states the H100 list range across clouds against the marketplace median", () => {
    const rows = cloudRows({ gpus, cloud_gpus: [c("AWS", "H100", 6.88), c("Azure", "H100", 12.29)] });
    expect(cloudTakeaway(rows)).toBe("An H100 lists at $6.88–$12.29 per GPU-hour across 2 clouds, against a $1.92 vast.ai marketplace median.");
    expect(cloudTakeaway([])).toBeNull();
  });

  it("states only current quotes, and drops a stale marketplace median", () => {
    const staleMarket = [{ ...gpus[0], stale: true }];
    const rows = cloudRows({ gpus: staleMarket, cloud_gpus: [c("AWS", "H100", 6.88, true), c("Azure", "H100", 12.29)] });
    expect(cloudTakeaway(rows)).toBe("An H100 lists at $12.29 per GPU-hour across 1 cloud.");
    // no current H100 quote: the lead falls to the next GPU with one, labelled by memory
    const a100 = cloudRows({ gpus, cloud_gpus: [c("AWS", "H100", 6.88, true), c("Oracle", "A100", 4)] });
    expect(cloudTakeaway(a100)).toBe("An A100 80GB lists at $4.00 per GPU-hour across 1 cloud.");
    expect(cloudTakeaway(cloudRows({ gpus, cloud_gpus: [c("AWS", "H100", 6.88, true)] }))).toBeNull();
  });
});

const term = (years: number, v: number | null, disc: number | null, stale = false): ReservedTerm => ({
  term_years: years, usd_per_gpu_hr: v, discount_pct: disc, as_of: "2026-10-08", stale,
});

describe("reservedRows / reservedTakeaway", () => {
  const az = (gpu: string, v: number, reserved: ReservedTerm[], stale = false): CloudGpu =>
    ({ ...c("Azure", gpu, v, stale), reserved });

  it("keeps only SKUs with a priced term, in GPU order, keyed by term", () => {
    const rows = reservedRows({ cloud_gpus: [
      az("GB200", 27.04, [term(1, 17.31, 36), term(3, 11.9, 56)]),
      az("H100", 12.29, [term(1, 7.87, 36), term(3, 5.4, 56.1)]),
      az("H200", 10.6, [term(1, null, null), term(3, null, null)]),
      c("AWS", "H100", 6.88),
    ] });
    expect(rows.map((r) => r.gpu)).toEqual(["H100", "GB200"]);
    expect(rows[0].terms[3]?.usd_per_gpu_hr).toBe(5.4);
  });

  it("leads with the H100 3-year saving", () => {
    const rows = reservedRows({ cloud_gpus: [az("H100", 12.29, [term(1, 7.87, 36), term(3, 5.4, 56.1)])] });
    expect(reservedTakeaway(rows)).toBe(
      "A 3-year Azure reservation cuts an H100 GPU-hour from $12.29 on demand to $5.40, 56% less.");
  });

  it("never claims a saving off a stale price", () => {
    expect(reservedTakeaway(reservedRows({ cloud_gpus: [az("H100", 12.29, [term(3, 5.4, 56.1)], true)] }))).toBeNull();
    expect(reservedTakeaway(reservedRows({ cloud_gpus: [az("H100", 12.29, [term(3, 5.4, 56.1, true)])] }))).toBeNull();
  });
});

describe("capabilityTakeaway", () => {
  const gen = (gpu: string, list: number | null) => ({
    gpu, dense_bf16_tflops: 1, spec_url: "u", list_median_usd_per_gpu_hr: null, list_quotes: list == null ? 0 : 1,
    list_usd_per_pflop_hr: list, reserved_3y_usd_per_pflop_hr: null, market_usd_per_pflop_hr: null,
  });
  const cap = (rows: ReturnType<typeof gen>[]): Capability =>
    ({ basis: "b", basis_note: "n", publisher: "NVIDIA", as_of_curated: "2026-10-08", by_generation: rows });

  it("compares the cheapest generation with the oldest priced one", () => {
    expect(capabilityTakeaway(cap([gen("A100", 10.99), gen("H100", 8.53), gen("B200", 6.22)]))).toBe(
      "A B200 delivers the cheapest dense BF16 PFLOP-hour on cloud list prices, $6.22, 43% below an A100's $10.99.");
  });

  it("says so when the oldest generation is still cheapest, and needs two priced generations", () => {
    expect(capabilityTakeaway(cap([gen("A100", 5), gen("H100", 8.53)]))).toBe(
      "An A100 still delivers the cheapest dense BF16 PFLOP-hour on cloud list prices, $5.00.");
    expect(capabilityTakeaway(cap([gen("A100", null), gen("H100", 8.53)]))).toBeNull();
    expect(capabilityTakeaway(undefined)).toBeNull();
  });
});
