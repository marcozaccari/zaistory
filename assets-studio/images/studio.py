#!/usr/bin/env python3
"""Interfaccia web locale per generare, guardare e rifare gli asset.

Il ciclo di lavoro e' sempre lo stesso — genera, guarda, rifai quelle che non
convincono — ma qui sta in una pagina sola invece che in tre comandi e un
file HTML statico.

Non reimplementa niente: importa `generate.Runner`, quindi reference,
sidecar, cache, controllo dimensione e scala di preferenza sono esattamente
quelli della riga di comando, e le due strade restano intercambiabili.

    python studio.py stories/metal-head/_work/assets_manifest.json \\
        -o stories/metal-head/_work

Poi apri http://127.0.0.1:8765

Il server e' in ascolto solo su localhost: la chiave API sta nel processo, e
le immagini sono roba tua. Dipendenze: solo la stdlib, piu' Pillow per le
miniature (senza, serve le immagini a piena risoluzione).
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import queue
import sys
import threading
import time
import traceback
import socket
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_manifest as estrazione
import generate
import publish as pubblica

SETTINGS_NAME = "_studio.json"
THUMBS_DIR = "_studio_thumbs"
VERSIONS_DIR = "_versions"
RAW_DIR = "_raw"

# Come riportare in squadra un'immagine che il modello ha restituito di
# dimensione diversa da quella chiesta. E' una scelta visiva, quindi si fa
# guardando l'immagine — e non deve costare una rigenerazione: l'originale
# non ritagliato resta in `_raw/`, e cambiare modo e' un'operazione locale.
CROPS = {
    "center":  "ritaglio centrale",
    "start":   "ritaglio dall'alto / da sinistra",
    "end":     "ritaglio dal basso / da destra",
    "fit":     "rimpicciolita intera, bordi riempiti",
    "stretch": "deformata per riempire",
    "none":    "lasciata com'e'",
}
DEFAULT_CROP = "center"


# ------------------------------------------------------------------- stato

class Studio:
    """Lo stato condiviso fra le richieste HTTP e il thread che genera.

    Una coda sola e un lavoratore solo: le richieste all'API costano molto
    piu' del disegno, e mandarne dieci in parallelo dal browser sarebbe il
    modo piu' rapido di farsi limitare la banda dal fornitore. Chi vuole
    parallelismo usa la CLI con --jobs.
    """

    def __init__(self, manifest_path: pathlib.Path, outdir: pathlib.Path, key: str | None,
                 story: pathlib.Path | None = None):
        self.manifest_path = manifest_path
        self.outdir = outdir
        # La cartella della storia: la destinazione della pubblicazione. Per
        # convenzione il banco di lavoro sta dentro di lei (`<storia>/_work`),
        # quindi quasi sempre si ricava da sola.
        self.story = story or (outdir.parent if outdir.name == pubblica.WORK_DIR else None)
        self.key = key
        # sha256 per file, invalidato da mtime e dimensione: serve a sapere se
        # un'immagine approvata e' stata rigenerata dopo, e la pagina lo chiede
        # ogni due secondi e mezzo. Ricalcolarlo a ogni giro sarebbe rileggere
        # cinquanta megabyte per niente.
        self._sha: dict[tuple, str] = {}
        self.registry = generate.load_registry()
        self.lock = threading.Lock()
        self.queue: queue.Queue = queue.Queue()
        self.pending: list[dict] = []      # in attesa, in ordine
        self.current: dict | None = None
        self.log: list[dict] = []          # esiti, i piu' recenti in testa
        # Evento "in marcia": il lavoratore lo aspetta PRIMA di prendere il
        # task successivo, quindi la pausa non interrompe mai una chiamata a
        # meta' — un'immagine gia' pagata verrebbe persa.
        self.running = threading.Event(); self.running.set()
        self.reload_manifest()
        self.settings = self._load_settings()
        threading.Thread(target=self._worker, daemon=True).start()

    # ---- manifest e impostazioni

    def reload_manifest(self):
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.jobs = {j["id"]: j for j in self.manifest["jobs"]}
        self.disallineato = self._disallineato()

    def _disallineato(self) -> dict:
        """Cosa l'IR chiede oggi che il manifest non ha, e viceversa.

        Il manifest e' una fotografia dell'IR presa una volta, e da allora l'IR
        cambia: si aggiunge una copertina, si spezza una scena, si toglie un
        personaggio. Finora l'unico a saperlo era `publish.py`, che si ferma
        quando i `source` non tornano piu' — ma quello e' l'ultimo passo, e nel
        frattempo lo studio mostrava serenamente un elenco vecchio. Il sintomo,
        visto da fuori, e' indistinguibile da uno studio rotto: «l'IR ha una
        copertina e qui non c'e'».

        Si ricava rifacendo l'estrazione in memoria e confrontando i soli id.
        Costa una lettura dell'IR e un po' di aritmetica — nessuna rete, niente
        spesa — e si fa una volta per caricamento del manifest.
        """
        vuoto = {"mancanti": [], "avanzati": []}
        ir_path = None
        if self.story and (self.story / "story.ir.json").is_file():
            ir_path = self.story / "story.ir.json"
        elif self.manifest.get("ir_file"):
            candidato = pathlib.Path(self.manifest["ir_file"])
            if candidato.is_file():
                ir_path = candidato
        if ir_path is None:
            return vuoto
        try:
            ir = json.loads(ir_path.read_text(encoding="utf-8"))
            ex = estrazione.Extractor(ir, str(ir_path),
                                      dict(self.manifest.get("defaults") or {}),
                                      dict(self.manifest.get("models") or {}))
            ex.collect_anchors()
            ex.collect_shots()
        except Exception:
            # Un IR spostato o illeggibile non e' un motivo per non aprire lo
            # studio: le immagini gia' generate restano quelle.
            return vuoto
        adesso = set(ex.anchors) | {j["id"] for j in ex.shots}
        prima = set(self.jobs)
        return {"mancanti": sorted(adesso - prima), "avanzati": sorted(prima - adesso)}

    def _settings_path(self) -> pathlib.Path:
        return self.outdir / SETTINGS_NAME

    def _load_settings(self) -> dict:
        base = dict(self.manifest.get("models") or {})
        path = self._settings_path()
        if path.is_file():
            try:
                base.update(json.loads(path.read_text(encoding="utf-8")))
            except ValueError:
                pass
        return base

    def save_settings(self, data: dict):
        # `approved` e `crop` non passano da qui: hanno i loro endpoint, e un
        # POST generico che potesse riscrivere in blocco le approvazioni
        # sarebbe il modo piu' rapido di perderle tutte.
        allowed = {k: v for k, v in data.items()
                   if k in ("anchors", "shots", "crop_default") and v}
        with self.lock:
            self.settings.update(allowed)
            self._settings_path().write_text(
                json.dumps(self.settings, ensure_ascii=False, indent=2),
                encoding="utf-8")
        return self.settings

    def sha(self, path: pathlib.Path) -> str | None:
        if not path.is_file():
            return None
        st = path.stat()
        chiave = (str(path), st.st_mtime_ns, st.st_size)
        got = self._sha.get(chiave)
        if got is None:
            got = generate.sha256_file(path)
            self._sha = {k: v for k, v in self._sha.items() if k[0] != str(path)}
            self._sha[chiave] = got
        return got

    # ---- approvazione

    def approvals(self) -> dict:
        return self.settings.get("approved") or {}

    def approve(self, ids: list[str], value: bool) -> dict:
        """Marca (o smarca) immagini come definitive.

        L'approvazione registra l'**hash del file approvato**, non solo il
        suo id: e' quello che permette di accorgersi che un'immagine e' stata
        rigenerata dopo essere stata approvata. Senza, un clic su «rigenera»
        farebbe passare in pubblicazione un'immagine che nessuno ha guardato.
        """
        toccati = []
        with self.lock:
            appr = dict(self.approvals())
            for job_id in ids:
                job = self.jobs.get(job_id)
                if job is None:
                    continue
                if value:
                    firma = self.sha(self.outdir / job["file"])
                    if not firma:                 # non generata: niente da approvare
                        continue
                    appr[job_id] = {"at": generate.now_iso(), "sha256": firma}
                else:
                    appr.pop(job_id, None)
                toccati.append(job_id)
            self.settings["approved"] = appr
            self._settings_path().write_text(
                json.dumps(self.settings, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "toccati": toccati, "approvate": len(self.approvals())}

    # ---- pubblicazione

    def storia(self) -> pubblica.Storia | None:
        return pubblica.Storia(self.story) if self.story else None

    def publish(self, dry_run: bool = True, prune: bool = False) -> dict:
        st = self.storia()
        if st is None:
            raise ValueError(
                "non so in quale storia pubblicare: lancia lo studio con -o "
                "<storia>/_work, oppure passa --story")
        return pubblica.publish(st, dry_run=dry_run, prune=prune)

    def ledger(self) -> dict:
        st = self.storia()
        return pubblica.load_json(st.ledger_path) if st else {}

    def model_for(self, job: dict) -> str:
        """Il modello con cui questo job verrebbe generato adesso.

        Le impostazioni della pagina hanno la precedenza sul manifest: cosi'
        si cambia il default senza rigenerare il manifest, che e' proprio la
        cosa che si vuole poter fare guardando i risultati.
        """
        key = "anchors" if job["level"] == "anchor" else "shots"
        return self.settings.get(key) or job.get("model") or "zimage"

    # ---- lettura dello stato per la pagina

    def sidecar(self, job: dict) -> dict | None:
        path = generate.sidecar_path(self.outdir / job["file"])
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return None

    def job_view(self, job: dict, ledger: dict | None = None) -> dict:
        out = self.outdir / job["file"]
        side = self.sidecar(job)
        used = (side or {}).get("model")
        atteso = self.model_for(job)
        # Definitiva, definitiva-ma-cambiata, pubblicata: tre stati diversi e
        # tenuti distinti. Il secondo e' il solo che chiede qualcosa a chi
        # guarda — riguardarla — ed e' anche l'unico che senza l'hash non si
        # potrebbe vedere.
        firma = self.sha(out)
        appr = self.approvals().get(job["id"])
        registro = (ledger if ledger is not None else self.ledger()).get(
            pubblica.asset_id(job["id"]))
        return {
            "id": job["id"],
            "level": job["level"],
            "kind": job["kind"],
            "name": job.get("name") or job.get("scene_title") or job.get("scene"),
            "file": job["file"] if out.exists() else None,
            "deps": job.get("deps") or [],
            "seed": job.get("seed"),
            "size": f'{job["width"]}x{job["height"]}',
            "model_used": used,
            "model_next": self.model_for(job),
            "upgrade_to": generate.next_model(self.registry["preference"], used) if used else None,
            "stale_model": bool(used and used != atteso),
            "seconds": (side or {}).get("api", {}).get("seconds"),
            "generated_at": (side or {}).get("generated_at"),
            "size_warning": (side or {}).get("api", {}).get("size_warning"),
            "prompt": (side or {}).get("prompt") or job.get("prompt_ref") or job["prompt"],
            "refs": [r["anchor"] for r in (side or {}).get("refs", [])],
            "versions": self.versions(job),
            "crop": self.crop_mode(job),
            "raw_size": self._raw_size(job),
            "cost": self.registry["costs"].get(used) if used else None,
            "approved": bool(appr),
            "approved_at": (appr or {}).get("at"),
            "approval_stale": bool(appr and firma and appr.get("sha256") != firma),
            "published": bool(registro),
            "published_stale": bool(registro and firma and registro.get("sha256") != firma),
        }

    def _raw_size(self, job: dict) -> str | None:
        """La dimensione com'e' arrivata dal modello, se diversa da quella
        chiesta: e' l'unica cosa che dice se il ritaglio serve davvero."""
        raw = self._raw_path(job)
        if not raw.is_file():
            return None
        try:
            from PIL import Image
            with Image.open(raw) as im:
                got = f"{im.width}x{im.height}"
        except Exception:
            return None
        return got if got != f'{job["width"]}x{job["height"]}' else None

    def state(self) -> dict:
        with self.lock:
            pending = [p["id"] for p in self.pending]
            current = dict(self.current) if self.current else None
            log = list(self.log[:60])
        registro = self.ledger()
        jobs = [self.job_view(j, registro) for j in self.manifest["jobs"]]
        fatti = sum(1 for j in jobs if j["file"])
        speso = sum(j["cost"] or 0 for j in jobs if j["file"])
        return {
            "story": self.manifest.get("title") or self.manifest.get("story_id"),
            "story_dir": str(self.story) if self.story else None,
            "disallineato": self.disallineato,
            "jobs": jobs,
            "settings": self.settings,
            "preference": self.registry["preference"],
            "crops": CROPS,
            "costs": self.registry["costs"],
            "queue": {"pending": pending, "current": current, "log": log,
                      "paused": not self.running.is_set()},
            "totals": {"jobs": len(jobs), "done": fatti, "spent": round(speso, 3),
                       "approved": sum(1 for j in jobs if j["approved"]),
                       "stale": sum(1 for j in jobs if j["approval_stale"]),
                       "published": sum(1 for j in jobs if j["published"]),
                       "todo_cost": round(sum(self.registry["costs"].get(
                           self.model_for(self.jobs[j["id"]]), 0)
                           for j in jobs if not j["file"]), 3)},
        }

    # ---- coda

    def enqueue(self, ids: list[str], model: str | None = None,
                upgrade: bool = False, seed: int | None = None) -> dict:
        # Un'inquadratura non si puo' generare senza i FILE delle sue ancore.
        # Da riga di comando l'ordine dei livelli lo garantiva; qui si clicca
        # quello che si vuole, quindi le dipendenze mancanti si accodano
        # davanti da sole invece di far fallire il lavoro.
        ids_richiesti = set(ids)
        espanso, visti = [], set()
        for job_id in ids:
            job = self.jobs.get(job_id)
            if job:
                for dep in job.get("deps") or []:
                    dj = self.jobs.get(dep)
                    if dj and dep not in visti and not (self.outdir / dj["file"]).exists():
                        espanso.append(dep)
                        visti.add(dep)
            if job_id not in visti:
                espanso.append(job_id)
                visti.add(job_id)
        ids = espanso

        accodati, rifiutati = [], []
        with self.lock:
            gia = {p["id"] for p in self.pending} | (
                {self.current["id"]} if self.current else set())
            for job_id in ids:
                job = self.jobs.get(job_id)
                if job is None:
                    rifiutati.append((job_id, "job inesistente"))
                    continue
                if job_id in gia:
                    rifiutati.append((job_id, "gia' in coda"))
                    continue
                scelto = model
                if upgrade and job_id not in ids_richiesti:
                    scelto = None          # dipendenza: modello di default
                elif upgrade:
                    side = self.sidecar(job)
                    used = (side or {}).get("model") or self.model_for(job)
                    scelto = generate.next_model(self.registry["preference"], used)
                    if scelto is None:
                        rifiutati.append((job_id, f"'{used}' e' gia' in cima alla scala"))
                        continue
                task = {"id": job_id, "model": scelto or self.model_for(job),
                        "seed": seed, "upgrade": upgrade}
                self.pending.append(task)
                gia.add(job_id)
                accodati.append(task)
        for t in accodati:
            self.queue.put(t)
        return {"accodati": accodati, "rifiutati": rifiutati}

    # ---- ritaglio

    def _raw_path(self, job: dict) -> pathlib.Path:
        return self.outdir / RAW_DIR / (generate.safe_stem(job["id"]) + ".png")

    def crop_mode(self, job: dict) -> str:
        return (self.settings.get("crop") or {}).get(job["id"]) or \
            self.settings.get("crop_default") or DEFAULT_CROP

    def set_crop(self, job_id: str, mode: str) -> dict:
        if mode not in CROPS:
            raise ValueError(f"modo di ritaglio sconosciuto: {mode}")
        job = self.jobs.get(job_id)
        if job is None:
            raise ValueError(f"job inesistente: {job_id}")
        with self.lock:
            self.settings.setdefault("crop", {})[job_id] = mode
            self._settings_path().write_text(
                json.dumps(self.settings, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"mode": mode, "applied": self.apply_crop(job)}

    def apply_crop(self, job: dict) -> bool:
        """Riscrive l'immagine corrente partendo dall'originale non ritagliato.

        Non chiama nessuna API: e' aritmetica su un file gia' pagato, quindi
        si puo' cambiare idea sul ritaglio quante volte si vuole.
        """
        raw = self._raw_path(job)
        cur = self.outdir / job["file"]
        src = raw if raw.is_file() else cur
        if not src.is_file():
            return False
        try:
            from PIL import Image
        except ImportError:
            return False
        w, h, mode = job["width"], job["height"], self.crop_mode(job)
        with Image.open(src) as im:
            im = im.convert("RGB")
            if mode == "none" or im.size == (w, h):
                out = im.copy()
            elif mode == "stretch":
                out = im.resize((w, h), Image.LANCZOS)
            elif mode == "fit":
                r = min(w / im.width, h / im.height)
                piccola = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
                # I bordi prendono il colore medio del perimetro: su un fondo
                # piatto sparisce, e non inventa un nero che non c'e'.
                bordo = list(im.crop((0, 0, im.width, 1)).getdata()) + \
                        list(im.crop((0, im.height - 1, im.width, im.height)).getdata())
                med = tuple(sum(c[i] for c in bordo) // len(bordo) for i in range(3))
                out = Image.new("RGB", (w, h), med)
                out.paste(piccola, ((w - piccola.width) // 2, (h - piccola.height) // 2))
            else:
                target, iw, ih = w / h, im.width, im.height
                if iw / ih > target:                      # troppo larga
                    nw = round(ih * target)
                    x = 0 if mode == "start" else (iw - nw if mode == "end" else (iw - nw) // 2)
                    box = (x, 0, x + nw, ih)
                else:                                     # troppo alta
                    nh = round(iw / target)
                    y = 0 if mode == "start" else (ih - nh if mode == "end" else (ih - nh) // 2)
                    box = (0, y, iw, y + nh)
                out = im.crop(box).resize((w, h), Image.LANCZOS)
            cur.parent.mkdir(parents=True, exist_ok=True)
            out.save(cur, format="PNG")
        side = generate.sidecar_path(cur)
        if side.is_file():
            try:
                doc = json.loads(side.read_text(encoding="utf-8"))
                doc.setdefault("api", {})["crop_mode"] = mode
                side.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
            except ValueError:
                pass
        return True

    # ---- storico

    def _versions_dir(self, job: dict) -> pathlib.Path:
        return self.outdir / VERSIONS_DIR / generate.safe_stem(job["id"])

    def archive(self, job: dict) -> str | None:
        """Sposta l'immagine attuale nello storico, prima di sovrascriverla.

        Il percorso canonico — quello che il manifest dichiara e che la
        pipeline e il player consumano — resta sempre lo stesso file: lo
        storico e' un deposito a lato, non un rinominare in giro. Cosi'
        rigenerare non distrugge niente e si puo' tornare indietro.
        """
        cur = self.outdir / job["file"]
        if not cur.is_file():
            return None
        side = generate.sidecar_path(cur)
        modello = "ignoto"
        if side.is_file():
            try:
                modello = json.loads(side.read_text(encoding="utf-8")).get("model", modello)
            except ValueError:
                pass
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(cur.stat().st_mtime))
        dest_dir = self._versions_dir(job)
        dest_dir.mkdir(parents=True, exist_ok=True)
        base = f"{stamp}-{generate.safe_stem(modello)}"
        n, dest = 1, dest_dir / (base + cur.suffix)
        while dest.exists():
            n += 1; dest = dest_dir / f"{base}-{n}{cur.suffix}"
        cur.replace(dest)
        if side.is_file():
            side.replace(generate.sidecar_path(dest))
        return dest.relative_to(self.outdir).as_posix()

    def versions(self, job: dict) -> list[dict]:
        d = self._versions_dir(job)
        if not d.is_dir():
            return []
        out = []
        for f in sorted(d.glob("*.png"), reverse=True):
            side = generate.sidecar_path(f)
            meta = {}
            if side.is_file():
                try:
                    meta = json.loads(side.read_text(encoding="utf-8"))
                except ValueError:
                    pass
            out.append({
                "file": f.relative_to(self.outdir).as_posix(),
                "model": meta.get("model") or f.stem.split("-", 2)[-1],
                "at": meta.get("generated_at") or time.strftime(
                    "%Y-%m-%d %H:%M", time.localtime(f.stat().st_mtime)),
                "seed": meta.get("seed"),
                "cost": self.registry["costs"].get(meta.get("model")),
            })
        return out

    def restore(self, job_id: str, version: str) -> dict:
        """Rimette in uso una versione dello storico.

        E' uno **scambio**, non una copia: quella attuale entra nello storico e
        quella scelta ne esce. Copiandola invece di spostarla, la stessa
        immagine restava in due posti — in uso e in archivio — e ogni
        ripensamento aggiungeva una voce allo storico: andare avanti e
        indietro fra due tentativi ne produceva quattro, tutti uguali a due a
        due, e a quel punto lo storico non si legge piu'.

        Quella attuale non si perde comunque: e' in archivio, e ci si torna
        con lo stesso comando.
        """
        job = self.jobs.get(job_id)
        if job is None:
            raise ValueError(f"job inesistente: {job_id}")
        src = (self.outdir / version).resolve()
        if not str(src).startswith(str(self._versions_dir(job).resolve())) or not src.is_file():
            raise ValueError("versione inesistente per questo job")
        self.archive(job)
        cur = self.outdir / job["file"]
        cur.parent.mkdir(parents=True, exist_ok=True)
        s_src = generate.sidecar_path(src)
        # `replace` e non copia: stesso filesystem, quindi e' una rinomina —
        # atomica, e non duplica i byte di un'immagine gia' pagata. Il tempo di
        # modifica se lo porta dietro, cosi' quando tornera' in archivio ci
        # tornera' con la sua data e non con quella di oggi.
        src.replace(cur)
        if s_src.is_file():
            s_src.replace(generate.sidecar_path(cur))
        with self.lock:
            self.log.insert(0, {"id": job_id, "model": "(storico)", "ok": True,
                                "seconds": 0, "at": generate.now_iso(),
                                "note": f"ripristinata {pathlib.Path(version).name}"})
        return {"ok": True, "file": job["file"]}

    def purge(self) -> dict:
        """Cancella tutte le immagini generate e le loro cache.

        Tocca solo cio' che il manifest dichiara piu' le due cartelle di
        cache: il manifest stesso, il prototipo in `_proto/` e le scelte in
        `rejected.json` restano dove sono. Cancellare a tappeto la cartella
        di output sarebbe piu' corto e molto peggio.
        """
        if self.current or self.pending:
            raise RuntimeError("c'e' del lavoro in corso: aspetta che la coda si svuoti")
        immagini = sidecar = 0
        for job in self.manifest["jobs"]:
            out = self.outdir / job["file"]
            side = generate.sidecar_path(out)
            if out.is_file():
                out.unlink(); immagini += 1
            if side.is_file():
                side.unlink(); sidecar += 1
        cache = 0
        for d in (THUMBS_DIR, "_refs", VERSIONS_DIR, RAW_DIR):
            base = self.outdir / d
            if base.is_dir():
                for f in base.rglob("*"):
                    if f.is_file():
                        f.unlink(); cache += 1
        with self.lock:
            self.log.insert(0, {"id": "(tutte)", "model": "-", "ok": True,
                                "seconds": 0, "at": generate.now_iso(),
                                "note": f"eliminate {immagini} immagini"})
        return {"immagini": immagini, "sidecar": sidecar, "cache": cache}

    def _runner_for(self, task: dict) -> generate.Runner:
        args = argparse.Namespace(
            level="all", jobs=1, model=task["model"], seed=task.get("seed"),
            redo=[task["id"]], force=True, no_refs=False,
            ref_format="webp", ref_max_side=768, ref_quality=82,
            # Lo studio NON fa ritagliare a generate.py: si tiene il grezzo
            # in `_raw/` e ritaglia per conto suo, cosi' cambiare modo dopo
            # non richiede di rigenerare (e ripagare) l'immagine.
            dry_run=False, fix_size=False, key=self.key)
        return generate.Runner(self.manifest, self.outdir,
                               generate.Pollinations(self.key), args)

    def control(self, action: str) -> dict:
        """pausa / riprendi / svuota la coda.

        `svuota` toglie gli arretrati ma **non** ferma il lavoro in corso:
        una richiesta HTTP gia' partita e' gia' pagata, e interromperla
        butterebbe via l'immagine senza far risparmiare niente.
        """
        tolti = 0
        if action == "pause":
            self.running.clear()
        elif action == "resume":
            self.running.set()
        elif action == "clear":
            with self.lock:
                tolti = len(self.pending)
                self.pending.clear()
            while True:
                try:
                    self.queue.get_nowait(); self.queue.task_done()
                except queue.Empty:
                    break
        else:
            raise ValueError(f"azione sconosciuta: {action}")
        return {"paused": not self.running.is_set(), "rimossi": tolti}

    def _worker(self):
        while True:
            self.running.wait()
            try:
                task = self.queue.get(timeout=0.5)
            except queue.Empty:
                continue
            with self.lock:
                vivo = any(p["id"] == task["id"] for p in self.pending)
            if not vivo:                      # svuotata mentre aspettavamo
                self.queue.task_done()
                continue
            with self.lock:
                self.pending = [p for p in self.pending if p["id"] != task["id"]]
                self.current = dict(task, started=time.time())
            esito = {"id": task["id"], "model": task["model"], "at": generate.now_iso()}
            t0 = time.time()
            try:
                job = self.jobs[task["id"]]
                self.archive(job)          # la precedente non va persa
                runner = self._runner_for(task)
                _, _, meta = runner.run_job(job)
                cur = self.outdir / job["file"]
                if cur.is_file():
                    raw = self._raw_path(job)
                    raw.parent.mkdir(parents=True, exist_ok=True)
                    raw.write_bytes(cur.read_bytes())     # il grezzo, per i ritagli futuri
                    self.apply_crop(job)
                esito.update(ok=True, seconds=round(time.time() - t0, 1),
                             note=meta.get("note") or meta.get("endpoint", ""))
            except Exception as exc:                       # rete, 4xx, 5xx
                esito.update(ok=False, seconds=round(time.time() - t0, 1),
                             note=str(exc)[:300])
                traceback.print_exc()
            with self.lock:
                self.current = None
                self.log.insert(0, esito)
            self.queue.task_done()

    # ---- miniature

    def thumb(self, rel: str, side: int = 360) -> tuple[bytes, str] | None:
        src = (self.outdir / rel).resolve()
        if not str(src).startswith(str(self.outdir.resolve())) or not src.is_file():
            return None
        try:
            from PIL import Image
        except ImportError:
            return src.read_bytes(), "image/png"
        cache = self.outdir / THUMBS_DIR / (rel.replace("/", "__") + f".{side}.webp")
        if cache.is_file() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache.read_bytes(), "image/webp"
        with Image.open(src) as im:
            im = im.convert("RGB")
            if max(im.size) > side:
                r = side / max(im.size)
                im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=82)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(buf.getvalue())
        return buf.getvalue(), "image/webp"


# -------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    studio: Studio = None            # iniettato da serve()

    def log_message(self, *a):       # niente rumore a ogni polling
        pass

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        if path in ("/", "/index.html"):
            return self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        if path == "/api/state":
            return self._json(self.studio.state())
        if path.startswith("/thumb/"):
            rel = urllib.parse.unquote(path[len("/thumb/"):])
            got = self.studio.thumb(rel)
            return self._send(200, got[0], got[1]) if got else self._json(
                {"error": "non trovata"}, 404)
        if path.startswith("/img/"):
            rel = urllib.parse.unquote(path[len("/img/"):])
            src = (self.studio.outdir / rel).resolve()
            if not str(src).startswith(str(self.studio.outdir.resolve())) or not src.is_file():
                return self._json({"error": "non trovata"}, 404)
            return self._send(200, src.read_bytes(), "image/png")
        return self._json({"error": "endpoint sconosciuto"}, 404)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json({"error": "JSON non valido"}, 400)
        if url.path == "/api/generate":
            if not self.studio.key:
                return self._json({"error": "nessuna chiave API: esporta "
                                            "POLLINATIONS_API_KEY o usa assets-studio/.profile"}, 400)
            return self._json(self.studio.enqueue(
                data.get("ids") or [], data.get("model"),
                bool(data.get("upgrade")), data.get("seed")))
        if url.path == "/api/crop":
            try:
                return self._json(self.studio.set_crop(data.get("id"), data.get("mode")))
            except ValueError as exc:
                return self._json({"error": str(exc)}, 400)
        if url.path == "/api/restore":
            try:
                return self._json(self.studio.restore(data.get("id"), data.get("version")))
            except ValueError as exc:
                return self._json({"error": str(exc)}, 400)
        if url.path == "/api/queue":
            try:
                return self._json(self.studio.control(data.get("action", "")))
            except ValueError as exc:
                return self._json({"error": str(exc)}, 400)
        if url.path == "/api/purge":
            try:
                return self._json(self.studio.purge())
            except RuntimeError as exc:
                return self._json({"error": str(exc)}, 409)
        if url.path == "/api/approve":
            return self._json(self.studio.approve(
                data.get("ids") or [], bool(data.get("value", True))))
        if url.path == "/api/publish":
            try:
                return self._json(self.studio.publish(
                    bool(data.get("dry_run", True)), bool(data.get("prune"))))
            except ValueError as exc:
                return self._json({"error": str(exc)}, 400)
        if url.path == "/api/settings":
            return self._json(self.studio.save_settings(data))
        if url.path == "/api/reload":
            self.studio.reload_manifest()
            return self._json({"ok": True, "jobs": len(self.studio.jobs)})
        return self._json({"error": "endpoint sconosciuto"}, 404)


PAGE = r"""<!doctype html><html lang="it"><meta charset="utf-8">
<title>Studio asset</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
/* Una palette sola, scura: qui si guardano immagini per ore, e un fondo
   chiaro intorno a un'inquadratura ne cambia la lettura — la stessa ragione
   per cui i visori di foto sono tutti scuri. Il tema chiaro non era una
   seconda pelle, era un secondo prodotto da riprovare a ogni modifica. */
