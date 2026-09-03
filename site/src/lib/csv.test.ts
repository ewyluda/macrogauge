import { describe, expect, it } from "vitest";
import { columnsToRows, csvCell, csvColumns, flattenRow, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values bare", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell(1.5)).toBe("1.5");
    expect(csvCell(true)).toBe("true");
  });
  it("empties null, undefined and non-finite numbers", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(NaN)).toBe("");
  });
  it("quotes and escapes when needed", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
  });
});

describe("toCsv", () => {
  it("unions keys in first-seen order and writes CRLF", () => {
    const out = toCsv([{ a: 1, b: "x" }, { b: "y", c: null }]);
    expect(out).toBe("a,b,c\r\n1,x,\r\n,y,\r\n");
  });
  it("honours explicit columns and comment lines", () => {
    const out = toCsv([{ a: 1, b: 2 }], { columns: ["b"], comment: "cite me" });
    expect(out).toBe("# cite me\r\nb\r\n2\r\n");
  });
  it("flattens newlines inside comments", () => {
    expect(toCsv([], { comment: "a\nb" })).toBe("# a b\r\n\r\n");
  });
  it("csvColumns is stable", () => {
    expect(csvColumns([{ z: 1 }, { a: 1, z: 2 }])).toEqual(["z", "a"]);
  });
});

describe("columnsToRows", () => {
  it("zips parallel arrays and pads short series", () => {
    const rows = columnsToRows(
      { name: "date", values: ["d1", "d2"] },
      [{ name: "g", values: [1, 2] }, { name: "t", values: [9] }],
    );
    expect(rows).toEqual([{ date: "d1", g: 1, t: 9 }, { date: "d2", g: 2, t: null }]);
  });
});

describe("flattenRow", () => {
  it("dots nested keys and drops arrays", () => {
    expect(flattenRow({ a: 1, b: { c: null, d: { e: "x" } }, t: [1, 2] })).toEqual({
      a: 1, "b.c": null, "b.d.e": "x",
    });
  });
});
