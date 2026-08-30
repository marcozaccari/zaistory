#!/usr/bin/env python3
"""Test end-to-end del generatore senza rete: il trasporto HTTP e' stubbato.

Verifica quello che si puo' verificare a chiave assente — che le richieste
siano costruite bene, che le reference vengano convertite e allegate, che il
sidecar registri gli hash giusti e che --check-stale se ne accorga quando
un'ancora cambia.
"""
import io, json, pathlib, shutil, sys, tempfile
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import generate

CALLS = []


def _noise(size=(320, 320), seed=0):
    """Un PNG che pesa piu' del minimo di sanita' del generatore (512 byte)."""
    import random
    rnd = random.Random(seed)
    im = Image.new("RGB", size)
    im.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
                for _ in range(size[0] * size[1])])
    return im


def fake_request(url, *, method="GET", headers=None, body=None, timeout=180):
    """Sostituisce il trasporto: registra la chiamata, ritorna un PNG finto."""
    CALLS.append({"url": url, "method": method, "bytes": len(body or b""),
                  "ctype": (headers or {}).get("Content-Type", "")})
    buf = io.BytesIO()
    _noise().save(buf, format="PNG")
    png = buf.getvalue()
    if "/v1/images/" in url:
        import base64
        doc = {"data": [{"b64_json": base64.b64encode(png).decode()}]}
        return 200, {}, json.dumps(doc).encode()
    return 200, {}, png


generate.http_request = fake_request

tmp = pathlib.Path(tempfile.mkdtemp())
out = tmp / "out"

# Il manifest si estrae qui, dalla storia di riferimento: dipendere da un file
# lasciato in giro da una sessione precedente e' il modo piu' sicuro di avere
# un test che passa sulla macchina di chi l'ha scritto e su nessun'altra.
import extract_manifest
STORIA = pathlib.Path(__file__).resolve().parents[2] / "stories" / "metal-head" / "story.ir.json"
ir = json.loads(STORIA.read_text(encoding="utf-8"))
manifest = extract_manifest.Extractor(
    ir, STORIA.name,
    {"width": 1024, "height": 1024, "steps": 8, "cfg": 0.0},
    {"anchors": "zimage", "shots": "klein"}).build()

# Un sottoinsieme: due ancore personaggio, la loro ancora luogo, e uno shot
# che le referenzia entrambe.
shot = next(j for j in manifest["jobs"] if j["id"] == "shot.auto_in_viaggio.n1")
needed = set(shot["deps"])
jobs = [j for j in manifest["jobs"] if j["id"] in needed] + [shot]
manifest["jobs"] = jobs

args = generate.argparse.Namespace(
    level="all", jobs=2, model=None, seed=None, redo=None, force=False,
    no_refs=False, ref_format="webp", ref_max_side=768, ref_quality=82,
    dry_run=False, fix_size=False, key="sk_test")

client = generate.Pollinations("sk_test")
runner = generate.Runner(manifest, out, client, args)
runner.execute()

print("\n=== chiamate ===")
for c in CALLS:
    print(f"  {c['method']:4} {c['url'][:78]}  body={c['bytes']}B {c['ctype'][:40]}")

assert not runner.failed, runner.failed
assert len(runner.done) == 4, runner.done

# --- il multipart dello shot contiene davvero 3 allegati?
multipart = [c for c in CALLS if "edits" in c["url"]]
assert len(multipart) == 1, multipart
assert multipart[0]["bytes"] > 0

# --- reference convertite in webp e ridotte?
refs = sorted((out / "_refs").glob("*.webp"))
print("\n=== reference ===")
for r in refs:
    with Image.open(r) as im:
        print(f"  {r.name}  {im.size}  {r.stat().st_size}B  {im.format}")
assert len(refs) == 3, refs

# --- sidecar
side = json.load(open(out / shot["file"] + ".json")) if False else json.load(
    open(str(out / shot["file"]) + ".json"))
print("\n=== sidecar dello shot ===")
print(json.dumps({k: side[k] for k in
                  ("job_id", "model", "size", "api")}, ensure_ascii=False, indent=2))
print("  refs:", [(r["anchor"], r["sha256"][:12]) for r in side["refs"]])
assert len(side["refs"]) == 3
assert side["model"] == "klein"
# La premessa del tier con reference: senza, l'endpoint di editing
# *modifica* la prima immagine invece di comporne una nuova.
assert "compose a NEW shot" in side["prompt"], side["prompt"][:120]
assert "attached references" in side["prompt"], side["prompt"][:200]

# --- invalidazione: tocco un'ancora e la conversione cambia
print("\n=== check-stale prima ===")
print(" ", generate.check_stale(manifest, out) or "nessuna, corretto")

anchor = next(j for j in manifest["jobs"] if j["id"] == "anchor.char.laura")
src = out / anchor["file"]
_noise(seed=99).save(src)          # "rigenerata"
generate.make_reference(src, out / "_refs", max_side=768, fmt="webp")

print("=== check-stale dopo aver rigenerato anchor.char.laura ===")
stale = generate.check_stale(manifest, out)
for job_id, why in stale:
    print(f"  {job_id}  ({why})")
assert stale and stale[0][0] == shot["id"], stale

shutil.rmtree(tmp)
print("\nOK — tutti i controlli passati")
