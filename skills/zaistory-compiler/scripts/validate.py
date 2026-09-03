#!/usr/bin/env python3
"""Valida un file zaistory (o un suo frammento) contro zaistory.schema.json.

Esce con 0 se valido, 1 se non valido, 2 se manca qualcosa per poter validare.
Gli errori vanno su stderr, uno per riga, con il percorso del campo.

    validate.py stories/mini/mini.zaistory.json
    validate.py --def Phase fase.json      # un frammento, contro un $defs

Il secondo modo serve durante la compilazione: lo Stadio B produce un pezzo
alla volta, e aspettare il file intero per scoprire un campo sbagliato
significa scoprirlo quaranta pezzi dopo.

Questo controlla che il file sia BEN FORMATO. Che sia GIOCABILE lo dice il
linter del player, che è un'altra cosa e gira dopo.
"""

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "references" / "zaistory.schema.json"


def fail(msg: str, code: int = 2) -> "NoReturn":  # type: ignore[name-defined]
    print(msg, file=sys.stderr)
    sys.exit(code)


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"non trovato: {path}")
    except json.JSONDecodeError as e:
        fail(f"{path}: JSON non valido alla riga {e.lineno}, colonna {e.colno}: {e.msg}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Valida un file zaistory contro lo schema.")
    ap.add_argument("file", help="il file da validare")
    ap.add_argument(
        "--def",
        dest="definition",
        help="valida un frammento contro un $defs dello schema (es. Phase, Place, Act, Action)",
    )
    ap.add_argument(
        "--no-name-check",
        action="store_true",
        help="non verificare che il nome del file combaci con il campo id",
    )
    args = ap.parse_args()

    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        fail("manca jsonschema (serve la 4 o più recente): pip install jsonschema --break-system-packages")

    schema = load_json(SCHEMA)
    target = Path(args.file)
    doc = load_json(target)

    if args.definition:
        if args.definition not in schema["$defs"]:
            fail(f"$defs sconosciuto: {args.definition}. Disponibili: {', '.join(sorted(schema['$defs']))}")
        # il frammento si valida contro il $defs, tenendo lo schema intero
        # come risolutore dei $ref interni
        sub = dict(schema)
        sub.pop("required", None)
        sub.pop("properties", None)
        sub.pop("additionalProperties", None)
        sub["$ref"] = f"#/$defs/{args.definition}"
        sub.pop("type", None)
        validator = Draft202012Validator(sub)
    else:
        validator = Draft202012Validator(schema)

    errors = sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.path)))
    for e in errors:
        where = "/".join(str(p) for p in e.path) or "(radice)"
        print(f"{where}: {e.message}", file=sys.stderr)

    # Il nome del file porta l'id della storia, e i due devono combaciare:
    # sono due posti che dicono la stessa cosa, ed è il tipo di coppia che
    # diverge al primo mv.
    extra = 0
    if not args.definition and not args.no_name_check and isinstance(doc, dict):
        m = re.fullmatch(r"(.+)\.zaistory\.json", target.name)
        if not m:
            print(f"(radice): il file dovrebbe chiamarsi <id>.zaistory.json, non {target.name}", file=sys.stderr)
            extra += 1
        elif doc.get("id") and m.group(1) != doc["id"]:
            print(
                f"(radice): il nome del file dice '{m.group(1)}' ma il campo id dice '{doc['id']}'",
                file=sys.stderr,
            )
            extra += 1

    if errors or extra:
        n = len(errors) + extra
        print(f"\n{n} error{'e' if n == 1 else 'i'}.", file=sys.stderr)
        return 1

    print(f"{target.name}: valido")
    return 0


if __name__ == "__main__":
    sys.exit(main())
