import type { IssuerDeal } from "./types";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** "On their latest notes the hyperscalers priced a median 88bp over
 *  Treasuries; CoreWeave 539bp." — comparable (straight senior) notes only:
 *  a cohort with several is its median, a cohort with one is named, never
 *  called a median. Null unless both cohorts have one. */
export function issuerTakeaway(deals: IssuerDeal[]): string | null {
  const of = (c: IssuerDeal["cohort"]) => deals.filter((d) => d.cohort === c && d.comparable && d.spread_bp != null);
  const say = (ds: IssuerDeal[], group: string, verb: string) =>
    ds.length === 1 ? `${ds[0].name}${verb} ${Math.round(ds[0].spread_bp!)}bp`
      : `${group}${verb} a median ${Math.round(median(ds.map((d) => d.spread_bp!)))}bp`;
  const [h, n] = [of("hyperscaler"), of("neocloud")];
  if (!h.length || !n.length) return null;
  return `On their latest notes ${say(h, "the hyperscalers", " priced")} over Treasuries; ${say(n, "the neoclouds", "")}.`;
}
