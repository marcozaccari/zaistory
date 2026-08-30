---
name: story-ir-compiler
description: >-
  Compila una sceneggiatura in markdown libero (scene abbozzate, dialoghi,
  note di tono e atmosfera) in un file IR giocabile e player-agnostic
  (story.ir.json) per un motore narrativo interattivo tipo
  punta-e-clicca/visual-novel - dialoghi a scelte, azioni contestuali per
  scena, cutscene narrate, prompt per immagini/voce/suoni pronti per la
  generazione asset. Usa SEMPRE questa skill quando l'utente chiede di
  "compilare" una sceneggiatura, generare l'IR/formato intermedio di una
  storia interattiva, trasformare una bozza narrativa in una struttura
  giocabile, o menziona story.ir.json, engine-ir.schema.json, "motore
  narrativo", o storia punta-e-clicca. Attivala anche solo quando allega un
  file .md di sceneggiatura e chiede di prepararlo per un player o per la
  generazione di asset (immagini/voce/musica), anche senza nominare
  esplicitamente "IR".
---

# Story IR Compiler

**Versione di questo compilatore: 1.4.0.** Va riportata in `generated_by` di
ogni IR prodotto (passo 7); alzala quando cambi le regole di compilazione, non
a ogni ritocco di forma.

Compila una sceneggiatura in markdown libero nel formato IR (`story.ir.json`)
conforme a `references/engine-ir.schema.json`. Replica in conversazione la
pipeline a due stadi del progetto CLI (Stadio A: story map, Stadio B: scena
per scena) — con la differenza che qui SEI TU il modello che applica le
regole, non un'altra chiamata API: leggi i riferimenti e applica le loro
istruzioni direttamente, con lo stesso rigore che avresti seguendo un
prompt di sistema.

## Quando NON serve questa skill

Se l'utente chiede solo di discutere/rivedere la sceneggiatura, dare
feedback narrativo, o scrivere altre scene in prosa libera — è scrittura
normale, non compilazione. Questa skill serve quando l'output atteso è la
struttura giocabile (JSON conforme allo schema), non altro testo narrativo.

## Per chi stai compilando: un giocatore che scrive, non che sceglie

Tienilo presente da prima di cominciare, perché cambia cosa scrivi in ogni
scena. Il player di test mostra le azioni come bottoni, ma **quella è
impalcatura di collaudo**: il player definitivo si comanda a parole — «guardati
intorno», «dove mi trovo», «prendi il coltello», «cosa ho nello zaino», «apri la
porta con la chiave», «parla con Mark». Un modulo separato (il resolver) prende
la frase e sceglie fra le azioni che hai definito; non ne inventa nessuna.

**Il parlato però no.** I dialoghi restano a scelte esplicite, come nelle
avventure grafiche classiche: dentro un `dialogue_tree` il giocatore vede
l'elenco delle battute e ne tocca una, e l'input libero non entra mai. Il
confine è netto e sta all'ingresso: «parla con Mark» è un'azione e passa dal
resolver, quello che si dice a Mark è un menu.

Tre conseguenze pratiche, e sono le tre cose che si sbagliano di più:

1. **Niente si scopre da una `label`.** Con i bottoni, l'etichetta "Prendi il
   rotolo di nastro isolante" è metà della scoperta; a parole, quel rotolo
   esiste solo se il testo che il giocatore legge lo nomina. Tutto ciò che deve
   essere trovato va nominato in `narration`, in `look`, o nell'esito di
   un'altra azione. La difficoltà viene da cosa il testo dice e non dice, mai
   da un menu che si accorcia.
2. **Ci sono quattro domande che non passano da nessuna azione**, e che il
   giocatore fa più di qualunque altra cosa: «dove sono» (`Scene.look`), «cosa
   ho nello zaino» (`player_voice` + i `name` degli oggetti), «chi c'è qui»
   (`player_voice` + `Scene.characters`) e «guarda il coltello»
   (`items[].description`). Il player risponde da sé, con testo tuo. Non sono
   azioni, non pesano sul numero di azioni della scena, e **non vanno mai
   duplicate come azioni**.

   Corollario sull'elenco dei presenti, che si *deriva* invece di scriversi:
   chiunque metti in `Scene.characters` verrà nominato a chi lo chiede — quindi
   non ci si mette qualcuno che il giocatore deve ancora scoprire.
