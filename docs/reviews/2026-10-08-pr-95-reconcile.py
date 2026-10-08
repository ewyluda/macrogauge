"""Independent offline PR 95 probes; outputs JSON for the companion .cjs.

Run: .venv/bin/python docs/reviews/2026-10-08-pr-95-reconcile.py [snapshot-root]
No observations or published artifacts are written.
"""
import json
import sqlite3
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
from pipeline.publish import rates, changes
from pipeline.engine.nowcast.models import ensemble
from jsonschema import Draft202012Validator

conn = sqlite3.connect(':memory:')
conn.execute('CREATE TABLE observations (series_code TEXT, obs_date TEXT, value REAL, vintage_date TEXT, source TEXT, route TEXT)')
for code, pts in {
    'BAMLC0A4CBBBEY': [('2025-10-03', 5.22), ('2025-10-06', 5.0), ('2026-10-06', 5.10)],
    'BAMLC0A4CBBB': [('2025-10-03', 1.02), ('2026-10-06', 0.90)],
}.items():
    for day, value in pts:
        conn.execute('INSERT INTO observations VALUES (?,?,?,?,?,?)', (code, day, value, day, 'FRED', 'FIXTURE'))
yield_level = rates._level(conn, 'BAMLC0A4CBBBEY', pct=False)
shared = rates._bbb_move(conn)
assert yield_level['as_of'] == shared['as_of'] == '2026-10-06'
assert yield_level['chg_1y'] == 0.1 and shared['yield_chg_1y'] == -0.12
assert shared['base_date'] == '2025-10-03'

schema = json.loads((root / 'schemas/changes.schema.json').read_text())
row_schema = {**schema['properties']['movers']['items'], '$defs': schema['$defs']}
price_cases = []
for previous, current in [(-10, 10), (-10, -5), (-5, -10), (0, 3), (0, -3), (80, 83.2), (5, -5), (0, 0)]:
    r = changes._r('Fixture hub', 'AI Infra', 'level', '$/MWh', 'hub', '/power', current, '2026-10-08')
    row = changes._movers({'hub': r}, {'hub': {**r, 'value': previous}})[0]
    Draft202012Validator(row_schema).validate(row)
    if previous <= 0:
        assert row['delta_unit'] == '$/MWh' and row['delta'] == current - previous
    else:
        assert row['delta_unit'] == '%' and row['delta'] == round((current/previous-1)*100, 2)
    assert (row['delta'] > 0) == (current > previous)
    assert (row['delta'] < 0) == (current < previous)
    price_cases.append(row)

# The producer really uses an earned-weight headline and equal-weight core.
calls = {'macrogauge': 0.1, 'cleveland': 0.4}
weighted = ensemble(calls, {'macrogauge': 0.1, 'cleveland': 0.4})
core = ensemble(calls, {'macrogauge': None, 'cleveland': None})
assert weighted['value'] == 0.16 and core['value'] == 0.25
print(json.dumps({'reviewed_head': 'c655fc772af78dd2c4b09f756e1c78f4519d1c10',
    'F3_shared_end_different_baselines': {'yield': yield_level, 'move': shared},
    'F6_price_cases': price_cases,
    'F12_real_producer_modes': {'headline': weighted, 'core': core}}, indent=2))
