import { describe, expect, it } from "vitest";
import { buildUrl, codecs, readParam, withParam } from "./urlState";

describe("codecs", () => {
  it("int enforces integer and bounds", () => {
    const c = codecs.int(1, 10);
    expect(c.parse("5")).toBe(5);
    expect(c.parse("11")).toBeUndefined();
    expect(c.parse("5.5")).toBeUndefined();
    expect(c.parse("abc")).toBeUndefined();
    expect(c.format(7)).toBe("7");
  });
  it("float accepts decimals within bounds", () => {
    const c = codecs.float(0);
    expect(c.parse("4.25")).toBe(4.25);
    expect(c.parse("-1")).toBeUndefined();
    expect(c.parse("1e5")).toBeUndefined();
  });
  it("enumOf rejects unknown keys", () => {
    const c = codecs.enumOf(["24", "48", "all"] as const);
    expect(c.parse("48")).toBe("48");
    expect(c.parse("96")).toBeUndefined();
  });
  it("month and date validate shape", () => {
    expect(codecs.month().parse("2024-13")).toBeUndefined();
    expect(codecs.month().parse("2024-06")).toBe("2024-06");
    expect(codecs.date().parse("2024-06-31")).toBe("2024-06-31");
    expect(codecs.date().parse("2024-6-1")).toBeUndefined();
  });
  it("bool is 1/0", () => {
    expect(codecs.bool().parse("1")).toBe(true);
    expect(codecs.bool().parse("true")).toBeUndefined();
  });
  it("str caps length", () => {
    expect(codecs.str(3).parse("abcd")).toBeUndefined();
  });
});

describe("readParam / withParam / buildUrl", () => {
  it("reads with or without the leading ?", () => {
    expect(readParam("?a=3&b=x", "a", codecs.int())).toBe(3);
    expect(readParam("a=3", "a", codecs.int())).toBe(3);
    expect(readParam("a=3", "z", codecs.int())).toBeUndefined();
  });
  it("sets, replaces and deletes a single key", () => {
    expect(withParam("", "a", "1")).toBe("a=1");
    expect(withParam("a=1&b=2", "a", "9")).toBe("a=9&b=2");
    expect(withParam("a=1&b=2", "a", null)).toBe("b=2");
    expect(withParam("a=1", "a", null)).toBe("");
  });
  it("encodes values safely", () => {
    const s = withParam("", "q", "a b&c");
    expect(readParam(s, "q", codecs.str())).toBe("a b&c");
  });
  it("buildUrl omits an empty query", () => {
    expect(buildUrl("/x", "", "")).toBe("/x");
    expect(buildUrl("/x", "a=1", "#h")).toBe("/x?a=1#h");
  });
});
