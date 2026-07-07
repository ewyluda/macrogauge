# macrogauge

Daily-updated US inflation/macro analytics: an independent gauge that re-prices the CPI
basket from live market data, published as a static site over pre-baked JSON.

- `pipeline/` — Python collector → vintage store → engine → JSON publisher (+ QA self-test)
- `site/` — Next.js static export; reads `site/public/data/*.json`, computes nothing
- `store/obs/` — append-only vintage observation log (JSONL, monthly partitions)
- `schemas/` — JSON Schema per published file, validated in CI and before every publish
- Design spec: `docs/macrogauge-design.md`

Daily run: `.github/workflows/daily.yml` (8:40 AM ET weekdays) → commits data → Vercel deploys.

Local run: `FRED_API_KEY=... python -m pipeline.run_daily --store store --out site/public/data`