3. **Gli agganci vanno scritti**: `aliases` sulle azioni, `name` e `aliases`
   sugli oggetti, `aliases` sui personaggi («il ragazzo», «quello con la
   barba»). Sono il modo in cui una frase arriva alla cosa giusta. Le scelte di
   dialogo non ne hanno bisogno: quelle si vedono e si toccano.

## La regola che governa tutto il resto: l'intelligenza sta qui, non nel player

Vale la pena dirla prima delle regole di gioco, perche' cambia il *volume* di
quello che scrivi in ogni scena.

Il resolver del player non genera testo: sceglie un id fra le azioni che hai
definito. Non e' un modello che capisce la frase del giocatore — e' un matcher
che confronta quella frase con quello che **tu** hai scritto. Quindi:

- **la comprensione si precalcola**: gli `aliases` sono la conoscenza semantica
  dell'azione, congelata nell'IR. Quindici-venticinque per azione, non tre.
  Sotto la decina, l'azione diventa quasi impossibile da chiedere;
- **la prosa si prescrive**: `no_match_narration` per scena (le risposte a chi
  chiede una cosa che non c'e', una per intenzione), `look_variants` (la stanza
  com'e' *adesso*), `player_voice` (inventario e fallback globali).

Il player **non inventa mai una riga**. Se per un'intenzione non hai scritto
niente, non dice niente: mostra una nota diagnostica, che e' esattamente il
buco che si voleva vedere. Generare quel testo a runtime sarebbe peggio, e per
un motivo che va oltre la qualita': un testo generato nomina scenario che nel
gioco non esiste — una lampada citata per colore diventa un falso indizio su
cui il giocatore perde dieci minuti — e nessun linter puo' controllarlo. Il
testo scritto qui, invece, si controlla.

Infine `test_phrases`: 3-5 parafrasi per azione, **tenute fuori dagli alias**.
Non le legge nessun player, le legge il linter (`zaiplay --copertura`) per
misurare quante frasi arrivano all'azione giusta. E' il modo in cui si smette
di discutere a naso di quale backend serva.

## Regole di gioco — valgono per ogni scena, non sono negoziabili

Queste quattro regole vengono prima di qualunque scelta di design che farai
nello Stadio B. Se una scena sembra chiedere il contrario, è la scena che va
riscritta, non la regola che va sospesa.

1. **Non si perde mai.** Niente morti, niente game over, niente vicoli ciechi,
   niente partita da ricominciare. Qualunque cosa faccia il giocatore, e in
   qualunque ordine la faccia, si arriva sempre allo stesso finale. Quello che
   cambia non è **se** ci arriva, è **quanto gli costa**.
2. **Il costo dell'errore è camminare all'indietro.** L'unica punizione
   ammessa è rimettere il giocatore in una scena che ha già visitato, così che
   debba rifare la strada: un `goto_scene` all'indietro, e basta. Nessuna
   barra della minaccia, nessun avversario di cui il gioco tenga la posizione,
   nessuna variabile che dica dove si trova il pericolo. La minaccia è una
   **pressione**, non un'entità simulata.
3. **Le risorse non si contano.** Trovare qualcosa è un evento; amministrarlo
   non è un gioco. Un oggetto in inventario dà accesso ad azioni, non ha una
   quantità che scende, e nessuna azione fallisce mai perché è finito
   qualcosa. Se la sceneggiatura dice "mezza scatola di cartucce", quella è
   un'immagine, non una scorta.
4. **Il tempo non esiste.** Nessun timer, da nessuna parte, mai. Nessuna
   azione scade, nessuna scena si chiude da sola, nessuna occasione va persa
   perché il giocatore ha esitato: si può restare fermi in una stanza per
   un'ora e non succede niente. Una scena cambia **solo** perché il giocatore
   ha scelto qualcosa. Dove la sceneggiatura ha urgenza — una porta che viene
   bucata, qualcosa che gira intorno alla casa — quell'urgenza è **recitata**:
   sta nel testo, nel suono e nelle immagini, non nella logica. Il giocatore
   deve sentire il panico, non subirlo.

   Non c'è modo di violare questa regola per sbaglio distratto: l'IR non ha
   nessun costrutto temporale da usare male. Il modo in cui la si viola è
   simularlo — un flag "attesa" incrementato a ogni azione, una scena che
   dopo tre osservazioni ne forza un'altra. Non farlo.

Una conseguenza pratica che vale la pena scrivere: se un'azione dello script
"uccide" il protagonista, il suo `effect` non chiude la partita — narra il
colpo mancato, il rumore, lo spavento, e rimanda il giocatore indietro di
una o due scene. È lì che va a finire tutta la tensione che in un altro gioco
sarebbe stata un game over.

