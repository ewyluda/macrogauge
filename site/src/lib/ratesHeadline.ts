// /rates headline: the cost of capital, written from rates.json.

type Level = { value: number | null; chg_1y: number | null };

const bp = (pp: number) => `${pp > 0 ? "+" : pp < 0 ? "−" : ""}${Math.round(Math.abs(pp) * 100)}bp`;

/**
 * "The 10-year Treasury is 5.31% (+113bp on the year) and BBB corporate debt
 * yields 6.19% (+119bp); almost all of that is rates, not credit: the BBB
 * spread moved +8bp." A BBB yield is the Treasury curve plus the BBB spread,
 * so the spread's share of the yield's move says which one drove it. Clauses
 * drop when their inputs are missing; null without a 10-year reading.
 */
export function ratesHeadline(ten: { value: number | null; chg_1y_pp: number | null } | undefined,
                              bbbYield?: Level | null, bbbOas?: Level | null): string | null {
  if (!ten || ten.value == null) return null;
  let s = `The 10-year Treasury is ${ten.value.toFixed(2)}%`;
  if (ten.chg_1y_pp != null) s += ` (${bp(ten.chg_1y_pp)} on the year)`;
  if (bbbYield?.value == null) return s;
  s += ` and BBB corporate debt yields ${bbbYield.value.toFixed(2)}%`;
  if (bbbYield.chg_1y != null) s += ` (${bp(bbbYield.chg_1y)})`;
  const dy = bbbYield.chg_1y, ds = bbbOas?.chg_1y;
  if (dy != null && ds != null && Math.abs(dy) >= 0.1) {
    const share = ds / dy;
    const why = Math.abs(share) < 0.25 ? "almost all of that is rates, not credit"
      : share > 0.75 ? "most of that is credit, not rates" : "rates and credit both moved";
    s += `; ${why}: the BBB spread moved ${bp(ds)}`;
  }
  return s;
}
