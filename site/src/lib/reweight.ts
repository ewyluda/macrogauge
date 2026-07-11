/** My-inflation reweighter — pure math over replay.json's published data.
 *
 *  Personal YoY(t) = Σ wᵢ × component_own_yoyᵢ(t): the engine's own headline
 *  construction (Option A, weighted own-obs YoYs — the 1c sawtooth fix),
 *  applied to reweighted published weights. Never an index-ratio
 *  recomputation. Multipliers below are printed verbatim on the page. */

export type Answers = {
  housing: "rent" | "own_mortgage" | "own_paidoff";
  driving: "none" | "average" | "heavy";
  eating: "cook" | "average" | "out";
  healthcare: "light" | "average" | "heavy";
  tuition: "no" | "yes";
};

export const DEFAULT_ANSWERS: Answers = {
  housing: "rent",
  driving: "average",
  eating: "average",
  healthcare: "average",
  tuition: "no",
};

export type Comp = {
  code: string;
  label: string;
  weight: number;
  yoy: (number | null)[];
};

/** Scale published weights by the answers (NOT yet renormalized). */
export function applyAnswers(
  components: { code: string; weight: number }[],
  a: Answers
): Record<string, number> {
  const w: Record<string, number> = {};
  for (const c of components) w[c.code] = c.weight;
  const shelter = (w.shelter_owned ?? 0) + (w.shelter_rent ?? 0);
  if (a.housing === "rent") {
    w.shelter_rent = shelter;
    w.shelter_owned = 0;
  } else if (a.housing === "own_mortgage") {
    w.shelter_owned = shelter;
    w.shelter_rent = 0;
  } else {
    w.shelter_owned = shelter * 0.35; // taxes/insurance/upkeep remain
    w.shelter_rent = 0;
  }
  const m: Record<string, number> = {};
  if (a.driving === "none") {
    m.fuel = 0; m.used_vehicles = 0; m.new_vehicles = 0;
  } else if (a.driving === "heavy") {
    m.fuel = 2.5; m.used_vehicles = 1.5; m.new_vehicles = 1.5;
  }
  if (a.eating === "cook") { m.food_away = 0.4; m.food_home = 1.4; }
  else if (a.eating === "out") { m.food_away = 2; m.food_home = 0.7; }
  if (a.healthcare === "light") m.medical = 0.5;
  else if (a.healthcare === "heavy") m.medical = 2;
  m.education_comm = a.tuition === "yes" ? 2.5 : 0.6;
  for (const k of Object.keys(m)) if (w[k] !== undefined) w[k] *= m[k];
  return w;
}

export function renormalize(w: Record<string, number>): Record<string, number> {
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
}

/** Σ wᵢ × yoyᵢ at daily position i; null if any weighted component is null. */
export function weightedYoY(
  components: Comp[],
  weights: Record<string, number>,
  i: number
): number | null {
  let sum = 0;
  for (const c of components) {
    const v = c.yoy[i];
    if (v === null || v === undefined) return null;
    sum += (weights[c.code] ?? 0) * v;
  }
  return sum;
}

export type Contribution = {
  code: string;
  label: string;
  pp: number;
  weightPct: number;
  yoyPct: number;
};

/** Per-component contribution at position i, biggest drivers first.
 *  Sums exactly to weightedYoY (Option A property). */
export function contributions(
  components: Comp[],
  weights: Record<string, number>,
  i: number
): Contribution[] {
  return components
    .map((c) => ({
      code: c.code,
      label: c.label,
      pp: (weights[c.code] ?? 0) * (c.yoy[i] ?? 0),
      weightPct: (weights[c.code] ?? 0) * 100,
      yoyPct: c.yoy[i] ?? 0,
    }))
    .sort((a, b) => b.pp - a.pp);
}

/** Printed verbatim in the page footer — honesty about the approximation. */
export const MULTIPLIER_NOTES = [
  "Housing: renters get the full shelter weight as rent; owners w/ mortgage as owned; paid-off owners keep 35% of ownership costs (taxes, insurance, upkeep)",
  "Driving: don't drive → fuel ×0, vehicles ×0 · heavy commuter → fuel ×2.5, vehicles ×1.5",
  "Eating out: mostly cook → food-away ×0.4, food-at-home ×1.4 · eat out a lot → food-away ×2, food-at-home ×0.7",
  "Healthcare: light ×0.5 · heavy ×2 (medical care)",
  "Tuition: no → education & comm ×0.6 · yes → ×2.5",
];
