#!/usr/bin/env python3
"""Fase di prototipazione: rispondere a poche domande spendendo pochissimo.

Le domande sono tre, in quest'ordine:

  1. l'API si comporta come dice la documentazione?   ->  probe
  2. il condizionamento su reference tiene l'identita' -> compare
     dei personaggi, e quale modello la tiene meglio?
  3. cosa vedo io guardandole?                        ->  sheet

Non e' la pipeline di produzione: quella e' `generate.py` e lavora su tutto
il manifest. Qui si spende il minimo indispensabile per decidere, e il conto
delle chiamate e' sempre stampato prima di farle.

Uso:
    export POLLINATIONS_API_KEY=sk_...
    python prototype.py probe --seed-check
    python prototype.py anchors manifest.json -o out --models zimage klein
    python prototype.py compare manifest.json -o out --shots 2
    python prototype.py sheet -o out
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import generate
from generate import (Pollinations, make_reference, now_iso, sha256_file)

PROTO_DIR = "_proto"

# I candidati del tier con reference, piu' `zimage` come tier economico.
MODELS_REF = ["klein", "nanobanana", "seedream5"]
MODELS_TEXT = ["zimage", "flux", "klein"]

# Modelli che secondo la documentazione onorano il seed. La sonda lo verifica
# davvero, perche' su un progetto che aggiunge modelli a questo ritmo la
# documentazione puo' restare indietro rispetto all'API.
MODELS_SEED = ["zimage", "flux", "klein", "p-image"]

# Modelli che NON accettano immagini allegate. In `compare` vanno mandati
# all'endpoint text-to-image con il prompt lungo, non a /v1/images/edits: se
# li si spedisse come gli altri fallirebbero, o peggio ignorerebbero gli
# allegati facendo sembrare che il condizionamento non serva.
TEXT_ONLY_MODELS = {"zimage", "flux", "p-image", "text-only"}


def _swatch(color, size=(256, 256), mark=None) -> bytes:
    """Immagine di prova per la sonda: non serve un'ancora vera."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, color)
    d = ImageDraw.Draw(im)
    d.ellipse([size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4],
              fill=(255, 255, 255))
    if mark:
        d.text((10, 10), mark, fill=(0, 0, 0))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _dims(payload: bytes):
    try:
        from PIL import Image
        with Image.open(io.BytesIO(payload)) as im:
            return f"{im.width}x{im.height}"
    except Exception:
        return "?"


# ------------------------------------------------------------------- probe

SEED_A, SEED_B = 4242, 90210


def _seed_probe(models, bucket, call):
    """Il seed e' onorato, ignorato, o e' solo la cache che risponde?

    Due chiamate identiche che tornano uguali NON dimostrano che il seed sia
    onorato: Pollinations serve una risposta in cache per richieste identiche,
    e la cache da' lo stesso identico file anche se il parametro viene
    scartato. Il tempo di risposta lo tradisce (millisecondi invece di
    secondi) ma non e' una prova.

    Servono tre chiamate: due con lo stesso seed e una con un seed diverso.
    Il verdetto e' `onorato` solo se le prime due coincidono E la terza
    differisce — cioe' se il seed e' davvero una leva sull'output.
    """
    for model in models:
        try:
            hashes, times = [], []
            for seed in (SEED_A, SEED_A, SEED_B):
                t0 = time.time()
                payload = call(model, seed)
                times.append(time.time() - t0)
                hashes.append(generate.hashlib.sha256(payload).hexdigest())
            stable = hashes[0] == hashes[1]
            varies = hashes[0] != hashes[2]
            if stable and varies:
                verdict, mark = "onorato", "SI  "
            elif stable:
                verdict, mark = "ignorato (seed diverso, stessa immagine)", "NO  "
            else:
                verdict, mark = "non riproducibile", "NO  "
            bucket[model] = {"ok": True, "verdict": verdict,
                             "stable": stable, "varies_with_seed": varies,
                             "seconds": [round(t, 2) for t in times]}
            cached = " (probabile cache)" if max(times) < 1.0 else ""
            print(f"  {mark}  {model:12} {verdict}{cached}")
            print(f"        {SEED_A}: {hashes[0][:10]} {hashes[1][:10]}  "
                  f"| {SEED_B}: {hashes[2][:10]}  "
                  f"| {'/'.join(f'{t:.1f}s' for t in times)}")
        except Exception as exc:
            bucket[model] = {"ok": False, "error": str(exc)[:200]}
            print(f"  FAIL  {model:12} {str(exc)[:80]}")

