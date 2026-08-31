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
npm run build:web               # -> dist/index.html (~120 KB, tutto dentro)
npm run embed -- ../stories/nel-paese-dei-ciechi/story.ir.json \
                 ../stories/nel-paese-dei-ciechi/play.html

# ...e per giocarlo dal telefono (o per provare il backend a vettori)
npm run serve -- 8000 ../stories # serve le storie e stampa gli indirizzi

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../stories/nel-paese-dei-ciechi/story.ir.json
```

Serve solo Node 22+. Nessuna dipendenza a runtime: TypeScript e Vite sono
soltanto strumenti di build, e il codice spedito al browser non importa niente
da `node_modules`.

## Giocare dal telefono

```bash
../start_local_player.sh        # build + embed in ogni storia + serve
```

Stampa gli indirizzi di rete della macchina; dal telefono, sulla stessa wi-fi,
si apre uno di quelli. Il server è una cinquantina di righe di Node senza
dipendenze, serve `stories/` e non fa altro.

Il player incorporato finisce **dentro** la cartella della storia
(`stories/<id>/play.html`), e non è un dettaglio di comodo: le immagini
pubblicate stanno in `stories/<id>/assets/images/` e l'IR le nomina per id, non
per percorso. Una pagina che sta lì le trova — servita da http, e anche copiata
altrove insieme alla sua cartella.

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

## Tema

Uno solo, scuro, e non segue il tema di sistema. Da quando ci sono le immagini
il fondo non è più soltanto lo sfondo del testo: un bianco intorno a
un'inquadratura cel-shaded ne cambia la lettura, ed è la ragione per cui i
visori di foto sono tutti scuri.

## Testo o immagini

Sono **due modi di leggere la stessa storia**, e si scelgono dal pannello,
scheda principale, sotto «come si vede»:

| modo | cosa si vede |
|---|---|
| **testo** | i prompt e la scheda della scena, come se le immagini non ci fossero: è così che si legge *cosa verrebbe generato*, ed è il modo con cui si lavora sull'IR |
| **immagini** | le immagini pubblicate **al posto** dei prompt che le hanno prodotte |

Mostrare tutti e due insieme sembrava gratis e non lo è: fra un'inquadratura e
la sua descrizione l'occhio sceglie l'immagine, il testo diventa mezzo schermo
di rumore, e la scena si legge peggio che senza immagini.

I prompt però non spariscono, si **chiudono**: le righe che l'immagine mostra
già restano nel transcript su una riga sola, con il triangolino, e si aprono
toccandole. È lo stesso trattamento del luogo che un beat eredita dalla scena,
per la stessa ragione: ci sono, ma non sono la notizia. Il prompt di ciò che si
sta guardando *adesso* si legge invece dove si guarda l'immagine, cioè a
schermo intero, come didascalia.

Cosa si chiude e cosa no: **l'immagine sostituisce solo ciò che
mostra** — l'`image_prompt`, il `visual_prompt` del luogo, e i due riferimenti
che dicono dove siamo e chi è in campo. L'ambiente sonoro, gli effetti e i
timbri di voce restano in chiaro: quelli un'immagine non li mostra, e sono
l'unico modo di sapere che ci sono.

La scelta compare **solo quando c'è qualcosa da scegliere**, cioè quando la
storia ha immagini pubblicate e il player sa dove cercarle. Negli altri due
casi al suo posto c'è una riga che dice quale dei due pezzi manca — un
interruttore che non cambia niente è peggio della sua assenza.

Nell'IR le immagini sono **id** (`"image": "shot.auto_in_viaggio.bg"`), e il
percorso lo compone il player: `assets/images/<id>.webp`, relativo alla
cartella della storia.

Quale cartella, lo decide da dove è arrivato l'IR:

| l'IR arriva… | le immagini si cercano… |
|---|---|
| incorporato nella pagina (`play.html` dentro la storia) | accanto alla pagina |
| da `?ir=.../stories/x/story.ir.json` | accanto a quell'URL |
| scelto a mano — file, trascinamento, incolla | da nessuna parte: si gioca in solo testo |

L'ultima riga non è una mancanza: un IR aperto a mano non ha una cartella
storia intorno, e il pannello lo dice invece di lasciar credere che le immagini
siano rotte. Lì si vedono i prompt, come si è sempre fatto.

**Toccando un'immagine si apre a schermo intero**, con sotto il prompt che
l'ha prodotta. Sul palco l'immagine accompagna la lettura; a schermo intero si
*guarda*, ed è guardarla che serve quando si sta decidendo se un asset va bene.
Si chiude con un tocco ovunque, con Esc o con la ✕.

**Un oggetto dell'inventario mostra la sua icona quando lo si guarda**: sia
scrivendo «guarda il walkie», sia toccandolo nell'elenco dell'inventario, che
è la stessa risposta d'autore per le due strade. Nell'elenco delle chip no: lì
l'oggetto è una voce di menu, e dieci miniature in fila sono un inventario da
gioco di ruolo, non la risposta a «cosa ho in mano».

## Il palco

L'inquadratura corrente **sta ferma** e il racconto le scorre sotto: in cima
allo schermo su telefono in verticale, nella colonna di sinistra da 900 px di
larghezza in su (e su uno schermo basso e largo, cioè un telefono coricato).
Ogni immagine nuova **prende il posto** della precedente; un beat senza `image`
non svuota niente, resta quella di prima — che è esattamente ciò che succede
quando la macchina non si è spostata.

Finché le figure scorrevano dentro il transcript come il testo, quella di
adesso usciva dallo schermo appena si scorreva per leggere la riga che la
commenta: si faceva avanti e indietro fra il testo e la sua illustrazione, due
movimenti per una cosa sola.

La maniglia sotto l'immagine (di fianco, in due colonne) la **riduce**, e sono
due misure sole — grande e ridotta. Quanta altezza tenersi dipende da cosa si
sta facendo: in un dialogo lungo serve leggere, davanti a una scena nuova serve
guardare. Chiuderla del tutto non serve alla maniglia: si spengono le immagini
dal pannello, che è una scelta sulla storia e non sul momento.

Nel flusso restano solo le immagini che **non** sono inquadrature — il ritratto
di un personaggio e l'icona di un oggetto — perché quelle sono riferimenti
dentro un discorso e stanno accanto alla riga di cui parlano. L'immagine sul
palco non viene mai ritagliata per riempirlo: ritagliare butterebbe via proprio
la parte che nello studio si è scelta guardando.

Altre due cose che vale la pena conoscere:

- **un'immagine dichiarata e non trovata si dice**, con il suo id, dov'era
  attesa. Stessa regola del testo mancante: il player non riempie i buchi e non
  mette segnaposto muti;
- **cambiare modo vale da lì in avanti.** Il transcript è il resoconto di quello
  che è successo, non una vista che si ridisegna: le scene già lette restano
  come sono state lette. La scelta si conserva nelle impostazioni, insieme a
  voce e resolver.

Un nodo senza immagine mostra i suoi prompt anche in modalità immagini — che è
il caso normale di una storia pubblicata a metà: si vede a colpo d'occhio cosa
manca ancora.

In terminale l'immagine non si vede, ma l'id si stampa come ogni altro campo:
un beat con `image_prompt` e senza `image` è un beat che nel web resterebbe
senza inquadratura, e il playthrough di regressione lo mostra senza aprire un
browser.

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

**Tutti** i prompt di generazione asset si vedono sempre, attaccati al punto
della storia a cui appartengono. Ogni campo però ha **due nomi**, e nel
documento ci sono sempre tutti e due: chi gioca legge «voce», «inquadratura»,
«ambiente», «aspetto»; col debug acceso tornano i nomi veri —
`narration_voice.style_prompt`, `image_prompt`, `background`,
`characters.laura` — che sono quelli da citare a chi compila la storia. A
scegliere è il CSS, non il codice, quindi accendere il debug vale anche per il
transcript già scorso, come per ogni altra diagnostica. Stessa regola per i
valori che sono id (il luogo di un'inquadratura, chi c'è in campo, la prima
scena in copertina: nome a chi legge, id a chi ispeziona) e per la riga sotto
il titolo, dove la versione dell'IR e il conto del linter sono informazioni sul
*file* e non sulla storia. La tabella qui sotto usa i nomi dell'IR:

| dove compare | campi |
|---|---|
| copertina | `global_style.image_style_suffix`, `.narrator_voice.style_prompt`, `.ambient_music_tags`, e per ogni personaggio della roster `characters.<id>.visual_prompt` e `.voice.style_prompt` |
| intestazione di scena | `scene_type`, `scene_tone`, `background.image_prompt`, `background.ambient_sound_prompt`, e per ogni personaggio in scena `characters.<id>.visual_prompt` e `.voice.style_prompt` (marcati `(override)` quando la scena sovrascrive la roster globale) |
| appesi a un beat | `image_prompt`, `sound_effect_prompt`, `voice.style_prompt` |
| appesi a una battuta | `voice_override.style_prompt` |
| dopo un effetto | `narration_voice.style_prompt`, `play_sound_prompt` |

L'etichetta porta il **tipo di risorsa** due volte: nel colore e in un segno
disegnato accanto al nome del campo — una cornice per le immagini, un
altoparlante per i suoni, una bocca per le voci, due note per la musica, e sui
gruppi una testa per i personaggi, uno spillo per i luoghi, dei cursori per lo
stile globale. Il colore da solo chiede di ricordarsi la legenda, e chi legge
la storia la legenda non ce l'ha. Sono disegni e non emoji perché prendono il
colore del testo e non cambiano faccia a ogni sistema, e sono misurati in `em`
perché a 12px fissi, accanto a un'etichetta piccola, su un telefono erano una
macchia. La stessa tassonomia vale nella CLI, con i colori del terminale.

Un campo nuovo che non sia in `src/web/nomi.ts` esce col suo nome tecnico anche
a chi gioca: meglio accorgersene aggiungendo una riga a quella tabella che
scoprirlo in mezzo a una storia.

Non vengono né generati né riprodotti — il player è testuale — ma sono il
segnaposto di quello che un giorno sarà immagine, suono e voce. È leggendoli
mentre si gioca che ci si accorge che un beat ha cambiato inquadratura senza
dirlo, che un suono manca o che una scena ha sovrascritto la voce di un
personaggio senza motivo: si rilegge la storia con gli occhi del modulo assets,
prima che il modulo assets esista.

Il tasto **debug** aggiunge la diagnostica intorno, e lo fa retroattivamente su
tutto il transcript già scorso: id di scene e nodi, conteggi,
`on_enter_flags_set`, condizione ed effetto di ogni voce, e **le azioni
filtrate con il motivo per cui non compaiono** — che è la domanda che ci si
pone il 90% delle volte quando si testa una storia. Sta in due posti, ed è lo
stesso interruttore: in alto a destra nella barra, sotto il pollice mentre si
gioca, e in fondo al menu accanto al numero di versione, che è dove lo si cerca
quando il player lo si sta usando e non programmando.

Il menu `☰` si apre e si chiude con la stessa icona nello stesso posto — in
alto a sinistra — perché è un interruttore e non due comandi diversi. Dentro,
le schede si dividono in due gruppi: le prime quattro sono per chi gioca, le
ultime tre **compaiono solo a debug acceso**, per la stessa ragione per cui le
chip delle azioni stanno sotto il debug — un elenco di flag o di azioni risolve
gli enigmi al posto del giocatore.

| scheda | cosa mostra | |
|---|---|---|
| `principale` | dove sei e cosa hai in mano | |
| `disco` | il codice con cui si riprende la partita altrove | |
| `interprete` | quale backend traduce la frase scritta in un'azione | |
| `ascolto` | la storia recitata invece che letta | |
| `stato` | scena corrente, flag attivi, scene visitate, e tutti i parametri della scena con **tutte** le sue azioni, ✓/× e motivo | debug |
| `linter` | le segnalazioni statiche, per gravità | debug |
| `traccia` | la sequenza giocata, da copiare — e una casella per rigiocarne una | debug |

In `principale` le cose si chiamano con le parole della storia — il titolo
della scena, il nome dell'oggetto — mentre gli id restano in `stato`, che è
dove si va quando si sta collaudando invece di giocando.

**Gli oggetti dell'inventario si toccano**: il menu si chiude e la descrizione
compare nel transcript, identica a quella che si otterrebbe nominandoli mentre
si gioca — stesso `items[].description`, stesse `description_variants`, quindi
il walkie scarico e quello carico restano due risposte diverse. Non è un turno
di gioco: nessun `Effect`, niente nella traccia. Un oggetto senza
`description` non è toccabile: non c'è niente da leggere e il player non lo
inventa (il linter lo segnala come errore, ed è lì che va risolto).

In fondo al menu, accanto al numero di versione, stanno i due comandi che non
appartengono a nessuna scheda: **ricomincia**, che vale per tutta la partita, e
**debug**, che vale per tutto il player. Ricominciare chiede conferma, e nella
domanda dice dov'è il codice da copiare prima: da quando la partita si può
portare via, è l'unico bottone del player che distrugga qualcosa di
irrecuperabile.

Le schede vanno a capo invece di scorrere. Erano una striscia scorrevole e col
dito funzionava, ma col mouse no — barra nascosta, niente trascinamento, la
rotellina scorre in verticale — e da desktop, a debug acceso, le ultime schede
erano irraggiungibili. Sette voci ci stanno su due righe, e su due righe si
vedono tutte insieme.

### Salvare e riprendere

La scheda `disco` mostra **un codice solo** (`ZAI1.…`, una riga di base64) che
contiene due cose distinte: la partita fin qui e le impostazioni del player. Si
copia, si manda dove si vuole — una mail a se stessi, una nota, una chat — e si
incolla dall'altra parte: è così che si passa dal desktop al telefono. Non c'è
nessun server e non c'è nessuna memoria: chiudendo la pagina non resta niente,
quello che non è stato copiato è perso.

Dentro non c'è niente di nuovo. La partita è la sua traccia — il resolver può
solo scegliere fra azioni già definite, quindi la sequenza degli id *è* la
partita — e le impostazioni sono i parametri che già vivevano fuori da essa
(voce e modalità ascolto, backend del resolver e indirizzi dell'embedder,
debug). Da qui la scelta al momento di caricare: **la partita, le impostazioni
o entrambe**. Chi si porta la partita sul telefono di solito vuole anche la sua
voce; chi ricomincia da capo sul desktop vuole solo quella.

Il campo di caricamento accetta anche una **traccia in chiaro**, cioè quello che
copia la scheda `traccia` (sotto debug) e quello che contengono i file `.playthrough.txt`: in
quel caso non c'è nessuna impostazione da prendere e nessun modo di sapere di
quale storia sia.

Il salvataggio porta con sé `story_id` e `ir_version`, e servono a due controlli
diversi. Partita di **un'altra storia**: rifiutata, perché rigiocare quegli id
qui non darebbe un errore — darebbe una partita sbagliata in silenzio, che è il
modo peggiore di sbagliare (le impostazioni restano comunque prendibili). Stessa
storia ma **IR diverso**: solo un avviso, perché lì il caso peggiore è già
gestito — se la storia è cambiata dove passava la partita la traccia finisce
prima, e una traccia che finisce restituisce il gioco a chi lo sta giocando.

Il codice è volutamente **sincrono e non compresso**: comprimere nel browser
vuol dire `CompressionStream`, che è asincrono, e una `await` prima di
`clipboard.writeText()` fa scadere il gesto dell'utente e la scrittura negli
appunti viene rifiutata. Qualche kilobyte di base64 si incolla ovunque; una
copia che fallisce a intermittenza no. Se un giorno servirà una
sincronizzazione automatica fra device, sarà un'aggiunta *sopra* questo
formato — lo stesso blob spedito a un endpoint — non una cosa al posto suo:
questo è l'unico meccanismo che funziona anche da `file://` e dentro una pagina
pubblicata che non può fare richieste verso l'esterno.

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

