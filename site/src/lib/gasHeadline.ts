// /gas headline, written from gas.json: whether gas explains what power did.

type HubRow = {
  label: string;
  power_yoy_pct: number | null;
  gas_yoy_pct: number | null;
  ratio: number | null;
  ratio_year_ago: number | null;
  vs_cc_fuel: number | null;
};
type Spot = { latest: number; avg30_yoy_pct: number | null } | null;

const move = (pct: number) => {
  const a = Math.abs(pct);
  if (a < 1) return "flat";
  return `${pct > 0 ? "up" : "down"} ${a >= 10 ? Math.round(a) : a.toFixed(1)}%`;
};

/**
 * title: "PJM Western Hub power is up 60% on the year while Henry Hub gas is
 * down 1.7%" — the hub whose power rose most, against Henry Hub over the SAME
 * 30 days, but only when gas explains less than half of the rise; then the
 * claim the page exists to make is the gap.
 * detail: the power-to-gas ratio now and a year ago, and how many times a
 * combined cycle's fuel bill the hub clears at.
 *
 * When gas does keep pace (or no hub rose 10%), the title is Henry Hub's own
 * level and annual move. Null without a Henry Hub reading.
 */
export function gasHeadline(spot: Spot, hubs: HubRow[] | null): { title: string; detail: string | null } | null {
  if (!spot) return null;
  const hub = (hubs ?? [])
    .filter((h) => h.power_yoy_pct != null && h.gas_yoy_pct != null)
    .sort((a, b) => b.power_yoy_pct! - a.power_yoy_pct!)[0];
  if (hub && hub.power_yoy_pct! >= 10 && hub.gas_yoy_pct! < hub.power_yoy_pct! / 2) {
    const title = `${hub.label} power is ${move(hub.power_yoy_pct!)} on the year while Henry Hub gas is ${move(hub.gas_yoy_pct!)}`;
    const detail = hub.ratio != null && hub.ratio_year_ago != null
      ? `Over the same 30 days a megawatt-hour there cost as much as ${hub.ratio.toFixed(1)} MMBtu of gas, against ${hub.ratio_year_ago.toFixed(1)} a year earlier` +
        (hub.vs_cc_fuel != null ? ` — ${hub.vs_cc_fuel.toFixed(1)}× a combined-cycle plant's fuel bill` : "") +
        ". The fuel did not move the price; the grid did."
      : null;
    return { title, detail };
  }
  const yoy = spot.avg30_yoy_pct;
  return {
    title: `Henry Hub gas is $${spot.latest.toFixed(2)}/MMBtu` + (yoy == null ? "" : `, its 30-day average ${move(yoy)} on the year`),
    detail: null,
  };
}
