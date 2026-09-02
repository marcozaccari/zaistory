# ZAiStory Engine — decisioni architetturali

> Documento di analisi, non di implementazione: raccoglie le scelte
> architetturali prese finora e il *perché* di ciascuna, così chi riprende
> il progetto (persona o agente) può ripartire da qui senza riscoprire le
> stesse cose. Le decisioni qui sotto sono già prese e motivate: vanno
> rimesse in discussione solo se emerge un caso concreto che non coprono
> bene — è così che è nato `scene_type`, testando su materiale reale invece
> che discutendo in astratto. Regole operative per gli agenti: `AGENTS.md`. Oggi il lavoro attivo è su due fronti:
> la skill `skills/story-ir-compiler`, che applica queste regole direttamente
> in conversazione, e il player `player/`, che è **il** player del progetto —
> quello con cui si collauda una storia e quello con cui la si gioca. In futuro
> le stesse regole del compilatore verranno implementate in un generatore
> dedicato (non ancora iniziato, nessuna scelta di linguaggio/stack presa).

## Obiettivo

Motore narrativo interattivo moderno (tipo SCUMM, ma leggero): l'autore
scrive sceneggiature in markdown libero (formato ottimizzato per la
creatività, non per la macchina). Un compilatore le trasforma in un formato
IR (`story.ir.json`) giocabile e player-agnostic, che poi alimenta un modulo
di generazione asset (immagini/voce/musica) e infine il player (`player/`) —
nessuno di questi componenti deve essere accoppiato agli altri: l'IR è il
contratto che li tiene separati.

**Il player è quello, ed è definitivo.** Non è un banco di prova in attesa di
un prodotto vero: la stessa build si apre da `file://`, si manda in chat, si
mette su qualunque static host, e serve tutti e tre i suoi pubblici — chi
sviluppa il motore, chi collauda una storia, chi la gioca e basta. La
differenza fra loro non è un'applicazione diversa ma **un interruttore**: il
debug accende la diagnostica, e spento non ce n'è traccia. Tenerne uno solo è
anche ciò che garantisce che quello che il tester prova sia esattamente quello
che il giocatore riceverà.

## Pipeline concettuale

```
sceneggiatura.md (libera)
    │
    ▼  COMPILATORE (oggi: skill in conversazione; domani: generatore ad hoc)
story.ir.json (formato IR, contratto stabile — engine-ir.schema.json)
    │
    ├─▶  PLAYER (`player/`) — web (telefono/desktop) + CLI, stesso core
    │      testo sempre; immagini se la storia ne ha già di pubblicate
    │
    ▼  MODULO ASSETS — immagini costruito (`assets-studio/images/`), voce no
assets_manifest.json → generazione → studio (si guarda, si rifà, si approva)
    │
    ▼  PUBBLICAZIONE (`publish.py`)
stories/<id>/assets/images/*.webp  +  il campo `image` scritto nell'IR
    │
    └─▶  lo stesso PLAYER, che adesso ha le immagini da mostrare
```

Una storia vive in **una cartella** (`stories/<id>/`), con dentro l'IR, la
sceneggiatura, i playthrough, gli asset pubblicati e il banco di lavoro del
generatore. La struttura e il perché stanno in `stories/README.md`; le
decisioni che l'hanno determinata sono più sotto, in «Il filesystem di una
storia».

## Il formato IR: decisioni chiave

Schema: `engine-ir.schema.json` (JSON Schema draft 2020-12), versione
corrente **1.10.0**. Non importa che sia retrocompatibile fintanto che siamo in fase di prototipo.

La 1.10.0 aggiunge la **copertina**: `cover`, la locandina che rappresenta la
storia prima che cominci — la copertina di un gioco, il manifesto di un film.
Tre decisioni dentro un campo solo:

- **È un `Background`, non un tipo nuovo.** Un'inquadratura è un'inquadratura a
  qualunque scala: cosa si vede, in che luogo, con chi dentro. `Scene.background`
  e `Story.cover` puntano quindi alla stessa definizione, e con lei si portano
  dietro `place` e `characters_in_frame` — cioè gli stessi riferimenti su cui la
  generazione aggancia volti e ambiente, senza una seconda strada da tenere
  allineata. Due gemelle divergono al primo campo aggiunto; una definizione no.
- **Non è l'inquadratura della prima scena.** Quella dice *dove si comincia*,
  la copertina dice *di cosa parla la storia*: il protagonista, il luogo che la
  storia ha in testa, la cosa che le sta di fronte. Sono due domande diverse, e
  la seconda non ha nessun altro campo dell'IR che sappia rispondere.
- **Opzionale nello schema, obbligatoria per il linter.** Stessa forma dei campi
  della 1.8.0, e per la stessa ragione: lo schema resta permissivo perché è il
  contratto, il linter è severo perché è il collaudo. Una storia senza locandina
  si apre su una pagina di solo testo.

  Lo stesso vale per i limiti pratici, che stanno nelle istruzioni di Stadio A e
  non nello schema: al massimo quattro riferimenti in tutto (il luogo conta),
  perché oltre quella soglia i modelli mediano fra i soggetti invece di tenerli
  distinti; e niente testo dentro l'immagine, perché il titolo lo scrive il
  player e uno generato esce storto e in una lingua a caso.

La 1.9.0 aveva aggiunto una cosa sola: il campo opzionale **`image`** su ogni nodo
che ha un prompt di immagine — personaggi, luoghi, oggetti, override di scena,
`background` e i beat di `narration[]`. Porta l'**id** dell'immagine già
prodotta e approvata, mai un percorso e mai il nome di un generatore, e **non
lo scrive il compilatore**: lo scrive la pubblicazione del modulo assets. Le
ragioni stanno in «Gli id delle immagini nell'IR», più sotto.

Decisioni di design, con il *perché* (per non riscoprirle da capo):

- **Niente modello verbo×oggetto stile SCUMM classico.** Deciso
  esplicitamente: interazione = dialoghi a scelte multiple + **azioni
  contestuali** (poche, 3-6 per scena, esplicite, specifiche alla scena,
  mai generiche tipo "guarda"/"usa X su Y"). Ogni scena `interactive` deve
  sempre avere un modo di proseguire/uscire — una scena senza uscita è un
  bug di game design, non solo tecnico.
- **Un blocco `Effect` riusabile**, condiviso concettualmente tra azioni e
  scelte di dialogo: stesso "motore" di applicazione dello stato in
  qualunque player, non due logiche parallele.
