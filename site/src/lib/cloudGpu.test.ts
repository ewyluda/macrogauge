import { describe, expect, it } from "vitest";
import { cloudRows, cloudTakeaway } from "./cloudGpu";
import type { CloudGpu } from "./types";

const c = (provider: string, gpu: string, v: number | null): CloudGpu => ({
  code: `${provider}_${gpu}`, provider, gpu, instance: "x", gpus_per_instance: 8, region: "r",
  usd_per_gpu_hr: v, usd_per_instance_hr: v == null ? null : v * 8, as_of: "2026-10-07", chg_30d_pct: null,
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
    expect(rows[0].market).toBe(1.92);
    expect(rows[0].cells.Oracle).toBeNull();
    expect(rows[1].market).toBeNull();                                 // no marketplace GB200 row
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
});
