# Stadio B — compilare un luogo

## Ruolo

Produci un oggetto `Place` completo e valido: identità, uscite, oggetti
d'ambiente e tutte le sue fasi.

**L'unità di compilazione è il luogo, non la scena.** Si compila con tutti i suoi
blocchi sorgente davanti, perché le fasi si devono guardare fra loro: cosa cambia
dall'una all'altra, quale `look` racconta il cambiamento, quale fase è quella in
cui non resta più niente da fare.

## Input che riceverai

- la scheda del luogo dalla story map (id, nome, alias, `visual_prompt`, uscite
  previste, note);
- i **blocchi sorgente** delle scene assegnate a questo luogo, in ordine;
- l'anagrafica globale (personaggi, oggetti) e i flag dell'atto;
- le risposte dell'utente: libertà sulla giocabilità, rielaborazione dei
  dialoghi, **tetto di entità interagibili**;
- gli appunti di giocabilità dell'autore che riguardano questo luogo.

## Le regole di gioco, applicate qui

Prima di scrivere qualunque cosa, tienile davanti. Sono i paletti del progetto e
qui è dove si violano per distrazione.

1. **Non si perde.** Nessuna azione porta a un vicolo cieco o a una partita da
   ricominciare (a meno che la storia dichiari `failure_mode:
   alternate_endings`, e allora vedi «Finali»).
2. **Il tempo non esiste.** Nessuna azione scade, nessuna fase si chiude da sola,
   nessuna finestra si apre e si richiude. Se il sorgente dice «hai trenta
   secondi», quella fretta va nel testo e nel suono, non nella logica.
3. **Le risorse non si contano.** Un oggetto sta in inventario e dà accesso ad
   azioni; non ha una quantità.
4. **Si torna qui.** Il luogo resta aperto: ogni stato in cui il giocatore può
   rientrare deve avere qualcosa da dire.

## Gli appunti di giocabilità dell'autore

Se il blocco sorgente contiene `#### Giocabilità` (o simili), quelle righe sono
**specifica**, non prosa:

- **hanno la precedenza** sulle regole di forma di questo documento, tetto delle
  entità compreso. Se elencano nove cose da fare, sono nove;
- non finiscono **mai** nel testo che il giocatore legge;
- se dicono «non dire mai al giocatore che X», quel dato non compare in nessun
  `look`, `narration`, `description` o battuta.

## 1. L'identità del luogo

`id`, `name`, `aliases` vengono dalla story map: non reinventarli.

`visual_prompt` (+ `_en`) descrive **il posto**, non l'inquadratura: è l'ancora
su cui il modulo assets tiene coerenti tutte le viste di qui. Descrivi materiali,
dimensioni, luce fissa, disposizione. Non metterci personaggi, non metterci
azione, non metterci il momento.

`completed_when` dice quando qui non resta più niente da fare. Serve alla mappa e
al linter, e di solito è il flag che chiude l'ultimo enigma del luogo.

## 2. Gli oggetti d'ambiente (`objects`)

Sono l'entità che rende vera la regola di SPECS: **tutto ciò con cui si
interagisce deve essere osservabile**.

Due famiglie, e la seconda conta più di quanto sembri:

- **interagibili** — qualche azione li prende come bersaglio. Sono quelli che
  consumano il **tetto** deciso dall'utente (default 4-8 per luogo).
- **scenografia** — descritti e basta. Non consumano niente, e sono quello che
  distingue una stanza da un elenco: se il giocatore scrive «guarda gli
  scaffali» e riceve un fallback generico, la stanza si sgonfia. Mettine
  liberamente: ogni cosa che il `look` nomina dovrebbe essere guardabile.

Per ognuno: `id`, `name`, `aliases` (8-15), `description`, e
`description_variants` se lo stato la cambia. `present_when` per quelli che
compaiono o spariscono — un oggetto raccolto sparisce da qui e compare in
inventario, ed è un oggetto d'ambiente *e* un `Item`, con lo stesso concetto e
due id diversi.

