# ZAiStory

Motore narrativo interattivo moderno — nello spirito dei punta-e-clicca SCUMM,
ma leggero. Il giocatore agisce con quattro gesti soli: **guarda**, **usa**,
**parla**, **vai**. Si gioca scrivendo; nei dialoghi si sceglie.

L'autore scrive la sceneggiatura in **markdown libero**, in un formato pensato
per la creatività e non per la macchina. Un compilatore la trasforma nel file
giocabile e player-agnostic `<id>.zaistory.json`, che alimenta la generazione
degli asset e il player.

```
sceneggiatura.md  ─►  COMPILATORE  ─►  <id>.zaistory.json  ─┬─►  PLAYER  (web + CLI)
   (markdown libero)                     (il contratto)     │      testo, e immagini se ci sono
                                                            └─►  ASSETS  ─►  assets/images/
                                                                 (immagini)     + gli id nel file
```

Il file zaistory è il contratto che tiene i componenti disaccoppiati: nessuno di
loro sa nulla degli altri. Non è un formato intermedio — è il prodotto finale,
quello che si gioca.

## Com'è fatta una storia

Una storia è divisa in **atti**, ognuno dei quali contiene **luoghi**. Il luogo
è il nodo del gioco: ci si entra, ci si guarda intorno, ci si agisce e ci si
torna. Dentro un luogo le **fasi** dicono com'è adesso, e cambiano con lo stato
della partita.

Il giocatore si muove liberamente fra i luoghi di un atto — anche tornando in
quelli già esplorati — e l'atto si chiude quando i suoi ambienti sono
completati. L'unica cosa che attraversa il confine fra un atto e il successivo è
l'inventario.

Di norma **non si perde**: qualunque cosa si faccia si arriva allo stesso
finale, e ciò che cambia è quanto costa arrivarci. Una storia può però
dichiarare di ammettere finali alternativi e prematuri, in stile Sierra.

## Stato

**Prototipo, e in ricostruzione.** Le specifiche sono cambiate in modo
distruttivo dopo il collaudo sul campo. Sono già sul formato **zaistory 1.0.0**
`SPECS.md`, `ARCHITECTURE.md`, la skill del compilatore e tutto il **player**
(core, linter, copertura, CLI e faccia web). Restano da rifare il **modulo
assets** e le due storie in `stories/`, che leggono ancora `story.ir.json`.
L'ordine sta in `ARCHITECTURE.md`, sezione «Stato del lavoro».

Quello che esiste e funziona, sul modello precedente: il **compilatore**,
realizzato come skill Claude che applica le regole di progetto direttamente in
conversazione; il **player** (`player/`, TypeScript), con due facce sullo stesso
core — una **web** per giocare dal telefono o dal desktop, una **CLI** per il
linter e i playthrough di regressione headless; e il **modulo assets per le
immagini** (`assets-studio/images/`), che le estrae, le genera, le fa guardare
una per una in uno studio web e pubblica nella storia quelle marcate definitive.
Voce e suoni sono progettati ma non ancora costruiti.

Il player è **il** player del progetto, non un banco di prova: la stessa build
serve chi sviluppa, chi collauda e chi gioca, e a distinguerli è un interruttore
— il debug — non un'applicazione diversa.

**Si gioca scrivendo**, non scegliendo da un elenco. Il pezzo che lo rende
possibile non è un modello: è il compilatore, che scrive in anticipo sia gli
agganci con cui una frase arriva alla cosa giusta sia le risposte d'autore per
quando non ci arriva. Il player non inventa una riga — e un testo scritto in
compilazione, a differenza di uno generato al volo, un linter può controllarlo.

Una storia è **una cartella** (`stories/<id>/`): il file giocabile, la
sceneggiatura, i playthrough, gli asset pubblicati e il banco di lavoro del
generatore. Vedi [stories/README.md](stories/README.md).

## Provare subito

> ⚠️ I comandi qui sotto girano sul modello precedente (`story.ir.json`) finché
> la ricostruzione non è finita.

