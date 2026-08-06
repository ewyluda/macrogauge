import { describe, expect, it } from "vitest";
import {
  band,
  BASES,
  bases,
  lastCompleteMonth,
  MAX_HORIZON_MONTHS,
  MIN_HORIZON_MONTHS,
} from "./dcContingency";

// A 4-year monthly grid compounding at exactly 5%/yr from 100.
// 2022-01 .. 2026-01 inclusive = 49 months.
const MONTHS: string[] = [];
const INDEX: number[] = [];
for (let k = 0; k <= 48; k++) {
  const y = 2022 + Math.floor(k / 12);
  const mo = (k % 12) + 1;
  MONTHS.push(`${y}-${String(mo).padStart(2, "0")}`);
  INDEX.push(100 * Math.pow(1.05, k / 12));
}

describe("lastCompleteMonth", () => {
  it("takes the minimum component last_obs, not the last grid month", () => {
    // copper is daily and runs ahead; the PPIs stop at June
    expect(
      lastCompleteMonth(MONTHS, ["2026-01-20", "2025-12-01", "2025-12-01"])
    ).toBe("2025-12");
  });

  it("clamps to a month that actually exists in the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2030-06-01"])).toBe("2026-01");
  });

  it("returns null when the cap predates the grid", () => {
    expect(lastCompleteMonth(MONTHS, ["2019-01-01"])).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(lastCompleteMonth([], ["2025-01-01"])).toBeNull();
    expect(lastCompleteMonth(MONTHS, [])).toBeNull();
  });
});

describe("bases", () => {
  it("computes the annualized ratio, not a median of YoY prints", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const momentum = out.find((b) => b.key === "momentum")!;
    expect(momentum.months).toBe(12);
    expect(momentum.annualizedPct).toBeCloseTo(5.0, 6);
    expect(momentum.cumulativePct).toBeCloseTo(5.0, 6);
  });

  it("annualizes a multi-year window correctly", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const t3 = out.find((b) => b.key === "trailing3y")!;
    expect(t3.months).toBe(36);
    expect(t3.annualizedPct).toBeCloseTo(5.0, 6);
    expect(t3.cumulativePct).toBeCloseTo(15.7625, 3); // 1.05^3 - 1
  });

  it("runs long-run from the first month in the sample", () => {
    const out = bases(MONTHS, INDEX, "2026-01");
    const lr = out.find((b) => b.key === "longrun")!;
    expect(lr.startMonth).toBe("2022-01");
    expect(lr.endMonth).toBe("2026-01");
    expect(lr.months).toBe(48);
    expect(lr.annualizedPct).toBeCloseTo(5.0, 6);
  });

  it("omits absolute bases whose window predates the sample", () => {
    // This grid starts 2022-01. Both absolute windows begin before it
    // (2008-12 and 2021-04), so monthIndexAtOrBefore returns -1 for each
    // start and both are omitted rather than silently clamped forward.
    const keys = bases(MONTHS, INDEX, "2026-01").map((b) => b.key);
    expect(keys).not.toContain("gfc");
    expect(keys).not.toContain("covid");
    expect(keys).toEqual(["longrun", "trailing3y", "momentum"]);
  });

  it("omits an absolute basis whose window OUTLIVES the sample, never clamps the end", () => {
    // Grid 2021-01..2022-06 contains the COVID window's start (2021-04) but
    // ends before its end (2023-12). Pre-fix, monthIndexAtOrBefore clamped
    // the end to 2022-06 and published a 14-month statistic under the
    // "Peak regime (COVID)" label — the truncation the docblock prohibits.
    const months: string[] = [];
    const index: number[] = [];
    for (let k = 0; k <= 17; k++) {
      const y = 2021 + Math.floor(k / 12);
      const mo = (k % 12) + 1;
      months.push(`${y}-${String(mo).padStart(2, "0")}`);
      index.push(100 * Math.pow(1.05, k / 12));
    }
    const keys = bases(months, index, "2022-06").map((b) => b.key);
    expect(keys).not.toContain("covid");
  });

  it("omits a rolling basis whose lookback predates the sample", () => {
    const shortMonths = MONTHS.slice(0, 6);
    const shortIndex = INDEX.slice(0, 6);
    const keys = bases(shortMonths, shortIndex, "2022-06").map((b) => b.key);
    expect(keys).not.toContain("trailing3y");
    expect(keys).not.toContain("momentum");
  });

  it("anchors on the month given, not the end of the grid", () => {
    const out = bases(MONTHS, INDEX, "2025-01");
    expect(out.every((b) => b.endMonth <= "2025-01")).toBe(true);
  });

  it("emits nothing rather than a zero-length window at the sample start", () => {
    // anchor == months[0]: longrun's window would be 2022-01 -> 2022-01 (j <= i),
    // both rolling lookbacks go negative, both absolutes predate the grid.
    const out = bases(MONTHS, INDEX, "2022-01");
    expect(out).toEqual([]);
  });

  it("declares two absolute bases whose windows are fixed constants", () => {
    const abs = BASES.filter((b) => b.kind === "absolute");
    expect(abs.map((b) => b.key).sort()).toEqual(["covid", "gfc"]);
    expect(abs.every((b) => !!b.startMonth && !!b.endMonth)).toBe(true);
  });

  // Regression guard for the "must not move between publishes" claim in
  // dcContingency.ts's BASES doc comment. The test above only checks shape
  // (kind, truthy bounds); it would still pass if a window's literal month
  // were typo'd. Pin the four literal strings so a silent edit to either
  // absolute window fails here.
  it("pins the two absolute windows to their exact literal months", () => {
    const gfc = BASES.find((b) => b.key === "gfc")!;
    expect(gfc.startMonth).toBe("2008-12");
    expect(gfc.endMonth).toBe("2011-12");

    const covid = BASES.find((b) => b.key === "covid")!;
    expect(covid.startMonth).toBe("2021-04");
    expect(covid.endMonth).toBe("2023-12");
  });
});

