# zaiplay — il player

Legge un `<id>.zaistory.json` e lo fa giocare. Nient'altro: nessun manifest
degli asset, nessun indice, nessun server. Le immagini già pubblicate le trova
da sé, quando ci sono, perché la storia le nomina per id e loro stanno in
`assets/images/` accanto a lei.

**È il player del progetto, non un banco di prova.** Serve tre pubblici con una
build sola: chi sviluppa il motore, chi collauda una storia, chi la gioca e
basta. A distinguerli è un interruttore — il debug — che accende la diagnostica
e spento non lascia traccia di sé. È anche la garanzia che quello che il tester
prova sia esattamente quello che il giocatore riceverà.

È anche il modo più economico per scoprire che una storia compilata *non è
giocabile* — un luogo senza uscite, un `goto` verso un id che non esiste, un
flag richiesto da una condizione e mai impostato, un ramo di dialogo
irraggiungibile — senza aver prima generato immagini e voci. Il caricamento
severo dice che il file è *ben formato*; il linter dice che è *staticamente
sano*; solo giocarlo dice che è *giocabile*.

Due facce, **un solo core**:

| | a cosa serve |
|---|---|
| **player web** | giocare dal telefono o dal desktop senza installare niente. La build è **un unico file HTML** che si apre anche da `file://`. |
| **CLI `zaiplay`** | `--lint`, `--copertura` e `--script` headless: analisi statica, misura del parser, test di regressione rigiocabili in CI. |

`src/core/` non tocca il DOM e non legge da stdin: parser, stato, motore,
linter e caricamento stanno lì una volta sola, e le due facce li condividono. Il
*perché* di quasi tutto quello che segue sta in `ARCHITECTURE.md`; qui c'è il
*come*.

## Provare subito

```bash
npm install

npm run dev                      # player web con ricarica a caldo
npm run build:web                # -> dist/index.html (~128 KB, tutto dentro)
npm run embed -- ../stories/metal-head/metal-head.zaistory.json \
                 ../stories/metal-head/play.html

npm test                         # build node + i test del core
node dist-node/src/cli/play.js ../stories/metal-head/metal-head.zaistory.json
```

Serve solo Node 22+. Nessuna dipendenza a runtime: TypeScript e Vite sono
soltanto strumenti di build, e il codice spedito al browser non importa niente
da `node_modules`.

Il file prodotto da `npm run embed` va **dentro la cartella della storia**, e
non è un dettaglio di comodo: le immagini stanno in `assets/images/`, la storia
le nomina per id, e una pagina che sta lì le trova.

## Il sito pubblicato

```bash
npm run build:web && npm run build:site      # -> ../_site
```

`build:site` compone la cartella che finisce su GitHub Pages: `_site/<id>/` per
ogni storia, con dentro il player già incorporato e le immagini accanto a lui,
più un indice che le elenca. Una cartella dentro `stories/` **senza**
`<id>.zaistory.json` si salta e dice perché: una voce nell'elenco che porta a
un errore è peggio di una voce che non c'è. Lo stesso comando lo lancia
l'Action `.github/workflows/pages.yml` a ogni push su `main`; in locale serve a
dare un'occhiata prima di spingere.

## Come si gioca

Quattro gesti, e sono tutti quelli che ci sono: **guardare**, **usare**,
**parlare**, **andare**. Si scrivono a parole — «apro la porta», «chiedo a Mark
della scatola», «vado nel corridoio» — e il parser sceglie fra le azioni che
l'autore ha già scritto. Non ne inventa nessuna, e quando non capisce risponde
con un rifiuto d'autore invece di tirare a indovinare: sbagliare qui vorrebbe
dire applicare un effetto che nessuno ha chiesto.

Due eccezioni alla scrittura libera, e sono le due volte in cui **si sceglie**:
dentro un dialogo (si agisce a parole, si parla a scelte) e sulla mappa, che è
la scorciatoia che salta la digitazione di «vai».

