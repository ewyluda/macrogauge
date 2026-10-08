import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HubMap } from "./HubMap";
import type { PowerHub } from "./PowerPanel";

const hub = (code: string, avg30: number): PowerHub =>
  ({ code, label: code, latest: avg30, asof: "2026-10-07", unit: "$/MWh", avg30, avg30_yoy_pct: 2 } as PowerHub);
const render = (hubs: PowerHub[]) => renderToStaticMarkup(createElement(HubMap, { hubs }));
/** every number the map draws: circle r/cx/cy, text and tspan x/y */
const geometry = (svg: string) => [...svg.matchAll(/\b(?:r|cx|cy|x|y)="([^"]*)"/g)].map((m) => m[1]);

describe("HubMap", () => {
  it("draws finite geometry for a mixed-sign set, the negative hub at the smallest dot with a signed price", () => {
    const svg = render([hub("ice_pjm_west", 20), hub("ercot_north_da", -5)]);
    const g = geometry(svg);
    expect(g.length).toBeGreaterThan(0);
    for (const v of g) expect(Number.isFinite(Number(v))).toBe(true);
    expect(svg).toMatch(/data-hub="ercot_north_da"><title>[^<]*−\$5\.00\/MWh/);
    expect(svg).toMatch(/data-hub="ercot_north_da">.*?<circle[^>]* r="6"/);
    expect(svg).toMatch(/data-hub="ice_pjm_west">.*?<circle[^>]* r="18"/);
  });
  it("draws finite geometry when every average is zero", () => {
    for (const v of geometry(render([hub("ice_pjm_west", 0), hub("ercot_north_da", 0)]))) {
      expect(Number.isFinite(Number(v))).toBe(true);
    }
  });
});
