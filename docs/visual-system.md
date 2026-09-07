# MacroGauge visual system

The September 2026 refresh uses the approved homepage and Data Centers design
across all routes: off-white canvas, white analytical surfaces, charcoal text,
and restrained blue emphasis. Color in charts and warnings still encodes data.

## Shared surfaces

- `globals.css` owns color tokens; `chartTheme.ts` mirrors them for canvas charts
  and PNG exports. A unit test checks that the two palettes agree and that text
  and semantic accents meet a 4.5:1 contrast ratio against white surfaces.
- `research.css` owns the shared header, page title rhythm, sections, KPI cards,
  tables, controls, and responsive layouts. `PageShell` applies it to every route.
- Use `Section` for section headings and its `actions` slot for chart utilities.
- `Citation` and `DownloadData` use compact disclosures by default. Pass
  `compact={false}` when embedding export choices inside another disclosure.
- `ToolDisclosure` supports native keyboard activation, Escape and outside-click
  dismissal. Only one toolbar disclosure is open at a time.
- Calculator controls use the `calculator-controls` grid; use
  `calculator-controls-simple` for a two-field calculator. Use `kpi-row` for
  result groups. Wide data tables scroll inside their containing surface.

## Visual conventions

Use sentence-case headings, a clear primary reading, quiet supporting metrics,
and readable dates. Reserve borders for distinct surfaces; group related content
with spacing and dividers. Use neutral navigation labels and consistent controls.
Keep warnings, sources, units, as-of dates and calculation caveats accessible.

The homepage initially shows the gauge and official CPI; “All comparisons”
reveals the other series. Data Centers leads with its readings and trend chart,
followed by the toolkit and detailed component tables. Heatmap ramps and
categorical contribution colors retain their existing data encodings.

## Verification

Run `npm run build`, `npm run lint`, `npm test`, and `npm run e2e` in `site/`.
Browser coverage includes every navigation route at phone width, client
navigation, calculator state, copy/download actions, menu dismissal, and expanded
capacity details. Visually check representative analytical and interactive pages
when changing shared layout rules.