Il player risponde anche a qualche domanda sull'interfaccia — «guardati
intorno», «cosa ho con me», «chi c'è», «dove posso andare», «aiuto» — con le
parole che l'autore ha scritto in `player_voice`. Dove quel testo manca il
player **tace e lo segnala**: un buco deve vedersi come un buco, non essere
riempito da una frase inventata.

## L'interfaccia

Lo schermo è diviso per senso: in alto ciò che si guarda, in basso ciò che si
legge.

- **Il palco** tiene l'inquadratura corrente, ferma. Ogni immagine nuova prende
  il posto della precedente; un nodo senza immagine non svuota il palco. In cima
  la riga delle coordinate — il tono, dove siamo, chi è in campo — che non si
  nasconde mai. Di lato le facce del cast. La maniglia stringe la figura quando
  serve più spazio per leggere; su schermo largo il palco passa a sinistra e la
  storia si legge in colonna a destra.
- **Il trascritto** dà una voce a ciascun registro — l'autore, i personaggi, il
  player quando commenta, la macchina quando mostra un prompt — con un colore,
  un carattere e uno spazio suoi.
- **I prompt di generazione si vedono sempre**, non solo in debug: sono il
  segnaposto di quello che diventeranno immagine, suono e voce, ed è leggendoli
  mentre si gioca che ci si accorge che un beat ha cambiato inquadratura senza
  dirlo. Senza immagini pubblicate si gioca lo stesso: al posto della figura
  restano i prompt, ed è esattamente ciò che il generatore riceverebbe.
- **Il dock** è la riga in cui si scrive, più la mappa. Quando in un luogo non
  resta più niente da fare e la strada è una sola, compare: gli enigmi sono
  finiti, e continuare a chiedere di indovinare la frase giusta sarebbe solo un
  muro.

