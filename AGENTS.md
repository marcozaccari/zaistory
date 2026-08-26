# Istruzioni per agenti

## Prima di tutto

Leggi `ARCHITECTURE.md`. Le decisioni di progetto sono già prese e motivate lì:
non riproporle da capo e non contraddirle. Mettile in discussione solo se emerge
un caso concreto che non coprono bene, e dillo esplicitamente invece di cambiare
rotta in silenzio.

## Lingua

Documentazione, istruzioni della skill e contenuti narrativi sono in italiano.
Mantieni l'italiano in tutto ciò che si aggiunge.

## L'IR è il contratto

`skills/story-ir-compiler/references/engine-ir.schema.json` è il pezzo più
delicato del repository: ogni altro componente dipende da lui.

- **Ogni oggetto dell'IR ha `additionalProperties: false`.** È una rete di
  sicurezza contro le allucinazioni del compilatore: un campo plausibile ma non
  previsto va scartato, non accettato in silenzio. Non rimuovere il vincolo.
- **L'IR non nomina mai un generatore.** Solo prompt testuali e tag di mood, mai
  provider, modelli, id di voce o loro parametri: quel binding vive nel file di
  mapping del modulo assets.
- **Cambiare lo schema significa toccare quattro cose insieme**: lo schema, le
  istruzioni di Stadio A (`references/stage_a_story_map.md`), quelle di Stadio B
  (`references/stage_b_scene.md`) e la versione dell'IR annotata in
  `ARCHITECTURE.md`. Un campo aggiunto solo allo schema non verrà mai prodotto.

## Comandi

```bash
pip install jsonschema --break-system-packages

# valida un IR completo (exit 0 = valido; errori su stderr, uno per riga)
python3 skills/story-ir-compiler/scripts/validate.py story.ir.json

# valida una singola scena
python3 skills/story-ir-compiler/scripts/validate.py --scene scena.json

# segmenta una sceneggiatura usando gli hint di una story map di Stadio A
python3 skills/story-ir-compiler/scripts/segment.py script.md story_map.json
```

Ogni IR prodotto o modificato va validato prima di considerarlo finito.

```bash
cd player && npm install

npm test                                   # test di engine, linter e lettura IR
npm run build:node                         # poi la CLI e' in dist-node/

# analisi statica e playthrough di riferimento: entrambi devono uscire con 0
node dist-node/src/cli/zaiplay.js --lint ../examples/nel-paese-dei-ciechi.ir.json
node dist-node/src/cli/zaiplay.js \
  --script ../examples/nel-paese-dei-ciechi.playthrough.txt \
  ../examples/nel-paese-dei-ciechi.ir.json

npm run dev                                # player web con ricarica a caldo
npm run build:web                          # -> dist/index.html, file unico
```

Toccando lo schema o il player, il playthrough di riferimento va rigiocato.

## Vincoli di comportamento

- **Il resolver e il player non inventano nulla.** Possono solo scegliere tra le
  azioni già definite nell'IR e applicare `Effect` già presenti. Se generano
  logica di gioco propria, lo stato smette di essere deterministico e testabile.
- **Aggiornare un IR esistente > ricompilarlo.** Il compilatore non è
  deterministico tra sessioni: id e dettagli minori cambiano. Se un
  `story.ir.json` esiste già, editalo in place mantenendo gli id.
- **Nessuno stack è stato scelto** per il generatore ad hoc. La scelta è
  deliberatamente rimandata: chiedi, non decidere per conto tuo. (Per il player
  invece è scelto: TypeScript, `player/` — web e CLI sullo stesso core.)
- **La logica di gioco sta in `player/src/core/`, e solo lì.** Web e CLI sono
  interfacce: se ti trovi a duplicare una regola in `src/web/` o `src/cli/`,
  è nel posto sbagliato. La PWA importerà lo stesso core.

## Riprendere il progetto

Se l'utente chiede di riprendere senza specificare altro, chiedi su quale dei
fronti aperti si lavora: iterare sulla skill del compilatore, estendere il
player di test (`player/`, già costruito), impostare il modulo assets, o
impostare il generatore ad hoc.
