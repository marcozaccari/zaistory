#!/usr/bin/env python3
"""Estrae da uno story.ir.json il manifest delle immagini da generare.

Passo 1 dei due descritti in ARCHITECTURE.md ("Modulo assets"): qui NON si
genera niente, si attraversa l'IR e si risolvono le **ancore** (personaggi,
luoghi, oggetti) e le **inquadrature** che le referenziano. La generazione
vera e' un passo separato, che consuma solo questo file.

Uso:
    python extract_manifest.py stories/metal-head/story.ir.json -o out/manifest.json
    python extract_manifest.py stories/metal-head/story.ir.json --level anchors
    python extract_manifest.py stories/metal-head/story.ir.json --sample 6 -o out/sample.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import pathlib
import re
import sys

MANIFEST_VERSION = 2

# Default pensati per Pollinations, dove la VRAM non e' piu' un vincolo nostro.
# (La v1 stava a 768 per far stare Z-Image Turbo nella T4 di Kaggle.)
DEFAULTS = {
    "width": 1024,
    "height": 1024,
    "steps": 8,
    "cfg": 0.0,
}

# I due tier. Sono la stessa divisione dei due livelli, vista dal lato costo:
#   - le ancore sono poche ed e' l'unico punto in cui vuoi che il modello
#     inventi liberamente: modello text-only economico;
#   - le inquadrature devono tenere l'identita' dei personaggi, e nessun testo
#     puo' portarla: modello con reference, condizionato sulle ancore.
MODEL_ANCHORS = "grok-imagine"
MODEL_SHOTS = "nanobanana-2-lite"

# Limite pratico di immagini di riferimento per richiesta: oltre, i modelli
# tendono a mediare fra i soggetti invece di tenerli distinti.
MAX_REFS = 4

# Un'ancora non e' un'inquadratura: e' il riferimento stabile dell'entita'.
# Va quindi generata con un'inquadratura neutra e ripetibile, altrimenti il
# modello ci mette dentro una scena e l'ancora smette di essere riusabile.
# Il taglio delle ancore di personaggio e' una decisione d'insieme sul cast,
# presa una volta per storia in `global_style.anchor_framing` — non un esito
# per personaggio. Ancore con ritagli diversi portano quantita' diverse di
# dettaglio del viso, e il viso e' il pixel su cui si regge l'identita'.
#
# Se anche un solo personaggio *umano* ha bisogno della figura intera, ci
# vanno tutti: si cambia il campo globale. L'override sul singolo Character
# esiste per i soggetti che una figura umana non sono — un cane-robot
# quadrupede, un veicolo — dove "mezzo busto" non significa niente e il
# modello, giustamente, lo ignora.
DEFAULT_FRAMING = "waist-up"

FRAMING = {
    "bust": {
        "it": "ritratto di riferimento a mezzo primo piano, testa e spalle, inquadratura tagliata al petto, soggetto isolato su sfondo neutro uniforme, posa frontale, nessuna ambientazione",
        "en": "reference portrait, head-and-shoulders, the frame ends at the chest, single subject isolated on a plain even neutral backdrop, frontal pose, no setting, no props",
    },
    "waist-up": {
        "it": "ritratto di riferimento a mezzo busto, inquadratura tagliata alla vita, gambe e piedi fuori campo, soggetto isolato su sfondo neutro uniforme, posa frontale, nessuna ambientazione",
        "en": "reference portrait, waist-up crop, the frame ends at the waist, legs and feet out of frame, single subject isolated on a plain even neutral backdrop, frontal pose, no setting, no props",
    },
    "full-body": {
        "it": "veduta di riferimento completa, soggetto interamente dentro l'inquadratura dall'alto in basso, niente tagliato fuori, isolato su sfondo neutro uniforme, nessuna ambientazione",
        "en": "full reference view of the subject, the whole subject inside the frame from top to bottom, nothing cropped out, isolated on a plain even neutral backdrop, no setting, no props",
    },
}

# Promemoria breve e imperativo in CODA all'ancora: il contenuto puo'
# combattere l'inquadratura — bastano degli "scarponi" nella descrizione a far
# allargare il campo a figura intera, misurato — e il taglio detto una volta
# sola, in testa a un prompt lungo, non basta a tenerlo.
FRAMING_REMINDER = {
    "bust": {"it": "taglio a mezzo primo piano, testa e spalle",
             "en": "head-and-shoulders crop"},
    "waist-up": {"it": "taglio a mezzo busto, niente gambe, niente piedi",
                 "en": "waist-up crop, no legs, no feet"},
    # Niente "figura intera"/"full-body" qui: sono parole da corpo umano, e su
    # un soggetto che umano non e' spingono il modello ad antropomorfizzarlo —
    # misurato, il cane-robot quadrupede e' tornato un umanoide in piedi.
    "full-body": {"it": "soggetto tutto dentro l'inquadratura, niente tagliato",
                  "en": "whole subject in frame, nothing cropped"},
}

# Luoghi e oggetti non hanno un taglio configurabile: la loro inquadratura
# neutra e' gia' quella giusta e non c'e' un cast da rendere omogeneo.
ANCHOR_FRAMING = {
    "it": {
        "place": "veduta d'insieme del luogo, campo largo, nessun personaggio presente",
        "item": "oggetto isolato e centrato su sfondo neutro, icona d'inventario, nessun personaggio",
    },
    "en": {
        "place": "establishing view of the location, wide shot, empty, no people present",
        "item": "single object centred on a plain neutral backdrop, inventory icon, no people",
    },
}

# L'impalcatura del prompt — premessa e connettivi — deve stare nella stessa
# lingua del prompt che avvolge. Un prompt inglese con i connettivi in
# italiano e' un prompt misto, e i modelli lo leggono peggio di entrambi.
#
# La premessa serve perche' l'endpoint delle inquadrature e' di *editing*:
# senza quella riga il modello tende a modificare la prima immagine allegata
# invece di comporne una nuova.
SCAFFOLD = {
    "it": {
        "ref_instruction": "componi una NUOVA inquadratura; gli allegati servono solo per l'aspetto dei soggetti, non modificarli",
        "setting": "ambientazione: {}",
        "ref_map": "riferimenti allegati: {}",
        "ref_map_place": "immagine {} = l'ambientazione, {}",
        "ref_map_char": "immagine {} = {}",
    },
    "en": {
        "ref_instruction": "compose a NEW shot; the attachments are appearance reference only, do not edit them",
        "setting": "setting: {}",
        "ref_map": "attached references: {}",
        "ref_map_place": "image {} = the setting, {}",
        "ref_map_char": "image {} = {}",
    },
}


def stable_seed(key: str) -> int:
    """Seed deterministico derivato dall'id del job.

    Serve a due cose: rigenerare il manifest non cambia le immagini gia'
    prodotte, e per rifare un asset venuto male basta toccare a mano il campo
    `seed` di quel job.
    """
    digest = hashlib.sha1(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % (2**31 - 1)


def safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("_") or "unnamed"


def join_parts(parts: list[str]) -> str:
    return ", ".join(p.strip().rstrip(".,;") for p in parts if p and p.strip())


def pick_lang(obj: dict, field: str) -> tuple[str | None, str]:
    """Il campo `<field>_en` se c'e', altrimenti quello italiano.

    I modelli di immagini sono addestrati in inglese, e l'italiano costa
    aderenza: misurato su questa storia, uno style suffix in coda a un prompt
    italiano lungo viene proprio scartato — l'immagine esce a colori mentre il
    suffisso chiedeva bianco e nero. L'italiano resta pero' il campo canonico,
    perche' e' quello che il player mostra come testo, quindi qui si preferisce
    l'inglese senza pretenderlo: un IR compilato prima di questa modifica
    continua a funzionare.
    """
    en = obj.get(f"{field}_en")
    if en and en.strip():
        return en, "en"
    return obj.get(field), "it"


class Extractor:
    def __init__(self, ir: dict, ir_path: str, defaults: dict, models: dict | None = None):
        self.ir = ir
        self.ir_path = ir_path
        self.defaults = defaults
        self.models = models or {"anchors": MODEL_ANCHORS, "shots": MODEL_SHOTS}
        gs = ir.get("global_style") or {}
        self.framing = gs.get("anchor_framing") or DEFAULT_FRAMING
        self.style_suffix = gs.get("image_style_suffix") or ""
        self.style_suffix_en = gs.get("image_style_suffix_en") or ""
        self.langs: dict[str, int] = {"en": 0, "it": 0}
        self.characters = {c["id"]: c for c in ir.get("characters", []) if "id" in c}
        self.places = {p["id"]: p for p in ir.get("places", []) if "id" in p}
        self.items = {i["id"]: i for i in ir.get("items", []) if "id" in i}
        self.anchors: dict[str, dict] = {}
        self.variants: dict[tuple[str, str], str] = {}
        self.shots: list[dict] = []
        self.warnings: list[str] = []
        self._warned: set[str] = set()

    def style_for(self, lang: str) -> str:
        """Lo style suffix nella lingua del prompt che lo ospita.

        Se manca la versione inglese si usa quella italiana e si avvisa: un
        prompt inglese con lo stile in italiano e' proprio il caso in cui lo
        stile viene scartato, che e' il bug che ci ha portati fin qui.
        """
        if lang == "en":
            if self.style_suffix_en:
                return self.style_suffix_en
            if self.style_suffix and "style_en" not in self._warned:
                self._warned.add("style_en")
                self.warnings.append(
                    "global_style.image_style_suffix_en manca: i prompt inglesi "
                    "portano lo stile in italiano, ed e' il campo che si perde "
                    "per primo")
        return self.style_suffix

    # ---------------------------------------------------------------- ancore

    def framing_parts(self, kind, lang, framing=None):
        """(testa, coda) dell'impalcatura d'inquadratura per questa ancora."""
        if kind not in ("character", "character_variant"):
            return ANCHOR_FRAMING[lang].get(kind, ""), ""
        name = framing or self.framing
        if name not in FRAMING:
            if f"framing:{name}" not in self._warned:
                self._warned.add(f"framing:{name}")
                self.warnings.append(
                    f"anchor_framing '{name}' sconosciuto, uso "
                    f"'{DEFAULT_FRAMING}' (validi: {', '.join(FRAMING)})")
            name = DEFAULT_FRAMING
        return FRAMING[name][lang], FRAMING_REMINDER[name][lang]

    def _add_anchor(self, anchor_id, kind, entity_id, name, visual_prompt, source,
                    variant_of=None, lang="it", framing=None):
        if not visual_prompt:
            return None
        if anchor_id in self.anchors:
            return anchor_id
        self.langs[lang] += 1
        head, tail = self.framing_parts(kind, lang, framing)
        self.anchors[anchor_id] = {
            "id": anchor_id,
            "level": "anchor",
            "kind": kind,
            "entity_id": entity_id,
            "name": name,
            "variant_of": variant_of,
            "base_prompt": visual_prompt,
            "prompt": join_parts([head, visual_prompt, self.style_for(lang), tail]),
            "framing": framing or self.framing if kind.startswith("character") else None,
            "refs": {"place": None, "characters": []},
            "deps": [],
            "model": self.models["anchors"],
            "lang": lang,
            "source": source,
            "seed": stable_seed(anchor_id),
            "file": f"anchors/{safe_name(anchor_id)}.png",
            **self.defaults,
        }
        return anchor_id

    def collect_anchors(self):
        for idx, char in enumerate(self.ir.get("characters", [])):
            prompt, lang = pick_lang(char, "visual_prompt")
            self._add_anchor(
                f"anchor.char.{char['id']}", "character", char["id"],
                char.get("name", char["id"]), prompt,
                f"characters[{idx}]", lang=lang,
                framing=char.get("anchor_framing"),
            )
        for idx, place in enumerate(self.ir.get("places", [])):
            prompt, lang = pick_lang(place, "visual_prompt")
            self._add_anchor(
                f"anchor.place.{place['id']}", "place", place["id"],
                place.get("name", place["id"]), prompt,
                f"places[{idx}]", lang=lang,
            )
        for idx, item in enumerate(self.ir.get("items", [])):
            prompt, lang = pick_lang(item, "visual_prompt")
            self._add_anchor(
                f"anchor.item.{item['id']}", "item", item["id"],
                item.get("name", item["id"]), prompt,
                f"items[{idx}]", lang=lang,
            )
        # Override locali: un personaggio che in una scena e' descritto in modo
        # diverso (ferito, travestito) e' una VARIANTE d'ancora, non una
        # inquadratura. Deve comunque passare dal livello di assegnazione,
        # altrimenti l'inquadratura resta senza riferimento risolvibile.
        for s_idx, scene in enumerate(self.ir.get("scenes", [])):
            for c_idx, entry in enumerate(scene.get("characters", []) or []):
                override, lang = pick_lang(entry, "visual_prompt")
                if not override:
                    continue
                cid = entry.get("id")
                base = self.characters.get(cid, {})
                # L'id della variante viene dal CONTENUTO dell'override, non
                # dalla scena: uno stato che dura — ferita, travestimento —
                # si ripete identico in tutte le scene da li' in poi, e con
                # un id per scena diventerebbe una trentina di ancore uguali,
                # generate e pagate una per una. Cosi' invece e' una sola,
                # riusata da tutte le scene che la dichiarano.
                digest = hashlib.sha1(" ".join(override.split()).encode()).hexdigest()[:8]
                anchor_id = f"anchor.char.{cid}@{digest}"
                self._add_anchor(
                    anchor_id, "character_variant", cid,
                    base.get("name", cid), override,
                    f"scenes[{s_idx}].characters[{c_idx}]",
                    variant_of=f"anchor.char.{cid}", lang=lang,
                    framing=base.get("anchor_framing"),
                )
                self.variants[(cid, scene["id"])] = anchor_id

    def _anchor_for_character(self, cid, scene_id):
        variant = self.variants.get((cid, scene_id))
        if variant:
            return variant
        base = f"anchor.char.{cid}"
        if base in self.anchors:
            return base
        self.warnings.append(f"scena {scene_id}: characters_in_frame cita '{cid}', che non ha un'ancora")
        return None

    # --------------------------------------------------------- inquadrature

    def _add_shot(self, shot_id, kind, scene, image_prompt, place_id, chars, source,
                  lang="it"):
        self.langs[lang] += 1
        anchor_place = None
        if place_id:
            anchor_place = f"anchor.place.{place_id}"
            if anchor_place not in self.anchors:
                self.warnings.append(f"scena {scene['id']}: place '{place_id}' non ha un'ancora")
                anchor_place = None

        anchor_chars = [a for a in (self._anchor_for_character(c, scene["id"]) for c in chars or []) if a]

        # Due prompt, non uno, perche' i due tier hanno bisogni opposti.
        #
        # `prompt` e' quello text-only: l'inquadratura non ripete la
        # descrizione del posto o dei personaggi, i testi si sommano qui.
        #
        # `prompt_ref` e' quello usato quando le ancore viaggiano come
        # immagini allegate. Li' ridescrivere a parole l'aspetto e' peggio che
        # inutile: il testo e il riferimento visivo entrano in competizione e
        # il modello media fra i due. Restano i soli nomi, che servono a legare
        # ogni allegato al soggetto giusto.
        sc = SCAFFOLD[lang]
        parts = [image_prompt]
        for a in ([anchor_place] if anchor_place else []):
            parts.append(sc["setting"].format(self.anchors[a]["base_prompt"]))
        for a in anchor_chars:
            anchor = self.anchors[a]
            parts.append(f"{anchor['name']}: {anchor['base_prompt']}")

        # Elenco NUMERATO degli allegati, nello stesso ordine in cui il
        # generatore li spedisce (deps: prima il luogo, poi i personaggi).
        #
        # Senza, il modello riceve N immagini in un ordine, N nomi in una
        # lista e N ruoli nella frase, e deve indovinare l'abbinamento: nella
        # prova in auto ha messo al volante l'uomo anziano invece del ragazzo.
        # Dire "immagine 2 = Mark" toglie di mezzo l'indovinello.
        ref_parts = [sc["ref_instruction"]]
        entries = []
        n = 0
        if anchor_place:
            n += 1
            entries.append(sc["ref_map_place"].format(n, self.anchors[anchor_place]["name"]))
        for a in anchor_chars:
            n += 1
            entries.append(sc["ref_map_char"].format(n, self.anchors[a]["name"]))
        if entries:
            ref_parts.append(sc["ref_map"].format("; ".join(entries)))
        ref_parts.append(image_prompt)
        style = self.style_for(lang)
        parts.append(style)
        ref_parts.append(style)

        # Un'inquadratura in inglese che eredita la descrizione di un'ancora
        # rimasta in italiano produce un prompt misto: peggio di entrambe le
        # lingue pure, e invisibile se non lo si dice.
        mixed = [a for a in ([anchor_place] if anchor_place else []) + anchor_chars
                 if self.anchors[a]["lang"] != lang]
        if mixed:
            self.warnings.append(
                f"{shot_id}: prompt in '{lang}' ma le ancore {mixed} sono in "
                f"un'altra lingua — prompt misto")

        deps = ([anchor_place] if anchor_place else []) + anchor_chars
        # Oltre le quattro reference i modelli cominciano a mediare fra i
        # soggetti invece di tenerli distinti: meglio saperlo qui che
        # scoprirlo guardando l'immagine.
        if len(deps) > MAX_REFS:
            self.warnings.append(
                f"{shot_id}: {len(deps)} reference ({MAX_REFS} e' il limite "
                f"pratico) — valuta di togliere qualcuno da characters_in_frame")

        self.shots.append({
            "id": shot_id,
            "level": "shot",
            "kind": kind,
            "scene": scene["id"],
            "scene_title": scene.get("title"),
            "base_prompt": image_prompt,
            "prompt": join_parts(parts),
            "prompt_ref": join_parts(ref_parts),
            "refs": {"place": anchor_place, "characters": anchor_chars},
            "deps": deps,
            "model": self.models["shots"],
            "lang": lang,
            "source": source,
            "seed": stable_seed(shot_id),
            "file": f"shots/{safe_name(scene['id'])}/{safe_name(shot_id)}.png",
            **self.defaults,
        })

    def collect_shots(self):
        # La locandina per prima: e' un'inquadratura come le altre — stessi
        # campi, stesse ancore, stesso scaffold — solo che inquadra la storia
        # invece di una scena. Le si passa una pseudo-scena "cover" perche'
        # `_add_shot` usa l'id della scena per il percorso del file e per i
        # messaggi: inventare un secondo percorso per un job solo sarebbe due
        # strade dove ne basta una.
        cover = self.ir.get("cover") or {}
        cover_prompt, cover_lang = pick_lang(cover, "image_prompt")
        if cover_prompt:
            self._add_shot(
                "shot.cover", "cover", {"id": "cover", "title": self.ir.get("title")},
                cover_prompt, cover.get("place"), cover.get("characters_in_frame"),
                "cover", lang=cover_lang,
            )

        for s_idx, scene in enumerate(self.ir.get("scenes", [])):
            bg = scene.get("background") or {}
            bg_place = bg.get("place")
            bg_prompt, bg_lang = pick_lang(bg, "image_prompt")
            if bg_prompt:
                self._add_shot(
                    f"shot.{scene['id']}.bg", "background", scene,
                    bg_prompt, bg_place, bg.get("characters_in_frame"),
                    f"scenes[{s_idx}].background", lang=bg_lang,
                )
            for n_idx, node in enumerate(scene.get("narration", []) or []):
                prompt, lang = pick_lang(node, "image_prompt")
                if not prompt:
                    continue
                self._add_shot(
                    f"shot.{scene['id']}.n{n_idx}", "narration", scene,
                    prompt, node.get("place") or bg_place,
                    node.get("characters_in_frame"),
                    f"scenes[{s_idx}].narration[{n_idx}]", lang=lang,
                )

    # ------------------------------------------------------------- manifest

    def build(self, level="all", sample=None):
        self.collect_anchors()
        self.collect_shots()

        jobs = []
        if level in ("all", "anchors"):
            jobs += list(self.anchors.values())
        if level in ("all", "shots"):
            jobs += self.shots

        if sample:
            jobs = self._sample(jobs, sample)

        return {
            "manifest_version": MANIFEST_VERSION,
            "story_id": self.ir.get("id"),
            "title": self.ir.get("title"),
            "ir_file": self.ir_path,
            "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "level": level,
            "style_suffix": self.style_suffix,
            "style_suffix_en": self.style_suffix_en,
            "defaults": self.defaults,
            "models": self.models,
            "anchor_framing": self.framing,
            "prompt_language": {
                "en": sum(1 for j in jobs if j.get("lang") == "en"),
                "it": sum(1 for j in jobs if j.get("lang") == "it"),
            },
            "counts": {
                "anchors": sum(1 for j in jobs if j["level"] == "anchor"),
                "shots": sum(1 for j in jobs if j["level"] == "shot"),
                "total": len(jobs),
            },
            "warnings": self.warnings,
            "jobs": jobs,
        }

    def _sample(self, jobs, n):
        """Campione rappresentativo: un po' di ogni kind, ordine stabile.

        Il campione e' *chiuso rispetto alle dipendenze*: se prende
        un'inquadratura si porta dietro le ancore che le servono come
        riferimento, altrimenti il tier con reference — cioe' proprio quello
        che si vuole provare a poco prezzo — non e' generabile e il campione
        serve solo a testare il tier economico.
        """
        by_kind: dict[str, list] = {}
        for job in jobs:
            by_kind.setdefault(job["kind"], []).append(job)
        picked, kinds = [], list(by_kind)
        while len(picked) < n and any(by_kind[k] for k in kinds):
            for k in kinds:
                if by_kind[k] and len(picked) < n:
                    picked.append(by_kind[k].pop(0))

        chosen = {j["id"] for j in picked}
        extra = []
        for job in picked:
            for dep in job.get("deps") or []:
                if dep not in chosen and dep in self.anchors:
                    chosen.add(dep)
                    extra.append(self.anchors[dep])
        if extra:
            self.warnings.append(
                f"campione: aggiunte {len(extra)} ancore richieste dalle "
                f"inquadrature scelte ({n} -> {len(picked) + len(extra)} job)")
        # Le ancore prima, che e' anche l'ordine in cui vanno generate.
        return extra + picked


def main(argv=None):
    ap = argparse.ArgumentParser(description="story.ir.json -> assets_manifest.json")
    ap.add_argument("ir", help="percorso di story.ir.json")
    ap.add_argument("-o", "--out", help="file di output (default: accanto all'IR)")
    ap.add_argument("--level", choices=["all", "anchors", "shots"], default="all")
    ap.add_argument("--sample", type=int, help="tieni solo N job, misti per tipo (per le prove)")
    ap.add_argument("--size", default=f"{DEFAULTS['width']}x{DEFAULTS['height']}")
    ap.add_argument("--steps", type=int, default=DEFAULTS["steps"])
    ap.add_argument("--cfg", type=float, default=DEFAULTS["cfg"])
    ap.add_argument("--model-anchors", default=MODEL_ANCHORS,
                    help=f"modello text-only per le ancore (default: {MODEL_ANCHORS})")
    ap.add_argument("--model-shots", default=MODEL_SHOTS,
                    help=f"modello con reference per le inquadrature (default: {MODEL_SHOTS})")
    args = ap.parse_args(argv)

    width, _, height = args.size.partition("x")
    defaults = {
        "width": int(width), "height": int(height),
        "steps": args.steps, "cfg": args.cfg,
    }
    models = {"anchors": args.model_anchors, "shots": args.model_shots}

    ir_path = pathlib.Path(args.ir)
    ir = json.loads(ir_path.read_text(encoding="utf-8"))

    extractor = Extractor(ir, ir_path.name, defaults, models)
    manifest = extractor.build(level=args.level, sample=args.sample)

    out_path = pathlib.Path(args.out) if args.out else ir_path.with_suffix(".assets_manifest.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    c = manifest["counts"]
    lang = manifest["prompt_language"]
    print(f"{out_path}: {c['total']} job ({c['anchors']} ancore, {c['shots']} inquadrature)")
    print(f"  prompt: {lang['en']} in inglese, {lang['it']} in italiano")
    for w in manifest["warnings"]:
        print(f"  ATTENZIONE: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
