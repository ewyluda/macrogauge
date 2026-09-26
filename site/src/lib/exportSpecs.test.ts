import { describe, expect, it } from "vitest";
import rates from "../../public/data/rates.json";
import gaugeDaily from "../../public/data/gauge_daily.json";
import compare from "../../public/data/compare.json";
import dcGrades from "../../public/data/dc_grades.json";
import { columnsToRows, flattenRow, getPath, rowsFromSpec, toCsv } from "./csv";
import { sliceSince, windowStart } from "./chartWindow";
import { DC_ANCHORS_CSV, heroCsvSpec, RATES_CURVE_CSV, RATES_HISTORY_CSV, RATES_LIQUIDITY_CSV } from "./exportSpecs";

describe("getPath / rowsFromSpec", () => {
  it("resolves dotted paths and tolerates missing ones", () => {
    expect(getPath({ a: { b: [1] } }, "a.b")).toEqual([1]);
    expect(getPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(rowsFromSpec({}, { kind: "rows", path: "nope" })).toEqual([]);
  });
  it("applies the key window", () => {
    const data = { k: ["2026-01-01", "2026-02-01", "2026-03-01"], v: [1, 2, 3] };
    const spec = { kind: "columns" as const, key: { name: "date", path: "k" }, series: [{ name: "v", path: "v" }], from: "2026-02-01" };
    expect(rowsFromSpec(data, spec)).toEqual([{ date: "2026-02-01", v: 2 }, { date: "2026-03-01", v: 3 }]);
  });
});

// Each lazy recipe must produce byte-identical CSV to the rows the page
// used to inline (the construction copied verbatim from the old page code).
describe("lazy export recipes reproduce the inline rows", () => {
  it("/rates curve, history and liquidity", () => {
    const h = rates.history;
    const liq = rates.liquidity;
    const oldHistory = columnsToRows({ name: "date", values: h.dates }, [
      { name: "dgs3mo", values: h.dgs3mo }, { name: "dgs2", values: h.dgs2 }, { name: "dgs10", values: h.dgs10 },
      { name: "t5yie", values: h.t5yie }, { name: "t10yie", values: h.t10yie }, { name: "hy_oas", values: h.hy_oas },
      { name: "dollar", values: h.dollar }, { name: "spread_2s10s", values: h.spread_2s10s },
      { name: "spread_3m10y", values: h.spread_3m10y }, { name: "real_10y", values: h.real_10y },
    ]);
    const oldLiq = columnsToRows({ name: "date", values: liq.history.dates }, [
      { name: "walcl_bn", values: liq.history.walcl_bn }, { name: "tga_bn", values: liq.history.tga_bn },
      { name: "rrp_bn", values: liq.history.rrp_bn }, { name: "net_bn", values: liq.history.net_bn },
    ]);
    expect(oldHistory.length).toBeGreaterThan(1000);
    expect(toCsv(rowsFromSpec(rates, RATES_HISTORY_CSV))).toBe(toCsv(oldHistory));
    expect(toCsv(rowsFromSpec(rates, RATES_LIQUIDITY_CSV))).toBe(toCsv(oldLiq));
    expect(toCsv(rowsFromSpec(rates, RATES_CURVE_CSV))).toBe(toCsv(rates.curve));
  });
  it("home hero 24-month window", () => {
    const start = windowStart([gaugeDaily.variants.gauge.dates, compare.months], 24);
    const hero = sliceSince(
      gaugeDaily.variants.gauge.dates,
      [gaugeDaily.variants.gauge.yoy_pct, gaugeDaily.variants.tracker.yoy_pct, gaugeDaily.variants.col.yoy_pct],
      start,
    );
    const old = columnsToRows({ name: "date", values: hero.dates }, [
      { name: "gauge_yoy_pct", values: hero.series[0] },
      { name: "tracker_yoy_pct", values: hero.series[1] },
      { name: "col_yoy_pct", values: hero.series[2] },
    ]);
    expect(old.length).toBeGreaterThan(600);
    expect(toCsv(rowsFromSpec(gaugeDaily, heroCsvSpec(start)))).toBe(toCsv(old));
  });
  it("/dc-scoreboard anchors", () => {
    const old = dcGrades.anchors.map((a) => flattenRow(a));
    expect(old.length).toBeGreaterThan(0);
    expect(toCsv(rowsFromSpec(dcGrades, DC_ANCHORS_CSV))).toBe(toCsv(old));
  });
});
