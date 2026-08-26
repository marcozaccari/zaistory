# ZAiStory

Motore narrativo interattivo moderno — nello spirito dei punta-e-clicca SCUMM,
ma leggero: niente verbo×oggetto, solo dialoghi a scelte multiple e azioni
contestuali.

L'autore scrive la sceneggiatura in **markdown libero**, in un formato pensato
per la creatività e non per la macchina. Un compilatore la trasforma in un
formato intermedio giocabile e player-agnostic (`story.ir.json`), che alimenta
la generazione degli asset e uno o più player.

```
sceneggiatura.md  ─►  COMPILATORE  ─►  story.ir.json  ─┬─►  PLAYER CLI (solo testo)
   (markdown libero)                    (formato IR)   │
                                                       └─►  ASSETS  ─►  PLAYER (PWA, bot)
```

L'IR è il contratto che tiene i componenti disaccoppiati: nessuno di loro sa
nulla degli altri.

## Stato

Prototipo. Funzionano due pezzi: il **compilatore**, realizzato come skill
Claude che applica le regole di progetto direttamente in conversazione, e il
**player CLI di test** (`player-cli/`, Go), che gioca un `story.ir.json` in
puro testo — senza immagini né voci — per scoprire se una storia compilata è
davvero giocabile. Modulo assets e player grafici sono progettati ma non
ancora costruiti.

## Provare subito

```bash
cd player-cli && go build -o zaplay ./cmd/zaplay

./zaplay ../examples/nel-paese-dei-ciechi.ir.json         # gioca la storia
./zaplay -lint ../examples/nel-paese-dei-ciechi.ir.json   # solo controlli statici
./zaplay -script ../examples/nel-paese-dei-ciechi.playthrough.txt \
         ../examples/nel-paese-dei-ciechi.ir.json          # rigioca la partita di riferimento
```

## Contenuto del repository

| Percorso | Cosa |
|---|---|
| `skills/story-ir-compiler/` | Il compilatore sceneggiatura → IR (skill Claude) |
| `skills/story-ir-compiler/references/engine-ir.schema.json` | Lo schema dell'IR — il contratto stabile del progetto |
| `skills/story-ir-compiler/scripts/` | Validatore dell'IR e segmentatore delle scene |
| `player-cli/` | Il player CLI di test (`zaplay`): gioca l'IR, linter di giocabilità, script di playthrough |
| `examples/` | Sceneggiature di riferimento e l'IR compilato da usare come banco di prova |

## Documentazione

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — le decisioni di progetto e il perché
  di ciascuna. È il documento da leggere prima di mettere mano a qualsiasi cosa.
- **[AGENTS.md](AGENTS.md)** — regole operative per gli agenti di coding.
