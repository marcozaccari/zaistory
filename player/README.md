# zaiplay — player di test

Player minimale, **puramente testuale**: nessuna risorsa grafica o audio,
nessun manifest asset. Consuma esclusivamente `story.ir.json` e serve a giocare
e testare una storia molto prima che esistano il modulo assets e la PWA.

È il modo più economico per scoprire che una storia compilata *non è giocabile*
— scena senza uscita, `goto` verso un id inesistente, flag mai impostato ma
richiesto da una condizione, ramo di dialogo irraggiungibile — senza dover
prima generare immagini e voci. La validazione di schema dice che l'IR è *ben
formato*; solo giocarlo dice che è *giocabile*.

Due facce, **un solo core**:

| | a cosa serve |
|---|---|
| **player web** | giocare la storia dal telefono o dal desktop, senza installare niente. La build è **un unico file HTML** che si apre anche da `file://`. |
| **CLI `zaiplay`** | `--lint` e `--script` headless: analisi statica e test di regressione rigiocabili in CI. Non gira su mobile — non è il suo mestiere. |

`src/core/` non tocca il DOM e non legge da stdin: engine, stato, linter e
lettura dell'IR stanno lì una volta sola, e le due facce li condividono. È
anche il pezzo che la futura PWA può riusare così com'è.

## Provare subito

```bash
npm install

# player web, in sviluppo
npm run dev                     # apre un dev server con ricarica a caldo

# player web, file unico da mandare/aprire ovunque
npm run build:web               # -> dist/index.html (~80 KB, tutto dentro)
npm run embed -- ../examples/nel-paese-dei-ciechi.ir.json paese.html

# ...e per giocarlo dal telefono (o per provare il backend a vettori)
npm run serve                   # serve dist/ e stampa gli indirizzi di rete

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../examples/nel-paese-dei-ciechi.ir.json
```

Serve solo Node 22+. Nessuna dipendenza a runtime: TypeScript e Vite sono
soltanto strumenti di build, e il codice spedito al browser non importa niente
da `node_modules`.

## Giocare dal telefono

```bash
npm run build:web
npm run embed -- ../examples/metalhead.ir.json dist/metalhead.html
npm run serve
```

Stampa gli indirizzi di rete della macchina; dal telefono, sulla stessa wi-fi,
si apre uno di quelli. Il server è una cinquantina di righe di Node senza
dipendenze, serve `dist/` e non fa altro.

Due modi, e la differenza conta solo per un motivo:

| come | quando |
|---|---|
| mandare il file `.html` e aprirlo | basta e avanza per giocare: è un file solo, funziona offline, non serve niente |
| `npm run serve` e aprire l'indirizzo | l'unico modo di provare il backend a **vettori** dal telefono |

Da `file://` il browser tratta la pagina come origine opaca e il modello non si
scarica; servita da http è una pagina web normale e si scarica. Nota che su
`http://` senza TLS non c'è WebGPU — non è un contesto sicuro — quindi
l'inferenza gira in WASM: più lenta, ma per una frase di cinque parole resta
nell'ordine dei millisecondi.

## Tastiera

Nel dock: **frecce su/giù** scorrono le voci, **invio** sceglie quella col
fuoco, i **numeri 1-9** sono la scorciatoia per le stesse cifre stampate
accanto a ciascuna. Mentre si scrive nella riga di input le frecce muovono il
cursore, come devono. Nei dialoghi — dove l'elenco delle battute *è*
l'interfaccia — le frecce sono il modo naturale di scegliere.

## Il player web

Tre modi di dargli l'IR, in ordine di precedenza:

1. **incorporato nella pagina** — `npm run embed` produce un HTML che contiene
   già la storia e parte da solo. È la forma da mandare a qualcuno che deve
   soltanto giocare;
2. **`?ir=URL`** — se l'IR è raggiungibile via http;
3. **a mano** — scelta file, trascinamento o incolla del JSON.

Si apre sulla **copertina**: titolo, descrizione, `ir_version`, `id`,
`language`, numero di scene, `start_scene`, lo stile globale, la roster dei
personaggi coi loro prompt e gli elenchi `state_flags_schema` /
`inventory_schema`. Serve a rispondere in un colpo d'occhio alle domande che ci
si fa aprendo un IR che non si è compilato adesso. Un tocco su `inizia` e la
prima scena parte — il tocco non è cerimonia: il transcript insegue il fondo, e
senza qualcosa che trattenga la lettura la copertina scorrerebbe via prima di
essere vista. In terminale, dove lo scrollback resta, la copertina non chiede
niente.

