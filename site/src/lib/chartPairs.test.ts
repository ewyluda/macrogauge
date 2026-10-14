import { describe, expect, it } from "vitest";
import { pairWithBreaks } from "./chartPairs";

describe("pairWithBreaks", () => {
  it("keeps interior nulls as breaks and trims the ends", () => {
    expect(pairWithBreaks(["a", "b", "c", "d", "e"], [null, 1, null, 2, null]))
      .toEqual([["b", 1], ["c", null], ["d", 2]]);
  });

  it("is empty for an all-null series", () => {
    expect(pairWithBreaks(["a", "b"], [null, undefined as unknown as null])).toEqual([]);
  });
});