Gli alias di due oggetti dello stesso luogo **non devono sovrapporsi**, e non
devono sovrapporsi nemmeno con gli alias del **luogo** né con quelli delle sue
**uscite**. La collisione fra livelli diversi è quella che non si vede
rileggendo l'elenco degli oggetti, ed è la peggiore: `magazzino_interno` aveva
`scaffali` fra i propri alias, e siccome gli alias del luogo di destinazione
finiscono nelle superfici dell'uscita che ci porta, «cerco fra gli scaffali
polverosi» valeva tanto per l'azione quanto per la porta — cioè finiva in
un'ambiguità, cioè in un non-ho-capito. Stessa storia per un'uscita chiamata
`la luce` in una scena dove si punta una torcia.

Regola pratica: **un contenitore non si chiama come una cosa che contiene.**

E gli id: **un id vale per una cosa sola in tutta la storia.** Gli oggetti
d'ambiente vivono nei luoghi, quindi due luoghi *sembrano* poter avere ciascuno
la propria `coscia` o la propria `porta`. Non possono — il player li indicizza
in una mappa sola e la seconda cancella la prima — e il linter lo dice.

Evita anche gli alias di **una parola sola e comunissima**: `la cosa`, `roba`,
`affare`. Non aggiungono richiamo, si prendono le frasi di tutti — `la cosa` sul
Cane-robot faceva finire «guardo cosa c'è dentro la scatola» sull'azione che
guarda il robot, in mezzo a una fuga. Attenzione che le parole vuote cadono
prima del confronto: `quella cosa` e `il coso` diventano tutti e due `cosa`, e
sono la stessa trappola scritta in modo da non sembrarlo.

Guarda infine le collisioni **fra oggetti di inventario diversi**, che
sopravvivono all'atto e quindi si incontrano dove nessuno le aveva previste: la
scatola bianca aveva `il pacco` fra gli alias e le caramelle `pacchetto`, e per
una notte intera «tiro giù uno zuccherino dal pacchetto» è stato un pareggio fra
lanciare una caramella e aprire la scatola.

## 3. Le uscite (`exits`)

Il movimento non è un'azione: è un'uscita. Per ognuna:

- **`to`**: il luogo di destinazione. Se è in un altro atto, questa è l'uscita
  che **chiude l'atto**, e va condizionata con gli `has_item` di tutto ciò che
  serve a valle. È l'unico modo di far rispettare la regola «non si chiude un
  atto senza gli oggetti necessari».
- **`aliases`**: come si chiede di andarci. Il parser risolve prima il
  complemento e poi decide il verbo, quindi «usa la porta» e «vai alla porta»
  devono convergere qui.
- **`label`**: solo se il passaggio ha un nome suo diverso dalla destinazione —
  «la porta sul retro», «la scala antincendio». Serve dove il giocatore vede
  l'uscita ma non sa ancora dove porta.
- **`known_when`**: quando il giocatore sa che esiste. Un'uscita sconosciuta non
  compare nella mappa. **La scoperta è un effetto d'autore**, mai un elemento di
  interfaccia che si accende: il testo deve nominare il passaggio prima che la
  mappa lo mostri.
- **`condition`** + **`blocked_narration`**: quando ci si può passare, e cosa si
  legge quando no. Una porta chiusa che non dice di essere chiusa è una stanza
  muta.
- **`transitions`**: le cutscene di passaggio. Servono al ritmo, e con il ritorno
  libero si attraversano molte volte — quindi **una volta sola per default**
  (`replay` solo dove serve davvero), **direzionali** (scendere e risalire non
  sono la stessa sequenza), e con `condition` dove la prima volta è una scoperta
  e la quinta è una scala.

Verifica sempre: **da questo luogo si esce**. Un luogo interattivo senza uscita
raggiungibile è un bug di game design, non solo tecnico.

## 4. Le fasi (`phases`)

Le fasi si valutano **in ordine** e vince la prima la cui `condition` è
soddisfatta. Quindi:

- le più specifiche vanno **prima**;
- l'ultima è **senza `condition`**, ed è quella d'arrivo. Un luogo le cui fasi
  hanno tutte una condizione può restare senza niente da dire.

Ordine pratico che funziona: la fase esaurita in cima, poi le fasi intermedie,
poi quella d'ingresso senza condizione in fondo.

