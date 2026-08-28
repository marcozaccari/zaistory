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
- **Cambiare lo schema significa toccare sei cose insieme**: lo schema, le
  istruzioni di Stadio A (`references/stage_a_story_map.md`), quelle di Stadio B
  (`references/stage_b_scene.md`), la versione dell'IR annotata in
  `ARCHITECTURE.md`, i tipi del player (`player/src/core/types.ts`) e il suo
  validatore di lettura (`player/src/core/load.ts`, dove
  `additionalProperties: false` diventa codice). Un campo aggiunto solo allo
  schema non verrà mai prodotto; uno aggiunto senza toccare `load.ts` fa
  fallire il caricamento di ogni IR che lo usa.

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

# copertura del resolver: quante test_phrases arrivano all'azione giusta
# (esce con 1 se una frase fa partire l'azione SBAGLIATA, che e' un difetto
# vero; le frasi perse invece non fanno fallire niente)
node dist-node/src/cli/zaiplay.js --copertura ../examples/metalhead.ir.json
node dist-node/src/cli/zaiplay.js --lint ../examples/metalhead.ir.json
node dist-node/src/cli/zaiplay.js \
  --script ../examples/metalhead.playthrough.txt ../examples/metalhead.ir.json
node dist-node/src/cli/zaiplay.js \
  --script ../examples/metalhead.giro-lungo.playthrough.txt \
  ../examples/metalhead.ir.json

npm run dev                                # player web con ricarica a caldo
npm run build:web                          # -> dist/index.html, file unico
```

Entrambi gli IR di esempio sono a **IR 1.8.0** e passano il linter con zero
errori: se una modifica ne introduce, e' la modifica a essere sbagliata, non
l'esempio. I campi della 1.8.0 sono opzionali nello schema ma **obbligatori per
il linter** (`player_voice`, `look` nelle scene interattive, un fallback
raggiungibile, `aliases` su ogni azione): la retrocompatibilita' con gli IR
precedenti non e' mantenuta, e non va reintrodotta con ripieghi nel player.

Toccando lo schema o il player, i playthrough di riferimento vanno rigiocati.
Quelli di "Metal Head" sono due di proposito: arrivano allo stesso finale con un
numero di passi diverso, ed e' cosi' che si verifica che sbagliare costi strada e
non la partita.

## Vincoli di comportamento

- **Il resolver e il player non inventano nulla.** Possono solo scegliere tra le
  azioni già definite nell'IR e applicare `Effect` già presenti. Se generano
  logica di gioco propria, lo stato smette di essere deterministico e testabile.
- **Non inventano nemmeno il testo.** Ogni riga che il giocatore legge sta
  nell'IR: narrazioni, `look`, `blocked_narration`, `no_match_narration`,
  `player_voice`. Dove l'IR non ha niente, il player **tace e lo segnala come
  diagnostica** (nota fra parentesi) invece di riempire il buco con una frase.
  Se ti viene voglia di aggiungere un testo di comodo in `src/`, è un campo che
  manca allo schema o una regola che manca al compilatore.
- **Il player si comanda a parole, le chip sono debug.** Con un resolver a
  input libero l'elenco delle azioni non si mostra: un menu che elenca le
  azioni utili risolve gli enigmi al posto del giocatore e rende impossibile
  giudicare la difficoltà di una storia. Nei **dialoghi** invece l'elenco si
  vede sempre (decisione 1.7.0). Non reintrodurre le chip fuori dal debug.
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
