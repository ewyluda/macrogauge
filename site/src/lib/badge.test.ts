import { describe, expect, it } from "vitest";
import { badgeSvg } from "./badge";

describe("badgeSvg", () => {
  it("is a titled, labelled SVG with escaped text", () => {
    const s = badgeSvg("A&B", "3.15% <x>", "#38BDF8");
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).toContain('role="img"');
    expect(s).toContain("<title>A&amp;B: 3.15% &lt;x&gt;</title>");
    expect(s).not.toContain("<x>");
  });
  it("widens with the text", () => {
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(w(badgeSvg("a", "1", "#000"))).toBeLessThan(w(badgeSvg("a longer label", "1.23%", "#000")));
  });
});
