"""Offline regeneration in a git-archive snapshot; no connector requests.

Usage from the checkout: .venv/bin/python <this-script> /absolute/snapshot
The destination must be an exported snapshot WITHOUT .git, not a checkout.
Recorded OpenRouter/Nebius fixtures model the next collection into in-memory
SQLite only; no stored observation partitions are written.
"""
import json
import os
import sys
from pathlib import Path
target = Path(sys.argv[1]).resolve()
if (target / '.git').exists() or not (target / 'pipeline').is_dir():
    raise SystemExit('Pass a git-archive snapshot, not a working checkout')
os.chdir(target)
sys.path.insert(0, str(target))
from pipeline import registry, dc_basket, dc_longlead, dc_power, dc_context
from pipeline.engine import dcindex
from pipeline.store import vintage
from pipeline.publish import datacenter, longlead, rates, compute, matrix, labor, revisions, commodities, composites, changes, validate, real_wages
from pipeline.connectors import cloudgpu, openrouter

out = Path('site/public/data')
previous = changes.read_previous(out)
conn = vintage.load(Path('store'))
_, series = registry.load_registry()
ids = {s.code: s.source_id for s in series}
limits = {s.code: s.max_staleness_days for s in series}
class FixtureResponse:
    def __init__(self, file): self.text = Path(file).read_text()
    def json(self): return json.loads(self.text)
    def raise_for_status(self): pass
for source, filename, fetch in [
    ('OPENROUTER', 'openrouter_models.json', openrouter.fetch),
    ('NEBIUS', 'nebius_prices.html', cloudgpu.fetch_nebius),
]:
    lookup = {s.source_id: s.code for s in series if s.source == source}
    response = FixtureResponse('tests/fixtures/' + filename)
    for o in fetch(list(lookup), vintage_date='2026-10-08', http_get=lambda *a, **k: response):
        conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                     (lookup[o.series_code], o.obs_date, o.value, o.vintage_date, o.source, o.route))
_, baskets = dc_basket.load_baskets(registry_codes=set(ids))
dc = dcindex.run(conn, today='2026-10-08', staleness=limits)
payload = datacenter.build(dc, dcindex.parity_from_store(conn), ids,
    dcindex.construction_from_store(conn, dc), dcindex.power_block(conn, dc, dc_power.load()),
    dcindex.context_block(conn, dc_context.load(), dc))
payload['clause_series'] = datacenter.clause_series(conn, baskets, ids)
stamp = '2026-10-08T19:00:00Z'
paths = [datacenter.write(payload, out, stamp)]
cfg = dc_longlead.load(build_codes={c.code for c in baskets['build']})
paths.append(longlead.write(longlead.build(cfg, baskets['build'], dc, today='2026-10-08', backlog=longlead.backlog_months(conn)), out, stamp))
for mod in (rates, compute, matrix, labor, revisions, commodities):
    built = mod.build(conn, today='2026-10-08') if mod == compute else mod.build(conn)
    paths.append(mod.write(built, out, stamp))
paths.extend(composites.write_all(conn, out, stamp))
g = json.loads((out / 'gauge_daily.json').read_text())['variants']['gauge']
paths.append(real_wages.write(real_wages.build(conn, {'variants': {'gauge': {
    'as_of': g['dates'][-1], 'yoy': dict(zip(g['dates'], g['yoy_pct']))}}}), out, stamp))
paths.append(changes.write(changes.build(previous, out, []), out, stamp))
for p in paths:
    validate.validate_file(p, Path('schemas') / (p.stem + '.schema.json'))
    print('validated', p)
