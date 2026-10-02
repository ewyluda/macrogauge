/** Portfolio / program view math (register P6): a reader's projects, each
 *  escalated by the DC Build index from its base month to the last complete
 *  month `anchor` (P1, dcEscalation.escalate with endMonth = anchor) and
 *  carried FROM `anchor` to its delivery month at a READER-SELECTED realized
 *  basis (P3a, dcContingency.bases) with the horizon-matched band. The two
 *  legs meet at `anchor`, so measured + carried months equal base -> delivery
 *  exactly: the grid's trailing stub month (where the PPIs still hold the
 *  prior print) is neither measured nor skipped. Aggregates are sums of
 *  dollars and dollar-weighted rates. No forecast: the carry is a historical
 *  regime the reader chose.
 *
 *  Two carried figures sit side by side. "At delivery (full carry)" carries
 *  the whole to-date cost from the anchor to delivery. "S-curve (to spend
 *  midpoint)" (sCurve.ts) carries only the share of spend NOT yet incurred
 *  by the anchor, and only to that remaining spend's midpoint, at the same
 *  basis; its band is horizon-matched to anchor → midpoint. A project with
 *  no construction start month assumes delivery − 24 months. */
import { bridgeWindow, escalate, monthDiff, type BridgeComponent, type EscalationResult } from "./dcEscalation";
import { band, bases, MAX_HORIZON_MONTHS, MIN_HORIZON_MONTHS, type Band, type Basis } from "./dcContingency";
import { checkMonth } from "./monthInput";
import { sCurveCost, spendSchedule, type SpendSchedule } from "./sCurve";

export type Project = {
  id: string;
  name: string;
  market: string;
  mw: number;
  baseCost: number;
  baseMonth: string;
  deliveryMonth: string;
  basis: string;
  /** construction start; optional — saved lists from before it existed omit
   *  it, and an absent start means delivery − 24 months ("assumed"). */
  startMonth?: string;
};

export const DEFAULT_BASIS = "trailing3y";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function newId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Validate a loose object into a Project; null if any field is unusable. */
export function coerceProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const p: Project = {
    id: typeof o.id === "string" && o.id ? o.id.slice(0, 12) : newId(),
    name: typeof o.name === "string" ? o.name.slice(0, 60) : "",
    market: typeof o.market === "string" ? o.market.slice(0, 30) : "",
    mw: num(o.mw), baseCost: num(o.baseCost),
    baseMonth: typeof o.baseMonth === "string" ? o.baseMonth : "",
    deliveryMonth: typeof o.deliveryMonth === "string" ? o.deliveryMonth : "",
    basis: typeof o.basis === "string" && o.basis ? o.basis.slice(0, 30) : DEFAULT_BASIS,
  };
  if (!Number.isFinite(p.mw) || p.mw < 0) p.mw = 0;
  if (!Number.isFinite(p.baseCost) || p.baseCost < 0) p.baseCost = 0;
  if (p.baseMonth && !MONTH.test(p.baseMonth)) return null;
  if (p.deliveryMonth && !MONTH.test(p.deliveryMonth)) return null;
  if (typeof o.startMonth === "string" && o.startMonth) {
    if (!MONTH.test(o.startMonth)) return null;
    p.startMonth = o.startMonth;
  }
  return p;
}

/** URL / clipboard form: compact JSON array. */
export function encodeProjects(ps: Project[]): string {
  return JSON.stringify(ps.map(({ id, name, market, mw, baseCost, baseMonth, deliveryMonth, basis, startMonth }) =>
    (startMonth ? { id, name, market, mw, baseCost, baseMonth, deliveryMonth, basis, startMonth }
      : { id, name, market, mw, baseCost, baseMonth, deliveryMonth, basis })));
}
export function decodeProjects(s: string): Project[] | null {
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return null;
    const out = arr.map(coerceProject).filter((p): p is Project => p !== null);
    return out.length === arr.length ? out : null;
  } catch {
    return null;
  }
}

export type ProjectEval = {
  project: Project;
  errors: string[];
  result: EscalationResult | null;
  chosen: Basis | null;
  horizon: number;
  band: Band | null;
  /** cost escalated to the last complete month */
  toDate: number | null;
  /** cost at delivery = toDate × carry factor (or toDate when delivery ≤ anchor) */
  atDelivery: number | null;
  /** p10 / p90 of the horizon band applied to toDate, when a band exists */
  atDeliveryP10: number | null;
  atDeliveryP90: number | null;
  perMwAtDelivery: number | null;
  /** spend schedule seen from the anchor (null without a delivery month) */
  schedule: SpendSchedule | null;
  /** S-curve figure: incurred share at toDate, remaining share carried to its spend midpoint */
  sCurve: number | null;
  /** band horizon-matched to anchor → spend midpoint (null under MIN_HORIZON_MONTHS) */
  sCurveBand: Band | null;
  sCurveP10: number | null;
  sCurveP90: number | null;
};

