# ZAiStory — architettura

> Documento di analisi, non di implementazione. Raccoglie le scelte
> architetturali del progetto e il *perché* di ciascuna, così chi riprende il
> lavoro — persona o agente — riparte da qui senza riscoprire le stesse cose.
>
> **`SPECS.md` viene prima.** Lì stanno i paletti; qui le conseguenze
> architetturali. Se i due divergono, è questo documento a essere sbagliato.
>
> Regole operative per gli agenti: `AGENTS.md`.

## Obiettivo

Motore narrativo interattivo moderno (tipo SCUMM, ma leggero). L'autore scrive
una sceneggiatura in markdown libero — un formato ottimizzato per la
creatività, non per la macchina. Un compilatore la trasforma in un file
**zaistory** giocabile e player-agnostic, che alimenta un modulo di generazione
asset (immagini, voce, suoni) e infine il player.

Nessuno di questi componenti è accoppiato agli altri: **il file zaistory è il
contratto che li tiene separati**.

```
sceneggiatura.md (markdown libero)
    │
    ▼  COMPILATORE (oggi: skill in conversazione; domani: generatore ad hoc)
<id>.zaistory.json (il contratto — zaistory.schema.json)
    │
    ├─▶  PLAYER (player/) — web (telefono/desktop) + CLI, stesso core
    │      testo sempre; immagini se la storia ne ha già di pubblicate
    │
    ▼  MODULO ASSETS — immagini costruito, voce e suoni ancora solo decisi
assets_manifest.json → generazione → studio (si guarda, si rifà, si approva)
    │
    ▼  PUBBLICAZIONE (publish.py)
stories/<id>/assets/images/*.webp  +  il campo `image` scritto nel file zaistory
    │
    └─▶  lo stesso PLAYER, che adesso ha le immagini da mostrare
```

Tre mestieri distinti, ed è la ragione per cui sono tre pezzi e non uno:

1. **Da bozza a storia definitiva.** Un consulente sceneggiatore che aiuta a
   completare una sceneggiatura anche solo abbozzata. Basta una skill, e si può
   non usarla.
2. **Da storia statica a giocabile.** Un puzzle designer e narrative designer
   che, iterando con l'autore, converte il testo in un file giocabile: enigmi,
   meccanismi di sblocco, oggetti, stile delle varianti nei dialoghi.
3. **Un player che la fa girare.** Non inventa niente della storia: la gioca
   secondo i meccanismi, i flag e le varianti che trova nel file.

**Il player è quello, ed è definitivo.** Non è un banco di prova in attesa di un
prodotto vero: la stessa build si apre da `file://`, si manda in chat, si mette
su qualunque static host, e serve tutti e tre i suoi pubblici — chi sviluppa il
motore, chi collauda una storia, chi la gioca e basta. La differenza fra loro
non è un'applicazione diversa ma **un interruttore**: il debug accende la
diagnostica, e spento non ne resta traccia. Tenerne uno solo è anche ciò che
garantisce che quello che il tester prova sia esattamente quello che il
giocatore riceverà.

## Convenzioni del progetto

### Lingua

- **Il codice è in inglese**: nomi di file, identificatori, tipi, funzioni,
  costanti, campi dello schema, messaggi di commit.
- **Documentazione, istruzioni della skill e contenuti narrativi sono in
  italiano**: questo documento, `SPECS.md`, `AGENTS.md`, i README, la skill del
  compilatore, e ogni riga che il giocatore legge.

Il confine è quello fra la macchina e il lettore, e passa dentro i file: un
commento italiano sopra una funzione inglese va bene, un identificatore
italiano no.

**Il vocabolario che il parser riconosce è un caso a parte, ed è italiano.** Le
famiglie di verbi — *guarda, osserva, scruta…* / *usa, prendi, infila…* /
*parla, chiedi, minaccia…* / *vai, esci, entra…* — non sono codice: sono **dati
di lingua**, e per una storia italiana devono essere italiani. Vivono nel player
e non nel file zaistory perché le famiglie valgono per ogni storia e distinguerle
è questione di italiano, non di narrativa. La conseguenza da tenere presente:
quella tabella va indicizzata per lingua e scelta in base al campo `language`
della storia, non incisa nel codice come se ne esistesse una sola. Il modulo che
la contiene ha un nome inglese e un contenuto italiano, e non c'è niente di
strano — è un dizionario.

### Una storia è una cartella

```
stories/<id>/
  <id>.zaistory.json     il file giocabile: il contratto, l'unica cosa che il player legge
  sceneggiatura.md       il markdown libero da cui è stato compilato
  playthrough/           partite di riferimento, rigiocabili dalla CLI
  assets/images/         le immagini pubblicate, WebP, una per id
  _work/                 il banco di lavoro del generatore — non versionato
  play.html              il player con la storia dentro — prodotto della build, non versionato
```

**Una storia si sposta, si archivia e si manda in blocco.** La disposizione
precedente teneva il file giocabile, la sceneggiatura e le immagini in tre posti
da allineare a mano, e il legame fra loro viveva solo nella testa di chi
lanciava i comandi.

**Il banco di lavoro sta dentro la storia ma fuori da git.** `_work/` contiene
per costruzione anche gli scarti — versioni precedenti, grezzi non ritagliati,
miniature, sidecar — e pesa dieci volte quello che va pubblicato (78 MB contro
6,7 MB sulla storia di riferimento). Dentro la storia perché è di *quella*
storia; fuori da git perché si rigenera, e versionare i tentativi rende il
repository ingiocabile da clonare.

**`assets/images/<id>.<ext>` è una convenzione, non un indice.** Nessun file di
mappatura fra id e percorso: il player compone il percorso dall'id. Un indice
sarebbe un secondo contratto da tenere allineato al primo, e la prima volta che
i due divergono si passa un pomeriggio a capire quale dei due mente.

### Il nome del file giocabile

`<id>.zaistory.json`, dove `<id>` è l'id della storia. Non è un formato
intermedio: è il prodotto finale, quello che si gioca, e il nome lo dice.

- **Il campo `id` dentro il file è la verità, il nome del file deve
  combaciare.** Sono due posti che dicono la stessa cosa, ed è il tipo di coppia
  che diverge al primo `mv`: il linter lo verifica.
- **Una cartella, esattamente un `*.zaistory.json`.** Gli script cercano per
  glob: zero file o due file sono un errore, non un caso da gestire.
- Schema: `zaistory.schema.json`. Versione del formato: campo
  `zaistory_version`, **1.0.0**.

## Il formato zaistory

JSON Schema draft 2020-12. Il formato è il contratto fra compilatore, modulo
assets e player, ed è l'unico punto del progetto in cui una modifica si paga
ovunque.

### La gerarchia

```
Story
├─ entità globali: characters[], items[], carry_flags[]
├─ cover, player_voice, global_style, protagonist, failure_mode
└─ acts[]
   └─ Act:  start_place, flags[], reads/writes_carry_flags[], places[]
      └─ Place:  same_as?, exits[], objects[], actions[], phases[]  ← IL NODO
         └─ Phase: look, actions[], dialogue, …            ← L'UNITÀ DI AUTORAGGIO
```

L'atto **non ha un campo di chiusura**, ed è una scelta: si chiude quando il
giocatore prende un'uscita che porta a un luogo di un altro atto, e quell'uscita
porta sopra di sé gli `has_item` degli oggetti richiesti a valle. Il linter la
riconosce dalla struttura. Un campo `close` sarebbe una seconda verità sullo
stesso fatto, cioè la cosa che questo progetto evita ovunque — e a differenza
della struttura, potrebbe mentire.

Due decisioni dentro questa forma, e sono quelle da cui discende tutto il resto.

**Il luogo è il nodo del grafo di gioco.** Non la scena. Il giocatore si muove
fra luoghi, e un luogo deve saper rispondere «come sono adesso» per ogni stato
raggiungibile della partita. Se il nodo fosse la scena, quella risposta
diventerebbe una tabella condizionale scritta a mano per ogni posto — un router
— e ogni stato dello stesso luogo ripeterebbe la sua scenografia, i suoi
oggetti e le sue uscite. Con il ritorno libero fra ambienti (vedi *Regole di
gioco*) quel router smetterebbe di essere un dettaglio e diventerebbe la
struttura portante, scritta due volte.

**La fase resta l'unità di autoraggio.** L'autore scrive scene, non schede di
ambiente: «INT. MAGAZZINO – NOTTE» è come si scrive una sceneggiatura, e la
segmentazione del sorgente resta per scene. Il compilatore le aggancia a un
luogo e le ordina in fasi. Il lavoro di aggregazione è un passo di
compilazione, non una struttura da mantenere a mano.

### Entità globali

Una sola lista per identità, sempre. È lo stesso errore corretto tre volte —
parlanti fuori dalla roster, luoghi senza anagrafica, oggetti come id nudi — e
la stessa correzione: due elenchi paralleli degli stessi id sono una fabbrica di
derive.

- **`characters[]`** — chiunque parli, anche una voce fuori campo con una sola
  battuta. La roster è l'elenco dei *parlanti*, non dei personaggi importanti:
  la voce si assegna una volta per parlante, e un parlante che esiste solo come
  stringa in `speaker` non ha niente a cui agganciare quell'assegnazione. Porta
  `id`, `name`, `aliases`, `description`, `visual_prompt`, `voice`.
- **`items[]`** — gli oggetti d'inventario, con la stessa anagrafica:
  `description` e `description_variants` comprese.
- **`protagonist`** — il personaggio giocante sta in `characters` come tutti,
  ma a «chi c'è qui» non va elencato: è chi sta chiedendo.

**Un oggetto che cambia stato è un altro oggetto.** Un walkie messo in carica
non è il walkie scarico con una descrizione diversa: è `walkie_carico`, con il
suo id, il suo nome, la sua descrizione e la sua immagine. La trasformazione si
scrive con quello che c'è già — un effetto che fa `remove_inventory` e
`add_inventory` nella stessa mossa — e non richiede nessuna primitiva nuova.

La regola in una riga: **se cambia l'oggetto, cambia l'id; se cambia ciò che il
giocatore sa dell'oggetto, cambia la variante.** Una lettera che hai letto è la
stessa lettera, e la sua `description_variants` dice che adesso ne conosci il
contenuto; un walkie sotto carica è un'altra cosa.

Quattro ragioni, e la quarta è quella che decide:

1. **Le condizioni restano atomiche.** `has_item: walkie_carico` contro
   `has_item: walkie` **+** `flag_present: walkie_in_carica`: nella seconda
   forma, dimenticare metà della coppia è un errore che il linter fatica a
   vedere.
2. **Un'immagine per id.** Un oggetto che cambia stato cambia anche icona, e la
   strada delle varianti chiederebbe una generazione condizionata per oggetto —
   la stessa complessità delle varianti d'ancora dei personaggi, che è il punto
   più delicato dell'estrattore. Le immagini da pagare sono le stesse; cambia
   quanto è complicato produrle.
3. **Niente costrutti nuovi.** Le varianti condizionali servirebbero anche per
   l'immagine, cioè un campo in più nel contratto per un caso che le primitive
   esistenti già coprono.
4. **I flag sono locali all'atto, gli oggetti no.** Con le varianti, il walkie
   attraverserebbe il confine d'atto ma la sua carica no: lo stato starebbe in un
   flag, e i flag muoiono con l'atto. Salvarlo costerebbe uno dei tre
   `carry_flags`, cioè spendere il canale del tono per della logica — esattamente
   ciò che quella regola vieta. Con due id, il walkie carico attraversa da solo
   perché è un oggetto.