:root{color-scheme:dark;--bg:#141413;--fg:#eee;--mut:#9a9a96;
      --line:#2b2b29;--card:#1c1c1a;--acc:#7fc4a0;--warn:#d9a441;--bad:#e08a8a;
      /* L'arancione e' il colore della spesa: lo porta ogni bottone che fa
         partire una generazione, e nessun altro. Guardando la pagina si deve
         poter dire quali tasti costano senza leggerli. */
      --spesa:#e08a3c;--pub:#5b8dd9;--altro:#e58fc4;--aside:460px}
*{box-sizing:border-box}
/* Una schermata sola: comandi fermi in alto, e a scorrere sono soltanto le
   miniature. Prima scorreva tutto — filtro e controlli della coda sparivano
   verso l'alto proprio mentre servivano, cioe' mentre si guardava la
   quarantesima immagine. */
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);overflow:hidden;
     display:grid;grid-template-rows:auto minmax(0,1fr);
     font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
header{z-index:5;background:var(--bg);border-bottom:1px solid var(--line);
       padding:10px 20px;display:flex;flex-direction:column;gap:8px}
header .riga{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:16px;margin:0;font-weight:650}
.sp{flex:1}
select,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);
       border-radius:7px;padding:5px 10px;cursor:pointer}
button:hover{border-color:var(--mut)}
button.primary{background:var(--acc);border-color:var(--acc);color:#141413;font-weight:600}
button.spesa{background:var(--spesa);border-color:var(--spesa);color:#141413;font-weight:600}
button.spesa:hover{border-color:#f0a45c;background:#f0a45c}
/* Il blu della pubblicazione: non spende e non genera, porta fuori — dal
   banco di lavoro alla storia. Un terzo colore perche' e' un terzo tipo di
   azione, e in una fila di tasti la mano lo trova prima di leggerlo. */
button.pub{background:var(--pub);border-color:var(--pub);color:#0d1220;font-weight:600}
button.pub:hover{border-color:#7aa6ea;background:#7aa6ea}
button.pub:disabled{background:none;color:inherit;border-color:var(--line)}
/* Il manifest non combacia piu' con l'IR. Non e' un errore da cui fermarsi —
   le immagini gia' generate restano quelle — ma va detto forte: e' la
   differenza fra «lo studio e' rotto» e «il manifest e' vecchio». */
.avviso{background:rgba(224,178,92,.12);border-top:1px solid var(--warn);
    color:var(--warn);font-size:13px;line-height:1.5;align-items:flex-start}
.avviso code{background:rgba(0,0,0,.28);padding:1px 6px;border-radius:5px;
    font-size:12px;user-select:all}
/* Un lavoro in corso: il tasto resta acceso ma respira, e non si preme.
   Convertire ottantotto immagini in WebP non e' istantaneo, e un tasto che
   torna com'era senza che succeda niente si preme una seconda volta. */
button.inCorso,button.pub.inCorso{background:var(--pub);border-color:var(--pub);
   color:#0d1220;opacity:.9;cursor:progress;animation:pulsa 1.1s ease-in-out infinite}
@keyframes pulsa{50%{opacity:.5}}
button.danger{color:var(--bad);border-color:var(--line)}
button.danger:hover{border-color:var(--bad)}
button:disabled{opacity:.45;cursor:default}
label{font-size:12px;color:var(--mut)}
main{overflow-y:auto;padding:16px 20px 40px}
.bar{gap:14px;font-size:12px;color:var(--mut)}
#qinfo:not(:empty)::before{content:'·';margin-right:14px;color:var(--line)}
.bar .sp{flex:1}
.paused{color:var(--warn);font-weight:600}
.warn{color:var(--warn);font-size:11px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.card{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--card);
      cursor:pointer;position:relative}
.card.sel{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc) inset}
.card .ph{aspect-ratio:1;display:grid;place-items:center;color:var(--mut);font-size:11px;
      background:repeating-linear-gradient(45deg,transparent,transparent 7px,var(--line) 7px,var(--line) 8px)}
.card img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.meta{padding:7px 9px;font-size:11px;font-family:ui-monospace,monospace;color:var(--mut);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta b{color:var(--fg);font-weight:600}
.tag{position:absolute;top:6px;right:6px;font-size:10px;padding:2px 6px;border-radius:20px;
     background:var(--card);border:1px solid var(--line);cursor:help;
     max-width:88%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag.w{color:var(--warn);border-color:var(--warn)}
.tag.q{color:var(--acc);border-color:var(--acc)}
/* Il rosa e' «generata con un altro modello»: non e' un guaio come il
   ritaglio — l'immagine sta benissimo — e' solo un'altra cosa, e va vista
   come tale scorrendo la griglia. */
.tag.m{color:var(--altro);border-color:var(--altro)}
/* Il segno di «definitiva» sta in alto a sinistra: le etichette di stato
   stanno a destra e la didascalia in basso, e sono informazioni diverse —
   cos'e' successo all'immagine, e cosa ne hai deciso tu. */
.ok{position:absolute;left:6px;top:6px;width:22px;height:22px;border-radius:50%;
    display:grid;place-items:center;font-size:13px;font-weight:700;
    background:var(--acc);color:#141413;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.ok.stale{background:var(--warn)}
.card.appr{border-color:var(--acc)}
button.ok{position:static;width:auto;height:auto;border-radius:7px;padding:5px 10px;
    border:1px solid var(--acc);font-weight:600;display:inline-block}
aside{position:fixed;right:0;top:0;bottom:0;width:min(var(--aside),92vw);background:var(--card);
      border-left:1px solid var(--line);padding:18px;overflow:auto;z-index:10;
      box-shadow:-8px 0 30px rgba(0,0,0,.35)}
/* Su schermo largo il pannello non copre: **restringe**. Sopra i thumbnail
   nascondeva proprio le immagini con cui si sta confrontando quella aperta —
   ed e' quello il lavoro: guardarne una accanto alle altre. Copriva anche i
   tasti in alto a destra, che con il pannello aperto diventavano
   impremibili. Sotto la soglia resta sopra: li' non c'e' spazio per due
   colonne, e restringere vorrebbe dire una miniatura per riga. */
@media(min-width:900px){
  body.con-pannello header,
  body.con-pannello main{padding-right:calc(var(--aside) + 20px)}
}
aside img{width:100%;border-radius:8px;border:1px solid var(--line)}
aside h2{font-size:14px;font-family:ui-monospace,monospace;margin:0 0 2px;word-break:break-all}
dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin:12px 0}
dt{color:var(--mut)} dd{margin:0;font-family:ui-monospace,monospace}
pre{white-space:pre-wrap;font-size:11px;color:var(--mut);border-left:2px solid var(--line);
    padding-left:9px;margin:8px 0 0}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.logline{font-size:11px;font-family:ui-monospace,monospace;padding:2px 0;color:var(--mut)}
.logline.bad{color:var(--bad)}
/* Il popup a schermo intero. Nel pannello l'immagine sta in una colonna da
   460px: va bene per riconoscerla, non per giudicarla — e giudicarla e'
   l'unica cosa che si fa in questa pagina. Un clic la apre grande quanto lo
   schermo, un clic la chiude. */
.lb{position:fixed;inset:0;z-index:30;display:none;place-items:center;padding:12px;
    background:rgba(8,8,7,.96);cursor:zoom-out}
.lb.on{display:grid}
.lb img{max-width:100%;max-height:calc(100vh - 76px);object-fit:contain;border-radius:4px}
.lbx{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;
     border:0;background:rgba(255,255,255,.14);color:#fff;font-size:17px;cursor:pointer}
.lbx:hover{background:rgba(255,255,255,.26)}
.lbcap{position:absolute;left:0;right:0;bottom:0;padding:10px 16px;text-align:center;
       font-family:ui-monospace,monospace;font-size:12px;color:rgba(255,255,255,.72);
       background:linear-gradient(transparent,rgba(8,8,7,.85) 40%)}
.vers{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}
.ver img{width:100%;border-radius:6px;border:1px solid var(--line);cursor:zoom-in;display:block}
.ver button{width:100%;margin-top:4px;font-size:11px;padding:3px}
</style>
<header>
  <div class="riga">
    <h1 id="story">Studio asset</h1>
    <label>ancore <select id="mAnchors"></select></label>
    <label>inquadrature <select id="mShots"></select></label>
    <span class="sp"></span>
    <button id="genMissing" class="spesa">Genera le mancanti</button>
    <button id="publish" class="pub">Pubblica nella storia</button>
    <button id="purge" class="danger">Elimina tutte</button>
  </div>
  <div class="riga bar">
    <label>mostra <select id="filter">
      <option value="all">tutte</option>
      <option value="missing">solo mancanti</option>
      <option value="anchor">solo ancore</option>
      <option value="shot">solo inquadrature</option>
      <option value="stale">modello diverso dal default</option>
      <option value="approved">solo definitive</option>
      <option value="toreview">generate, ancora da decidere</option>
      <option value="changed">definitive poi rigenerate</option>
      <option value="unpublished">definitive non ancora pubblicate</option>
    </select></label>
    <span id="totals" class="logline"></span>
    <span id="qinfo"></span>
    <span class="sp"></span>
    <button id="qPause"></button>
    <button id="qClear" class="danger">Svuota la coda</button>
  </div>
  <div class="riga avviso" id="disallineato" hidden></div>
</header>
<main>
  <div class="grid" id="grid"></div>
</main>
<aside id="panel" hidden></aside>
<div class="lb" id="lb"><img id="lbimg" alt=""><button class="lbx" id="lbx"
  aria-label="chiudi">✕</button><div class="lbcap" id="lbcap"></div></div>
<script>
let S = null, sel = null, bust = 0;
// Vero mentre una pubblicazione e' in volo. Serve al polling, che ogni due
// secondi e mezzo riabiliterebbe il tasto proprio mentre il server sta
// scrivendo.
let pubblicando = false;

let sig = null;

async function load(){
  S = await (await fetch('/api/state')).json();
  document.getElementById('story').textContent = 'Studio asset — ' + (S.story||'');
  disallineato();
  fillModels();
  // Ridisegnare a ogni polling chiudeva i menu aperti sotto le dita: il
  // browser butta via il <select> insieme all'HTML che lo conteneva. Si
  // ridisegna solo se qualcosa e' davvero cambiato, e mai mentre stai
  // usando un controllo del pannello.
  const nuovo = JSON.stringify([S.jobs.map(j=>[j.id,j.file,j.model_used,
                  j.generated_at,j.versions.length]), S.queue, S.settings]);
  // Non si ridisegna sotto un controllo che sta tenendo uno stato che il
  // ridisegno butterebbe via: un menu aperto, un campo a meta'. Un BOTTONE no
  // — dopo averlo premuto il fuoco resta li', e trattarlo come "sto usando un
  // controllo" congelava la pagina proprio sull'azione appena fatta: si
  // marcava un'immagine come definitiva e il segno di spunta non compariva
  // finche' non si cliccava da un'altra parte.
  const a = document.activeElement;
  const occupato = !!a && document.getElementById('panel').contains(a) &&
                   ['SELECT', 'INPUT', 'TEXTAREA'].includes(a.tagName);
  if (nuovo !== sig && !occupato){ sig = nuovo; draw(); drawPanel(); }
  mostraCoda();
  const t = S.totals;
  document.getElementById('totals').textContent =
    `${t.done}/${t.jobs} generate · ${t.spent.toFixed(2)}$ spesi` +
    (t.jobs>t.done ? ` · ${t.todo_cost.toFixed(2)}$ per finire` : '') +
    ` · ${t.approved} definitive` + (t.stale ? ` (${t.stale} da riguardare)` : '') +
    ` · ${t.published} pubblicate`;
  // «Genera le mancanti» sparisce quando non ne mancano: un tasto che esiste
  // solo per dire «sono gia' tutte generate» e' un tasto che si preme una
  // volta e poi si impara a ignorare, e con lui si ignora anche il vicino.
  document.getElementById('genMissing').hidden = t.done >= t.jobs;
  const pub = document.getElementById('publish');
  pub.disabled = !S.story_dir || pubblicando;
  pub.title = S.story_dir
    ? `copia le immagini definitive in ${S.story_dir}/assets/images e scrive gli id nell'IR`
    : 'lo studio non sa in quale storia pubblicare: lancialo con -o <storia>/_work';
}

// La riga che dice cosa sta succedendo alla coda. Sta fuori da `load` perche'
// la chiama anche chi ha appena accodato qualcosa e non vuole aspettare il
// prossimo giro di polling per vederlo scritto.
function mostraCoda(){
  const q = S.queue;
  const info = document.getElementById('qinfo');
  info.className = q.paused ? 'paused' : '';
  info.textContent = (q.paused ? 'IN PAUSA · ' : '') +
    (q.current ? `in corso: ${q.current.id} (${q.current.model})` +
                 (q.pending.length? ` · ${q.pending.length} in attesa`:'')
               : (q.pending.length ? `${q.pending.length} in attesa` : 'nessun lavoro in corso'));
  const pb = document.getElementById('qPause');
  pb.textContent = q.paused ? 'Riprendi' : 'Pausa';
  pb.className = q.paused ? 'primary' : '';
  document.getElementById('qClear').disabled = !q.pending.length;
}

function fillModels(){
  for (const [id,key] of [['mAnchors','anchors'],['mShots','shots']]){
    const el = document.getElementById(id);
    if (el.dataset.filled) { el.value = S.settings[key] || ''; continue; }
    el.innerHTML = S.preference.map(m=>`<option value="${m}">${m}</option>`).join('');
    el.value = S.settings[key] || '';
    el.dataset.filled = 1;
    el.onchange = async () => {
      await post('/api/settings', {[key]: el.value}); load();
    };
  }
}

const post = (url,body) => fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
                                     body:JSON.stringify(body)}).then(r=>r.json());

/**
 * L'avviso quando il manifest non e' piu' quello dell'IR.
 *
 * Dice le due cose che servono a capire: cosa manca (con qualche id, non solo
 * un numero — «shot.cover» spiega da se' cos'e' successo) e il comando che
 * rimette a posto. Rigenerare il manifest non ricomincia niente: gli id dei
 * job restano gli stessi, quindi approvazioni e immagini gia' fatte
 * sopravvivono.
 */
function disallineato(){
  const box = document.getElementById('disallineato');
  const d = S.disallineato || {mancanti: [], avanzati: []};
  const m = d.mancanti || [], a = d.avanzati || [];
  if (!m.length && !a.length){ box.hidden = true; return; }
  const elenco = ids => ids.slice(0,4).map(i=>`<code>${i}</code>`).join(' ') +
      (ids.length > 4 ? ` e altri ${ids.length - 4}` : '');
  const pezzi = [];
  if (m.length) pezzi.push(`<b>${m.length}</b> nell'IR e non qui: ${elenco(m)}`);
  if (a.length) pezzi.push(`<b>${a.length}</b> qui e non piu' nell'IR: ${elenco(a)}`);
  box.innerHTML = `<span>Il manifest non combacia piu&#39; con l&#39;IR — ${pezzi.join(' · ')}. ` +
    `Rifallo e riapri lo studio: <code>python3 assets-studio/images/extract_manifest.py ` +
    `&lt;storia&gt;/story.ir.json -o &lt;storia&gt;/_work/assets_manifest.json</code>. ` +
    `Gli id dei job non cambiano, quindi approvazioni e immagini gia&#39; fatte restano.</span>`;
  box.hidden = false;
}

function visible(){
  const f = document.getElementById('filter').value;
  return S.jobs.filter(j => f==='all' || (f==='missing'&&!j.file) ||
    (f==='anchor'&&j.level==='anchor') || (f==='shot'&&j.level!=='anchor') ||
    (f==='stale'&&j.stale_model) ||
    (f==='approved'&&j.approved) ||
    (f==='toreview'&&j.file&&!j.approved) ||
    (f==='changed'&&j.approval_stale) ||
    (f==='unpublished'&&j.approved&&!j.published));
}

// Le etichette sull'angolo devono spiegarsi da sole al passaggio del mouse:
// "cropped" dice cosa e' successo, ma non con che criterio; il nome di un
// modello, da solo, non dice nemmeno perche' sia li'.
function tag(j, q){
  const esc = t => String(t).replace(/"/g,'&quot;');
  if (q.has(j.id))
    return `<span class="tag q" title="in attesa: verra' generata a breve">in coda</span>`;
  if (j.size_warning)
    return `<span class="tag w" title="${esc(j.size_warning)}. Il manifest chiede ` +
           `${j.size}: ${j.crop==='none' ? "l'immagine e' lasciata com'e'" :
             'l\'immagine e\' stata riportata in squadra — ' +
             esc(S.crops[j.crop]||j.crop)}. Il modo si cambia nel pannello, ` +
           `senza rigenerare.">cropped</span>`;
  if (j.stale_model)
    return `<span class="tag m" title="Generata con ${esc(j.model_used)}, ma il default ` +
           `per ${j.level==='anchor'?'le ancore':'le inquadrature'} adesso e' ` +
           `${esc(j.model_next)}. Rigenerandola userebbe quest'ultimo.">${j.model_used}</span>`;
  return '';
}

// Tre stati, tre segni diversi: definitiva, definitiva-ma-rigenerata-dopo,
// e niente. Il secondo non e' un dettaglio: e' l'unico che chiede di
// riguardare qualcosa prima di pubblicarlo.
function segnoDefinitiva(j){
  if (j.approval_stale)
    return `<span class="ok stale" title="Era definitiva, poi e' stata rigenerata: ` +
           `riguardala e riconfermala. Cosi' com'e' non viene pubblicata.">!</span>`;
  if (j.approved)
    return `<span class="ok" title="Definitiva${j.published ? ', gia' + String.fromCharCode(39) +
      ' pubblicata nella storia' : ', non ancora pubblicata'}">✓</span>`;
  return '';
}

function draw(){
  const q = new Set([...S.queue.pending, S.queue.current?.id].filter(Boolean));
  document.getElementById('grid').innerHTML = visible().map(j=>`
    <div class="card ${sel===j.id?'sel':''} ${j.approved?'appr':''}" data-id="${j.id}">
      ${j.file ? `<img loading="lazy" src="/thumb/${encodeURI(j.file)}?v=${j.generated_at||''}.${bust}">`
               : `<div class="ph">non generata</div>`}
      ${tag(j, q)}
      ${segnoDefinitiva(j)}
      <div class="meta"><b>${j.id}</b><br>${j.model_used||'—'}${
        j.cost!=null?' · '+j.cost.toFixed(3)+'$':''}</div>
    </div>`).join('');
  document.querySelectorAll('.card').forEach(c=>c.onclick=()=>{sel=c.dataset.id;draw();drawPanel();});
}

function drawPanel(){
  const p = document.getElementById('panel');
  const j = S.jobs.find(x=>x.id===sel);
  // La classe sul body e' cio' che fa restringere testata e griglia: il
  // pannello resta fisso dov'e', e' il resto a farsi da parte.
  document.body.classList.toggle('con-pannello', !!j);
  if (!j){ p.hidden = true; return; }
  p.hidden = false;
  // Scorrono la lista FILTRATA, cioe' quella che hai davanti: con "solo
  // mancanti" attivo ti portano alla prossima mancante.
  const lista = visible(), idx = lista.findIndex(x=>x.id===sel);
  // Dal migliore al peggiore: la scala nel registro va dal peggiore al
  // migliore, e in un menu si sceglie quasi sempre verso l'alto.
  const scelte = [...S.preference].reverse();
  p.innerHTML = `
    <div class="row">
      <button onclick="step(-1)" ${idx<=0?'disabled':''}>&larr; precedente</button>
      <button onclick="step(1)" ${idx<0||idx>=lista.length-1?'disabled':''}>successiva &rarr;</button>
      <span class="sp"></span>
      <span class="logline">${idx+1} / ${lista.length}</span>
      <button onclick="sel=null;draw();drawPanel()">chiudi</button>
    </div>
    <h2>${j.id}</h2>
    <div class="logline">${j.level} · ${j.kind} · ${j.name||''}</div>
    ${j.file?`<div class="row"><img style="cursor:zoom-in" title="guardala a schermo intero"
        onclick="apri('${j.file}','${j.id}')"
        src="/img/${encodeURI(j.file)}?v=${j.generated_at||''}.${bust}"></div>`
            :'<p class="logline">non ancora generata</p>'}
    <dl>
      <dt>modello</dt><dd>${j.model_used||'—'}</dd>
      <dt>costo</dt><dd>${j.cost!=null?j.cost.toFixed(3)+'$':'—'}</dd>
      <dt>seed</dt><dd>${j.seed}</dd>
      <dt>dimensione</dt><dd>${j.size}${j.raw_size
        ? `<br><span class="warn">⚠ il modello l'ha resa ${j.raw_size}</span>` : ''}</dd>
      <dt>secondi</dt><dd>${j.seconds??'—'}</dd>
      <dt>reference</dt><dd>${j.refs.length?j.refs.join('<br>'):'nessuna'}</dd>
    </dl>
    ${j.file && j.raw_size ? `
    <div class="row">
      <label>ritaglio <select id="pickCrop" onchange="ritaglia('${j.id}',this)">${
        Object.entries(S.crops).map(([k,t])=>
          `<option value="${k}" ${k===j.crop?'selected':''}>${t}</option>`).join('')
      }</select></label>
    </div>
    <div class="logline">Il modello ha reso ${j.raw_size} invece di ${j.size}: e'
      questo modo a decidere cosa resta dentro. Cambiarlo non costa nulla — si
      rilavora l'originale gia' pagato, tenuto da parte.</div>` : ''}
    ${j.file ? `
    <div class="row">
      <button class="ok" onclick="definitiva('${j.id}',${!j.approved})">${
        j.approved ? 'Definitiva ✓ — togli' : 'Segna come definitiva'}</button>
      <span class="logline">${
        j.approval_stale ? 'era definitiva, poi rigenerata: riconfermala'
        : j.approved ? (j.published ? 'gia\' nella storia' + (
            j.published_stale ? ', ma la storia ha una versione diversa: ripubblica' : '')
            : 'verra\' copiata nella storia alla prossima pubblicazione')
        : 'solo le definitive finiscono nella storia'}</span>
    </div>
    <div class="logline">Il tasto <b>d</b> fa la stessa cosa senza staccare
      le mani dalle frecce.</div>` : ''}
    <div class="row">
      <button class="spesa" onclick="rigenera(['${j.id}'],null,'Rigenero questa immagine.')">
        Rigenera</button>
      <button class="spesa" onclick="rigenera(['${j.id}'],null,'Rigenero con un altro seed.',rndSeed())">
        Altro seed</button>
    </div>
    <div class="row">
      <select id="pickModel">${scelte.map(m=>
        `<option value="${m}" ${m===j.model_used?'selected':''}>${m}${
          S.costs[m]!=null?' — '+S.costs[m].toFixed(3)+'$':''}</option>`).join('')}</select>
      <button class="spesa" onclick="rigenera(['${j.id}'],document.getElementById('pickModel').value,
        'Rigenero con il modello scelto.')">Rigenera con questo</button>
    </div>
    ${j.versions.length ? `
      <div class="row" style="margin-top:16px"><b class="logline">
        versioni precedenti (${j.versions.length})</b></div>
      <div class="vers">${j.versions.map(v=>`
        <div class="ver">
          <img src="/thumb/${encodeURI(v.file)}" onclick="apri('${v.file}','${v.model} · ${v.at}')">
          <div class="logline">${v.model}${v.cost!=null?' · '+v.cost.toFixed(3)+'$':''}</div>
          <div class="logline">${v.at.replace('T',' ').slice(0,16)}</div>
          <button onclick="usa('${j.id}','${v.file}')">Usa questa</button>
        </div>`).join('')}</div>` : ''}
    <pre>${(j.prompt||'').replace(/[<&]/g,c=>({'<':'&lt;','&':'&amp;'}[c]))}</pre>
    <div class="row" style="margin-top:18px"><b class="logline">ultimi lavori</b></div>
    ${S.queue.log.slice(0,12).map(l=>`<div class="logline ${l.ok?'':'bad'}">${
      l.ok?'ok':'FALLITO'} ${l.id} · ${l.model} · ${l.seconds}s ${l.note||''}</div>`).join('')}`;
}

const rndSeed = () => Math.floor(Math.random()*2147483646);

// Ogni rigenerazione e' una chiamata pagata: prima di spendere si dice
// quanto, con che modello e su quante immagini.
function confermaSpesa(ids, model, cosa){
  const prezzi = ids.map(id => {
    const j = S.jobs.find(x=>x.id===id);
    return S.costs[model || j.model_next] ?? 0;
  });
  const tot = prezzi.reduce((a,b)=>a+b, 0);
  const quali = ids.length === 1 ? ids[0] : `${ids.length} immagini`;

  // "quello di default" da solo non basta a decidere: il default e' diverso
  // fra ancore e inquadrature, e cambia da sotto quando lo tocchi nei menu
  // in alto. Qui si dice sempre quale modello partira' davvero.
  let riga;
  if (model) {
    riga = model;
  } else {
    const conte = {};
    ids.forEach(id => {
      const m = S.jobs.find(x=>x.id===id).model_next;
      conte[m] = (conte[m] || 0) + 1;
    });
    const nomi = Object.keys(conte);
    riga = nomi.length === 1
      ? `${nomi[0]} (default)`
      : `default: ` + nomi.map(m=>`${m} ×${conte[m]}`).join(', ');
  }

  return confirm(
    `${cosa}\n\n${quali}\n` +
    `modello: ${riga}\n` +
    `costo: ${tot.toFixed(3)}$` +
    (ids.length > 1 ? ` (${prezzi.length} chiamate)` : '') + `\n\nProcedo?`);
}

function step(d){
  const lista = visible(), i = lista.findIndex(x=>x.id===sel) + d;
  if (i < 0 || i >= lista.length) return;
  sel = lista[i].id; draw(); drawPanel();
  document.querySelector('.card.sel')?.scrollIntoView({block:'nearest'});
}
addEventListener('keydown', e => {
  // Il popup si chiude per primo: quando e' aperto e' l'unica cosa che si sta
  // guardando, e chiudere insieme a lui anche il pannello dietro farebbe
  // perdere il posto nella revisione.
  if (e.key === 'Escape' && document.getElementById('lb').classList.contains('on')){
    chiudiGrande();
    return;
  }
  if (!sel || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
  // Guardare ottantotto immagini e decidere una per una e' il lavoro vero
  // di questa pagina: freccia, d, freccia. Un giro fatto col mouse su due
  // bersagli diversi lo rende un mestiere.
  if (e.key === 'd' || e.key === 'D'){
    const j = S.jobs.find(x=>x.id===sel);
    if (j?.file) definitiva(j.id, !j.approved || j.approval_stale);
  }
  if (e.key === 'Escape'){ sel=null; draw(); drawPanel(); }
});

// Approvare non costa niente e si disfa: nessuna conferma, sarebbe un clic
// in piu' ottantotto volte.
//
// Il segno compare **subito**, prima della risposta del server: la decisione
// e' gia' stata presa da chi ha premuto, e lo stato completo della pagina
// costa una rilettura di ottantotto sidecar. Aspettarla per accendere una
// spunta significa, su una revisione lunga, premere e non vedere succedere
// niente — e premere di nuovo. Se poi il server dice di no si torna indietro
// da soli, con il giro di `load()` che segue.
async function definitiva(id, value){
  const j = S.jobs.find(x=>x.id===id);
  if (j){
    j.approved = value;
    // Approvare vuol dire approvare *questo* file: l'eventuale
    // «era definitiva, poi rigenerata» sparisce nel momento in cui si
    // riconferma, ed e' esattamente cio' che il server sta per registrare.
    if (value) j.approval_stale = false;
    draw(); drawPanel();
  }
  const r = await post('/api/approve', {ids:[id], value});
  if (r.error) alert(r.error);
  sig = null; load();
}

function rigenera(ids, model, cosa, seed){
  if (!confermaSpesa(ids, model, cosa)) return;
  return gen(ids, model, false, seed);
}

async function gen(ids, model, upgrade, seed){
  // «In coda» compare subito, come la spunta delle definitive: la richiesta
  // e' partita, e finche' il server non risponde la pagina direbbe altrimenti
  // che non e' successo niente — su una rigenerazione singola sono quasi
  // sempre due click, il secondo dei quali paga una seconda immagine.
  // Se il server ne rifiuta qualcuna, il `load()` qui sotto rimette le cose a
  // posto e l'avviso dice quali.
  const gia = new Set([...S.queue.pending, S.queue.current?.id].filter(Boolean));
  S.queue.pending = [...S.queue.pending, ...ids.filter(i => !gia.has(i))];
  draw(); drawPanel(); mostraCoda();
  const r = await post('/api/generate', {ids, model, upgrade, seed});
  // Senza chiave l'endpoint rifiuta tutto in blocco, e finora la pagina lo
  // teneva per se': si premeva «rigenera» e non succedeva niente, senza mai
  // sapere perche'.
  if (r.error) alert(r.error);
  if (r.rifiutati?.length) alert(r.rifiutati.map(x=>x[0]+': '+x[1]).join('\n'));
  sig = null; load();
}

// Apre un'immagine a schermo intero. Prima si apriva in una scheda nuova:
// tornare indietro voleva dire cambiare scheda, e dopo dieci immagini la
// revisione era sparsa su dieci schede.
function apri(file, didascalia){
  document.getElementById('lbimg').src = '/img/' + encodeURI(file) + '?v=' + bust;
  document.getElementById('lbcap').textContent = didascalia || file;
  document.getElementById('lb').classList.add('on');
}

function chiudiGrande(){
  const lb = document.getElementById('lb');
  lb.classList.remove('on');
  document.getElementById('lbimg').removeAttribute('src');
}

// Un clic in qualunque punto chiude: a schermo intero non c'e' nient'altro da
// fare li' dentro.
document.getElementById('lb').onclick = chiudiGrande;

// Il ritaglio si rifa' sull'originale tenuto da parte: nessuna chiamata
// all'API, quindi nessuna conferma di spesa da chiedere. Il file cambia
// pero' senza cambiare nome, e il browser terrebbe la vecchia copia in
// cache: si incrementa `bust` per obbligarlo a rileggerla.
async function ritaglia(id, el){
  const r = await post('/api/crop', {id, mode: el.value});
  if (r.error) alert(r.error);
  else if (r.applied === false)
    alert('Non sono riuscito a ritagliare: manca l\'originale o Pillow.');
  bust++; el.blur(); sig = null; load();
}

async function usa(id, version){
  // Ripristinare non costa niente: e' un file gia' pagato che torna in uso.
  if (!confirm('Uso questa versione al posto di quella attuale?\n\n' +
               'Quella attuale finisce nello storico, non si perde.')) return;
  const r = await post('/api/restore', {id, version});
  if (r.error) alert(r.error);
  sig = null; load();
}

document.getElementById('filter').onchange = () => { draw(); drawPanel(); };

document.getElementById('qPause').onclick = async () => {
  await post('/api/queue', {action: S.queue.paused ? 'resume' : 'pause'}); load();
};
document.getElementById('qClear').onclick = async () => {
  const n = S.queue.pending.length;
  if (!confirm(`Tolgo ${n} lavori dalla coda?\n\n` +
    `Quello in corso arriva in fondo: e' gia' pagato, interromperlo ` +
    `butterebbe l'immagine senza far risparmiare niente.`)) return;
  await post('/api/queue', {action:'clear'}); load();
};
document.getElementById('genMissing').onclick = () => {
  const ids = S.jobs.filter(j=>!j.file).map(j=>j.id);
  if (!ids.length) return;          // il tasto e' nascosto: non dovrebbe capitare
  rigenera(ids, null, `Genero le ${ids.length} immagini mancanti.`);
};

// Pubblicare non spende, ma scrive nella cartella versionata della storia e
// tocca l'IR: si dice prima cosa succederebbe, con i numeri veri, e quelli si
// ottengono facendo fare al server una passata a vuoto.
document.getElementById('publish').onclick = async () => {
  const b = document.getElementById('publish');
  const etichetta = 'Pubblica nella storia';
  const lavora = t => { pubblicando = true; b.disabled = true;
                        b.classList.add('inCorso'); b.textContent = t; };
  const basta = () => { pubblicando = false; b.disabled = false;
                        b.classList.remove('inCorso'); b.textContent = etichetta; };
  if (pubblicando) return;

  // Anche la passata a vuoto legge e riassume ogni immagine approvata: su una
  // storia intera sono secondi, non millisecondi, e vanno detti.
  lavora('controllo…');
  let p;
  try { p = await post('/api/publish', {dry_run:true}); }
  catch (err) { basta(); return alert('Non riesco a contattare lo studio: ' + err.message); }
  basta();
  if (p.error) return alert(p.error);
  const n = p.nuove.length + p.aggiornate.length;
  const righe = [
    `${p.nuove.length} nuove, ${p.aggiornate.length} aggiornate, ${p.invariate.length} gia' a posto`,
    `${(p.bytes/1048576).toFixed(1)} MB negli asset della storia`,
    `IR: ${p.copertura.con_immagine} nodi con immagine, ${p.copertura.senza_immagine} ancora senza`,
  ];
  const attesa = p.in_attesa || [];
  if (attesa.length) righe.push(
    `${attesa.length} generate ma non ancora definitive: non si pubblicano ` +
    `(${attesa.slice(0,3).join(', ')}${attesa.length > 3 ? '…' : ''})`);
  if (p.saltate.length) righe.push(`saltate: ${p.saltate.length} (${p.saltate[0][1]}…)`);
  if (p.rimosse.length) righe.push(`${p.rimosse.length} id tolti dall'IR`);
  if (p.orfane.length) righe.push(`${p.orfane.length} file negli asset non piu' referenziati`);
  if (p.errori.length) righe.push(`ERRORI: ${p.errori.map(e=>e[0]+' — '+e[1]).join('; ')}`);
  if (!n && !p.rimosse.length && !p.errori.length)
    // «Gia' allineata» sarebbe una bugia se ci sono immagini generate in attesa
    // di un giudizio: la storia non e' allineata, manca il ✓.
    return alert(attesa.length
      ? `Niente da pubblicare: le ${attesa.length} immagini generate non sono ancora `
        + `marcate definitive, e la pubblicazione prende solo quelle.\n\n` + righe.join('\n')
      : 'Niente da pubblicare: la storia e\' gia\' allineata.\n\n' + righe.join('\n'));
  if (!confirm(`Pubblico nella storia?\n\n${righe.join('\n')}\n\n` +
               `Ci vuole qualche secondo: ogni immagine viene convertita.\n\nProcedo?`)) return;

  // Da qui in poi il server converte e riscrive l'IR, e per tutto quel tempo
  // la pagina deve dire che sta succedendo qualcosa: il numero e' quello vero,
  // appena letto dalla passata a vuoto.
  lavora(n ? `pubblico ${n} immagini…` : 'pubblico…');
  let r;
  try { r = await post('/api/publish', {dry_run:false}); }
  catch (err) { basta(); sig = null; load();
                return alert('La pubblicazione si e\' interrotta: ' + err.message +
                             '\n\nRilanciala: quello che era gia\' a posto non viene rifatto.'); }
  basta();
  if (r.error) return alert(r.error);
  alert(`Pubblicate: ${r.nuove.length} nuove, ${r.aggiornate.length} aggiornate.` +
        (r.ir_modificato ? '\nL\'IR e\' stato aggiornato.' : '\nL\'IR era gia\' a posto.'));
  sig = null; load();
};

document.getElementById('purge').onclick = async () => {
  const fatte = S.jobs.filter(j=>j.file).length;
  if (!fatte) return alert('Non c\'e\' niente da eliminare.');
  // Il costo di rigenerazione e' l'informazione che serve per decidere:
  // "88 immagini" da solo non dice quanto costa cambiare idea.
  const costo = S.jobs.filter(j=>j.file)
                      .reduce((t,j)=>t+(S.costs[j.model_next]||0),0);
  const ok = confirm(
    `Elimino tutte le ${fatte} immagini generate?\n\n` +
    `Rigenerarle costerebbe circa ${costo.toFixed(2)}$.\n` +
    `Restano il manifest, il prototipo in _proto/ e le tue scelte.\n\n` +
    `L'operazione non e' reversibile.`);
  if (!ok) return;
  const r = await post('/api/purge', {});
  if (r.error) alert(r.error);
  else alert(`Eliminate ${r.immagini} immagini, ${r.sidecar} sidecar e ${r.cache} file di cache.`);
  sel = null; load();
};

load(); setInterval(load, 2500);
</script>
</html>"""


def indirizzi_di_rete() -> list[str]:
    """Gli IPv4 con cui questa macchina si fa raggiungere dagli altri.

    Senza dipendenze: si apre un socket UDP verso un indirizzo che non esiste
    — nessun pacchetto parte — e si guarda quale interfaccia il sistema
    avrebbe usato. E' il modo portabile di chiedere "qual e' il mio indirizzo
    buono", perche' il nome host da solo su molte macchine risponde 127.0.1.1.
    """
    trovati = []
    for bersaglio in ("10.255.255.255", "192.168.0.1", "172.16.0.1"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(0.2)
            s.connect((bersaglio, 1))
            trovati.append(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            trovati.append(info[4][0])
    except OSError:
        pass
    return [a for a in dict.fromkeys(trovati) if not a.startswith("127.")]


def serve(manifest: str, outdir: str, port: int, key: str | None, apri: bool,
          story: str | None = None, host: str = "127.0.0.1"):
    studio = Studio(pathlib.Path(manifest), pathlib.Path(outdir), key,
                    pathlib.Path(story) if story else None)
    Handler.studio = studio
    srv = ThreadingHTTPServer((host, port), Handler)
    url = f"http://127.0.0.1:{port}"
    c = studio.state()["totals"]
    print(f"Studio asset — {studio.manifest.get('title')}")
    print(f"  {c['done']}/{c['jobs']} gia' generate, {c['todo_cost']:.2f}$ per finire")
    print(f"  ancore: {studio.settings.get('anchors')} · "
          f"inquadrature: {studio.settings.get('shots')}")
    print(f"  {c['approved']} definitive, {c['published']} gia' pubblicate in "
          + (str(studio.story) if studio.story else "nessuna storia (--story per dirlo)"))
    # Aperto sulla rete: prima gli indirizzi con cui ci si arriva dal telefono,
    # perche' e' il motivo per cui si apre. Guardare gli asset dallo schermo su
    # cui la storia verra' giocata e' un'altra cosa dal guardarli sul monitor.
    if host not in ("127.0.0.1", "localhost"):
        rete = indirizzi_di_rete()
        if rete:
            print()
            for ip in rete:
                print(f"  http://{ip}:{port}")
            print("\n  dal telefono: stessa rete wi-fi, apri uno degli indirizzi qui sopra.")
        else:
            print("\n  nessuna interfaccia di rete: da questa macchina raggiungi solo localhost.")
        print(f"  da questo computer: {url}")
        # Il monito sta in fondo, dov'e' l'ultima cosa che si legge prima di
        # cominciare: sulla rete di casa la pagina non chiede nessuna
        # password, e da quella pagina si spende.
        print("\n  ATTENZIONE: in ascolto su tutta la rete locale. Chi apre questa\n"
              "  pagina puo' generare immagini, e generare costa. Ctrl-C per fermare.\n")
    else:
        print(f"\n  {url}\n")
    if apri:
        import webbrowser
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nchiuso")


def main(argv=None):
    ap = argparse.ArgumentParser(description="interfaccia web locale per gli asset")
    ap.add_argument("manifest")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1",
                    help="interfaccia su cui ascoltare. Il default e' solo questo "
                         "computer; 0.0.0.0 apre alla rete locale — comodo per "
                         "guardare gli asset dal telefono, ma li' chiunque puo' "
                         "generare, e generare spende")
    ap.add_argument("--story", help="la cartella della storia in cui pubblicare "
                                    "(default: la cartella che contiene _work)")
    ap.add_argument("--no-open", action="store_true", help="non aprire il browser")
    ap.add_argument("--key")
    args = ap.parse_args(argv)
    key = generate.load_profile(args.key)
    if not key:
        print("nota: nessuna chiave API — puoi guardare ma non generare",
              file=sys.stderr)
    serve(args.manifest, args.out, args.port, key, not args.no_open, args.story,
          args.host)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
