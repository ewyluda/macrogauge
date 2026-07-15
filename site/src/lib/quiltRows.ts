import type { QuiltRow } from "./quiltPng";

export type QuiltComponent = {
  code: string;
  label: string;
  weight: number;
  ours_yoy_pct: (number | null)[];
  official_yoy_pct: (number | null)[];
};

// Keep this presentation order aligned with Nowflation's public quilt. The
// codes are MacroGauge's stable artifact keys; labels intentionally match the
// public comparison surface rather than the longer internal component names.
export const COMPONENT_ROWS: [string, string][] = [
  ["shelter_rent", "Shelter: Rent"],
  ["shelter_owned", "Shelter: Owned"],
  ["fuel", "Motor Fuel"],
  ["used_vehicles", "Used Vehicles"],
  ["new_vehicles", "New Vehicles"],
  ["food_home", "Food at Home"],
  ["food_away", "Food Away"],
  ["electricity", "Electricity"],
  ["nat_gas", "Utility Gas"],
  ["medical", "Medical Care"],
  ["apparel", "Apparel"],
  ["recreation", "Recreation"],
  ["education_comm", "Education & Comm"],
  ["other", "Everything Else"],
];

/** Which published value array fills the cells: our gauge or the official
 *  BLS print. Both arrays are month-aligned in the artifact; official months
 *  where the print lags are null (rendered as the empty cell style). */
export type QuiltMode = "ours" | "bls";

/** Pinned rows first, in presentation order with display labels; anything the
 *  pipeline publishes beyond the pinned list appends by weight under the
 *  artifact's own label — a new or renamed basket component must never
 *  silently vanish from the quilt. Pure: same components + mode in, same
 *  rows out. */
export function buildComponentRows(
  components: QuiltComponent[],
  mode: QuiltMode = "ours",
): QuiltRow[] {
  const values = (c: QuiltComponent) =>
    mode === "bls" ? c.official_yoy_pct : c.ours_yoy_pct;
  const pinned: QuiltRow[] = [];
  const seen = new Set<string>();
  for (const [code, label] of COMPONENT_ROWS) {
    const component = components.find((candidate) => candidate.code === code);
    if (component) {
      pinned.push({ label, values: values(component) });
      seen.add(code);
    }
  }
  const extras = components
    .filter((candidate) => !seen.has(candidate.code))
    .sort((a, b) => b.weight - a.weight)
    .map((candidate) => ({ label: candidate.label, values: values(candidate) }));
  return [...pinned, ...extras];
}
