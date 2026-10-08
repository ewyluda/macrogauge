import type { PowerDealKind, PowerDealStatus, PowerDeals } from "./types";

/** /capacity's power-deals table: labels and the one-line takeaway. The
 *  pipeline orders the rows and computes the totals; this only words them. */

export const STATUS_LABEL: Record<PowerDealStatus, string> = {
  signed: "Signed", pending: "Pending approval", mou: "MOU", loi: "LOI", option: "Option",
};
export const KIND_LABEL: Record<PowerDealKind, string> = {
  ppa: "PPA", "utility supply": "Utility supply", "development / funding": "Development / funding", other: "Other",
};

/** half-up to 0.1 GW: (4.85).toFixed(1) is "4.8" in binary floating point */
const gw = (mw: number) => `${(Math.round(mw / 100) / 10).toFixed(1)} GW`;

/** "20.1 GW of signed power deals stand behind these companies' data centers, but only 9.6 GW of
 *  it is power purchase agreements; 5.2 GW more awaits regulator approval and 4.9 GW is MOUs,
 *  LOIs or options." */
export function powerDealsTakeaway(pd: PowerDeals | undefined): string | null {
  if (!pd || pd.totals.deals === 0) return null;
  const t = pd.totals;
  const tail = [
    t.pending_mw > 0 ? `${gw(t.pending_mw)} more awaits regulator approval` : null,
    t.preliminary_mw > 0 ? `${gw(t.preliminary_mw)} is MOUs, LOIs or options` : null,
  ].filter(Boolean);
  const ppa = t.signed_ppa_mw === t.signed_mw
    ? "all of it power purchase agreements"
    : `but only ${gw(t.signed_ppa_mw)} of it is power purchase agreements`;
  return `${gw(t.signed_mw)} of signed power deals stand behind these companies' data centers, ${ppa}` +
    (tail.length ? `; ${tail.join(" and ")}.` : ".");
}
