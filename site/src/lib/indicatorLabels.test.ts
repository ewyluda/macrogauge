import { describe, expect, it } from "vitest";
import stress from "../../public/data/stress.json";
import { fmtIndicatorValue, indicatorLabel } from "./indicatorLabels";

describe("fmtIndicatorValue", () => {
  it("formats by the input's unit, never a raw float", () => {
    expect(fmtIndicatorValue("TDSP", 11.111439)).toBe("11.11%");
    expect(fmtIndicatorValue("CCSA", 1716000)).toBe("1.72M");
    expect(fmtIndicatorValue("ICSA", 231000)).toBe("231K");
    expect(fmtIndicatorValue("UNLISTED", 1234.5678)).toBe("1,234.57");
  });
  it("covers every published stress input with a label and a short value", () => {
    for (const row of stress.indicators as { code: string; value: number }[]) {
      expect(indicatorLabel(row.code)).not.toBe(row.code);
      expect(fmtIndicatorValue(row.code, row.value)).not.toMatch(/\d\.\d{3,}/);
    }
  });
});
