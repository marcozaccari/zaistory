---
name: zaistory-compiler
description: >-
  Compila una sceneggiatura in markdown libero (scene abbozzate, dialoghi, note
  di tono e atmosfera) nel file giocabile e player-agnostic <id>.zaistory.json
  per un motore narrativo tipo avventura grafica punta-e-clicca - atti, luoghi
  navigabili con mappa, quattro gesti (guarda/usa/parla/vai, e il quarto e' un'uscita),
  dialoghi a scelte, cutscene narrate, prompt per immagini/voce/suoni pronti per
  la generazione asset. Usa SEMPRE questa skill quando l'utente chiede di
  "compilare" una sceneggiatura, di generare o aggiornare il file giocabile di
  una storia interattiva, di trasformare una bozza narrativa in una struttura
  giocabile, oppure menziona zaistory, zaistory.schema.json, "motore narrativo",
  avventura grafica o storia punta-e-clicca. Attivala anche solo quando allega un
  file .md di sceneggiatura e chiede di prepararlo per un player o per la
  generazione di asset (immagini/voce/musica), anche senza nominare il formato.
---

# zaistory compiler

**Versione di questo compilatore: 1.0.0.** Va riportata in `generated_by` di
ogni file prodotto (passo 7); alzala quando cambi le regole di compilazione, non
a ogni ritocco di forma.

Compila una sceneggiatura in markdown libero nel formato **zaistory**
(`<id>.zaistory.json`), conforme a `references/zaistory.schema.json`. La
pipeline è a due stadi — Stadio A: la mappa della storia; Stadio B: un luogo
alla volta — e qui **sei tu il compilatore**: leggi i riferimenti e applica le
loro istruzioni con lo stesso rigore che avresti seguendo un prompt di sistema.

Prima di cominciare, leggi `SPECS.md` e `ARCHITECTURE.md` del progetto se sono
raggiungibili: questa skill applica quelle regole, non le sostituisce.

## Quando NON serve questa skill

Se l'utente chiede di discutere o rivedere la sceneggiatura, dare feedback
narrativo, o scrivere altre scene in prosa — è scrittura normale, non
compilazione. Questa skill serve quando l'output atteso è la struttura
giocabile, non altro testo narrativo.

## Il modello, in venti righe

Senza questo in testa, ogni regola più sotto sembra arbitraria.

**Il giocatore ha quattro gesti**: `guarda`, `usa`, `parla`, e il movimento
(`vai`, `esci`, il bottone della mappa). Scrive in linguaggio naturale e un
parser riduce la frase a *verbo + fino a due complementi*. Nei dialoghi invece
sceglie da un elenco: si agisce a parole, si parla a scelte.

**La struttura è `Story → Act → Place → Phase`.** Il **luogo** è il nodo del
gioco: ci si entra, ci si guarda intorno, ci si agisce, e ci si torna finché
l'atto non lo chiude. La **fase** è com'è il luogo adesso, ed è l'unità che tu
ricavi da una scena della sceneggiatura — ma il rapporto non è uno a uno né in
un senso né nell'altro.

**Gli atti sono autonomi.** I flag sono locali e muoiono con l'atto; fra un atto
e il successivo passa solo l'inventario, più al massimo tre `carry_flags`
dichiarati che servono al *tono* e mai alla logica.

**La comprensione la scrivi tu, non il player.** Il verbo lo riconosce una
tabella che sta nel player; il **bersaglio** lo riconoscono gli `aliases` che
scrivi sulle entità. E ogni riga che il giocatore leggerà — narrazioni, `look`,
rifiuti, descrizioni — la scrivi qui: il player non genera una parola, e dove
manca il testo tace.

**Niente si scopre da un elemento di interfaccia.** Non c'è nessun elenco di
azioni: quello che il giocatore deve trovare va nominato nel testo che legge.
Una cosa nominata solo in un campo tecnico è invisibile.

## Pipeline

### 1. Leggi la sceneggiatura sorgente

Se è un file, leggilo **per intero** prima di iniziare: non lavorare a blocchi
indovinati. Mentre leggi, tieni separate due cose che nel documento stanno
mescolate:

