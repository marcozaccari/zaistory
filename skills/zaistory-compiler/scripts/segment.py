#!/usr/bin/env python3
"""Segmenta una sceneggiatura nei blocchi sorgente, raggruppati per luogo.

Uso:
    python3 segment.py sceneggiatura.md story_map.json

Usa gli `source_excerpt_hint` dei `scene_segments` prodotti dallo Stadio A per
ritrovare l'inizio di ogni blocco nel testo, poi taglia fra un inizio e il
successivo. Stampa su stdout:

    {
      "magazzino": [
        {"phase": "magazzino_ricerca", "act": "atto_uno", "text": "..."},
        {"phase": "magazzino_dopo",    "act": "atto_uno", "text": "..."}
      ]
    }

Il raggruppamento per luogo non è cosmetico: in questo formato l'unità di
compilazione è il LUOGO, e le sue fasi si scrivono guardandosi fra loro — cosa
cambia dall'una all'altra, quale look racconta il cambiamento. Consegnarle
sparse una alla volta è il modo di ottenere fasi che non si parlano.

Se un hint non viene trovato, fallisce con un errore esplicito: meglio un
fallimento leggibile che una segmentazione silenziosamente sbagliata.

Una fase può non avere nessun blocco sorgente — tipicamente quella ESAURITA, che
l'autore non ha scritto perché ha descritto il posto una volta sola. Si dichiara
senza `source_excerpt_hint` e qui compare comunque nel gruppo del suo luogo, con
`text` vuoto e `"from_source": false`: va composta, non dimenticata.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def fuzzy_find(haystack: str, hint: str) -> int:
    """Cerca l'hint, poi prefissi via via più corti. Lo Stadio A dovrebbe
    copiare testo letterale, ma un accento normalizzato diversamente o una
    virgola in più non devono far fallire tutta la segmentazione."""
    lower = haystack.lower()
    hint = hint.strip()

    idx = lower.find(hint.lower())
    if idx != -1:
        return idx

    words = hint.split()
    for n in (8, 5, 3):
        if len(words) >= n:
            idx = lower.find(" ".join(words[:n]).lower())
            if idx != -1:
                return idx
    return -1


def trim_trailing_heading(block: str) -> str:
    """Toglie dalla coda del blocco le intestazioni markdown.

    Il taglio va da un hint al successivo, ma l'hint è la prima riga di TESTO
    della scena, non il suo titolo: senza questa potatura ogni blocco si porta
    in coda l'intestazione della scena dopo, e chi compila la legge come se
    appartenesse a questa.
    """
    lines = block.rstrip().split("\n")
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith("#")):
        lines.pop()
    return "\n".join(lines).strip()


def segment(script: str, segments: list[dict]) -> dict[str, list[dict]]:
    located: list[tuple[dict, int]] = []
    orphans: list[dict] = []

    for seg in segments:
        if "place" not in seg:
            raise ValueError(
                f"segmento '{seg.get('id', '?')}': manca il campo 'place'. "
                "Ogni segmento va assegnato a un luogo nello Stadio A."
            )
        hint = seg.get("source_excerpt_hint")
        if not hint:
            orphans.append(seg)
            continue
        idx = fuzzy_find(script, hint)
        if idx == -1:
            raise ValueError(
                f"Impossibile localizzare il segmento '{seg['id']}' con l'hint: {hint!r}. "
                "Lo Stadio A ha probabilmente parafrasato invece di copiare testo letterale."
            )
        located.append((seg, idx))

    located.sort(key=lambda p: p[1])

    text_of: dict[str, str] = {}
    for i, (seg, start) in enumerate(located):
        end = located[i + 1][1] if i + 1 < len(located) else len(script)
        text_of[seg["id"]] = trim_trailing_heading(script[start:end])

    # L'ordine dentro un luogo è quello dei segmenti nella story map, non quello
    # delle posizioni nel sorgente: una fase composta (senza hint) sta dove
    # l'autore della mappa l'ha messa, che è dove ha senso leggerla.
    out: dict[str, list[dict]] = {}
    for seg in segments:
        entry = {
            "phase": seg["id"],
            "act": seg.get("act"),
            "from_source": seg["id"] in text_of,
            "text": text_of.get(seg["id"], ""),
        }
        out.setdefault(seg["place"], []).append(entry)

    if orphans:
        ids = ", ".join(s["id"] for s in orphans)
        print(
            f"{len(orphans)} fase/i senza blocco sorgente ({ids}): vanno composte, "
            "non saltate — di solito sono le fasi esaurite dei luoghi in cui si torna.",
            file=sys.stderr,
        )

    return out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    script_path, map_path = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        script = script_path.read_text(encoding="utf-8")
        story_map = json.loads(map_path.read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        print(f"non trovato: {e.filename}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as e:
        print(f"{map_path}: JSON non valido alla riga {e.lineno}: {e.msg}", file=sys.stderr)
        return 2

    if "scene_segments" not in story_map:
        print("la story map non ha 'scene_segments'", file=sys.stderr)
        return 2

    try:
        blocks = segment(script, story_map["scene_segments"])
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(blocks, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