Nel player web la stessa traccia è anche un **salvataggio**: si incolla nella
scheda «traccia» del pannello, viene rigiocata in un istante, e poi il gioco
continua da lì. La traccia riprende a crescere mentre si gioca, quindi si può
ricopiare e risalvare quando si vuole. In CLI no, e non è una svista: lì una
traccia che si esaurisce prima del finale è un test fallito e fa uscire con 1.


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

### Quando la scena è finita

Le azioni non si elencano — si gioca scrivendo — ma quando in una scena non
resta più niente da fare **e l'uscita è una sola**, quella compare come chip,
con la label che le ha dato l'autore. «Niente da fare» vuol dire: ogni azione
disponibile che non sia un'uscita è già stata eseguita, oppure è pura
osservazione (narrazione e suono, nessun flag, nessun oggetto, nessun dialogo).

Il vincolo dell'uscita unica non è prudenza: una scena il cui unico contenuto è
un bivio — quattro azioni che portano tutte fuori — soddisfa «non resta niente
da fare» fin dal primo istante, e mostrarle tutte vuol dire stampare il menu
delle scelte.

È l'unica parte del dock che la modalità ascolto recita.

### Diagnostiche

Dove l'IR non ha il testo che servirebbe, il player ripiega sul fallback
d'autore e mette la nota fra parentesi **sotto il debug**: chi gioca non legge
mai un messaggio di errore al posto della storia. Il segnale non si perde — il
linter le elenca tutte prima ancora di giocare, come avvisi.