- **`scene_type: "interactive" | "cutscene"`** Le sequenze di puro montaggio narrato 
  (voce fuori campo su
  più inquadrature, zero scelte reali per il giocatore) sono cutscene con
  `narration[]` multi-beat e una sola azione "continua"; non vanno forzate
  nel modello "stanza con azioni". Un "SEQUENZA"/capitolo della
  sceneggiatura originale NON è automaticamente una scena del gioco:
  la segmentazione va fatta in base alla giocabilità (dove comincia
  davvero l'interattività), non alla struttura editoriale del documento
  sorgente.
- **`narration[].image_prompt` / `.sound_effect_prompt` per-beat** (stessa
  origine): una sequenza narrata può cambiare inquadratura più volte —
  un'unica immagine di sfondo per scena non basta per un montaggio
  cinematografico con più "fotografie" diverse.
- **Chi parla sta nella roster globale, sempre** — anche una voce fuori campo
  con una sola battuta. Regola cambiata rispetto alla prima stesura, che
  lasciava i personaggi occasionali fuori dalla roster e li definiva solo
  localmente alla scena. Il motivo del cambio è il modulo assets: la voce si
  assegna **una volta per parlante** (vedi più sotto), e un parlante che
  esiste solo come stringa in `speaker` non ha niente a cui agganciare quella
  assegnazione — resta senza timbro, o ne prende uno diverso a ogni battuta.
  La roster è l'elenco dei parlanti, non l'elenco dei personaggi importanti.
  Le scene continuano a poter fare override locali di `visual_prompt`/`voice`:
  quello che non possono più fare è essere l'unico posto dove un parlante
  esiste. Come prima, è un vincolo di *comportamento del compilatore*, non
  dello schema dati: lo schema permetteva già entrambe le cose, cambia la guida
  su come usarlo. A farlo rispettare è il linter, che segnala come errore ogni
  `speaker` fuori dalla roster.
- **Niente proprietà non previste, in nessun oggetto dell'IR** — vincolo
  architetturale forte: ogni oggetto dell'IR ammette solo i campi definiti,
  nessuno extra. Motivazione: rete di sicurezza contro derive/allucinazioni
  del compilatore (un LLM che inventa un campo plausibile ma non previsto
  va scartato e corretto, non silenziosamente accettato). Qualunque
  implementazione futura (skill, generatore ad hoc) deve applicare questo
  controllo prima di considerare valido un output.
- **L'IR non nomina mai un generatore.** `VoiceSpec` non ha piu' `engine`
  ne' `voice_id`: resta solo `style_prompt`, cioe' una descrizione testuale
  di *come suona* la voce. Stessa logica per immagini, effetti sonori e
  musica: il compilatore produce solo prompt e tag di mood, mai il nome del
  provider o i suoi parametri. La mappa `personaggio -> generatore`,
  `immagini -> generatore`, `colonna sonora -> generatore` (con i relativi
  parametri, incluso il voice_id concreto assegnato una volta per parlante)
  vive in un **file separato gestito dal modulo assets**. Motivazione:
  cambiare provider TTS o modello di immagini non deve toccare l'IR, che e'
  il contratto stabile tra compilatore e player.
- **La coerenza visiva si ottiene con ancore, non con il contesto** (1.3.0).
  I volti devono restare gli stessi lungo 59 immagini e i luoghi devono restare
  gli stessi fra un ritorno e l'altro. La strada sbagliata sarebbe generare
  l'immagine N avendo in contesto la N-1: renderebbe la generazione
  ordine-dipendente, non riproducibile, non parallelizzabile, e farebbe
  accumulare la deriva. La strada scelta e' la stessa gia' adottata per la voce:
  si fissa un riferimento **una volta per entita'**, poi ogni immagine si genera
  in modo indipendente condizionata su quei riferimenti.

  Perche' funzioni, l'IR deve dire *a quali entita'* un'inquadratura si
  riferisce, e da 1.3.0 lo dice:
  - **`places[]`** da un'identita' ai luoghi, come `characters[]` la da alle
    persone. Il `visual_prompt` di un `Place` descrive il posto; l'`image_prompt`
    di chi lo referenzia descrive l'inquadratura. Solo i luoghi in cui si torna:
    per un'ambientazione che compare una volta non c'e' niente da tenere
    coerente.
  - **`characters_in_frame`** su `background` e su ogni beat con immagine dice
    chi si **vede**. Non e' `Scene.characters`, che dice chi e' *presente*: una
    camera buia in cui parlano tre anziani ha tre presenti e nessuno inquadrato,
    e una voce oltre il muro e' presente e fuori campo. Condizionare su tutti i
    presenti peggiora l'immagine quanto non condizionare affatto.

  Nota sulle chiavi, che e' dove si sbaglia facilmente: le **ancore** si
  indicizzano per *identita'* (`nunez`), le singole generazioni per *contenuto*.
  Se leghi il ritratto all'hash del suo `visual_prompt`, una ricompilazione che
  ne cambia due parole cambia la faccia in tutta la storia.

  Il linter fa rispettare tutto questo: `place` e `characters_in_frame` verso id
  inesistenti sono errori, e un prompt che nomina un personaggio presente senza
  dichiararlo inquadrato e' un avviso.
- **`generated_by`: la provenienza sta nell'IR, il binding no** (1.4.0). Il
  file dichiara quale compilatore lo ha prodotto, in che versione e con quale
  modello. Il motivo e' pratico: il compilatore non e' deterministico fra
  sessioni, quindi riaprendo un IR mesi dopo — o confrontandone due della
  stessa sceneggiatura — la prima domanda e' *con cosa e' stato fatto*, e senza
  firma non c'e' modo di rispondere.

  Sembra contraddire la regola qui sopra, e va detto perche' non la contraddice:
  li' si parla del binding ai generatori di **asset**, che deve stare fuori
  dall'IR perche' cambiare provider TTS non deve toccare il contratto. Qui si
  parla della **firma di chi ha scritto il documento**. La differenza operativa
  e' netta: nessun consumatore puo' cambiare comportamento leggendo
  `generated_by` — il player lo mostra e nient'altro. Se un giorno qualcosa
  ramificasse su quel campo, sarebbe quella la violazione, non il campo.

  Corollario, scritto nelle istruzioni del compilatore: `model` va **omesso**
  quando non e' determinabile con certezza. Una provenienza inventata e' peggio
  di una assente, perche' fa cercare differenze dove non ce ne sono.
- **`initial_inventory`: quello che il personaggio ha gia' addosso** (1.5.0).
  Una storia puo' cominciare con qualcosa gia' nello zaino — in "Metal Head" un
  walkie talkie scarico che servira' solo nell'ultima scena, e per tre atti sta
  li' senza fare niente. Prima di 1.5.0 l'unico modo di darlo al giocatore era
  un `add_inventory` dentro l'effetto di un'azione della prima scena: un dato di
  partenza travestito da evento, che il linter non poteva distinguere da un
  oggetto raccolto e che spariva se quella scena veniva ricompilata diversamente.
  Il campo e' un elenco di id, sta accanto a `inventory_schema` (che resta
  l'elenco documentale di *tutti* gli oggetti possibili) e il player lo applica
  allo stato iniziale prima di entrare in `start_scene`.

- **Il contratto e' scritto per un player che si comanda a parole** (1.6.0).
  Le chip erano il banco di prova, non l'interfaccia: quella decisa e' il
  resolver — testo libero in, id di un'azione gia' esistente out, e oggi le
  chip restano solo sotto il debug.
  Provando "Metal Head" con le chip e' emerso che l'IR reggeva il *matching* ma
  non il *parlare*: quattro campi mancavano, e mancavano tutti dalla stessa
  parte, quella del giocatore che scrive invece di scegliere.

  - **`items[]` sostituisce `inventory_schema`.** Era un elenco di id nudi. A
    "cosa ho nello zaino" un id non e' una risposta, e "usa il coltellino" non
    ha niente a cui agganciarsi. Ora gli oggetti hanno l'anagrafica che avevano
    gia' persone e luoghi: `id`, `name`, `aliases`, `description`. E' lo stesso
    errore corretto due volte prima — i parlanti fuori dalla roster, i luoghi
    senza `Place` — e la stessa correzione: **una sola lista, per identita'**.
    Due elenchi paralleli degli stessi id sono una fabbrica di derive, quindi
    l'anagrafica non si affianca al vecchio campo, lo rimpiazza.
  - **`DialogueChoice.aliases`.** `Action` aveva gli alias dal primo giorno, le
    scelte di dialogo no: dentro una conversazione l'unico appiglio era il testo
    letterale della battuta, e una battuta non e' come la si chiede. Con questa
    asimmetria, parlare a parole restava piu' difficile che agire a parole.
  - **`Action.blocked_narration`.** In un menu, un'azione filtrata da una
    `Condition` semplicemente non compare — e la sua *scomparsa* e'
    informazione. A input libero il giocatore la chiede lo stesso, e merita una
    risposta scritta dall'autore ("la cordicella penzola a tre metri") invece
    del non-ho-capito generico. Non e' un effetto: nessun cambio di stato,
    nessuna transizione. Il resolver che sceglie un'azione bloccata non ha
    applicato niente, e il vincolo "il resolver non genera logica" regge.
  - **`Scene.look`.** "Dove mi trovo" e "guardati intorno" sono le domande piu'
    frequenti di un'avventura testuale e non avevano risposta: `narration[]` si
    legge una volta entrando e `background.image_prompt` e' un prompt di
    generazione, non prosa per il giocatore. `look` e' la stanza com'e' adesso,
    rileggibile. Sta fuori da `actions[]` di proposito: e' un **verbo del
    player**, come l'inventario, e non deve consumare il budget di azioni della
    scena ne' comparire come suggerimento.

  Corollario di compilazione, che vale piu' di tutti e quattro i campi: **niente
  si scopre da una `label`.** Con le chip visibili, l'etichetta e' meta' della
  scoperta; spente le chip, un oggetto nominato solo li' e' invisibile. Tutto
  cio' che il giocatore deve trovare va nominato nel testo che legge —
  `narration`, `look`, l'esito di un'altra azione. La difficolta' deve venire da
  cosa il testo dice e non dice, mai da un menu che si accorcia.

- **Si agisce a parole, si parla a scelte** (1.7.0). L'input libero vale per
  osservazioni e azioni — «guardati intorno», «prendi il coltello», «usa il
  cavo sulla presa», «parla con Mark» — e **non entra mai in un dialogo**: una
  conversazione si gioca a scelte esplicite, come nelle avventure grafiche
  classiche. Non e' una limitazione tecnica, e' una scelta di gioco: nel
  parlato l'elenco delle battute *e'* il piacere, e far indovinare al giocatore
  la formula giusta per dire una cosa che il suo personaggio saprebbe dire e'
  frustrazione senza guadagno.

  La conseguenza sullo schema e' che **`DialogueChoice.aliases`, aggiunto in
  1.6.0, e' rimosso in 1.7.0**: nessun consumatore lo leggerebbe piu', e un
  campo che nessuno produce ne' consuma e' peggio di un campo assente — invita
  il compilatore a riempirlo. Al suo posto arriva **`Character.aliases`**, che
  serve al confine fra i due mondi: *entrare* in un dialogo e' un'azione come
  le altre e passa dal resolver, quindi «parla con il ragazzo» deve poter
  arrivare a `tommy`. Dentro il dialogo, da li' in poi, si tocca e basta.

  La conseguenza sulla compilazione e' piu' importante del campo: **il dialogo
  e' l'unico posto dove l'elenco si vede**. Le azioni di scena non si vedono
  piu' — si scrivono — mentre le battute disponibili sono tutte in chiaro.
  Quindi nel dialogo non si nasconde niente che il giocatore debba scoprire da
  solo: gli enigmi stanno nelle azioni e nel testo, il parlato serve a
  caratterizzare, informare e scegliere, non a fare da rompicapo.

- **La prosa che il giocatore legge si scrive in compilazione, non a runtime**
  (1.8.0). E' la decisione piu' importante presa finora sul resolver, e non
  riguarda il resolver: riguarda dove sta l'intelligenza.

  Il punto di partenza e' che il resolver **non genera testo**: sceglie un id
  fra cinque o quindici candidate note in anticipo. E' ranking su insieme
  chiuso, non generazione, ed e' la classe di problemi dove un modello
  generativo e' lo strumento piu' costoso e meno affidabile disponibile. Da qui
  discendono due mosse simmetriche, e sono la stessa mossa:

  - **La comprensione si precalcola.** Gli `aliases` che il compilatore scrive
    per ogni azione *sono* la conoscenza semantica di quell'azione, congelata
    dentro l'IR. Un matcher lessicale che li confronta con la frase del
    giocatore sta facendo semantica: la fa per lookup invece che per geometria,
    ma il lavoro del modello l'ha gia' fatto il compilatore. Perche' funzioni
    gli alias devono essere *molti* — quindici-venticinque per azione, non tre:
    la lista e' la copertura.
  - **La prosa si prescrive.** Un player a parole deve rispondere anche quando
    non capisce, e deve rispondere in tono. La risposta d'autore c'era gia' per
    un caso — `blocked_narration` in 1.6.0 — e in 1.8.0 diventa la regola:
    `Scene.no_match_narration` (fallback categorizzati per intenzione),
    `Scene.look_variants` (la stanza com'e' *adesso*), `Story.player_voice`
    (inventario e fallback globali).

  **Perche' non generare a runtime**, che sarebbe la strada ovvia: due motivi,
  e il secondo pesa piu' del primo.

  1. Sotto il miliardo di parametri l'italiano con un tono e' fuori portata: si
     scambia ripetizione curata con novita' mediocre, che e' uno scambio in
     perdita. Sopra, servono rete e costo per battuta.
  2. **Un testo generato inventa scenario che nel gioco non esiste.** Un `look`
     che nomina una lampada assente non e' colore, e' un falso indizio su cui il
     giocatore perde dieci minuti — in un'avventura a enigmi lo scenario
     inventato e' attivamente distruttivo. E soprattutto: il testo scritto in
     compilazione **e' controllabile da un linter**, quello generato a runtime
     non lo e' da nessuno. Il compile-time e' l'unico posto dove un modello puo'
     produrre prosa che qualcuno puo' ancora verificare.

  La varieta' non si perde: viene dalla combinatoria su testo d'autore. Sei
  intenzioni (`percezione`, `manipolazione`, `movimento`, `sociale`, `forza`,
  `generico`) per scena, piu' d'una frase per intenzione, scelte a rotazione.
  Il giocatore non distingue questo da un modello — distingue solo quando la
  risposta e' fuori bersaglio o quando il ciclo e' corto.

  **Le intenzioni sono indipendenti dalla storia** ed e' il motivo per cui la
  tabella dei verbi che le riconosce sta nel player e non nell'IR: le stesse
  sei famiglie valgono per ogni storia, e il vocabolario che le distingue e'
  italiano, non narrativa.

  Corollario, gemello di quello di 1.6.0: **il resolver non genera nemmeno il
  testo del fallback**, lo sceglie fra quelli scritti. Se per un'intenzione non
  c'e' niente e non c'e' nemmeno un `generico`, il player **non inventa una
  frase**: tace e lo segnala come diagnostica. Un buco nell'IR deve vedersi
  come un buco.

- **Niente retrocompatibilita': quello che manca e' un errore, non un avviso**
  (1.8.0). I campi di 1.8.0 sono opzionali nello schema — il JSON Schema non
  sa distinguere una scena interattiva da una cutscene senza contorsioni — ma
  **il linter li tratta come obbligatori**, ed e' li' che il progetto ha sempre
  messo la differenza fra *ben formato* e *giocabile*. Sono errori, non avvisi:
  storia senza `player_voice`, scena interattiva senza `look`, scena senza
  nessun fallback raggiungibile, azione senza `aliases`.

  La conseguenza e' voluta: un IR compilato prima di 1.8.0 non passa il linter.
  Non e' un incidente da tamponare con dei ripieghi nel player — e' la ragione
  per cui i due esempi del repository sono stati ricompilati invece che
  tollerati. Un solo schema copre tutto, e il player non contiene una riga il
  cui unico scopo sia far girare qualcosa che non lo rispetta.

  C'e' un solo controllo che nasce da questa scelta e che non era prevedibile:
  **un alias non puo' ricalcare un verbo del player**. Siccome il resolver gira
  prima dei verbi, un'azione con l'alias «guardati intorno» si prende la
  domanda e la scena smette di rispondere al `look`. E' un errore, e su tre IR
  scritti a mano ne ha trovati quattro.

- **`Action.test_phrases`: l'IR porta con se' il proprio banco di prova**
  (1.8.0). Parafrasi che *dovrebbero* risolvere a quell'azione, tenute
  deliberatamente **fuori** dagli `aliases`. Nessun player le legge: le legge
  il linter, che le passa al resolver e conta quante arrivano all'id giusto.

  Serve a togliere dal fiuto una domanda che altrimenti resta un'opinione:
  «vale la pena scaricare un modello per questa storia?». Con le frasi di prova
  la si lancia sui due backend e si guarda il delta, e soprattutto l'elenco
  delle frasi che solo il piu' costoso prende. E' anche il motivo per cui vanno
  scritte *lontane* dagli alias: copiarle di li' misura il lookup, non il
  richiamo, e il linter lo segnala come avviso.

- **Riferimenti a scene esterne** (una scena come file separato, per storie
  molto grandi) sono previsti concettualmente ma non ancora affrontati nel
  dettaglio — oggi si lavora solo con IR a scene inline in un unico
  documento. Da riprendere se/quando servirà davvero (storie molto lunghe).
- **Resolver per input testuale libero**: costruito in 1.8.0
  (`player/src/core/`). Un modulo player-agnostic che riceve `(azioni
  disponibili nella scena, testo libero del giocatore, tono della scena)` e
  ritorna `(id di un'azione esistente, oppure nessun match con una narrazione
  di fallback in-character)`. **Il suo perimetro sono le azioni di scena, mai
  le scelte di dialogo**: quando un `dialogue_tree` e' aperto il player mostra
  un elenco e il resolver non viene nemmeno interpellato.

  Due vincoli, e sono la ragione per cui lo stato di gioco resta
  deterministico e testabile:

  1. **Non genera mai un effetto** di sua iniziativa, sceglie solo quale azione
     gia' definita eseguire.
  2. **Non genera mai nemmeno il testo** del fallback: lo sceglie fra quelli
     che l'autore ha scritto (vedi 1.8.0, la prosa prescritta).

  E' l'equivalente moderno del "Non puoi farlo" dei punta-e-clicca: scelto al
  volo e coerente col tono della scena, ma scritto da una persona.

  **Le azioni bloccate entrano fra le candidate**, ed e' la differenza fra un
  menu e una conversazione. In un menu un'azione filtrata da una `Condition`
  sparisce e non c'e' niente da dire; a parole il giocatore la chiede lo
  stesso, e riceve la `blocked_narration` d'autore. Il player non applica
  niente — nessun flag, nessuna transizione, nessun oggetto — e l'engine non
  sa nemmeno che e' successo qualcosa.

  **I verbi del player** si consultano **dopo** il resolver, mai prima:
  un'azione scritta dall'autore vince sempre su un verbo di sistema, cosi' una
  scena che ha davvero un'azione «fruga nello zaino» non se la vede scippare.
  Non consumano un turno e non entrano nella traccia. Sono quattro, e sono le
  quattro domande che in un'avventura a parole si scrivono piu' di qualunque
  altra cosa:

  | verbo | risposta d'autore |
  |---|---|
  | «guardati intorno», «dove sono» | `Scene.look` (+ `look_variants`) |
  | «cosa ho nello zaino», «inventario» | `player_voice.inventory_*` + i `name` degli oggetti |
  | «chi c'e' qui», «quali sono i personaggi» | `player_voice.presence_*` + i nomi di `Scene.characters` |
  | «guarda il walkie» | `items[].description` (+ `description_variants`) |

  Gli ultimi due nascono dalla stessa osservazione dei primi due: sono domande
  che il giocatore fa continuamente e che **non passano da nessuna azione**,
  quindi senza un posto dove metterle o restano senza risposta, o l'autore le
  duplica come azioni e si mangia il budget della scena.

  Due dettagli che sembrano minori e non lo sono:

  - **`Story.protagonist`** (1.8.0). Il personaggio giocante sta in
    `characters` come tutti — ha un aspetto e una voce — ma a «chi c'e' qui»
    non va elencato: e' chi sta chiedendo. Senza il campo, il player risponde
    «in questa stanza ci sono: Laura, Mark e Tommy» a Laura.
  - **Guardare un oggetto e' il piu' specifico dei quattro**, quindi si prova
    per primo, e vale solo per gli oggetti **in inventario**: guardare una cosa
    che non si ha e' materia della scena. Serve anche un verbo di percezione,
    altrimenti «prendi il coltello» finirebbe qui invece che nell'azione.
    E la descrizione deve poter cambiare con lo stato (`description_variants`):
    un walkie messo in carica non e' piu' l'oggetto scarico di prima, e
    rileggere la vecchia descrizione e' una bugia che il giocatore incassa ogni
    volta che guarda.

### Due controlli che nascono da una regola sola

Il linter ha due avvisi che sembrano dettagli e sono la stessa cosa detta due
volte: **una scena non deve poter restare muta**.

- `blocked_narration` mancante su un'azione condizionata. La deroga che c'era
  nello Stadio B — «su una condizione che nessuno incontrerà mai al contrario,
  si può omettere» — è stata tolta: era stata presa **43 volte su 81** in un IR
  solo, e la previsione su cui si appoggiava («questa nessuno la chiederà
  presto») è proprio quella che un compilatore non può fare, perché chi gioca a
  parole prova le cose nell'ordine che gli viene in mente.
- `look_variants` mancanti per un flag che, **in quella stessa scena**, apre o
  chiude un'azione. Se un flag cambia cosa si può fare qui, per definizione
  qualcosa qui è cambiato, e il `look` è l'unico posto in cui il giocatore può
  accorgersene. Il caso che ha fatto scrivere il controllo: una fuga fra gli
  scaffali dove notare un carrello chiudeva «corri» e apriva «rovescia il
  carrello», con zero varianti e il carrello mai nominato da nessuna parte. Il
  giocatore aveva in mano tutto tranne la parola. Non una scena difficile: una
  scena muta.

Si guardano solo i flag prodotti dalla scena stessa — uno impostato altrove
descrive qualcosa che qui non è successo. Su "Nel paese dei ciechi" il
controllo tace del tutto, il che è il modo in cui si è verificato che non sia
rumore.

### Un punto cieco noto del linter

Rendere **facoltativa** la presa di un oggetto che venti scene più avanti è
richiesto dall'**unica** uscita di una scena apre un vicolo cieco che il linter
non vede: staticamente l'oggetto esiste, l'azione che lo dà esiste, la
condizione è soddisfacibile. È successo modificando "Metal Head" — le caramelle
si prendevano da sole, e separare il gesto dalla scoperta avrebbe permesso di
lasciare la bottega senza il pacchetto che è la sola soluzione della notte sul
ramo. Il rimedio adottato lì è quello generale: **la porta che chiude la scena
chiede l'oggetto** (`has_item`) invece del flag della scoperta, così la scelta
di prenderlo resta al giocatore e la possibilità di finire la storia resta
garantita. Chi tocca un IR esistente per dare più agency deve guardare a valle:
la domanda è sempre «da qui, senza questo, si arriva ancora alla fine?».

## Regole di game design che il compilatore applica

Non sono vincoli di schema — l'IR permetterebbe benissimo di scriverne di
opposte — ma sono il *modo* in cui questo progetto usa lo schema, ed e' il
compilatore a doverle far rispettere. Sono emerse compilando "Metal Head":
uno script di sopravvivenza pieno di urgenza recitata, cioe' esattamente il
materiale che spinge a costruire timer e game over.

- **Non si perde mai** (stile LucasArts). Niente morti, niente game over,
  niente vicoli ciechi, niente partita da ricominciare. Qualunque cosa faccia
  il giocatore e in qualunque ordine la faccia, si arriva sempre allo stesso
  finale. Cio' che cambia non e' *se* ci arriva: e' **quanto gli costa**.
- **Il costo dell'errore e' camminare all'indietro.** L'unica valuta della
  punizione sono i passi: il giocatore viene rimesso in una scena gia' vista e
  deve rifare la strada. Nessuna barra della minaccia, nessun avversario di cui
  tracciare la posizione, nessuna variabile che dice dove si trova il pericolo:
  la minaccia e' una **pressione**, cioe' un `goto_scene` all'indietro e un
  fondo sonoro, non un'entita' simulata.
- **Le risorse non si contano.** Munizioni, torce, batterie: trovarle e' un
  evento, amministrarle non e' un gioco. Un oggetto sta in inventario e da'
  accesso ad azioni; non ha una quantita' che scende, e nessuna azione fallisce
  perche' e' finito qualcosa.
- **Il tempo non esiste.** Nessun timer, da nessuna parte, mai: nessuna azione
  scade, nessuna scena si chiude da sola, nessuna finestra si apre e si
  richiude, nessuna occasione va persa perche' il giocatore ha esitato. Si
  puo' restare fermi in una stanza per un'ora e non succede niente. Dove la
  sceneggiatura ha urgenza, quell'urgenza e' **recitata**: sta nel testo, nel
  suono e nelle immagini, non nella logica. Il giocatore deve sentire il
  panico, non subirlo.

  Corollario tecnico, ed e' quello che rende la regola verificabile: l'IR non
  ha nessun costrutto temporale — nessun campo di durata, nessun effetto
  ritardato, nessuna transizione automatica — e non deve acquisirne. Una scena
  cambia solo perche' il giocatore ha scelto qualcosa. Se un giorno servisse un
  timer, sarebbe una decisione da prendere qui, non un campo da aggiungere di
  passaggio.
- **Gli appunti di giocabilita' dell'autore sono specifica, non prosa.** Le
  sceneggiature di questo progetto possono contenere blocchi marcati
  (`#### Giocabilita'`, o una sezione globale `## Note di giocabilita'`): sono
  istruzioni per il compilatore — condizioni di sblocco, azioni previste,
  errori attesi, cosa non dire mai al giocatore — e non vanno mai riversati
  nel testo che il giocatore legge.

  Hanno la precedenza sulle regole di forma del compilatore, e il caso
  concreto e' il limite di 3-6 azioni per scena: quel limite protegge dalle
  scene-elenco che nascono quando e' il compilatore a inventare, e non ha
  nessun titolo per correggere un autore che ha gia' deciso quante cose ci
  sono in una stanza. Se l'appunto ne elenca nove, sono nove.
- **Il compilatore chiede prima di partire.** Due decisioni non si possono
  dedurre dal testo: quanto inventare (enigmi, azioni, oggetti, flag) rispetto
  agli appunti gia' scritti, e quanto rielaborare i dialoghi rispetto alle
  battute gia' esistenti. Sono scelte dell'autore, e indovinarle sbagliate si
  paga con una ricompilazione intera.

## Il compilatore: dove si trova oggi il lavoro

**Skill `skills/story-ir-compiler`** (unica implementazione attiva): applica le
stesse regole sopra elencate direttamente in conversazione — Stadio A
(estrazione di una "story map" con id stabili, personaggi, stile, elenco
scene) seguito da Stadio B (compilazione di dettaglio di ogni scena),
con un passo di validazione e correzione prima di consegnare il risultato.

Limiti onesti da tenere a mente lavorando sulla skill:
- **Nessuna cache tra conversazioni diverse**: ogni sessione ricompila da
  zero, non esiste un meccanismo per saltare le scene invariate.
- **Non perfettamente deterministica tra sessioni diverse**: id e dettagli
  minori possono variare da una compilazione all'altra. Se esiste già un
  `story.ir.json` e serve solo un aggiornamento, meglio editarlo in place
  (mantenendo gli id esistenti) che ricompilare tutto da capo.

**Generatore ad hoc (futuro, non iniziato)**: l'idea è che le stesse regole
documentate qui verranno implementate come codice deterministico, per
ottenere ripetibilità/velocità/automazione che la skill non può dare in
conversazione. Nessuna scelta di linguaggio, struttura o stack è stata
ancora presa — è deliberatamente rimandata: prima si stabilizzano le
regole (iterando via skill su sceneggiature reali), poi si cristallizzano
in un generatore.

## Modulo assets: immagini costruite, voce e suoni ancora solo decisi

### Decisioni che valgono per tutto il modulo

- **Estrazione come passo concettualmente separato dalla generazione**:
  prima si attraversa l'intero IR raccogliendo ogni risorsa da produrre, POI si
  chiamano i provider esterni. Attenzione a non sopravvalutare la deduplica per
  contenuto identico: misurata sull'IR di riferimento non risparmia niente (59
  immagini, 59 distinte; 30 suoni, 30 distinti). Il motivo vero per separare i
  due passi e' un altro — l'estrazione risolve le **ancore** (ritratti di
  riferimento, timbri, luoghi) di cui la generazione ha bisogno, e permette di
  generare ogni risorsa in modo indipendente, riprendibile e cacheabile.