- **la sceneggiatura** — quello che il giocatore vedrà, sentirà e leggerà;
- **gli appunti di giocabilità dell'autore** — blocchi marcati (tipicamente
  `#### Giocabilità` in coda a una scena, o una sezione globale `## Note di
  giocabilità`) più le note di regia. Sono **istruzioni rivolte a te**:
  condizioni di sblocco, azioni previste, errori attesi, cose da non dire mai al
  giocatore. Non finiscono mai nel testo che il giocatore legge, e non si
  trascurano mai. **Hanno la precedenza sulle regole di forma** di questa skill:
  se l'appunto elenca nove cose da fare in una stanza, sono nove.

Se esiste già una versione compilata della stessa storia, leggila: al passo 3 ne
erediterai gli id, e da quegli id dipendono immagini già generate e pagate.

### 2. Chiedi all'utente, prima di analizzare

Tre decisioni non si deducono dal testo, e indovinarle sbagliate si paga con una
ricompilazione intera. Chiedile **prima** dello Stadio A, in una domanda sola:

1. **Quanta libertà hai su enigmi, azioni, oggetti e flag?** Solo gli appunti di
   giocabilità già presenti; oppure li rispetti e inventi il resto; oppure
   progetti la giocabilità da game designer, aggiungendo enigmi e oggetti non
   previsti (senza mai cambiare la trama).
2. **Quanto puoi rielaborare i dialoghi?** Fedele alle battute già scritte,
   aggiungendo solo il necessario; oppure le tieni e aggiungi scelte e risposte
   in stile; oppure le riscrivi e le amplii restando nel tono.
3. **Quante entità interagibili al massimo per luogo?** È il budget che
   sostituisce il vecchio «3-6 azioni per scena»: conta gli oggetti e i
   personaggi su cui il luogo *risponde davvero*, non le combinazioni possibili.
   Default sensato: **4-8**, più scenografia osservabile quanta ne serve.

Proponi le opzioni con un default esplicito — «segui gli appunti», «fedele ai
dialoghi», «4-8» sono i default: sono quelli che non tradiscono un autore che ha
già deciso. Se l'utente ha già risposto, o ha chiesto di non essere interrotto,
non richiedere: dichiara a voce quale hai assunto.

Una quarta cosa **non** si chiede se il testo la dice: se la sceneggiatura ha
morti o finali alternativi, proponi `failure_mode: alternate_endings` e fattelo
confermare; altrimenti resta `none`, che è il default del progetto.

### 3. Stadio A — la mappa della storia

Leggi **`references/stage_a_story_map.md`** e applica le sue regole all'intera
sceneggiatura per produrre un oggetto `story_map`: id stabili, atti, luoghi,
personaggi, oggetti, stile globale, copertina, carry flags, e l'elenco
`scene_segments` che assegna **ogni scena del sorgente a un luogo e a una
fase**.

Non saltare questo passo nemmeno su una sceneggiatura breve: gli id si decidono
UNA volta e restano stabili per tutto il resto — e se esiste una compilazione
precedente, si **ereditano** da lì.

Scrivi `story_map.json` su disco, non solo a parole: ti serve come riferimento
fisso mentre compili, per non dimenticare un id già assegnato con l'avanzare
della conversazione.

### 4. Segmenta lo script

```bash
python3 scripts/segment.py sceneggiatura.md story_map.json > blocchi.json
```

Restituisce i blocchi **raggruppati per luogo**, nell'ordine in cui compaiono
nel sorgente — che è l'ordine in cui li compilerai come fasi.

Se fallisce perché un hint non è stato trovato, il messaggio dice quale
segmento: quasi sempre significa che al passo 3 hai parafrasato l'estratto
invece di copiarlo letteralmente. Correggi l'hint in `story_map.json` e riprova,
non rifare la story map.

### 5. Stadio B — compila un luogo alla volta

Per ogni luogo, leggi **`references/stage_b_place.md`** e applica le sue regole
per produrre l'oggetto `Place` completo: identità, uscite, oggetti d'ambiente e
tutte le sue fasi.

