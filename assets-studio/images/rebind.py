#!/usr/bin/env python3
"""Riaggancia le immagini gia' pubblicate a una storia ricompilata.

Perche' esiste. Una ricompilazione cambia gli id: il compilatore non e'
deterministico fra sessioni, e un cambio di formato cambia anche la forma dei
nodi. Ma le immagini pubblicate sono **denaro speso e ore di selezione umana**
— sulla storia di riferimento sono 89 — e buttarle via perche' un id non torna
non e' un'opzione.

Come funziona, in due passate:

1. **per id.** Le ancore si indicizzano per *identita'* (`anchor.char.laura`) e
   gli scatti per *fase* (`shot.magazzino_ricerca.bg`): se la ricompilazione ha
   ereditato gli id — ed e' quello che le istruzioni del compilatore le
   chiedono — la maggior parte torna al suo posto senza fare niente.
2. **per prompt.** Per il resto si confronta il **testo del prompt**, che di una
   ricompilazione della stessa sceneggiatura resta in larga parte lo stesso, ed
   e' quindi una chiave piu' robusta dell'id.

Quello che non trova un aggancio si **elenca**, non si scarta in silenzio: e'
materiale pagato, e la decisione se rigenerarlo e' umana. Qui non si genera
niente e non si cancella niente — al massimo si scrive un campo `image` in un
nodo che non ce l'aveva.

Uso:
    # il manifest della vecchia compilazione, e la storia nuova gia' estratta
    python rebind.py stories/metal-head \\
        --vecchio-manifest _to_delete/metal-head/_work/assets_manifest.json

    python rebind.py stories/metal-head --vecchio-manifest ... --dry-run
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import extract_manifest
import publish


def normalizza(testo: str | None) -> str:
    """Il prompt ridotto alla sua sostanza: spazi normalizzati, minuscole.

    Non si tenta niente di piu' furbo. Una somiglianza approssimata
    sembrerebbe piu' generosa e sarebbe piu' pericolosa: agganciare
    l'immagine sbagliata a un nodo e' esattamente l'errore che la
    pubblicazione si ferma per evitare — la faccia sbagliata nella scena
    sbagliata — e qui costerebbe una revisione intera per accorgersene.
    """
    return " ".join((testo or "").split()).lower()


def indice_per_prompt(jobs: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for j in jobs:
        chiave = normalizza(j.get("base_prompt"))
        if chiave:
            out.setdefault(chiave, []).append(j)
    return out


def rebind(storia: publish.Storia, vecchio_manifest: pathlib.Path, *, dry_run=False) -> dict:
    ir = json.loads(storia.ir_path.read_text(encoding="utf-8"))
    vecchio = json.loads(vecchio_manifest.read_text(encoding="utf-8"))
    ledger = publish.load_json(storia.ledger_path, {}) or {}

    # Il manifest nuovo si estrae adesso: e' l'unico modo di sapere quali job
    # la storia ricompilata produrrebbe, e con quale `source` scriverli.
    estrattore = extract_manifest.Extractor(ir, storia.ir_path.name, extract_manifest.DEFAULTS)
    nuovo = estrattore.build()

    # Un'immagine e' riagganciabile solo se il file esiste davvero: il ledger
    # dice cosa e' stato pubblicato, il disco dice cosa c'e' ancora.
    disponibili = {}
    for job_id in ledger:
        aid = publish.asset_id(job_id)
        if list(storia.images.glob(f"{aid}.*")):
            disponibili[job_id] = aid

    # Il confronto per identita' si fa sull'**asset**, non sull'id del job.
    # Sono quasi sempre la stessa stringa, e quando non lo sono e' proprio il
    # caso in cui serve: una variante d'ancora si chiama `anchor.char.laura@...`
    # come job e `anchor.char.laura_...` come file, perche' la `@` non e' un
    # nome di file. Confrontando gli id grezzi, l'unica immagine di Laura ferita
    # — tre atti su quattro — risultava orfana.
    per_asset = {aid: job_id for job_id, aid in disponibili.items()}

    vecchi_job = {j["id"]: j for j in vecchio.get("jobs", [])}
    per_prompt = indice_per_prompt([j for jid, j in vecchi_job.items() if jid in disponibili])

    rapporto = {
        "per_id": [],
        "per_prompt": [],
        "gia_a_posto": [],
        "senza_aggancio": [],
        "orfane": [],
        "ambigue": [],
    }
    usati: set[str] = set()

    for job in nuovo["jobs"]:
        source = job.get("source") or ""
        nodo = publish.resolve(ir, source)
        if nodo is None:
            rapporto["senza_aggancio"].append((job["id"], f"nella storia non trovo {source}"))
            continue
        if nodo.get("image"):
            rapporto["gia_a_posto"].append(job["id"])
            usati.add(job["id"])
            continue

        # 1. per id: la strada che la ricompilazione dovrebbe aver reso inutile
        aid = publish.asset_id(job["id"])
        if aid in per_asset:
            if not dry_run:
                nodo["image"] = aid
            rapporto["per_id"].append((job["id"], aid))
            usati.add(per_asset[aid])
            continue

        # 2. per prompt
        chiave = normalizza(job.get("base_prompt"))
        candidati = [c for c in per_prompt.get(chiave, []) if c["id"] not in usati]
        if not candidati:
            rapporto["senza_aggancio"].append((job["id"], "nessuna immagine con questo prompt"))
            continue
        if len(candidati) > 1:
            # Due immagini diverse per lo stesso testo: sceglierne una a caso
            # significherebbe mettere la faccia sbagliata nella scena sbagliata.
            rapporto["ambigue"].append((job["id"], [c["id"] for c in candidati]))
            continue
        vecchio_job = candidati[0]
        aid = disponibili[vecchio_job["id"]]
        if not dry_run:
            nodo["image"] = aid
        rapporto["per_prompt"].append((job["id"], vecchio_job["id"], aid))
        usati.add(vecchio_job["id"])

    # Le immagini pubblicate che nessun nodo nuovo reclama: non si toccano, si
    # dicono. Possono essere di una scena tagliata, o l'indizio che un id e'
    # cambiato dove non doveva.
    #
    # «Reclamata» si conta sull'**asset**, non sul job: un nodo che porta gia'
    # il suo `image` ha reclamato quel file anche se il job adesso si chiama in
    # un altro modo, ed elencarlo fra le orfane manderebbe a cercare un
    # problema che non c'e'.
    reclamati = {a for _, a in rapporto["per_id"]} | {a for _, _, a in rapporto["per_prompt"]}
    for nodo in publish.nodi_con_immagine(ir):
        if nodo.get("image"):
            reclamati.add(nodo["image"])
    for job_id, aid in disponibili.items():
        if aid not in reclamati:
            rapporto["orfane"].append(job_id)

    if not dry_run and (rapporto["per_id"] or rapporto["per_prompt"]):
        publish.write_json(storia.ir_path, ir)

    return rapporto


def stampa(r: dict, dry_run: bool) -> None:
    print(f"riagganciate per id:      {len(r['per_id'])}")
    print(f"riagganciate per prompt:  {len(r['per_prompt'])}")
    print(f"gia' a posto:             {len(r['gia_a_posto'])}")
    print(f"senza aggancio:           {len(r['senza_aggancio'])}")
    print(f"immagini orfane:          {len(r['orfane'])}")
    if r["ambigue"]:
        print(f"ambigue (non toccate):    {len(r['ambigue'])}")

    def elenco(nome, voci, limite=12):
        if not voci:
            return
        print(f"\n{nome}:")
        for v in voci[:limite]:
            print(f"  {v if isinstance(v, str) else ' <- '.join(str(x) for x in v)}")
        if len(voci) > limite:
            print(f"  ... e altri {len(voci) - limite}")

    elenco("per prompt", [f"{nuovo}  ←  {aid}" for nuovo, _, aid in r["per_prompt"]])
    elenco("senza aggancio", [f"{jid}  ({perche})" for jid, perche in r["senza_aggancio"]])
    elenco("orfane (pagate e non reclamate)", r["orfane"])
    elenco("ambigue", [(a, ", ".join(b)) for a, b in r["ambigue"]])

    if dry_run:
        print("\n(prova a vuoto: la storia non e' stata toccata)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="riaggancia le immagini pubblicate a una storia ricompilata")
    ap.add_argument("storia", help="la cartella della storia")
    ap.add_argument("--vecchio-manifest", required=True,
                    help="l'assets_manifest.json della compilazione precedente")
    ap.add_argument("--ir", help="percorso della storia, se non e' l'unico *.zaistory.json della cartella")
    ap.add_argument("--dry-run", action="store_true", help="mostra cosa farebbe, senza scrivere")
    args = ap.parse_args(argv)

    storia = publish.Storia(args.storia, ir=args.ir)
    if not storia.ir_path.is_file():
        raise SystemExit(f"non trovo la storia in {args.storia}")
    vecchio = pathlib.Path(args.vecchio_manifest)
    if not vecchio.is_file():
        raise SystemExit(f"non trovo {vecchio}")

    r = rebind(storia, vecchio, dry_run=args.dry_run)
    stampa(r, args.dry_run)

    if r["senza_aggancio"] or r["ambigue"]:
        print("\nQuello che resta senza aggancio va guardato prima di rigenerarlo: "
              "una rigenerazione e' sempre una decisione, mai un effetto collaterale.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
