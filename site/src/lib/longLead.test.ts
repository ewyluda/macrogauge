import { describe, expect, it } from "vitest";
import { BASIS_LABELS, KIND_LABELS, fmtFigure } from "./longLead";

describe("fmtFigure", () => {
  it("formats dollar billions", () => {
    expect(fmtFigure(176, "usd_b")).toBe("$176B");
    expect(fmtFigure(15.05, "usd_b")).toBe("$15.1B");
  });
  it("formats euro billions", () => {
    expect(fmtFigure(25.362, "eur_b")).toBe("€25.4B");
  });
  it("formats yen trillions", () => {
    expect(fmtFigure(9.2, "jpy_tn")).toBe("¥9.2tn");
  });
  it("formats signed percent growth", () => {
    expect(fmtFigure(44, "pct_yoy")).toBe("+44% YoY");
    expect(fmtFigure(-5.5, "pct_yoy")).toBe("-5.5% YoY");
  });
  it("formats ratios", () => {
    expect(fmtFigure(2.9, "ratio")).toBe("2.9x");
    expect(fmtFigure(1.2, "ratio")).toBe("1.2x");
  });
});

describe("labels", () => {
  it("covers every basis and kind", () => {
    expect(Object.keys(BASIS_LABELS).sort()).toEqual(
      ["mdna-backlog", "order-backlog", "rpo"]);
    expect(Object.keys(KIND_LABELS).sort()).toEqual(
      ["backlog", "backlog_growth", "book_to_bill", "orders"]);
  });
});