- **Le risorse non sono solo prompt.** Il grosso del lavoro sono le battute da
  sintetizzare — 111 sull'IR di riferimento, ~24 minuti di audio, l'82% del
  narratore — e il loro testo sta in `DialogueNode.text`, `narration[].text` e
  `Effect.narration`, che prompt non sono. Un manifesto "lista dei prompt"
  lascerebbe fuori la parte piu' costosa.
- **Due livelli, non uno — per la voce come per le immagini**: (1)
  *assegnazione* — una volta per entita' nell'intera storia, uno stile testuale
  diventa un timbro/voice_id stabile e un `visual_prompt` diventa un ritratto o
  una veduta di riferimento; (2) *generazione* — per ogni battuta o
  inquadratura, quell'ancora più il contenuto producono l'asset. Motivazione: un personaggio deve suonare sempre uguale
  lungo tutta la storia — se si risolve lo stile riga per riga invece che
  una volta per personaggio, provider come ElevenLabs possono restituire
  timbri leggermente diversi ad ogni chiamata anche con lo stesso stile
  testuale. Attenzione al caso limite: una battuta con un override vocale
  che specifica solo uno stile testuale (senza un id voce esplicito) deve
  comunque passare dal livello di assegnazione, non bypassarlo — altrimenti
  resta irrisolvibile.
- **Musica di sottofondo = corrispondenza a tag contro una libreria locale
  curata, NON generazione via API**: la generazione musicale è stata
  giudicata ancora troppo acerba rispetto a immagini/voce per essere
  affidabile in una pipeline automatica.
- **Pubblicazione/hosting degli asset**: deciso esplicitamente di rimandare
  questa scelta ("solo locale per ora, penseremo al deploy dopo") — un
  player mobile reale avrà comunque bisogno che gli asset siano raggiungibili
  via URL pubblico (storage/CDN), ma quale servizio usare non è stato deciso.

### Tema scuro e basta

Player e studio hanno **una palette sola**, scura, e non seguono piu' il tema
di sistema. Non e' una preferenza di stile: da quando ci sono le immagini, il
fondo non e' piu' solo lo sfondo del testo — un bianco intorno a
un'inquadratura cel-shaded ne cambia la lettura, ed e' la ragione per cui i
visori di foto sono tutti scuri. Tenere due temi significava provarli
entrambi a ogni modifica per un guadagno che nessuno aveva chiesto; ne
teniamo uno, quello giusto per guardare.

### Una cartella per tipo di asset

`assets-studio/` raccoglie gli strumenti, e dentro c'e' una cartella per
**tipo di asset**: `images/` oggi, `voice/` e `sound/` quando esisteranno. Non
per fornitore, e non tutto in un modulo solo: le tre catene si somigliano da
lontano e non nel punto che conta, cioe' come si decide se un asset e' buono —
un'immagine si guarda una alla volta, una battuta si ascolta nel suo contesto,
un ambiente sonoro si giudica solo insieme all'immagine. Manifest, studio e
criterio di approvazione saranno diversi; identico restera' il contratto ai due
capi: prompt letti da `story.ir.json`, lavoro in `stories/<id>/_work/`, asset
pubblicati in `stories/<id>/assets/` con l'id scritto nell'IR.