def cmd_probe(args):
    """Sonda l'API e stampa cosa funziona davvero.

    Le due incognite che la documentazione non chiude sono il path esatto
    della GET e il fatto che `seed` non compaia fra i campi della POST. Qui
    si scoprono in un minuto invece che a meta' di una generazione da 87 job.
    """
    client = Pollinations(args.key)
    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    report = {"probed_at": now_iso(), "text": {}, "refs": {}, "seed": {}}

    print("== text-to-image (GET) ==")
    for model in args.models_text:
        t0 = time.time()
        try:
            payload, meta = client.text_to_image(
                prompt="a single red cube on a white table, studio light",
                model=model, width=512, height=512, seed=1234)
            dt = time.time() - t0
            (outdir / f"probe.text.{model}.png").write_bytes(payload)
            report["text"][model] = {"ok": True, "seconds": round(dt, 1),
                                     "bytes": len(payload), "size": _dims(payload),
                                     "endpoint": meta.get("endpoint")}
            print(f"  ok    {model:12} {dt:5.1f}s  {len(payload)//1024:5} KB  {_dims(payload)}")
        except Exception as exc:
            report["text"][model] = {"ok": False, "error": str(exc)[:200]}
            print(f"  FAIL  {model:12} {str(exc)[:90]}")

    if client._get_template:
        report["get_template"] = client._get_template
        print(f"\n  path GET risolto: {client._get_template}")

    print("\n== reference (POST /v1/images/edits) ==")
    refs_dir = outdir / "_probe_refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    swatches = []
    for i, color in enumerate([(200, 40, 40), (40, 160, 60), (50, 70, 200)]):
        p = refs_dir / f"swatch{i}.png"
        p.write_bytes(_swatch(color, mark=str(i)))
        swatches.append(p)

    for model in args.models_ref:
        for n in args.ref_counts:
            t0 = time.time()
            try:
                payload, meta = client.edits(
                    prompt="combine the reference shapes into one still life",
                    model=model, width=512, height=512, refs=swatches[:n])
                dt = time.time() - t0
                (outdir / f"probe.ref{n}.{model}.png").write_bytes(payload)
                size = _dims(payload)
                report["refs"].setdefault(model, {})[n] = {
                    "ok": True, "seconds": round(dt, 1), "bytes": len(payload),
                    "size": size, "size_requested": "512x512",
                    "request_bytes": meta.get("request_bytes")}
                # La dimensione va guardata anche qui, non solo sul lato testo:
                # piu' di un modello ignora `size` e restituisce il formato che
                # preferisce, e sul tier inquadrature significa asset di forma
                # diversa dagli altri.
                flag = "" if size == "512x512" else "  <- dimensione ignorata"
                print(f"  ok    {model:12} {n} ref  {dt:5.1f}s  "
                      f"{len(payload)//1024:5} KB  {size}{flag}")
            except Exception as exc:
                report["refs"].setdefault(model, {})[n] = {"ok": False,
                                                           "error": str(exc)[:200]}
                print(f"  FAIL  {model:12} {n} ref  {str(exc)[:80]}")

    if args.seed_check:
        print("\n== seed su edits (POST) ==")
        _seed_probe(
            args.models_ref, report.setdefault("seed_edits", {}),
            lambda model, seed: client.edits(
                prompt="combine the reference shapes into one still life",
                model=model, width=512, height=512, refs=swatches[:2],
                seed=seed)[0])

        print("\n== seed su text-to-image (GET) ==")
        _seed_probe(
            args.models_seed, report["seed"],
            lambda model, seed: client.text_to_image(
                prompt="a lone lighthouse at dusk", model=model,
                width=512, height=512, seed=seed)[0])

    path = outdir / "probe_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nreport: {path}")
    return 0