Diverso `problem()`, che si vede sempre: quello segnala un IR **rotto** (un
`goto` verso un id che non esiste), non una prosa che manca, e lì non c'è
niente da leggere al suo posto.

### Oggetti che si hanno in mano

Se una frase non trova né un'azione né un verbo del player, ma **nomina un
oggetto dell'inventario**, si legge la sua descrizione invece del fallback per
intenzione:

```
· usa il walkie
Un apparecchio da cantiere, plastica gialla sbucciata. E' spento: la barretta
della batteria e' vuota da prima che la storia cominciasse, e un
caricabatterie lei non ce l'ha.
```

Sono entrambi testi d'autore, ma il fallback è scritto per l'intenzione e della
cosa appena nominata non sa niente. La precedenza resta quella di sempre:
un'azione della scena vince.

### «Cosa posso fare?»

Un verbo del player, come «guardati intorno». Risponde con i **bersagli** delle
azioni disponibili — gli oggetti e le persone su cui la scena risponde, con il
loro nome d'autore — non con le azioni:

```
· cosa posso fare
In gioco: la cassa di legno e Tommy.
```

Dice dove guardare, non cosa fare: l'enigma resta intero. Restano fuori i
bersagli delle azioni ancora bloccate da una condizione, il protagonista, e i
`target` generici (`"ambiente"`).

