# Istruzioni per agenti

## Prima di tutto

Leggi **`SPECS.md`**, poi **`ARCHITECTURE.md`**.

`SPECS.md` fissa i paletti: è il documento che comanda. `ARCHITECTURE.md`
raccoglie le conseguenze architetturali e il perché di ciascuna: le decisioni
sono già prese e motivate lì, non riproporle da capo e non contraddirle in
silenzio. Se emerge un caso concreto che non coprono bene, dillo esplicitamente
invece di cambiare rotta per conto tuo — e se i due documenti divergono, è
`ARCHITECTURE.md` a essere sbagliato.

## Stato del repository: ricostruzione in corso

Il progetto ha appena cambiato modello. Le specifiche sono **distruttive** e
annullano le precedenti, e il codice non le ha ancora recepite. Quindi:

| | dove sta |
|---|---|
| **già sul formato nuovo** | `SPECS.md`, `ARCHITECTURE.md`, la skill, tutto il **player** e il modulo **immagini** |
| **ancora da rifare** | `nel-paese-dei-ciechi` |

Cosa è cambiato, in breve, perché è quello che rende obsoleto quasi ogni file di
codice:

- **Verbo × oggetto** (guarda / usa / parla, più il movimento) al posto delle
  azioni contestuali con gli alias di frase. Gli alias migrano dalle azioni alle
  **entità**.
- **Il luogo è il nodo di gioco**, le ex scene diventano **fasi** dentro il
  luogo. Movimento libero fra luoghi, con mappa e cutscene di passaggio.
- **Gli atti** diventano una struttura con regole proprie: flag locali,
  inventario come unico canale, `carry_flags` con tetto a 3.
- **Si può perdere**, se la storia lo dichiara (`failure_mode`).
- **Il file si chiama `<id>.zaistory.json`**, lo schema `zaistory.schema.json`,
  la versione `zaistory_version`.

Ordine della ricostruzione (in `ARCHITECTURE.md`, «Stato del lavoro»):