### Una cutscene che porta altrove non è una fase

Nella sceneggiatura una fuga è spesso scritta come tre scene: la stanza da cui
si scappa, il pezzo di corsa, il posto in cui si arriva. Quella di mezzo **non
diventa una fase**: diventa la `transition` dell'uscita, insieme alla narrazione
dell'azione che nel vecchio modello ci portava. Si guadagna la cosa giusta —
la si vede una volta sola, all'attraversamento, e non resta un nodo in cui il
giocatore possa restare a girare senza niente da fare.

Nell'atto della campagna tre scene su dieci sono finite lì: il fosso sulla porta
del furgone, il campo aperto su quella del muretto, il crinale sull'uscita che
chiude l'atto.

### Incatenare due cutscene nello stesso luogo

Un montaggio narrato che non cambia stanza — il POV della macchina, poi
l'attacco — sono **due fasi consecutive dello stesso luogo**, e vanno tenute
separate: gli id delle fasi sono le chiavi con cui le immagini si riagganciano,
e fondere due scene in una fase sola butta via un'inquadratura pagata.

Si incatenano con `on_enter_flags_set`: ogni cutscene alza entrando il flag che
fa valere quella dopo, e il player le fa scorrere di seguito nello stesso turno.
Due di fila al massimo — è il limite del motore, ed è anche il limite del buon
senso. E attenzione all'ultima: **la fase in cui si atterra non deve avere
`narration`**, perché la sua entrata cade fuori dalla catena e il suo testo
arriverebbe un turno dopo, cioè dopo la prima mossa del giocatore. Quelle righe
si mettono in coda ai beat dell'ultima cutscene, dove il montaggio le legge nel
punto giusto.

### `kind: cutscene` o `interactive`

Una **cutscene** è puro montaggio narrato: voce fuori campo su più inquadrature,
nessuna scelta reale. Ha `narration[]` multi-beat e **una sola uscita**. Non
forzarla nel modello «stanza con azioni», e non metterci un `look`: non c'è
niente da guardarsi intorno mentre scorre un montaggio.

Una **interattiva** è una stanza: `look`, azioni, eventualmente un dialogo.

### `background` — l'inquadratura

`image_prompt` (+ `_en`) dice **come si sta guardando** il posto, non com'è
fatto: quello è il `visual_prompt` del luogo, e ripeterlo qui è sprecato.
Inquadratura, distanza, luce del momento, cosa c'è in primo piano.

`characters_in_frame` dice chi si **vede**, che non è chi è presente: una camera
buia con tre persone che parlano ha tre presenti e nessuno inquadrato.
Condizionare la generazione su tutti i presenti peggiora l'immagine quanto non
condizionare affatto.

`place` va **omesso**: dentro una fase il luogo lo dice la struttura.

`ambient_sound_prompt`: il fondo sonoro continuo di questa fase.

### `look` e `look_variants`

Il `look` è **la stanza com'è adesso, rileggibile**. È la risposta a «guardati
intorno» e «dove sono», che sono le domande più frequenti di un'avventura a
parole, e non consuma il budget delle entità perché è un verbo di sistema.

È anche il testo più importante che scriverai, per due ragioni:

- **è dove l'autore nomina le cose della stanza.** Niente si scopre da un
  elemento di interfaccia: se una leva non è nominata nel `look` (o in una
  narrazione, o nell'esito di un'altra azione), per il giocatore non esiste.
- **è l'unico testo che cambia con lo stato**, quindi è quello che porta
  l'indizio.

Da cui la regola sulle varianti: **per ogni flag che in questa fase apre o chiude
un'azione, ci vuole una `look_variant`.** Se un flag cambia cosa si può fare qui,
per definizione qui qualcosa è cambiato, e il `look` è l'unico posto in cui il
giocatore può accorgersene. Il caso che ha fatto scrivere la regola: notare un
carrello chiudeva «corri» e apriva «rovescia il carrello», con zero varianti e il
carrello mai nominato. Il giocatore aveva in mano tutto tranne la parola.

### La fase esaurita