La risposta somma due pezzi: il `look` della scena **com'è adesso**
(`look_variants` comprese) e i bersagli delle azioni disponibili. Il `look` è
quello che porta l'indizio, perché è l'unico testo che cambia con lo stato, ed è
dove l'autore nomina le cose della stanza. Così un IR conforme non produce mai
una nota diagnostica — quelle restano per i buchi veri, non per i campi che lo
schema lascia opzionali.

È anche l'unica frase consultata **prima** del resolver: non è un tentativo di
agire sul mondo ed è l'unico modo di garantire che chiedere aiuto non faccia
partire un'azione. Conseguenza: una storia non può avere un'azione chiamata
esattamente «aiuto».

Si riconosce da: «cosa posso fare», «che si fa adesso», «aiuto», «sono
bloccato», «non so cosa fare», «suggerimento», «suggeriscimi qualcosa». Con un
complemento non vale più — «cosa posso fare con la leva» è un'azione della
scena, e scipparla all'autore sarebbe peggio del non capirla.

### Didascalie nei dialoghi

Un nodo con `speaker: "narrator"` non è una battuta: è la didascalia, quella che
nella sceneggiatura sta fra due battute e dice cosa succede mentre si parla. Si
legge come prosa, senza nome davanti — e in modalità ascolto si sente senza
«Narratore» in testa.

