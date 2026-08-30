#!/usr/bin/env python3
"""Genera le immagini di un assets_manifest.json via Pollinations.

Passo 2 dei due descritti in ARCHITECTURE.md ("Modulo assets"): qui non si
legge l'IR, si consuma solo il manifest prodotto da extract_manifest.py.

Due tier, che sono i due livelli del manifest visti dal lato costo:

  ancore      modello text-only (default `grok-imagine`), endpoint GET, seed
              deterministico. Sono poche ed e' l'unico punto in cui vuoi che
              il modello inventi liberamente.

  inquadrature modello con reference (default `nanobanana-2-lite`), endpoint
              POST /v1/images/edits in multipart, con le ancore del luogo e
              dei personaggi in campo allegate come file. L'identita' di un
              personaggio non sta nel prompt: nessun testo puo' portarla, e
              va ancorata sul pixel.

Le reference non vengono spedite in PNG: se ne fa una copia ridotta in WebP
(o JPEG), perche' al modello serve l'identita', non il lossless.

Uso:
    export POLLINATIONS_API_KEY=sk_...
    python generate.py stories/metal-head/_work/assets_manifest.json -o stories/metal-head/_work
    python generate.py manifest.json -o out --level anchors
    python generate.py manifest.json -o out --dry-run
    python generate.py manifest.json -o out --redo shot.scena_3.n2 --model nanobanana
    python generate.py manifest.json -o out --check-stale
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as futures
import datetime as _dt
import hashlib
import json
import mimetypes
import os
import pathlib
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SIDECAR_VERSION = 1

GEN_BASE = "https://gen.pollinations.ai"

# L'endpoint GET e' quello che documenta il parametro `seed`, e per le ancore
# la riproducibilita' e' tutto il punto. Il path e' cambiato nel tempo: si
# provano in ordine e si ricorda quello che risponde.
GET_TEMPLATES = [
    GEN_BASE + "/image/{prompt}",
    "https://image.pollinations.ai/prompt/{prompt}",
]

RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4
# Oltre questa lunghezza l'URL di una GET diventa un terno al lotto fra proxy
# e CDN: si passa alla POST, perdendo il seed. Meglio saperlo che scoprirlo.
MAX_GET_URL = 6000


# --------------------------------------------------------------------- utili

def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


REGISTRY_NAME = "model_costs.json"


def load_registry(explicit=None) -> dict:
    """Costi e scala di preferenza dei modelli, da un file accanto agli script.

    Sta fuori dal codice perche' sono due cose che cambiano spesso e per
    ragioni diverse: i prezzi li cambia il fornitore, la scala la cambi tu
    guardando le immagini.
    """
    path = pathlib.Path(explicit) if explicit else (
        pathlib.Path(__file__).resolve().parent / REGISTRY_NAME)
    if not path.is_file():
        return {"costs": {}, "preference": []}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {"costs": {}, "preference": []}
    return {
        "costs": {m: 1.0 / n for m, n in doc.get("calls_per_dollar", {}).items() if n},
        "preference": list(doc.get("preference", [])),
    }


def next_model(preference: list, current: str) -> str | None:
    """Il gradino successivo della scala, o None se e' gia' in cima."""
    if current not in preference:
        return preference[0] if preference else None
    i = preference.index(current)
    return preference[i + 1] if i + 1 < len(preference) else None


PROFILE_NAME = ".profile"
ENV_KEY = "POLLINATIONS_API_KEY"


def load_profile(explicit=None) -> str | None:
    """Chiave dall'ambiente, o da `assets-studio/.profile` se l'ambiente e' vuoto.

    Quel file e' gia' nel .gitignore del repo, quindi e' il posto in cui una
    credenziale puo' stare senza rischiare di finire in un commit. Si cerca
    accanto agli script (`assets-studio/images/../.profile`) e risalendo dalla
    cwd, cosi' funziona sia lanciando dalla radice del repo sia da dentro.
    Il nome vecchio della cartella, `assets/`, resta fra i posti in cui
    guardare: una chiave che smette di essere trovata perche' una cartella e'
    stata rinominata e' mezz'ora persa a cercare un errore che non c'e'.

    Le variabili trovate finiscono in os.environ solo se non c'erano gia':
    l'ambiente esplicito vince sempre sul file.
    """
    if explicit:
        return explicit
    if os.environ.get(ENV_KEY):
        return os.environ[ENV_KEY]

    here = pathlib.Path(__file__).resolve().parent
    cwd = pathlib.Path.cwd()
    candidates = [here.parent / PROFILE_NAME]
    for cartella in ("assets-studio", "assets"):
        candidates += [p / cartella / PROFILE_NAME for p in (cwd, *cwd.parents)]

    for path in candidates:
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            line = line[7:].lstrip() if line.startswith("export ") else line
            name, sep, value = line.partition("=")
            if not sep:
                continue
            name = name.strip()
            value = value.strip().strip("'\"")
            if name and name not in os.environ:
                os.environ[name] = value
        if os.environ.get(ENV_KEY):
            return os.environ[ENV_KEY]
    return None


def safe_stem(value: str) -> str:
    """Nome di cartella sicuro a partire da un id di job."""
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in value) or "unnamed"


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


class ApiError(RuntimeError):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {body[:300]}")


# ----------------------------------------------------------------- trasporto

def multipart_encode(fields: list[tuple[str, str]],
                     files: list[tuple[str, pathlib.Path]]) -> tuple[str, bytes]:
    """Costruisce un corpo multipart/form-data con solo la stdlib.

    `files` e' una lista di coppie (nome_campo, path): il nome si ripete, che
    e' il modo documentato per passare piu' immagini di riferimento.
    """
    boundary = "----zaistory" + hashlib.sha1(os.urandom(16)).hexdigest()[:24]
    out = bytearray()
    for name, value in fields:
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += str(value).encode("utf-8") + b"\r\n"
    for name, path in files:
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        out += f"--{boundary}\r\n".encode()
        out += (f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{path.name}"\r\n').encode()
        out += f"Content-Type: {ctype}\r\n\r\n".encode()
        out += path.read_bytes() + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return f"multipart/form-data; boundary={boundary}", bytes(out)


def http_request(url, *, method="GET", headers=None, body=None, timeout=180):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers or {}), exc.read()


def request_with_retry(url, *, method="GET", headers=None, body=None,
                       timeout=180, attempts=MAX_ATTEMPTS):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            status, hdrs, payload = http_request(
                url, method=method, headers=headers, body=body, timeout=timeout)
        except Exception as exc:                      # rete giu', DNS, timeout
            last = ApiError(0, repr(exc))
            status = 0
            hdrs, payload = {}, b""
        else:
            if 200 <= status < 300:
                return hdrs, payload
            last = ApiError(status, payload.decode("utf-8", "replace"))
            if status not in RETRY_STATUS:
                raise last
        if attempt == attempts:
            break
        delay = float(hdrs.get("Retry-After") or 0) or min(2 ** attempt, 30)
        time.sleep(delay + random.uniform(0, 0.5))
    raise last


# -------------------------------------------------------------------- client

class Pollinations:
    def __init__(self, api_key: str | None, dry_run=False, verbose=False):
        self.api_key = api_key
        self.dry_run = dry_run
        self.verbose = verbose
        self._get_template = None                     # scoperto al primo uso

    def _headers(self, extra=None):
        h = {"Accept": "*/*", "User-Agent": "zaistory-generator/1"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        h.update(extra or {})
        return h

    # ---- tier ancore: text-only, con seed

    def text_to_image(self, *, prompt, model, width, height, seed):
        query = urllib.parse.urlencode({
            "model": model, "width": width, "height": height,
            "seed": seed, "nologo": "true",
        })
        quoted = urllib.parse.quote(prompt, safe="")
        candidates = ([self._get_template] if self._get_template else GET_TEMPLATES)
        url = candidates[0].format(prompt=quoted) + "?" + query

        if len(url) > MAX_GET_URL:
            # Il seed non e' documentato sulla POST: lo passiamo comunque (se
            # ignorato non fa danni) ma l'immagine non e' piu' riproducibile.
            return self.post_json(prompt=prompt, model=model, width=width,
                                  height=height, seed=seed), {
                "endpoint": "POST /v1/images/generations",
                "seed_honored": False,
                "note": "prompt troppo lungo per la GET, seed non garantito",
            }

        if self.dry_run:
            return b"", {"endpoint": "GET", "url": url, "seed_honored": True}

        last = None
        for template in candidates:
            url = template.format(prompt=quoted) + "?" + query
            try:
                hdrs, payload = request_with_retry(url, headers=self._headers())
            except ApiError as exc:
                last = exc
                if exc.status == 404:                 # path sbagliato: prova l'altro
                    continue
                raise
            self._get_template = template
            return payload, {"endpoint": "GET", "url": url, "seed_honored": True}
        raise last

    def post_json(self, *, prompt, model, width, height, seed=None, images=None):
        payload = {
            "prompt": prompt, "model": model,
            "size": f"{width}x{height}", "n": 1,
            "response_format": "b64_json",
        }
        if seed is not None:
            payload["seed"] = seed
        if images:
            payload["image"] = images
        body = json.dumps(payload).encode("utf-8")
        _, raw = request_with_retry(
            GEN_BASE + "/v1/images/generations", method="POST", body=body,
            headers=self._headers({"Content-Type": "application/json"}))
        return self._decode(raw)

    # ---- tier inquadrature: reference allegate in multipart

    def edits(self, *, prompt, model, width, height, refs: list[pathlib.Path],
              seed=None):
        """`seed` non e' fra i campi documentati di /v1/images/edits.

        Lo mandiamo lo stesso: se viene ignorato non fa danni, e se invece e'
        onorato il tier inquadrature torna riproducibile — cioe' si puo'
        rilanciare uno shot identico, o cambiare il solo seed per avere una
        variazione tenendo le stesse reference. `probe --seed-check` lo
        verifica empiricamente invece di fidarsi della documentazione.
        """
        fields = [("prompt", prompt), ("model", model),
                  ("size", f"{width}x{height}"), ("response_format", "b64_json")]
        if seed is not None:
            fields.append(("seed", seed))
        files = [("image", p) for p in refs]
        ctype, body = multipart_encode(fields, files)
        meta = {
            "endpoint": "POST /v1/images/edits",
            "seed_sent": seed,
            "request_bytes": len(body),
        }
        if self.dry_run:
            return b"", meta
        _, raw = request_with_retry(
            GEN_BASE + "/v1/images/edits", method="POST", body=body,
            headers=self._headers({"Content-Type": ctype}))
        return self._decode(raw), meta

    def _decode(self, raw: bytes) -> bytes:
        """La risposta OpenAI-compatible e' JSON: b64_json oppure url."""
        try:
            doc = json.loads(raw)
        except ValueError:
            return raw                                # gia' bytes d'immagine
        try:
            entry = doc["data"][0]
        except (KeyError, IndexError, TypeError):
            raise ApiError(200, raw.decode("utf-8", "replace"))
        if entry.get("b64_json"):
            return base64.b64decode(entry["b64_json"])
        if entry.get("url"):
            _, payload = request_with_retry(entry["url"], headers=self._headers())
            return payload
        raise ApiError(200, raw.decode("utf-8", "replace"))


