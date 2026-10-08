import { describe, expect, it } from "vitest";
import { BASIS_LABELS, KIND_LABELS, backlogMove, fmtFigure, fmtLead, fmtWeightPct, leadTakeaway, noteSegments } from "./longLead";
import type { LeadTime } from "./types";

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
  it("formats signed percent growth with the U+2212 minus", () => {
    expect(fmtFigure(44, "pct_yoy")).toBe("+44% YoY");
    expect(fmtFigure(-5.5, "pct_yoy")).toBe("−5.5% YoY");
  });
  it("signs the rounded value — a near-zero negative never prints -0", () => {
    expect(fmtFigure(-0.04, "pct_yoy")).toBe("0% YoY");
    expect(fmtFigure(0, "pct_yoy")).toBe("0% YoY");
    expect(fmtFigure(0.04, "pct_yoy")).toBe("0% YoY");
  });
  it("formats ratios", () => {
    expect(fmtFigure(2.9, "ratio")).toBe("2.9x");
    expect(fmtFigure(1.2, "ratio")).toBe("1.2x");
    expect(fmtFigure(2.65, "ratio")).toBe("2.65x");   // as stated, not "2.6x" (2.65 is 2.6499... in binary)
    expect(fmtFigure(116, "gw")).toBe("116 GW");
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
  it("keeps sentence-final punctuation out of the URL", () => {
    expect(
      noteSegments("see https://www.sec.gov/x/cmi-20260331.htm. Checked live"),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", url: "https://www.sec.gov/x/cmi-20260331.htm" },
      { kind: "text", text: ". Checked live" },
    ]);
    expect(noteSegments("at https://one.test/f;").filter((s) => s.kind === "link"))
      .toEqual([{ kind: "link", url: "https://one.test/f" }]);
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

describe("fmtWeightPct", () => {
  it("renders artifact fractions as the percentages the other DC pages use", () => {
    expect(fmtWeightPct(0.5)).toBe("50%");
    expect(fmtWeightPct(0.14)).toBe("14%");
    expect(fmtWeightPct(0.085)).toBe("8.5%");
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

const lead = (item: string, weeks: number | null, through: string | null = null): LeadTime => ({
  item, weeks, through, basis: weeks != null ? "industry-survey" : "vendor-statement",
  period: "2025-06-30", asof: "2025-10-15", stale: false, quote: "q", src: { label: "s", url: "https://x.test" },
});

describe("lead times", () => {
  it("formats weeks and order horizons", () => {
    expect(fmtLead({ weeks: 128, through: null })).toBe("128 wk");
    expect(fmtLead({ weeks: null, through: "2028" })).toBe("orders into 2028");
  });

  it("writes the takeaway longest first, then vendor horizons", () => {
    expect(leadTakeaway([
      lead("Switchgear, US average", 44),
      lead("Power transformers, US average", 128),
      lead("Generator step-up transformers, US average", 143),
      lead("Caterpillar diesel standby gen sets", null, "2028"),
    ])).toBe("Generator step-up transformers average 143 weeks from order, power transformers 128, switchgear 44 " +
             "(industry survey, Q2 2025); " +
             "Caterpillar diesel standby gen sets: orders taken into 2028 (vendor statement, Q2 2025).");
    expect(leadTakeaway([])).toBeNull();
  });

  it("keeps every reading dated when packages come from different periods or bases", () => {
    const newer = { ...lead("Switchgear, US average", 44), period: "2026-06-30" };
    const report = { ...lead("Breakers, US average", 30), basis: "industry-report" as const };
    expect(leadTakeaway([lead("Power transformers, US average", 128), newer, report]))
      .toBe("Power transformers average 128 weeks from order (industry survey, Q2 2025); " +
            "switchgear 44 weeks (industry survey, Q2 2026); breakers 30 weeks (industry report, Q2 2025).");
  });

  it("dates a vendor horizon on its own", () => {
    expect(leadTakeaway([{ ...lead("Caterpillar diesel standby gen sets", null, "2028"), period: "2026-06-30" }]))
      .toBe("Caterpillar diesel standby gen sets: orders taken into 2028 (vendor statement, Q2 2026).");
  });
});

describe("backlogMove", () => {
  const b = { label: "x", months: [], ratio: [], latest: 7.19, latest_month: "2026-08", change_1y: -1.27 };
  it("names which leg moved the ratio", () => {
    expect(backlogMove({ ...b, unfilled_yoy_pct: 1.4, shipments_yoy_pct: 19.4 }))
      .toBe("7.2 months, down 1.3 in a year: shipments +19.4%, unfilled orders +1.4%");
  });
  it("degrades without a year-ago reading or legs", () => {
    expect(backlogMove({ ...b, change_1y: null })).toBe("7.2 months");
    expect(backlogMove({ ...b, change_1y: 0.02 })).toBe("7.2 months, flat on the year");
    // a leg omitted off a zero base (writer) leaves the other standing
    expect(backlogMove({ ...b, shipments_yoy_pct: 0 })).toBe("7.2 months, down 1.3 in a year: shipments 0.0%");
  });
});