export function evaluateProject(
  p: Project, months: string[], index: number[], anchor: string, basisRows: Basis[],
): ProjectEval {
  const errors: string[] = [];
  const first = months[0];
  const bm = checkMonth(p.baseMonth, first, anchor, "base month");
  if (!bm.ok) errors.push(bm.message);
  if (!(p.baseCost > 0)) errors.push("Base estimate must be greater than $0.");
  let deliveryValid = false;
  let horizon = 0;
  if (p.deliveryMonth) {
    if (!MONTH.test(p.deliveryMonth)) errors.push(`"${p.deliveryMonth}" is not a month — use YYYY-MM.`);
    else {
      horizon = monthDiff(anchor, p.deliveryMonth);
      if (horizon > MAX_HORIZON_MONTHS) errors.push(`Delivery ${p.deliveryMonth} is beyond the ${MAX_HORIZON_MONTHS}-month carry cap (latest ${monthsAhead(anchor, MAX_HORIZON_MONTHS)}).`);
      else deliveryValid = horizon > 0;
    }
  }
  let schedule: SpendSchedule | null = null;
  if (p.startMonth && !MONTH.test(p.startMonth)) errors.push(`"${p.startMonth}" is not a month — use YYYY-MM.`);
  else if (p.deliveryMonth && MONTH.test(p.deliveryMonth)) {
    schedule = spendSchedule(p.startMonth, p.deliveryMonth, anchor);
    if (!schedule) errors.push(`Construction start ${p.startMonth} must be before delivery ${p.deliveryMonth}.`);
  }
  const chosen = basisRows.find((b) => b.key === p.basis) ?? basisRows[0] ?? null;
  const empty = { band: null, toDate: null, atDelivery: null, atDeliveryP10: null, atDeliveryP90: null, perMwAtDelivery: null, sCurve: null, sCurveBand: null, sCurveP10: null, sCurveP90: null };
  if (errors.length || !bm.ok) {
    return { project: p, errors, result: null, chosen, horizon, schedule, ...empty };
  }
  const result = escalate(months, index, bm.month, p.baseCost,
    deliveryValid && chosen ? { deliveryMonth: p.deliveryMonth, annualizedPct: chosen.annualizedPct } : null,
    anchor);
  if (!result) {
    return { project: p, errors: ["Base month precedes the index."], result: null, chosen, horizon, schedule, ...empty };
  }
  const bandRow = deliveryValid && horizon >= MIN_HORIZON_MONTHS ? band(months, index, Math.min(horizon, MAX_HORIZON_MONTHS), anchor) : null;
  const toDate = result.escalatedCost;
  const atDelivery = result.totalCost;
  const yrs = horizon / 12;
  const atP10 = bandRow ? toDate * Math.pow(1 + bandRow.p10 / 100, yrs) : null;
  const atP90 = bandRow ? toDate * Math.pow(1 + bandRow.p90 / 100, yrs) : null;
  // S-curve leg: same basis, same anchor; only the unspent share, only to its
  // spend midpoint. With no forward carry (no/past delivery) it equals toDate.
  const carrySchedule = deliveryValid && chosen && schedule ? schedule : null;
  const sCurve = carrySchedule ? sCurveCost(toDate, carrySchedule, chosen!.annualizedPct) : toDate;
  const hMid = carrySchedule?.midpointHorizon ?? 0;
  const sBand = carrySchedule && hMid >= MIN_HORIZON_MONTHS ? band(months, index, Math.min(hMid, MAX_HORIZON_MONTHS), anchor) : null;
  return {
    project: p, errors, result, chosen, horizon, band: bandRow, toDate, atDelivery,
    atDeliveryP10: atP10, atDeliveryP90: atP90,
    perMwAtDelivery: p.mw > 0 ? atDelivery / p.mw : null,
    schedule, sCurve, sCurveBand: sBand,
    sCurveP10: sBand && carrySchedule ? sCurveCost(toDate, carrySchedule, sBand.p10) : null,
    sCurveP90: sBand && carrySchedule ? sCurveCost(toDate, carrySchedule, sBand.p90) : null,
  };
}

