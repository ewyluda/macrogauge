/** Terms the site uses with a precise meaning, each in one or two
 *  sentences. Rendered as a list on /methodology and inline via <Term>. */
export const GLOSSARY = {
  laspeyres: {
    term: "Laspeyres index",
    def: "A fixed-weight index: each component's price change is weighted by its share of the base-period basket, so the weights never chase what people substituted into. CPI-U is Laspeyres-type, and so is the gauge — its 14 weights sum to one and are published.",
  },
  rebase: {
    term: "Rebase",
    def: "Scaling every series so its mean over the base month (January 2018) equals 100, which makes dollars per gallon, cents per kilowatt-hour and dollar rents unitless and comparable.",
  },
  splice: {
    term: "Splice",
    def: "Grafting scaled live market data onto the official BLS history of a component at the first day the two can be joined. Before the splice point ours and BLS coincide by construction; after it, ours moves daily.",
  },
  vintage: {
    term: "Vintage",
    def: "The date on which a value was learned, as distinct from the period it describes. The store keeps every vintage and never overwrites, so any past state of knowledge can be reconstructed exactly.",
  },
  gate: {
    term: "Gate hold",
    def: "The one-day quality gate: a just-arrived observation that moves a component more than 5% is held for one day. If it persists on the next run it passes through; a transient error never enters the published index.",
  },
  carry: {
    term: "Carry-forward",
    def: "Filling each day between observations with the last observed value, so every component has a value on every grid day. Year-over-year is never read off a carried value against a different-month base — it is computed at the component's own observation dates.",
  },
  supercore: {
    term: "Supercore",
    def: "Services excluding shelter — the sticky, wage-driven cut the Fed watches. On the gauge it is a renormalized weighted average of four service components; it is graded against core CPI.",
  },
  leadlag: {
    term: "Lead-lag",
    def: "The correlation between one series today and another k months ahead, for each k. A peak at k = 0 is contemporaneous co-movement, not a lead; the site reports the peak, the split-half stability and the verdict together.",
  },
  basis: {
    term: "Contingency basis",
    def: "A realized annualized rate of the DC Build index over a stated window — long-run, trailing 3-year, current momentum — that a reader chooses to carry forward from the last complete month. Graded on every vintage; never a forecast.",
  },
  anchor: {
    term: "Anchor",
    def: "A month at which the grading harness stood, computed each basis from only the releases known then, and later compared the carried rate with what the index actually did over 12, 24, 36 or 48 months.",
  },
  firstprint: {
    term: "First print",
    def: "An official value as it was first released, before any revision. The scoreboard grades every call against first prints; the revisions page shows how far those first prints later moved.",
  },
  nowcast: {
    term: "Nowcast",
    def: "An estimate of an official print before it is released, built from the components' live data and the trend of the rest. It is graded in public the morning after every release and its realized error band is shown, not a confidence interval.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
