#!/usr/bin/env python3
"""Segmenta una sceneggiatura sorgente nei blocchi per-scena, usando gli
source_excerpt_hint di una story map (Stadio A) gia' prodotta.

Uso:
    python3 segment.py script.md story_map.json

Stampa su stdout un JSON: {"scene_id": "testo del blocco...", ...}
Se un hint non viene trovato nel testo sorgente, fallisce con un errore
esplicito (stessa filosofia del segmenter Go/Python del progetto CLI: meglio
un fallimento leggibile che una segmentazione silenziosamente sbagliata).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def fuzzy_find(haystack: str, hint: str) -> int:
    lower_haystack = haystack.lower()
    hint = hint.strip()

    idx = lower_haystack.find(hint.lower())
    if idx != -1:
        return idx

    words = hint.split()
    for n in (8, 5, 3):
        if len(words) >= n:
            shorter = " ".join(words[:n])
            idx = lower_haystack.find(shorter.lower())
            if idx != -1:
                return idx
    return -1


def segment_script(script_text: str, scene_segments: list[dict]) -> dict[str, str]:
    positions = []
    for seg in scene_segments:
        hint = seg["source_excerpt_hint"]
        idx = fuzzy_find(script_text, hint)
        if idx == -1:
            raise ValueError(
                f"Impossibile localizzare la scena '{seg['id']}' tramite l'hint: {hint!r}. "
                "Lo stadio A potrebbe aver parafrasato invece di estrarre testo letterale."
            )
        positions.append((seg["id"], idx))

    positions.sort(key=lambda p: p[1])

    blocks = {}
    for i, (scene_id, start) in enumerate(positions):
        end = positions[i + 1][1] if i + 1 < len(positions) else len(script_text)
        blocks[scene_id] = script_text[start:end].strip()

    return blocks


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    script_path, story_map_path = Path(sys.argv[1]), Path(sys.argv[2])
    script_text = script_path.read_text(encoding="utf-8")
    story_map = json.loads(story_map_path.read_text(encoding="utf-8"))

    try:
        blocks = segment_script(script_text, story_map["scene_segments"])
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(blocks, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