### Immagini: costruito (`assets-studio/images/`)

Quattro strumenti — estrazione del manifest, generazione da riga di comando,
studio web locale per guardare e rifare, prototipazione per decidere. L'uso
sta nel loro `README.md`; qui restano solo le decisioni e il perché.

- **Provider: Pollinations.** La raccomandazione precedente (fal.ai o
  Replicate su Flux) è decaduta prima di essere provata, e anche il prototipo
  su Kaggle — Z-Image girato in locale sulla GPU gratuita — è stato
  abbandonato: lì il livello che porta il rischio vero, quello con immagini di
  riferimento, non era nemmeno provabile. Un catalogo unico dietro una sola
  chiave e un solo formato di richiesta ha permesso di confrontare **21
  modelli sullo stesso identico prompt**, ed è quel confronto ad aver deciso
  tutto il resto.
- **Il condizionamento su immagini di riferimento è un requisito, non
  un'ottimizzazione.** Misurato: a parità di prompt e di seed, un modello
  text-only restituisce una persona diversa a ogni chiamata. Nessun testo
  trasporta un'identità — "donna sulla quarantina, capelli scuri raccolti
  male" descrive un tipo, non una persona. È la giustificazione empirica dei
  due livelli descritti sopra, che erano stati decisi per ragioni di coerenza
  e si sono rivelati l'unica strada percorribile.
- **Il costo non è il vincolo che sembrava.** L'intera storia di riferimento,
  88 immagini con i modelli scelti, costa **2,61 $**. Ne discende una serie di
  cose che *non* vanno fatte: niente livelli di prezzo per numero di
  personaggi in campo, niente scelta automatica del modello per difficoltà
  stimata, nessuna deduplica furba. Qualunque ottimizzazione di costo vale
  meno della complessità che aggiunge; il denaro si spende per rigenerare
  quello che non convince.
- **La selezione è umana, e questo è un requisito di architettura.** Nessuna
  euristica sa quale immagine è venuta male: si guarda. Da qui il sidecar JSON
  accanto a ogni immagine (job id, modello, seed, prompt effettivo, reference
  con hash) — senza, non è ricostruibile a posteriori perché un'immagine sia
  venuta così — e da qui lo studio web, che è l'interfaccia che quel sidecar
  rende possibile: coda controllabile, storico delle versioni, conferma di
  spesa su ogni rigenerazione, scelta del modello per singola immagine.
- **Prompt in inglese, IR bilingue.** I modelli sono addestrati in inglese e
  un prompt italiano perde aderenza — misurato: uno style suffix in coda a un
  prompt italiano lungo può essere ignorato in blocco. L'IR porta quindi i
  campi `*_en` accanto a quelli italiani, che restano canonici perché sono
  quelli che il player mostra in modalità solo testo. **Questa è una decisione
  di formato, non di pipeline**: tocca lo schema e il compilatore, non il
  generatore.
- **Il taglio delle ancore è una decisione sull'intero cast**
  (`global_style.anchor_framing`), non sul singolo personaggio: un cast con
  ritagli disomogenei sembra venire da storie diverse. L'override per
  personaggio esiste ma è ammesso solo per i soggetti non umani.
- **Lo stile visivo lo detta la storia, ma il fotorealismo a basso costo non
  regge.** Su "Metal Head" si è passati da fotografia cinematografica in
  bianco e nero a **cel-shaded piatto a colori**, ed è stata la modifica che
  ha risolto più problemi di qualunque riscrittura di prompt: più coerente fra
  un'inquadratura e l'altra, meno riconoscibile come immagine generata, più
  vicino a un aspetto giocabile. La pixel art resta una **passata
  deterministica in post**, mai un'istruzione nel prompt — la diffusione non
  produce vera pixel art e il condizionamento su reference tende per di più a
  ripulirla.
- **La dimensione richiesta è un suggerimento, non un contratto**: diversi
  modelli restituiscono la misura che preferiscono. L'originale non ritagliato
  viene conservato, e il ritaglio è una scelta visiva presa dopo, che non
  costa una rigenerazione.

### Il filesystem di una storia

Deciso quando le immagini hanno smesso di essere un esperimento: una storia è
**una cartella**, `stories/<id>/`, e ci sta dentro tutto quello che la
riguarda — `story.ir.json`, la sceneggiatura, i playthrough, `assets/` con
quello che è stato pubblicato, `_work/` con il banco di lavoro del generatore.
La forma esatta è in `stories/README.md`; qui restano le tre decisioni.

- **Una storia si indica con una cosa sola.** Prima l'IR stava in `examples/`,
  la sceneggiatura accanto con un altro nome e le immagini in
  `assets/out/<altro-nome-ancora>/`: tre posti da tenere allineati a mano, e
  nessun modo di spostare, archiviare o mandare *una storia*. Il costo della
  vecchia disposizione non era estetico — era che il legame fra un IR e le sue
  immagini viveva solo nella testa di chi lanciava i comandi.
- **Il banco di lavoro sta dentro la storia, ma fuori da git** (`_work/`).
  Contiene per costruzione anche gli scarti: versioni precedenti, grezzi non
  ritagliati, miniature, sidecar. Sulla storia di riferimento sono 78 MB
  contro i 6,7 MB di quello che va pubblicato. Dentro la storia perché è di
  *quella* storia; fuori da git perché si rigenera e perché versionare i
  tentativi è il modo di rendere il repository ingiocabile da clonare.
- **`assets/images/<id>.<ext>` è una convenzione, non un indice.** Nessun file
  di mappatura fra id e percorso: il player compone il percorso dall'id. Un
  indice sarebbe un secondo contratto da tenere allineato al primo, e la prima
  volta che i due divergono si passa un pomeriggio a capire quale dei due
  mente.

### Gli id delle immagini nell'IR

L'IR porta l'id dell'immagine, in un campo `image` accanto al prompt che l'ha
prodotta. Le alternative scartate e il perché:

- **Un percorso nell'IR** (`assets/images/x.webp`) legherebbe il contratto alla
  disposizione dei file su disco, che è esattamente la cosa che si è appena
  finito di poter cambiare.
- **Un file di mappatura a lato**, lasciando l'IR intatto, sposta soltanto il
  problema: due file da tenere allineati, e un player che per mostrare
  un'immagine deve leggerne due.
- **Nessun id, e il player deduce il nome dalla scena**: ricostruirebbe a
  runtime la logica dell'estrattore — comprese le varianti d'ancora con
  l'hash dell'override — e sbaglierebbe al primo caso storto.

Conseguenze volute:

- **L'IR continua a non nominare nessun generatore.** Un id immagine è il nome
  di un file dentro la storia, non un modello, un provider o un job. Modello,
  seed, prompt effettivo e reference restano nei sidecar, in `_work/`.
- **`image` è la firma di un essere umano.** Il campo esiste solo dove
  qualcuno ha guardato l'immagine e l'ha marcata definitiva: è la selezione
  umana, resa persistente. Un IR appena compilato non ne ha nessuno.
- **L'id è lo stem del file**, cioè l'id del job reso sicuro per un
  filesystem (`anchor.char.laura@1a2b3c4d` → `anchor.char.laura_1a2b3c4d`). Se
  l'id dell'IR e il nome del file divergessero servirebbe di nuovo un indice.

### Pubblicazione (`publish.py`)

Il passo che porta le immagini dal banco di lavoro dentro la storia, e l'unico
di tutta la catena che tocchi `story.ir.json`.

- **Si pubblica solo ciò che è marcato definitivo.** Lo stato sta in
  `_work/_studio.json`, insieme all'**hash del file approvato**: rigenerare
  un'immagine dopo averla approvata fa decadere l'approvazione, e lo studio lo
  mostra come stato a sé (`!` invece di `✓`). Senza l'hash, un clic su
  «rigenera» manderebbe in pubblicazione un'immagine che nessuno ha guardato.
- **Idempotente per progetto.** `_work/_published.json` registra da quale file
  viene ogni immagine pubblicata: ripubblicare senza cambiamenti non riscrive
  niente e non tocca l'IR. Durante una revisione si pubblica dieci volte, e un
  diff di 336.000 righe a ogni giro renderebbe la revisione illeggibile.
- **Togliere un'approvazione toglie l'id dall'IR.** Il campo `image` non
  sopravvive alla decisione che l'ha messo lì, altrimenti il player andrebbe a
  cercare un file che non c'è più.
- **WebP, lato lungo 1024.** Gli originali restano in `_work/`. 88 immagini
  passano da ~52 MB di PNG a ~6,7 MB: è la differenza fra una storia
  scaricabile da telefono e una che non lo è. Il lossless qui non serve a
  niente — l'immagine è già il risultato di una diffusione e di un ritaglio.
- **Se il manifest non combacia più con l'IR, ci si ferma.** Il manifest
  fotografa gli indici dell'IR al momento dell'estrazione (`scenes[11]`): se da
  allora una scena è stata inserita, scriverci dentro un id significherebbe la
  faccia sbagliata nella scena sbagliata. La pubblicazione verifica id di scena
  ed entità e, se non tornano, chiede di rifare il manifest invece di scrivere.
- **Le varianti d'ancora ripetute vengono raggiunte tutte.** Un override di
  aspetto che dura — una ferita, un travestimento — si ripete identico in
  trenta scene e produce **una sola** ancora, il cui `source` è la prima
  occorrenza. La pubblicazione propaga quell'id a tutte le scene che
  dichiarano lo stesso override, altrimenti ventinove di loro resterebbero
  senza immagine pur avendone una già pronta e pagata.

### Voce, suoni ed effetti: ancora solo decisi

Nessun codice. **ElevenLabs** resta il provider suggerito in fase di analisi
per voce ed effetti sonori puntuali, non vincolante. Le decisioni che
riguardano la voce sono quelle generali qui sopra: due livelli, il testo che
non sta nei prompt, la musica per tag invece che generata.

## Player (`player/`, costruito)

Il player del progetto, e non un banco di prova in attesa di un prodotto vero.
Serve tre pubblici con **una build sola**: chi sviluppa il motore, chi collauda
una storia, chi la gioca e basta. La differenza fra loro non e' un'applicazione
diversa ma un interruttore — il debug — che accende la diagnostica e spento non
lascia traccia di se'. E' anche la ragione per cui e' una sola: quello che il
tester prova e' esattamente quello che il giocatore ricevera'.

Consuma **esclusivamente `story.ir.json`** — nessun manifest
asset, nessun indice — e serve a giocare e testare una storia molto prima che
esista il modulo voce. Nato puramente testuale; da IR 1.9.0 mostra anche le immagini
che la storia ha già pubblicato, quando ci sono, e dalla 1.10.0 apre sulla
locandina invece che su una pagina di testo.

### Le immagini nel player

- **Le trova da sé, o non le mostra.** L'id nell'IR diventa
  `assets/images/<id>.webp` relativo alla **cartella della storia**, e quella
  cartella è dedotta da dove è arrivato l'IR: la pagina stessa se l'IR è
  incorporato (il caso di `start_local_player.sh`, che mette `play.html`
  dentro la storia), la cartella dell'URL con `?ir=...`, e **nessuna** se l'IR
  è stato scelto a mano — lì non esiste una storia intorno, e si gioca in solo
  testo come prima. Il pannello lo dice, invece di lasciar credere che siano
  rotte.
- **Un'immagine dichiarata e non trovata si dice.** Stessa regola del testo
  mancante: il player non mette un segnaposto muto, scrive che l'id c'è nell'IR
  e il file no. È l'unico modo di accorgersi di una pubblicazione parziale
  senza aprire la console.
- **Testo e immagini sono due modi, non un interruttore in più.** In `testo`
  si vedono i prompt — cosa *verrebbe* generato, che è quello che serve
  lavorando sull'IR — in `immagini` il risultato, **al posto** dei prompt che
  lo hanno prodotto. Mostrare entrambi sembrava gratis e non lo è: fra
  un'inquadratura e la sua descrizione l'occhio sceglie l'immagine, il testo
  diventa mezzo schermo di rumore e la scena si legge peggio che senza. È la
  stessa forma della modalità ascolto: la storia ha tre uscite e si scelgono.
- **Lo schermo è diviso per senso: in alto ciò che si guarda, in basso ciò che
  si ascolta e si legge.** È la regola da cui discende tutto il resto del
  layout. In cima sta il *palco* (`player/src/web/palco.ts`) con l'inquadratura,
  il tono della scena, dove siamo, chi è in campo e le facce del cast; sotto
  scorre il transcript con la narrazione, il parlato, l'ambiente sonoro, gli
  effetti e i timbri di narrazione. Prima i due gruppi erano mescolati nel
  flusso, e la conseguenza si vedeva al sesto beat di una cutscene: le
  coordinate dell'inquadratura — dove sono, chi ho davanti, con che tono si
  legge questa scena — erano scorse via da un pezzo, proprio mentre si stava
  guardando la figura che le illustra.