**Ogni luogo in cui si può tornare ne ha una**, ed è il pezzo che si dimentica
più spesso perché nel sorgente non c'è: l'autore ha descritto il posto una volta,
e ha dato per scontato che tornandoci non ci sia più niente.

Ha la sua `condition` (di solito lo stesso flag di `completed_when`), il suo
`look` — «qui non è rimasto niente» detto in tono, non un silenzio — e le sue
poche azioni residue, tipicamente pure osservazioni. Il player, quando qui non
resta niente da fare e c'è **una sola** uscita, la mostra: è l'unico momento in
cui l'interfaccia aiuta, e succede perché a quel punto non c'è più nessun enigma
da proteggere.

### `narration` d'ingresso

Cosa si legge entrando in questa fase, prima di poter agire. Multi-beat quando
l'inquadratura cambia: ogni beat può avere il suo `image_prompt`, il suo
`sound_effect_prompt` e la sua `voice`.

Non ripetere qui il `look`: la narrazione è quello che **succede** entrando, il
look è quello che **c'è**.

### `characters`

Chi è presente in questa fase, con gli eventuali override locali di aspetto e
voce (una ferita, un travestimento). L'identità resta nella roster globale.

Comprende anche chi deve ancora entrare in scena: per questo il player non
mostra al giocatore i presenti non inquadrati — una faccia spenta in fila
annuncerebbe l'arrivo di qualcuno.

## 5. Le azioni

Una tripletta **verbo + bersaglio (+ secondo bersaglio)**. Non c'è nessuna
etichetta e nessuna lista di parafrasi: il verbo lo riconosce il player, il
bersaglio lo riconoscono gli `aliases` che hai scritto sulle entità.

| verbo | quando |
|---|---|
| `look` | una percezione che fa qualcosa di più che leggere una descrizione: scopre, alza un flag, apre una strada |
| `use` | ogni manipolazione. Serve almeno un bersaglio; due per «usa X con Y» e «dai X a Y», dove `target` è ciò che si impugna e `second_target` ciò su cui si agisce |
| `talk` | entrare in un dialogo, o una battuta secca che non apre una conversazione |

I verbi del giocatore però sono **quattro**: c'è anche `vai`, e non compare in
questa tabella solo perché si scrive **in un altro campo** — le `exits` del
luogo, non le `actions`. Esattamente come `guarda` da solo, che è il `look`
della fase e non un'azione: dove finisce un verbo nel file è una domanda
diversa da quanti verbi ci sono.

Serve saperlo per il caso in cui i due campi sconfinano l'uno nell'altro:
**un gesto che si dice come un movimento e non cambia luogo resta un'azione.**
Salire su un albero, entrare in un armadio, calarsi in una botola che è una fase
e non una stanza sono `use` sull'oggetto, e il player ci arriva lo stesso — la
sua regola è che il complemento decide, e un albero non è un passaggio. Non
forzare un'uscita verso il luogo stesso per far tornare il verbo.

**Dove vive un'azione.** Sul **luogo** (`Place.actions`) quelle che valgono in
qualunque fase — accendere qualcosa al camino, guardare gli scaffali, parlare con
chi non se ne va; sulla **fase** (`Phase.actions`) quelle che hanno senso solo in
quello stato. Le due liste si sommano.

Nel dubbio, mettila sul luogo. Un'azione **necessaria** che vive in una fase sola
sparisce appena lo stato cambia la fase, e la storia resta senza soluzione: è un
vicolo cieco che non si vede leggendo — l'azione c'è, l'oggetto c'è, la condizione
è soddisfacibile — e si scopre solo giocando, un atto più in là. Sulla fase vanno
le azioni che *quello stato* rende possibili, non quelle che *quello stato* si
limita a non impedire.

**Non scrivere un'azione per ogni coppia possibile.** Scrivi quelle che *fanno*
qualcosa. Guardare un oggetto che ha una `description` funziona già senza
azione — il player risponde con quella —; «usa il muro» riceve un rifiuto
contestuale. Il tetto deciso dall'utente conta le **entità** su cui il luogo
risponde, non le combinazioni.

