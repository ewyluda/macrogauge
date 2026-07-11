# Repository Guidelines

## Project Structure & Module Organization

MacroGauge combines a Python 3.12 data pipeline with a Next.js static site. `pipeline/` contains source connectors, the append-only vintage store, calculation engines, and JSON publishers. Runtime configuration lives in `config/`; every published artifact has a matching contract in `schemas/`. Python tests are in `tests/`, with recorded network responses under `tests/fixtures/`.

The frontend lives in `site/`: routes are under `site/src/app/`, reusable UI in `site/src/components/`, and client-side utilities in `site/src/lib/`. Vitest files use `*.test.ts`; Playwright smoke tests live in `site/e2e/`. Generated data is served from `site/public/data/`. Design notes and implementation plans belong in `docs/`.

## Build, Test, and Development Commands

Run pipeline commands from the repository root:

```bash
pip install -e ".[dev]"   # install Python package and pytest
pytest -q                  # run the complete Python suite
pytest tests/test_gauge.py -q  # run one test module
FRED_API_KEY=... python -m pipeline.run_daily --store store --out site/public/data
```

Run frontend commands from `site/`:

```bash
npm ci          # install locked dependencies
npm run dev     # start the local Next.js server
npm run build   # create the static export
npm test        # run Vitest unit tests
npm run e2e     # run Playwright against the export
```

## Coding Style & Naming Conventions

Follow existing formatting: four-space indentation and `snake_case` for Python; two-space indentation, `camelCase` functions, and `PascalCase` React components for TypeScript. Keep engine stages pure and place one external data source per connector module. Published JSON keys and Python modules use `snake_case`. Do not introduce formatting-only churn; no repository-wide formatter is configured.

## Testing Guidelines

Use pytest files named `test_*.py`. Inject HTTP functions and use fixtures—tests must never call live services. Test pure engine stages directly. Frontend logic requires colocated `*.test.ts` coverage; route-level behavior belongs in `site/e2e/`. Before opening a PR, run `pytest -q`, `npm run build`, `npm test`, and `npm run e2e`.

## Commit & Pull Request Guidelines

Use the established Conventional Commit form, such as `feat(site): add comparison view`, `fix(pipeline): preserve stale source`, or `docs: clarify setup`. Keep commits focused. PRs should explain behavior and data-contract changes, link relevant issues or plans, report verification commands, and include screenshots for visible UI changes. Never rewrite committed `store/obs/*.jsonl` partitions; resolve conflicts by preserving both sets of rows.