**L'unità di compilazione è il luogo, non la scena.** Un luogo si compila con
tutti i suoi blocchi sorgente davanti, perché le sue fasi si devono guardare fra
loro: cosa cambia dall'una all'altra, quale `look` racconta il cambiamento,
quale fase è quella esaurita.

Se un luogo introduce parlanti, oggetti o flag non previsti dalla story map,
tienine da parte le schede (`new_characters`, `new_items`, `new_flags`): servono
al passo 7.

### 6. Valida ogni pezzo, subito

```bash
python3 scripts/validate.py --def Place luogo.json
```

Non aspettare la fine. Se fallisce, correggi solo quello segnalato e rivalida:
non riscrivere il luogo da zero per un errore di schema.

### 7. Assembla la storia

```json
{
  "zaistory_version": "1.0.0",
  "generated_by": {
    "compiler": "zaistory-compiler",
    "compiler_version": "<la versione dichiarata in cima a questo file>",
    "model": "<il modello con cui stai girando, se ne sei certo>"
  },
  "id": "<story_map.id>",
  "title": "…", "description": "…", "language": "it",
  "failure_mode": "<none | alternate_endings>",
  "cover": "<story_map.cover>",
  "global_style": "<story_map.global_style>",
  "player_voice": "<story_map.player_voice>",
  "protagonist": "<story_map.protagonist>",
  "characters": "<story_map.characters + i new_characters, deduplicati per id>",
  "items": "<story_map.items + i new_items, deduplicati per id>",
  "initial_inventory": "<se la storia comincia con qualcosa già in mano>",
  "carry_flags": "<al massimo 3>",
  "start_act": "<story_map.start_act>",
  "acts": ["<gli atti, ognuno con i suoi Place compilati>"]
}
```

Su `generated_by`: **se non sei certo dell'identificatore del modello con cui
stai girando, ometti `model`** invece di tirare a indovinare. Una provenienza
inventata è peggio di una assente, perché fa cercare differenze dove non ce ne
sono. Non è una violazione della regola «il formato non nomina mai un
generatore»: quella riguarda il binding ai generatori di *asset*, che nessun
consumatore deve trovare qui perché cambiarli non deve toccare il contratto.
Questa è una firma in calce, e nessuno ci ramifica sopra.

### 7-bis. Controlla di aver scritto per un giocatore che parla

Sono i punti che distinguono una storia giocabile a parole da una giocabile solo
a bottoni — che qui vuol dire ingiocabile, perché i bottoni non ci sono. Il
linter li segnala come **errori**.

- ogni entità che può essere bersaglio — personaggio, oggetto d'ambiente,
  oggetto d'inventario, luogo, uscita — ha **8-15 `aliases`** e una
  **`description`**. Gli alias sono la copertura: scriverne tre è scriverne
  troppo pochi;
- ogni azione ha **3-5 `test_phrases`**, scritte *lontane* dagli alias;
- ogni azione con una `condition` ha la sua **`blocked_narration`**. Non esiste
  la deroga «questa nessuno la incontrerà mai al contrario»: chi gioca a parole
  prova le cose nell'ordine che gli viene in mente;
- ogni fase interattiva ha un **`look`**, e `look_variants` per ogni flag che in
  quella stessa fase apre o chiude qualcosa;
- ogni fase interattiva ha **`no_match_narration`**, `generic` compreso;
- ogni luogo in cui si può tornare ha una **fase esaurita** con il suo `look`:
  «qui non c'è più niente da fare» detto in tono, non un silenzio;
- ogni uscita ha `aliases`, e se è condizionata anche `blocked_narration`;
- la storia ha **`player_voice`** (inventario, presenti, uscite, fallback
  globali) e **`protagonist`**.

### 7-ter. Controlla il contratto visivo

I prompt non sono decorazione: sono l'ingresso del modulo assets, e un difetto
qui si scopre solo pagando immagini sbagliate.

- **Ogni prompt di generazione esiste in due lingue.** L'italiano è canonico —
  è quello che il player mostra in solo testo — e l'inglese è quello che va al
  modello, perché un prompt italiano perde aderenza e uno style suffix in coda a
  un prompt italiano lungo può essere ignorato in blocco.
