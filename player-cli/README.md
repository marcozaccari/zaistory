# zaplay — player CLI di test

Player minimale da riga di comando, **puramente testuale**: nessuna risorsa
grafica o audio, nessun manifest asset. Consuma esclusivamente `story.ir.json`
e serve a giocare e testare una storia molto prima che esistano il modulo
assets e la PWA.

È il modo più economico per scoprire che una storia compilata *non è
giocabile* — scena senza uscita, `goto` verso un id inesistente, flag mai
impostato ma richiesto da una condizione, ramo di dialogo irraggiungibile —
senza dover prima generare immagini e voci. La validazione di schema dice che
l'IR è *ben formato*; solo giocarlo dice che è *giocabile*.

## Uso

```bash
cd player-cli
go build -o zaplay ./cmd/zaplay

./zaplay story.ir.json                    # gioca
./zaplay -debug story.ir.json             # gioca partendo in modalità debug
./zaplay -lint story.ir.json              # solo analisi statica, poi esce
./zaplay -record partita.txt story.ir.json    # registra la partita giocata
./zaplay -script partita.txt story.ir.json    # la rigioca senza input umano
```

Serve solo Go (1.22+). Nessuna dipendenza esterna: `go.mod` non ha `require`.

Codici di uscita: `0` tutto bene · `1` problemi di giocabilità (o errori del
linter, o playthrough che non arriva in fondo) · `2` errore d'uso.

## Comandi in gioco

| Comando        | Cosa mostra                                               |
|----------------|-----------------------------------------------------------|
| `:debug`       | accende/spegne la modalità debug                          |
| `:stato`       | flag, inventario, scena corrente, storico                 |
| `:flag` `:inv` | solo i flag attivi / solo l'inventario                    |
| `:scena`       | i parametri della scena corrente                          |
| `:storico`     | le scene visitate in ordine                               |
| `:azioni`      | **tutte** le azioni della scena, comprese quelle filtrate |
| `:traccia`     | la sequenza di id giocata finora                          |
| `:esci`        | abbandona la partita                                      |

Funzionano anche durante il tap-to-continue della narrazione.

La **modalità debug** mostra i parametri di scena (`id`, `title`, `scene_type`,
`scene_tone`, prompt di background, personaggi presenti, `on_enter_flags_set`)
e tutte le azioni con id, condizione richiesta ed effetto risultante, incluse
quelle nascoste, con accanto il motivo per cui non compaiono — che è la
domanda che ci si pone il 90% delle volte quando si testa una storia.

I campi destinati alla generazione asset (`image_prompt`,
`ambient_sound_prompt`, `sound_effect_prompt`, `VoiceSpec.style_prompt`,
`ambient_music_tags`) non vengono né generati né riprodotti: in modalità
normale sono ignorati, in debug sono mostrati come testo.

## Script di playthrough

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

Si accetta anche il numero della voce nell'elenco corrente, ma gli id sono
più robusti: non cambiano se l'ordine delle azioni cambia.

`-record` produce un file di questo formato dalla partita appena giocata,
`-script` lo rigioca senza input umano. Se un'azione dello script non è più
disponibile il player lo dice distinguendo i due casi che contano: azione
inesistente (refuso nello script) e azione esistente ma filtrata da una
condizione (regressione nella storia).

A cosa serve davvero: è un test di regressione sulla storia.
Domani cambi una condizione nell'IR, o ritocchi lo schema, o tocchi il player:
rilanci quel comando e in due secondi sai se la storia è ancora percorribile
fino in fondo.

## Linter

`-lint` esegue i controlli statici che la validazione di schema non può fare:

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
cmd/zaplay/         entrypoint e flag
internal/ir/        tipi che rispecchiano engine-ir.schema.json + lettura strict
internal/engine/    stato, Condition, Effect, loop di gioco
internal/resolver/  interfaccia del resolver + backend a menu
internal/ui/        terminale interattivo ed esecutore di script
internal/lint/      analisi statica di giocabilità
testdata/           fixture: una storia sana e una deliberatamente rotta
```

Due vincoli architetturali si vedono direttamente nel codice:

- **il player non contiene logica narrativa propria**: non inventa azioni, non
  genera testo, non modifica lo stato se non applicando `Effect` già presenti
  nell'IR. Se qualcosa non si può fare è perché l'IR non lo prevede;
- **la lettura dell'IR è severa**: un campo non previsto dallo schema fa
  fallire il caricamento, esattamente come `additionalProperties: false` lato
  JSON Schema. Il player è anche un test di conformità dell'IR.

## Resolver

L'interfaccia è quella fissata dall'architettura: riceve le azioni disponibili
nella scena, il testo libero del giocatore e il tono della scena, e ritorna
l'id di un'azione **già esistente** oppure nessun match con una narrazione di
fallback in-character. Un resolver non genera mai un effetto di sua
iniziativa.

Backend previsti, si sceglie con `-resolver`:

1. `menu` — selezione a menu numerato. Deterministico, zero dipendenze: è la
   modalità da usare per i test di regressione. **L'unico implementato.**
2. `claude` — input testuale libero via API. Non ancora implementato.
3. `locale` — LLM/SLM piccolo eseguito offline. Non ancora implementato.

## Test

```bash
go test ./...
```

Le fixture in `testdata/` sono due: `mini.ir.json` è una storia sana che copre
cutscene, dialogo con scelte, condizioni su flag e inventario, azione non
ripetibile e scena finale; `rotta.ir.json` contiene un esemplare di ogni bug
che il linter deve saper trovare.