Un dialogo a cui sono state tolte si gioca benissimo e nessuno se ne accorge
finché non lo legge: le battute ci sono tutte, i playthrough passano. Per questo
il linter conta il rapporto fra nodi e descrizioni e lo segnala.

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
src/web/      player web: transcript, chip, pannello, ascolto, immagini
src/cli/      terminale interattivo, esecutore di script, colori e wrap
scripts/      embed.mjs: incorpora un IR nella build web
test/         test di engine, linter, lettura dell'IR e salvataggi
testdata/     fixture: una storia sana e una deliberatamente rotta
```

Due vincoli architetturali si vedono direttamente nel codice:

- **il player non contiene logica narrativa propria**: non inventa azioni, non
  genera testo, non modifica lo stato se non applicando `Effect` già presenti
  nell'IR. Se qualcosa non si può fare è perché l'IR non lo prevede;
- **la lettura dell'IR è severa**: un campo non previsto dallo schema fa
  fallire il caricamento, esattamente come `additionalProperties: false` lato
  JSON Schema. Il player è anche un test di conformità dell'IR.

## Modalità ascolto

La stessa storia recitata invece che letta, per giocarla senza guardare lo
schermo. Si accende dalla scheda **ascolto** del pannello. Usa la sintesi
vocale del browser (`speechSynthesis`): nessuna dipendenza, e funziona anche
nel file HTML autonomo aperto da `file://`.

