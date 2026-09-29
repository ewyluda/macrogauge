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

type OfficialOnly = {
  as_of: string;
  last_official: string;
  monthly: { months: string[]; index: number[]; components: Record<string, number[]> };
};
// Absent from datacenter.json files published before 2026-09-28: a cast, so
// an older artifact still type-checks and the page simply offers one basis.
const official = (build as unknown as { official_only?: OfficialOnly }).official_only ?? null;

/** The same calculator inputs on the OFFICIAL-PRINTS-ONLY Build variant (P8):
 *  no proxy tail, so every month is complete (componentLastObs is the last
 *  official month for all) and a month once published moves only when BLS
 *  revises its own print — the basis a price-adjustment clause can cite.
 *  null when the artifact predates the variant. */
export const ESCALATION_DATA_OFFICIAL: EscalationData | null = official && {
  months: official.monthly.months,
  index: official.monthly.index,
  componentIndex: official.monthly.components,
  components: ESCALATION_DATA.components,
  componentLastObs: build.components.map(() => official.as_of),
  asOf: official.as_of,
  rebase: dc.rebase,
};