Poi: narrazione con tap-to-continue, battute con lo speaker, scelte di dialogo
e azioni contestuali come bottoni a tutta larghezza (i tasti `1`–`9` funzionano
da tastiera). Le scelte e le azioni non disponibili restano nascoste come in un
player vero.

**Tutti** i prompt di generazione asset si vedono sempre, etichettati con il
nome che hanno nell'IR e attaccati al punto della storia a cui appartengono:

| dove compare | campi |
|---|---|
| copertina | `global_style.image_style_suffix`, `.narrator_voice.style_prompt`, `.ambient_music_tags`, e per ogni personaggio della roster `characters.<id>.visual_prompt` e `.voice.style_prompt` |
| intestazione di scena | `scene_type`, `scene_tone`, `background.image_prompt`, `background.ambient_sound_prompt`, e per ogni personaggio in scena `characters.<id>.visual_prompt` e `.voice.style_prompt` (marcati `(override)` quando la scena sovrascrive la roster globale) |
| appesi a un beat | `image_prompt`, `sound_effect_prompt`, `voice.style_prompt` |
| appesi a una battuta | `voice_override.style_prompt` |
| dopo un effetto | `narration_voice.style_prompt`, `play_sound_prompt` |

L'etichetta è colorata per **tipo di risorsa** — immagine, suono, voce,
musica — così scorrendo il transcript si vede dove manca un'inquadratura o un
suono senza doversi leggere il nome del campo. La stessa tassonomia vale nella
CLI, con i colori del terminale.

Non vengono né generati né riprodotti — il player è testuale — ma sono il
segnaposto di quello che un giorno sarà immagine, suono e voce. È leggendoli
mentre si gioca che ci si accorge che un beat ha cambiato inquadratura senza
dirlo, che un suono manca o che una scena ha sovrascritto la voce di un
personaggio senza motivo: si rilegge la storia con gli occhi del modulo assets,
prima che il modulo assets esista.

Il tasto **debug** in alto a destra aggiunge la diagnostica intorno, e lo fa
retroattivamente su tutto il transcript già scorso: id di scene e nodi,
conteggi, `on_enter_flags_set`, condizione ed effetto di ogni voce, e **le
azioni filtrate con il motivo per cui non compaiono** — che è la domanda che ci
si pone il 90% delle volte quando si testa una storia.

Il pannello `☰` ha quattro schede:

| scheda | cosa mostra |
|---|---|
| `stato` | scena corrente, flag attivi, inventario, scene visitate |
| `scena` | tutti i parametri della scena e **tutte** le sue azioni, con ✓/× e motivo |
| `linter` | le segnalazioni statiche, per gravità |
| `traccia` | la sequenza giocata, da copiare — e una casella per rigiocarne una |

## La CLI

```bash
zaiplay story.ir.json                    # gioca (si scrive cosa si fa)
zaiplay --debug story.ir.json            # parte in modalità debug
zaiplay --lint story.ir.json             # solo analisi statica, poi esce
zaiplay --copertura story.ir.json        # misura quante test_phrases arrivano
zaiplay --resolver embedding story.ir.json   # vettori locali (dip. opzionale)
zaiplay --record partita.txt story.ir.json   # registra la partita giocata
zaiplay --script partita.txt story.ir.json   # la rigioca senza input umano
```

**Si gioca scrivendo**: «guardati intorno», «apri l'armadietto con la chiave»,
«parla con Mark». L'elenco delle azioni non si vede — è impalcatura di
collaudo, e un menu che elenca le azioni utili risolve gli enigmi al posto del
giocatore: ricompare con `--debug` o `:debug`. Ogni risposta dice in coda chi
l'ha decisa (`⟨lessicale⟩`, `⟨embedding⟩`, `⟨verbo del player⟩`).

Si accetta anche la forma a trattino singolo (`-lint`), come il player Go che
questo sostituisce. Codici di uscita: `0` tutto bene · `1` problemi di
giocabilità (o errori del linter, o playthrough che non arriva in fondo) · `2`
errore d'uso.

Comandi in gioco: `:aiuto`, `:debug`, `:stato`, `:flag`, `:inv`, `:scena`,
`:storico`, `:azioni`, `:traccia`, `:esci`. Funzionano anche durante il
tap-to-continue.

## Script di playthrough

Poiché il resolver può solo scegliere tra azioni già definite, una partita è
interamente descritta dalla sequenza di id di azione/scelta. Un file di
playthrough è quella sequenza, una voce per riga:

