"""Writer for the versioned 12-month component outlook artifact."""
import json
from pathlib import Path


def write(result: dict, out_dir: Path, published_at: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "outlook.json"
    path.write_text(json.dumps({"published_at": published_at, **result}, indent=2) + "\n")
    return path
