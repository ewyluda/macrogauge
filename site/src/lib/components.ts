import basket from "../../../config/basket.json";

export type BasketComponent = {
  code: string;
  label: string;
  weight: number;
  pce_weight: number;
  official_series: string;
  live_blend?: Record<string, number>;
  live_variants?: string[];
  lead_days?: Record<string, number>;
};

export const COMPONENTS = basket.components as BasketComponent[];
export const COMPONENT_BY_CODE: Record<string, BasketComponent> = Object.fromEntries(COMPONENTS.map((c) => [c.code, c]));
/** BLS series id -> our component code (the homepage official table keys by BLS id). */
export const COMPONENT_BY_OFFICIAL: Record<string, string> = Object.fromEntries(COMPONENTS.map((c) => [c.official_series, c.code]));

export function componentHref(code: string): string {
  return `/components/${code}`;
}

/** First grid position where a live component's index departs from its
 *  official index — the splice point (blend.splice grafts live data onto
 *  official history, so before it the two are identical). null when they
 *  never depart (BLS carry-forward components). */
export function splicePosition(index: (number | null)[], bls: (number | null)[], tol = 0.005): number | null {
  for (let i = 0; i < index.length; i++) {
    const a = index[i], b = bls[i];
    if (a != null && b != null && Math.abs(a - b) > tol) return i;
  }
  return null;
}
