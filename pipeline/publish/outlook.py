"""Writer for the versioned 12-month component outlook artifact."""
from pathlib import Path
from pipeline.publish.util import write_json


def write(result: dict, out_dir: Path, published_at: str) -> Path:
    return write_json({"published_at": published_at, **result}, out_dir,
                      "outlook.json")
