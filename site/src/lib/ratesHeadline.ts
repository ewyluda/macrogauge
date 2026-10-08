// /rates headline: the financing benchmarks, written from rates.json.

type Level = { value: number | null; chg_1y: number | null; as_of?: string | null };
/** BBB yield and OAS annual changes on ONE shared window (publish/rates._bbb_move). */
export type BbbMove = { as_of: string | null; base_date: string | null; yield_chg_1y: number; oas_chg_1y: number };

const bp = (pp: number) => `${pp > 0 ? "+" : pp < 0 ? "−" : ""}${Math.round(Math.abs(pp) * 100)}bp`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

const moved = (pp: number) => (Math.round(pp * 100) === 0 ? "flat" : `${pp > 0 ? "up" : "down"} ${Math.round(Math.abs(pp) * 100)}bp`);

/**
 * title: "BBB corporate debt yields 6.19%, up 119bp on the year, mostly from
 * Treasury rates" — one claim, the borrowing cost a build is priced near.
 * detail: "The 10-year Treasury is 5.31% (+113bp on the year); over the year to
 * Oct 6 the BBB spread moved +8bp of the index yield's +119bp."
 *
 * The attribution reads ONLY the shared-window block (both changes end on one
 * date, from one baseline) and the detail names that end date; it is an
 * indication, not an exact decomposition (OAS is measured against a spot
 * Treasury curve, not the 10-year). The title carries it only when that window
 * ends on the yield's own date: a lagging spread's window explains a different
 * year than the title's change, so it stays in the dated detail. Clauses drop
 * when inputs are missing; without a BBB reading the 10-year leads; null
 * without a 10-year reading.
 */
export function ratesHeadline(ten: { value: number | null; chg_1y_pp: number | null } | undefined,
                              bbbYield?: Level | null, move?: BbbMove | null): { title: string; detail: string | null } | null {
  if (!ten || ten.value == null) return null;
  const tenChg = ten.chg_1y_pp == null ? "" : ` (${bp(ten.chg_1y_pp)} on the year)`;
  if (bbbYield?.value == null) {
    return { title: `The 10-year Treasury yields ${ten.value.toFixed(2)}%` +
      (ten.chg_1y_pp == null ? "" : `, ${moved(ten.chg_1y_pp)} on the year`), detail: null };
  }
  let title = `BBB corporate debt yields ${bbbYield.value.toFixed(2)}%`;
  if (bbbYield.chg_1y != null) title += `, ${moved(bbbYield.chg_1y)} on the year`;
  let detail = `The 10-year Treasury is ${ten.value.toFixed(2)}%${tenChg}`;
  if (move && move.as_of && Math.abs(move.yield_chg_1y) >= 0.1) {
    const share = move.oas_chg_1y / move.yield_chg_1y;
    if (bbbYield.chg_1y != null && bbbYield.as_of === move.as_of) title += Math.abs(share) < 0.25 ? ", mostly from Treasury rates"
      : share > 0.75 ? ", mostly from the credit spread" : ", from both rates and the credit spread";
    detail += `; over the year to ${day(move.as_of)} the BBB spread moved ${bp(move.oas_chg_1y)} of the index yield's ` +
      `${bp(move.yield_chg_1y)}`;
  }
  return { title, detail: `${detail}.` };
}
