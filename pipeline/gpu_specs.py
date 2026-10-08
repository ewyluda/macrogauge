"""GPU capability spec table — dense BF16 TFLOPS per GPU, for /compute's
$ per PFLOP-hour by generation (Session 5, 2026-10-08).

ONE basis for every row: dense BF16 Tensor Core throughput of the SXM part,
from NVIDIA's own spec tables. Each row's `quote` is the table row, verbatim
from the committed text layer in docs/research/evidence/ (checked in
tests/test_gpu_specs.py); its figure must appear in that quote. NVIDIA prints
most rows with sparsity, so a `sparse` row needs its footnote quoted too and
publishes half the figure. A per-system figure (HGX: 8 GPUs; NVL72: 72) needs
the quote that names the GPU count, and is divided by it.

A broken config raises at load; the compute phase then publishes without the
by-generation block."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent.parent / "config" / "gpu_specs.json"
UNITS = {"TFLOPS": 1.0, "PFLOPS": 1000.0}


@dataclass(frozen=True)
class GpuSpec:
    gpu: str
    dense_bf16_tflops: float
    url: str
    evidence: str
    quote: str
    sparsity_quote: str
    gpus_quote: str | None


def _figure_in(n: float, quote: str) -> bool:
    joined = re.sub(r"(?<=\d),(?=\d)", "", quote)
    return re.search(rf"(?<![\d.]){re.escape(f'{n:g}')}(?![\d.])", joined) is not None


def _spec(raw: dict) -> GpuSpec:
    gpu = raw["gpu"]
    quote, figure, unit, per = raw["quote"], raw["figure"], raw["unit"], raw["per_gpus"]
    if unit not in UNITS:
        raise ValueError(f"gpu_specs {gpu}: unit {unit!r} not in {sorted(UNITS)}")
    if not _figure_in(figure, quote):
        raise ValueError(f"gpu_specs {gpu}: figure {figure} does not appear in its quote {quote!r}")
    if "BF16" not in quote and "BFLOAT16" not in quote:
        raise ValueError(f"gpu_specs {gpu}: quote is not a BF16 row")
    if not isinstance(per, int) or per < 1:
        raise ValueError(f"gpu_specs {gpu}: per_gpus must be a positive integer")
    gpus_quote = raw.get("gpus_quote")
    if per > 1 and (not gpus_quote or not _figure_in(per, gpus_quote)):
        raise ValueError(f"gpu_specs {gpu}: a {per}-GPU figure needs a gpus_quote naming {per}")
    if not re.search(r"spars(e|ity)", raw.get("sparsity_quote") or "", re.I):
        raise ValueError(f"gpu_specs {gpu}: needs the table's sparsity footnote quoted")
    dense = figure * UNITS[unit] / per / (2 if raw["sparse"] else 1)
    return GpuSpec(gpu=gpu, dense_bf16_tflops=round(dense, 1), url=raw["url"],
                   evidence=raw["evidence"], quote=quote,
                   sparsity_quote=raw["sparsity_quote"], gpus_quote=gpus_quote)


@dataclass(frozen=True)
class SpecTable:
    as_of_curated: str
    basis: str
    basis_note: str
    publisher: str
    gpus: dict[str, GpuSpec]   # in config order: the generation order


def load(path: Path | None = None) -> SpecTable:
    raw = json.loads((path or DEFAULT_PATH).read_text())
    specs = [_spec(g) for g in raw["gpus"]]
    names = [s.gpu for s in specs]
    if len(names) != len(set(names)):
        raise ValueError(f"gpu_specs: duplicate GPU in {names}")
    return SpecTable(as_of_curated=raw["as_of_curated"], basis=raw["basis"],
                     basis_note=raw["basis_note"], publisher=raw["publisher"],
                     gpus={s.gpu: s for s in specs})