Dove questa scelta costa: un oggetto con due assi di stato indipendenti
(acceso/spento *e* integro/rotto) diventa quattro id. È raro, ed è quasi sempre
il sintomo che gli oggetti sono due. Da tenere d'occhio invece una condizione che
debba valere per «l'oggetto in qualunque forma»: se ricapita spesso, il rimedio è
un `any_of` sulla condizione, non una famiglia di oggetti.

Sembra in contraddizione con i luoghi, dove lo stato si esprime con le fasi
invece che con un secondo luogo, e non lo è: un luogo è un contenitore in cui si
torna, con dentro molte cose che cambiano indipendentemente, e non si può
scambiare; un oggetto è atomico, e l'engine ha già la primitiva che esprime la
sostituzione.

Le fasi possono fare override locali di aspetto e voce. Quello che non possono
fare è essere l'unico posto dove un'entità esiste.

### L'atto

Un atto è un contenitore autonomo di luoghi. Non è un'etichetta narrativa: porta
tre regole verificabili.

- **I flag sono locali all'atto.** Una condizione che nomina un flag di un altro
  atto è un errore. Il guadagno non è di ordine ma di verificabilità: lo spazio
  di stato di un atto è piccolo e chiuso, quindi il linter può esplorarlo
  davvero, mentre su una storia a flag globali (68, sulla storia di riferimento)
  nessuna verifica di raggiungibilità è possibile.
- **L'unica cosa che attraversa il confine è l'inventario.** Da cui la regola di
  SPECS: un atto non si può chiudere se prima non si sono raccolti o usati tutti
  gli oggetti necessari a valle, altrimenti si crea il blocco logico «non posso
  usare ciò che non ho preso, e non posso tornare indietro a prenderlo». Si
  applica condizionando l'uscita che chiude l'atto agli oggetti richiesti
  (`has_item`), non con un meccanismo dedicato: così la scelta di prendere una
  cosa resta al giocatore e la possibilità di finire la storia resta garantita.
- **La verifica si decompone.** Ogni atto si verifica in isolamento, e fra un
  atto e il successivo si verifica solo la catena degli inventari.

**Le condizioni si compongono.** `all_of` e `any_of` esistono per due casi che i
campi semplici non sanno dire, e sono tutti e due reali: **due oggetti sulla
stessa porta** — `has_item` ne porta uno solo, e chiedere il secondo un'uscita
più in là non sempre si può — e **l'oggetto in una qualunque delle sue forme**,
che è il rovescio della regola per cui un oggetto che cambia stato è un altro
oggetto: una porta che va bene con il walkie scarico come con quello carico li
elenca entrambi invece di far scegliere a chi compila. Si possono annidare, ma
se serve annidare più di un livello quasi sempre la condizione sta dicendo una
cosa che andava detta con un flag.

**`carry_flags[]` — l'eccezione, con un tetto duro.** Se un atto deve ricordare
qualcosa del precedente che non sia un oggetto, si dichiara un carry flag a
livello di storia. **Massimo 3.**

- Doppia dichiarazione obbligatoria: chi lo scrive lo dichiara, e ogni atto
  dichiara quali legge. Un carry flag mai letto da nessun atto successivo è un
  **errore**, non un avviso: la memoria morta è il primo sintomo di un canale
  che si sta riempiendo per inerzia.
- **Un atto deve essere completabile per ogni combinazione dei carry flag che
  legge.** I flag portati cambiano *cosa dice* la storia, mai *se* si arriva
  alla fine. Con tre flag sono otto combinazioni: la verifica resta esaustiva.
- In una riga: i carry flag sono un canale per il **tono**, non per la logica.
  Se serve che aprano una porta, quella porta va aperta da un oggetto.

### Il luogo

Il nodo di gioco. Porta l'identità (`id`, `name`, `aliases`, `visual_prompt`),
le **uscite**, gli **oggetti d'ambiente** e le **fasi**.

Il `visual_prompt` di un luogo descrive il posto; l'`image_prompt` di chi lo
referenzia descrive l'inquadratura. Sono due cose diverse e non vanno mescolate.

**Gli oggetti d'ambiente** sono l'entità che rende applicabile la regola di
SPECS «tutto ciò con cui si interagisce deve essere osservabile». Hanno nome,
alias, descrizione, condizione di presenza, e vivono nel luogo perché è il luogo
a contenerli — le fasi cambiano cosa ci si può fare, non se esistono. Sono anche
il posto giusto per la scenografia **non** interagibile: un oggetto descritto e
senza azioni migliora la giocabilità e non costa niente al motore.

**Le azioni stanno in due posti, e la divisione è la stessa degli oggetti.** Sul
**luogo** i gesti che valgono finché il posto è quel posto — accendere qualcosa
al camino, guardare gli scaffali; sulla **fase** quelli che hanno senso solo in
quello stato. Le due liste si sommano.

Non è simmetria per gusto: senza le azioni di luogo, un gesto necessario che vive
in una fase sola **sparisce quando lo stato cambia la fase**, e la storia resta
senza soluzione. È un vicolo cieco che non si vede leggendo — l'azione esiste,
l'oggetto esiste, la condizione è soddisfacibile — e si scopre solo giocando, un
atto più in là. È lo stesso difetto che il modello a scene aveva con le scene, e
la ragione per cui gli oggetti d'ambiente erano già stati messi sul luogo: *le
fasi cambiano cosa si può fare, non cosa esiste*.

**La stessa stanza in due atti si dichiara con `same_as`.** I luoghi vivono
dentro gli atti, le stanze no: il soggiorno dell'atto della villa e quello
dell'atto del finale sono due nodi di due grafi diversi, e la stessa stanza. Il
campo tiene separate le due cose che qui divergono — l'**identità di gioco**,
che è per atto, e l'**identità visiva**, che è del posto: il modulo assets non
genera una seconda ancora, e la pubblicazione scrive lo stesso id d'immagine in
tutti e due. Senza, la stessa stanza verrebbe disegnata due volte e le due
versioni divergerebbero alla prima rigenerazione. Due nodi *dello stesso atto*
che sono lo stesso posto invece non sono due luoghi: sono un luogo con due fasi,
e il linter lo dice.

**Accessibilità e completamento.** Un luogo può diventare inaccessibile per
cambio di stato; quando tutti gli ambienti di un atto sono completati, l'atto si
chiude e si passa al prossimo.

### La fase

L'unità di autoraggio, ex scena. Le fasi di un luogo si valutano in ordine e
vale la prima la cui condizione è soddisfatta.