Conseguenza concreta, e vale per metà delle azioni di una sceneggiatura: **una
pura osservazione non è un'azione, è la `description` di un oggetto
d'ambiente.** Se il testo che il giocatore leggerebbe non cambia niente — niente
flag, niente inventario, niente dialogo, niente spostamento — quel testo va nel
prop e l'azione non si scrive. «Guarda fuori dal finestrino», «osserva lo
schedario», «guarda la bocca della rampa» sono tre prop con tre descrizioni,
non tre azioni. Si guadagna due volte: il budget del luogo resta per le cose che
succedono, e la descrizione smette di essere un campo che nessuno legge.

**Due azioni con lo stesso verbo e lo stesso bersaglio sono la forma normale di
«la stessa cosa, in due momenti diversi».** Parlare a Mark della scatola e
parlargli quando è già otto metri più su sono due `talk` su `mark`, con
condizioni **disgiunte** — e disgiunte davvero: se la seconda si apre mentre la
prima è ancora aperta, il parser ha due candidate identiche e risponde con un
non-ho-capito. Il modo giusto di renderle disgiunte è aggiungere alla prima il
`flag_absent` di quello che apre la seconda. Fatto questo, il player sceglie da
sé quella che si può fare.

**Due azioni sullo stesso bersaglio devono avere effetti diversi.** Se guardare
Tommy e chiamare Tommy fanno la stessa identica cosa, l'unica differenza fra le
due è il verbo — e ogni frase in cui il verbo non si riconosce le trova pari e
risponde con un non-ho-capito. O ne scrivi una sola, o quella che guarda dice
davvero cosa si vede.

**Quando il bivio non ha un bersaglio, è un dialogo.** «Urla» e «resta ferma e
non dire niente» sono due esiti dello stesso istante, e il secondo non nomina
niente: a input libero non si può scrivere, perché non c'è complemento su cui
agganciarlo. Nel dialogo l'elenco si vede sempre, ed è esattamente il caso per
cui il dialogo esiste. Vale anche quando le alternative portano tutte allo
stesso posto e cambia solo la prosa: **una azione che apre il dialogo**, e le
varianti come scelte. Il testo di una scelta può essere una didascalia e non una
battuta — «Allunga una mano e afferra il volante» — e non è una forzatura: è
come la sceneggiatura scrive un'esitazione.

Per ogni azione:

- **`condition` + `blocked_narration`, sempre insieme.** Non esiste la deroga
  «questa condizione nessuno la incontrerà mai al contrario»: chi gioca a parole
  prova le cose nell'ordine che gli viene in mente. La `blocked_narration` è
  d'autore e specifica («la cordicella penzola a tre metri»), mai un rifiuto
  generico.
- **`test_phrases`: 3-5**, scritte *lontane* dagli alias delle entità. Nessun
  player le legge: le legge il linter, che le passa al parser e conta quante
  arrivano dove devono. Copiarle dagli alias misura il lookup, non il richiamo.

  Lontane dagli alias, però, non vuol dire slegate: **una frase di prova deve
  nominare il bersaglio e usare la famiglia di verbi dell'azione.** Nel modello a
  verbi il punteggio è *quanto il complemento somiglia al bersaglio* per *quanto
  il verbo somiglia a quello dell'azione*: una frase che non nomina niente non ha
  su cosa agganciarsi, e una frase che guarda dove l'azione manipola vale metà —
  giustamente, perché «guardo cosa c'è nel cassetto» è una domanda a cui risponde
  la descrizione del cassetto, non un ordine di aprirlo. Se una prova ti viene
  senza nominare la cosa, il problema è quasi sempre che stavi scrivendo per un
  parser ad alias d'azione, che non è questo.
- **`repeatable: false`** per i gesti che hanno senso una volta sola (prendere).
- **`effect`**: cosa succede. `narration` è quello che si legge dopo; `set_flag`,
  `add_inventory`, `goto_dialogue` cambiano lo stato; `goto_place` sposta il
  giocatore ed è il modo in cui si paga il costo di un errore.

## 6. I dialoghi

Dentro un dialogo si sceglie da un elenco, sempre. Conseguenza sulla
compilazione, più importante del meccanismo: **nel dialogo non si nasconde niente
che il giocatore debba scoprire da solo.** Gli enigmi stanno nelle azioni e nel
testo; il parlato caratterizza, informa e fa scegliere.

