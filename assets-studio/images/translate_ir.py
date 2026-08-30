#!/usr/bin/env python3
"""Aggiunge a un IR gia' compilato i campi `*_en` dei prompt di generazione.

Serve per gli IR nati prima che il compilatore fosse bilingue: le storie
compilate d'ora in poi escono gia' con entrambe le lingue e questo script non
serve. Resta utile per riapplicare una traduzione dopo una ricompilazione,
motivo per cui il file delle traduzioni va tenuto nel repo accanto all'IR.

I tre passi:

    python translate_ir.py extract stories/metal-head/story.ir.json -o metalhead.prompts.json
    # (si traducono i valori, la struttura resta uguale)
    python translate_ir.py merge stories/metal-head/story.ir.json metalhead.prompts_en.json
    python translate_ir.py status stories/metal-head/story.ir.json

Le chiavi sono percorsi stabili e leggibili — `characters.laura.visual_prompt`,
`scenes.fosso.narration.1.image_prompt` — non indici posizionali, cosi' una
traduzione sopravvive a un riordino delle scene.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

# I campi che vanno tradotti, e solo quelli: il testo narrativo, i dialoghi e
# le descrizioni che il giocatore legge restano in italiano.
TRANSLATABLE = "image_prompt", "visual_prompt", "image_style_suffix"


def walk(ir: dict):
    """Genera (chiave, contenitore, campo) per ogni prompt traducibile."""
    gs = ir.get("global_style") or {}
    if gs.get("image_style_suffix"):
        yield "global_style.image_style_suffix", gs, "image_style_suffix"

    for coll, prefix in (("characters", "characters"), ("places", "places"),
                         ("items", "items")):
        for entry in ir.get(coll, []) or []:
            if entry.get("visual_prompt"):
                yield (f"{prefix}.{entry['id']}.visual_prompt", entry,
                       "visual_prompt")

    for scene in ir.get("scenes", []) or []:
        sid = scene.get("id")
        bg = scene.get("background") or {}
        if bg.get("image_prompt"):
            yield f"scenes.{sid}.background.image_prompt", bg, "image_prompt"
        for i, node in enumerate(scene.get("narration", []) or []):
            if node.get("image_prompt"):
                yield (f"scenes.{sid}.narration.{i}.image_prompt", node,
                       "image_prompt")
        for entry in scene.get("characters", []) or []:
            if entry.get("visual_prompt"):
                yield (f"scenes.{sid}.characters.{entry.get('id')}.visual_prompt",
                       entry, "visual_prompt")


def cmd_extract(args):
    ir = json.loads(pathlib.Path(args.ir).read_text(encoding="utf-8"))
    out = {key: holder[field] for key, holder, field in walk(ir)}
    path = pathlib.Path(args.out)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    chars = sum(len(v) for v in out.values())
    print(f"{path}: {len(out)} campi, {chars} caratteri")
    return 0


def cmd_merge(args):
    ir_path = pathlib.Path(args.ir)
    ir = json.loads(ir_path.read_text(encoding="utf-8"))
    trans = json.loads(pathlib.Path(args.translations).read_text(encoding="utf-8"))

    index = {key: (holder, field) for key, holder, field in walk(ir)}
    unknown = sorted(set(trans) - set(index))
    if unknown:
        print(f"ATTENZIONE: {len(unknown)} chiavi non esistono nell'IR "
              f"(scene rinominate?): {unknown[:5]}", file=sys.stderr)

    written = 0
    for key, (holder, field) in index.items():
        value = trans.get(key)
        if not value or not value.strip():
            continue
        holder[f"{field}_en"] = value.strip()
        written += 1

    missing = [k for k in index if k not in trans or not (trans.get(k) or "").strip()]
    out = pathlib.Path(args.out or args.ir)
    out.write_text(json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{out}: {written}/{len(index)} campi tradotti")
    if missing:
        # Una traduzione parziale non e' meta' del lavoro fatto: produce prompt
        # misti, che i modelli leggono peggio di entrambe le lingue pure.
        print(f"ATTENZIONE: {len(missing)} campi senza traduzione, "
              f"resteranno in italiano:", file=sys.stderr)
        for k in missing[:10]:
            print(f"  {k}", file=sys.stderr)
        if len(missing) > 10:
            print(f"  ... e altri {len(missing) - 10}", file=sys.stderr)
    return 0


def cmd_status(args):
    ir = json.loads(pathlib.Path(args.ir).read_text(encoding="utf-8"))
    rows = list(walk(ir))
    done = [k for k, holder, field in rows if (holder.get(f"{field}_en") or "").strip()]
    print(f"{args.ir}: {len(done)}/{len(rows)} prompt hanno la versione inglese")
    if len(done) < len(rows):
        for key, holder, field in rows:
            if not (holder.get(f"{field}_en") or "").strip():
                print(f"  manca  {key}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="prompt bilingui in un IR esistente")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("extract", help="estrai i prompt italiani da tradurre")
    e.add_argument("ir")
    e.add_argument("-o", "--out", required=True)
    e.set_defaults(func=cmd_extract)

    m = sub.add_parser("merge", help="scrivi i campi *_en nell'IR")
    m.add_argument("ir")
    m.add_argument("translations")
    m.add_argument("-o", "--out", help="default: sovrascrive l'IR")
    m.set_defaults(func=cmd_merge)

    s = sub.add_parser("status", help="quanti prompt hanno gia' l'inglese")
    s.add_argument("ir")
    s.set_defaults(func=cmd_status)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
