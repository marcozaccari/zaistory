#!/usr/bin/env python3
"""Prova la pubblicazione su una storia finta: niente rete, niente chiave.

Quello che deve restare vero, e che a mano si verificherebbe male:

- solo le immagini **approvate** finiscono nella storia;
- un'approvazione decade se l'immagine viene rigenerata dopo;
- l'id scritto nell'IR sta nel nodo giusto, e una variante d'ancora ripetuta
  in piu' scene li raggiunge tutti;
- ripubblicare senza cambiamenti non riscrive niente;
- togliere un'approvazione toglie l'id anche dall'IR;
- se il manifest e' vecchio e gli indici non tornano piu', ci si ferma invece
  di scrivere la faccia sbagliata nella scena sbagliata.
"""
import json, pathlib, shutil, sys, tempfile
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import extract_manifest
import publish as pubblica

IR = {
    "ir_version": "1.9.0",
    "id": "prova", "title": "Prova", "language": "it",
    "global_style": {"image_style_suffix": "stile", "anchor_framing": "waist-up"},
    "characters": [
        {"id": "ada", "name": "Ada", "visual_prompt": "donna in cappotto"},
        {"id": "bo", "name": "Bo", "visual_prompt": "uomo con cappello"},
    ],
    "places": [{"id": "molo", "name": "Il molo", "visual_prompt": "un molo di legno"}],
    "items": [{"id": "chiave", "name": "chiave", "visual_prompt": "una chiave di ottone"}],
    "start_scene": "uno",
    "scenes": [
        {"id": "uno", "title": "Uno",
         "background": {"image_prompt": "il molo all'alba", "place": "molo",
                        "characters_in_frame": ["ada"]},
         "narration": [{"text": "Comincia.", "image_prompt": "ada di spalle",
                        "place": "molo", "characters_in_frame": ["ada"]}],
         "characters": [{"id": "ada", "visual_prompt": "donna in cappotto, fradicia"}],
         "actions": [{"id": "vai", "label": "vai", "effect": {"goto_scene": "due"}}]},
        {"id": "due", "title": "Due",
         "background": {"image_prompt": "il molo a mezzogiorno", "place": "molo"},
         # Stesso override della scena uno: l'estrattore ne fa UNA sola ancora,
         # e la pubblicazione deve raggiungere anche questa scena.
         "characters": [{"id": "ada", "visual_prompt": "donna in cappotto, fradicia"}],
         "actions": [{"id": "fine", "label": "fine", "effect": {"goto_scene": "uno"}}]},
    ],
}


def img(path, colore):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (1536, 1536), colore).save(path)


def nodo(ir, source):
    return pubblica.resolve(ir, source)


tmp = pathlib.Path(tempfile.mkdtemp())
storia_dir = tmp / "stories" / "prova"
work = storia_dir / pubblica.WORK_DIR
(storia_dir).mkdir(parents=True)
(storia_dir / "story.ir.json").write_text(
    json.dumps(IR, ensure_ascii=False, indent=2), encoding="utf-8")

manifest = extract_manifest.Extractor(
    IR, "story.ir.json",
    {"width": 1024, "height": 1024, "steps": 8, "cfg": 0.0},
    {"anchors": "grok-imagine", "shots": "nanobanana-2-lite"}).build()
work.mkdir(parents=True)
(work / pubblica.MANIFEST_NAME).write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

jobs = {j["id"]: j for j in manifest["jobs"]}
print(f"manifest: {len(jobs)} job")
assert any(j["kind"] == "character_variant" for j in jobs.values())

# Tutte "generate": un colore per ciascuna, cosi' gli hash sono diversi.
for i, j in enumerate(jobs.values()):
    img(work / j["file"], (30 + i * 7 % 200, 60, 90))

storia = pubblica.Storia(storia_dir)


def approva(ids, value=True):
    s = pubblica.load_json(storia.settings_path)
    appr = s.setdefault("approved", {})
    for i in ids:
        if value:
            appr[i] = {"at": "ora", "sha256": pubblica.generate.sha256_file(work / jobs[i]["file"])}
        else:
            appr.pop(i, None)
    pubblica.write_json(storia.settings_path, s)


