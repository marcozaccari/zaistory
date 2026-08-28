# ZAiStory Engine — decisioni architetturali

> Documento di analisi, non di implementazione: raccoglie le scelte
> architetturali prese finora e il *perché* di ciascuna, così chi riprende
> il progetto (persona o agente) può ripartire da qui senza riscoprire le
> stesse cose. Le decisioni qui sotto sono già prese e motivate: vanno
> rimesse in discussione solo se emerge un caso concreto che non coprono
> bene — è così che è nato `scene_type`, testando su materiale reale invece
> che discutendo in astratto. Regole operative per gli agenti: `AGENTS.md`. Oggi il lavoro attivo è su due fronti:
> la skill `skills/story-ir-compiler`, che applica queste regole direttamente
> in conversazione, e il player di test `player/`, che le verifica
> giocando l'IR prodotto. In futuro le stesse regole del compilatore verranno
> implementate in un generatore dedicato (non ancora iniziato, nessuna scelta
> di linguaggio/stack presa).

## Obiettivo

Motore narrativo interattivo moderno (tipo SCUMM, ma leggero): l'autore
scrive sceneggiature in markdown libero (formato ottimizzato per la
creatività, non per la macchina). Un compilatore le trasforma in un formato
IR (`story.ir.json`) giocabile e player-agnostic, che poi alimenta un modulo
di generazione asset (immagini/voce/musica) e infine uno o più player
(PWA, bot Telegram, ...) — nessuno di questi componenti deve essere
accoppiato agli altri: l'IR è il contratto che li tiene separati.

## Pipeline concettuale

```
sceneggiatura.md (libera)
    │
    ▼  COMPILATORE (oggi: skill in conversazione; domani: generatore ad hoc)
story.ir.json (formato IR, contratto stabile — engine-ir.schema.json)
    │
    ├─▶  PLAYER DI TEST (solo testo, nessun asset — `player/`)
    │      web (telefono/desktop) + CLI, stesso core; usa il RESOLVER e
    │      salta completamente il modulo assets
    │
    ▼  MODULO ASSETS (design definito, non ancora implementato in un generatore)
manifest.json + file immagini/voce/suoni generati
    │
    ▼  PLAYER (non ancora costruito)
PWA (principale) + eventuale bot Telegram (secondario, testuale)
```

## Il formato IR: decisioni chiave

Schema: `engine-ir.schema.json` (JSON Schema draft 2020-12), versione
corrente **1.7.0**. Non importa che sia retrocompatibile fintanto che siamo in fase di prototipo.

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
  Le chip del player di test sono il banco di prova, non l'interfaccia: quella
  decisa e' il resolver — testo libero in, id di un'azione gia' esistente out.
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

- **Riferimenti a scene esterne** (una scena come file separato, per storie
  molto grandi) sono previsti concettualmente ma non ancora affrontati nel
  dettaglio — oggi si lavora solo con IR a scene inline in un unico
  documento. Da riprendere se/quando servirà davvero (storie molto lunghe).
- **Resolver per input testuale libero**: discusso approfonditamente ma mai
  costruito. Design deciso: un modulo player-agnostic separato che riceve
  `(azioni disponibili nella scena, testo libero del giocatore, tono della
  scena)` e ritorna `(id di un'azione esistente, oppure nessun match con
  una narrazione di fallback in-character)`. **Il suo perimetro sono le azioni
  di scena, mai le scelte di dialogo**: quando un `dialogue_tree` e' aperto il
  player mostra un elenco e il resolver non viene nemmeno interpellato. Vincolo architetturale
  fondamentale: il resolver non deve MAI generare un effetto di sua
  iniziativa, solo scegliere quale azione già definita eseguire — altrimenti
  lo stato del gioco smette di essere deterministico/testabile. In pratica
  è l'equivalente moderno del classico "Non puoi farlo" dei punta-e-clicca,
  ma generato al volo e coerente col tono della scena invece che un
  messaggio di sistema generico.

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

## Modulo assets: decisioni di design (non ancora implementate in codice)

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
- **Provider raccomandati** (scelta suggerita in fase di analisi, non
  vincolante): fal.ai o Replicate (Flux) per le immagini, ElevenLabs per
  voce e per effetti sonori puntuali.
- **Pubblicazione/hosting degli asset**: deciso esplicitamente di rimandare
  questa scelta ("solo locale per ora, penseremo al deploy dopo") — un
  player mobile reale avrà comunque bisogno che gli asset siano raggiungibili
  via URL pubblico (storage/CDN), ma quale servizio usare non è stato deciso.

## Player di test (`player/`, costruito)

Player minimale, **puramente testuale**: nessuna risorsa grafica o audio,
nessun manifest asset. Consuma **esclusivamente `story.ir.json`** e serve a
giocare e testare una storia molto prima che esistano il modulo assets e la
PWA.

