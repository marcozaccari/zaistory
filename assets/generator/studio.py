#!/usr/bin/env python3
"""Interfaccia web locale per generare, guardare e rifare gli asset.

Il ciclo di lavoro e' sempre lo stesso — genera, guarda, rifai quelle che non
convincono — ma qui sta in una pagina sola invece che in tre comandi e un
file HTML statico.

Non reimplementa niente: importa `generate.Runner`, quindi reference,
sidecar, cache, controllo dimensione e scala di preferenza sono esattamente
quelli della riga di comando, e le due strade restano intercambiabili.

    python studio.py assets/out/metalhead/assets_manifest.json \\
        -o assets/out/metalhead

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
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import generate

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

    def __init__(self, manifest_path: pathlib.Path, outdir: pathlib.Path, key: str | None):
        self.manifest_path = manifest_path
        self.outdir = outdir
        self.key = key
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
        allowed = {k: v for k, v in data.items()
                   if k in ("anchors", "shots", "crop_default") and v}
        with self.lock:
            self.settings.update(allowed)
            self._settings_path().write_text(
                json.dumps(self.settings, ensure_ascii=False, indent=2),
                encoding="utf-8")
        return self.settings

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

    def job_view(self, job: dict) -> dict:
        out = self.outdir / job["file"]
        side = self.sidecar(job)
        used = (side or {}).get("model")
        atteso = self.model_for(job)
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
        jobs = [self.job_view(j) for j in self.manifest["jobs"]]
        fatti = sum(1 for j in jobs if j["file"])
        speso = sum(j["cost"] or 0 for j in jobs if j["file"])
        return {
            "story": self.manifest.get("title") or self.manifest.get("story_id"),
            "jobs": jobs,
            "settings": self.settings,
            "preference": self.registry["preference"],
            "crops": CROPS,
            "costs": self.registry["costs"],
            "queue": {"pending": pending, "current": current, "log": log,
                      "paused": not self.running.is_set()},
            "totals": {"jobs": len(jobs), "done": fatti, "spent": round(speso, 3),
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

        Quella attuale non si perde: finisce nello storico a sua volta, cosi'
        si puo' andare avanti e indietro fra i tentativi senza pagarne
        nessuno una seconda volta.
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
        cur.write_bytes(src.read_bytes())
        s_src = generate.sidecar_path(src)
        if s_src.is_file():
            generate.sidecar_path(cur).write_text(
                s_src.read_text(encoding="utf-8"), encoding="utf-8")
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
                                            "POLLINATIONS_API_KEY o usa assets/.profile"}, 400)
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
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1a1a19;--mut:#6b6b68;--line:#e3e3e0;
      --card:#fff;--acc:#2f6f4e;--warn:#8a5a00;--bad:#a33}
@media(prefers-color-scheme:dark){:root{--bg:#141413;--fg:#eee;--mut:#9a9a96;
      --line:#2b2b29;--card:#1c1c1a;--acc:#7fc4a0;--warn:#d9a441;--bad:#e08a8a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
     font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);
       padding:12px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:16px;margin:0;font-weight:650}
.sp{flex:1}
select,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);
       border-radius:7px;padding:5px 10px;cursor:pointer}
button:hover{border-color:var(--mut)}
button.primary{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
button.danger{color:var(--bad);border-color:var(--line)}
button.danger:hover{border-color:var(--bad)}
button:disabled{opacity:.45;cursor:default}
label{font-size:12px;color:var(--mut)}
main{padding:16px 20px 60px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;
     font-size:12px;color:var(--mut)}
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
aside{position:fixed;right:0;top:0;bottom:0;width:min(460px,92vw);background:var(--card);
      border-left:1px solid var(--line);padding:18px;overflow:auto;z-index:10;
      box-shadow:-8px 0 30px rgba(0,0,0,.12)}
aside img{width:100%;border-radius:8px;border:1px solid var(--line)}
aside h2{font-size:14px;font-family:ui-monospace,monospace;margin:0 0 2px;word-break:break-all}
dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin:12px 0}
dt{color:var(--mut)} dd{margin:0;font-family:ui-monospace,monospace}
pre{white-space:pre-wrap;font-size:11px;color:var(--mut);border-left:2px solid var(--line);
    padding-left:9px;margin:8px 0 0}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.logline{font-size:11px;font-family:ui-monospace,monospace;padding:2px 0;color:var(--mut)}
.logline.bad{color:var(--bad)}
.vers{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}
.ver img{width:100%;border-radius:6px;border:1px solid var(--line);cursor:zoom-in;display:block}
.ver button{width:100%;margin-top:4px;font-size:11px;padding:3px}
</style>
<header>
  <h1 id="story">Studio asset</h1>
  <label>ancore <select id="mAnchors"></select></label>
  <label>inquadrature <select id="mShots"></select></label>
  <span class="sp"></span>
  <span id="totals" class="logline"></span>
  <button id="genMissing" class="primary">Genera le mancanti</button>
  <button id="purge" class="danger">Elimina tutte</button>
</header>
<main>
  <div class="bar">
    <label>mostra <select id="filter">
      <option value="all">tutte</option>
      <option value="missing">solo mancanti</option>
      <option value="anchor">solo ancore</option>
      <option value="shot">solo inquadrature</option>
      <option value="stale">modello diverso dal default</option>
    </select></label>
    <span id="qinfo"></span>
    <span class="sp"></span>
    <button id="qPause"></button>
    <button id="qClear" class="danger">Svuota la coda</button>
  </div>
  <div class="grid" id="grid"></div>
</main>
<aside id="panel" hidden></aside>
<script>
let S = null, sel = null, bust = 0;

let sig = null;

async function load(){
  S = await (await fetch('/api/state')).json();
  document.getElementById('story').textContent = 'Studio asset — ' + (S.story||'');
  fillModels();
  // Ridisegnare a ogni polling chiudeva i menu aperti sotto le dita: il
  // browser butta via il <select> insieme all'HTML che lo conteneva. Si
  // ridisegna solo se qualcosa e' davvero cambiato, e mai mentre stai
  // usando un controllo del pannello.
  const nuovo = JSON.stringify([S.jobs.map(j=>[j.id,j.file,j.model_used,
                  j.generated_at,j.versions.length]), S.queue, S.settings]);
  const dentro = document.getElementById('panel').contains(document.activeElement);
  if (nuovo !== sig && !dentro){ sig = nuovo; draw(); drawPanel(); }
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
  const t = S.totals;
  document.getElementById('totals').textContent =
    `${t.done}/${t.jobs} generate · ${t.spent.toFixed(2)}$ spesi` +
    (t.jobs>t.done ? ` · ${t.todo_cost.toFixed(2)}$ per finire` : '');
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

function visible(){
  const f = document.getElementById('filter').value;
  return S.jobs.filter(j => f==='all' || (f==='missing'&&!j.file) ||
    (f==='anchor'&&j.level==='anchor') || (f==='shot'&&j.level!=='anchor') ||
    (f==='stale'&&j.stale_model));
}

// Le etichette sull'angolo devono spiegarsi da sole al passaggio del mouse:
// "ritagliata" dice cosa e' successo, ma non con che criterio; il nome di un
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
           `senza rigenerare.">ritagliata</span>`;
  if (j.stale_model)
    return `<span class="tag w" title="Generata con ${esc(j.model_used)}, ma il default ` +
           `per ${j.level==='anchor'?'le ancore':'le inquadrature'} adesso e' ` +
           `${esc(j.model_next)}. Rigenerandola userebbe quest'ultimo.">${j.model_used}</span>`;
  return '';
}

function draw(){
  const q = new Set([...S.queue.pending, S.queue.current?.id].filter(Boolean));
  document.getElementById('grid').innerHTML = visible().map(j=>`
    <div class="card ${sel===j.id?'sel':''}" data-id="${j.id}">
      ${j.file ? `<img loading="lazy" src="/thumb/${encodeURI(j.file)}?v=${j.generated_at||''}.${bust}">`
               : `<div class="ph">non generata</div>`}
      ${tag(j, q)}
      <div class="meta"><b>${j.id}</b><br>${j.model_used||'—'}${
        j.cost!=null?' · '+j.cost.toFixed(3)+'$':''}</div>
    </div>`).join('');
  document.querySelectorAll('.card').forEach(c=>c.onclick=()=>{sel=c.dataset.id;draw();drawPanel();});
}

function drawPanel(){
  const p = document.getElementById('panel');
  const j = S.jobs.find(x=>x.id===sel);
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
    ${j.file?`<div class="row"><img src="/img/${encodeURI(j.file)}?v=${j.generated_at||''}.${bust}"></div>`
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
    ${j.file ? `
    <div class="row">
      <label>ritaglio <select id="pickCrop" onchange="ritaglia('${j.id}',this)">${
        Object.entries(S.crops).map(([k,t])=>
          `<option value="${k}" ${k===j.crop?'selected':''}>${t}</option>`).join('')
      }</select></label>
    </div>
    <div class="logline">${j.raw_size
      ? `Il modello ha reso ${j.raw_size} invece di ${j.size}: e' questo modo a ` +
        `decidere cosa resta dentro. Cambiarlo non costa nulla — si rilavora ` +
        `l'originale gia' pagato, tenuto da parte.`
      : `Gia' della dimensione chiesta: qui non c'e' niente da ritagliare.`}</div>` : ''}
    <div class="row">
      <button class="primary" onclick="rigenera(['${j.id}'],null,'Rigenero questa immagine.')">
        Rigenera</button>
      <button onclick="rigenera(['${j.id}'],null,'Rigenero con un altro seed.',rndSeed())">
        Altro seed</button>
    </div>
    <div class="row">
      <select id="pickModel">${scelte.map(m=>
        `<option value="${m}" ${m===j.model_used?'selected':''}>${m}${
          S.costs[m]!=null?' — '+S.costs[m].toFixed(3)+'$':''}</option>`).join('')}</select>
      <button onclick="rigenera(['${j.id}'],document.getElementById('pickModel').value,
        'Rigenero con il modello scelto.')">Rigenera con questo</button>
    </div>
    ${j.versions.length ? `
      <div class="row" style="margin-top:16px"><b class="logline">
        versioni precedenti (${j.versions.length})</b></div>
      <div class="vers">${j.versions.map(v=>`
        <div class="ver">
          <img src="/thumb/${encodeURI(v.file)}" onclick="apri('${v.file}')">
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
  if (!sel || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'Escape'){ sel=null; draw(); drawPanel(); }
});

function rigenera(ids, model, cosa, seed){
  if (!confermaSpesa(ids, model, cosa)) return;
  return gen(ids, model, false, seed);
}

async function gen(ids, model, upgrade, seed){
  const r = await post('/api/generate', {ids, model, upgrade, seed});
  if (r.rifiutati?.length) alert(r.rifiutati.map(x=>x[0]+': '+x[1]).join('\n'));
  sig = null; load();
}

const apri = f => window.open('/img/'+encodeURI(f), '_blank');

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
  if (!ids.length) return alert('Sono gia\' tutte generate.');
  rigenera(ids, null, 'Genero tutte le immagini mancanti.');
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


def serve(manifest: str, outdir: str, port: int, key: str | None, apri: bool):
    studio = Studio(pathlib.Path(manifest), pathlib.Path(outdir), key)
    Handler.studio = studio
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    c = studio.state()["totals"]
    print(f"Studio asset — {studio.manifest.get('title')}")
    print(f"  {c['done']}/{c['jobs']} gia' generate, {c['todo_cost']:.2f}$ per finire")
    print(f"  ancore: {studio.settings.get('anchors')} · "
          f"inquadrature: {studio.settings.get('shots')}")
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
    ap.add_argument("--no-open", action="store_true", help="non aprire il browser")
    ap.add_argument("--key")
    args = ap.parse_args(argv)
    key = generate.load_profile(args.key)
    if not key:
        print("nota: nessuna chiave API — puoi guardare ma non generare",
              file=sys.stderr)
    serve(args.manifest, args.out, args.port, key, not args.no_open)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
