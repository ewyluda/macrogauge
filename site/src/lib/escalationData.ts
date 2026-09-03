import dc from "../../public/data/datacenter.json";
import type { BridgeComponent } from "./dcEscalation";

export type EscalationData = {
  months: string[];
  index: number[];
  componentIndex: Record<string, number[]>;
  components: BridgeComponent[];
  /** Per-component last_obs, for deriving the last COMPLETE month — the
   *  published grid's trailing month is a partial stub. */
  componentLastObs: string[];
  asOf: string;
  rebase: string;
};

const build = dc.indexes.build;

/** The DC Build monthly grid sliced for the escalation calculator and the
 *  portfolio view — the monthly arrays (~30KB), never the 3,000-point daily
 *  series. One definition so both pages carry the identical basis. */
export const ESCALATION_DATA: EscalationData = {
  months: build.monthly.months,
  index: build.monthly.index,
  componentIndex: build.monthly.components,
  components: build.components.map((c) => ({ code: c.code, label: c.label, group: c.group, weight: c.weight })),
  componentLastObs: build.components.map((c) => c.last_obs),
  asOf: build.as_of,
  rebase: dc.rebase,
};