1. ~~lo schema~~ — fatto: `skills/zaistory-compiler/references/zaistory.schema.json`
2. ~~la skill del compilatore~~ — fatta: `skills/zaistory-compiler/`
3. ~~**il player**~~ — fatto: core (parser a verbi, luoghi e uscite, atti e
   fasi, dialoghi, finali), linter, copertura, CLI e **faccia web** (build a
   file unico, palco, mappa, pannello, ripresa) con la **grafica del player
   precedente** rimessa al suo posto — foglio di stile, icone, voci del testo,
   misure diverse fra telefono e desktop — e le tre cose che erano rimaste
   fuori: **modalità ascolto**, **backend a vettori** e **giro dei caratteri**.
   Una prova del fumo in browser vero. Le vecchie sorgenti sono in
   `_to_delete/vecchio-player/`. Compilare una storia
   vera ha poi aggiunto: descrizioni degli oggetti d'ambiente e dei personaggi
   leggibili («guarda lo schedario» non era una domanda a cui qualcuno
   rispondesse), spareggio del parser fra due azioni con lo stesso bersaglio e
   condizioni disgiunte, tutti i verbi della frase invece del solo primo, e la
   fine della confusione fra un sostantivo e il verbo che gli somiglia
   (`corridoio` che valeva *correre*, `spina` che valeva *spingere*), il
   movimento che è movimento solo se c'è dove andare (`sali sull'albero`), gli
   id doppi fra oggetti di luoghi diversi, un elenco degli oggetti richiesti a
   valle che non pretende più quelli che a valle si trovano da soli, la fase che
   si marca come vista e perdeva la propria narrazione, e le azioni del luogo
   che aprono un dialogo che non tutte le fasi hanno. Sono poi
   tornati i pezzi che nel passaggio erano rimasti indietro — il foglio di stile
   li vestiva ancora, ma nessuno li costruiva più: la **lente a schermo intero**
   con la figura dell'oggetto guardato, la **copertina** (locandina nella
   scheda, versione e lingua, stile per intero, anagrafica sotto il debug) con
   il palco spento e la barra muta finché non si comincia, il **«continua»**
   fra un beat e l'altro e fra due battute, la **meccanica interna** che torna
   sotto il debug (la classe che la nascondeva non esisteva nel foglio di
   stile), e l'**ispezione del luogo** nel dock — gesti, bersagli, azioni con
   condizione, effetto e il segno di quali sbloccano; e poi il cassetto
   dell'inventario accanto a quello della mappa, la battuta scelta che entra nel
   flusso col nome di chi la dice, l'invio sul «continua» ed Esc sui cassetti, e
   la traccia che scarta i tentativi a vuoto e nomina le battute; e la porta
   per la **copertina** in cima al menu — la locandina in miniatura dove c'è,
   un bottone dove no, spenta finché la copertina è quella che si sta già
   guardando — che rimette la stessa schermata col bottone che dice «torna a
   giocare», mettendo da parte trascritto e dock interi e rimettendoli
   dov'erano; e con una partita salvata la copertina d'apertura dice «continua
   a giocare», perché ricaricare non la butta via. Infine il dock: **campo e
   invio attaccati** in un pezzo solo, i due cassetti staccati, e la riga che
   su telefono verticale non esce più a destra (era una cella di griglia che
   non scendeva sotto la larghezza intrinseca dell'`input`); nel cassetto degli
   oggetti la **miniatura** accanto al nome, e in quello della mappa il titolo
   «luoghi». E sotto il debug, in coda al dock, **indietro e avanti di
   un'azione**: la partita è la sequenza di quello che si è scritto, quindi
   disfare vuol dire rigiocarla meno l'ultima riga — lo stato è quello vero, e
   dal flusso spariscono i blocchi di quell'azione. Si prova una frase, si
   guarda, si torna indietro e se ne prova un'altra. 43 test.
4. ~~**il modulo assets**~~ — fatto: estrazione sulla nuova gerarchia (oggetti
   d'ambiente e cutscene di passaggio compresi), studio, pubblicazione,
   **`rebind.py`**, gli script di avvio e i tre selftest, che ora girano sulla
   fixture del formato invece che su una storia vera.
5. **le due storie**, ricompilate ereditando gli id — è l'unica cosa rimasta,
   ed è anche il collaudo vero di tutto il resto. **`metal-head` è fatta**:
   quattro atti, 22 luoghi, 44 fasi, 99 azioni
   (`stories/metal-head/metal-head.zaistory.json`), che girano dall'inizio alla
   fine da CLI e nel browser — 0 errori di lint, **100%** di copertura del
   parser, 0 risposte sbagliate — e con tutte e 89 le immagini già pagate
   riagganciate da `rebind.py`. Resta `nel-paese-dei-ciechi`.

La vecchia skill `story-ir-compiler` è stata ritirata: due compilatori
installati si contendono l'attivazione, e quello vecchio produrrebbe un formato
che il player nuovo non leggerà.

Finché la ricostruzione non è finita, i comandi in fondo a questo file girano
sul modello precedente e continuano a funzionare. Non aggiungere ripieghi per
far convivere i due modelli: la retrocompatibilità non è un obiettivo, siamo in
prototipo.

## Lingua

- **Il codice è in inglese**: nomi di file, identificatori, tipi, funzioni,
  costanti, campi dello schema, messaggi di commit.
- **Documentazione, istruzioni della skill e contenuti narrativi sono in
  italiano**: `SPECS.md`, `ARCHITECTURE.md`, i README, la skill, e ogni riga che
  il giocatore legge.
- **Il vocabolario che il parser riconosce è italiano**, ed è un caso a parte:
  non è codice, sono dati di lingua, e vanno indicizzati per lingua e scelti in
  base al campo `language` della storia. Un modulo con nome inglese e contenuto
  italiano è corretto: è un dizionario.

La rinomina dei moduli del player è **fatta**: i file e i tipi sono inglesi
(`stage.ts`, `turn.ts`, `verbs.ts`, `coverage.ts`, `listen.ts`, `voice.ts`,
`images.ts`, `icons.ts`, `names.ts`). Restano italiani, e vanno lasciati stare,
i **nomi delle classi CSS** e il vocabolario dei verbi: le prime sono il
lessico con cui è scritta l'interfaccia da sempre, il secondo è un dizionario.

## Lo schema è il contratto

`zaistory.schema.json` è il pezzo più delicato del repository: ogni altro
componente dipende da lui.

- **Ogni oggetto ammette solo i campi previsti** (`additionalProperties:
  false`). È una rete di sicurezza contro le allucinazioni del compilatore: un
  campo plausibile ma non previsto va scartato, non accettato in silenzio. Non
  rimuovere il vincolo.
- **Il formato non nomina mai un generatore.** Solo prompt testuali e tag di
  mood: mai provider, modelli, id di voce o loro parametri. Quel binding vive
  nel file di mapping del modulo assets.
- **Lo schema è permissivo, il linter è severo.** Molti campi restano opzionali
  perché il JSON Schema non sa distinguere una fase interattiva da una cutscene
  senza contorsioni, e sono obbligatori per il linter. È lì che passa la
  differenza fra *ben formato* e *giocabile*.
- **Il campo `image` non lo scrive il compilatore.** È l'id di un'immagine già
  prodotta e approvata, e lo scrive la pubblicazione del modulo assets. Un file
  appena compilato non ne ha nessuno, ed è giusto così.
- **Una storia è una cartella** (`stories/<id>/`), con dentro il file giocabile,
  la sceneggiatura, i playthrough, `assets/images/` e il banco di lavoro in
  `_work/`, che git ignora. Vedi `stories/README.md`. Non spargere i pezzi di
  una storia altrove.
- **Gli strumenti stanno in `assets-studio/`, una cartella per tipo di asset**:
  `images/` oggi, `voice/` e `sound/` quando esisteranno. Non aggiungere un
  secondo modulo immagini altrove, e non mescolare tipi diversi nello stesso.

**Toccare lo schema significa toccare sei cose insieme**: lo schema, le
istruzioni di Stadio A e di Stadio B della skill, la versione annotata in
`ARCHITECTURE.md`, i tipi del player e il suo validatore di lettura (dove
`additionalProperties: false` diventa codice). Un campo aggiunto solo allo
schema non verrà mai prodotto; uno aggiunto senza toccare la lettura fa fallire
il caricamento di ogni file che lo usa.

## Vincoli di comportamento

- **Il parser e il player non inventano nulla.** Possono solo scegliere fra le
  azioni e le uscite già definite e applicare effetti già presenti. Se generano
  logica di gioco propria, lo stato smette di essere deterministico e testabile.
- **Non inventano nemmeno il testo.** Ogni riga che il giocatore legge sta nel
  file. Dove manca, il player ripiega sul fallback per intenzione — che è
  comunque testo d'autore — e la diagnostica si vede solo a debug acceso. Se ti
  viene voglia di aggiungere un testo di comodo in `src/`, è un campo che manca
  allo schema o una regola che manca al compilatore.
- **La logica di gioco sta in `player/src/core/`, e solo lì.** Web e CLI sono
  interfacce: se ti trovi a duplicare una regola altrove, è nel posto sbagliato.
- **Il player è quello definitivo, non un prototipo.** Non ne esiste un secondo
  da costruire e non va progettato: la stessa build la usano chi sviluppa il
  motore, chi collauda una storia e chi la gioca, e a distinguerli è il debug —
  un interruttore, non un'applicazione diversa. Se ti viene da scrivere «il
  player definitivo farà X», X va fatto qui.
- **Le chip restano sotto il debug.** Nei **dialoghi** invece l'elenco delle
  battute si vede sempre: si agisce a parole, si parla a scelte.
- **Aggiornare un file esistente batte ricompilarlo.** Il compilatore non è
  deterministico fra sessioni: id e dettagli minori cambiano. L'eccezione è
  questo passaggio di formato, dove la forma cambia e le storie vanno
  ricompilate — ma **ereditando gli id**, vedi sotto.
- **La selezione delle immagini è umana, e sta nel filesystem.** Nella storia
  finisce solo ciò che è stato marcato *definitivo* nello studio; il resto resta
  in `_work/`. Non aggiungere euristiche che pubblicano da sole.
- **Una rigenerazione è sempre una decisione, mai un effetto collaterale.** Le
  89 immagini di "Metal Head" sono pagate e selezionate a mano: la
  ricompilazione eredita gli id delle entità e delle fasi perché restino
  attaccate, e il passo di rebind riaggancia per prompt quello che l'id non
  copre. **Non cancellare `stories/metal-head/_work/`**: non è versionato, ed è
  l'unica copia dei sidecar con prompt effettivo, modello, seed e hash.
- **Nessuno stack è stato scelto** per il generatore ad hoc. La scelta è
  deliberatamente rimandata: chiedi, non decidere per conto tuo. (Per il player
  invece è scelto: TypeScript, `player/` — web e CLI sullo stesso core.)

## Comandi

⚠️ Girano sul **modello precedente** finché la ricostruzione non è finita.

Il compilatore e i suoi script sono già sul formato nuovo
(`skills/zaistory-compiler/`); il player e le storie no.

```bash
pip install jsonschema --break-system-packages   # serve la 4 o più recente

