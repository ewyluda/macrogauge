import { HUB_POSITIONS, US_BORDERS, US_NATION, US_VIEWBOX } from "@/lib/usOutline";
import type { PowerHub } from "./PowerPanel";

/** Where each label sits relative to its dot: the north-east hubs crowd
 *  each other, so their labels fan out instead of overlapping. */
const SIDE: Record<string, "above" | "below" | "right" | "left"> = {
  ice_pjm_west: "below", nyiso_west_da: "left", ice_mass_hub: "above", miso_indiana_da: "above",
  spp_north_da: "above", ercot_north_da: "below", caiso_sp15_da: "below", ice_palo_verde: "right",
  ice_midc: "right",
};

const tone = (yoy: number | null | undefined) =>
  yoy == null ? "var(--muted)" : yoy > 5 ? "var(--accent-red)" : yoy < -5 ? "var(--accent-emerald)" : "var(--accent-amber)";
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`;

/** /power's hubs on a US outline: dot size = 30-day average $/MWh, colour =
 *  its move on the year (red up, green down, amber within ±5%). A hub is a
 *  price basket over many grid nodes, so each dot marks a representative
 *  location for its region, never a single plant. Hubs without a published
 *  average or a position are left off; the table below lists every hub. */
export function HubMap({ hubs }: { hubs: PowerHub[] }) {
  const shown = hubs.filter((h) => h.avg30 != null && HUB_POSITIONS[h.code]);
  if (!shown.length) return null;
  const max = Math.max(...shown.map((h) => h.avg30!));
  const summary = shown
    .map((h) => `${h.label} $${h.avg30!.toFixed(2)}/MWh${h.avg30_yoy_pct != null ? `, ${signed(h.avg30_yoy_pct)} on the year` : ""}`)
    .join("; ");
  return (
    <figure className="hub-map" data-testid="hub-map">
      <svg viewBox={US_VIEWBOX} role="img" aria-label={`Wholesale power hubs on a US map, 30-day averages: ${summary}.`}>
        <path d={US_NATION} className="hub-map-nation" />
        <path d={US_BORDERS} className="hub-map-borders" />
        {shown.map((h) => {
          const p = HUB_POSITIONS[h.code];
          const r = 6 + 12 * Math.sqrt(h.avg30! / max);
          const side = SIDE[h.code] ?? "right";
          const [dx, dy, anchor]: [number, number, "middle" | "start" | "end"] =
            side === "above" ? [0, -r - 22, "middle"] : side === "below" ? [0, r + 20, "middle"]
            : side === "left" ? [-r - 6, -4, "end"] : [r + 6, -4, "start"];
          return (
            <g key={h.code} data-hub={h.code}>
              <title>{`${h.label} (${p.place}): $${h.avg30!.toFixed(2)}/MWh 30-day average${h.avg30_yoy_pct != null ? `, ${signed(h.avg30_yoy_pct)} on the year` : ""}`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={tone(h.avg30_yoy_pct)} className="hub-map-dot" />
              <text x={p.x + dx} y={p.y + dy} textAnchor={anchor} className="hub-map-label">
                <tspan className="hub-map-name">{h.label.replace(/ Hub$/, "")}</tspan>
                <tspan x={p.x + dx} dy="17">{`$${h.avg30!.toFixed(0)}`}{h.avg30_yoy_pct != null && <tspan className="hub-map-move" fill={tone(h.avg30_yoy_pct)}>{` ${signed(h.avg30_yoy_pct)}`}</tspan>}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Dot size is the 30-day average price; colour is its change on the year (red up, green down, amber within
        ±5%). Each dot marks a representative location for its hub, which averages many grid nodes. Outline: US Census
        cartographic boundaries via us-atlas.
      </figcaption>
    </figure>
  );
}
