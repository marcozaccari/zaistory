#!/usr/bin/env python3
"""Valida un file story.ir.json (o una singola Scene) contro engine-ir.schema.json.

Uso:
    python3 validate.py story.ir.json              # valida un'intera Story
    python3 validate.py --scene scena.json          # valida una singola Scene

Oltre allo schema segnala i prompt di generazione senza la versione inglese
(`--no-prompt-check` per tacere). Non e' un errore di formato — l'inglese e'
opzionale — ma e' un difetto vero: quei prompt finiscono al modello di
immagini in italiano, e li' perdono aderenza.

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


# I campi bilingui: l'italiano e' il canonico (lo mostra il player in
# modalita' solo testo), l'inglese e' quello che va al generatore di immagini.
BILINGUAL = ("image_style_suffix", "visual_prompt", "image_prompt")


def missing_english(node, path: str = "") -> list[str]:
    """Percorsi dei prompt che hanno l'italiano e non l'inglese.

    Cammina l'IR invece di elencare le posizioni note: i campi bilingui
    compaiono in sei posti diversi (stile globale, personaggi, luoghi,
    oggetti, override di scena, sfondi) e un elenco fisso invecchia male.
    """
    out = []
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}.{key}" if path else key
            if key in BILINGUAL and isinstance(value, str) and value.strip() \
                    and not (node.get(key + "_en") or "").strip():
                out.append(here)
            out += missing_english(value, here)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            out += missing_english(value, f"{path}[{i}]")
    return out


def format_error(error) -> str:
    path = ".".join(str(p) for p in error.path) or "(root)"
    return f"{path}: {error.message}"


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2

    prompt_check = "--no-prompt-check" not in args
    args = [a for a in args if a != "--no-prompt-check"]
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

    if prompt_check:
        mancanti = missing_english(instance)
        if mancanti:
            print(f"{target_path.name}: {len(mancanti)} prompt senza la "
                  f"versione inglese (verranno generati in italiano):",
                  file=sys.stderr)
            for m in mancanti[:20]:
                print(f"  - {m}", file=sys.stderr)
            if len(mancanti) > 20:
                print(f"  ... e altri {len(mancanti) - 20}", file=sys.stderr)

    if not errors:
        print(f"{target_path.name}: valido.")
        return 0

    print(f"{target_path.name}: {len(errors)} errori:", file=sys.stderr)
    for e in errors:
        print(f"  - {format_error(e)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