- **Nei soli `image_prompt_en` i personaggi in campo si chiamano per nome.** È
  l'unica divergenza ammessa fra le due lingue: il generatore allega il ritratto
  di ognuno, e i nomi sono ciò che lega l'allegato al soggetto. Senza, il modello
  distribuisce i ruoli a caso.
- **`visual_prompt` descrive l'aspetto, non l'azione**, e si ferma dove si ferma
  il taglio scelto per il cast: nominare le scarpe con un taglio a mezzo busto
  tira l'immagine a figura intera.
- **`anchor_framing` si decide una volta per tutto il cast**, in Stadio A.
- **`characters_in_frame` dice chi si VEDE**, non chi è presente.
- **Il campo `image` non lo scrivi mai tu.** Lo scrive la pubblicazione del
  modulo assets. L'unica eccezione è la ricompilazione di una storia che ha già
  immagini: lì gli `image` esistenti si **conservano** insieme agli id a cui sono
  attaccati (vedi Stadio A, eredità degli id).

### 8. Valida tutto, poi fallo giocare

```bash
python3 scripts/validate.py <id>.zaistory.json
```

Lo schema dice che è **ben formato**. Che sia **giocabile** lo dice il linter del
player, e va passato prima di consegnare:

```bash
zaiplay --lint <id>.zaistory.json
zaiplay --copertura <id>.zaistory.json
```

La copertura distingue le frasi **perse** (nessun match: il giocatore riscrive)
da quelle **sbagliate** (parte un'altra azione: un effetto che nessuno ha
chiesto). Le seconde sono difetti veri, e quasi sempre significano due entità
dello stesso luogo con alias troppo simili: separale.

Controlla a mano le due cose che nessuno script vede:

- che ogni `goto_place` e ogni `Exit.to` puntino a un luogo esistente — se
  manca, **segnalalo all'utente invece di inventare il luogo mancante**: può
  essere una parte di sceneggiatura non ancora scritta;
- che **da qui, senza questo, si arrivi ancora alla fine**. È la domanda da fare
  a ogni oggetto facoltativo e a ogni uscita condizionata. Una storia in cui si
  può restare bloccati viola la prima regola di gioco anche se lo schema è
  valido.

### 9. Consegna

Scrivi il file come `<id>.zaistory.json` — il nome deve combaciare con il campo
`id`, e nella cartella della storia ce n'è esattamente uno.

## Limiti da comunicare all'utente

- **Nessuna cache fra conversazioni**: in una chat futura ricompili tutto da
  capo. È un limite noto, non nasconderlo.
- **Non sei deterministico fra sessioni**: due compilazioni della stessa
  sceneggiatura possono dare id e dettagli diversi. Se esiste già un file e
  serve solo un aggiornamento, **editalo in place** mantenendo gli id, invece di
  ricompilare.
- **Quello che scrivi in place, scrivilo anche nella sceneggiatura.** Un edit
  diretto sul file giocabile vive in un posto solo, e la prossima compilazione
  lo cancella: tu leggi la sceneggiatura, non il compilato. Quindi ogni
  modifica fatta a mano va riportata nel sorgente **nello stesso momento**, in
  modo che una compilazione futura la riproduca da sola. Se non sai dove
  metterla, dillo all'utente invece di lasciarla solo nel compilato: è la regola
  in `SPECS.md`, «La sceneggiatura è la sorgente».
- **Gli id valgono denaro.** Le immagini pubblicate sono agganciate agli id di
  entità e fase: cambiarli senza motivo butta via generazioni già pagate e
  selezionate a mano.

## Riferimenti

- `references/stage_a_story_map.md` — la mappa della storia: atti, luoghi,
  entità, e l'assegnazione delle scene ai luoghi. Leggilo per intero al passo 3.
- `references/stage_b_place.md` — la compilazione di un luogo con le sue fasi.
  Leggilo per intero a ogni luogo finché non ti è familiare.
- `references/zaistory.schema.json` — il contratto. Consultalo quando un errore
  di validazione non è chiaro dal solo messaggio.
- `references/mini.zaistory.json` — una storia minima che esercita ogni
  costrutto. Il modo più rapido di vedere come si incastrano.