```
# le azioni si indicano con l'id (il prefisso a: è facoltativo)
a:continua
parla_oste
# le scelte di dialogo con l'id del nodo di destinazione
c:d_chiave
prendi_chiave
esci
```

Si accetta anche il numero della voce nell'elenco corrente, ma gli id sono più
robusti: non cambiano se l'ordine delle azioni cambia.

A cosa serve davvero: è un test di regressione sulla storia. Domani cambi una
condizione nell'IR, o ritocchi lo schema, o tocchi il player: rilanci quel
comando e in due secondi sai se la storia è ancora percorribile fino in fondo.
Se un'azione dello script non è più disponibile, il player distingue i due casi
che contano — azione inesistente (refuso nello script) e azione esistente ma
filtrata da una condizione (regressione nella storia).

Lo stesso file si incolla nella scheda `traccia` del player web.

## Linter

`--lint` (o la scheda `linter`) esegue i controlli statici che la validazione
di schema non può fare:

- `goto_scene` / `goto_dialogue` / `next` / scelte verso id inesistenti
- scene irraggiungibili da `start_scene`, scene terminali (i finali)
- nodi di dialogo irraggiungibili, nodi monchi (né scelte, né `next`, né `end`)
- alberi di dialogo che nessuna azione raggiunge
- condizioni impossibili: flag richiesto e mai impostato, oggetto richiesto e
  mai messo in inventario
- convenzioni delle cutscene (una sola azione, nessun dialogo, narrazione presente)
- confronto con `state_flags_schema` e `inventory_schema`, quando ci sono

Il linter è statico: trova le porte chiuse a chiave, non dice se la storia si
gioca bene. Per quello serve giocarla.

## Struttura

```
src/core/     engine, stato, Effect/Condition, linter, resolver, lettura strict dell'IR
              (nessun DOM, nessun stdin: e' il pezzo condiviso)
src/web/      player web: transcript, chip, pannello di debug
src/cli/      terminale interattivo, esecutore di script, colori e wrap
scripts/      embed.mjs: incorpora un IR nella build web
test/         test di engine, linter e lettura dell'IR
testdata/     fixture: una storia sana e una deliberatamente rotta
```

Due vincoli architetturali si vedono direttamente nel codice:

- **il player non contiene logica narrativa propria**: non inventa azioni, non
  genera testo, non modifica lo stato se non applicando `Effect` già presenti
  nell'IR. Se qualcosa non si può fare è perché l'IR non lo prevede;
- **la lettura dell'IR è severa**: un campo non previsto dallo schema fa
  fallire il caricamento, esattamente come `additionalProperties: false` lato
  JSON Schema. Il player è anche un test di conformità dell'IR.

## Resolver

L'interfaccia è quella fissata dall'architettura: riceve le azioni disponibili
nella scena, il testo libero del giocatore e il tono della scena, e ritorna
l'id di un'azione **già esistente** oppure nessun match con una narrazione di
fallback in-character. Due vincoli, e sono quelli su cui poggia tutto il resto:
un resolver non genera mai un effetto di sua iniziativa, e **non genera mai
nemmeno il testo del fallback** — lo sceglie fra quelli che l'autore ha scritto
in `no_match_narration`.

Modalità, si sceglie con `--resolver` (o dalla scheda **resolver** del
pannello, nel player web):

| modalità | a cosa serve |
|---|---|
| `lessicale` *(default)* | giocare. Deterministico, nessun modello, nessuna rete, nessun byte scaricato |
| `ibrido` | giocare con i vettori: il lessicale decide, i vettori intervengono dove tace |
| `embedding` | **misurare**, non giocare: i vettori decidono da soli, senza rete di protezione |
| `claude` | non ancora implementato |

Che `embedding` puro esista separato dall'ibrido non è pignoleria: nell'ibrido i
vettori parlano solo dove il lessicale ha già rinunciato, e da lì non si
distingue «ha aggiunto poco» da «non era mai il suo turno». Per saperlo bisogna
farli decidere da soli su tutto.

Gli alias *sono* la copertura del lessicale: un'azione con tre alias è
un'azione che quasi nessuno riuscirà a chiedere. Il modello non è una
dipendenza del player: la CLI lo prende da una dipendenza opzionale (`npm i
--no-save @huggingface/transformers`), il player web da CDN al momento in cui
lo si accende. Chi non lo usa non scarica niente, e il file HTML unico resta
unico.

