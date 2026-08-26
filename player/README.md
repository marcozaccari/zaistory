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
npm run build:web               # -> dist/index.html (~45 KB, tutto dentro)
npm run embed -- ../examples/nel-paese-dei-ciechi.ir.json paese.html

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../examples/nel-paese-dei-ciechi.ir.json
```

Serve solo Node 22+. Nessuna dipendenza a runtime: TypeScript e Vite sono
soltanto strumenti di build, e il codice spedito al browser non importa niente
da `node_modules`.

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
si fa aprendo un IR che non si è compilato adesso. Un tocco su `comincia` e la
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
zaiplay story.ir.json                    # gioca
zaiplay --debug story.ir.json            # parte in modalità debug
zaiplay --lint story.ir.json             # solo analisi statica, poi esce
zaiplay --record partita.txt story.ir.json   # registra la partita giocata
zaiplay --script partita.txt story.ir.json   # la rigioca senza input umano
```

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
fallback in-character. Un resolver non genera mai un effetto di sua iniziativa.

Backend previsti, si sceglie con `--resolver`:

1. `menu` — selezione a menu numerato. Deterministico, zero dipendenze: è la
   modalità da usare per i test di regressione. **L'unico implementato.**
2. `claude` — input testuale libero via API. Non ancora implementato.
3. `locale` — LLM/SLM piccolo eseguito offline. Non ancora implementato.

Il player web usa oggi solo il menu (le chip *sono* il menu). Quando esisterà
un backend a testo libero, gli basterà una casella di input sopra le chip: il
resto non cambia.

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