- **L'inquadratura corrente sta ferma, il racconto le scorre sotto.** Il palco
  è un pannello solo, in cima allo schermo su telefono e a sinistra su schermo
  largo, dove **ogni immagine nuova prende il posto della precedente**. Finché
  le figure scorrevano dentro il transcript come il testo, quella di adesso
  usciva dallo schermo appena si scorreva per leggere la riga che la commenta,
  e chi gioca faceva avanti e indietro fra il testo e la sua illustrazione: due
  movimenti per una cosa sola. Un nodo **senza `image` non svuota il palco** —
  resta l'ultima inquadratura, che è esattamente ciò che succede quando la
  macchina non si è spostata.
- **Il tono non si nasconde mai.** È l'unico campo del palco che non descrive
  un'immagine: è la chiave con cui si legge tutto quello che scorre sotto, vale
  per la scena intera, e sta in chiaro nella riga sotto la figura anche quando
  il palco è ridotto. Dietro un tocco, nove volte su dieci non lo si
  guarderebbe.
- **I prompt stanno dentro la cosa che descrivono.** Non su una riga a parte
  del transcript, dove scorrerebbero via: si aprono **allargando** ciò a cui
  appartengono — l'inquadratura si tocca e si apre grande con `image_prompt` e
  l'aspetto del luogo per didascalia, una faccia si tocca e si apre con il
  `visual_prompt` e il timbro di *quel* personaggio. È il collegamento più
  corto possibile fra un asset e il testo che lo produce, ed è anche il momento
  in cui serve: guardandolo grande si decide se va bene. Nel transcript i campi
  visivi restano nel documento sotto `only-debug`, perché quello resta il
  registro di ciò che l'IR dichiara e chi ispeziona deve poter tornare sul beat
  di sei tocchi fa; chi gioca li ha già davanti, e leggerli due volte sarebbe
  mezzo schermo di rumore.
- **Il cast di scena sta di lato, tutto, per tutta la scena.** Miniature
  piccole sul bordo dell'inquadratura: di lato perché non devono rubare altezza
  alla figura, sempre in vista perché «chi c'è in questa stanza» è una domanda
  che ci si fa in continuazione. Ci sono **tutti** i personaggi di
  `scene.characters`, marcati: chi l'inquadratura dichiara in
  `characters_in_frame` è acceso, e un'inquadratura che non dichiara nessuno non
  spegne nessuno, perché «non dichiarato» non vuol dire «non c'è».

  **Che fine facciano i marcati lo decide il debug.** A chi gioca non si
  mostrano affatto: `scene.characters` elenca chiunque sia presente, anche chi
  deve ancora entrare, e una faccia spenta in fila annuncia che sta per
  arrivare qualcuno — nel magazzino di "Metal Head" è il Cane-robot mentre è
  ancora una sagoma nel buio. È lo stesso spoiler per cui i `target` dell'aiuto
  vengono dalle azioni disponibili e non dalla roster di scena. Col debug
  invece si vedono spenti, perché lì la domanda è cosa *dichiara*
  l'inquadratura, e la risposta è più utile se comprende chi ha lasciato fuori.
  Il prezzo è una fila che si accorcia e si allunga — la prima versione li
  marcava proprio per evitarlo — ma fra un movimento in più e
  un'anticipazione di trama vince il movimento. Quando le facce lo dicono già, la riga `characters_in_frame`
  sparisce dalla striscia: è la stessa cosa scritta due volte, e la seconda
  occupa lo spazio che serve al tono. Resta invece se qualcuno in campo **non**
  ha una faccia — nominato dall'inquadratura ma assente da `scene.characters`:
  lì è l'unico posto dove quel nome compare, e vederlo è anche il modo di
  accorgersi dell'incoerenza nell'IR.
- **Il palco c'è sempre, anche senza immagini.** In solo testo — immagini spente
  o storia non ancora illustrata — al posto della figura c'è l'`image_prompt` e
  al posto delle facce le iniziali, e allargarle porta comunque ai prompt. Un
  posto solo dove guardare in tutte e due le modalità: la testa dello schermo
  dice sempre dove siamo, cambia solo se lo dica con un'immagine o con le
  parole che la produrranno.
- **Il palco si riduce, non si chiude.** Una maniglia sotto l'immagine (a
  fianco, in due colonne) alterna fra due sole misure: grande e ridotta. Tre
  stati o un trascinamento ad altezza libera sono un'altra cosa da imparare per
  una decisione che ha due risposte — «voglio vederla» e «adesso no». Chiuderla
  del tutto è già possibile e si chiama spegnere le immagini: è una scelta
  sulla storia, e sta nel pannello. Il collasso stringe la figura e le facce,
  **non** la riga del tono.
- **Nel flusso restano solo le immagini che non sono inquadrature**: l'icona di
  un oggetto che si sta guardando. È un riferimento dentro un discorso, e il
  posto di un riferimento è accanto alla riga di cui parla. Il ritratto di un
  personaggio non è più nel flusso: è salito sul palco, dove risponde alla
  domanda mentre la si ha, invece che una volta sola all'ingresso in scena.
- **Toccare un'immagine la apre a schermo intero**, con i suoi prompt come
  didascalia. Le due misure servono a due cose diverse: sul palco l'immagine
  accompagna la lettura, a schermo intero si guarda, ed è guardandola che si
  decide se quell'asset va bene. Si chiude con un tocco ovunque, non solo con
  la ✕: su un telefono un popup che si chiude in un punto solo è il modo più
  rapido di far uscire qualcuno dalla partita.
- **Ogni fascia dell'app dichiara la sua riga di griglia** (`grid-template-areas`),
  invece di lasciarlo decidere all'ordine dei figli. Non è pedanteria: il palco
  nasce `hidden`, un figlio nascosto non occupa la sua riga, e le tre fasce
  rimaste scalavano di una — il dock finiva nella riga elastica, cioè sotto il
  bordo dello schermo. Si vedeva dove faceva più male: sulla copertina, dove il
  dock contiene il **solo bottone che fa cominciare la storia**, e su un
  telefono in verticale bastava un riepilogo lungo a spingerlo fuori.
- **L'icona di un oggetto compare quando lo si guarda**, per entrambe le
  strade che portano alla stessa risposta d'autore — «guarda il walkie» scritto
  e il tocco sulla chip dell'inventario. Non nell'elenco delle chip: lì
  l'oggetto è una voce di menu, e una fila di miniature è un inventario da
  gioco di ruolo, non la risposta a «cosa ho in mano». Perché il player possa
  farlo, `EsitoTurno` porta anche l'**id** dell'oggetto guardato e non solo il
  testo: ricavarlo di nuovo dalla frase significherebbe rifare il lavoro del
  resolver, con la possibilità di arrivare a una risposta diversa da quella che
  si sta mostrando.
- **Due layout, non due prodotti.** Su telefono in verticale il palco è una
  fascia in alto (46dvh, 25 da ridotto) con le facce in colonna sul bordo, e
  sotto scorrono testo e azioni; da 900
  px di larghezza — o su uno schermo basso e largo, cioè un telefono coricato —
  la stessa fascia diventa la colonna di sinistra a tutta altezza e la storia
  si legge a destra, e le facce passano in fila sotto la figura invece che di
  lato — lì la larghezza è contesa e l'altezza no. Cambia solo se il collasso
  restituisca altezza o larghezza: il palco resta uno e la maniglia resta una. L'immagine non viene
  **mai ritagliata** per riempire il palco (`contain`, bande sul fondo del
  pannello): ritagliare butterebbe via proprio la parte che nello studio si è
  scelta guardando.
- **Il testo resta una colonna di lettura** anche quando ce n'è lo spazio: a
  centoventi caratteri l'occhio perde il capo tornando a sinistra. Su schermo
  largo quello che avanza va nei margini, non nella lunghezza delle righe.
- **L'app è alta quanto il viewport *visuale*, non quanto la finestra.**
  `100dvh` misura la finestra, e la tastiera di sistema non la rimpicciolisce:
  sale sopra la pagina. Il risultato era che i tasti coprivano il dock, cioè
  proprio la riga in cui si scrive cosa fare — l'interfaccia del gioco.
  `visualViewport` misura quello che si vede davvero, e l'app ci si adatta: il
  dock resta appoggiato al bordo dei tasti e il transcript si accorcia sopra di
  lui. `100dvh` resta come ricaduta dove `visualViewport` non c'è.
- **Mentre si scrive, il palco si ritira alla sola riga delle coordinate.**
  Adattare l'altezza dell'app non bastava: il palco è alto in `dvh`, cioè
  misurato sulla finestra intera, e su metà schermo si prendeva tutto quello
  che restava — sopra l'inquadratura, sotto i tasti, in mezzo due righe di
  testo. Chi ha il dito sulla tastiera non sta guardando la figura: sta
  leggendo cosa è appena successo per decidere cosa scrivere. Sparisce la
  figura, restano il tono e il luogo, e tutto torna al primo tocco fuori dal
  campo. Non è il collasso della maniglia — quello è una scelta sul momento e
  resta dove l'utente l'ha lasciato — ma una risposta alla tastiera.
- **Il fuoco automatico nel campo vale solo dove la tastiera non costa niente**
  (`pointer: fine`). Su un telefono rimettercelo dopo una frase che non ha
  fatto match significa riaprire i tasti addosso alla risposta appena
  arrivata — cioè proprio la riga da leggere per capire come riscriverla. La
  tastiera si richiama con un tocco, e quello è un gesto che si fa quando si è
  finito di leggere. Simmetricamente, togliere dal DOM un campo che ha il fuoco
  non basta a chiudere la tastiera: il fuoco va tolto **prima**, esplicitamente,
  o i tasti restano aperti su un elemento che non esiste più.
- **«continua», «inizia» e il bottone di invio sono i bersagli più grandi del
  player.** Si toccano decine di volte per partita, spesso al buio e col
  pollice: non possono avere la taglia di una voce di dialogo. Il segno dentro
  cresce con loro — piccolo dentro un bottone grande sembra disattivato.
- **La scelta compare solo quando c'è qualcosa da scegliere**: la storia ha
  immagini pubblicate e il player sa dove cercarle. Altrimenti al suo posto c'è
  una riga che dice quale dei due pezzi manca. Un interruttore che non cambia
  niente è peggio della sua assenza — chi lo trova lo prova, non vede succedere
  nulla e conclude che il player è rotto.
- **Il ritratto di un personaggio è la sua ancora**, la stessa immagine che il
  generatore allega alle inquadrature. È la faccia che sta di lato
  all'inquadratura, e allargarla mostra l'aspetto e il timbro con cui è stata
  costruita: è il modo di accorgersi che due scene stanno usando due Laura
  diverse.
- **In terminale l'id si stampa come gli altri campi.** Non si vede
  l'immagine, ma si vede se c'è: un beat con `image_prompt` e senza `image` è
  un beat che nel player web resterebbe senza inquadratura, e il playthrough di
  regressione lo mostra senza aprire un browser.

Perché il linter serve, in una riga: è il modo più economico per scoprire che
una storia compilata *non è giocabile* (scena senza uscita, `goto` che punta a
un id inesistente, flag mai impostato ma richiesto da una condizione, ramo
di dialogo irraggiungibile) senza dover prima generare immagini e voci.
La validazione di schema dice che l'IR è *ben formato*; solo giocarlo dice
che è *giocabile*.

**Stack scelto: TypeScript, un core condiviso e due facce** (`player/`).
Decisione presa dopo una prima versione in Go, buttata: un binario da riga di
comando non si esegue su un telefono, e testare una storia richiede provarla
sul device su cui verrà giocata. Il vincolo vero è quello — *testare
indipendentemente dal device* — e in browser ci si arriva solo con JS.

- `player/src/core/` — engine, stato, `Effect`/`Condition`, linter, resolver,
  lettura severa dell'IR. Non tocca il DOM e non legge da stdin.
- `player/src/web/` — il player vero e proprio, mobile-first. La build è **un
  unico file HTML** (JS e CSS incorporati) che si apre anche da `file://`, si
  manda in chat o si mette su qualunque static host: nessun runtime da
  installare, che era poi il pregio del binario Go.
- `player/src/cli/` — il terminale, per `--lint` e `--script` headless in CI.
  Non gira su mobile e non deve: è l'altra metà del bisogno.

Cosa si guadagna rispetto al Go, oltre al browser: la logica dell'engine sta in
un posto solo e le due facce se la dividono, invece di essere riscritta una
seconda volta per il web. Contro consapevole: si perde il binario autonomo, e
la CLI ora richiede Node installato. Le dipendenze restano zero a runtime (TypeScript e
Vite sono soli strumenti di build).