Una fase porta: `background` (l'inquadratura), `look` e `look_variants`, il
tono, i personaggi presenti, la narrazione d'ingresso, le azioni, l'eventuale
albero di dialogo e i fallback locali.

`kind` distingue **interattiva** da **cutscene**. Una cutscene è una sequenza di
puro montaggio narrato — voce fuori campo su più inquadrature, zero scelte
reali — con `narration[]` multi-beat e una sola uscita: non va forzata nel
modello «stanza con azioni».

Nota di segmentazione, che è dove si sbaglia più spesso: un capitolo o una
"SEQUENZA" della sceneggiatura **non** è automaticamente una fase del gioco. La
segmentazione si fa in base alla giocabilità — dove comincia davvero
l'interattività — non alla struttura editoriale del documento sorgente.

### Dove finisce una scena della sceneggiatura

L'autore scrive scene, il gioco è fatto di luoghi e fasi, e i due elenchi non
hanno la stessa lunghezza. Il rapporto **non è uno a uno in nessuna delle due
direzioni**, ed è la prima cosa da avere chiara aprendo un sorgente.

La regola generale, in una riga: **il luogo lo determina l'ambientazione, la fase
lo determina lo stato.** Tutte le scene che accadono nello stesso posto
confluiscono in un luogo solo; quante fasi ne nascono dipende da quante volte
cambia ciò che lì si può fare, non da quante volte l'autore ha battuto
un'intestazione di scena.

| nella sceneggiatura | dove finisce |
|---|---|
| prima scena in un posto mai visto | crea il **luogo** — identità, aspetto, uscite, oggetti d'ambiente — e la sua prima **fase** |
| scena successiva nello stesso posto, dopo un cambio di stato | una **fase in più** dello stesso luogo |
| scena di ritorno in un posto già visto | **nessun luogo nuovo**: una fase se cambia cosa si può fare, altrimenti solo delle `look_variants` |
| scena tutta parlato, in un posto già stabilito | un **dialogo** agganciato a un'azione `parla`, non una fase |
| montaggio narrato dentro un posto | una **fase cutscene** |
| scena che è puro passaggio da un posto a un altro | una **cutscene di transizione** sull'uscita, non un luogo |
| scena che descrive un ambiente e basta | **niente fase**: diventa `look`, oggetti d'ambiente, inquadratura del luogo |
| ultima scena di un atto | la **transizione condizionata** che chiude l'atto |
| didascalie fra le battute | `narration`, o l'effetto di una scelta |
| battute | nodi del dialogo |

Tre casi che sembrano eccezioni e sono la regola vista da un altro lato:

- **Una scena può diventare due fasi.** Se a metà scena succede qualcosa che
  cambia cosa si può fare lì — arriva qualcuno, si apre una porta — il confine di
  fase sta dentro la scena, non ai suoi estremi.
- **Una scena può diventare due luoghi.** Un autore taglia dentro la scena: se
  l'ambientazione cambia, cambia il luogo, qualunque cosa dica l'intestazione.
- **Una fase può non avere nessuna scena sorgente.** È il caso più facile da
  sbagliare, ed è normale: l'autore scrive il magazzino la prima volta e dà per
  scontato che tornandoci sia diverso, senza scriverne la versione «dopo».
  Quella fase la deve comporre il compilatore, con il testo che serve a chi ci
  torna — e senza inventare scenario che nella storia non esiste.

Il confine di fase, detto in positivo: **si apre una fase nuova quando cambia
cosa si può fare o cosa si vede** nel luogo. Se cambia solo *ciò che il giocatore
sa*, non serve una fase: bastano una variante di `look` o una variante di
battuta. È la stessa linea di taglio che separa un oggetto nuovo da una variante
di descrizione.

### Interattività: i quattro verbi

Il giocatore agisce con ciò che lo circonda in quattro soli modi: **guarda**
(percepisci), **usa** (manipola), **parla** (comunica), **vai** (muoviti). Sono
i quattro di SPECS, e sono le quattro famiglie che la tabella del player
riconosce quando qualcuno scrive una riga.

**Un macro verbo non è un campo del file**, ed è utile vedere subito dove
ciascuno dei quattro va a finire quando la storia si scrive:

| macro verbo | con un complemento | da solo |
|---|---|---|
| **guarda** | `Action` con `verb: look` | il `look` della fase — nessuna azione |
| **usa** | `Action` con `verb: use` | non ammesso |
| **parla** | `Action` con `verb: talk` | l'unico interlocutore, se ce n'è uno solo |
| **vai** | un'`Exit` del luogo | l'elenco delle uscite conosciute, o l'unica |

Che `vai` non abbia una casella in `Action.verb` non lo rende meno di un verbo,
esattamente come non lo è `guarda` da solo, che pure non è un'azione. Muoversi è
l'unico dei quattro che **agisce sul grafo invece che dentro il nodo**, e per
questo ha bisogno di cose che un'azione non saprebbe portare: sapere se un
passaggio è *conosciuto* oltre che *accessibile*, avere una cutscene
direzionale, dire dove porta a una mappa. In cambio dà la cosa che tiene in
piedi tutto il resto: **il grafo si legge in un posto solo**, e il linter può
camminarci sopra per dire se la storia si chiude. Spostamenti nascosti dentro
gli effetti non li vedrebbe.

Il caso che mette alla prova la distinzione è **salire su un albero**: si dice
con un verbo di movimento e non cambia nodo. Non chiede un `Action.verb` in più,
chiede la regola che c'era già — *il complemento decide* — letta anche al
contrario: l'albero non è un passaggio, quindi la frase non è un movimento.

Un'azione è quindi una tripletta `(verb, target, target2?)` con la sua
condizione e il suo effetto — non un'etichetta con una lista di parafrasi.

**La conseguenza più importante è dove vivono gli alias.** Non sulle azioni:
sulle **entità**. Il verbo lo riconosce una tabella che sta nel player ed è
uguale per ogni storia, perché le tre famiglie sono italiano, non narrativa. Il
compilatore scrive gli alias di personaggi, oggetti d'ambiente, oggetti
d'inventario e luoghi — cioè l'anagrafica delle cose — e da lì la copertura
lessicale si compone per moltiplicazione invece che per enumerazione. Il file
giocabile si accorcia e diventa più regolare.

Le regole grammaticali, da SPECS:

| verbo | da solo | complementi |
|---|---|---|
| **guarda** | descrizione dell'ambiente (`look`) | uno; se ce n'è più di uno vale il primo |
| **usa** | non ammesso, serve almeno un complemento | fino a due: *usa X con Y*, *dai X a Y* |
| **parla** | ammesso se c'è un solo interlocutore o un solo dialogo | uno; se ce n'è più di uno vale il primo |
| **vai** | ammesso: con una sola destinazione ci si va, altrimenti si apre l'elenco | uno, ed è il complemento a decidere se è un passaggio o una cosa della stanza |

L'ultima riga è quella che ha richiesto più tempo per essere scritta giusta, e
si legge in tutti e due i versi: se il complemento è un passaggio si va, e **se
nessun passaggio risponde a quel complemento la frase non è un movimento**.

Il compilatore **non scrive un'azione per ogni coppia (verbo, oggetto)**: scrive
quelle che fanno qualcosa. Tutte le altre le copre il rifiuto contestuale, che è
comunque testo d'autore ed è attaccato all'entità.

**Il budget non è più «3-6 azioni per fase».** Con verbo×oggetto le
combinazioni possibili esplodono ma quasi nessuna va scritta, e l'unica cosa che
il giocatore conta davvero sono le **entità interagibili per luogo**. Il tetto è
un **parametro chiesto in compilazione**, non una costante del compilatore:
protegge dalle stanze-elenco quando è il compilatore a inventare, e non ha
nessun titolo per correggere un autore che ha già deciso quante cose ci sono in
una stanza.

### Il movimento: uscite e mappa

Il quarto gesto — *vai, esci, entra, sali, scendi, corri, scappa, torna,
attraversa, mappa…* — è di natura diversa dagli altri tre: guarda, usa e parla
agiscono sulle entità dentro il nodo corrente, `vai` agisce sul grafo dei nodi.
Per il giocatore è un verbo come gli altri; per il motore è l'unico che cambia
il posto da cui si guarda, e tenerlo separato evita che la navigazione finisca
dispersa dentro gli effetti.

- **La disambiguazione la fa il complemento, non il verbo.** «esci», «entra»,
  «apri la porta», «scendi» sono ambigui per costruzione. Il parser risolve
  prima il complemento: se è un luogo o un'uscita è *vai*, se è un oggetto è
  *usa*. Così «usa la porta» e «vai alla porta» convergono senza mantenere due
  elenchi di sinonimi che si contendono le stesse parole. La regola si legge
  anche al contrario, ed è la metà che si scopre solo compilando: **se nessun
  passaggio risponde a quel complemento, la frase non è un movimento** — «sali
  sull'albero» in un bosco è l'unica cosa che quella frase può voler dire, e il
  verbo torna a non dire niente su quale dei tre gesti sia.
- **Il verbo singolo agisce se la scelta è unica, altrimenti mostra l'elenco.**
  Una regola sola per due verbi: vale per `parla` (SPECS) e identica per
  `vai`/`esci`. Con un'uscita sola si parte; con più di una si apre l'elenco dei
  luoghi.
- **La mappa è un bottone accanto al campo di input**, ed è la scorciatoia che
  salta la digitazione di `vai`. Ci si muove a scelte come si parla a scelte, e
  per la stessa ragione: nel movimento l'elenco non è la soluzione. Andare da
  qualche parte non è mai l'enigma — l'enigma è ciò che apre l'uscita.
- **Il parser continua ad accettare il movimento a parole** anche se
  l'interfaccia ufficiale è il bottone. Se «vai al magazzino» rispondesse «non
  capisco», il giocatore avrebbe scritto la cosa più naturale del mondo e il
  gioco avrebbe fatto finta di non essere un gioco. Dove il parser non ce la fa,
  il fallback è contestuale e utile: rimanda alla mappa.
- **Due stati per uscita: conosciuta e accessibile.** Si elencano solo le
  conosciute. Il secondo stato serve comunque per i luoghi completati o chiusi.
- **Un luogo si scopre dal testo, non dalla mappa.** La mappa ricorda ciò che si
  è trovato, non lo annuncia — altrimenti aprire il pannello e vedere comparire
  un posto nuovo è una soluzione regalata. La scoperta è un effetto d'autore.
- **Niente coordinate.** Una mappa cartografica richiederebbe un layout
  disegnato a mano per ogni storia: un concetto in più nel formato e un lavoro
  d'autore senza ritorno. È una griglia di luoghi conosciuti, raggruppata per
  atto, con lo stato in evidenza, e le miniature sono le immagini dei luoghi già
  pubblicate. **Una destinazione la si riconosce dalla figura prima che dal
  nome**, quindi la figura si cerca per tre strade in ordine di quanto sono *del
  luogo*: la sua ancora, quella del luogo che gli è fisicamente identico
  (`same_as`), e la prima inquadratura di base dichiarata fra le sue fasi.
  L'ancora è facoltativa e su una storia vera la scrivono meno della metà dei
  luoghi: una mappa in cui una destinazione su tre ha la figura e le altre no si
  legge peggio di una senza figure affatto. Dove non c'è niente da mostrare —
  nessun id, o immagini spente — resta il solo testo, e il riquadro si stringe
  invece di lasciare un buco.
- **La mappa dice anche dove si è**, per prima e spenta: non è una destinazione
  e non si tocca, ma una mappa che mostra solo le strade e non il punto da cui
  partono chiede di ricordarselo, ed è l'unica cosa che chi la apre sa già.
- **Nel debug si vede di più**: anche i luoghi sconosciuti e gli inaccessibili,
  spenti. Stesso criterio delle facce del cast — al giocatore niente
  anticipazioni, a chi ispeziona la dichiarazione completa.

**Cutscene di passaggio.** Una transizione può portare una cutscene, e serve al
ritmo. Quattro regole, perché con il ritorno libero una transizione si attraversa
molte volte:

1. Appartengono alla **transizione**, non al luogo — alla coppia (da → a).
2. Sono **direzionali**: calarsi nel pozzo e risalirne non sono la stessa
   sequenza, e spesso solo una delle due merita una cutscene.
3. **Si vedono una volta sola, per default.** Con un `replay` esplicito per le
   rare che vanno riviste sempre.
4. **Possono variare per stato**: la prima volta che si scende in cantina è una
   scoperta, la quinta è una scala.

La transizione condizionata è anche il posto naturale del **punto di non
ritorno**: l'uscita che chiude l'atto è una transizione con `has_item` sopra e
una cutscene di chiusura.

### Dialoghi

**Si agisce a parole, si parla a scelte.** L'input libero vale per osservazioni,
manipolazioni e movimento, e **non entra mai in un dialogo**: una conversazione
si gioca a scelte esplicite, come nelle avventure grafiche classiche. Non è una
limitazione tecnica: nel parlato l'elenco delle battute *è* il piacere, e far
indovinare al giocatore la formula giusta per dire una cosa che il suo
personaggio saprebbe dire è frustrazione senza guadagno.

Entrare in un dialogo è invece un'azione come le altre e passa dal parser —
«parla con il ragazzo» deve arrivare a `tommy` — ed è per questo che gli alias
stanno sui personaggi. Da lì in poi si tocca e basta.

Conseguenza sulla compilazione, più importante del meccanismo: **il dialogo è
l'unico posto dove l'elenco si vede**, quindi nel dialogo non si nasconde niente
che il giocatore debba scoprire da solo. Gli enigmi stanno nelle azioni e nel
testo; il parlato caratterizza, informa e fa scegliere.

Due regole di forma:

- **Dialoghi a grafo, non sequenze lineari.** Ramificazioni e riconvergenze, con
  percorsi che si aprono e si richiudono in base allo stato.
- **Più varianti per la stessa battuta**, soprattutto dove l'azione di dialogo si
  ripete.

**Le didascalie dentro un dialogo sono prosa, non una voce fuori campo.** Fra due
battute c'è quasi sempre una riga che dice cosa succede mentre si parla. Il
player la impagina come prosa e non ci mette nessun nome davanti: «Narratore:»
inventerebbe una voce fuori campo che nella scena non c'è, e in modalità ascolto
la farebbe pure recitare a ogni riga. È una decisione e non un dettaglio perché
un dialogo a cui il compilatore ha tolto le didascalie si gioca benissimo e non
se ne accorge nessuno finché non lo si legge: il linter lo controlla come
rapporto (meno di una descrizione ogni sei nodi, su dialoghi di almeno quattro).

### La prosa si scrive in compilazione, non a runtime

È la decisione più importante del progetto, e non riguarda il resolver: riguarda
dove sta l'intelligenza.

Il resolver **non genera testo**: sceglie un id fra candidate note in anticipo.
È ranking su insieme chiuso, non generazione, ed è la classe di problemi dove un
modello generativo è lo strumento più costoso e meno affidabile disponibile. Da
qui due mosse simmetriche, che sono la stessa mossa:

- **La comprensione si precalcola.** Gli alias che il compilatore scrive per
  ogni entità *sono* la conoscenza semantica di quell'entità, congelata dentro
  il file. Un matcher lessicale che li confronta con la frase del giocatore sta
  facendo semantica: la fa per lookup invece che per geometria, ma il lavoro del
  modello l'ha già fatto il compilatore.
- **La prosa si prescrive.** Un player a parole deve rispondere anche quando non
  capisce, e deve rispondere in tono. Da cui `blocked_narration` sulle azioni
  condizionate, `no_match_narration` per intenzione, `look_variants`, le
  descrizioni delle entità e `player_voice` per le risposte globali.

**Perché non generare a runtime**, che sarebbe la strada ovvia: due motivi, e il
secondo pesa più del primo.

1. Sotto il miliardo di parametri l'italiano con un tono è fuori portata: si
   scambia ripetizione curata con novità mediocre, che è uno scambio in perdita.
   Sopra, servono rete e costo per battuta.
2. **Un testo generato inventa scenario che nel gioco non esiste.** Un `look`
   che nomina una lampada assente non è colore, è un falso indizio su cui il
   giocatore perde dieci minuti: in un'avventura a enigmi lo scenario inventato è
   attivamente distruttivo. E soprattutto il testo scritto in compilazione **è
   controllabile da un linter**, quello generato a runtime non lo è da nessuno.
   Il compile-time è l'unico posto dove un modello può produrre prosa che
   qualcuno può ancora verificare.

La varietà non si perde: viene dalla combinatoria su testo d'autore. Le famiglie
di intenzione — percezione, manipolazione, comunicazione, movimento, generico —
con più di una frase ciascuna, scelte a rotazione. Il giocatore non distingue
questo da un modello: distingue solo quando la risposta è fuori bersaglio o
quando il ciclo è corto.

**Corollario che vale più dei campi: niente si scopre da un elemento di
interfaccia.** Non da una label, non da una chip, non dalla mappa. Tutto ciò che
il giocatore deve trovare va nominato nel testo che legge — narrazione, `look`,
l'esito di un'altra azione. La difficoltà deve venire da cosa il testo dice e non
dice, mai da un menu che si accorcia.

**E il player non inventa nemmeno il fallback**: lo sceglie fra quelli scritti.
Dove non c'è niente e non c'è nemmeno un generico, tace e lo segnala come
diagnostica sotto debug. Un buco nel file deve vedersi come un buco.

### Immagini, voce, suoni: cosa ne sa il formato

- **Il formato non nomina mai un generatore.** Solo prompt testuali e tag di
  mood: mai un provider, un modello, un id di voce o i suoi parametri. La mappa
  `entità → generatore` vive in un file separato gestito dal modulo assets.
  Cambiare provider TTS o modello di immagini non deve toccare il contratto.
- **La coerenza visiva si ottiene con ancore, non con il contesto.** I volti
  devono restare gli stessi lungo decine di immagini e i luoghi fra un ritorno e
  l'altro. Generare l'immagine N avendo in contesto la N−1 renderebbe la
  generazione ordine-dipendente, non riproducibile, non parallelizzabile, e
  farebbe accumulare la deriva. Si fissa un riferimento **una volta per entità**,
  poi ogni immagine si genera in modo indipendente condizionata su quei
  riferimenti — la stessa strada già adottata per la voce.
- Perché funzioni, il formato deve dire *a quali entità* un'inquadratura si
  riferisce: **`place`** e **`characters_in_frame`** su ogni inquadratura.
  `characters_in_frame` dice chi si **vede**, e non è l'elenco dei presenti: una
  camera buia in cui parlano tre anziani ha tre presenti e nessuno inquadrato, e
  una voce oltre il muro è presente e fuori campo. Condizionare su tutti i
  presenti peggiora l'immagine quanto non condizionare affatto.
- **Le ancore si indicizzano per identità** (`nunez`), le singole generazioni per
  contenuto. Legare il ritratto all'hash del suo `visual_prompt` significa
  cambiare la faccia in tutta la storia appena una ricompilazione ne cambia due
  parole.
- **Prompt in inglese, formato bilingue.** I modelli sono addestrati in inglese e
  un prompt italiano perde aderenza — misurato: uno style suffix in coda a un
  prompt italiano lungo può essere ignorato in blocco. Il file porta quindi i
  campi `*_en` accanto a quelli italiani, che restano canonici perché sono quelli
  che il player mostra in modalità solo testo. È una decisione di formato, non di
  pipeline.
- **Il campo `image` non lo scrive il compilatore.** È l'id di un'immagine già
  prodotta e approvata, e lo scrive la pubblicazione del modulo assets. Un file
  appena compilato non ne ha nessuno, ed è giusto così.
- **La copertina (`cover`) è un `Background`, non un tipo nuovo.**
  Un'inquadratura è un'inquadratura a qualunque scala, e condividere la
  definizione significa portarsi dietro `place` e `characters_in_frame` senza una
  seconda strada da tenere allineata. Non è l'inquadratura della prima scena:
  quella dice *dove si comincia*, la copertina dice *di cosa parla la storia*.
  Limiti pratici (nelle istruzioni del compilatore, non nello schema): al massimo
  quattro riferimenti in tutto, il luogo compreso, perché oltre quella soglia i
  modelli mediano fra i soggetti invece di tenerli distinti; e niente testo dentro
  l'immagine, perché il titolo lo scrive il player.

### Vincoli del contratto

- **Niente proprietà non previste, in nessun oggetto** (`additionalProperties:
  false` ovunque). È una rete di sicurezza contro le allucinazioni del
  compilatore: un campo plausibile ma non previsto va scartato e corretto, non
  accettato in silenzio. Qualunque implementazione futura deve applicare questo
  controllo prima di considerare valido un output.
- **`generated_by`: la provenienza sta nel file, il binding no.** Quale
  compilatore, in che versione, con quale modello. Il compilatore non è
  deterministico fra sessioni, quindi riaprendo una storia mesi dopo la prima
  domanda è *con cosa è stata fatta*. Non contraddice la regola sui generatori:
  lì si parla del binding agli asset, qui della firma di chi ha scritto il
  documento — e nessun consumatore può cambiare comportamento leggendo
  `generated_by`. Il `model` va **omesso** quando non è determinabile con
  certezza: una provenienza inventata è peggio di una assente.
- **Nessun costrutto temporale.** Nessun campo di durata, nessun effetto
  ritardato, nessuna transizione automatica. È il corollario tecnico che rende
  verificabile la regola «il tempo non esiste» (sotto).
- **Niente retrocompatibilità.** Siamo in prototipo: quando il formato cambia, le
  storie si ricompilano. Un solo schema copre tutto, e il player non contiene una
  riga il cui unico scopo sia far girare qualcosa che non lo rispetta.
- **Lo schema è permissivo, il linter è severo.** Molti campi restano opzionali
  nello schema — il JSON Schema non sa distinguere una fase interattiva da una
  cutscene senza contorsioni — e sono **obbligatori per il linter**. È lì che
  passa la differenza fra *ben formato* e *giocabile*.

## Regole di gioco

Sono i paletti di `SPECS.md` tradotti in comportamento del motore e del
compilatore. Non sono vincoli di schema — il formato permetterebbe di scriverne
di opposte — ma sono il modo in cui questo progetto usa il formato.

**Il giocatore passa da un luogo all'altro, e può tornare indietro.** Un ambiente
già esplorato resta accessibile finché l'atto non decide di chiuderlo. Non è solo
giocabilità: **è ciò che rende pagabile il costo dell'errore in passi**, che è
l'unica valuta di punizione che questo progetto usa. Un ambiente che si chiude
appena esaurito trasforma ogni errore in un potenziale vicolo cieco.

Il prezzo è testo d'autore, e va messo in conto: ogni luogo in cui si può tornare
deve avere qualcosa da dire in ogni stato in cui ci si torna — look aggiornato,
fallback contestuali, e una frase d'autore per «qui non c'è più niente da fare»
che non può essere generica, o dopo tre atti la si legge cinquanta volte.

**Il costo dell'errore è camminare all'indietro.** L'unica valuta della punizione
sono i passi: il giocatore viene rimesso in un luogo già visto e deve rifare la
strada. Nessuna barra della minaccia, nessun avversario di cui tracciare la
posizione, nessuna variabile che dice dove si trova il pericolo: la minaccia è
una **pressione** — una transizione all'indietro e un fondo sonoro — non
un'entità simulata.

**Le risorse non si contano.** Munizioni, torce, batterie: trovarle è un evento,
amministrarle non è un gioco. Un oggetto sta in inventario e dà accesso ad
azioni; non ha una quantità che scende, e nessuna azione fallisce perché è finito
qualcosa.

**Il tempo non esiste.** Nessun timer, da nessuna parte, mai: nessuna azione
scade, nessuna fase si chiude da sola, nessuna occasione va persa perché il
giocatore ha esitato. Si può restare fermi in una stanza per un'ora e non succede
niente. Dove la sceneggiatura ha urgenza, quell'urgenza è **recitata**: sta nel
testo, nel suono e nelle immagini, non nella logica. Il giocatore deve sentire il
panico, non subirlo.

**Si può perdere solo se la storia lo dichiara.** `failure_mode` è una proprietà
della storia:

- **`nessuna`** (default, stile LucasArts). Niente morti, niente game over,
  niente vicoli ciechi. Qualunque cosa faccia il giocatore e in qualunque ordine
  la faccia, si arriva sempre allo stesso finale; ciò che cambia non è *se* ci
  arriva, è **quanto gli costa**.
- **`finali_alternativi`** (stile Sierra). Una biforcazione può portare a un
  finale prematuro. Due vincoli, e sono quelli che il linter fa rispettare: un
  finale alternativo deve essere raggiungibile **solo da un'azione esplicitamente
  marcata** — mai per omissione, mai per aver sbagliato ordine — e deve esistere
  sempre un percorso completo fino alla fine naturale.

**Se si può perdere, serve un punto di ripresa.** Checkpoint automatico
all'ingresso di ogni luogo, **attivabile dal pannello** e non imposto: senza, un
finale alternativo diventa «ricomincia l'atto», che è una punizione di un'altra
categoria rispetto a camminare all'indietro. Chi vuole giocare senza rete lo
spegne.

**Gli appunti di giocabilità dell'autore sono specifica, non prosa.** Le
sceneggiature possono contenere blocchi marcati (`#### Giocabilità`, o una
sezione globale `## Note di giocabilità`): sono istruzioni per il compilatore —
condizioni di sblocco, azioni previste, errori attesi, cosa non dire mai al
giocatore — e non vanno mai riversati nel testo che il giocatore legge. Hanno la
precedenza sulle regole di forma del compilatore: se l'appunto elenca nove cose
da fare in una stanza, sono nove.

**Il compilatore chiede prima di partire.** Tre decisioni non si possono dedurre
dal testo, e indovinarle sbagliate si paga con una ricompilazione intera:

1. quanto **inventare** (enigmi, azioni, oggetti, flag) rispetto agli appunti già
   scritti;
2. quanto **rielaborare i dialoghi** rispetto alle battute già esistenti;
3. il **tetto di entità interagibili per luogo**.

## Il compilatore

**Skill `zaistory-compiler`** — unica implementazione attiva. Applica le regole
di questo documento direttamente in conversazione:

- **Stadio A** — estrazione di una *story map*: id stabili, personaggi, oggetti,
  stile globale, atti, luoghi, e **assegnazione delle scene del sorgente ai
  luoghi** — il passo che il modello precedente non aveva, ed è quello che decide
  la forma di tutto il resto. Le corrispondenze stanno in «Dove finisce una scena
  della sceneggiatura».
- **Stadio B** — compilazione di dettaglio, fase per fase.
- **Validazione e correzione** prima di consegnare.

Limiti onesti, da comunicare all'utente:

- **Nessuna cache fra conversazioni diverse**: ogni sessione ricompila da zero.
- **Non è deterministica fra sessioni**: id e dettagli minori variano. Se un file
  esiste già e serve solo un aggiornamento, meglio editarlo in place mantenendo
  gli id che ricompilare tutto.

**Generatore ad hoc (futuro, non iniziato).** Le stesse regole implementate come
codice deterministico, per ripetibilità e velocità che la skill non può dare.
Nessuna scelta di linguaggio o stack è stata presa, ed è deliberato: prima si
stabilizzano le regole iterando su sceneggiature reali, poi si cristallizzano.

## Il linter

La validazione di schema dice che un file è *ben formato*; solo il linter dice se
è *giocabile*. È il modo più economico di scoprire che una storia non lo è senza
prima generare immagini e voci.

Cosa controlla:

- **Integrità dei riferimenti**: transizioni verso id inesistenti, luoghi
  irraggiungibili, nodi di dialogo monchi o irraggiungibili, alberi che nessuna
  azione raggiunge, `speaker` fuori dalla roster, `place` e `characters_in_frame`
  verso id inesistenti.
- **Condizioni impossibili**: flag richiesto e mai impostato, oggetto richiesto e
  mai raccolto.
- **Confini d'atto**: condizioni che nomi­nano flag di un altro atto; carry flag
  non dichiarati o mai letti; un atto che, per qualche combinazione dei carry
  flag che legge, non è completabile.
- **Solvibilità**: da qui, senza questo, si arriva ancora alla fine? La
  decomposizione per atto la rende verificabile davvero. In `failure_mode:
  finali_alternativi` cambia il criterio, non l'obbligo.
- **Nessuna stanza muta**, che è una regola sola detta in più modi:
  `blocked_narration` su ogni azione condizionata; `look_variants` per ogni flag
  che, in quello stesso luogo, apre o chiude un'azione; un fallback raggiungibile
  per ogni fase; uno stato «esaurito» con il suo look per ogni luogo in cui si
  può tornare.
- **Osservabilità**: ogni entità che può essere bersaglio di un'azione ha una
  descrizione.
- **Coerenza nome file / `id`**, e una sola storia per cartella.
- **Copertura del resolver** (`--copertura`): passa le `test_phrases` al backend
  scelto e conta quante arrivano dove devono, distinguendo le **perse** (nessun
  match) dalle **sbagliate** (azione diversa). La distinzione è il punto: un
  backend che alza il richiamo aggiungendo errori del secondo tipo sta
  peggiorando la storia, e il totale da solo non lo direbbe. Le `test_phrases`
  vanno scritte *lontane* dagli alias: copiarle di lì misura il lookup, non il
  richiamo.

Due note che vengono dall'esperienza e vale la pena non riscoprire:

- **La deroga «questa condizione nessuno la incontrerà mai al contrario» non
  esiste.** Era stata presa 43 volte su 81 in una storia sola, e la previsione su
  cui si appoggia è proprio quella che un compilatore non può fare, perché chi
  gioca a parole prova le cose nell'ordine che gli viene in mente.
- **Un file conforme allo schema non deve poter far comparire una nota di
  errore.** Le note esistono per i buchi veri, non per i campi opzionali.

## Il player

`player/`, TypeScript. Una build sola per tre pubblici, e la differenza è un
interruttore.

**Stack: TypeScript**, un core condiviso e due facce. Il vincolo che lo decide è
*testare sul device su cui la storia verrà giocata*: un'avventura pensata per il
telefono si collauda sul telefono, e in browser ci si arriva solo con JS.

- `src/core/` — engine, stato, effetti e condizioni, linter, resolver, lettura
  severa del file. Non tocca il DOM e non legge da stdin. **La logica di gioco
  sta qui, e solo qui**: se una regola si trova duplicata in `web/` o `cli/`, è
  nel posto sbagliato.
- `src/web/` — il player vero e proprio, mobile-first. La build è **un unico file
  HTML** (JS e CSS incorporati) che si apre anche da `file://`, si manda in chat
  o si mette su qualunque static host: nessun runtime da installare.
- `src/cli/` — il terminale, per `--lint` e `--script` headless in CI. Non gira
  su mobile e non deve.

Zero dipendenze a runtime; TypeScript e Vite sono solo strumenti di build.

### Vincoli di comportamento

- **Non inventa logica.** Può solo scegliere fra azioni già definite e applicare
  effetti già presenti. Se qualcosa non si può fare è perché il file non lo
  prevede — ed è esattamente l'informazione che si sta cercando.
- **Non inventa testo.** Ogni riga che il giocatore legge sta nel file. Dove
  manca, il player ripiega sul fallback per intenzione (che è comunque testo
  d'autore) e la diagnostica si vede solo a debug acceso. Chi gioca legge sempre
  testo d'autore.
- **Le diagnostiche di un file rotto si vedono sempre.** Una transizione verso un
  id inesistente non è prosa che manca: lì non c'è niente da leggere al suo
  posto, ed è l'informazione per cui questo player esiste.
- **Input unico: il file zaistory.** Nessun manifest, nessun indice.

### Il turno

Ordine di precedenza, e non è un dettaglio:

1. **Le domande sull'interfaccia**, prima di tutto — «cosa posso fare?»,
   «guardati intorno». Non sono tentativi di agire sul mondo, e lasciarle
   somigliare agli alias di un'azione significava farla partire: una domanda non
   può applicare un effetto. Il prezzo, che va detto: una storia non può avere
   un'azione chiamata esattamente «aiuto».
2. **Il parser**: verbo + complementi → un'azione della fase, un'uscita, o
   niente.
3. **I verbi di sistema**, dopo, perché un'azione d'autore vinca sempre su un
   verbo di sistema. Non consumano un turno e non entrano nella traccia.
4. **Un tentativo che nomina una cosa che è qui** riceve una risposta su
   *quella* cosa: la sua descrizione invece del fallback generico. «usa il
   walkie» che si sente rispondere «le mani non trovano niente» è peggio della
   descrizione del walkie, che dice che è scarico — cioè esattamente quello che
   il giocatore stava chiedendo. «Qui» sono tutte e tre le specie di bersaglio,
   filtrate come le filtra il parser: gli oggetti in mano, gli oggetti
   d'ambiente presenti, i personaggi in scena. È la contropartita della regola
   che il formato impone all'autore — *tutto ciò con cui si interagisce deve
   essere osservabile*: senza, quella regola riempirebbe le storie di
   descrizioni che nessuno legge mai, e per far guardare un oggetto d'ambiente
   bisognerebbe scrivergli anche un'azione `look` che ripete la descrizione. Con
   questa, **una pura osservazione smette di essere un'azione** e torna a essere
   quello che è: il testo dell'oggetto.
5. **Il fallback per intenzione.**

**Una fase può cambiare senza cambiare luogo**, ed è il caso che il player deve
saper vedere: un'azione alza un flag, la condizione della fase seguente diventa
vera, e il posto è un'altra cosa pur essendo lo stesso posto. Lì la narrazione
della fase nuova va letta come se ci si fosse appena entrati — perché è quello
che è successo — e se quella fase è un finale, è lì che la storia finisce.

**Un bersaglio che non c'è non è un bersaglio**, e l'azione che lo prende
sparisce con lui. Vale per tutte e tre le specie: un oggetto d'ambiente con il
suo `present_when` non soddisfatto, un oggetto d'inventario che non si ha in
mano, un personaggio che questa fase non elenca fra i presenti. Non è logica
inventata dal player: è quello che `present_when` dice già per gli oggetti
d'ambiente, esteso alle altre due — e l'alternativa sarebbe chiedere all'autore
di ripetere `has_item: lanterna` su ogni azione che usa la lanterna, cioè
scrivere due volte lo stesso fatto, con il secondo che prima o poi si dimentica.
Il caso che l'ha fatta scrivere: dopo aver acceso la lanterna, «cosa posso fare»
continuava a elencare *la lanterna spenta* — un oggetto che accenderla aveva
sostituito con un altro.

Sui personaggi vale una cautela: si filtra solo se la fase dichiara un elenco di
presenti. Una fase che non lo dichiara non sta dicendo «non c'è nessuno», sta
tacendo, e su un silenzio non si filtra.

**Le azioni bloccate entrano fra le candidate**, ed è la differenza fra un menu e
una conversazione. In un menu un'azione filtrata da una condizione sparisce e non
c'è niente da dire; a parole il giocatore la chiede lo stesso e riceve la
`blocked_narration` d'autore. Il player non applica niente — nessun flag, nessuna
transizione, nessun oggetto — e l'engine non sa nemmeno che è successo qualcosa.

**I verbi di sistema** sono le domande che il giocatore fa continuamente e che
non passano da nessuna azione, quindi senza un posto dove metterle o restano
senza risposta o l'autore le duplica come azioni:

| domanda | risposta d'autore |
|---|---|
| «guardati intorno», «dove sono» | `look` della fase (+ varianti) |
| «cosa ho nello zaino» | `player_voice` + i nomi degli oggetti |
| «chi c'è qui» | `player_voice` + i personaggi presenti, protagonista escluso |
| «guarda il walkie», «guarda lo schedario», «guarda Tommy» | descrizione della cosa nominata, se è qui (+ varianti) |
| «dove posso andare» | le uscite conosciute |

**«Cosa posso fare?» risponde con i bersagli, non con le azioni.** Un player a
parole in cui non si trova la frase giusta è un player in cui la storia si ferma;
ma l'elenco delle azioni la risolve al posto del giocatore. Il verbo nomina
quindi i **bersagli** delle azioni disponibili, con il nome d'autore
dell'oggetto o della persona: dice dove guardare, non cosa fare. «Tommy» non è
«parla con Tommy»; «la cassa» non è né «apri la cassa» né «sposta la cassa».
L'enigma resta intero, l'attrito di indovinare *su cosa* no.

La risposta **somma** il `look` com'è adesso e i bersagli, invece di sceglierne
uno: il `look` è l'unico testo che cambia con lo stato, quindi è il pezzo che
porta l'indizio, ed è anche dove l'autore nomina le cose della stanza che nessun
altro campo saprebbe elencare. Restano fuori i bersagli delle azioni nascoste da
una condizione (sarebbero un anticipo, a volte uno spoiler) e il protagonista.

**Quando nel luogo non resta niente da fare, l'uscita si mostra.** Le chip stanno
sotto il debug perché un elenco di azioni risolve gli enigmi al posto del
giocatore — ma quando gli enigmi sono finiti non c'è più niente da proteggere, e
continuare a chiedere di indovinare la frase giusta è solo un muro. «Niente da
fare» ha una definizione precisa: ogni azione disponibile che non sia un'uscita è
già stata eseguita almeno una volta, oppure è una pura osservazione (il suo
effetto non ha flag, oggetti, dialoghi né transizioni). **Una sola uscita,
altrimenti niente**: dove le uscite sono più d'una, mostrarle tutte è
esattamente il menu che le chip esistono per non mostrare.

#### Due candidate identiche, e come si spareggiano

Il parser riceve **anche le azioni bloccate** — devono arrivarci, o la loro
`blocked_narration` non verrebbe mai letta — e per due candidate a pari
punteggio la regola è rispondere con un fallback invece di tirare a indovinare.
C'è però un caso in cui il pari punteggio non è un'ambiguità ma una costruzione
voluta: **la stessa cosa in due momenti diversi**, cioè stesso verbo, stesso
bersaglio, condizioni disgiunte. Parlare a Mark della scatola e parlargli quando
è già otto metri più su sono lessicalmente identiche per costruzione, e trattarle
da ambiguità significherebbe non capire l'autore proprio dove è stato più
preciso. Quindi: **a parità di punteggio vince quella che si può fare adesso**, e
l'ambiguità resta ambiguità solo fra due candidate che si possono fare tutte e
due.

### Il resolver

Un modulo player-agnostic che riceve *(azioni disponibili, testo libero, tono)* e
ritorna *(un'azione esistente, un'uscita, oppure nessun match con un fallback
d'autore)*. Il suo perimetro sono le azioni e il movimento, **mai le scelte di
dialogo**: con un dialogo aperto il player mostra l'elenco e il resolver non
viene interpellato.

**Tre backend dietro la stessa interfaccia**, e che siano separati è il punto:

1. **lessicale** — matcher deterministico sugli alias delle entità e sulla
   tabella dei verbi. Zero dipendenze, zero rete, zero byte scaricati, e sta
   dentro il file HTML unico. **È il default.**

   Due cose che sembrano dettagli di implementazione e sono decisioni. La prima:
   **i verbi della frase contano tutti, non solo il primo.** L'italiano parlato
   incastra i verbi — «mi giro verso Tommy e grido», «vado a vedere cosa c'è
   dietro» — e il primo è quasi sempre quello di appoggio; prendere solo quello
   sbagliava la famiglia e per giunta lasciava l'altro verbo dentro il
   complemento a fare punteggio contro il nome di un'entità. Un'azione vale
   pieno se la sua famiglia è *fra* quelle nominate, e il rifiuto che conta —
   una frase di sola percezione non fa partire un'azione che manipola — resta
   intatto, perché lì di famiglia ce n'è una sola. La seconda: **un sostantivo
   che comincia come un verbo non è un verbo.** La tabella tiene radici
   troncate e le confronta per prefisso, e `corridoio` comincia per `corr`, che
   è *correre*: in un magazzino fatto di corridoi ogni frase risultava un verbo
   di movimento. A distinguere non basta contare le lettere di scarto —
   `colpisc` sta a `colp` come `corridoi` sta a `corr` — ma **cosa avanza**: da
   un verbo avanza un pezzo di coniugazione, da un sostantivo avanza il resto
   della parola.

   E una terza, che viene dalle specifiche e non dal lessico: **ascoltare una
   persona è parlarle.** I verbi di percezione acustica stanno in due famiglie,
   e a sceglierne una è il complemento (`SPECS.md`, azione Parla). Il parser il
   complemento lo pesa ma non sa chi c'è in scena, quindi la scelta non può
   farla lui: gliela passa il turno, come suggerimento, e il parser la usa per
   **restringere** le famiglie del verbo a quella — mai per aggiungerne una che
   il verbo non ha. Senza restringere non basterebbe: dove un personaggio ha
   due azioni, una da guardare e una da sentire, resterebbero pari e la frase
   finirebbe in un «non ho capito». Nello stesso caso salta anche il passo
   della cosa nominata: se nessuna azione risponde, la risposta è il rifiuto
   per intenzione e non la descrizione di com'è fatto in faccia.
2. **ibrido** — lessicale + vettori, con i vettori solo dove il lessicale tace.
   **È la modalità con cui si gioca** quando i vettori si vogliono.
3. **vettori** — solo vettori, nessun lessicale. Non è una modalità di gioco:
   serve a *misurare*
   cosa fa l'embedder da solo, che è l'unico modo di dire quanto stia aggiungendo
   davvero nell'ibrido invece di limitarsi a confermare quello che il lessicale
   aveva già preso.

Resta aperto un quarto backend, **Claude via API**, il cui posto naturale non è
essere il motore di gioco ma **l'oracolo di riferimento**: si fa girare lo stesso
set di frasi di prova su tutti e si misura quanto si perde.

**La divisione del lavoro è per costo dell'errore, non a cascata.** I due backend
falliscono in modi diversi:

- il **lessicale** ha precisione alta e richiamo più basso: sbaglia
  **rifiutando**. Costa una frase riscritta — e, nel caso peggiore, la sensazione
  di aver sbagliato strada quando invece si aveva risolto l'enigma. Attenzione: i
  fallback d'autore *aggravano* questo caso. Un «non ho capito» generico è onesto
  e invita a riformulare; un fallback in tono e pertinente dice «no, non è quella
  la strada», cioè mente con convinzione.
- l'**embedder** ha richiamo più alto e precisione più bassa: sbaglia
  **facendo**. Gli embedding di frase sono ciechi sulla negazione («non toccare
  il cavo» e «tocca il cavo» hanno vettori quasi identici) e sulla direzione
  degli argomenti («chiedi a Mark del coltello» / «dai il coltello a Mark») —
  quest'ultima diventa più critica ora che *usa X con Y* ha due complementi
  ordinati. Un falso positivo *esegue*: applica un effetto, alza un flag, brucia
  un enigma.

Quindi: **l'embedder interviene solo dove il lessicale è muto** (nessuna
candidata sopra soglia, e non per ambiguità) **e sempre nella scelta del
fallback**, dove sbagliare è gratis. In una riga: *embedding dove sbagliare non
costa niente, lessicale dove sbagliare cambia lo stato*.

Il parser è **sincrono** e i vettori no, e la giuntura fra i due è di proposito
stretta: il core non sa che i vettori esistono, sa solo che qualcuno può volerci
provare **dopo** di lui. Tre metodi soli lo permettono — `preview(frase)`, che
dice cosa il player farebbe senza farlo (*risolta*, *sistema*, *nominata*,
*muto*, e solo su *muto* ha senso che parli qualcun altro); `takeResolution()`,
che esegue quello che il secondo interprete ha scelto passando per la stessa
strada del lessicale, condizioni comprese; e un `chooseFallback` opzionale su
`input()`, che riceve la **stessa pila** di frasi d'autore che userebbe il
player e ne indica una. Nemmeno lì si scrive prosa: la regola non ha eccezioni,
neanche per i vettori.

**Le soglie sono esportate e vanno tarate con i dati, non a naso.** Un'azione non
si esegue solo perché è la migliore: deve anche **staccare la seconda**. Due
candidate a pari punteggio sono un'ambiguità vera, e a un'ambiguità vera si
risponde con un fallback — tirare a indovinare significa applicare un effetto che
nessuno ha chiesto. Le curve si misurano con `--copertura`, ed è così che le
costanti vanno scelte.

Cautela sui numeri, che vale più dei numeri: si misurano su frasi di prova
scritte dalla stessa mano che ha scritto gli alias. Dicono che il meccanismo
funziona e dove si rompe; non dicono quanto capirà la prossima storia.

**Ogni risposta dichiara chi l'ha decisa** (⟨lessicale⟩, ⟨vettori⟩, ⟨verbo di
sistema⟩, ⟨cosa nominata⟩), sempre, non solo in debug. Un rapporto di copertura
non dice cosa si prova a giocarci.

### L'interfaccia

**Lo schermo è diviso per senso: in alto ciò che si guarda, in basso ciò che si
ascolta e si legge.** È la regola da cui discende tutto il resto del layout. In
cima sta il palco con l'inquadratura, il tono, dove siamo, chi è in campo e le
facce del cast; sotto scorre il transcript con narrazione, parlato, ambiente
sonoro ed effetti.

- **La copertina è una schermata, non un'inquadratura.** Ci si sta sopra finché
  non si decide di cominciare, e per questo la locandina sta nella scheda e non
  sul palco: il palco dice *dove si è*, e prima di «inizia» non si è da nessuna
  parte — la barra in testa, per la stessa ragione, non nomina nessun luogo. La
  scheda risponde in un colpo d'occhio alle domande che ci si fa aprendo una
  storia che non si è compilata adesso: di cosa parla, in che lingua, con che
  versione del formato, che stile hanno le immagini e le voci. Il resto —
  l'identità del file, la roster, i luoghi, gli oggetti, i flag — è materiale da
  ispezione e compare col debug, in elenchi che nascono chiusi col conto nel
  titolo.
- **L'inquadratura corrente sta ferma, il racconto le scorre sotto.** Ogni
  immagine nuova prende il posto della precedente. Finché le figure scorrevano
  dentro il transcript, quella di adesso usciva dallo schermo appena si scorreva
  per leggere la riga che la commenta: due movimenti per una cosa sola. Un nodo
  senza immagine **non svuota il palco** — resta l'ultima inquadratura, che è
  esattamente ciò che succede quando la macchina non si è spostata.
- **Il tono non si nasconde mai, e fuori dal debug è l'unica cosa scritta sul
  palco.** È l'unico campo che non descrive un'immagine: è la chiave con cui si
  legge tutto quello che scorre sotto. Il luogo e chi è in campo, accanto a lui,
  sono la stessa cosa scritta due volte — il primo sta già nella barra in testa,
  il secondo lo dicono le facce qui sotto — e la seconda volta occupa la
  striscia che serve al tono. Restano nel documento e tornano col debug, dove la
  domanda è cosa l'inquadratura *dichiara*.
- **I prompt stanno dentro la cosa che descrivono.** Non su una riga a parte del
  transcript: si aprono allargando ciò a cui appartengono. È il collegamento più
  corto fra un asset e il testo che lo produce, ed è anche il momento in cui
  serve — guardandolo grande si decide se va bene.
- **Toccare un'immagine la apre grande**, con i suoi prompt per didascalia: vale
  per l'inquadratura, per le facce del cast e per la figura di un oggetto. La
  lente si apre **anche dove l'immagine non c'è**, perché è lì che i prompt
  vivono, e si chiude con un tocco in qualunque punto — su un telefono un popup
  che si chiude in un punto solo è il modo più rapido di far uscire qualcuno
  dalla partita.
- **La cosa che si sta guardando compare accanto alla sua descrizione.** Un
  oggetto tirato fuori dallo zaino o un oggetto d'ambiente osservato mostrano la
  loro figura nel transcript, sopra il testo: sono riferimenti dentro un
  discorso, e appartengono alla riga accanto a cui compaiono. I **personaggi**
  no: la loro faccia sta già sul palco, dove risponde per tutta la scena invece
  che una volta sola. E nell'elenco delle chip nemmeno gli oggetti: lì sono voci
  di menu, e dieci miniature in fila sono un inventario da gioco di ruolo, non
  la risposta a «cosa ho in mano».
- **Il cast di scena sta di lato, tutto, per tutta la fase.** Miniature piccole
  sul bordo: di lato perché non devono rubare altezza alla figura, sempre in
  vista perché «chi c'è qui» è una domanda che ci si fa in continuazione. Chi è
  dichiarato in campo è acceso; **a chi gioca i non-inquadrati non si mostrano
  affatto**, perché una faccia spenta in fila annuncia che sta per arrivare
  qualcuno. Col debug si vedono spenti, perché lì la domanda è cosa *dichiara*
  l'inquadratura. **Il protagonista sta in fila con gli altri**: che ci sia non è
  affatto scontato — una cutscene può raccontare una scena in cui il personaggio
  del giocatore proprio non c'è — e la fase lo dice dichiarandolo o no fra i suoi
  `characters`. È l'unica faccia il cui vedersi o meno sia un'informazione di
  trama, e toglierla d'ufficio la buttava via. **Chi l'inquadratura dichiara in
  campo ha una faccia anche se la fase corrente non lo elenca**: a ogni stacco
  che scavalca una fase i beat arrivano mentre la fase che vale adesso è già
  un'altra, e la sua roster non è quella della figura che si sta guardando. La
  roster della fase resta prima — è lì che stanno gli override d'aspetto e di
  voce — e chi arriva dall'inquadratura ricade sulla scheda globale.
- **La battuta che il giocatore sceglie sta nel flusso come tutte le altre**:
  il nome sopra, la riga sotto, e una sola differenza — azzurro invece che oro,
  perché è l'unica riga della storia a essere insieme parola d'autore e cosa
  fatta dal giocatore. Al suo posto c'era il numero della scelta, che diceva
  «questo l'ha registrato il player» invece di «questo l'hai detto tu»: chi
  rileggeva vedeva il dialogo interrompersi a ogni sua mossa e ricominciare
  dopo.
- **L'invio esegue il passo unico del dock** — «continua», «inizia», l'uscita
  rimasta — e **Esc chiude il cassetto aperto**, o il menu. Sono i due gesti con
  cui si sta su una pagina senza spostare il puntatore, e su desktop il
  «continua» a ogni beat è il bottone più premuto della partita.
- **Quello che si ha in mano ha un cassetto suo, accanto alla mappa.** Sono le
  due scorciatoie che saltano la digitazione — «vai» e «guarda quello che ho» —
  e per questo stanno accanto al campo e non in barra. Il menu è dove si va per
  *cambiare* qualcosa; dove si è lo dice la barra in testa, e cercare
  l'inventario dentro un'impostazione voleva dire aprire il menu per guardare la
  storia.
- **Il palco c'è sempre, anche senza immagini**: al posto della figura
  l'`image_prompt`, al posto delle facce le iniziali. Un posto solo dove guardare
  in tutte e due le modalità.
- **Il palco si riduce, non si chiude.** Due sole misure, grande e ridotta: tre
  stati o un trascinamento libero sono un'altra cosa da imparare per una
  decisione che ha due risposte. Chiudere del tutto è già possibile e si chiama
  spegnere le immagini.
- **Testo e immagini sono due modi, non un interruttore in più.** In *testo* si
  vedono i prompt — cosa verrebbe generato, che è quello che serve lavorando sul
  file — in *immagini* il risultato, **al posto** dei prompt. Mostrare entrambi
  sembrava gratis e non lo è: fra un'inquadratura e la sua descrizione l'occhio
  sceglie l'immagine, e il testo diventa mezzo schermo di rumore.
- **L'immagine non viene mai ritagliata per riempire il palco**: ritagliare
  butterebbe via proprio la parte che nello studio si è scelta guardando.
- **Due layout, non due prodotti.** Su telefono in verticale il palco è una fascia
  in alto con le facce in colonna; da 900 px di larghezza — o su uno schermo basso
  e largo, cioè un telefono coricato — diventa la colonna di sinistra e le facce
  passano in fila sotto la figura.
- **Il testo resta una colonna di lettura** anche quando ce n'è lo spazio: a
  centoventi caratteri l'occhio perde il capo tornando a sinistra.
- **L'app è alta quanto il viewport visuale, non quanto la finestra.** `100dvh`
  misura la finestra e la tastiera di sistema non la rimpicciolisce: sale sopra
  la pagina, e i tasti coprivano il dock, cioè proprio la riga in cui si scrive
  cosa fare. `visualViewport` misura quello che si vede davvero.
- **Mentre si scrive, il palco si ritira alla sola riga delle coordinate.** Chi ha
  il dito sulla tastiera non sta guardando la figura: sta leggendo cosa è appena
  successo per decidere cosa scrivere.
- **Il fuoco automatico nel campo vale solo dove la tastiera non costa niente.**
  Su un telefono rimettercelo dopo una frase che non ha fatto match significa
  riaprire i tasti addosso alla risposta appena arrivata.
- **«continua», «inizia» e il bottone di invio sono i bersagli più grandi**: si
  toccano decine di volte per partita, spesso al buio e col pollice.
- **Il tap-to-continue sta *fra* i beat, non dopo l'ultimo.** In fondo a una
  cutscene diventava un «avanti» seguito subito da «Continua», due bottoni di
  fila che dicono la stessa cosa. Non è una deroga al vincolo: le azioni
  disponibili restano quelle del file, cambia il momento in cui si vedono, che è
  impaginazione. Vale per web e CLI insieme, perché una differenza di ritmo fra
  le due renderebbe il collaudo su una non trasferibile all'altra.
- **Tema scuro e basta.** Da quando ci sono le immagini, il fondo non è più solo
  lo sfondo del testo: un bianco intorno a un'inquadratura cel-shaded ne cambia la
  lettura, ed è la ragione per cui i visori di foto sono tutti scuri.
- **Un interruttore che non cambia niente è peggio della sua assenza**: la scelta
  fra testo e immagini compare solo quando la storia ha immagini pubblicate e il
  player sa dove cercarle. Altrimenti al suo posto c'è una riga che dice quale dei
  due pezzi manca.

**Le immagini, il player le trova da sé o non le mostra.** L'id diventa
`assets/images/<id>.webp` relativo alla cartella della storia, dedotta da dove è
arrivato il file: la pagina stessa se è incorporato, la cartella dell'URL se
passato come parametro, e **nessuna** se è stato scelto a mano — lì non esiste
una storia intorno, e si gioca in solo testo. Il pannello lo dice, invece di
lasciar credere che siano rotte. Un'immagine dichiarata e non trovata si dice
anche quella: è l'unico modo di accorgersi di una pubblicazione parziale senza
aprire la console.

### Modalità ascolto

La storia recitata invece che letta. Il player mostra i prompt di generazione
come testo perché un giorno saranno immagine, suono e voce; chi non guarda lo
schermo ha lo stesso bisogno e ce l'ha *adesso*: **la descrizione di
un'inquadratura letta ad alta voce è l'immagine, finché l'immagine non esiste.**
Non un lettore di schermo attaccato sopra, ma una seconda uscita del player.

Sta interamente in `src/web/`: il core non sa che esiste un altoparlante come non
sa che esiste un DOM. Nessuna dipendenza: `speechSynthesis` del browser, che è
anche l'unico modo di far parlare il file HTML autonomo aperto da `file://`.

- **Il collapse acustico è lo stesso di quello visivo.** A schermo il prompt di un
  luogo o di un personaggio si vede per intero la prima volta e poi si riduce a
  una riga richiudibile; all'orecchio la riga richiudibile non esiste, quindi la
  prima volta la composizione per intero, dalla seconda **solo il nome**. I due
  registri sono separati — giocare a schermo spento non deve cambiare quello che
  si vedrebbe riaccendendolo — ma la regola è identica.
- **«Guardati intorno» riapre tutto.** È il contrappeso del collapse: a schermo
  quella riga si riapre con un tocco, all'orecchio si riapre chiedendolo.
- **Il dock non si legge. Mai.** Si recita quello che *è successo* — narrazione,
  battute, esito dei comandi — non l'interfaccia con cui lo si è chiesto. Una
  sola eccezione, e non contraddice la regola: **l'uscita mostrata quando nel
  luogo non resta più niente da fare**. Lì il dock non è un elenco fra cui
  scegliere, è l'unica cosa rimasta, e tacerla lascerebbe chi non guarda lo
  schermo esattamente nel muro che questa regola voleva togliere.
- **Avanzamento automatico** (flag): finita la lettura si prosegue da soli, e
  solo dove il passo è uno solo — quella stessa uscita rimasta. Dove le strade
  sono due il player non sceglie al posto del giocatore, anche quando la scelta
  sembra ovvia.
- **Le diagnostiche non si recitano.** Note, cambi di stato e problemi si vedono
  a debug acceso e restano muti: chi ascolta sta giocando, non collaudando.
- **Ogni frase va spezzata prima di darla alla sintesi.** Chrome smette di parlare
  dopo ~15 secondi di una stessa utterance: resta formalmente in corso e non esce
  più niente. Non è un caso limite — sulla storia di riferimento sono 114 frasi su
  126 sopra i 180 caratteri, con una punta da 627. Si taglia sui confini che il
  testo ha già (frase, poi virgola, poi spazio), e l'invariante è che le parole in
  uscita siano *esattamente* quelle in entrata: il testo è d'autore, e questa è
  impaginazione, non sintesi. Il limite è in **secondi, non in caratteri**, così
  scala con la velocità: tagliare a lunghezza fissa protegge solo chi lascia il
  cursore dov'è.

Qui non si inventa prosa: ogni frase recitata è testo d'autore. Le uniche parole
del player sono le etichette dei campi — «Ambiente:», «Personaggio:», «Voce:» —
che a schermo stanno scritte accanto al valore: dette invece che disegnate.

### Salvataggio, tracce, ripresa

Poiché il resolver può solo scegliere fra azioni già definite, **la sequenza
degli id descrive per intero la partita**. Da questa proprietà discendono tre
cose che sono la stessa cosa:

- un **playthrough** è un test di regressione (`--script`, exit code diverso da 0
  se la partita non arriva più in fondo);
- una **traccia** è un salvataggio: si copia dal pannello, si incolla, si rigioca
  in un istante e da lì si continua;
- la stessa traccia va in `localStorage` a ogni mossa, così **ricaricare la pagina
  non butta via la partita**. Su un telefono ricaricare non è quasi mai un gesto
  deliberato: è il browser che scarica la scheda per fare spazio.

Nella traccia va solo quello che ha **mosso la storia**: una frase che ha
ricevuto il ripiego per intenzione non ha fatto succedere niente, e rigiocandola
non farebbe succedere niente un'altra volta — tenerla significa allungare il
salvataggio con i tentativi andati a vuoto e farli rileggere tutti a chi lo
riprende. A dirlo è il core, con `noMatch` sull'esito del turno: lui constata,
non decide cosa farne. E le battute di dialogo si scrivono **«battuta N»**: il
numero nudo è la scorciatoia sotto le dita, ma in un salvataggio una colonna di
cifre non dice di che cosa fossero il numero.

Una traccia esaurita **finisce la partita in CLI e la restituisce al giocatore
sul web**: è lo stesso file, ma in CLI una traccia che si esaurisce prima del
finale è un test fallito, e sul web è semplicemente il punto in cui si riprende a
giocare.

Il checkpoint automatico all'ingresso di ogni luogo (per le storie che possono
perdere) è un'altra cosa ancora e vive accanto a questa: opzionale, attivabile
dal pannello.

