"""Offline PR #133 recovery probe. Pass an exact-head checkout/archive as argv[1]."""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from pipeline.publish import compute
from pipeline.store import vintage

conn = vintage.load(Path('/nonexistent/macrogauge-review-store'))
ds = 'deepseek_v41_flash_list'
dates = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']
for key, _ in compute.MODELS:
    for day in dates:
        if key == ds and day > '2026-10-17':
            continue
        price = 2.0 if key != ds and day >= '2026-10-18' else 1.0
        for side in ('in', 'out'):
            conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                         (f'or_{key}_{side}', day, price, day, 'OPENROUTER', 'API'))

def snapshot():
    payload = compute.build(conn, today='2026-10-20')
    index = payload['token_index']['history']
    return {'history': [dict(date=d, index=v, members=n) for d, v, n in
                        zip(index['dates'], index['index'], index['members'])],
            'display_row': next(m for m in payload['models'] if m['key'] == ds)}

before = snapshot()
for side in ('in', 'out'):
    conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                 (f'or_{ds}_{side}', '2026-10-20', 4.0, '2026-10-20', 'OPENROUTER', 'API'))
after = snapshot()
assert before['history'][2]['members'] == 6
assert after['history'][2]['members'] == 7
assert before['history'][2]['index'] != after['history'][2]['index']
assert after['display_row']['in_index'] is False
print(json.dumps({'scenario': 'Maker endpoint returns without a roster decision',
                  'before_return': before, 'after_return': after}, indent=2))
