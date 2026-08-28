# ZAiStory

Motore narrativo interattivo moderno — nello spirito dei punta-e-clicca SCUMM,
ma leggero: niente verbo×oggetto, solo dialoghi a scelte multiple e azioni
contestuali.

L'autore scrive la sceneggiatura in **markdown libero**, in un formato pensato
per la creatività e non per la macchina. Un compilatore la trasforma in un
formato intermedio giocabile e player-agnostic (`story.ir.json`), che alimenta
la generazione degli asset e uno o più player.

```
sceneggiatura.md  ─►  COMPILATORE  ─►  story.ir.json  ─┬─►  PLAYER DI TEST (solo testo)
   (markdown libero)                    (formato IR)   │      web + CLI
                                                       └─►  ASSETS  ─►  PLAYER (PWA, bot)
```

L'IR è il contratto che tiene i componenti disaccoppiati: nessuno di loro sa
nulla degli altri.

## Stato

Prototipo. Funzionano due pezzi: il **compilatore**, realizzato come skill
Claude che applica le regole di progetto direttamente in conversazione, e il
**player di test** (`player/`, TypeScript), che gioca un `story.ir.json` in
puro testo — senza immagini né voci — per scoprire se una storia compilata è
davvero giocabile. Il player ha due facce sullo stesso core: una **web**, per
provare la storia dal telefono o dal desktop, e una **CLI**, per il linter e i
playthrough di regressione headless. Modulo assets e player grafici sono
progettati ma non ancora costruiti.

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
./start_local_player.sh 8080                          # altra porta
./start_local_player.sh 8080 examples/metalhead.ir.json   # una storia sola
```

### A mano

```bash
cd player && npm install

# player web: un unico file HTML, si apre anche da file://
npm run build:web
npm run embed -- ../examples/nel-paese-dei-ciechi.ir.json paese.html
# ...poi apri paese.html, anche sul telefono

# CLI
npm run build:node
node dist-node/src/cli/zaiplay.js ../examples/metalhead.ir.json                    # gioca (si scrive cosa si fa)
node dist-node/src/cli/zaiplay.js --lint ../examples/nel-paese-dei-ciechi.ir.json  # solo controlli statici
node dist-node/src/cli/zaiplay.js --copertura ../examples/metalhead.ir.json        # quanto capisce il resolver

# player web servito in rete locale (equivalente di start_local_player.sh)
npm run serve
node dist-node/src/cli/zaiplay.js \
  --script ../examples/nel-paese-dei-ciechi.playthrough.txt \
  ../examples/nel-paese-dei-ciechi.ir.json                                        # rigioca la partita di riferimento
```

## Contenuto del repository

| Percorso | Cosa |
|---|---|
| `skills/story-ir-compiler/` | Il compilatore sceneggiatura → IR (skill Claude) |
| `skills/story-ir-compiler/references/engine-ir.schema.json` | Lo schema dell'IR — il contratto stabile del progetto |
| `skills/story-ir-compiler/scripts/` | Validatore dell'IR e segmentatore delle scene |
| `player/` | Il player di test: web e CLI (`zaiplay`) sullo stesso core, linter di giocabilità, script di playthrough |
| `start_local_player.sh` | Costruisce il player, ci incorpora le storie e lo serve in rete locale (per giocare dal telefono) |
| `examples/` | Sceneggiature di riferimento e l'IR compilato da usare come banco di prova |

## Documentazione

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — le decisioni di progetto e il perché
  di ciascuna. È il documento da leggere prima di mettere mano a qualsiasi cosa.
- **[AGENTS.md](AGENTS.md)** — regole operative per gli agenti di coding.
- **[player/README.md](player/README.md)** — come si usa il player, i comandi,
  gli script di playthrough e il linter.