### Debug

Un interruttore, non un'applicazione diversa. Mostra quello che i prompt non
dicono già — id, conteggi, personaggi presenti, flag impostati all'ingresso —
l'elenco delle azioni disponibili e **tutte** le azioni della fase, comprese
quelle filtrate da una condizione, con accanto condizione richiesta ed effetto
risultante. Serve a capire *perché* un'azione non compare, che è la domanda che
ci si pone il 90% delle volte quando si collauda una storia.

Sotto il campo, l'ispezione del luogo risponde a tre domande nell'ordine in cui
ci si fanno collaudando: **con che gesto** si può agire qui (i verbi che almeno
un'azione aperta usa), **su cosa** (i bersagli delle azioni aperte, le tre
specie insieme, perché al parser non importa quale sia), e **cosa cambia**
ciascuna azione — con il segno di quali *sbloccano* qualcosa, cioè non sono pure
osservazioni, e di quali sono già state fatte. Un luogo dove nessuna azione
sblocca niente è un vicolo cieco, e così si vede a colpo d'occhio invece che
giocandoci contro.

**La meccanica interna vive qui e solo qui.** Un flag che cambia, un oggetto che
entra nello zaino, una diagnostica di testo mancante: stanno nel documento
sempre — così accendere il debug mostra anche quello che è già passato — e si
vedono solo a interruttore acceso. Chi gioca non legge mai un messaggio di
macchina al posto della storia. L'unica eccezione è `problem`, che segnala una
storia **rotta**: lì non c'è niente da leggere al suo posto.