- **Input unico: l'IR.** Nessun'altra dipendenza. Tutti i campi destinati
  alla generazione asset (`image_prompt`, `ambient_sound_prompt`,
  `sound_effect_prompt`, `VoiceSpec.style_prompt`, `ambient_music_tags`)
  non vengono generati né riprodotti, ma **si vedono sempre come testo** —
  tutti, nessuno riservato alla modalità debug — etichettati con il nome che
  hanno nell'IR e attaccati al punto della storia a cui appartengono: lo stile
  globale in testa alla partita, i prompt di scena e dei personaggi presenti
  nella sua intestazione, quelli di un beat appesi al beat, `voice_override`
  sotto la battuta, `narration_voice` e `play_sound_prompt` dopo l'effetto che
  li produce. Sono il segnaposto di
  quello che diventeranno immagine, suono e voce, ed è leggendoli mentre si
  gioca che ci si accorge che un beat ha cambiato inquadratura senza dirlo o
  che manca un suono — cioè si rilegge la storia con gli occhi del modulo
  assets, prima che il modulo assets esista. Il debug non aggiunge prompt:
  aggiunge la diagnostica intorno (id, condizioni, effetti, azioni filtrate e
  il perché). Conseguenza voluta: il player è anche un **test di conformità
  dell'IR** — se riesce a portare una storia dall'inizio alla fine, il
  contratto regge.
- **Copertina all'avvio**: prima della prima scena il player mostra quello che
  vale per tutta la storia — titolo, descrizione, `ir_version`, `id`,
  `language`, numero di scene, `start_scene`, `global_style` e la roster dei
  personaggi con i loro prompt. Serve a riconoscere al volo *quale* IR si sta
  giocando, domanda tutt'altro che oziosa quando il compilatore non è
  deterministico tra sessioni.
- **Cosa mostra in gioco**: narrazione all'ingresso scena (tutti i beat di
  `narration[]` in sequenza, incluse le cutscene, con tap-to-continue),
  battute di dialogo con `speaker`, scelte di dialogo disponibili, azioni
  contestuali della scena. Le scelte e le azioni non disponibili (condizione
  `Condition` non soddisfatta) restano nascoste come in un player reale.
- **Il tap-to-continue sta *fra* i beat, non dopo l'ultimo.** Finito l'ultimo
  beat di `narration[]` non si chiede un tocco per scoprire cosa c'è dopo: le
  azioni della scena — o l'unica azione di prosecuzione di una cutscene —
  compaiono insieme a quel beat. Il motivo è che quel tocco non portava niente
  di nuovo sullo schermo: in fondo a una cutscene diventava un "avanti" seguito
  subito da "Continua", due bottoni di fila che dicono la stessa cosa, e in una
  scena interattiva serviva solo a far comparire delle chip già pronte. Non è
  una deroga alla regola "il player non aggiunge logica narrativa": le azioni
  disponibili e le transizioni restano esattamente quelle dell'IR, cambia il
  momento in cui si vedono, che è impaginazione. Vale per entrambe le facce —
  web e CLI si fermano negli stessi punti, perché una differenza di ritmo fra
  le due renderebbe il collaudo su una non trasferibile all'altra.
- **Le chip delle azioni sono passate sotto il debug** (1.8.0). Con un
  resolver a input libero l'interfaccia è la riga di testo, e l'elenco delle
  azioni torna a essere quello che è sempre stato: uno strumento di
  ispezione. Non è una scelta di stile — finché l'elenco resta acceso non si
  può giudicare quanto una storia compilata sia difficile davvero, perché è
  l'elenco a risolvere gli enigmi. Le chip restano nel DOM e ricompaiono con
  il tasto `debug` (in CLI, con `--debug` o `:debug`). Nel **dialogo** invece
  non cambia niente: lì l'elenco delle battute si vede sempre, per la decisione
  di 1.7.0 — si agisce a parole, si parla a scelte.

- **Modalità ascolto: la storia recitata invece che letta** (`src/web/ascolto.ts`,
  `src/web/voce.ts`, scheda «ascolto» nel pannello). Il player mostra i prompt di
  generazione come testo perché un giorno saranno immagine, suono e voce. Chi non
  guarda lo schermo ha lo stesso bisogno e ce l'ha *adesso*: **la descrizione di
  un'inquadratura letta ad alta voce è l'immagine, finché l'immagine non esiste.**
  Da qui la modalità — non un lettore di schermo attaccato sopra, ma una seconda
  uscita del player, che riceve gli stessi dati dell'altra e li dispone per
  l'orecchio. Sta interamente in `src/web/`: il core non sa che esiste un
  altoparlante, come non sa che esiste un DOM, e la CLI non deve nemmeno poterlo
  importare. Nessuna dipendenza: `speechSynthesis` del browser, che è anche
  l'unico modo di far parlare il file HTML autonomo aperto da `file://`.

  Quattro decisioni la definiscono.

  - **Il collapse acustico è lo stesso di quello visivo.** A schermo il prompt di
    un luogo o di un personaggio si vede per intero la prima volta e poi si
    riduce a una riga richiudibile. All'orecchio la riga richiudibile non esiste,
    quindi la stessa regola diventa: la prima volta la composizione per intero,
    dalla seconda **solo il nome** dell'ambiente e dei personaggi. L'unità di
    "prima visita" è l'inquadratura (`<scena>`, `<scena>#<beat>`) per
    l'`image_prompt` e l'entità per i prompt di luogo e personaggio — così una
    scena nuova nello stesso luogo dice la sua inquadratura senza ridescrivere il
    luogo, che è esattamente ciò che a schermo fa il marcatore `ereditato`. I due
    registri sono **separati**: sono due uscite indipendenti, e giocare a schermo
    spento non deve cambiare quello che si vedrebbe riaccendendolo. La regola
    invece va tenuta identica, ed è il motivo per cui la chiave dei personaggi ha
    la stessa forma nelle due (`id · campo · testo`: un override locale è un
    valore diverso e va risentito).
  - **«Guardati intorno» riapre tutto.** È il contrappeso del collapse: a schermo
    quella riga si riapre con un tocco, all'orecchio si riapre chiedendolo. Il
    verbo del player esisteva già (`verbi.ts`), qui ricompone l'intera scheda di
    scena. Non consuma i registri: è una rilettura su richiesta, non una prima
    visita, e la volta dopo si torna a collassare.
  - **Il dock non si legge. Mai.** Né «continua», né «scrivi cosa fare», né le
    scelte di dialogo, né la conferma della chip appena toccata. Si recita quello
    che *è successo* — narrazione, battute, esito dei comandi — non l'interfaccia
    con cui lo si è chiesto: una chip la si tocca perché la si è già vista, e
    sentirsela rileggere raddoppia ogni turno. Unica cosa che somiglia a
    un'eccezione e non lo è: l'azione riconosciuta da una frase *scritta* si
    sente, perché lì non si sta leggendo una chip ma dicendo cosa il resolver ha
    capito — l'unica risposta a «ha preso l'azione che volevo?» prima che
    l'effetto sia applicato. Alla fine di una scena il silenzio dice che tocca al
    giocatore.
  - **Avanzamento automatico** (flag, acceso con la modalità): finita la lettura
    si prosegue da soli, perché un «continua» da cercare a tentoni sullo schermo
    è l'ostacolo che questa modalità esiste per togliere. Copre il tap-to-continue
    fra i beat e — unico caso in cui il player preme una chip di azione — **l'unica
    uscita di una cutscene**, che nell'IR è un'azione e non un tap. Solo con una
    candidata sola: dove le azioni sono due il player non sceglie al posto del
    giocatore, e vale anche quando la scelta sembra ovvia.

  - **Ogni frase va spezzata prima di darla alla sintesi.** Chrome smette di
    parlare dopo ~15 secondi di una *stessa* utterance: resta formalmente in
    corso e non esce più niente. Non è un caso limite — la descrizione di un
    ambiente è un luogo più un'inquadratura in un periodo solo, e sull'IR di
    "Metal Head" sono 114 frasi su 126 sopra i 180 caratteri, con una punta da
    627 (~44 secondi). Si tagliano sui confini che il testo ha già (frase,
    poi virgola, poi spazio), quindi la voce respira dove respirerebbe comunque,
    e l'invariante è che le parole in uscita siano *esattamente* quelle in
    entrata: il testo è d'autore e questa è impaginazione, non sintesi. Il
    limite è in **secondi, non in caratteri**, e quindi scala con la velocità:
    tagliare a lunghezza fissa proteggerebbe solo chi lascia il cursore dov'è, e
    chi rallenta la voce — cioè chi ha più bisogno di sentire tutto — si
    ritroverebbe il taglio di prima. Il rimedio che gira ovunque per questo bug
    è un `pause()`/`resume()` periodico che tiene sveglio il motore: era la
    prima versione, ed è un espediente contro un timer che non si vede che
    dentro l'iframe di una pagina pubblicata smette di funzionare del tutto.
    Meglio togliere la causa che combattere l'effetto.

  Il resto sono parametri, nella scheda: un flag per recitare **anche i prompt di
  suono e di tipo di voce** (`ambient_sound_prompt`, `sound_effect_prompt`,
  `play_sound_prompt`, i `VoiceSpec.style_prompt`) — spento di default, perché
  giocando è una rottura del quarto muro a ogni battuta, ma è l'unico modo di
  collaudare la resa sonora di un IR senza guardare — e la scelta della voce di
  sistema con velocità, tono e volume. Le impostazioni vivono fuori dalla partita
  (ricominciare non deve costringere a riscegliere la voce); i registri del
  collapse vivono quanto la partita, come quello visivo.

  Vincolo rispettato per intero: **qui non si inventa prosa.** Ogni frase recitata
  è testo d'autore dell'IR. Le uniche parole del player sono le etichette dei
  campi — «Ambiente:», «Personaggio:», «Voce:», «Suono:» — che a schermo stanno
  scritte accanto al valore: dette invece che disegnate. Anche il testo del
  bottone «prova» è il titolo della storia, non una frase di comodo — ed è pure il
  campione più utile, perché sono i nomi propri quelli su cui una voce sintetica
  inciampa.

- **Una traccia esaurita finisce la partita in CLI e la restituisce al
  giocatore sul web.** È lo stesso file e lo stesso `ScriptDriver`, ma serve a
  due cose diverse, e trattarle uguale era sbagliato in entrambe le direzioni.
  In CLI una traccia che si esaurisce prima del finale è un **test fallito**:
  è il segnale per cui i playthrough di riferimento esistono, e lì l'errore
  deve propagarsi e far uscire con 1. Sul web la stessa traccia è il modo in
  cui si **riprende una partita**: si incolla, si rigioca in un istante — senza
  tap-to-continue, quindi il transcript si riempie tutto insieme — e da lì si
  continua a giocare. Prima la partita si chiudeva con «script di playthrough
  esaurito» e nessuna riga di input: l'unico esito che non ha senso in nessuno
  dei due mondi.

  Perché funziona come salvataggio senza che nessuno l'abbia progettato così:
  poiché il resolver può solo scegliere fra azioni già definite, la sequenza
  degli id **descrive per intero la partita** — è la stessa proprietà che rende
  un playthrough un test di regressione. Un salvataggio è quindi una traccia, e
  la traccia continua a crescere mentre si gioca: si ricopia dal pannello e si
  risalva. Il marchio «traccia» nella barra sparisce quando la traccia finisce,
  perché da quel momento non è più una partita rigiocata.

- **Ricaricare la pagina non butta via la partita.** La stessa traccia va in
  `localStorage` a ogni mossa (`player/src/web/ripresa.ts`, una chiave per
  storia) e viene rigiocata all'avvio. Non è un secondo formato di salvataggio:
  è quello che già c'era, scritto in un posto invece che negli appunti — il
  codice da copiare e la ripresa automatica sono la stessa cosa in due posti
  diversi. Serve perché su un telefono ricaricare non è quasi mai un gesto
  deliberato: è il browser che scarica la scheda per fare spazio, è un ritorno
  all'app dopo mezz'ora. Tornare alla copertina è il modo più rapido di far
  smettere di collaudare una storia lunga.

  Tre dettagli che non sono ovvi. Il marchio «traccia» **non** compare su una
  ripresa: serve a dire «quello che stai guardando non l'hai giocato tu
  adesso», e riaprire la propria partita è il caso opposto. «Ricomincia»
  dimentica la partita salvata prima di farne partire una nuova, altrimenti
  tornerebbe al ricaricamento successivo. E le impostazioni si riprendono con
  lei **tranne il backend del resolver**: riaprire una pagina non deve poter
  far partire il download di un modello, che è una cosa che si chiede.

  Sotto script il transcript non insegue il fondo a ogni blocco: nessuno sta
  leggendo mentre la traccia scorre, e ognuno di quegli inseguimenti costa una
  misura del documento. Su una ripresa di centotrentacinque passi erano più di
  mille rimisurazioni per arrivare dove si arriva comunque col primo turno
  vero — due secondi contro uno.