La scheda **resolver** del pannello espone anche i tre indirizzi da cui i
vettori dipendono — la libreria, il modello, l'host dei pesi — perché è sempre
uno di quei tre a fallire, e senza poterli cambiare l'unica diagnosi possibile
è «Failed to fetch». Servono anche per puntare a un mirror interno o a una
copia servita in locale.

**Dove i vettori non funzionano, e perché.** Da `file://` il browser tratta la
pagina come origine opaca e le richieste esterne cadono; nella pagina
*pubblicata* non passa nessuna richiesta verso l'esterno per politica del sito.
In tutti e due i casi la libreria o il modello non arrivano, e il player lo
dice a parole invece di lasciare l'errore grezzo, restando sul lessicale.
Servito da http è una pagina web come un'altra e funziona: è esattamente il
motivo per cui esiste `npm run serve`.

Il backend a menu non c'è più: i test di regressione non passano dal resolver
(li guida `--script`) e per ispezionare una scena c'è `--debug`, che stampa
l'elenco delle azioni e accetta il numero della riga.

### Perché in `ibrido` i vettori intervengono solo in due punti

I due modi di risolvere sbagliano in modi diversi, e la divisione del lavoro
segue il costo dell'errore:

- il **lessicale** sbaglia **rifiutando**: costa al giocatore una frase
  riscritta;
- l'**embedder** sbaglia **facendo**: gli embedding di frase sono ciechi sulla
  negazione e sulla direzione degli argomenti, e un falso positivo *esegue* —
  applica un `Effect`, alza un flag, brucia un enigma.

Quindi l'embedder interviene **solo dove il lessicale è muto** (e non per
ambiguità: se due azioni se la giocano alla pari, il problema non è che manchi
comprensione) e **sempre nella scelta del fallback**, dove sbagliare è gratis.
In una riga: *embedding dove sbagliare non costa niente, lessicale dove
sbagliare cambia lo stato*.

### Verbi del player

Quattro domande che non passano da nessuna azione, e che il giocatore fa più
di qualunque altra cosa:

| si scrive | risponde |
|---|---|
| `guardati intorno`, `dove sono` | `Scene.look`, o la `look_variants` che vale adesso |
| `cosa ho nello zaino`, `inventario` | i `name` degli oggetti, con la cornice di `player_voice` |
| `chi c'è qui`, `quali sono i personaggi` | i nomi di `Scene.characters`, meno il `protagonist` |
| `guarda il walkie` | `items[].description`, o la `description_variants` che vale adesso |

Si consultano **dopo** il resolver: un'azione dell'autore vince sempre su un
verbo di sistema, così una scena che ha davvero un'azione «fruga nello zaino»
non se la vede scippare. Non consumano un turno e non entrano nella traccia,
quindi non toccano la rigiocabilità di un playthrough.

Guardare un oggetto vale solo per quelli **in inventario** e vuole un verbo di
percezione: senza, «prendi il coltello» finirebbe qui invece che nell'azione
della scena.

### Misurare, invece di discutere

```bash
zaiplay --copertura story.ir.json                       # lessicale
zaiplay --copertura --resolver ibrido story.ir.json     # lessicale + vettori
zaiplay --copertura --resolver embedding story.ir.json  # solo vettori
```

Le tre righe insieme dicono quello che nessuna delle tre dice da sola: quanto
prende il lessicale, quanto aggiunge l'ibrido sopra di lui, e quanto
prenderebbero i vettori da soli — cioè se l'ibrido stia guadagnando o solo
costando.

Passa le `Action.test_phrases` dell'IR al backend e conta quante arrivano
all'id giusto, distinguendo le **perse** (nessun match) dalle **sbagliate**
(azione diversa). La distinzione è il punto: un backend che alza il richiamo
aggiungendo errori del secondo tipo sta peggiorando la storia. Esce con `1` se
ci sono frasi sbagliate.

Le soglie stanno esportate in `src/core/resolver.ts` (`ACCETTA`, `MARGINE`,
`CERTEZZA`) ed è lì che si mettono le mani quando una storia risulta troppo
sorda o troppo credulona.

## Test

```bash
npm test
```

Le fixture in `testdata/` sono due: `mini.ir.json` è una storia sana che copre
cutscene, dialogo con scelte, condizioni su flag e inventario, azione non
ripetibile e scena finale; `rotta.ir.json` contiene un esemplare di ogni bug
che il linter deve saper trovare.

Il test end-to-end vero resta il playthrough di riferimento:

```bash
node dist-node/src/cli/zaiplay.js \
  --script ../examples/nel-paese-dei-ciechi.playthrough.txt \
  ../examples/nel-paese-dei-ciechi.ir.json
```
