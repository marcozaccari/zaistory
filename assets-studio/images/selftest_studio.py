#!/usr/bin/env python3
"""Prova lo storico dello studio: archiviazione e ripristino, senza rete.

E' il pezzo dove un errore non si vede subito — un file in piu' in una
cartella nascosta — e si scopre due settimane dopo, con lo storico pieno di
doppioni e nessuna idea di quale sia quale.

Quello che deve restare vero:

- rigenerare mette da parte quella attuale, non la cancella;
- «usa questa» e' uno **scambio**: lo storico non cresce, e la stessa immagine
  non esiste mai in due posti;
- andare avanti e indietro fra due tentativi non ne produce quattro;
- non si esce dalla cartella dello storico passando un percorso storto.
"""
import json, pathlib, shutil, sys, tempfile, time
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import generate
import studio as st

MANIFEST = {
    "manifest_version": 2, "story_id": "prova", "title": "Prova",
    "ir_file": "story.ir.json", "level": "all",
    "defaults": {"width": 64, "height": 64, "steps": 8, "cfg": 0.0},
    "models": {"anchors": "zimage", "shots": "klein"},
    "counts": {"anchors": 1, "shots": 0, "total": 1}, "warnings": [],
    "jobs": [{
        "id": "anchor.char.ada", "level": "anchor", "kind": "character",
        "entity_id": "ada", "name": "Ada", "prompt": "una donna",
        "model": "zimage", "source": "characters[0]",
        "file": "anchors/anchor.char.ada.png",
        "width": 64, "height": 64, "steps": 8, "cfg": 0.0, "seed": 1,
    }],
}


def scrivi(path, colore, modello):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 64), colore).save(path)
    generate.sidecar_path(path).write_text(json.dumps(
        {"job_id": "anchor.char.ada", "model": modello, "seed": 1,
         "prompt": "una donna", "generated_at": generate.now_iso(),
         "api": {"seconds": 1}, "refs": []}), encoding="utf-8")


def colore(path):
    with Image.open(path) as im:
        return im.convert("RGB").getpixel((1, 1))


def file_immagine(dentro):
    return sorted(p.name for p in dentro.rglob("*.png"))


tmp = pathlib.Path(tempfile.mkdtemp())
out = tmp / "_work"
out.mkdir(parents=True)
(out / "assets_manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")

studio = st.Studio(out / "assets_manifest.json", out, None)
job = studio.jobs["anchor.char.ada"]
cur = out / job["file"]
storico = out / st.VERSIONS_DIR / generate.safe_stem(job["id"])

ROSSO, VERDE = (200, 30, 30), (30, 200, 30)

scrivi(cur, ROSSO, "zimage")
# Il nome nello storico porta il minuto: due archiviazioni nello stesso
# secondo si distinguono da sole (il codice aggiunge -2), ma qui si vuole
# vedere anche che le date restino diverse.
time.sleep(1.1)

# --- 1. archiviare mette da parte, non cancella --------------------------
studio.archive(job)
assert not cur.exists(), "la corrente doveva essere spostata"
assert len(studio.versions(job)) == 1, studio.versions(job)
print("1. archiviata: 1 nello storico, niente in uso  ok")

scrivi(cur, VERDE, "klein")
assert len(studio.versions(job)) == 1
print("2. rigenerata: la nuova e' in uso, la vecchia resta una sola  ok")

# --- 3. «usa questa» e' uno scambio: lo storico non cresce ---------------
vecchia = studio.versions(job)[0]["file"]
studio.restore(job["id"], vecchia)
assert colore(cur) == ROSSO, colore(cur)
assert len(studio.versions(job)) == 1, studio.versions(job)
assert len(file_immagine(storico)) == 1, file_immagine(storico)
assert colore(storico / file_immagine(storico)[0]) == VERDE
print("3. ripristinata: 1 in uso, 1 nello storico, nessun doppione  ok")

# --- 4. avanti e indietro non moltiplica ---------------------------------
# Quattro scambi da uno stato con due immagini riportano a quello di partenza:
# e' l'andare avanti e indietro fra due tentativi, che e' il modo in cui si
# usa davvero lo storico.
for giro in range(4):
    v = studio.versions(job)[0]["file"]
    studio.restore(job["id"], v)
    assert len(studio.versions(job)) == 1, (giro, studio.versions(job))
    assert len(file_immagine(storico)) == 1, (giro, file_immagine(storico))
assert colore(cur) == ROSSO, colore(cur)
print("4. quattro ripensamenti: lo storico ha ancora una voce sola  ok")

# --- 5. il sidecar segue l'immagine --------------------------------------
side = json.loads(generate.sidecar_path(cur).read_text(encoding="utf-8"))
assert side["model"] == "zimage", side
assert len(list(storico.glob("*.json"))) == 1
print(f"5. il sidecar viaggia con lei: in uso c'e' {side['model']}  ok")

# --- 6. non si esce dallo storico ----------------------------------------
for storto in ("../../etc/passwd", "anchors/anchor.char.ada.png", "_versions/altro/x.png"):
    try:
        studio.restore(job["id"], storto)
    except ValueError:
        pass
    else:
        raise AssertionError(f"ha accettato {storto}")
print("6. percorsi fuori dallo storico: rifiutati  ok")

shutil.rmtree(tmp)
print("\nOK — tutti i controlli passati")
