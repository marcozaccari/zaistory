# ZAiStory

Motore narrativo interattivo moderno — nello spirito dei punta-e-clicca SCUMM,
ma leggero: niente verbo×oggetto, solo dialoghi a scelte multiple e azioni
contestuali.

L'autore scrive la sceneggiatura in **markdown libero**, in un formato pensato
per la creatività e non per la macchina. Un compilatore la trasforma in un
formato intermedio giocabile e player-agnostic (`story.ir.json`), che alimenta
la generazione degli asset e uno o più player.

```
sceneggiatura.md  ─►  COMPILATORE  ─►  story.ir.json  ─┬─►  PLAYER  (web + CLI)
   (markdown libero)                    (formato IR)   │      testo, e immagini se ci sono
                                                       └─►  ASSETS  ─►  assets/images/
                                                            (immagini)     + gli id nell'IR
```

L'IR è il contratto che tiene i componenti disaccoppiati: nessuno di loro sa
nulla degli altri.

## Stato

Prototipo. Funzionano tre pezzi: il **compilatore**, realizzato come skill
Claude che applica le regole di progetto direttamente in conversazione; il
**player** (`player/`, TypeScript), che gioca un `story.ir.json` e mostra le
immagini che la storia ha già; e il **modulo assets per le immagini**
(`assets-studio/images/`), che le estrae dall'IR, le genera, le fa guardare una per
una in uno studio web e pubblica nella storia quelle marcate come definitive.
Il player ha due facce sullo stesso core: una **web**, per provare la storia
dal telefono o dal desktop, e una **CLI**, per il linter e i playthrough di
regressione headless. È **il** player del progetto, non un banco di prova: la
stessa build serve chi sviluppa, chi collauda e chi gioca, e a distinguerli è un
interruttore — il debug — non un'applicazione diversa. Voce e suoni sono
progettati ma non ancora costruiti.

Una storia è **una cartella** (`stories/<id>/`): l'IR, la sceneggiatura, i
playthrough, gli asset pubblicati e il banco di lavoro del generatore. Vedi
[stories/README.md](stories/README.md).

Dalla versione 1.8.0 dell'IR **si gioca scrivendo**, non scegliendo da un
elenco. Il pezzo che lo rende possibile non è un modello: è il compilatore, che
scrive in anticipo sia gli agganci con cui una frase arriva all'azione giusta
(`aliases`) sia le risposte d'autore per quando non ci arriva
(`no_match_narration`, `look_variants`, `player_voice`). Il player non inventa
una riga — e un testo scritto in compilazione, a differenza di uno generato al
volo, un linter può controllarlo.

## Provare subito

### Giocare dal telefono

```bash
./start_local_player.sh          # costruisce, incorpora le storie, serve su http
```

Stampa gli indirizzi di rete della macchina: dal telefono, sulla stessa wi-fi,
si apre uno di quelli. Per *giocare* basterebbe mandarsi il file `.html`, che
funziona anche offline; passare da http serve a una cosa sola, ma importante
per collaudare il resolver — è l'unico modo di provare il backend a **vettori**
da mobile, perché da `file://` il browser tratta la pagina come origine opaca e
il modello non si scarica.

```bash
./start_local_player.sh 8080                       # altra porta
./start_local_player.sh 8080 stories/metal-head    # una storia sola
```

Il player finisce **dentro** la cartella della storia (`play.html`): è così
che trova le immagini pubblicate, che l'IR nomina per id e non per percorso.

### A mano

```bash
cd player && npm install

# player web: un unico file HTML, si apre anche da file://
npm run build:web
npm run embed -- ../stories/nel-paese-dei-ciechi/story.ir.json \
  ../stories/nel-paese-dei-ciechi/play.html
# ...poi apri quel file, anche sul telefono

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../stories/metal-head/story.ir.json                    # gioca (si scrive cosa si fa)
node dist-node/src/cli/zaiplay.js --lint ../stories/nel-paese-dei-ciechi/story.ir.json   # solo controlli statici
node dist-node/src/cli/zaiplay.js --copertura ../stories/metal-head/story.ir.json        # quanto capisce il resolver

# player web servito in rete locale (equivalente di start_local_player.sh)
npm run serve -- 8000 ../stories
node dist-node/src/cli/zaiplay.js \
  --script ../stories/nel-paese-dei-ciechi/playthrough/completo.txt \
  ../stories/nel-paese-dei-ciechi/story.ir.json                                          # rigioca la partita di riferimento
```

### Le immagini

```bash
# estrai i job dall'IR, poi apri lo studio: si guarda, si rifà, si marca
# definitivo quello che convince, e il pulsante «Pubblica» le porta nella storia
python assets-studio/images/extract_manifest.py stories/metal-head/story.ir.json \
    -o stories/metal-head/_work/assets_manifest.json
./start_assets_studio.sh stories/metal-head

# oppure, senza interfaccia
python assets-studio/images/publish.py stories/metal-head --dry-run
```

## Contenuto del repository

| Percorso | Cosa |
|---|---|
| `skills/story-ir-compiler/` | Il compilatore sceneggiatura → IR (skill Claude) |
| `skills/story-ir-compiler/references/engine-ir.schema.json` | Lo schema dell'IR — il contratto stabile del progetto |
| `skills/story-ir-compiler/scripts/` | Validatore dell'IR e segmentatore delle scene |
| `player/` | Il player: web e CLI (`zaiplay`) sullo stesso core, linter di giocabilità, script di playthrough |
| `assets-studio/` | Gli strumenti che trasformano i prompt in asset: una cartella per tipo — oggi `images/`, domani voce e suoni |
| `assets-studio/images/` | Immagini: estrazione del manifest, generazione, studio web, prototipazione, pubblicazione |
| `start_local_player.sh` | Costruisce il player, lo incorpora in ogni storia e serve `stories/` in rete locale (per giocare dal telefono) |
| `start_assets_studio.sh` | Chiede su quale storia aprire lo studio degli asset e lo serve in rete locale |
| `stories/` | Le storie: una cartella ciascuna, con IR, sceneggiatura, playthrough e asset pubblicati |

## Documentazione

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — le decisioni di progetto e il perché
  di ciascuna. È il documento da leggere prima di mettere mano a qualsiasi cosa.
- **[AGENTS.md](AGENTS.md)** — regole operative per gli agenti di coding.
- **[player/README.md](player/README.md)** — come si usa il player, i comandi,
  gli script di playthrough e il linter.
- **[assets-studio/images/README.md](assets-studio/images/README.md)** — la catena
  delle immagini: manifest, generazione, studio, pubblicazione, e i numeri dei
  ventuno modelli provati.
- **[stories/README.md](stories/README.md)** — com'è fatta la cartella di una
  storia e perché.
