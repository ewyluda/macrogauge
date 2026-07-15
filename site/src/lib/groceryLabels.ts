// Display labels for BLS average-price series names — client "math" per house
// convention, so it lives in lib/ with vitest coverage next to it.

/** Trailing unit tokens BLS AP names carry ("bacon, sliced, lb" → unit "lb"). */
const UNIT_TOKENS = new Set([
  "lb",
  "dozen",
  "gallon",
  "half-gal",
  "12oz",
  "kWh",
  "therm",
]);
const UNIT_DISPLAY: Record<string, string> = { "12oz": "12 oz" };

/** "Avg price: bacon, sliced, lb" → { title: "Bacon, sliced", unit: "lb" }.
 *  Unknown trailing tokens stay in the title (never dropped silently). */
export function cleanName(raw: string): { title: string; unit: string | null } {
  const stripped = raw.replace(/^Avg price:\s*/i, "").trim();
  const parts = stripped.split(",").map((p) => p.trim());
  let unit: string | null = null;
  if (parts.length > 1 && UNIT_TOKENS.has(parts[parts.length - 1])) {
    unit = parts.pop() as string;
  }
  const name = parts.join(", ");
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return { title, unit: unit ? (UNIT_DISPLAY[unit] ?? unit) : null };
}

export function cardLabel(raw: string): string {
  const { title, unit } = cleanName(raw);
  return unit ? `${title} · per ${unit}` : title;
}
