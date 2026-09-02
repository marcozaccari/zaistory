#!/usr/bin/env python3
"""Porta le immagini approvate dal banco di lavoro dentro la storia.

    python assets-studio/images/publish.py stories/metal-head

E' l'unico passo della catena che tocca `story.ir.json`, e fa due cose sole:

1. copia in `assets/images/` le immagini **marcate come definitive** nello
   studio, convertite in WebP (lato lungo 1024);
2. scrive in ogni nodo dell'IR il campo `image` con l'id di quell'immagine.

Il resto della cartella `_work/` — grezzi, versioni, sidecar, manifest, cache
— non entra nella storia: e' materiale di produzione, si rigenera, e non e'
quello che un player deve scaricare.

Perche' la selezione e' esplicita e non "tutto quello che c'e'": nessuna
euristica sa quale immagine e' venuta bene, si guarda. La cartella di lavoro
contiene per costruzione anche i tentativi; pubblicare significa dire *questa*
si', ed e' una firma umana. `--all` esiste per la prima passata di prova, e lo
dice.

L'idempotenza non e' un lusso: si pubblica molte volte durante una revisione.
`_work/_published.json` registra, per ogni immagine pubblicata, l'hash del
file da cui viene — quindi una seconda pubblicazione senza cambiamenti non
riscrive niente e non tocca l'IR.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import generate

WORK_DIR = "_work"
MANIFEST_NAME = "assets_manifest.json"
SETTINGS_NAME = "_studio.json"
LEDGER_NAME = "_published.json"
IR_NAME = "story.ir.json"
IMAGES_DIR = "assets/images"

DEFAULT_FORMAT = "webp"
DEFAULT_MAX_SIDE = 1024
DEFAULT_QUALITY = 82


# --------------------------------------------------------------- percorsi

class Storia:
    """I quattro percorsi di una storia, ricavati dalla sua cartella.

    La struttura e' una convenzione, non un file di configurazione: una
    storia e' una cartella con dentro l'IR, gli asset pubblicati e il banco
    di lavoro. Chi ha un caso fuori convenzione passa i percorsi a mano.
    """

    def __init__(self, root, ir=None, work=None, images=None):
        self.root = pathlib.Path(root)
        self.ir_path = pathlib.Path(ir) if ir else self.root / IR_NAME
        self.work = pathlib.Path(work) if work else self.root / WORK_DIR
        self.images = pathlib.Path(images) if images else self.root / IMAGES_DIR
        self.manifest_path = self.work / MANIFEST_NAME
        self.settings_path = self.work / SETTINGS_NAME
        self.ledger_path = self.work / LEDGER_NAME

    def check(self):
        mancanti = [str(p) for p in (self.ir_path, self.manifest_path) if not p.is_file()]
        if mancanti:
            raise SystemExit("non trovo: " + ", ".join(mancanti))


def load_json(path: pathlib.Path, default=None):
    if not path.is_file():
        return {} if default is None else default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {} if default is None else default


def write_json(path: pathlib.Path, data, *, newline: bool = True):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(text + ("\n" if newline else ""), encoding="utf-8")


# ------------------------------------------------------- navigazione dell'IR

def parse_source(source: str) -> list:
    """`scenes[11].characters[0]` -> ['scenes', 11, 'characters', 0].

    E' il campo che il manifest si porta dietro dall'estrazione: dice da quale
    punto dell'IR viene un job, e quindi dove va riscritto il suo id immagine.
    Senza, la pubblicazione dovrebbe indovinare la corrispondenza rifacendo il
    lavoro dell'estrattore, e sbaglierebbe al primo id ambiguo.
    """
    out = []
    for pezzo in source.split("."):
        nome, _, resto = pezzo.partition("[")
        if nome:
            out.append(nome)
        while resto:
            indice, _, resto = resto.partition("]")
            if indice:
                out.append(int(indice))
            resto = resto.lstrip("[")
    return out


def resolve(ir: dict, source: str):
    """Il nodo indicato da `source`, o None se il percorso non esiste piu'."""
    node = ir
    try:
        for step in parse_source(source):
            node = node[step]
    except (KeyError, IndexError, TypeError):
        return None
    return node if isinstance(node, dict) else None