# ----------------------------------------------------------------- ancore

def is_current(target: pathlib.Path, variant: str, prompt: str) -> bool:
    """La variante su disco e' stata prodotta con QUESTO prompt?

    Saltare per sola presenza del file e' sbagliato qui: se il prompt cambia —
    traduzione, taglio, correzione di un personaggio — l'immagine vecchia
    resta e il confronto mette a paragone due cose diverse senza dirlo. Il
    sidecar registra il prompt effettivo, quindi la domanda si puo' porre.
    """
    png, side = target / f"{variant}.png", target / f"{variant}.json"
    if not png.exists() or not side.exists():
        return False
    try:
        return json.loads(side.read_text(encoding="utf-8")).get("prompt") == prompt
    except (ValueError, OSError):
        return False


REJECTED_NAME = "rejected.json"
COSTS_NAME = "model_costs.json"


def load_costs(explicit=None) -> dict:
    """Costo per immagine, per modello, in dollari.

    Il listino espone "chiamate per dollaro": qui si converte una volta sola.
    Sta in un file accanto agli script perche' i prezzi cambiano e non voglio
    che finiscano dentro il codice. Un modello assente non vale zero: vale
    ignoto, e nel foglio compare senza prezzo.
    """
    return generate.load_registry(explicit)["costs"]


