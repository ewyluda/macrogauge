// /rates headline: the financing benchmarks, written from rates.json.

type Level = { value: number | null; chg_1y: number | null };
/** BBB yield and OAS annual changes on ONE shared window (publish/rates._bbb_move). */
export type BbbMove = { as_of: string | null; base_date: string | null; yield_chg_1y: number; oas_chg_1y: number };

const bp = (pp: number) => `${pp > 0 ? "+" : pp < 0 ? "−" : ""}${Math.round(Math.abs(pp) * 100)}bp`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/**
 * "The 10-year Treasury is 5.31% (+113bp on the year) and the BBB corporate
 * bond index yields 6.19% (+119bp); over the year to Oct 6 the BBB spread
 * moved +8bp of the index yield's +119bp, so most of the move tracks Treasury
 * rates, not credit."
 *
 * The rates-vs-credit clause reads ONLY the shared-window block (both changes
 * end on one date, from one baseline) and names that end date; it is an
 * indication, not an exact decomposition (OAS is measured against a spot
 * Treasury curve, not the 10-year). Clauses drop when inputs are missing;
 * null without a 10-year reading.
 */
export function ratesHeadline(ten: { value: number | null; chg_1y_pp: number | null } | undefined,
                              bbbYield?: Level | null, move?: BbbMove | null): string | null {
  if (!ten || ten.value == null) return null;
  let s = `The 10-year Treasury is ${ten.value.toFixed(2)}%`;
  if (ten.chg_1y_pp != null) s += ` (${bp(ten.chg_1y_pp)} on the year)`;
  if (bbbYield?.value == null) return s;
  s += ` and the BBB corporate bond index yields ${bbbYield.value.toFixed(2)}%`;
  if (bbbYield.chg_1y != null) s += ` (${bp(bbbYield.chg_1y)})`;
  if (move && move.as_of && Math.abs(move.yield_chg_1y) >= 0.1) {
    const share = move.oas_chg_1y / move.yield_chg_1y;
    const why = Math.abs(share) < 0.25 ? "most of the move tracks Treasury rates, not credit"
      : share > 0.75 ? "most of the move is the credit spread, not rates" : "rates and the credit spread both moved";
    s += `; over the year to ${day(move.as_of)} the BBB spread moved ${bp(move.oas_chg_1y)} of the index yield's ` +
      `${bp(move.yield_chg_1y)}, so ${why}`;
  }
  return s;
}
