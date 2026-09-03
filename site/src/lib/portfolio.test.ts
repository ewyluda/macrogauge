import { describe, expect, it } from "vitest";
import { ESCALATION_DATA as D } from "./escalationData";
import { lastCompleteMonth } from "./dcContingency";
import { escalate } from "./dcEscalation";
import { coerceProject, decodeProjects, driversAcross, encodeProjects, evaluateAll, evaluateProject, totals, type Project } from "./portfolio";

const anchor = lastCompleteMonth(D.months, D.componentLastObs)!;
const last = D.months[D.months.length - 1];
const proj = (over: Partial<Project> = {}): Project => ({
  id: "a1", name: "Campus A", market: "nova", mw: 100, baseCost: 900_000_000,
  baseMonth: "2024-01", deliveryMonth: "", basis: "trailing3y", ...over,
});

describe("evaluateProject", () => {
  it("escalates to date exactly as the calculator does, and carries at the chosen basis", () => {
    const { evals, basisRows } = evaluateAll([proj()], D.months, D.index, anchor);
    const e = evals[0];
    expect(e.errors).toEqual([]);
    const ref = escalate(D.months, D.index, "2024-01", 900_000_000, null)!;
    expect(e.toDate).toBeCloseTo(ref.escalatedCost, 6);
    expect(e.atDelivery).toBeCloseTo(ref.escalatedCost, 6); // no delivery -> no carry
    expect(e.perMwAtDelivery).toBeCloseTo(ref.escalatedCost / 100, 6);
    expect(basisRows.some((b) => b.key === "trailing3y")).toBe(true);
  });
  it("carries forward with a band when the delivery window is long enough", () => {
    const y = Number(last.slice(0, 4)) + 2;
    const p = proj({ deliveryMonth: `${y}-${last.slice(5, 7)}` });
    const { evals } = evaluateAll([p], D.months, D.index, anchor);
    const e = evals[0];
    expect(e.errors).toEqual([]);
    expect(e.horizon).toBe(24);
    expect(e.atDelivery!).toBeGreaterThan(e.toDate!);
    expect(e.band).not.toBeNull();
    expect(e.atDeliveryP10!).toBeLessThan(e.atDeliveryP90!);
  });
  it("reports malformed, out-of-range and over-cap inputs as errors, not numbers", () => {
    const { basisRows } = evaluateAll([], D.months, D.index, anchor);
    expect(evaluateProject(proj({ baseMonth: "March 2024" }), D.months, D.index, anchor, basisRows).errors[0]).toMatch(/not a month/);
    expect(evaluateProject(proj({ baseMonth: "2005-06" }), D.months, D.index, anchor, basisRows).errors[0]).toMatch(/outside the index/);
    expect(evaluateProject(proj({ baseCost: 0 }), D.months, D.index, anchor, basisRows).errors[0]).toMatch(/greater than \$0/);
    const y = Number(last.slice(0, 4)) + 6;
    const far = evaluateProject(proj({ deliveryMonth: `${y}-01` }), D.months, D.index, anchor, basisRows);
    expect(far.errors[0]).toMatch(/carry cap/);
    expect(far.result).toBeNull();
  });
});

describe("totals / drivers", () => {
  it("sums dollars and dollar-weights the rates; invalid projects are excluded", () => {
    const ps = [proj(), proj({ id: "b2", name: "B", baseCost: 100_000_000, baseMonth: "2022-01" }), proj({ id: "bad", baseCost: 0 })];
    const { evals } = evaluateAll(ps, D.months, D.index, anchor);
    const t = totals(evals);
    expect(t.projects).toBe(3);
    expect(t.valid).toBe(2);
    expect(t.capital).toBe(1_000_000_000);
    expect(t.toDate).toBeCloseTo((evals[0].toDate ?? 0) + (evals[1].toDate ?? 0), 6);
    expect(t.weightedToDatePct).toBeCloseTo((t.toDate / t.capital - 1) * 100, 9);
    expect(t.exposureToDate).toBeCloseTo(t.toDate - t.capital, 6);
    const d = driversAcross(evals, D.months, D.componentIndex, D.components);
    expect(d.length).toBe(D.components.length);
    // the published monthly index is rounded to 4dp, so the component bridge
    // and the headline ratio agree to ~1e-5 relative, not to the cent
    const sum = d.reduce((s, x) => s + x.contributionCost, 0);
    expect(Math.abs(sum - t.exposureToDate) / Math.abs(t.exposureToDate)).toBeLessThan(1e-5);
  });
});

describe("encode / decode / coerce", () => {
  it("round-trips a project list and rejects a bad entry", () => {
    const ps = [proj(), proj({ id: "b2", name: "B" })];
    expect(decodeProjects(encodeProjects(ps))).toEqual(ps);
    expect(decodeProjects("not json")).toBeNull();
    expect(decodeProjects(JSON.stringify([{ name: "x", baseMonth: "13-2024" }]))).toBeNull();
    const c = coerceProject({ name: "y", mw: "50", baseCost: "1e6", baseMonth: "2024-01" })!;
    expect(c.mw).toBe(50);
    expect(c.baseCost).toBe(1_000_000);
    expect(c.basis).toBe("trailing3y");
    expect(c.id).toHaveLength(6);
  });
});
