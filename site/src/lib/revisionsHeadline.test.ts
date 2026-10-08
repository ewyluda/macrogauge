import { describe, expect, it } from "vitest";
import { payrollTakeaway } from "./revisionsHeadline";

const s = (abs: number | null, bias: number | null, n = 36) =>
  ({ n, n_revised: n, mean_abs_change_revision_k: abs, mean_revision: bias });

describe("payrollTakeaway", () => {
  it("says first prints overstated growth when revisions run down", () => {
    expect(payrollTakeaway(s(76.3, -68.4))).toBe(
      "First payroll prints have overstated job growth by 68k a month on average over the last 36 months; the typical revision is 76k.");
  });
  it("says understated when revisions run up", () => {
    expect(payrollTakeaway(s(50, 30))).toContain("understated job growth by 30k");
  });
  it("calls a small bias no lean", () => {
    expect(payrollTakeaway(s(50, -9))).toContain("no lean either way");
  });
  it("is null without data", () => {
    expect(payrollTakeaway(s(null, null, 0))).toBeNull();
  });
});