Le **chip dei verbi restano sotto il debug** per ora. Vale la pena registrare che
la ragione originale è decaduta: le chip erano vietate perché elencavano le
*azioni disponibili*, cioè risolvevano gli enigmi; quattro chip che dicono
`guarda / usa / parla / vai` sono grammatica, non soluzione. Se un giorno si
portano in gioco, il confine da tenere non è «chip sì / chip no» ma **i verbi
sono grammatica, le entità sono contenuto**.

### Distribuire il player

Non c'è un secondo player da costruire e non c'è un deploy da progettare: la
build è **un unico file HTML**, e questo è già il modo di distribuirla. Con la
storia incorporata, un'avventura intera è un file che si tocca e parte.

Due cose restano aperte, e sono diverse da «un altro player»:

- **Dove stanno gli asset quando la storia non è più in locale.** La convenzione
  attuale regge una chiavetta e uno static host, non un catalogo di storie. È una
  decisione di hosting, rimandata.
- **Installabilità e offline.** Un manifest e un service worker trasformerebbero
  lo stesso file in qualcosa che si installa da browser mobile e funziona senza
  rete. Non cambia l'architettura: è una passata sopra quello che c'è già.

## Modulo assets

`assets-studio/`, **una cartella per tipo di asset**: `images/` oggi, `voice/` e
`sound/` quando esisteranno. Non per fornitore e non tutto in un modulo solo: le
tre catene si somigliano da lontano e non nel punto che conta, cioè come si
decide se un asset è buono — un'immagine si guarda una alla volta, una battuta si
ascolta nel suo contesto, un ambiente sonoro si giudica solo insieme
all'immagine. Identico resta il contratto ai due capi: prompt letti dal file
zaistory, lavoro in `_work/`, asset pubblicati in `assets/` con l'id scritto nel
file.

