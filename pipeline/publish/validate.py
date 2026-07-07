import json
from pathlib import Path

import jsonschema


def validate_file(json_path: Path, schema_path: Path) -> None:
    """Raise jsonschema.ValidationError if json_path doesn't match schema_path."""
    jsonschema.validate(json.loads(json_path.read_text()),
                        json.loads(schema_path.read_text()))
