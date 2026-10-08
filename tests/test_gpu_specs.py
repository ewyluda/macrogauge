import copy
import json
import re
from pathlib import Path

import pytest

from pipeline import gpu_specs
from pipeline.publish import compute

ROOT = Path(__file__).parent.parent
REAL = json.loads(gpu_specs.DEFAULT_PATH.read_text())


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s)


def _load(tmp_path, fn):
    raw = copy.deepcopy(REAL)
    fn(raw)
    p = tmp_path / "specs.json"
    p.write_text(json.dumps(raw))
    return gpu_specs.load(p)


def _row(raw, gpu):
    return next(g for g in raw["gpus"] if g["gpu"] == gpu)


# --- the real config ---------------------------------------------------------

def test_real_table_derives_dense_bf16_per_gpu():
    t = gpu_specs.load()
    assert {g: s.dense_bf16_tflops for g, s in t.gpus.items()} == {
        "A100": 312.0, "H100": 989.5, "H200": 989.5, "B200": 2250.0, "GB200": 2500.0, "B300": 2250.0}
    assert list(t.gpus) == ["A100", "H100", "H200", "B200", "GB200", "B300"]   # generation order


def test_every_cloud_gpu_has_a_spec():
    assert {g for _, _, g, _, _ in compute.CLOUD_GPUS} <= set(gpu_specs.load().gpus)


def test_every_quote_is_verbatim_in_its_committed_evidence():
    # The receipt check: the table row, its sparsity footnote and its GPU
    # count all sit in NVIDIA's spec-table text layer, committed as evidence.
    for g, s in gpu_specs.load().gpus.items():
        text = _norm((ROOT / s.evidence).read_text())
        for q in (s.quote, s.sparsity_quote, s.gpus_quote):
            if q is not None:
                assert _norm(q) in text, f"{g}: {q!r} not in {s.evidence}"


# --- rejections --------------------------------------------------------------

def test_a_figure_missing_from_its_quote_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="does not appear in its quote"):
        _load(tmp_path, lambda r: _row(r, "H100").update(figure=1989))


def test_a_non_bf16_row_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="not a BF16 row"):
        _load(tmp_path, lambda r: _row(r, "H100").update(quote="FP8 Tensor Core * 3,958 teraFLOPS", figure=3958))


def test_a_system_figure_needs_its_gpu_count_quoted(tmp_path):
    with pytest.raises(ValueError, match="needs a gpus_quote naming 72"):
        _load(tmp_path, lambda r: _row(r, "GB200").update(gpus_quote="36 Grace CPU"))


def test_the_sparsity_footnote_is_required(tmp_path):
    with pytest.raises(ValueError, match="sparsity footnote"):
        _load(tmp_path, lambda r: _row(r, "H200").update(sparsity_quote=""))


def test_an_unknown_unit_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="unit"):
        _load(tmp_path, lambda r: _row(r, "A100").update(unit="GFLOPS"))