function monthsAhead(month: string, n: number): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
}

export type PortfolioTotals = {
  projects: number;
  valid: number;
  mw: number;
  capital: number;
  toDate: number;
  atDelivery: number;
  exposureToDate: number;
  exposureCarry: number;
  /** dollar-weighted escalation to date, % of base */
  weightedToDatePct: number | null;
  /** dollar-weighted total escalation to delivery, % of base */
  weightedAtDeliveryPct: number | null;
  atDeliveryP10: number | null;
  atDeliveryP90: number | null;
  /** how many valid projects contributed a band */
  banded: number;
  /** S-curve (to spend midpoint) portfolio total and its carry over toDate */
  sCurve: number;
  exposureCarrySCurve: number;
  weightedSCurvePct: number | null;
  sCurveP10: number | null;
  sCurveP90: number | null;
  sCurveBanded: number;
};

export function totals(evals: ProjectEval[]): PortfolioTotals {
  const ok = evals.filter((e) => e.result && e.toDate != null && e.atDelivery != null);
  const capital = ok.reduce((s, e) => s + e.project.baseCost, 0);
  const toDate = ok.reduce((s, e) => s + (e.toDate ?? 0), 0);
  const atDelivery = ok.reduce((s, e) => s + (e.atDelivery ?? 0), 0);
  const banded = ok.filter((e) => e.atDeliveryP10 != null);
  const p10 = banded.length ? ok.reduce((s, e) => s + (e.atDeliveryP10 ?? e.atDelivery ?? 0), 0) : null;
  const p90 = banded.length ? ok.reduce((s, e) => s + (e.atDeliveryP90 ?? e.atDelivery ?? 0), 0) : null;
  const sCurve = ok.reduce((s, e) => s + (e.sCurve ?? e.toDate ?? 0), 0);
  const sBanded = ok.filter((e) => e.sCurveP10 != null);
  const sP10 = sBanded.length ? ok.reduce((s, e) => s + (e.sCurveP10 ?? e.sCurve ?? 0), 0) : null;
  const sP90 = sBanded.length ? ok.reduce((s, e) => s + (e.sCurveP90 ?? e.sCurve ?? 0), 0) : null;
  return {
    projects: evals.length, valid: ok.length,
    mw: ok.reduce((s, e) => s + e.project.mw, 0),
    capital, toDate, atDelivery,
    exposureToDate: toDate - capital, exposureCarry: atDelivery - toDate,
    weightedToDatePct: capital > 0 ? (toDate / capital - 1) * 100 : null,
    weightedAtDeliveryPct: capital > 0 ? (atDelivery / capital - 1) * 100 : null,
    atDeliveryP10: p10, atDeliveryP90: p90, banded: banded.length,
    sCurve, exposureCarrySCurve: sCurve - toDate,
    weightedSCurvePct: capital > 0 ? (sCurve / capital - 1) * 100 : null,
    sCurveP10: sP10, sCurveP90: sP90, sCurveBanded: sBanded.length,
  };
}

/** Component drivers across the portfolio: each project's bridge (base
 *  month → the measured leg's end, result.endMonth = the last complete
 *  month) in dollars, summed by component — so drivers reconcile with toDate. */
export function driversAcross(
  evals: ProjectEval[], months: string[], componentIndex: Record<string, number[]>, components: BridgeComponent[],
): { code: string; label: string; group: string; contributionCost: number }[] {
  const acc = new Map<string, { code: string; label: string; group: string; contributionCost: number }>();
  for (const e of evals) {
    if (!e.result) continue;
    for (const r of bridgeWindow(months, componentIndex, components, e.result.baseMonth, e.result.endMonth, e.project.baseCost)) {
      const cur = acc.get(r.code) ?? { code: r.code, label: r.label, group: r.group, contributionCost: 0 };
      cur.contributionCost += r.contributionCost;
      acc.set(r.code, cur);
    }
  }
  return [...acc.values()].sort((a, b) => Math.abs(b.contributionCost) - Math.abs(a.contributionCost));
}

export function evaluateAll(ps: Project[], months: string[], index: number[], anchor: string): { evals: ProjectEval[]; basisRows: Basis[] } {
  const basisRows = bases(months, index, anchor);
  return { evals: ps.map((p) => evaluateProject(p, months, index, anchor, basisRows)), basisRows };
}