# ---------------------------------------------------------------- reference

def make_reference(src: pathlib.Path, dst_dir: pathlib.Path, *,
                   max_side=768, fmt="webp", quality=82) -> pathlib.Path:
    """Copia ridotta di un'ancora, da allegare alla richiesta.

    Al modello serve l'identita' del soggetto, non il lossless: spedire i PNG
    a piena risoluzione significa qualche MB per ogni shot con due personaggi
    in campo, moltiplicato per tutte le inquadrature.
    """
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{src.stem}.{fmt}"
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst
    try:
        from PIL import Image
    except ImportError:
        print("  nota: Pillow assente, spedisco il PNG originale "
              "(richieste piu' pesanti)", file=sys.stderr)
        return src
    with Image.open(src) as im:
        im = im.convert("RGB")
        if max(im.size) > max_side:
            ratio = max_side / max(im.size)
            im = im.resize((round(im.width * ratio), round(im.height * ratio)),
                           Image.LANCZOS)
        im.save(dst, format=fmt.upper(), quality=quality)
    return dst


# ------------------------------------------------------------------ sidecar

def check_size(payload: bytes, want_w: int, want_h: int, *, fix=False):
    """Il modello ha davvero restituito la dimensione chiesta?

    Non e' pignoleria: `gptimage` accetta solo certi formati e arrotonda in
    silenzio — chiesti 1024x1024, tornati 1024x1536. Un tier di riparazione
    che consegna immagini di forma diversa da tutte le altre si vede in un
    player piu' del difetto che stava correggendo, e senza questo controllo
    te ne accorgi solo guardando.

    Con `fix` la si riporta alla forma giusta ritagliando dal centro; senza,
    si segnala e basta.
    """
    try:
        from PIL import Image
    except ImportError:
        return payload, None
    import io
    with Image.open(io.BytesIO(payload)) as im:
        got = im.size
        if got == (want_w, want_h):
            return payload, None
        note = f"dimensione {got[0]}x{got[1]} invece di {want_w}x{want_h}"
        if not fix:
            return payload, note
        # Ritaglio centrale alle proporzioni chieste, poi scala.
        target = want_w / want_h
        w, h = got
        if w / h > target:
            new_w = round(h * target)
            box = ((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h)
        else:
            new_h = round(w / target)
            box = (0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h)
        im = im.convert("RGB").crop(box).resize((want_w, want_h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue(), note + " — ritagliata al centro"


def sidecar_path(out_file: pathlib.Path) -> pathlib.Path:
    return out_file.with_suffix(out_file.suffix + ".json")


def write_sidecar(out_file, job, prompt, model, meta, refs_used):
    """Senza questo non si puo' costruire la griglia di selezione, e non si
    puo' sapere perche' un'immagine e' venuta male: il prompt effettivo e le
    ancore usate non sono ricostruibili a posteriori."""
    doc = {
        "sidecar_version": SIDECAR_VERSION,
        "job_id": job["id"],
        "level": job["level"],
        "kind": job["kind"],
        "generated_at": now_iso(),
        "model": model,
        "seed": job.get("seed"),
        "size": f"{job['width']}x{job['height']}",
        "prompt": prompt,
        "refs": [
            {"anchor": anchor_id, "file": str(path.name),
             "sha256": sha256_file(path)}
            for anchor_id, path in refs_used
        ],
        "api": meta,
    }
    sidecar_path(out_file).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


# ------------------------------------------------------------ orchestrazione

class Runner:
    def __init__(self, manifest, outdir, client, args):
        self.manifest = manifest
        self.outdir = outdir
        self.client = client
        self.args = args
        self.jobs = {j["id"]: j for j in manifest["jobs"]}
        self.refs_dir = outdir / "_refs"
        self.done, self.skipped, self.failed = [], [], []

    def out_file(self, job) -> pathlib.Path:
        return self.outdir / job["file"]

    def anchor_file(self, anchor_id) -> pathlib.Path | None:
        job = self.jobs.get(anchor_id)
        if not job:
            return None
        path = self.out_file(job)
        return path if path.exists() else None

    def resolve_refs(self, job, allow_missing=False):
        """Le ancore di cui l'inquadratura ha bisogno, gia' convertite.

        Con `allow_missing` (dry-run) le ancore non ancora generate non sono
        un errore: interessa sapere *quali* verrebbero allegate, non averle.
        """
        out, missing = [], []
        for anchor_id in job.get("deps") or []:
            src = self.anchor_file(anchor_id)
            if src is None:
                if allow_missing:
                    missing.append(anchor_id)
                    continue
                raise RuntimeError(
                    f"ancora mancante '{anchor_id}' — genera prima il livello "
                    f"anchors, oppure usa --no-refs")
            out.append((anchor_id, make_reference(
                src, self.refs_dir, max_side=self.args.ref_max_side,
                fmt=self.args.ref_format, quality=self.args.ref_quality)))
        return out, missing

    def run_job(self, job):
        out_file = self.out_file(job)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        model = self.args.model or job.get("model") or "zimage"

        seed = self.args.seed if self.args.seed is not None else job["seed"]
        use_refs = (job["level"] == "shot" and not self.args.no_refs
                    and job.get("deps"))
        if use_refs:
            refs, missing = self.resolve_refs(job, allow_missing=self.args.dry_run)
            prompt = job.get("prompt_ref") or job["prompt"]
            payload, meta = self.client.edits(
                prompt=prompt, model=model, width=job["width"],
                height=job["height"], refs=[p for _, p in refs], seed=seed)
            meta["refs"] = [a for a, _ in refs]
            if missing:
                meta["refs_missing"] = missing
                meta["note"] = (f"{len(refs)} reference pronte, "
                                f"{len(missing)} ancore da generare prima")
        else:
            refs = []
            prompt = job["prompt"]
            payload, meta = self.client.text_to_image(
                prompt=prompt, model=model, width=job["width"],
                height=job["height"], seed=seed)

        if self.args.dry_run:
            return ("dry", job, meta)

        if not payload or len(payload) < 512:
            raise RuntimeError(f"risposta vuota o troppo corta ({len(payload)} byte)")
        payload, size_note = check_size(payload, job["width"], job["height"],
                                        fix=self.args.fix_size)
        if size_note:
            meta["size_warning"] = size_note
            meta["note"] = size_note
        out_file.write_bytes(payload)
        write_sidecar(out_file, job, prompt, model, meta, refs)
        return ("ok", job, meta)

    def select(self):
        jobs = list(self.manifest["jobs"])
        if self.args.redo:
            wanted = set(self.args.redo)
            missing = wanted - set(self.jobs)
            if missing:
                raise SystemExit(f"job inesistenti nel manifest: {sorted(missing)}")
            return [j for j in jobs if j["id"] in wanted]
        if self.args.level != "all":
            level = "anchor" if self.args.level == "anchors" else "shot"
            jobs = [j for j in jobs if j["level"] == level]
        if not self.args.force:
            keep = []
            for job in jobs:
                if self.out_file(job).exists():
                    self.skipped.append(job["id"])
                else:
                    keep.append(job)
            jobs = keep
        return jobs

    def execute(self):
        jobs = self.select()
        # Ordine stretto: le inquadrature dipendono dai *file* delle ancore,
        # non solo dal loro testo. Nessuno shot puo' partire prima.
        anchors = [j for j in jobs if j["level"] == "anchor"]
        shots = [j for j in jobs if j["level"] != "anchor"]

        for batch, label in ((anchors, "ancore"), (shots, "inquadrature")):
            if not batch:
                continue
            print(f"\n{label}: {len(batch)} job")
            with futures.ThreadPoolExecutor(max_workers=self.args.jobs) as pool:
                pending = {pool.submit(self.run_job, j): j for j in batch}
                for fut in futures.as_completed(pending):
                    job = pending[fut]
                    try:
                        status, _, meta = fut.result()
                    except Exception as exc:
                        self.failed.append((job["id"], str(exc)))
                        print(f"  FALLITO {job['id']}: {exc}", file=sys.stderr)
                    else:
                        self.done.append(job["id"])
                        bits = [meta.get("endpoint", "")]
                        if "refs" in meta:
                            bits.append(f"{len(meta['refs'])} ref")
                        if meta.get("request_bytes"):
                            bits.append(f"{meta['request_bytes'] // 1024} KB")
                        if meta.get("note"):
                            bits.append(meta["note"])
                        print(f"  {status:4} {job['id']}  [{', '.join(b for b in bits if b)}]")


# ---------------------------------------------------------------- invalidazione

def check_stale(manifest, outdir) -> list[tuple[str, str]]:
    """Rigenerare un'ancora invalida ogni inquadratura che la conteneva.

    Il confronto e' sui byte effettivamente spediti, non sul manifest: e'
    l'unica cosa che dice la verita' dopo un --redo con un altro seed.
    """
    stale = []
    jobs = {j["id"]: j for j in manifest["jobs"]}
    for job in manifest["jobs"]:
        if job["level"] != "shot":
            continue
        out_file = outdir / job["file"]
        side = sidecar_path(out_file)
        if not out_file.exists() or not side.exists():
            continue
        doc = json.loads(side.read_text(encoding="utf-8"))
        for ref in doc.get("refs", []):
            anchor = jobs.get(ref["anchor"])
            if not anchor:
                continue
            current = outdir / "_refs" / pathlib.Path(anchor["file"]).with_suffix(
                pathlib.Path(ref["file"]).suffix).name
            if not current.exists():
                stale.append((job["id"], f"reference sparita: {ref['anchor']}"))
                break
            # La copia webp e' una cache: se l'ancora e' stata rigenerata dopo,
            # la cache e' vecchia e confrontarne l'hash direbbe "tutto a
            # posto" a torto. La mtime lo dice prima e senza riconvertire.
            src = outdir / anchor["file"]
            if src.exists() and src.stat().st_mtime > current.stat().st_mtime:
                stale.append((job["id"], f"ancora rigenerata: {ref['anchor']}"))
                break
            if sha256_file(current) != ref["sha256"]:
                stale.append((job["id"], f"ancora cambiata: {ref['anchor']}"))
                break
    return stale


# ---------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="assets_manifest.json -> immagini (Pollinations)")
    ap.add_argument("manifest")
    ap.add_argument("-o", "--out", required=True, help="cartella di output")
    ap.add_argument("--level", choices=["all", "anchors", "shots"], default="all")
    ap.add_argument("--jobs", type=int, default=3, help="richieste in parallelo")
    ap.add_argument("--model", help="forza il modello per questo giro")
    ap.add_argument("--seed", type=int, help="forza il seed (solo tier text-only)")
    ap.add_argument("--redo", nargs="+", metavar="JOB_ID",
                    help="rigenera solo questi job, ignorando i file esistenti")
    ap.add_argument("--upgrade", nargs="+", metavar="JOB_ID",
                    help="rigenera questi job col modello successivo nella scala "
                         "di preferenza, partendo da quello registrato nel sidecar")
    ap.add_argument("--registry", help=f"registro alternativo (default: {REGISTRY_NAME})")
    ap.add_argument("--force", action="store_true", help="rigenera tutto")
    ap.add_argument("--fix-size", action="store_true",
                    help="ritaglia al centro le immagini di dimensione sbagliata")
    ap.add_argument("--no-refs", action="store_true",
                    help="inquadrature text-only, senza ancore allegate")
    ap.add_argument("--ref-format", default="webp", choices=["webp", "jpeg"])
    ap.add_argument("--ref-max-side", type=int, default=768)
    ap.add_argument("--ref-quality", type=int, default=82)
    ap.add_argument("--dry-run", action="store_true",
                    help="costruisci le richieste senza spedirle")
    ap.add_argument("--check-stale", action="store_true",
                    help="elenca le inquadrature la cui ancora e' cambiata")
    ap.add_argument("--key", help=f"default: ${ENV_KEY}, o assets-studio/{PROFILE_NAME}")
    args = ap.parse_args(argv)
    args.key = load_profile(args.key)

    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.check_stale:
        stale = check_stale(manifest, outdir)
        if not stale:
            print("nessuna inquadratura da rifare: tutte le ancore combaciano")
            return 0
        print(f"{len(stale)} inquadrature con ancora cambiata:")
        for job_id, why in stale:
            print(f"  {job_id}  ({why})")
        print("\nper rifarle:\n  python generate.py ... --redo "
              + " ".join(j for j, _ in stale))
        return 1

    if not args.key and not args.dry_run:
        raise SystemExit(
            f"serve una chiave: esporta ${ENV_KEY}, mettila in "
            f"assets-studio/{PROFILE_NAME} (gia' ignorato da git), oppure passa --key")

    if args.redo:
        args.force = True

    # --upgrade: rifa' i job indicati col modello successivo nella scala,
    # leggendo dal sidecar con quale erano stati fatti. E' la forma
    # automatica di "questa non mi piace, riprovala con quello buono".
    if args.upgrade:
        reg = load_registry(args.registry)
        pref = reg["preference"]
        if not pref:
            raise SystemExit(f"nessuna scala di preferenza in {REGISTRY_NAME}")
        jobs = {j["id"]: j for j in manifest["jobs"]}
        plan, top = {}, []
        for job_id in args.upgrade:
            job = jobs.get(job_id)
            if not job:
                raise SystemExit(f"job inesistente nel manifest: {job_id}")
            side = sidecar_path(outdir / job["file"])
            used = job.get("model")
            if side.exists():
                try:
                    used = json.loads(side.read_text(encoding="utf-8")).get("model", used)
                except ValueError:
                    pass
            nxt = next_model(pref, used)
            if nxt is None:
                top.append((job_id, used))
            else:
                plan.setdefault(nxt, []).append((job_id, used))
        for job_id, used in top:
            print(f"  {job_id}: gia' su '{used}', in cima alla scala", file=sys.stderr)
        if not plan:
            print("niente da promuovere")
            return 0
        if len(plan) > 1:
            raise SystemExit(
                "i job indicati partono da modelli diversi e finirebbero su "
                "modelli diversi; rilanciali separati:\n" +
                "\n".join(f"  --upgrade {' '.join(j for j, _ in v)}   (-> {m})"
                          for m, v in plan.items()))
        model, items = next(iter(plan.items()))
        costo = reg["costs"].get(model)
        print(f"promozione a '{model}'" + (f" ({costo:.3f}$ x {len(items)} = "
              f"{costo * len(items):.2f}$)" if costo else ""))
        for job_id, used in items:
            print(f"  {job_id}: {used} -> {model}")
        args.redo = [j for j, _ in items]
        args.model = model
        args.force = True
        if not args.fix_size:
            # In cima alla scala ci sono modelli che restituiscono un formato
            # loro (gpt-image-2 ha dato 1536x1024 e 1254x1254 sulla stessa
            # storia). Un'immagine promossa che cambia forma si nota nel
            # player piu' del difetto che si voleva correggere.
            args.fix_size = True
            print("  (--fix-size attivo: le promozioni vengono riportate "
                  "alla dimensione del manifest)")

    client = Pollinations(args.key, dry_run=args.dry_run)
    runner = Runner(manifest, outdir, client, args)
    runner.execute()

    print(f"\nfatti {len(runner.done)}, saltati {len(runner.skipped)}, "
          f"falliti {len(runner.failed)}")
    if runner.failed:
        print("da riprovare:  --redo " + " ".join(j for j, _ in runner.failed))
    return 1 if runner.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
