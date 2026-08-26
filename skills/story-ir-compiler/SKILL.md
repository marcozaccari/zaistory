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

**Versione di questo compilatore: 1.0.0.** Va riportata in `generated_by` di
ogni IR prodotto (passo 6); alzala quando cambi le regole di compilazione, non
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

## Pipeline

### 1. Leggi la sceneggiatura sorgente

Se è un file caricato, leggilo per intero prima di iniziare (non lavorare
a blocchi indovinati). Se è incollata nel messaggio, usa quel testo.

### 2. Stadio A — estrai la story map

Leggi **`references/stage_a_story_map.md`** e applica le sue regole
all'intera sceneggiatura per produrre un oggetto `story_map` (id stabili,
personaggi, stile globale, elenco `scene_segments` con hint letterali per
la segmentazione). Non saltare questo passo anche se la sceneggiatura è
breve: gli id devono essere decisi UNA volta e restare stabili per tutto
il resto della compilazione.

Scrivi `story_map.json` su disco (non solo a parole) — ti servirà come
riferimento fisso mentre compili le singole scene, per non "dimenticare"
un id già assegnato con l'avanzare della conversazione.

### 3. Segmenta lo script nei blocchi per-scena

Usa lo script di supporto invece di tagliare a mano il testo (più
affidabile, stessa logica del segmenter del progetto CLI):

```bash
python3 scripts/segment.py sceneggiatura.md story_map.json > scene_blocks.json
```

Se fallisce perché un hint non è stato trovato, il messaggio di errore
indica quale scena — quasi sempre significa che al passo 2 hai parafrasato
l'estratto invece di copiarlo letteralmente dal testo originale: correggi
`story_map.json` (l'hint di quella scena) e riprova, non serve rifare
tutta la story map.

### 4. Stadio B — compila ogni scena

Per ogni blocco prodotto al passo 3, leggi **`references/stage_b_scene.md`**
e applica le sue regole (in particolare le sezioni su `scene_type`
cutscene/interactive, narrazione multi-beat con immagini per-inquadratura,
azioni contestuali poche ed esplicite, parlanti non previsti dalla story map)
per produrre l'oggetto `Scene` in JSON.

Se la scena introduce parlanti o luoghi ricorrenti che non sono nella story
map, tienine da parte le schede (`new_characters`, `new_places`): servono al
passo 6.

Regola pratica per non perdere coerenza su sceneggiature lunghe: prima di
compilare la scena N, ripassa velocemente gli id già usati nelle scene
1..N-1 (personaggi, flag, id di scena per i `goto_scene`) — sono nella
story map e nelle scene già scritte, non inventarne di nuovi per la stessa
entità.

### 5. Valida e correggi, scena per scena

Dopo aver scritto ogni `Scene`, valida SUBITO (non aspettare la fine):

```bash
python3 scripts/validate.py --scene scena.json
```

Se fallisce, correggi solo quello segnalato e rivalida — stesso loop del
compilatore CLI, non riscrivere la scena da zero per un errore di schema.

### 6. Assembla la Story completa

```json
{
  "ir_version": "1.4.0",
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
  "inventory_schema": "<story_map.inventory_schema>",
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

### 7. Valida l'intera Story e controlla i riferimenti pendenti

```bash
python3 scripts/validate.py story.ir.json
```

In più, controlla a mano (lo script valida lo schema, non la coerenza
narrativa) che ogni `goto_scene` punti a un id di scena effettivamente
presente in `scenes[]` — se non lo è, segnalalo all'utente invece di
inventare la scena mancante di tua iniziativa: potrebbe essere una parte
di sceneggiatura non ancora scritta.

### 8. Consegna

Scrivi `story.ir.json` come file (usa `create_file`, salvalo in
`/mnt/user-data/outputs/`) e presentalo con `present_files`. Se l'utente
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
  della story map (leggilo per intero al passo 2, non solo l'inizio).
- `references/stage_b_scene.md` — regole complete per la compilazione di
  ogni singola scena (leggilo per intero ad ogni scena finché non ti è
  familiare; non fare shortcut su cutscene/azioni contestuali).
- `references/engine-ir.schema.json` — il contratto di formato, usato dagli
  script di validazione e utile da consultare se un errore di validazione
  non è chiaro dal solo messaggio.