Perché serve, in una riga: è il modo più economico per scoprire che una
storia compilata *non è giocabile* (scena senza uscita, `goto` che punta a
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

Cosa si guadagna rispetto al Go, oltre al browser: la logica dell'engine non
andrà riscritta per la PWA — `player/src/core/` è già quello che la PWA
importerà. Contro consapevole: si perde il binario autonomo, e la CLI ora
richiede Node installato. Le dipendenze restano zero a runtime (TypeScript e
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
  quello che un giorno sarà immagine, suono e voce, ed è leggendoli mentre si
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
- **Modalità debug** (comando dedicato, es. `:debug`, oppure il tasto `debug`
  nel player web): mostra quello che i prompt di scena non dicono già — `id`,
  conteggi, personaggi presenti, `on_enter_flags_set` — e **tutte** le azioni
  della scena, comprese quelle
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
  1. **nessun resolver** — selezione a menu numerato. Deterministico, zero
     dipendenze, è la modalità da usare per i test di regressione. Da non
     scambiare per l'interfaccia del gioco: un menu che elenca le azioni utili
     rende ogni avventura facile, perché è il menu a risolvere gli enigmi al
     posto del giocatore. È impalcatura di collaudo, e va letto come tale anche
     quando si giudica la difficoltà di una storia compilata.
     **Implementato** (`--resolver menu`, default; nel player web le chip
     *sono* il menu).
  2. **Claude** — via API/sessione, per input testuale libero. Non ancora
     implementato: `--resolver claude` esce con un errore esplicito.
  3. **LLM/SLM locale offline** — modello piccolo eseguito in locale, per
     testare senza rete e senza costo per battuta. Non ancora implementato.
  Il backend si sceglie all'avvio; il resto del player non cambia. Motivo
  per cui i tre stanno insieme: il resolver è il pezzo più incerto del
  progetto, e il player di test è il banco di prova naturale per confrontare
  quanto bene un modello piccolo locale se la cava rispetto a Claude sullo
  stesso set di scene.
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

## Deploy del player (solo discusso, nulla costruito)

- **PWA** (target principale): installabile da browser mobile, può
  funzionare offline se gli asset sono precachati, nessun vincolo di
  formato — pensata come il player "di riferimento" più completo. Con il
  player di test passato a TypeScript, `player/src/core/` è già il pezzo che
  la PWA importerà: engine, stato, `Effect`/`Condition` e linter non vanno
  riscritti, cambia solo l'interfaccia sopra di essi.
- **Bot Telegram** (target secondario): meno adatto a un'interfaccia
  punta-e-clicca vera, ma buon secondo target proprio perché il modello di
  interazione scelto (dialoghi a scelte + azioni contestuali, non
  verbo×oggetto) si presta bene anche a un'interfaccia a bottoni inline o
  a puro testo.

## Sceneggiature di riferimento per i test

- Un esempio giocattolo minimo, creato da zero per validare rapidamente lo
  schema durante lo sviluppo (una taverna, un oste, una chiave, una strada).
- Una sceneggiatura REALE fornita dall'utente ("Nel paese dei ciechi",
  adattamento da H.G. Wells) — è stata la fonte diretta delle decisioni
  `scene_type` e narrazione multi-beat: testare su materiale scritto da un
  autore vero, non solo su esempi giocattolo, ha rivelato lacune che
  l'analisi teorica da sola non aveva previsto. Buona fonte per ulteriori
  casi di test se si estende ancora lo schema.
  Compilata in `examples/nel-paese-dei-ciechi.ir.json` (18 scene, 8 cutscene
  e 10 interattive) con `examples/nel-paese-dei-ciechi.playthrough.txt`, la
  partita completa dal prologo al finale: è il test di conformità dell'IR
  end-to-end, e va rigiocato quando si tocca lo schema o il player.
- Una seconda sceneggiatura REALE fornita dall'utente ("Metal Head",
  adattamento da Black Mirror 4x05) — scritta con gli **appunti di giocabilità
  dentro il documento** (`## Note di giocabilità` globali e blocchi
  `#### Giocabilità` per scena), che è la forma in cui l'autore lavora davvero.
  È la fonte delle quattro regole di game design qui sopra, di
  `initial_inventory`, e della scoperta che una scena di ritorno può non avere
  nessun blocco sorgente. Compilata in `examples/metalhead.ir.json` (43 scene,
  13 cutscene e 30 interattive) con due playthrough completi che finiscono
  entrambi in `finale_esterno`: `metalhead.playthrough.txt` (124 passi, il
  percorso pulito) e `metalhead.giro-lungo.playthrough.txt` (134 passi, il
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
2. ~~Costruire il **player di test**~~ — fatto (`player/`, TypeScript: player
   web mobile-first + CLI headless sullo stesso core, resolver a menu,
   modalità debug, linter, script di playthrough).
3. Implementare il resolver per input testuale libero (design già fissato
   sopra, mai implementato) — il player di test è il suo primo consumatore e il
   banco di prova per confrontare Claude e un SLM locale. È ora il prossimo
   passo naturale: l'interfaccia e il backend a menu ci sono già, manca solo
   il corpo dei due backend.
4. Quando le regole si saranno stabilizzate, valutare la costruzione del
   generatore ad hoc (nessuna decisione di stack ancora presa).
5. Decidere la pubblicazione/hosting degli asset (rimandato finora).
6. Costruire un player con asset veri (PWA prima, bot Telegram poi).
