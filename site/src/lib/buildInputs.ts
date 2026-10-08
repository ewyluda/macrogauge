// /commodities ("Build Inputs") headline, written from the published grid.
import type { CommodityRow } from "./types";

/** Reader names for the build-input rows (labels carry contract detail). */
export const SHORT: Record<string, string> = {
  fmp_copper: "copper", fmp_alum: "aluminum", ppi_steel: "steel",
  dramex_ddr5_16g: "DDR5", dramex_ddr4_16g: "DDR4", dramex_nand_mlc64: "NAND",
  vast_h100_sxm: "the H100-hour", caiso_sp15_da: "CAISO power", ice_pjm_west: "PJM power",
};

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.round(Math.abs(v))}%`;

/** "PJM power +83%, copper +30% and steel +23% on the year" — the biggest
 *  true-YoY movers among the build inputs (never a dated stand-in, which
 *  spans a different window). Null when none has a YoY. */
export function buildInputsHeadline(rows: CommodityRow[], n = 3): string | null {
  const movers = rows.filter((r) => r.yoy_pct != null && SHORT[r.code])
    .sort((a, b) => Math.abs(b.yoy_pct!) - Math.abs(a.yoy_pct!)).slice(0, n)
    .map((r) => `${SHORT[r.code]} ${pct(r.yoy_pct!)}`);
  if (!movers.length) return null;
  const list = movers.length > 1 ? `${movers.slice(0, -1).join(", ")} and ${movers.at(-1)}` : movers[0];
  return `${list[0].toUpperCase()}${list.slice(1)} on the year`;
}