- **Le diagnostiche stanno sotto il debug; chi gioca legge sempre testo
  d'autore.** *(cambio di rotta rispetto alla decisione precedente, ed è giusto
  dirlo)* La regola era: dove l'IR non ha il testo che servirebbe, il player
  tace e lo segnala come nota fra parentesi, così un buco si vede quando
  capita. Nasceva quando questo era solo uno strumento di collaudo. Adesso la
  stessa build si gioca — e chi indovina l'azione giusta un momento troppo
  presto, cioè chi sta giocando bene, riceve `(manca blocked_narration
  nell'IR)` al posto della storia.

  Ora il player **ripiega sul fallback per intenzione** — che è comunque testo
  d'autore, già nell'IR — e la nota resta ma si vede solo a debug acceso. Il
  segnale non si perde, cambia posto: il linter le elenca tutte prima di
  giocare, e le due che producevano note (`blocked_narration` mancante,
  `look_variants` mancanti) sono state promosse ad **avviso**.

  Resta fuori `problem()`, che si vede sempre: quello segnala un IR **rotto**
  (un `goto` verso un id inesistente, un nodo di dialogo che non c'è), non una
  prosa che manca. La differenza è che lì non c'è niente da leggere al suo
  posto, ed è l'informazione per cui questo player esiste.

- **Un tentativo che nomina una cosa che si ha in mano riceve una risposta su
  *quella* cosa.** Ultimo passo prima del fallback: se la frase non ha trovato
  né un'azione né un verbo, ma nomina un oggetto dell'inventario, si legge la
  sua `description` invece del `no_match_narration`. Il motivo è che i due
  testi sono entrambi d'autore, ma il fallback è scritto per l'*intenzione* e
  della cosa appena nominata non sa niente: «usa il walkie» si sentiva
  rispondere «Le mani non trovano niente», mentre la descrizione del walkie
  dice che è scarico — cioè esattamente quello che il giocatore stava
  chiedendo. La precedenza non cambia (prima il resolver, poi i verbi, poi
  questo): un'azione della scena vince sempre. La soglia di somiglianza è più
  alta di quella dell'esame, perché qui manca il filtro del verbo di percezione
  e senza margine qualunque frase somiglierebbe vagamente a qualcosa nello
  zaino.

- **Quando nella scena non resta niente da fare, l'uscita si mostra.** Le chip
  stanno sotto il debug perché un elenco di azioni risolve gli enigmi al posto
  del giocatore — ma quando gli enigmi sono finiti non c'è più niente da
  proteggere, e continuare a chiedere di indovinare la frase giusta è solo un
  muro. Succedeva letteralmente: nella scena in auto di "Metal Head", finito il
  dialogo, si usciva scrivendo «continua», che è un alias dell'azione — cioè
  indovinandolo. Ora compare la chip con la label d'autore («Lasciare che la
  strada finisca»), che oltre a non farsi indovinare dice anche *dove* si sta
  andando.

  «Niente da fare» ha una definizione precisa, ed è la sola che regge: ogni
  azione disponibile che non sia un'uscita è **già stata eseguita almeno una
  volta**, oppure è una **pura osservazione** (il suo `Effect` non ha flag,
  oggetti, dialoghi né transizioni: si può rileggere per sempre senza che la
  storia si muova). Senza la prima metà la regola non scatterebbe mai dove
  serve — l'azione che apre un dialogo resta disponibile anche dopo averlo
  ascoltato, e riascoltarlo non è qualcosa che resta da fare. Serve quindi che
  `GameState` ricordi le azioni eseguite e non solo quelle *consumate*: sono
  due domande diverse («è già stata fatta» contro «non si può più fare»), e
  resta derivabile da quello che il giocatore ha fatto, come `history`.

  **Una sola uscita, altrimenti niente.** La prima versione le mostrava tutte,
  con l'idea che fra più uscite non ci fosse un enigma da proteggere ma una
  decisione da prendere. È sbagliato, e si vede appena si incontra una scena il
  cui *unico* contenuto è un bivio: la cabina del furgone di "Metal Head" ha
  quattro azioni e tutte e quattro portano fuori, nessuna condizionata. Lì non
  resta niente da fare fin dal primo istante — non perché la scena sia
  esaurita, ma perché non ha mai avuto altro — e la regola stampava l'elenco
  completo delle quattro scelte: esattamente il menu che le chip sotto debug
  esistono per non mostrare. È il limite della condizione «non resta niente da
  fare»: non sa distinguere una scena *esaurita* da una che è sempre stata solo
  un bivio. Con una sola uscita quel caso non può presentarsi, perché
  alternative da svelare non ce ne sono.

  In modalità ascolto quell'unica uscita è la sola parte del dock che si
  recita, per la stessa ragione per cui si mostra.

- **«Cosa posso fare?» risponde con i bersagli, non con le azioni.** Un player
  a parole in cui non si trova la frase giusta è un player in cui la storia si
  ferma; ma l'elenco delle azioni la risolve al posto del giocatore, ed è la
  ragione per cui le chip stanno sotto il debug. Il verbo del player nomina
  quindi i **`target`** delle azioni disponibili, con il nome d'autore
  dell'oggetto o della persona: dice dove guardare, non cosa fare. «Tommy» non
  è «parla con Tommy»; «la cassa» non è né «apri la cassa» né «sposta la
  cassa». L'enigma resta intero, l'attrito di indovinare *su cosa* no.

  I bersagli delle azioni nascoste da una condizione non entrano (sarebbero un
  anticipo, a volte uno spoiler), né il protagonista (non è un bersaglio, è chi
  sta chiedendo), né i `target` che non si risolvono in un oggetto o in un
  personaggio — `"ambiente"` è la convenzione dello schema per un bersaglio
  generico, e un id buttato in faccia al giocatore non è una risposta.

  **La risposta somma due pezzi**, e sommarli invece di sceglierne uno è la
  parte importante: il **`look` della scena com'è adesso** (`look_variants`
  comprese) più i **bersagli** delle azioni disponibili. Il `look` è il pezzo
  che porta l'indizio, perché è l'unico testo della scena che cambia con lo
  stato — nel magazzino di "Metal Head", dopo aver confrontato il codice sul
  palmo, dice «il numero sul palmo e quello sul montante coincidono: è questo»
  — ed è anche il posto dove l'autore nomina le cose della stanza (scaffali,
  schedario, armadietto) che nell'IR non sono oggetti e che nessun altro campo
  saprebbe elencare.

  Due correzioni ci sono volute per arrivarci, ed entrambe dicono qualcosa di
  generale. La prima: la versione iniziale si fermava ai `target` e dichiarava
  «manca `actions[].target` nell'IR» quando non ne trovava — su "Metal Head"
  **26 scene su 43**, perché `target` è opzionale nello schema e `"ambiente"`
  è la sua convenzione documentata. Non era un buco dell'IR, era una
  diagnostica sbagliata, e il principio che ne esce vale oltre questo caso:
  **un IR conforme allo schema non deve poter far comparire una nota di
  errore.** Le note esistono per i buchi veri, non per i campi opzionali. La
  seconda: mettendo i pezzi in cascata invece che in somma, «chi è in scena»
  arrivava per primo e rispondeva «In gioco: Mark» proprio dove il `look` aveva
  l'indizio buono — il pezzo più povero copriva il più ricco.

  I nomi vengono dai `target` delle azioni e **non** da `Scene.characters`: la
  roster di scena contiene chiunque sia presente, anche chi il giocatore deve
  ancora scoprire, e provandolo l'aiuto annunciava il Cane-robot mentre era
  ancora una sagoma nel buio.

  **È anche l'unica frase che si consulta prima del resolver.** L'ordine di
  `turno.ts` — resolver, poi verbi del player — esiste perché un'azione
  d'autore vinca sempre su un verbo di sistema, e resta valido per tutti gli
  altri. Ma «cosa posso fare» non è un tentativo di agire sul mondo, è una
  domanda sull'interfaccia, e trattarla come una frase qualunque significava
  lasciarla somigliare agli alias di un'azione e farla partire: succedeva in 5
  scene su 43, e in una di quelle il giocatore che chiedeva aiuto sparava al
  tetto del furgone. Una domanda non può applicare un `Effect`. Il prezzo, che
  va detto: una storia non può più avere un'azione chiamata esattamente
  «aiuto».

- **Le didascalie dentro un dialogo sono prosa, non una voce fuori campo.**
  Nella sceneggiatura, fra due battute c'è quasi sempre una riga che dice cosa
  succede mentre si parla — «Tommy guarda Laura nello specchietto», «Laura
  tiene ancora il palmo chiuso». Nell'IR quella riga è un nodo con
  `speaker: "narrator"` (in sequenza) o una `choices[].effect.narration` (su un
  ramo di scelta: l'effetto si applica dopo il tocco e prima del nodo di
  destinazione, che è dove la didascalia sta, e non tocca il `goto` — che è il
  nome con cui i playthrough identificano il ramo). Il player le impagina come
  prosa e **non ci mette nessun nome davanti**: «Narratore:» inventerebbe una
  voce fuori campo che nella scena non c'è, e in modalità ascolto la farebbe
  pure recitare a ogni riga.

  Perché è una decisione e non un dettaglio: un dialogo a cui il compilatore ha
  tolto le didascalie **si gioca benissimo e non se ne accorge nessuno finché
  non lo si legge** — le battute ci sono tutte, il linter tace, i playthrough
  passano. È successo davvero: su "Metal Head" la scena in auto aveva undici
  battute e una sola didascalia superstite. Da qui il controllo statico: un
  dialogo di almeno quattro nodi con meno di una descrizione ogni sei è
  `info`, perché è la firma di quella perdita. È un *rapporto* e non un
  conteggio proprio perché la regola "zero descrizioni" lasciava passare il
  caso da cui è nata.

- **Ogni risposta dichiara chi l'ha decisa** (⟨lessicale⟩, ⟨embedding⟩,
  ⟨verbo del player⟩), sempre, non solo in debug. Il backend a vettori esiste
  per essere valutato, e un rapporto di copertura non dice cosa si prova a
  giocarci: vedere ⟨lessicale⟩ per venti turni e poi ⟨embedding⟩ su una frase
  che il lessicale non avrebbe preso è l'informazione che il numero non dà.

- **Modalità debug** (comando dedicato, es. `:debug`, oppure il tasto `debug`
  nel player web): mostra quello che i prompt di scena non dicono già — `id`,
  conteggi, personaggi presenti, `on_enter_flags_set` — l'elenco delle azioni
  disponibili e **tutte** le azioni della scena, comprese quelle
  attualmente filtrate da una condizione, con accanto id, condizione
  richiesta ed effetto risultante. Serve a capire *perché* un'azione non
  compare, che è la domanda che ci si pone il 90% delle volte quando si
  testa una storia.
- **Ispezione dello stato**: comandi per vedere flag attivi, inventario,
  scena corrente e storico delle scene visitate. Lo stato del gioco è
  piccolo e interamente derivabile dagli `Effect` applicati, quindi mostrarlo
  è banale e rende ovvia la diagnosi di ogni bug di stato.