def load_rejected(proto: pathlib.Path) -> dict:
    """Le varianti scartate a occhio, per inquadratura.

    Non si cancellano i file: un giudizio si puo' cambiare, e rigenerare
    un'immagine costa. Restano su disco e spariscono solo dal foglio.
    """
    path = proto / REJECTED_NAME
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def cmd_reject(args):
    proto = pathlib.Path(args.out) / PROTO_DIR
    proto.mkdir(parents=True, exist_ok=True)
    rej = load_rejected(proto)
    key = args.shot
    current = set(rej.get(key, []))
    if args.undo:
        current -= set(args.variants)
    else:
        current |= set(args.variants)
    rej[key] = sorted(current)
    (proto / REJECTED_NAME).write_text(
        json.dumps(rej, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{key}: {len(rej[key])} varianti scartate")
    for v in rej[key]:
        print(f"  {v}")
    return 0


def _append_index(proto: pathlib.Path, rows: list) -> pathlib.Path:
    idx = proto / "index.json"
    old = json.loads(idx.read_text(encoding="utf-8")) if idx.exists() else []
    idx.write_text(json.dumps(old + rows, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    return idx


def cmd_anchors(args):
    """La stessa ancora generata da piu' modelli, per confrontarli.

    Serve a separare due cause che si confondono: se un'ancora ignora
    l'inquadratura neutra chiesta da ANCHOR_FRAMING, la colpa puo' essere del
    modello o del prompt (lungo, e in italiano). Generandola con modelli
    diversi e lo stesso identico prompt, la risposta si legge a occhio.

    Non tocca `anchors/`: le varianti vanno in `_proto/`, cosi' le ancore
    buone gia' prodotte restano dove sono.
    """
    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    outdir = pathlib.Path(args.out)
    jobs = {j["id"]: j for j in manifest["jobs"]}

    if args.anchor:
        missing = [a for a in args.anchor if a not in jobs]
        if missing:
            raise SystemExit(f"ancore inesistenti nel manifest: {missing}")
        anchors = [jobs[a] for a in args.anchor]
    else:
        # I personaggi per primi: e' li' che l'identita' conta.
        order = {"character": 0, "character_variant": 1, "place": 2, "item": 3}
        cand = [j for j in manifest["jobs"] if j["level"] == "anchor"]
        cand.sort(key=lambda j: (order.get(j["kind"], 9), j["id"]))
        anchors = cand[:args.anchors]

    proto = outdir / PROTO_DIR
    todo = [(a, m) for a in anchors for m in args.models
            if args.force or not is_current(proto / generate.safe_stem(a["id"]),
                                            m, a["prompt"])]
    stale = [(a, m) for a, m in todo
             if (proto / generate.safe_stem(a["id"]) / f"{m}.png").exists()]

    print(f"ancore: {len(anchors)}")
    for a in anchors:
        print(f"  {a['id']}  ({a['kind']})")
    print(f"modelli: {', '.join(args.models)}")
    already = len(anchors) * len(args.models) - len(todo)
    if already:
        print(f"varianti gia' presenti e aggiornate (saltate): {already}")
    if stale:
        print(f"varianti da rifare perche' il prompt e' cambiato: {len(stale)}")
    print(f"\nCHIAMATE TOTALI: {len(todo)}")
    if not todo:
        print("niente da fare — usa --force per rigenerare")
        return 0
    if not args.yes:
        print("(rilancia con --yes per eseguire)")
        return 0

    client = Pollinations(args.key)
    rows = []
    for anchor, model in todo:
        target = proto / generate.safe_stem(anchor["id"])
        target.mkdir(parents=True, exist_ok=True)
        dst = target / f"{model}.png"
        t0 = time.time()
        try:
            payload, meta = client.text_to_image(
                prompt=anchor["prompt"], model=model, width=anchor["width"],
                height=anchor["height"], seed=anchor["seed"])
        except Exception as exc:
            print(f"  FALLITO {anchor['id']} / {model}: {str(exc)[:120]}")
            continue
        dt = time.time() - t0
        dst.write_bytes(payload)
        entry = {"shot": anchor["id"], "variant": model, "model": model,
                 "file": str(dst.relative_to(outdir)), "refs": [],
                 "seed": anchor["seed"], "seconds": round(dt, 1),
                 "bytes": len(payload), "prompt": anchor["prompt"],
                 "generated_at": now_iso()}
        rows.append(entry)
        (target / f"{model}.json").write_text(
            json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  ok {anchor['id']} / {model}  {dt:5.1f}s")

    _append_index(proto, rows)
    print(f"\n{len(rows)} varianti in {proto}")
    print(f"ora guardale:  python prototype.py sheet -o {outdir}")
    return 0


# ----------------------------------------------------------------- compare

def pick_shots(manifest, n):
    """Le inquadrature che mettono alla prova il condizionamento: quelle con
    piu' personaggi in campo, dove il rischio che il modello li mescoli e'
    massimo."""
    shots = [j for j in manifest["jobs"] if j["level"] == "shot" and j.get("deps")]
    shots.sort(key=lambda j: (-len(j["deps"]), j["id"]))
    return shots[:n]


def cmd_compare(args):
    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    outdir = pathlib.Path(args.out)
    jobs = {j["id"]: j for j in manifest["jobs"]}

    shots = ([jobs[s] for s in args.shot] if args.shot
             else pick_shots(manifest, args.shots))
    if not shots:
        raise SystemExit("nessuna inquadratura con dipendenze nel manifest")

    # Le ancore servono come file, non come testo: senza, non c'e' niente da
    # allegare e il confronto non ha oggetto.
    needed = []
    for shot in shots:
        for dep in shot["deps"]:
            if dep not in needed:
                needed.append(dep)
    def _anchor_current(anchor_id):
        """Un'ancora prodotta con un prompt diverso non e' riusabile.

        Cambiare `image_style_suffix` cambia il prompt di tutte le ancore: se
        qui si guardasse la sola esistenza del file, il confronto userebbe
        ancore del vecchio stile dentro inquadrature del nuovo, e il risultato
        non direbbe niente."""
        path = outdir / jobs[anchor_id]["file"]
        if not path.exists():
            return False
        side = generate.sidecar_path(path)
        if not side.exists():
            return False
        try:
            return json.loads(side.read_text(encoding="utf-8")).get("prompt") == \
                jobs[anchor_id]["prompt"]
        except (ValueError, OSError):
            return False

    missing = [d for d in needed if not _anchor_current(d)]

    # Una "variante" e' una coppia (modello, con-o-senza-reference). Lo stesso
    # modello puo' comparire due volte — `klein` e `klein-text` — ed e' il
    # confronto piu' informativo che ci sia: dice quanto vale il
    # condizionamento *a parita' di modello*, invece di confondere la
    # differenza fra modelli con la differenza fra i due tier.
    def spec(variant):
        """variante -> (modello, usa_reference)"""
        if variant == "text-only":
            return args.text_model, False
        if variant.endswith("-text"):
            return variant[:-len("-text")], False
        if variant in TEXT_ONLY_MODELS:
            return variant, False
        return variant, True

    variants, seen = [], set()
    for v in (list(args.models)
              + [f"{m}-text" for m in (args.text_models or [])]
              + (["text-only"] if args.baseline else [])):
        key = spec(v)
        if key in seen:
            continue
        seen.add(key)
        variants.append(v)
    proto_dir = outdir / PROTO_DIR
    def _prompt_for(shot, variant):
        _, use_refs = spec(variant)
        return (shot.get("prompt_ref") or shot["prompt"]) if use_refs else shot["prompt"]

    todo = [(s, v) for s in shots for v in variants
            if args.force or not is_current(proto_dir / generate.safe_stem(s["id"]),
                                            v, _prompt_for(s, v))]
    calls = len(missing) + len(todo)

    print(f"inquadrature: {len(shots)}")
    for s in shots:
        print(f"  {s['id']}  ({len(s['deps'])} ref: {', '.join(s['deps'])})")
    print(f"varianti per inquadratura: {', '.join(variants)}")
    print(f"ancore da (ri)generare prima: {len(missing)}")
    already = len(shots) * len(variants) - len(todo)
    if already:
        print(f"varianti gia' presenti e aggiornate (saltate): {already}")
    # Il conto e' il punto del pre-volo: nessuna chiamata parte senza che tu
    # abbia visto quante sono.
    print(f"\nCHIAMATE TOTALI: {calls}")
    if calls == 0:
        print("niente da fare — usa --force per rigenerare")
        return 0
    if not args.yes:
        print("(rilancia con --yes per eseguire)")
        return 0

    client = Pollinations(args.key)
    refs_dir = outdir / "_refs"
    proto = outdir / PROTO_DIR
    proto.mkdir(parents=True, exist_ok=True)
    index = []

    for anchor_id in missing:
        job = jobs[anchor_id]
        dst = outdir / job["file"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        print(f"ancora {anchor_id} ...", flush=True)
        model = job.get("model") or "zimage"
        payload, meta = client.text_to_image(
            prompt=job["prompt"], model=model,
            width=job["width"], height=job["height"], seed=job["seed"])
        dst.write_bytes(payload)
        generate.write_sidecar(dst, job, job["prompt"], model, meta, [])

    for shot in shots:
        refs = [(d, make_reference(outdir / jobs[d]["file"], refs_dir,
                                   max_side=args.ref_max_side,
                                   fmt=args.ref_format, quality=args.ref_quality))
                for d in shot["deps"]]
        target = proto / generate.safe_stem(shot["id"])
        target.mkdir(parents=True, exist_ok=True)

        for variant in variants:
            dst = target / f"{variant}.png"
            if not args.force and is_current(target, variant,
                                             _prompt_for(shot, variant)):
                print(f"  salto {shot['id']} / {variant} (gia' aggiornata)")
                continue
            t0 = time.time()
            try:
                model, use_refs = spec(variant)
                if not use_refs:
                    payload, meta = client.text_to_image(
                        prompt=shot["prompt"], model=model,
                        width=shot["width"], height=shot["height"],
                        seed=shot["seed"])
                    used = []
                else:
                    payload, meta = client.edits(
                        prompt=shot.get("prompt_ref") or shot["prompt"],
                        model=model, width=shot["width"],
                        height=shot["height"], refs=[p for _, p in refs],
                        seed=shot["seed"])
                    used = [{"anchor": a,
                             "file": str((outdir / jobs[a]["file"]).relative_to(outdir))}
                            for a, _ in refs]
            except Exception as exc:
                print(f"  FALLITO {shot['id']} / {variant}: {str(exc)[:120]}")
                continue
            dt = time.time() - t0
            dst.write_bytes(payload)
            entry = {
                "shot": shot["id"], "variant": variant,
                "model": spec(variant)[0],
                "file": str(dst.relative_to(outdir)),
                "refs": used, "seed": shot["seed"],
                "seconds": round(dt, 1), "bytes": len(payload),
                "prompt": (shot["prompt"] if variant == "text-only"
                           else shot.get("prompt_ref") or shot["prompt"]),
                "generated_at": now_iso(),
            }
            index.append(entry)
            (target / f"{variant}.json").write_text(
                json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  ok {shot['id']} / {variant}  {dt:5.1f}s")

    _append_index(proto, index)
    print(f"\n{len(index)} varianti in {proto}")
    print(f"ora guardale:  python prototype.py sheet -o {outdir}")
    return 0


# ------------------------------------------------------------------- sheet

def _price(costs: dict, model: str) -> str:
    """Il prezzo per immagine, e quanto costerebbero 64 inquadrature."""
    c = costs.get(model)
    if c is None:
        return ""
    return f'</div><div class="cost">{c:.3f}$ · {c * 64:.2f}$ per 64'


def _thumb_uri(path: pathlib.Path, max_side=420) -> str:
    """Miniatura webp inline: il contact sheet resta un file solo, apribile
    ovunque, senza cartelle di immagini al seguito."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            im = im.convert("RGB")
            if max(im.size) > max_side:
                r = max_side / max(im.size)
                im = im.resize((round(im.width * r), round(im.height * r)),
                               Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=80)
            data, mime = buf.getvalue(), "image/webp"
    except ImportError:
        data, mime = path.read_bytes(), "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


HTML_HEAD = """<!doctype html><meta charset="utf-8">
<title>Prototipazione asset — confronto modelli</title>
<style>
 :root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1a1a19;--mut:#6b6b68;--line:#e3e3e0;--card:#fff}
 @media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#eeeeec;--mut:#9a9a96;--line:#2b2b29;--card:#1c1c1a}}
 body{margin:0;padding:28px;background:var(--bg);color:var(--fg);
      font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
 h1{font-size:19px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 26px}
 h2{font-size:15px;margin:30px 0 4px;font-family:ui-monospace,monospace}
 .meta{color:var(--mut);font-size:12px;margin:0 0 12px}
 /* Le ancore stanno in una striscia compatta, le varianti in una griglia che
    va a capo: devono essere tutte sullo schermo insieme, altrimenti non le
    stai confrontando, le stai guardando una per volta. */
 .anchors{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
 .anchors .cell{width:104px}
 .row{display:grid;gap:16px;
      grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
 .cell img{width:100%;border-radius:7px;border:1px solid var(--line);
           background:var(--card);display:block}
 .lab{font-size:12px;margin-top:6px;font-weight:600}
 .lab.anchor{color:var(--mut);font-weight:500;font-size:11px;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .num{color:var(--mut);font-size:11px;font-family:ui-monospace,monospace}
 .cost{font-size:11px;font-family:ui-monospace,monospace;margin-top:2px;
       color:var(--fg);opacity:.75;font-weight:600}
 details{margin-top:6px} summary{font-size:11px;color:var(--mut);cursor:pointer}
 pre{white-space:pre-wrap;font-size:11px;color:var(--mut);
     border-left:2px solid var(--line);padding-left:8px;margin:6px 0 0}
</style>
"""


def cmd_sheet(args):
    outdir = pathlib.Path(args.out)
    proto = outdir / PROTO_DIR
    idx_path = proto / "index.json"
    if not idx_path.exists():
        raise SystemExit(f"niente da mostrare: manca {idx_path} (lancia prima compare)")
    index = json.loads(idx_path.read_text(encoding="utf-8"))
    rejected = {} if args.show_rejected else load_rejected(proto)
    costs = load_costs(args.costs)

    # L'ultima variante generata vince, cosi' un --force non lascia doppioni.
    latest, hidden = {}, 0
    for e in index:
        if e["variant"] in rejected.get(e["shot"], []):
            hidden += 1
            continue
        latest[(e["shot"], e["variant"])] = e
    if hidden:
        print(f"  {hidden} varianti scartate, nascoste dal foglio "
              f"(--show-rejected per rivederle)")

    by_shot = {}
    for (shot, _), e in latest.items():
        by_shot.setdefault(shot, []).append(e)

    spesa = sum(costs.get(e["model"], 0.0) for e in latest.values())
    ignoti = sorted({e["model"] for e in latest.values() if e["model"] not in costs})
    testa = (f'{len(by_shot)} inquadrature, {len(latest)} varianti'
             f' · {spesa:.2f}$ di immagini mostrate' if costs else
             f'{len(by_shot)} inquadrature, {len(latest)} varianti')
    if ignoti:
        testa += f' · prezzo ignoto: {", ".join(ignoti)}'
    parts = [HTML_HEAD,
             "<h1>Prototipazione asset — confronto modelli</h1>",
             f'<p class="sub">{testa} · {now_iso()}</p>']

    for shot in sorted(by_shot):
        # Ordinate per costo crescente: il foglio serve a decidere, e la
        # domanda e' sempre "quanto mi costa di piu' quella li' a destra".
        # I modelli senza prezzo in fondo, per non farli sembrare gratis.
        entries = sorted(by_shot[shot], key=lambda e: (
            costs.get(e["model"]) is None, costs.get(e["model"], 0), e["variant"]))
        refs = next((e["refs"] for e in entries if e.get("refs")), [])
        parts.append(f"<h2>{shot}</h2>")
        parts.append(f'<p class="meta">{len(refs)} reference · '
                     f'{", ".join(r["anchor"] for r in refs) if refs else "nessuna"}</p>')
        parts.append('<div class="anchors">')
        for ref in refs:
            path = outdir / ref["file"]
            if path.exists():
                parts.append(
                    f'<div class="cell"><img src="{_thumb_uri(path, 200)}">'
                    f'<div class="lab anchor" title="{ref["anchor"]}">'
                    f'{ref["anchor"]}</div></div>')
        parts.append('</div><div class="row">')
        for e in entries:
            path = outdir / e["file"]
            if not path.exists():
                continue
            parts.append(
                f'<div class="cell"><img src="{_thumb_uri(path)}">'
                f'<div class="lab">{e["variant"]}</div>'
                f'<div class="num">{e["model"]} · {e["seconds"]}s · '
                f'{e["bytes"] // 1024} KB{_price(costs, e["model"])}</div>'
                f'<details><summary>prompt</summary><pre>{e["prompt"]}</pre>'
                f'</details></div>')
        parts.append("</div>")

    dst = pathlib.Path(args.sheet or (proto / "contact_sheet.html"))
    dst.write_text("\n".join(parts), encoding="utf-8")
    print(f"{dst}  ({dst.stat().st_size // 1024} KB)")
    return 0


# -------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="fase di prototipazione su Pollinations")
    ap.add_argument("--key", help=f"default: ${generate.ENV_KEY}, o "
                                  f"assets-studio/{generate.PROFILE_NAME}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("probe", help="sonda l'API: cosa funziona davvero")
    p.add_argument("-o", "--out", default="assets-studio/out/_probe")
    p.add_argument("--models-text", nargs="+", default=MODELS_TEXT)
    p.add_argument("--models-ref", nargs="+", default=MODELS_REF)
    p.add_argument("--models-seed", nargs="+", default=MODELS_SEED)
    p.add_argument("--ref-counts", nargs="+", type=int, default=[1, 3])
    p.add_argument("--seed-check", action="store_true",
                   help="due chiamate identiche per modello, confronta gli hash")
    p.set_defaults(func=cmd_probe)

    a = sub.add_parser("anchors", help="stessa ancora su piu' modelli")
    a.add_argument("manifest")
    a.add_argument("-o", "--out", required=True)
    a.add_argument("--anchor", nargs="+", help="id espliciti")
    a.add_argument("--anchors", type=int, default=5, help="quante (default 5)")
    a.add_argument("--models", nargs="+", default=["zimage", "klein"])
    a.add_argument("--force", action="store_true")
    a.add_argument("--yes", action="store_true")
    a.set_defaults(func=cmd_anchors)

    c = sub.add_parser("compare", help="stesso shot su piu' modelli")
    c.add_argument("manifest")
    c.add_argument("-o", "--out", required=True)
    c.add_argument("--shot", nargs="+", help="id espliciti; default: i piu' affollati")
    c.add_argument("--shots", type=int, default=2, help="quante inquadrature")
    c.add_argument("--models", nargs="+", default=MODELS_REF,
                   help="modelli da provare CON le reference allegate")
    c.add_argument("--text-models", nargs="+", default=[], metavar="MODEL",
                   help="modelli da provare SENZA reference; compaiono come "
                        "'<modello>-text' accanto alla loro versione condizionata")
    c.add_argument("--text-model", default="zimage", help="modello della baseline")
    c.add_argument("--baseline", action="store_true", default=True,
                   help="aggiungi la variante text-only (default: si)")
    c.add_argument("--no-baseline", dest="baseline", action="store_false")
    c.add_argument("--force", action="store_true")
    c.add_argument("--yes", action="store_true", help="esegui davvero le chiamate")
    c.add_argument("--ref-format", default="webp", choices=["webp", "jpeg"])
    c.add_argument("--ref-max-side", type=int, default=768)
    c.add_argument("--ref-quality", type=int, default=82)
    c.set_defaults(func=cmd_compare)

    s = sub.add_parser("sheet", help="contact sheet HTML delle varianti")
    s.add_argument("-o", "--out", required=True)
    s.add_argument("--sheet", help="percorso del file HTML")
    s.add_argument("--costs", help=f"listino alternativo (default: {COSTS_NAME} accanto agli script)")
    s.add_argument("--show-rejected", action="store_true",
                   help="mostra anche le varianti scartate")
    s.set_defaults(func=cmd_sheet)

    r = sub.add_parser("reject", help="scarta varianti da un'inquadratura")
    r.add_argument("-o", "--out", required=True)
    r.add_argument("--shot", required=True)
    r.add_argument("--variants", nargs="+", required=True)
    r.add_argument("--undo", action="store_true", help="rimetti in lista")
    r.set_defaults(func=cmd_reject)

    args = ap.parse_args(argv)
    args.key = generate.load_profile(args.key)
    if args.cmd in ("probe", "compare", "anchors") and not args.key:
        raise SystemExit(
            f"serve una chiave: esporta ${generate.ENV_KEY}, mettila in "
            f"assets-studio/{generate.PROFILE_NAME} (gia' ignorato da git), "
            f"oppure passa --key")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
