"""Offline review controls/probes, not application tests. Run from repo root.

    .venv/bin/python docs/reviews/2026-10-08-pr-71-93-probes.py

Reads Git objects and fixtures; writes no observations or published artifacts.
"""
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pipeline.publish.changes import _movers, _r
from pipeline.engine.nowcast.models import ensemble
from pipeline.connectors import cloudgpu


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True)


reading = _r('Example hub', 'AI Infra', 'level', '$/MWh', 'hub', '/power', 10, '2026-10-08')
negative = _movers({'hub': reading}, {'hub': {**reading, 'value': -10, 'as_of': '2026-10-07'}})[0]
assert negative['delta'] == -200

# A real supported producer mode behind the mislabeled CPI-preview legend.
weighted = ensemble({'macrogauge': 0.1, 'cleveland': 0.4}, {'macrogauge': 0.1, 'cleveland': 0.4})
assert weighted == {'value': 0.16, 'weights': {'macrogauge': 0.8, 'cleveland': 0.2}}

# PR 91 must preserve every preexisting JSONL row, byte-for-byte and in order.
head = '29f43b78f37932789c00adb649683fd2f41e7b94'
files = git('diff', '--name-only', head + '^', head, '--', 'store/obs/').splitlines()
counts = Counter()
for name in files:
    old_exists = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', head + '^:' + name],
                                capture_output=True).returncode == 0
    old = git('show', head + '^:' + name) if old_exists else ''
    new = git('show', head + ':' + name)
    assert new.startswith(old), name
    counts['partitions_checked'] += 1
    counts['old_rows_preserved'] += len(old.splitlines())
    counts['rows_appended'] += len(new.splitlines()) - len(old.splitlines())

# Recorded Nebius payload: effective-date selection and proper per-GPU units.
class Response:
    text = (ROOT / 'tests/fixtures/nebius_prices.html').read_text()
    def raise_for_status(self):
        pass


ids = ['NVIDIA HGX H100', 'NVIDIA HGX H200', 'NVIDIA HGX B200', 'NVIDIA HGX B300']
quotes = cloudgpu.fetch_nebius(ids, vintage_date='2026-10-08', http_get=lambda *a, **k: Response())
assert [q.value for q in quotes] == [4.5, 5.4, 8.5, 9.5]
print(json.dumps({
    'negative_price_mover': negative,
    'supported_weighted_ensemble': weighted,
    'pr91_append_only_control': dict(counts),
    'nebius_fixture_control': {q.series_code: q.value for q in quotes},
}, indent=2))