- **Resolver pluggable, tre backend dietro la stessa interfaccia** (quella
  già fissata sopra: riceve azioni disponibili + testo libero + tono, ritorna
  un id di azione esistente oppure un fallback in-character):

  1. **lessicale** — matcher deterministico sugli `aliases` scritti in
     compilazione. Zero dipendenze, zero rete, zero byte scaricati, e sta
     dentro il file HTML unico. **È il default** (`--resolver lessicale`).
  2. **ibrido** — lessicale + vettori, con i vettori solo dove il lessicale
     tace (vedi sotto). **È la modalità con cui si gioca**, quando i vettori
     si vogliono.
  3. **embedding** — solo vettori, il lessicale non viene consultato affatto.
     Non è una modalità di gioco: lì un falso positivo esegue senza nessuna
     rete di protezione. Serve a **misurare** cosa fa l'embedder da solo, che è
     l'unico modo di dire quanto stia aggiungendo davvero nell'ibrido invece
     di limitarsi a confermare quello che il lessicale aveva già preso.
  4. **Claude** — via API/sessione. Non ancora implementato: `--resolver
     claude` esce con un errore esplicito. Il suo posto naturale non è essere
     il backend di gioco ma **l'oracolo di riferimento**: si fa girare lo
     stesso set di frasi di prova su tutte e si misura quanto si perde.

  Che le tre modalità siano separate e non un interruttore è il punto: senza
  `embedding` puro non c'è modo di sapere se l'ibrido stia guadagnando o solo
  costando, perché nell'ibrido i vettori parlano *solo* dove il lessicale ha
  già rinunciato, e da lì non si vede la differenza fra "ha aggiunto poco" e
  "non era mai il suo turno".

  Il backend si sceglie all'avvio; nel player web anche a partita in corso,
  dalla scheda **resolver** del pannello, che è dove va guardato: non è stato
  di gioco, è uno strumento di misura, e la cosa da farci è accendere
  l'embedder nella scena in cui il lessicale ha appena detto di no e riscrivere
  la stessa frase. Il resto del player non cambia.

  Quella scheda espone anche i tre indirizzi da cui il backend a vettori
  dipende — libreria, modello, host dei pesi. Non è configurabilità per gusto:
  quando questo backend fallisce, fallisce sempre su uno di quei tre, e con
  gli indirizzi incisi nel codice l'unica diagnosi che arriva a chi gioca è
  «Failed to fetch» — che non dice né quale, né se il problema è suo. Nella
  pagina pubblicata non funziona affatto (nessuna richiesta verso l'esterno) e
  il player lo dice a parole invece di mostrare l'errore grezzo.

- **Il backend a menu è stato tolto** (1.8.0), e vale la pena dire perché. Non
  serviva più a niente di quello per cui era nato: i test di regressione non
  passano dal resolver (li guida `--script`, che esegue una sequenza di id), e
  ispezionare una scena adesso si fa con `--debug`, che stampa l'elenco delle
  azioni e accetta il numero della riga che ha appena scritto. Quel numero è
  interfaccia, non un backend: sta in `cli/ui.ts` perché è l'interfaccia a
  sapere che cosa ha appena stampato. Sparita con lui anche la bandiera
  `acceptsFreeText`, e con la bandiera tutte le diramazioni che tenevano in
  piedi due modi di giocare in ogni faccia del player.

- **La divisione del lavoro fra lessicale ed embedding è per costo
  dell'errore, non a cascata** (1.8.0). I due backend falliscono in modi
  diversi, e la differenza è tutta lì:

  - il **lessicale** ha precisione alta e richiamo più basso: sbaglia
    **rifiutando**. Costa al giocatore una frase riscritta — e, nel caso
    peggiore, la sensazione di aver sbagliato strada quando invece aveva
    risolto l'enigma. Attenzione: i fallback d'autore *aggravano* questo caso.
    Un «non ho capito» generico è onesto e invita a riformulare; un fallback in
    tono e pertinente dice «no, non è quella la strada», cioè mente con
    convinzione;
  - l'**embedder** ha richiamo più alto e precisione più bassa: sbaglia
    **facendo**. Gli embedding di frase sono ciechi sulla negazione («non
    toccare il cavo» e «tocca il cavo» hanno vettori quasi identici) e sulla
    direzione degli argomenti («chiedi a Mark del coltello» / «dai il coltello
    a Mark»). Un falso positivo *esegue*: applica un `Effect`, alza un flag,
    consuma un oggetto, brucia un enigma.

  Quindi non una cascata ingenua ma una divisione netta: **l'embedder
  interviene solo dove il lessicale è muto** (nessuna candidata sopra soglia, e
  non per ambiguità — se due azioni se la giocano alla pari il problema non è
  che manchi comprensione) **e sempre nella scelta del fallback**, dove
  sbagliare è gratis: nessun effetto, nessuna transizione, al peggio una
  battuta un po' fuori bersaglio. In una riga: *embedding dove sbagliare non
  costa niente, lessicale dove sbagliare cambia lo stato*.

- **Le soglie sono esportate e vanno tarate con i dati, non a naso**
  (`ACCETTA`, `MARGINE`, `CERTEZZA`, `PESO_UNIONE`, `SOGLIA_EMBEDDING` in
  `core/resolver.ts`; `PESO_PAROLA_SOLA` in `core/lexical.ts`). Il margine
  merita una riga: un'azione non si esegue solo perché è la migliore, deve
  anche **staccare la seconda**. Due candidate a pari punteggio sono
  un'ambiguità vera, e a un'ambiguità vera si risponde con un fallback —
  tirare a indovinare qui significa applicare un `Effect` che nessuno ha
  chiesto.

  Le due curve misurate con `--copertura`, che sono anche il modo in cui queste
  costanti sono state scelte:

  - `ACCETTA` (quanto deve valere il migliore): 0.50 → 58% preso / 3%
    sbagliato; 0.55 → 52% / 3%; 0.60 → 44% / 1%. Default **0.55**.
  - `PESO_PAROLA_SOLA` (quanto vale un alias di una parola sola contro una
    frase lunga): 0.80 → richiamo più alto di sei punti, ma «cerco di capire se
    quella parete si può salire» fa partire l'azione che *chiude la storia*,
    agganciata all'alias "sali". 0.65 → quella frase torna a non risolvere.
    Default **0.65**: sei punti di richiamo in cambio di un finale che parte da
    una domanda è lo scambio che questo progetto ha già deciso di fare.

  Una cautela sui numeri, che vale più dei numeri: sono misurati su frasi di
  prova scritte dalla stessa mano che ha scritto gli alias. Dicono che il
  meccanismo funziona e dove si rompe; non dicono quanto capirà la prossima
  storia. Per quello serve un IR compilato da qualcun altro.

- **`--copertura`: il banco di prova del resolver.** Passa le
  `Action.test_phrases` dell'IR al backend scelto e conta quante arrivano
  all'id giusto, distinguendo le **perse** (nessun match) dalle **sbagliate**
  (azione diversa). La distinzione è il punto: un backend che alza il richiamo
  aggiungendo errori del secondo tipo sta peggiorando la storia, e il totale da
  solo non lo direbbe. Esce con codice 1 se ci sono frasi sbagliate.
- **Vincolo architetturale, identico a quello del resolver**: il player
  non contiene logica narrativa propria. Non inventa azioni, non genera
  testo di suo, non modifica lo stato se non applicando `Effect` già
  presenti nell'IR. Se qualcosa non si può fare, è perché l'IR non lo
  prevede — ed è esattamente l'informazione che si sta cercando.
- **Riproducibilità**: poiché il resolver può solo scegliere tra azioni già
  definite, una partita è interamente descritta dalla sequenza di id di
  azione/scelta. Implementato: `--record` salva la sequenza giocata,
  `--script` la rigioca senza input umano (nel player web la stessa sequenza
  si incolla nella scheda `traccia`) (exit code diverso da 0 se la
  partita non arriva più in fondo). Le scelte di dialogo, che nello schema
  non hanno un id proprio, sono identificate dal nodo di destinazione.
- **Linter di giocabilità** (`--lint`, aggiunto costruendo il player): i
  controlli statici che la validazione di schema non può fare — `goto` verso
  id inesistenti, scene irraggiungibili, nodi di dialogo monchi o
  irraggiungibili, alberi di dialogo che nessuna azione raggiunge,
  condizioni impossibili (flag richiesto e mai impostato, oggetto richiesto e
  mai raccolto). Trova le porte chiuse a chiave; se la storia si gioca *bene*
  lo dice solo giocarla.
- **Convenzione dei finali**: una scena senza `goto_scene` in uscita è un
  finale, e lì una lista `actions` vuota è legittima (il player chiude la
  partita); la stessa situazione in una scena con un'uscita è invece il
  vicolo cieco che il player segnala come bug. È la sola regola di flusso
  che il player aggiunge, e non introduce logica narrativa: lo schema non ha
  un marcatore esplicito di finale.

## Distribuire il player

Non c'è un secondo player da costruire, e non c'è un deploy da progettare: la
build è **un unico file HTML**, e questo è già il modo di distribuirla. Si apre
da `file://`, si manda in chat, si mette su qualunque static host, e con l'IR
incorporato (`npm run embed`) una storia intera è un file che si tocca e parte.
`start_local_player.sh` fa build + embed + serve in un colpo, che è il modo di
provarla dal telefono sulla rete di casa.

Cosa resta aperto, e sono due cose diverse da «un altro player»:

- **Dove stanno gli asset quando la storia non è più in locale.** Oggi la
  convenzione è `assets/images/<id>.webp` accanto all'IR: regge una chiavetta e
  uno static host, non un catalogo di storie. È una decisione di hosting,
  rimandata.
- **Installabilità e offline.** Un manifest e un service worker
  trasformerebbero lo stesso file in qualcosa che si installa da browser
  mobile e funziona senza rete. Non cambia l'architettura: è una passata sopra
  quello che c'è già.

## Sceneggiature di riferimento per i test

- Un esempio giocattolo minimo, creato da zero per validare rapidamente lo
  schema durante lo sviluppo (una taverna, un oste, una chiave, una strada).
- Una sceneggiatura REALE fornita dall'utente ("Nel paese dei ciechi",
  adattamento da H.G. Wells) — è stata la fonte diretta delle decisioni
  `scene_type` e narrazione multi-beat: testare su materiale scritto da un
  autore vero, non solo su esempi giocattolo, ha rivelato lacune che
  l'analisi teorica da sola non aveva previsto. Buona fonte per ulteriori
  casi di test se si estende ancora lo schema.
  Compilata in `stories/nel-paese-dei-ciechi/story.ir.json` (18 scene, 8
  cutscene e 10 interattive) con `playthrough/completo.txt`, la
  partita completa dal prologo al finale: è il test di conformità dell'IR
  end-to-end, e va rigiocato quando si tocca lo schema o il player.
- Una seconda sceneggiatura REALE fornita dall'utente ("Metal Head",
  adattamento da Black Mirror 4x05) — scritta con gli **appunti di giocabilità
  dentro il documento** (`## Note di giocabilità` globali e blocchi
  `#### Giocabilità` per scena), che è la forma in cui l'autore lavora davvero.
  È la fonte delle quattro regole di game design qui sopra, di
  `initial_inventory`, e della scoperta che una scena di ritorno può non avere
  nessun blocco sorgente. Compilata in `stories/metal-head/story.ir.json` (43 scene,
  13 cutscene e 30 interattive) con due playthrough completi che finiscono
  entrambi in `finale_esterno`: `playthrough/pulito.txt` (125 passi, il
  percorso pulito) e `playthrough/giro-lungo.txt` (135 passi, il
  percorso che sbaglia tutto quello che si può sbagliare — spara da lontano,
  dimentica il nastro, fa rumore nello studio, scende in bagno senza cavo,
  infila la spina sui fili asciutti). La coppia è la verifica eseguibile della
  regola "non si perde mai, cambia solo quanto costa": stessa storia, stesso
  finale, dieci passi di differenza. Media di 4 azioni per scena, con una
  scena da 11 — il tetto, i cui appunti elencano nove cose da fare.

## Prossimi passi (nell'ordine più naturale, non vincolante)

1. Continuare a iterare sulla skill: testarla su altre sceneggiature reali
   (stili diversi da quello già provato), correggere prompt/schema quando
   emergono lacune concrete — non in astratto.
2. ~~Costruire il **player**~~ — fatto (`player/`, TypeScript: player web
   mobile-first + CLI headless sullo stesso core, modalità debug, linter,
   script di playthrough). È quello definitivo: una build sola per chi
   sviluppa, chi collauda e chi gioca.
3. ~~Implementare il resolver per input testuale libero~~ — fatto in 1.8.0
   (lessicale + embedding opzionale, verbi del player, fallback d'autore,
   `--copertura`). Resta aperto il backend **Claude**, che serve come oracolo
   di riferimento più che come modalità di gioco.
4. Arricchire gli IR esistenti con i campi di 1.8.0. Oggi solo quattro scene di
   "Metal Head" sono scritte per un player a parole, ed è deliberato: il
   rapporto di copertura mostra il salto fra una scena scritta per le chip e
   una scritta per le parole. Il resto è lavoro di compilazione, non di codice.
5. Quando le regole si saranno stabilizzate, valutare la costruzione del
   generatore ad hoc (nessuna decisione di stack ancora presa).
6. ~~Costruire il **modulo assets per le immagini**~~ — fatto
   (`assets-studio/images/`: estrazione del manifest, generatore, studio web,
   prototipazione; provider Pollinations, modelli scelti per confronto).
   ~~E la catena fino al player~~ — fatta: `publish.py`, il campo `image`
   dell'IR 1.9.0, l'approvazione nello studio e le immagini nel player web.
   Restano aperti: **guardare e approvare** le 88 immagini di "Metal Head",
   che sono generate ma quasi tutte ancora da decidere; la passata
   deterministica in pixel art; e portare al bilingue la seconda
   sceneggiatura, che ha ancora 67 prompt solo in italiano (`validate.py` li
   elenca).
7. Costruire il modulo assets per **voce e suoni**, che è il pezzo più costoso
   e non è ancora iniziato.
8. Decidere la pubblicazione/hosting degli asset (rimandato finora).
9. Decidere se rendere il player installabile e utilizzabile offline
   (manifest + service worker sopra il file che c'è già). Non è un player
   nuovo: è una passata sopra quello attuale.
