import { describe, expect, it } from "vitest";
import { computeIndexRows } from "./computeCsv";
import computeJson from "../../public/data/compute.json";

describe("computeIndexRows", () => {
  it("joins the two histories on date, not array position", () => {
    // token starts a day later and skips the weekend; gpu has the weekend
    const token = { dates: ["2026-09-12", "2026-09-14"], index: [101, 102], members: [6, 6] };
    const gpu = {
      dates: ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"],
      index: [90, 91, null, 93], members: [5, 5, 1, 5],
    };
    const rows = computeIndexRows(token, gpu);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(rows[0]).toEqual({ date: "2026-09-11", token_index: null, token_members: null, gpu_index: 90, gpu_members: 5 });
    expect(rows[1]).toEqual({ date: "2026-09-12", token_index: 101, token_members: 6, gpu_index: 91, gpu_members: 5 });
    expect(rows[2]).toEqual({ date: "2026-09-13", token_index: null, token_members: null, gpu_index: null, gpu_members: 1 });
    expect(rows[3]).toEqual({ date: "2026-09-14", token_index: 102, token_members: 6, gpu_index: 93, gpu_members: 5 });
  });

  it("every published value lands on its own date", () => {
    const { token_index: ti, gpu_index: gi } = computeJson;
    const rows = new Map(computeIndexRows(ti.history, gi.history).map((r) => [r.date as string, r]));
    ti.history.dates.forEach((d, i) => expect(rows.get(d)!.token_index).toBe(ti.history.index[i] ?? null));
    gi.history.dates.forEach((d, i) => expect(rows.get(d)!.gpu_index).toBe(gi.history.index[i] ?? null));
  });
});