## Pipeline

### 1. Leggi la sceneggiatura sorgente

Se è un file caricato, leggilo per intero prima di iniziare (non lavorare
a blocchi indovinati). Se è incollata nel messaggio, usa quel testo.

Mentre leggi, tieni separate due cose che nel documento stanno mescolate:

- **la sceneggiatura** — quello che il giocatore vedrà, sentirà e leggerà;
- **gli appunti di giocabilità dell'autore** — blocchi marcati (tipicamente
  `#### Giocabilità` in coda a una scena, o una sezione globale
  `## Note di giocabilità`) più le note di regia e produzione. Sono
  **istruzioni rivolte a te**: condizioni di sblocco, azioni previste, errori
  attesi, cose da non dire mai al giocatore. Non finiscono mai nel testo che
  il giocatore legge, e non si trascurano mai.

### 2. Chiedi all'utente, prima di analizzare

Due decisioni non si deducono dal testo, e indovinarle sbagliate si paga con
una ricompilazione intera. Chiedile **prima** di partire con lo Stadio A, in
una domanda sola con due punti:

1. **Quanta libertà hai su enigmi, azioni, oggetti e flag?** Segui soltanto
   gli appunti di giocabilità già presenti nello script; oppure li rispetti
   dove ci sono e inventi il resto; oppure progetti la giocabilità da game
   designer, aggiungendo enigmi e oggetti non previsti (senza mai cambiare la
   trama).
2. **Quanto puoi rielaborare i dialoghi?** Resti fedele alle battute già
   scritte, aggiungendo solo il testo tecnicamente necessario (narrazioni
   d'ingresso, esiti delle azioni); oppure le tieni intatte ma aggiungi scelte
   e risposte in stile; oppure le riscrivi e le amplii restando nel tono.

Proponi le opzioni con un default esplicito — "segui gli appunti" e "fedele ai
dialoghi" sono i default sensati: sono quelli che non tradiscono un autore che
ha già deciso. Se l'utente ha già risposto a queste domande in un messaggio
precedente, o se ha chiesto esplicitamente di non essere interrotto, non
richiederle: prendi la risposta che ti ha già dato e dichiara a voce quale hai
assunto.

Quello che decidi qui vale per tutta la compilazione, e va detto allo Stadio B
insieme al resto del contesto: è la differenza fra una scena con tre azioni e
la stessa scena con otto.

### 3. Stadio A — estrai la story map

Leggi **`references/stage_a_story_map.md`** e applica le sue regole
all'intera sceneggiatura per produrre un oggetto `story_map` (id stabili,
personaggi, luoghi, stile globale, inventario iniziale, elenco
`scene_segments` con hint letterali per la segmentazione). Non saltare questo
passo anche se la sceneggiatura è breve: gli id devono essere decisi UNA
volta e restare stabili per tutto il resto della compilazione.

Scrivi `story_map.json` su disco (non solo a parole) — ti servirà come
riferimento fisso mentre compili le singole scene, per non "dimenticare"
un id già assegnato con l'avanzare della conversazione.

### 4. Segmenta lo script nei blocchi per-scena

Usa lo script di supporto invece di tagliare a mano il testo (più
affidabile, stessa logica del segmenter del progetto CLI):

```bash
python3 scripts/segment.py sceneggiatura.md story_map.json > scene_blocks.json
```

