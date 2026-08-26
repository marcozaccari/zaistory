#!/usr/bin/env python3
"""Valida un file story.ir.json (o una singola Scene) contro engine-ir.schema.json.

Uso:
    python3 validate.py story.ir.json              # valida un'intera Story
    python3 validate.py --scene scena.json          # valida una singola Scene

Exit code 0 se valido, 1 altrimenti (con gli errori stampati su stderr,
un errore per riga - pensati per essere rimandati a Claude come feedback
di correzione, stesso pattern del loop di retry del compilatore CLI).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("jsonschema non installato: pip install jsonschema --break-system-packages", file=sys.stderr)
    sys.exit(2)

SCHEMA_PATH = Path(__file__).parent.parent / "references" / "engine-ir.schema.json"


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def scene_schema() -> dict:
    full = load_schema()
    return {
        "$schema": full["$schema"],
        "$defs": full["$defs"],
        **full["$defs"]["Scene"],
    }


def format_error(error) -> str:
    path = ".".join(str(p) for p in error.path) or "(root)"
    return f"{path}: {error.message}"


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2

    scene_mode = args[0] == "--scene"
    target_path = Path(args[1] if scene_mode else args[0])

    if not target_path.exists():
        print(f"File non trovato: {target_path}", file=sys.stderr)
        return 2

    instance = json.loads(target_path.read_text(encoding="utf-8"))
    schema = scene_schema() if scene_mode else load_schema()

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))

    if not errors:
        print(f"{target_path.name}: valido.")
        return 0

    print(f"{target_path.name}: {len(errors)} errori:", file=sys.stderr)
    for e in errors:
        print(f"  - {format_error(e)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