def coerente(node: dict, job: dict, ir: dict, source: str) -> str | None:
    """Il nodo trovato e' davvero quello del job? Altrimenti il motivo.

    Il manifest fotografa l'IR al momento dell'estrazione: se da allora una
    scena e' stata inserita o un personaggio spostato, `scenes[11]` indica un
    altro nodo, e scriverci dentro l'id di un'immagine sarebbe un errore
    silenzioso — la faccia sbagliata nella scena sbagliata. Meglio fermarsi e
    chiedere di rifare il manifest.
    """
    if job["level"] == "anchor":
        atteso = job.get("entity_id")
        if atteso and node.get("id") != atteso:
            return f"il nodo {source} adesso e' «{node.get('id')}», non «{atteso}»"
        return None
    scena = job.get("scene")
    passi = parse_source(source)
    if scena and len(passi) >= 2 and passi[0] == "scenes":
        try:
            vera = ir["scenes"][passi[1]]["id"]
        except (KeyError, IndexError, TypeError):
            return f"la scena {source} non esiste piu'"
        if vera != scena:
            return f"in {source} adesso c'e' la scena «{vera}», non «{scena}»"
    return None


def override_variante(node: dict) -> str | None:
    """Il testo su cui l'estrattore ha calcolato l'id di una variante d'ancora.

    Stessa scelta di lingua dell'estrazione — l'inglese se c'e', altrimenti
    l'italiano — e stessa normalizzazione degli spazi.
    """
    testo = node.get("visual_prompt_en") or node.get("visual_prompt")
    return " ".join(testo.split()) if testo else None


def varianti_ripetute(ir: dict, da_pubblicare: dict) -> dict:
    """Le altre scene che dichiarano lo stesso override, con l'id da metterci.

    Una ferita o un travestimento durano: lo stesso `visual_prompt` di scena
    si ripete identico in tutte le scene da li' in poi, e l'estrattore ne fa
    UNA sola ancora — l'id della variante viene dal contenuto, non dalla
    scena. Il manifest pero' registra come `source` solo la prima occorrenza,
    quindi seguendo i soli `source` le altre trenta scene resterebbero senza
    immagine pur avendone una gia' pronta.
    """
    per_testo = {}
    for info in da_pubblicare.values():
        if info["job"].get("kind") != "character_variant":
            continue
        chiave = (info["node"].get("id"), override_variante(info["node"]))
        if all(chiave):
            per_testo[chiave] = info["asset_id"]
    out = {}
    if not per_testo:
        return out
    for scena in ir.get("scenes") or []:
        for n in scena.get("characters") or []:
            aid = per_testo.get((n.get("id"), override_variante(n)))
            if aid:
                out[id(n)] = aid
    return out


def nodi_con_immagine(ir: dict):
    """Ogni nodo dell'IR che porta (o potrebbe portare) un campo `image`.

    Serve a togliere gli id rimasti orfani: un'immagine che non e' piu'
    definitiva deve sparire anche dall'IR, altrimenti il player va a cercare
    un file che non c'e'.
    """
    if isinstance(ir.get("cover"), dict):
        yield ir["cover"]
    for chiave in ("characters", "places", "items"):
        for n in ir.get(chiave) or []:
            yield n
    for scena in ir.get("scenes") or []:
        if isinstance(scena.get("background"), dict):
            yield scena["background"]
        for n in scena.get("characters") or []:
            yield n
        for n in scena.get("narration") or []:
            yield n


# ------------------------------------------------------------- conversione

def asset_id(job_id: str) -> str:
    """L'id con cui l'immagine vive dentro la storia.

    E' lo stem del file, cioe' l'id del job reso sicuro per un filesystem:
    la sola differenza pratica e' la `@` delle varianti d'ancora, che diventa
    `_`. Il player lo risolve per convenzione — `assets/images/<id>.webp` — e
    per questo deve essere un nome di file valido, non un id qualunque.
    """
    return generate.safe_stem(job_id)


