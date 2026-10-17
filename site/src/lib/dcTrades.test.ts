import { describe, expect, it } from "vitest";
import { groupTrades, tradeAsOf, tradeLevel, tradeVs, TRADE_GROUPS } from "./dcTrades";
import type { DcTradeRow } from "./types";

// A populated block as the writer emits it (values from the 2026-10-16
// review's BLS/FRED checks) — the committed labor.json predates dc_trades,
// so e2e can't see these rows until the first daily publish carries them.
const row = (o: Partial<DcTradeRow> & Pick<DcTradeRow, "key" | "group">): DcTradeRow => ({
  label: o.key, series_id: o.key.toUpperCase(), source: "BLS CES", unit: "index", cadence: "monthly",
  value: null, yoy_pct: null, as_of: null, vs_label: null, vs_yoy_pct: null, spread_pp: null, ...o,
});
const ROWS: DcTradeRow[] = [
  row({ key: "electrical_ahe", group: "earnings", unit: "usd_per_hour", value: 43.61, yoy_pct: 6.26,
        as_of: "2026-08-01", vs_label: "all construction", vs_yoy_pct: 4.15, spread_pp: 2.11 }),
  row({ key: "plumbing_hvac_ahe", group: "earnings", unit: "usd_per_hour", value: 42.44, yoy_pct: 4.48,
        as_of: "2026-08-01", vs_label: "all construction", vs_yoy_pct: 4.15, spread_pp: 0.33 }),
  row({ key: "nonres_specialty_jobs", group: "jobs", unit: "thousands", value: 2939.6, yoy_pct: 2.96,
        as_of: "2026-09-01", vs_label: "residential specialty trades", vs_yoy_pct: -1.22, spread_pp: 4.18 }),
  row({ key: "res_specialty_jobs", group: "jobs", unit: "thousands", value: 2340.3, yoy_pct: -1.22, as_of: "2026-09-01" }),
  row({ key: "adp_construction_jobs", group: "jobs", unit: "thousands", value: 8113, yoy_pct: 1.21, as_of: "2026-09-01" }),
  row({ key: "eci_construction", group: "eci", cadence: "quarterly", value: 174.6, yoy_pct: 3.52, as_of: "2026-04-01" }),
  row({ key: "eci_install_maint_repair", group: "eci", cadence: "quarterly", value: 179.8, yoy_pct: 3.71, as_of: "2026-04-01" }),
  row({ key: "postings_construction", group: "postings", cadence: "daily", value: 129.2, yoy_pct: 6.39, as_of: "2026-10-09" }),
  row({ key: "postings_electrical_engineering", group: "postings", cadence: "daily", value: 153.0, as_of: "2026-10-09" }),
  row({ key: "postings_install_maint", group: "postings", cadence: "daily" }),
];

describe("groupTrades", () => {
  it("keeps unlike measures apart, in page order, every row placed once", () => {
    const groups = groupTrades(ROWS);
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([
      ["Contractor earnings", 2], ["Construction jobs", 3], ["Fixed-mix wage indexes", 2], ["Hiring signals", 3]]);
    expect(groups.flatMap((g) => g.rows)).toEqual(ROWS);
  });
  it("names what each group is not, and drops a group with no rows", () => {
    const scope = Object.fromEntries(TRADE_GROUPS.map((g) => [g.group, g.scope]));
    expect(scope.earnings).toContain("not a trade's wage rate");
    expect(scope.postings).toContain("not electricians");
    expect(groupTrades(ROWS.filter((r) => r.group !== "eci")).map((g) => g.group)).toEqual(["earnings", "jobs", "postings"]);
  });
});

describe("trade cells", () => {
  it("formats each unit, and a missing value as a dash", () => {
    expect(ROWS.map(tradeLevel)).toEqual([
      "$43.61/hr", "$42.44/hr", "2,940k", "2,340k", "8,113k", "174.6", "179.8", "129.2", "153.0", "—"]);
  });
  it("dates each cadence: day, month, quarter", () => {
    expect(ROWS.map(tradeAsOf)).toEqual([
      "Aug 2026", "Aug 2026", "Sep 2026", "Sep 2026", "Sep 2026", "Q2 2026", "Q2 2026",
      "Oct 9, 2026", "Oct 9, 2026", "—"]);
  });
  it("labels every quarter, dated at its first or its last month", () => {
    const q = (as_of: string) => tradeAsOf(row({ key: "q", group: "eci", cadence: "quarterly", as_of }));
    expect(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"].map(q)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
    expect(["2026-03-01", "2026-06-01", "2026-09-01", "2026-12-01"].map(q)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
  });
  it("states the spread over the like-month comparison, or a dash without one", () => {
    expect(tradeVs(ROWS[0])).toBe("+2.1pp over all construction (+4.2%)");
    expect(tradeVs(ROWS[2])).toBe("+4.2pp over residential specialty trades (−1.2%)");
    expect(tradeVs(row({ key: "x", group: "earnings", spread_pp: -0.04, vs_label: "all construction", vs_yoy_pct: 4.15 })))
      .toBe("0.0pp over all construction (+4.2%)");
    expect(tradeVs(ROWS[3])).toBe("—");
  });
});