Tre interruttori, in barra e nel piede del menu: **immagini** (testo o figure),
**carattere** della prosa (un giro fra Charter, Schoolbook e il bastoni di
sistema — non un tema, solo con quale carattere è scritta la prosa d'autore) e
**debug**, che accende le diagnostiche e le tre schede di ispezione.

Ricaricare non butta via la partita: la sequenza di quello che si è scritto *è*
la partita, e sta in `localStorage`.

## Il menu

| scheda | cosa c'è | |
|---|---|---|
| `principale` | dove sei, cosa hai in mano (e ogni oggetto si può guardare), ricomincia | |
| `disco` | la partita da copiare e da incollare altrove: si riprende in un istante, anche su un altro device | |
| `interprete` | quale backend decide, e da dove viene il modello dei vettori | |
| `ascolto` | la storia recitata invece che letta | |
| `stato` | atto, luogo, fase, flag, inventario, uscite con il perché di quelle chiuse | debug |
| `linter` | l'analisi statica della storia | debug |
| `traccia` | la sequenza dei comandi, da copiare o rigiocare | debug |

## Modalità ascolto

La storia recitata invece che letta, per chi non guarda lo schermo. Si accende
dalla scheda **ascolto**. Usa `speechSynthesis` del browser: nessuna
dipendenza, e funziona anche nel file HTML autonomo aperto da `file://`.

Tre regole, e sono quelle che la rendono ascoltabile:

1. **non si inventa prosa** — ogni frase recitata è testo d'autore; le uniche
   parole del player sono le etichette dei campi («Ambiente:», «Personaggio:»,
   «Voce:»), cioè quelle che a schermo stanno scritte accanto al valore;
2. **si collassa come si collassa a schermo** — la composizione di un luogo o
   di un personaggio per intero la prima volta, dalla seconda solo il nome, e
   «guardati intorno» la riapre;
3. **il dock non si legge**, tranne l'uscita rimasta quando non c'è più niente
   da fare: lì non è un elenco fra cui scegliere, è l'unica cosa rimasta.

Le diagnostiche restano mute: chi ascolta sta giocando, non collaudando. Ogni
frase viene spezzata prima di darla alla sintesi, perché Chrome smette di
parlare dopo una quindicina di secondi di una stessa utterance; il taglio cade
sui confini che il testo ha già, e le parole in uscita sono esattamente quelle
in entrata.

## L'interprete

Il parser lessicale è il default: deterministico, nessun modello, nessuna rete,
nessun byte scaricato, e sta dentro il file HTML unico. Dalla scheda
**interprete** si possono accendere i vettori, in due modi:

| modalità | a cosa serve |
|---|---|
| `lessicale` | giocare. È il default. |
| `ibrido` | giocare con i vettori: il lessicale decide, i vettori intervengono solo dove tace, e sempre nella scelta del fallback |
| `vettori` | **misurare**, non giocare: i vettori decidono da soli, senza rete di protezione |

La divisione non è a cascata, è per **costo dell'errore**: il lessicale sbaglia
rifiutando e costa una frase riscritta; i vettori sbagliano facendo — sono
ciechi sulla negazione e sulla direzione degli argomenti — e un falso positivo
*esegue*. Quindi vettori dove sbagliare non costa niente, lessicale dove
sbagliare cambia lo stato.

Il modello si scarica da CDN **solo se lo si accende**, con un import dinamico:
chi non lo sceglie non scarica un byte, e il file unico resta unico. I tre
indirizzi da cui dipende — libreria, modello, host dei pesi — si cambiano dalla
stessa scheda, perché è sempre lì che questo backend fallisce e senza poterli
cambiare l'unica diagnosi possibile è «Failed to fetch». Da `file://` il
browser tratta la pagina come opaca e le richieste verso l'esterno possono
essere bloccate: per provare i vettori conviene servire la pagina da http.

## La CLI

```bash
node dist-node/src/cli/play.js storia.zaistory.json              # si gioca
node dist-node/src/cli/play.js storia.zaistory.json --lint       # analisi statica
node dist-node/src/cli/play.js storia.zaistory.json --copertura  # misura del parser
node dist-node/src/cli/play.js storia.zaistory.json --script playthrough/completo.txt
```

`--script` rigioca una traccia e chiude con exit code diverso da zero se la
partita non arriva più in fondo: **un playthrough è un test di regressione**, e
lo è perché il parser può solo scegliere fra azioni già definite — quindi la
sequenza dei comandi descrive per intero la partita.

`--copertura` prova tutte le `test_phrases` della storia e dice quante arrivano
dove devono, quante si perdono e quante finiscono **sull'azione sbagliata**. Le
sbagliate sono le uniche che contano davvero: una frase persa è un rifiuto, una
frase sbagliata è un effetto che nessuno ha chiesto.

## La mappa dei file

```
src/core/     types, load (caricamento severo), state, engine, parser,
              lexical, verbs (il vocabolario italiano), turn (il giro dei
              turni), vectors (il secondo interprete), lint, coverage
src/cli/      play.ts
src/web/      main, stage (il palco), transcript, panel, listen (modalità
              ascolto), voice, fonts, images, prompt, names, icons, dom,
              styles.css
test/         play.test.ts
testdata/     mini.zaistory.json — la fixture, la stessa che sta accanto
              allo schema
```

`src/core/verbs.ts` ha un nome inglese e contenuto italiano, ed è corretto: non
è codice, è un dizionario. Il vocabolario che il parser riconosce è dato di
lingua, e va scelto in base al campo `language` della storia.

## I test

`npm test` compila il core con Node e fa girare `test/play.test.ts`: il
caricamento severo (un campo non previsto non passa, nemmeno dentro un ramo
composto), la scelta della fase, il parser e i suoi spareggi, il giro dei turni,
i dialoghi, il linter, la copertura, e la giuntura del secondo interprete — con
un finto embedder, perché quello che va protetto è *dove* i vettori
intervengono, non quanto siano bravi a capire l'italiano.

La fixture è `testdata/mini.zaistory.json`: una storia che esercita ogni
costrutto invece di illustrarne uno.
