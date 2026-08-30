#!/usr/bin/env python3
"""Test dei tre comandi di prototype.py con il trasporto HTTP stubbato.

Come selftest.py: nessuna rete, nessuna chiave. Verifica che probe sondi i
modelli giusti, che compare produca una variante per modello piu' la baseline
text-only, e che sheet costruisca un contact sheet autoportante.
"""
import base64, io, json, pathlib, random, shutil, sys, tempfile
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import generate, prototype

CALLS = []


def _img(seed=0, size=(320, 320)):
    rnd = random.Random(seed)
    im = Image.new("RGB", size)
    im.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
                for _ in range(size[0] * size[1])])
    return im


def fake_request(url, *, method="GET", headers=None, body=None, timeout=180):
    CALLS.append({"url": url, "method": method, "bytes": len(body or b"")})
    # Un seed diverso per chiamata: cosi' il controllo di riproducibilita'
    # deve dire NO, che e' il caso interessante da vedere stampato.
    buf = io.BytesIO()
    _img(seed=len(CALLS)).save(buf, format="PNG")
    png = buf.getvalue()
    if "/v1/images/" in url:
        return 200, {}, json.dumps(
            {"data": [{"b64_json": base64.b64encode(png).decode()}]}).encode()
    return 200, {}, png


generate.http_request = fake_request

tmp = pathlib.Path(tempfile.mkdtemp())
out = tmp / "out"

# ------------------------------------------------------------------ probe
print("=== probe ===")
prototype.main(["--key", "sk_test", "probe", "-o", str(out / "_probe"),
                "--models-text", "zimage", "flux",
                "--models-ref", "klein", "nanobanana",
                "--ref-counts", "1", "3",
                "--models-seed", "zimage", "--seed-check"])
rep = json.loads((out / "_probe" / "probe_report.json").read_text())
assert set(rep["text"]) == {"zimage", "flux"}
assert rep["refs"]["klein"]["3"]["ok"] if "3" in rep["refs"]["klein"] else \
    rep["refs"]["klein"][3]["ok"]
# Lo stub cambia immagine a ogni chiamata: il verdetto deve essere il ramo
# "non riproducibile", non un falso positivo.
assert rep["seed"]["zimage"]["verdict"] == "non riproducibile", rep["seed"]
assert rep["seed"]["zimage"]["stable"] is False
print("  report ok:", list(rep["text"]), "| ref:", list(rep["refs"]))

# ---------------------------------------------------------------- compare
manifest = json.load(open("/tmp/t/full.json"))
mpath = tmp / "manifest.json"
mpath.write_text(json.dumps(manifest))

print("\n=== compare (senza --yes: deve solo contare) ===")
before = len(CALLS)
prototype.main(["--key", "sk_test", "compare", str(mpath), "-o", str(out),
                "--shots", "1", "--models", "klein", "nanobanana"])
assert len(CALLS) == before, "senza --yes non deve chiamare niente"

print("\n=== compare --yes ===")
prototype.main(["--key", "sk_test", "compare", str(mpath), "-o", str(out),
                "--shots", "1", "--models", "klein", "nanobanana", "--yes"])
index = json.loads((out / "_proto" / "index.json").read_text())
variants = sorted(e["variant"] for e in index)
print("  varianti:", variants)
assert variants == ["klein", "nanobanana", "text-only"], variants
assert all(e["refs"] for e in index if e["variant"] != "text-only")
assert not [e for e in index if e["variant"] == "text-only"][0]["refs"]

# le ancore mancanti sono state generate prima, e sono su disco
anchors = list((out / "anchors").glob("*.png"))
print("  ancore generate:", len(anchors))
assert anchors

# la seconda passata non rigenera (cache)
before = len(CALLS)
prototype.main(["--key", "sk_test", "compare", str(mpath), "-o", str(out),
                "--shots", "1", "--models", "klein", "nanobanana", "--yes"])
assert len(CALLS) == before, "la seconda passata non deve richiamare l'API"
print("  seconda passata: nessuna chiamata, corretto")

# ------------------------------------------------------------------ sheet
print("\n=== sheet ===")
prototype.main(["sheet", "-o", str(out)])
html = (out / "_proto" / "contact_sheet.html").read_text()
assert "data:image/webp;base64," in html
assert "klein" in html and "text-only" in html
assert html.count("<div class=\"cell\">") >= 4      # ancore + varianti
print(f"  html {len(html)//1024} KB, {html.count('data:image')} immagini inline")

shutil.rmtree(tmp)
print("\nOK — prototipazione verificata")