### Giocare dal telefono

```bash
./start_local_player.sh          # costruisce, incorpora le storie, serve su http
```

Stampa gli indirizzi di rete della macchina: dal telefono, sulla stessa wi-fi,
si apre uno di quelli. Per *giocare* basterebbe mandarsi il file `.html`, che
funziona anche offline; passare da http serve a una cosa sola ma importante per
collaudare il resolver — è l'unico modo di provare il backend a **vettori** da
mobile, perché da `file://` il browser tratta la pagina come origine opaca e il
modello non si scarica.

```bash
./start_local_player.sh 8080                       # altra porta
./start_local_player.sh 8080 stories/metal-head    # una storia sola
```

Il player finisce **dentro** la cartella della storia (`play.html`): è così che
trova le immagini pubblicate, che il file nomina per id e non per percorso.

### A mano

```bash
cd player && npm install

# player web: un unico file HTML, si apre anche da file://
npm run build:web
npm run embed -- ../stories/nel-paese-dei-ciechi/story.ir.json \
  ../stories/nel-paese-dei-ciechi/play.html

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../stories/metal-head/story.ir.json                    # gioca
node dist-node/src/cli/zaiplay.js --lint ../stories/nel-paese-dei-ciechi/story.ir.json   # controlli statici
node dist-node/src/cli/zaiplay.js --copertura ../stories/metal-head/story.ir.json        # quanto capisce il resolver

npm run serve -- 8000 ../stories
node dist-node/src/cli/zaiplay.js \
  --script ../stories/nel-paese-dei-ciechi/playthrough/completo.txt \
  ../stories/nel-paese-dei-ciechi/story.ir.json                                          # rigioca la partita di riferimento
```

### Le immagini

```bash
# estrai i job, poi apri lo studio: si guarda, si rifà, si marca definitivo
# quello che convince, e il pulsante «Pubblica» le porta nella storia
python assets-studio/images/extract_manifest.py stories/metal-head/story.ir.json \
    -o stories/metal-head/_work/assets_manifest.json
./start_assets_studio.sh stories/metal-head

# oppure, senza interfaccia
python assets-studio/images/publish.py stories/metal-head --dry-run
```

## Contenuto del repository

| Percorso | Cosa |
|---|---|
| `skills/zaistory-compiler/` | Il compilatore sceneggiatura → file giocabile (skill Claude) |
| `skills/zaistory-compiler/references/zaistory.schema.json` | Lo schema — il contratto del progetto |
| `skills/zaistory-compiler/scripts/` | Validatore e segmentatore |
| `player/` | Il player: web e CLI (`zaiplay`) sullo stesso core, linter di giocabilità, script di playthrough |
| `assets-studio/` | Gli strumenti che trasformano i prompt in asset: una cartella per tipo — oggi `images/`, domani voce e suoni |
| `assets-studio/images/` | Immagini: estrazione del manifest, generazione, studio web, prototipazione, pubblicazione |
| `start_local_player.sh` | Costruisce il player, lo incorpora in ogni storia e serve `stories/` in rete locale |
| `start_assets_studio.sh` | Chiede su quale storia aprire lo studio degli asset e lo serve in rete locale |
| `stories/` | Le storie: una cartella ciascuna |

## Documentazione

- **[SPECS.md](SPECS.md)** — i paletti: le regole fondamentali a cui il progetto
  si attiene. È il documento che comanda.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — le decisioni di progetto e il perché
  di ciascuna. Da leggere prima di mettere mano a qualsiasi cosa.
- **[AGENTS.md](AGENTS.md)** — regole operative per gli agenti di coding.
- **[player/README.md](player/README.md)** — come si usa il player, i comandi,
  gli script di playthrough e il linter.
- **[assets-studio/images/README.md](assets-studio/images/README.md)** — la
  catena delle immagini: manifest, generazione, studio, pubblicazione, e i
  numeri dei ventuno modelli provati.
- **[stories/README.md](stories/README.md)** — com'è fatta la cartella di una
  storia e perché.