# valida un file zaistory intero (verifica anche che il nome combaci con l'id)
python3 skills/zaistory-compiler/scripts/validate.py stories/<id>/<id>.zaistory.json

# valida un frammento contro una definizione dello schema, durante la compilazione
python3 skills/zaistory-compiler/scripts/validate.py --def Place luogo.json

# segmenta una sceneggiatura usando gli hint di una story map di Stadio A,
# raggruppando i blocchi per luogo
python3 skills/zaistory-compiler/scripts/segment.py sceneggiatura.md story_map.json

# la fixture che esercita ogni costrutto del formato
python3 skills/zaistory-compiler/scripts/validate.py \
    skills/zaistory-compiler/references/mini.zaistory.json
```

```bash
# immagini: estrazione, studio (guarda, rifà, approva, pubblica), pubblicazione
python assets-studio/images/extract_manifest.py stories/metal-head/story.ir.json \
    -o stories/metal-head/_work/assets_manifest.json
./start_assets_studio.sh stories/metal-head
python assets-studio/images/publish.py stories/metal-head --dry-run

# dopo una ricompilazione: riaggancia le immagini già pubblicate, prima per id
# e poi per prompt. Guarda sempre il rapporto prima di scrivere.
python assets-studio/images/rebind.py stories/metal-head \
    --vecchio-manifest _to_delete/metal-head/_work/assets_manifest.json --dry-run

