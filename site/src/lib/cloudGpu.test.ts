import { describe, expect, it } from "vitest";
import { cloudRows, cloudTakeaway } from "./cloudGpu";
import type { CloudGpu } from "./types";

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
