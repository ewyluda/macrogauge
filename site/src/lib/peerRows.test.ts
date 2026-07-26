import { describe, expect, it } from "vitest";
import { BASIS_LABEL, label, peerMatrix, type Peer, type PeerRow } from "./peerRows";

const peer = (key: string, rows: PeerRow[], over: Partial<Peer> = {}): Peer => ({
  key,
  firm: "Firm",
  short: key,
  publication: "Pub",
  source: "Source",
  asof: "2026",
  scope: "dc",
  basis: "cost_model",
  period_basis: "calendar_year",
  geography: "global",
  derived: false,
  caveat: "c",
  quote: "q",
  rows,
  ...over,
});

const row = (year: number, escalation_pct: number, build_yoy_pct: number | null = null):
  PeerRow => ({ year, escalation_pct, build_yoy_pct });

describe("peerMatrix", () => {
  it("returns empty axes for no peers", () => {
    expect(peerMatrix([])).toEqual({ years: [], cells: [], ours: [] });
  });

  it("builds the sorted union of years across peers", () => {
    const m = peerMatrix([
      peer("a", [row(2024, 9), row(2022, 15)]),
      peer("b", [row(2018, 5.6), row(2025, 4.1)]),
    ]);
    expect(m.years).toEqual([2018, 2022, 2024, 2025]);
  });

  it("leaves a null where a peer does not cover a year — never back-filled", () => {
    const m = peerMatrix([
      peer("tnt", [row(2024, 9), row(2025, 5.5)]),
      peer("turner", [row(2023, 6), row(2024, 3.9), row(2025, 4.1)]),
    ]);
    expect(m.years).toEqual([2023, 2024, 2025]);
    expect(m.cells).toEqual([
      [null, 6],
      [9, 3.9],
      [5.5, 4.1],
    ]);
  });

  it("keeps cell order aligned to peer order, not to which peer has data", () => {
    const m = peerMatrix([
      peer("first", [row(2025, 1)]),
      peer("second", [row(2024, 2)]),
    ]);
    expect(m.cells).toEqual([
      [null, 2],
      [1, null],
    ]);
  });

  it("takes our build YoY from whichever peer covers that year", () => {
    const m = peerMatrix([
      peer("short", [row(2025, 5.5, 7.71)]),
      peer("long", [row(2018, 5.6, 5.38), row(2025, 4.1, 7.71)]),
    ]);
    expect(m.years).toEqual([2018, 2025]);
    // 2018: the first peer has no row at all, so the value comes from the second
    expect(m.ours).toEqual([5.38, 7.71]);
  });

  it("reports null for a year our build index cannot reach", () => {
    const m = peerMatrix([peer("a", [row(2013, 4.1, null), row(2025, 4.1, 7.71)])]);
    expect(m.ours).toEqual([null, 7.71]);
  });

  it("does not collapse duplicate years across peers into separate rows", () => {
    const m = peerMatrix([
      peer("a", [row(2025, 5.5)]),
      peer("b", [row(2025, 4.1)]),
      peer("c", [row(2025, 3.09)]),
    ]);
    expect(m.years).toEqual([2025]);
    expect(m.cells).toEqual([[5.5, 4.1, 3.09]]);
  });

  it("sorts years numerically, not lexically", () => {
    const m = peerMatrix([peer("a", [row(2009, 1), row(2100, 2), row(2020, 3)])]);
    expect(m.years).toEqual([2009, 2020, 2100]);
  });
});

describe("label", () => {
  it("maps a known code", () => {
    expect(label(BASIS_LABEL, "bid_price")).toBe("bid price");
  });

  it("falls through to the raw code so a new enum never renders blank", () => {
    expect(label(BASIS_LABEL, "index_level")).toBe("index_level");
  });
});