# i selftest del generatore: nessuna rete, nessuna chiave
python assets-studio/images/selftest.py
python assets-studio/images/selftest_publish.py
python assets-studio/images/selftest_studio.py
```

```bash
cd player && npm install
npm test                    # 32 test: lettura severa, fasi, parser, turno, linter
npm run check:web           # il typecheck della faccia web (vite non lo fa)

npm run play      testdata/mini.zaistory.json    # si gioca scrivendo
npm run lint      testdata/mini.zaistory.json    # analisi statica: 1 se ci sono errori
npm run copertura testdata/mini.zaistory.json    # 1 se una frase fa partire l'azione SBAGLIATA

# il playthrough di riferimento: esce con 1 se non arriva a un finale
npm run play -- testdata/mini.zaistory.json --script testdata/completo.txt

# la faccia web: un file HTML solo, che si apre anche da file://
npm run dev                 # sviluppo con ricarica a caldo
npm run build:web           # -> dist/index.html
npm run embed -- testdata/mini.zaistory.json /tmp/play.html   # con la storia dentro
npm run serve -- 8000 ../stories                              # per provarla dal telefono

# la prova del fumo: apre la build in un browser vero e gioca una partita.
# Playwright NON è una dipendenza del progetto e non deve diventarlo.
npm i --no-save playwright && node scripts/smoke.mjs /tmp/play.html
```

La distinzione della copertura è il punto: una frase **persa** costa al
giocatore una riscrittura, una **sbagliata** applica un effetto che nessuno ha
chiesto. Solo le seconde fanno fallire.

`start_local_player.sh` e `start_assets_studio.sh` sono fermi al modello
precedente: il primo va rifatto sopra `build:web` + `embed` + `serve`, il
secondo insieme al modulo assets.

Nota sul ponte verso questa macchina: non può cancellare file, e `npm install`
ha bisogno di rinominare dentro `node_modules`. Se fallisce con `ENOTEMPTY`,
`node_modules` va spostato via e l'installazione rifatta — o lanciata da un
terminale vero, che è anche molto più veloce.

Ogni file prodotto o modificato va validato prima di considerarlo finito, e
toccando lo schema o il player i playthrough di riferimento vanno rigiocati.

## Prima di ogni commit

**Alza la versione del player.** Vive in un posto solo — il campo `version` di
`player/package.json` — e da lì la prendono sia il web (vite la incolla nel
bundle) sia la CLI. È il numero in fondo al pannello, ed è l'unico modo che ha
chi sta provando una build dal telefono di sapere se quello che ha in mano è
quello che gli è stato appena mandato: senza, «ho già aggiornato?» non ha
risposta. Patch per una correzione, minore per un pezzo di interfaccia nuovo.

Poi ricostruisci quello che porta il numero dentro di sé: `npm run build:web` e
i `play.html` delle storie (`npm run embed`), altrimenti il pannello continua a
mostrare la versione di prima.

## Riprendere il progetto

Se l'utente chiede di riprendere senza specificare altro, chiedi su quale fronte
si lavora — l'ordine naturale è quello della ricostruzione: lo **schema**, la
**skill** del compilatore, il **player**, il **modulo assets**, la
**ricompilazione** delle storie.