### Decisioni che valgono per tutto il modulo

- **L'estrazione è un passo separato dalla generazione.** Prima si attraversa
  l'intero file raccogliendo ogni risorsa da produrre, poi si chiamano i provider.
  La deduplica per contenuto identico non è il motivo — misurata, non risparmia
  niente (59 immagini, 59 distinte). Il motivo vero è che l'estrazione risolve le
  **ancore**, di cui la generazione ha bisogno, e permette di generare ogni
  risorsa in modo indipendente, riprendibile e cacheabile.
- **Le risorse non sono solo prompt.** Il grosso del lavoro sono le battute da
  sintetizzare — 111 sulla storia di riferimento, ~24 minuti di audio — e il loro
  testo non è un prompt. Un manifesto «lista dei prompt» lascerebbe fuori la parte
  più costosa.
- **Due livelli, per la voce come per le immagini**: *assegnazione* (una volta per
  entità nell'intera storia: uno stile testuale diventa un timbro stabile, un
  `visual_prompt` diventa un ritratto di riferimento) e *generazione* (per ogni
  battuta o inquadratura, quell'ancora più il contenuto). Se lo stile si
  risolvesse riga per riga, provider come ElevenLabs restituirebbero timbri
  leggermente diversi a ogni chiamata anche con lo stesso testo. Caso limite: una
  battuta con un override che specifica solo uno stile deve comunque passare dal
  livello di assegnazione, non bypassarlo.
- **Musica di sottofondo: corrispondenza a tag contro una libreria locale curata,
  non generazione via API.** La generazione musicale è ancora troppo acerba
  rispetto a immagini e voce per una pipeline automatica.
- **Hosting degli asset: rimandato.** Solo locale per ora.

### Immagini (costruito)

- **Provider: Pollinations.** Un catalogo unico dietro una sola chiave e un solo
  formato di richiesta ha permesso di confrontare **21 modelli sullo stesso
  identico prompt**, ed è quel confronto ad aver deciso tutto il resto.
- **Il condizionamento su immagini di riferimento è un requisito, non
  un'ottimizzazione.** Misurato: a parità di prompt e di seed, un modello
  text-only restituisce una persona diversa a ogni chiamata. Nessun testo
  trasporta un'identità — «donna sulla quarantina, capelli scuri raccolti male»
  descrive un tipo, non una persona.
- **Il costo non è il vincolo che sembrava.** Una storia intera, 88 immagini,
  costa 2,61 $. Ne discende cosa *non* va fatto: niente livelli di prezzo, niente
  scelta automatica del modello per difficoltà stimata, nessuna deduplica furba.
  Qualunque ottimizzazione di costo vale meno della complessità che aggiunge; il
  denaro si spende per rigenerare quello che non convince.
- **La selezione è umana, ed è un requisito di architettura.** Nessuna euristica
  sa quale immagine è venuta male: si guarda. Da qui il sidecar JSON accanto a
  ogni immagine (job id, modello, seed, prompt effettivo, reference con hash) e da
  qui lo studio web, che è l'interfaccia che quel sidecar rende possibile.
- **Il taglio delle ancore è una decisione sull'intero cast**, non sul singolo
  personaggio: un cast con ritagli disomogenei sembra venire da storie diverse.
  L'override per personaggio è ammesso solo per i soggetti non umani.
- **Lo stile visivo lo detta la storia, ma il fotorealismo a basso costo non
  regge.** Il passaggio a cel-shaded piatto a colori ha risolto più problemi di
  qualunque riscrittura di prompt. La pixel art resta una **passata deterministica
  in post**, mai un'istruzione nel prompt.
- **La dimensione richiesta è un suggerimento, non un contratto**: l'originale non
  ritagliato si conserva, e il ritaglio è una scelta visiva presa dopo, che non
  costa una rigenerazione.

**Gli id delle immagini.** Il file porta l'**id**, mai un percorso: un percorso
legherebbe il contratto alla disposizione dei file su disco, un file di mappatura
a lato sposterebbe solo il problema, e far dedurre il nome al player gli
farebbe ricostruire a runtime la logica dell'estrattore. L'id è lo stem del file,
cioè l'id del job reso sicuro per un filesystem.

**Pubblicazione (`publish.py`)** — il passo che porta le immagini dal banco di
lavoro dentro la storia, e l'unico di tutta la catena che tocchi il file
zaistory.

- **Si pubblica solo ciò che è marcato definitivo**, con l'hash del file
  approvato: rigenerare un'immagine dopo averla approvata fa decadere
  l'approvazione. Senza l'hash, un clic su «rigenera» manderebbe in pubblicazione
  un'immagine che nessuno ha guardato.
- **Idempotente per progetto**: ripubblicare senza cambiamenti non riscrive niente
  e non tocca il file. Durante una revisione si pubblica dieci volte, e un diff di
  centinaia di migliaia di righe a ogni giro renderebbe la revisione illeggibile.
- **Togliere un'approvazione toglie l'id dal file**, altrimenti il player
  cercherebbe un'immagine che non c'è più.
- **WebP, lato lungo 1024.** 88 immagini passano da ~52 MB di PNG a ~6,7 MB: è la
  differenza fra una storia scaricabile da telefono e una che non lo è.
- **Se il manifest non combacia più con il file, ci si ferma** invece di scrivere
  la faccia sbagliata nella scena sbagliata.

### Riusare le immagini dopo una ricompilazione

Le immagini già generate e approvate sono **denaro speso e ore di selezione
umana**: una ricompilazione non deve buttarle via. Su "Metal Head" sono 89
immagini pubblicate, con 89 MB di banco di lavoro dietro.

Il rischio è preciso: gli id degli scatti derivano dagli id delle scene
(`shot.auto_in_viaggio.bg`), e una ricompilazione che rinomina i nodi rende
orfano tutto. Le contromisure, in ordine di forza:

- **Le ancore si salvano da sole, ed è per questo che sono indicizzate per
  identità.** `anchor.char.laura` non dipende da nessuna scena: se il
  compilatore conserva gli id delle entità, i ritratti e le vedute di
  riferimento restano validi senza fare niente. È la parte più costosa da
  rifare, ed è quella che il progetto aveva già protetto.
- **La ricompilazione eredita gli id.** Quando esiste già una versione
  precedente, il compilatore la riceve come riferimento e **riusa gli id
  esistenti** per personaggi, oggetti, luoghi e — dove una fase corrisponde a
  una vecchia scena — per le fasi. Non è una comodità: è la condizione perché
  gli id degli scatti restino gli stessi.
- **Un passo di rebind, per tutto il resto** (`assets-studio/images/rebind.py`).
  Dati il manifest della vecchia compilazione e la storia nuova, riaggancia le
  immagini già pubblicate ai nodi nuovi: prima per id, poi **confrontando il
  testo del prompt**. La prosa
  di una ricompilazione della stessa sceneggiatura resta in larga parte la
  stessa, quindi il prompt è la chiave più robusta dell'id. Quello che non trova
  un aggancio si elenca invece di essere scartato in silenzio: è materiale
  pagato, e la decisione se rigenerarlo è umana.
- **`_work/` non si cancella prima del rebind.** Non è versionato, quindi è
  l'unica copia: dentro ci sono i sidecar con il prompt effettivo, il modello, il
  seed e l'hash di ogni generazione, ed è quello che rende possibile
  riagganciare. `_published.json` da solo dice *cosa* è stato pubblicato e da
  quale file, non con che prompt.

Regola generale che ne discende: **una rigenerazione è sempre una decisione, mai
un effetto collaterale.** Nessuno strumento della catena rigenera un asset che
esiste perché un id non torna; al massimo lo segnala.

### Voce, suoni ed effetti

Nessun codice. **ElevenLabs** resta il provider suggerito in analisi, non
vincolante. Le decisioni che li riguardano sono quelle generali qui sopra: due
livelli, il testo che non sta nei prompt, la musica per tag invece che generata.

## Storie di riferimento

- **"Nel paese dei ciechi"** (adattamento da H.G. Wells). Sceneggiatura reale,
  fonte diretta delle decisioni su cutscene e narrazione multi-beat: testare su
  materiale scritto da un autore vero ha rivelato lacune che l'analisi teorica non
  aveva previsto.
- **"Metal Head"** (adattamento da Black Mirror 4x05). Scritta con gli **appunti
  di giocabilità dentro il documento**, che è la forma in cui l'autore lavora
  davvero. È la fonte delle regole di game design, ed è il banco di prova naturale
  del modello ad atti: gli atti li ha già nella narrazione.

  È la prima storia compilata sul formato 1.0.0, e compilarla è servito a
  collaudare il formato più di qualunque rilettura: quattro atti, 22 luoghi, 44
  fasi. I due primi atti sono **corridoi** — la sceneggiatura è una discesa senza
  ritorni — e il terzo è il contrario, undici stanze di una casa in cui si gira
  liberamente: è lì che le regole del ritorno libero si pagano, ed è lì che sono
  state trovate. Il quarto condivide i luoghi del terzo con `same_as`.

Entrambe vanno **ricompilate** sul formato 1.0.0, non migrate: i luoghi diventano
nodi, le scene diventano fasi, le azioni cambiano struttura e gli alias cambiano
proprietario. La regola «aggiornare invece di ricompilare» nasce per la deriva
minore fra sessioni, non per un cambio di forma.

Ricompilare non vuol dire ripartire dal foglio bianco: "Metal Head" ha 89
immagini già generate, approvate e pagate, e la ricompilazione **eredita gli id**
delle entità e delle fasi proprio perché quelle immagini restino attaccate. Vedi
«Riusare le immagini dopo una ricompilazione».

## Stato del lavoro

Da rifare sul formato 1.0.0, nell'ordine più naturale. I primi quattro punti
sono fatti; il quinto è in corso, ed è quello che sta trovando i difetti degli
altri quattro — un formato si collauda compilandoci una storia vera, non
rileggendolo.

1. **Lo schema** `zaistory.schema.json` — è il pezzo più delicato del
   repository: ogni altro componente dipende da lui.
2. **La skill** `zaistory-compiler`: Stadio A (che guadagna l'aggregazione delle
   scene in luoghi e atti), Stadio B (che cambia forma con i verbi), le tre
   domande iniziali, gli script di validazione e segmentazione.
3. **Il player**: parser al posto del resolver di frasi, uscite e mappa, atti,
   fasi, checkpoint, modalità di fallimento, linter. E la rinomina in inglese dei
   moduli che oggi hanno nomi italiani.
4. **Il modulo assets**: estrazione dei nuovi nodi con prompt (oggetti
   d'ambiente, cutscene di transizione), la glob del nuovo nome file negli
   strumenti, e il **passo di rebind** che riaggancia le immagini già pubblicate
   ai nodi ricompilati.
5. **Le due storie**, ricompilate con eredità degli id, con i playthrough
   rifatti e le immagini di "Metal Head" riagganciate. **"Metal Head" è
   fatta**, immagini comprese; resta "Nel paese dei ciechi".

Ancora non deciso, e deliberatamente:

- **Lo stack del generatore ad hoc.** Prima si stabilizzano le regole, poi si
  cristallizzano. Per il player invece è scelto e non si riapre.
- **Hosting degli asset** e **installabilità offline** del player.
- **Il backend Claude** del resolver, come oracolo di riferimento.
- **Storie molto grandi**: luoghi come file separati sono previsti
  concettualmente ma non affrontati. Da riprendere se servirà davvero.
