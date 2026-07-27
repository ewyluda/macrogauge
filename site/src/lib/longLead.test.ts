import { describe, expect, it } from "vitest";
import { BASIS_LABELS, KIND_LABELS, fmtFigure, noteSegments } from "./longLead";

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

describe("noteSegments", () => {
  it("splits prose around an inline SEC citation closed by a paren", () => {
    expect(
      noteSegments("its 10-Q (https://www.sec.gov/x/cmi-20260331.htm) or"),
    ).toEqual([
      { kind: "text", text: "its 10-Q (" },
      { kind: "link", url: "https://www.sec.gov/x/cmi-20260331.htm" },
      { kind: "text", text: ") or" },
    ]);
  });
  it("handles multiple URLs and a trailing URL", () => {
    const segs = noteSegments(
      "a https://one.test/f.htm, b https://two.test/g.htm",
    );
    expect(segs).toEqual([
      { kind: "text", text: "a " },
      { kind: "link", url: "https://one.test/f.htm" },
      { kind: "text", text: ", b " },
      { kind: "link", url: "https://two.test/g.htm" },
    ]);
  });
  it("returns plain prose untouched when there is no URL", () => {
    expect(noteSegments("no disclosure found")).toEqual([
      { kind: "text", text: "no disclosure found" },
    ]);
  });
  it("splits every URL out of the real Cummins-style note shape", () => {
    const note =
      "filed 2026-05-05, accession 0000026172-26-000016, " +
      "https://www.sec.gov/Archives/edgar/data/26172/000002617226000016/cmi-20260331.htm) " +
      "— both checked live 2026-07-26";
    const links = noteSegments(note).filter((s) => s.kind === "link");
    expect(links).toEqual([
      {
        kind: "link",
        url: "https://www.sec.gov/Archives/edgar/data/26172/000002617226000016/cmi-20260331.htm",
      },
    ]);
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