Se fallisce perché un hint non è stato trovato, il messaggio di errore
indica quale scena — quasi sempre significa che al passo 3 hai parafrasato
l'estratto invece di copiarlo letteralmente dal testo originale: correggi
`story_map.json` (l'hint di quella scena) e riprova, non serve rifare
tutta la story map.

### 5. Stadio B — compila ogni scena

Per ogni blocco prodotto al passo 4, leggi **`references/stage_b_scene.md`**
e applica le sue regole (in particolare le sezioni su `scene_type`
cutscene/interactive, narrazione multi-beat con immagini per-inquadratura,
azioni contestuali poche ed esplicite, appunti di giocabilità dell'autore,
parlanti non previsti dalla story map) per produrre l'oggetto `Scene` in JSON.

Se la scena introduce parlanti o luoghi ricorrenti che non sono nella story
map, tienine da parte le schede (`new_characters`, `new_places`): servono al
passo 7.

Regola pratica per non perdere coerenza su sceneggiature lunghe: prima di
compilare la scena N, ripassa velocemente gli id già usati nelle scene
1..N-1 (personaggi, flag, id di scena per i `goto_scene`) — sono nella
story map e nelle scene già scritte, non inventarne di nuovi per la stessa
entità.

### 6. Valida e correggi, scena per scena

Dopo aver scritto ogni `Scene`, valida SUBITO (non aspettare la fine):

```bash
python3 scripts/validate.py --scene scena.json
```

Se fallisce, correggi solo quello segnalato e rivalida — stesso loop del
compilatore CLI, non riscrivere la scena da zero per un errore di schema.

### 7. Assembla la Story completa

```json
{
  "ir_version": "1.9.0",
  "generated_by": {
    "compiler": "story-ir-compiler",
    "compiler_version": "<la versione dichiarata in cima a questo file>",
    "model": "<il modello con cui stai girando, es. claude-opus-5>"
  },
  "id": "<story_map.id>",
  "title": "<story_map.title>",
  "language": "<story_map.language o \"it\">",
  "global_style": "<story_map.global_style>",
  "characters": "<story_map.characters + i new_characters emessi dallo Stadio B, deduplicati per id>",
  "places": "<story_map.places + i new_places emessi dallo Stadio B, deduplicati per id>",
  "start_scene": "<story_map.start_scene>",
  "state_flags_schema": "<story_map.state_flags_schema>",
  "items": "<story_map.items + i new_items emessi dallo Stadio B, deduplicati per id>",
  "initial_inventory": "<story_map.initial_inventory, se la storia comincia con qualcosa gia' in mano>",
  "scenes": ["<tutte le Scene compilate, nell'ordine dei segmenti>"]
}
```

Su `generated_by`: serve a sapere, riaprendo l'IR fra sei mesi, con cosa e'
stato prodotto — domanda tutt'altro che oziosa, visto che questo compilatore
non e' deterministico fra sessioni e due compilazioni della stessa
sceneggiatura non coincidono. **Se non sei certo dell'identificatore del
modello con cui stai girando, ometti `model` invece di tirare a indovinare**:
una provenienza inventata e' peggio di una provenienza assente, perche' porta
a cercare differenze dove non ce ne sono.

Non e' una violazione della regola "l'IR non nomina mai un generatore": quella
riguarda il binding ai generatori di *asset* (TTS, immagini), che nessun
consumatore deve trovare nell'IR perche' cambiarli non deve toccarlo. Qui si
tratta di una firma in calce al documento, che nessuno legge per decidere cosa
fare.

### 7-bis. Controlla di aver scritto per un giocatore che parla

Prima di validare, ripassa questi cinque punti: sono quelli che distinguono un
IR giocabile a parole da uno giocabile solo a bottoni. Non sono consigli — il
linter li segnala come **errori**, e un IR che non li rispetta non e' un IR
vecchio da tollerare: e' un IR incompleto.

- ogni azione ha **15-25 `aliases`** e, dove ha senso, un `target`. Nessun
  alias ricalca un verbo del player («guardati intorno», «cosa ho», «zaino»):
  il resolver gira per primo, quindi glielo scipperebbe;
- ogni azione ha **3-5 `test_phrases`**, diverse dagli alias;
- ogni scena interattiva ha un **`look`**, e `look_variants` dove lo stato
  cambia qualcosa che si vede entrando;
- ogni scena interattiva ha **`no_match_narration`**, `generico` compreso;
- la storia ha **`player_voice`** (inventario, presenti, fallback globali) e
  **`protagonist`**;
- ogni oggetto ha una **`description`**, e `description_variants` se cambia
  durante la storia.

### 7-ter. Controlla il contratto visivo

I `visual_prompt` e gli `image_prompt` non sono decorazione: sono l'ingresso
del modulo assets, e un difetto qui si scopre solo pagando immagini sbagliate.
Le regole complete stanno negli stage A e B; questi sono i quattro punti su
cui si sbaglia davvero, imparati generando.

- **Ogni prompt di generazione esiste in due lingue.** L'italiano e' il
  canonico — e' quello che il player mostra in modalita' solo testo — e
  l'inglese e' quello che va al modello, perche' un prompt italiano perde
  aderenza e uno style suffix in coda a un prompt italiano lungo puo' venire
  ignorato in blocco. Se manca un `*_en`, quel prompt viene generato in
  italiano: non e' un errore di schema, e' un'immagine peggiore.
- **Nei soli `image_prompt_en`, i personaggi in campo si chiamano per nome.**
  E' l'unica divergenza ammessa fra le due lingue: il generatore allega il
  ritratto di ognuno e i nomi sono cio' che lega l'allegato al soggetto. Senza,
  il modello distribuisce i ruoli a caso — chi guida, chi sta seduto accanto.
  L'italiano resta prosa da sceneggiatura, come deve essere.
- **`visual_prompt` descrive l'aspetto, non l'azione**, e si ferma dove si
  ferma il taglio scelto per il cast. Nominare qualcosa fuori dal taglio (le
  scarpe, con un taglio a mezzo busto) tira l'immagine a figura intera: il
  contenuto vince sempre sul promemoria di inquadratura.
- **`anchor_framing` si decide una volta per tutto il cast**, in stage A. Un
  cast con ritagli disomogenei sembra venire da storie diverse. L'override per
  personaggio esiste, ma e' per i soggetti non umani, non per fare eccezioni
  di gusto.

Un IR gia' compilato senza i campi inglesi non va ricompilato: il progetto ha
`assets-studio/images/translate_ir.py` (`extract` / `merge` / `status`) che li
aggiunge in place lasciando intatti gli id.

### 8. Valida l'intera Story e controlla i riferimenti pendenti

```bash
python3 scripts/validate.py story.ir.json
```

Oltre agli errori di schema, lo script elenca i **prompt senza la versione
inglese**: non è una violazione del formato — l'inglese è opzionale — ma quei
prompt arriverebbero al generatore di immagini in italiano, dove perdono
aderenza. Trattali come lavoro da finire, non come rumore (`--no-prompt-check`
li tace, e serve solo se stai validando una storia senza parte visiva).

In più, controlla a mano (lo script valida lo schema, non la coerenza
narrativa):

- che ogni `goto_scene` punti a un id di scena effettivamente presente in
  `scenes[]` — se non lo è, segnalalo all'utente invece di inventare la scena
  mancante di tua iniziativa: potrebbe essere una parte di sceneggiatura non
  ancora scritta;
- che **ogni scena non finale abbia almeno un'uscita raggiungibile senza
  condizioni impossibili**, e che nessuna azione lasci il giocatore in uno
  stato da cui non si prosegue. Una storia in cui si può restare bloccati
  viola la prima regola di gioco anche se lo schema è valido.

Se il progetto ha un player con linter (`zaiplay --lint`), passaci l'IR: trova
scene irraggiungibili, `goto` rotti, flag richiesti e mai impostati, piu' tutto
quello che manca al parlato (azioni con pochi alias, scene senza `look` o senza
`no_match_narration`, frasi di prova copiate dagli alias).

E se hai scritto le `test_phrases`, misura anche quanto la storia si lascia
giocare a parole:

```bash
zaiplay --copertura story.ir.json
```

Distingue le frasi **perse** (nessun match: il giocatore deve riscrivere) da
quelle **sbagliate** (parte un'altra azione: un `Effect` che nessuno ha
chiesto). Le seconde sono difetti veri, e quasi sempre significano due azioni
della stessa scena con alias troppo simili: separale.

### 9. Consegna

Scrivi `story.ir.json` come file e presentalo all'utente. Se l'utente
aveva chiesto esplicitamente un "markdown tecnico intermedio" invece di
JSON puro, avvolgi lo stesso oggetto in un `.md` con un blocco
` ```json ` per sezione scena — il contenuto/schema restano identici,
cambia solo il contenitore.

## Limiti da comunicare all'utente

- **Nessuna cache tra conversazioni diverse**: se in una chat futura chiede
  di ricompilare la stessa sceneggiatura con una scena modificata, qui la
  ricompili tutta da capo (a differenza del progetto CLI, che salta le
  scene invariate). Comportati come se fosse un limite noto, non nasconderlo.
- **Determinismo**: essendo tu il compilatore in questa conversazione, due
  compilazioni della stessa sceneggiatura in due chat diverse possono
  produrre id/dettagli leggermente diversi. Se l'utente ha già un
  `story.ir.json` precedente e vuole solo aggiornarlo, preferisci editarlo
  in place (stessi id) invece di ricompilare tutto da zero.

## Riferimenti

- `references/stage_a_story_map.md` — regole complete per l'estrazione
  della story map (leggilo per intero al passo 3, non solo l'inizio).
- `references/stage_b_scene.md` — regole complete per la compilazione di
  ogni singola scena (leggilo per intero ad ogni scena finché non ti è
  familiare; non fare shortcut su cutscene/azioni contestuali).
- `references/engine-ir.schema.json` — il contratto di formato, usato dagli
  script di validazione e utile da consultare se un errore di validazione
  non è chiaro dal solo messaggio.
