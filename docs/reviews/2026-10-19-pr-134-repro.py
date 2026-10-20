"""Offline PR #134 probes; pass an exact-head checkout/archive as argv[1]."""
import json
from pathlib import Path
import subprocess
import sys
import jsonschema

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from pipeline import gas_config, power_deals
from pipeline.publish import gas
from pipeline.store import vintage

fuel, deals = gas_config.load(), power_deals.load()
block = gas.ai_gas_deals(deals, fuel, {'power_burn': {'ttm_bcf_d': 36.3}})
google = next(d for d in block['deals'] if d['t'] == 'GOOGL')
wulf = next(d for d in block['deals'] if d['t'] == 'WULF')
mw_basis = {
    'published_signed_mw': block['signed_mw'],
    'google_published': google,
    'google_source_gas_nameplate_mw': 564,
    'google_gas_nameplate_bcf_d': round(gas._bcf_d_full_output(564, fuel, fuel.heat_rates[0]), 3),
    'wulf_published': wulf,
    'wulf_source_gas_nameplate_mw': 760,
    'wulf_gas_nameplate_bcf_d': round(gas._bcf_d_full_output(760, fuel, fuel.heat_rates[0]), 3),
    'source_notes': [dict(t=d.t, mw=d.mw_total, basis=d.mw_basis, note=d.note)
                     for d in deals.deals if d.technology == 'gas'],
}
assert google['mw'] == 590 and google['bcf_d_full_output'] == 0.103
assert wulf['mw'] == 1000 and wulf['bcf_d_full_output'] == 0.175

# Isolated counterexample: local gas alone raises power by 50%, HH unchanged.
# Compile the actual helper, then execute it without copying its implementation.
node = r'''
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.argv[1];
const ts = require(path.join(root, 'site/node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'site/src/lib/gasHeadline.ts'), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const box = {exports: {}}; vm.runInNewContext(js, box);
const input = {spot: {latest: 3, avg30_yoy_pct: 0}, hubs: [{label: 'Synthetic hub',
 power_yoy_pct: 50, gas_yoy_pct: 0, ratio: 30, ratio_year_ago: 20, vs_cc_fuel: 30/7.548}]};
console.log(JSON.stringify({input, output: box.exports.gasHeadline(input.spot, input.hubs)}));
'''
headline = json.loads(subprocess.check_output(['node', '-e', node, str(root)], text=True))
headline['counterexample'] = {'local_gas_before': 8, 'local_gas_after': 12,
                             'fixed_heat_rate': 7.5, 'power_before': 60, 'power_after': 90,
                             'grid_markup_before_and_after': 0, 'henry_hub_before_and_after': 3}
assert 'The fuel did not move the price; the grid did.' in headline['output']['detail']

# Observation-gap probes: both inputs are legal sparse store series.
conn = vintage.load(Path('/nonexistent/macrogauge-review-store'))
months = [f'2026-{m:02d}-01' for m in (10, 12)] + [f'2027-{m:02d}-01' for m in range(1, 11)]
for month in months:
    conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                 (gas.STEO, month, 30.0 if month == '2027-10-01' else 3.0,
                  '2026-10-07', 'STEO', 'API'))
forward_gap = gas.outlook(conn, '2026-10-19')
assert forward_gap['next12_to'] == '2027-10-01' and forward_gap['next12_avg'] == 5.25
for day, value in [('2026-09-25', 3400), ('2026-10-09', 3567)]:
    conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                 (gas.STORAGE, day, value, '2026-10-15', 'EIA', 'API'))
storage_gap = gas.storage(conn)
assert storage_gap['chg_week_bcf'] == 167
jsonschema.validate({'published_at': '2026-10-19T12:56:43Z',
                     **gas.build(conn, '2026-10-19')},
                    json.loads((root / 'schemas/gas.schema.json').read_text()))
# Restore missing observations to demonstrate that only the gaps cause the errors.
for code, day, value in [(gas.STEO, '2026-11-01', 3.0), (gas.STORAGE, '2026-10-02', 3500)]:
    conn.execute('INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)',
                 (code, day, value, '2026-10-15', 'EIA', 'API'))
forward_complete, storage_complete = gas.outlook(conn, '2026-10-19'), gas.storage(conn)
assert forward_complete['next12_to'] == '2027-09-01' and forward_complete['next12_avg'] == 3.0
assert storage_complete['chg_week_bcf'] == 67
print(json.dumps({'mw_basis': mw_basis, 'headline_causality': headline,
                  'forecast_missing_month': forward_gap,
                  'storage_missing_week': storage_gap,
                  'controls': {'sparse_full_payload_validates': True,
                               'complete_forecast': forward_complete,
                               'complete_storage': storage_complete}}, indent=2))