describe("band", () => {
  it("returns the constant rate for a constant-growth grid", () => {
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.p10).toBeCloseTo(5.0, 6);
    expect(b.p50).toBeCloseTo(5.0, 6);
    expect(b.p90).toBeCloseTo(5.0, 6);
  });

  it("counts windows and independent draws", () => {
    // 49 months, anchor at index 48, h=12 -> windows i=0..36 inclusive = 37
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.windows).toBe(37);
    expect(b.independentDraws).toBeCloseTo(37 / 12, 6);
  });

  it("reports the sample span it actually used", () => {
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.sampleStartMonth).toBe("2022-01");
    expect(b.sampleEndMonth).toBe("2026-01");
  });

  it("interpolates percentiles linearly, matching the reference method", () => {
    // 17 CONTIGUOUS months (2020-01..2021-05) engineered to give exactly five
    // 12-month windows with rates 0,1,2,3,4% — so p50 = 2 and p10 = 0.4 by hand.
    // The grid MUST be contiguous monthly: band() steps by array position, which
    // is only equal to calendar months because dcindex emits one entry per month
    // with no gaps.
    const m = [
      "2020-01", "2020-02", "2020-03", "2020-04", "2020-05", "2020-06",
      "2020-07", "2020-08", "2020-09", "2020-10", "2020-11", "2020-12",
      "2021-01", "2021-02", "2021-03", "2021-04", "2021-05",
    ];
    const i = [
      100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100,
      100, 101, 102, 103, 104,
    ];
    const b = band(m, i, 12, "2021-05")!;
    expect(b.windows).toBe(5);
    expect(b.p10).toBeCloseTo(0.4, 6);
    expect(b.p50).toBeCloseTo(2.0, 6);
    expect(b.p90).toBeCloseTo(3.6, 6);
  });

  it("returns null when the horizon exceeds the sample (zero windows: h > anchorIdx)", () => {
    // h=60 > anchorIdx=48 over the full 49-month grid -> 0 windows possible at all.
    expect(band(MONTHS, INDEX, 60, "2026-01")).toBeNull();
  });

  it("returns null when the sample itself is too short (zero windows: anchorIdx < h)", () => {
    // Only 2 months of history and h=12: anchorIdx=1, so even i=0 fails i+h<=anchorIdx.
    // This is still the 0-window branch, distinct from the "horizon exceeds sample"
    // case above only in which side is undersized — neither exercises the guard at
    // exactly 1 window (see the next test, which is the edge the guard exists for).
    const m = ["2024-01", "2025-01"];
    const i = [100, 105];
    expect(band(m, i, 12, "2025-01")).toBeNull();
  });

  it("returns null when exactly ONE window exists, not just zero", () => {
    // windows = anchorIdx - h + 1, so windows=1 needs anchorIdx = h = 12: 13
    // contiguous months (indices 0..12), anchor on the last (index 12). This is
    // the boundary the `rates.length < 2` guard actually protects — with exactly
    // one window, percentile() would otherwise fall into its n===1 branch and
    // hand back a degenerate band where p10 === p50 === p90, not a real
    // distribution. The two tests above only ever hit the guard at 0 windows.
    const m = [
      "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
      "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
      "2025-01",
    ];
    const i = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 105];
    expect(band(m, i, 12, "2025-01")).toBeNull();
  });

  it("anchors on the month given, never past it", () => {
    const b = band(MONTHS, INDEX, 12, "2024-01")!;
    expect(b.sampleEndMonth).toBe("2024-01");
    expect(b.windows).toBe(13); // i = 0..12
  });

  it("reports spike overlap as a share of contributing windows", () => {
    // grid starts 2022-01, so every window touches the 2021-04..2022-12 spike
    // window until it clears 2022-12
    const b = band(MONTHS, INDEX, 12, "2026-01")!;
    expect(b.spikeOverlapPct).toBeGreaterThan(0);
    expect(b.spikeOverlapPct).toBeLessThanOrEqual(100);
  });

  it("exposes the horizon bounds the UI caps on", () => {
    expect(MIN_HORIZON_MONTHS).toBe(12);
    expect(MAX_HORIZON_MONTHS).toBe(48);
  });
});