- **Grafo, non sequenza.** Ramificazioni e riconvergenze, percorsi che si aprono
  e si richiudono in base allo stato. Una fila di battute con un solo `next` per
  nodo è una cutscene travestita.
- **`text_variants`** per le battute che si risentono: quando la stessa azione di
  dialogo si ripete, un disco rotto rompe l'immersione più di una battuta
  mediocre.
- **Le didascalie sono nodi con `speaker: "narrator"`**, o l'`effect.narration` di
  una scelta (che si applica dopo il tocco e prima del nodo di destinazione). Sono
  le righe che nella sceneggiatura stanno *fra* due battute e dicono cosa succede
  mentre si parla. **Non toglierle.** Un dialogo a cui sono state tolte si gioca
  benissimo e non se ne accorge nessuno finché non lo si legge: il linter conta il
  rapporto fra nodi e didascalie proprio perché è una perdita silenziosa.
- Ogni ramo deve **chiudersi** (`end: true`) o riconvergere. Un nodo senza
  scelte, senza `next` e senza `end` è monco.

## 7. Flag e oggetti

- Un flag appartiene a **questo atto** e va elencato nei suoi `flags`. Se ti
  serve un flag che sopravvive all'atto, quasi sempre ti serve un **oggetto**.
- Un oggetto che cambia stato è un **altro oggetto**: `remove_inventory` +
  `add_inventory` nello stesso effetto.
- Prima di rendere **facoltativa** la presa di un oggetto, chiediti: *da qui,
  senza questo, si arriva ancora alla fine?* È il vicolo cieco che il linter non
  vede — staticamente l'oggetto esiste, l'azione che lo dà esiste, la condizione
  è soddisfacibile. Il rimedio generale: **la porta che chiude l'atto chiede
  l'oggetto**, così la scelta di prenderlo resta al giocatore e la storia resta
  finibile.

## 8. Fallback (`no_match_narration`)

Le risposte di **questa fase** per quando il gioco non capisce, categorizzate per
intenzione: `perception`, `manipulation`, `communication`, `movement`, `generic`.
Vincono sui fallback globali di `player_voice`.

Scrivine **più d'una per intenzione**: il player le sceglie a rotazione, e la
varietà viene da qui. Devono essere **in tono con la fase** — è tutto il punto di
scriverle in compilazione invece di generarle — ma devono suonare come *non ho
capito*, non come *hai sbagliato strada*: un rifiuto pertinente e convinto mente
con convinzione al giocatore che aveva ragione e ha solo scelto male le parole.

Il `generic` non si omette mai: è la rete sotto tutte le altre.

## 9. Finali

Una fase che chiude la storia porta `ending`:

- **`natural`** — la fine a cui la storia tende. Ce n'è sempre almeno una
  raggiungibile, in qualunque modalità.
- **`premature`** — solo se la storia dichiara `failure_mode:
  alternate_endings`, e con un vincolo che il linter fa rispettare: **ci si
  arriva soltanto da un'azione**, mai da un'uscita, mai per omissione, mai per
  aver sbagliato l'ordine delle cose. Il giocatore deve poter dire «l'ho fatto
  io».

## Vincoli tecnici

- Solo i campi previsti dallo schema: niente proprietà inventate, in nessun
  oggetto. Un campo plausibile ma non previsto fa fallire la validazione, ed è
  voluto.
- Il campo **`image` non lo scrivi tu** (lo scrive il modulo assets), tranne
  quando stai ricompilando una storia che ne ha già: lì si conserva insieme
  all'id.
- Ogni prompt di generazione in due lingue: l'italiano canonico, l'inglese per il
  modello. Nei soli `image_prompt_en` i personaggi in campo si chiamano per nome.
- Gli id sono `^[a-z0-9_-]+$` e vengono dalla story map quando ci sono.

## Se ricevi un errore di validazione

Correggi **solo** quello che è segnalato e rivalida. Non riscrivere il luogo da
zero per un campo fuori posto: è il modo più rapido di perdere le decisioni
giuste prese insieme a quella sbagliata.