# --- 1. senza approvazioni non si pubblica niente ------------------------
r = pubblica.publish(storia)
assert r["nuove"] == [] and not r["ir_modificato"], r
assert not storia.images.exists() or not list(storia.images.iterdir())
print("1. nessuna approvazione -> niente pubblicato  ok")

# --- 2. si pubblica solo l'approvato -------------------------------------
variante = next(j for j in jobs.values() if j["kind"] == "character_variant")["id"]
approva(["anchor.char.ada", "shot.uno.bg", variante])
r = pubblica.publish(storia)
print(f"2. pubblicate {len(r['nuove'])}: {sorted(r['nuove'])}")
assert len(r["nuove"]) == 3, r
ir = json.loads((storia_dir / "story.ir.json").read_text(encoding="utf-8"))
assert nodo(ir, "characters[0]")["image"] == "anchor.char.ada"
assert nodo(ir, "scenes[0].background")["image"] == "shot.uno.bg"
assert "image" not in nodo(ir, "characters[1]")
# la variante ripetuta raggiunge entrambe le scene
uno = nodo(ir, "scenes[0].characters[0]")["image"]
due = nodo(ir, "scenes[1].characters[0]")["image"]
assert uno == due == pubblica.asset_id(variante), (uno, due)
print(f"   variante ripetuta in due scene -> {uno}  ok")

# --- 3. il file: webp, lato lungo 1024 -----------------------------------
f = storia.images / "shot.uno.bg.webp"
with Image.open(f) as im:
    print(f"3. {f.name}: {im.format} {im.size} {f.stat().st_size}B")
    assert im.format == "WEBP" and max(im.size) == 1024

# --- 4. ripubblicare non riscrive niente ---------------------------------
prima = f.stat().st_mtime_ns
r = pubblica.publish(storia)
assert len(r["invariate"]) == 3 and not r["nuove"], r
assert f.stat().st_mtime_ns == prima
assert not r["ir_modificato"]
print("4. seconda pubblicazione: 3 invariate, IR intatto  ok")

# --- 5. approvata e poi rigenerata: non passa ----------------------------
img(work / jobs["shot.uno.bg"]["file"], (200, 10, 10))
r = pubblica.publish(storia)
saltate = dict(r["saltate"])
assert "shot.uno.bg" in saltate, r
print(f"5. rigenerata dopo l'approvazione -> saltata ({saltate['shot.uno.bg']})  ok")
r = pubblica.publish(storia, force=True)
assert "shot.uno.bg" in r["aggiornate"], r
print("   con --force passa  ok")

# --- 6. togliere l'approvazione toglie l'id dall'IR ----------------------
approva(["shot.uno.bg"], value=False)
r = pubblica.publish(storia)
assert r["rimosse"] == ["shot.uno.bg"], r
ir = json.loads((storia_dir / "story.ir.json").read_text(encoding="utf-8"))
assert "image" not in nodo(ir, "scenes[0].background")
assert r["orfane"] == ["shot.uno.bg.webp"], r["orfane"]
print("6. approvazione tolta -> id via dall'IR, file segnalato come orfano  ok")
r = pubblica.publish(storia, prune=True)
assert not (storia.images / "shot.uno.bg.webp").exists()
print("   con --prune il file sparisce  ok")

# --- 7. manifest vecchio: ci si ferma ------------------------------------
ir = json.loads((storia_dir / "story.ir.json").read_text(encoding="utf-8"))
ir["scenes"].insert(0, {"id": "zero", "background": {"image_prompt": "buio"}, "actions": []})
(storia_dir / "story.ir.json").write_text(
    json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")
approva(["shot.uno.bg"])
r = pubblica.publish(storia)
assert r["errori"], r
print(f"7. IR cambiato sotto il manifest -> errore invece di scrittura sbagliata")
for job_id, why in r["errori"]:
    print(f"   {job_id}: {why}")

shutil.rmtree(tmp)
print("\nOK — tutti i controlli passati")