Cosa recita: narrazione, battute con chi le dice, esito dei comandi, scelte di
dialogo — e la **descrizione di ciò che si vedrebbe**, cioè i prompt delle
immagini. Finché l'immagine non esiste, il suo prompt letto ad alta voce *è*
l'immagine.

Le regole che la rendono ascoltabile:

- **si collassa come a schermo**: la prima volta la composizione per intero
  (luogo, inquadratura, aspetto dei personaggi), dalla seconda solo i nomi
  dell'ambiente e dei personaggi. Una scena nuova nello stesso luogo dice la
  sua inquadratura senza ridescrivere il luogo;
- **«guardati intorno» riapre tutto**: è il contrappeso del collapse, e non
  consuma la memoria — la volta dopo si torna a collassare;
- **il dock non si legge**: né «continua», né le scelte di dialogo, né la chip
  che hai appena toccato — si recita quello che è successo, non l'interfaccia
  con cui l'hai chiesto. Si sente invece l'azione riconosciuta da una frase
  scritta, che è la risposta a «ha capito quello che volevo». Alla fine di una
  scena il silenzio dice che tocca a te;
- **avanzamento automatico** (spegnibile): finita la lettura si prosegue da
  soli, tap-to-continue e unica uscita di una cutscene comprese. Con due azioni
  disponibili non si prosegue mai da soli.

Nella scheda ci sono anche il flag per recitare **anche suoni e tipi di voce**
(`ambient_sound_prompt`, `sound_effect_prompt`, `play_sound_prompt`, i
`VoiceSpec.style_prompt` — spento di default, serve a collaudare la resa sonora
di un IR senza guardarlo) e la scelta della voce di sistema con velocità, tono
e volume.

Ogni frase viene spezzata in pezzi da ~11 secondi prima di arrivare alla
sintesi, sui confini che il testo ha già: Chrome smette di parlare dopo ~15
secondi di una stessa utterance, e le descrizioni d'ambiente arrivano a 44. Il
limite scala con la velocità, così rallentare la voce non fa tornare il taglio.

Come ovunque nel player, **niente prosa inventata**: ogni frase recitata sta
nell'IR. Le uniche parole del player sono le etichette dei campi
(«Ambiente:», «Personaggio:», «Voce:», «Suono:»), quelle che a schermo stanno
scritte accanto al valore.

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

`test/ascolto.test.ts` fissa la regola del collapse acustico con una voce
finta: è l'unica parte della modalità ascolto che non si vede, e se sbaglia la
storia continua a funzionare — diventa solo insopportabile da sentire (il
paragrafo di un luogo ripetuto a ogni scena) oppure muta al primo ingresso.

Il test end-to-end vero resta il playthrough di riferimento:

```bash
node dist-node/src/cli/zaiplay.js \
  --script ../stories/nel-paese-dei-ciechi/playthrough/completo.txt \
  ../stories/nel-paese-dei-ciechi/story.ir.json
```