def convert(src: pathlib.Path, dst: pathlib.Path, *, fmt: str, max_side: int, quality: int):
    """Copia ridimensionata e ricompressa. Senza Pillow, copia e basta."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "copy":
        dst.write_bytes(src.read_bytes())
        return
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit("serve Pillow per convertire in WebP: "
                         "pip install pillow --break-system-packages, "
                         "oppure --format copy")
    with Image.open(src) as im:
        im = im.convert("RGB")
        if max_side and max(im.size) > max_side:
            r = max_side / max(im.size)
            im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
        if fmt == "webp":
            im.save(dst, format="WEBP", quality=quality, method=6)
        elif fmt == "png":
            im.save(dst, format="PNG")
        else:
            raise SystemExit(f"formato sconosciuto: {fmt}")


# ------------------------------------------------------------ pubblicazione

def publish(storia: Storia, *, tutte=False, force=False, dry_run=False, prune=False,
            fmt=DEFAULT_FORMAT, max_side=DEFAULT_MAX_SIDE, quality=DEFAULT_QUALITY) -> dict:
    """Il passo intero. Restituisce il rapporto, che e' anche cio' che lo
    studio mostra nella conferma prima di procedere."""
    storia.check()
    manifest = load_json(storia.manifest_path)
    jobs = {j["id"]: j for j in manifest.get("jobs", [])}
    settings = load_json(storia.settings_path)
    approvate = settings.get("approved") or {}
    ledger = load_json(storia.ledger_path)
    ir = json.loads(storia.ir_path.read_text(encoding="utf-8"))

    ext = "png" if fmt == "png" else ("webp" if fmt == "webp" else None)
    rapporto = {
        "story": ir.get("id"), "dry_run": dry_run,
        "nuove": [], "invariate": [], "aggiornate": [],
        "saltate": [], "rimosse": [], "orfane": [], "errori": [],
        "bytes": 0,
    }

    scelti = list(jobs) if tutte else list(approvate)
    da_pubblicare: dict[str, dict] = {}

    for job_id in scelti:
        job = jobs.get(job_id)
        if job is None:
            rapporto["saltate"].append((job_id, "non e' piu' nel manifest"))
            continue
        src = storia.work / job["file"]
        if not src.is_file():
            rapporto["saltate"].append((job_id, "immagine non generata"))
            continue
        firma = generate.sha256_file(src)
        segno = (approvate.get(job_id) or {}).get("sha256")
        if segno and segno != firma and not force:
            rapporto["saltate"].append(
                (job_id, "approvata e poi rigenerata: riguardala e riapprovala"))
            continue
        node = resolve(ir, job.get("source") or "")
        if node is None:
            rapporto["errori"].append((job_id, f"nell'IR non trovo {job.get('source')}"))
            continue
        problema = coerente(node, job, ir, job.get("source") or "")
        if problema:
            rapporto["errori"].append((job_id, problema + " — rifai il manifest"))
            continue
        da_pubblicare[job_id] = {"job": job, "src": src, "sha": firma, "node": node}

    # I file: si riscrive solo cio' che e' cambiato davvero.
    ledger_nuovo = {}
    for job_id, info in da_pubblicare.items():
        aid = asset_id(job_id)
        dst = storia.images / f"{aid}.{ext or 'png'}"
        vecchio = ledger.get(aid) or {}
        uguale = (vecchio.get("sha256") == info["sha"]
                  and vecchio.get("format") == fmt
                  and vecchio.get("max_side") == max_side
                  and vecchio.get("quality") == quality
                  and dst.is_file())
        esisteva = dst.is_file()
        if uguale:
            rapporto["invariate"].append(aid)
        else:
            if not dry_run:
                convert(info["src"], dst, fmt=fmt, max_side=max_side, quality=quality)
            (rapporto["aggiornate"] if esisteva else rapporto["nuove"]).append(aid)
        if dst.is_file():
            rapporto["bytes"] += dst.stat().st_size
        ledger_nuovo[aid] = {
            "job": job_id, "sha256": info["sha"], "format": fmt,
            "max_side": max_side, "quality": quality,
            "source": info["job"].get("source"),
            "model": (info["job"] or {}).get("model"),
            "at": generate.now_iso(),
        }
        info["asset_id"] = aid

    # L'IR: gli id che ci vanno, e via quelli che non ci vanno piu'.
    voluti = {id(info["node"]): info["asset_id"] for info in da_pubblicare.values()}
    voluti.update(varianti_ripetute(ir, da_pubblicare))
    cambiato = False
    for node in nodi_con_immagine(ir):
        vuole = voluti.get(id(node))
        if vuole:
            if node.get("image") != vuole:
                node["image"] = vuole
                cambiato = True
        elif "image" in node:
            rapporto["rimosse"].append(node.pop("image"))
            cambiato = True

    # File pubblicati che nessuno referenzia piu': si elencano sempre, si
    # cancellano solo se richiesto. Un file non piu' referenziato non fa
    # danno; cancellare per conto proprio in una cartella versionata, si'.
    if storia.images.is_dir():
        attesi = {f"{a}.{ext or 'png'}" for a in ledger_nuovo}
        for f in sorted(storia.images.iterdir()):
            if f.is_file() and f.name not in attesi:
                rapporto["orfane"].append(f.name)
                if prune and not dry_run:
                    f.unlink()

    if not dry_run:
        if cambiato:
            # Stessa formattazione con cui il file e' arrivato: indent 2,
            # niente escape unicode, nessuna riga vuota in fondo. Una
            # pubblicazione non deve produrre un diff di 300.000 righe.
            storia.ir_path.write_text(
                json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")
        write_json(storia.ledger_path, ledger_nuovo)

    rapporto["ir_modificato"] = cambiato
    rapporto["copertura"] = copertura(ir)
    return rapporto


def copertura(ir: dict) -> dict:
    """Quanti nodi dell'IR hanno un'immagine e quanti la aspettano ancora.

    E' la domanda che ci si fa davvero dopo aver pubblicato — «quanto manca?»
    — e non e' deducibile dal numero di file: un'immagine puo' esserci senza
    essere referenziata, e un nodo puo' aspettarla senza che esista.
    """
    con = senza = 0
    for n in nodi_con_immagine(ir):
        vuole = n.get("image_prompt") or n.get("visual_prompt")
        if not vuole:
            continue
        if n.get("image"):
            con += 1
        else:
            senza += 1
    return {"con_immagine": con, "senza_immagine": senza}


def stampa(r: dict):
    def elenco(nome, voci, limite=8):
        if not voci:
            return
        print(f"  {nome}: {len(voci)}")
        for v in voci[:limite]:
            print(f"    {v[0]} — {v[1]}" if isinstance(v, tuple) else f"    {v}")
        if len(voci) > limite:
            print(f"    … e altre {len(voci) - limite}")

    print(("(prova) " if r["dry_run"] else "") + f"storia: {r['story']}")
    print(f"  pubblicate: {len(r['nuove'])} nuove, {len(r['aggiornate'])} aggiornate, "
          f"{len(r['invariate'])} invariate  ({r['bytes'] / 1048576:.1f} MB in totale)")
    elenco("saltate", r["saltate"])
    elenco("errori", r["errori"])
    elenco("id tolti dall'IR", r["rimosse"])
    elenco("file non piu' referenziati", r["orfane"])
    c = r["copertura"]
    print(f"  IR: {c['con_immagine']} nodi con immagine, {c['senza_immagine']} ancora senza"
          + ("" if r["ir_modificato"] or r["dry_run"] else " (IR invariato)"))


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="copia nella storia le immagini approvate e scrive gli id nell'IR")
    ap.add_argument("storia", help="la cartella della storia (stories/<id>)")
    ap.add_argument("--ir", help="percorso dell'IR, se non e' <storia>/story.ir.json")
    ap.add_argument("--work", help="banco di lavoro, se non e' <storia>/_work")
    ap.add_argument("--images", help="destinazione, se non e' <storia>/assets/images")
    ap.add_argument("--all", action="store_true", dest="tutte",
                    help="pubblica tutte le immagini generate, approvate o no")
    ap.add_argument("--force", action="store_true",
                    help="pubblica anche le approvate che sono state rigenerate dopo")
    ap.add_argument("--prune", action="store_true",
                    help="cancella dagli asset i file che nessuno referenzia piu'")
    ap.add_argument("-n", "--dry-run", action="store_true",
                    help="dice cosa farebbe, senza scrivere niente")
    ap.add_argument("--format", default=DEFAULT_FORMAT, choices=("webp", "png", "copy"))
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    ap.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    a = ap.parse_args(argv)

    storia = Storia(a.storia, a.ir, a.work, a.images)
    r = publish(storia, tutte=a.tutte, force=a.force, dry_run=a.dry_run, prune=a.prune,
                fmt=a.format, max_side=a.max_side, quality=a.quality)
    stampa(r)
    return 1 if r["errori"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
