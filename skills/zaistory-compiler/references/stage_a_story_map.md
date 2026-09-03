# Stadio A — la mappa della storia

## Ruolo

Leggi l'intera sceneggiatura e producine la **mappa**: la struttura in atti e
luoghi, l'anagrafica di tutto ciò che ha un'identità, lo stile globale, e
l'assegnazione di ogni scena del sorgente a un luogo e a una fase.

È il passo che decide la forma di tutto il resto. Lo Stadio B compila un luogo
alla volta e non ha modo di rimediare a una struttura sbagliata: se un atto è
tagliato nel posto sbagliato o due scene dello stesso posto sono finite in due
luoghi diversi, lo si scopre giocando.

**Gli id si decidono qui, una volta sola.** Da loro dipendono i riferimenti fra
i pezzi, le ancore visive del modulo assets e le immagini già pubblicate.

## Input

- la sceneggiatura completa in markdown libero;
- le risposte dell'utente alle tre domande (libertà sulla giocabilità,
  rielaborazione dei dialoghi, tetto di entità interagibili per luogo);
- se esiste, **la compilazione precedente della stessa storia**.

## Eredità degli id — leggi questo prima di inventare qualunque id

Se esiste una versione precedente del file, gli id **si ereditano**, e non è una
cortesia: le immagini pubblicate sono agganciate agli id delle entità e delle
fasi, sono state pagate e sono state scelte a mano una per una.

- Personaggi, oggetti, luoghi: **stesso id di prima**, sempre, anche se il nome
  visibile cambia.
- Fasi: dove una fase corrisponde a una scena della versione precedente, **usa
  l'id di quella scena**.
- I campi `image` già presenti si **conservano** insieme al nodo che li porta.
- Quello che non trova corrispondenza prende un id nuovo, e verrà riagganciato
  dal passo di rebind del modulo assets confrontando i prompt.

Un id cambiato senza motivo è un'immagine da rigenerare.

## Cosa devi produrre

Un `story_map.json` con questa forma. Non è il file finale: è il tuo piano di
lavoro, e i campi che lo diventeranno hanno gli stessi nomi dello schema.

```json
{
  "id": "slug-della-storia",
  "title": "...",
  "description": "...",
  "language": "it",
  "failure_mode": "none",
  "protagonist": "id_del_personaggio_giocante",
  "global_style": { "...": "vedi sotto" },
  "cover": { "...": "vedi sotto" },
  "player_voice": { "...": "vedi sotto" },
  "characters": [ "anagrafica completa di chiunque parli" ],
  "items": [ "anagrafica completa degli oggetti d'inventario" ],
  "initial_inventory": ["..."],
  "carry_flags": [ "al massimo 3, spesso zero" ],
  "start_act": "id_del_primo_atto",
  "acts": [
    {
      "id": "atto_uno",
      "title": "...",
      "start_place": "id_del_luogo_iniziale",
      "flags": ["elenco dei flag locali a questo atto"],
      "reads_carry_flags": [], "writes_carry_flags": [],
      "places": [
        {
          "id": "magazzino",
          "name": "il magazzino",
          "aliases": ["magazzino", "capannone", "dentro"],
          "visual_prompt": "...", "visual_prompt_en": "...",
          "exits_planned": [
            { "to": "piazzale", "quando": "sempre" }
          ],
          "note": "cosa succede qui, in due righe, per lo Stadio B"
        }
      ]
    }
  ],
  "scene_segments": [
    {
      "id": "magazzino_ricerca",
      "place": "magazzino",
      "act": "atto_uno",
      "source_excerpt_hint": "prima riga LETTERALE del blocco nel sorgente"
    }
  ]
}
```

## Come si trovano gli atti

Un atto non è un capitolo: è un **contenitore che si chiude alle spalle**.

Il taglio giusto si riconosce da una domanda sola: *da qui in avanti, cosa deve
sopravvivere?* Se la risposta è «solo quello che il protagonista ha addosso», lì
c'è un confine d'atto. Se sopravvivono anche cose che sono successe — un
personaggio offeso, una porta lasciata aperta — allora o il confine è nel posto
sbagliato, o quella cosa è un `carry_flag` (e ne hai tre in tutto).

Segnali tipici nel sorgente: un salto di tempo, un cambio di ambientazione che
non si può percorrere a piedi, una parte o un capitolo esplicito, un punto della
storia dopo il quale nessuno torna indietro.

Non forzare gli atti dove non ci sono. **Una storia con un atto solo è
legittima** ed è preferibile a due atti tagliati male: il taglio serve a rendere
la storia verificabile a pezzi, non a farla sembrare più strutturata.

Regole che devi far rispettare mentre tagli:

- **I flag non attraversano.** Ogni flag appartiene a un atto e va elencato nei
  suoi `flags`. Una condizione che nomina il flag di un altro atto è un errore.
- **L'inventario attraversa, ed è l'unico canale.** Quindi: prima di chiudere un
  atto, il giocatore deve poter avere tutto ciò che serve a valle. Si applica
  mettendo gli `has_item` sull'uscita che porta all'atto successivo — non con un
  meccanismo dedicato, e non lasciandolo alla buona volontà del giocatore.
- **I carry flag sono per il tono.** Massimo tre, dichiarati da chi li scrive e
  da chi li legge, e ogni atto deve restare completabile per ogni loro
  combinazione. Se ti accorgi che ne servono quattro, quasi sempre uno dei
  quattro è in realtà un oggetto.

## Come si trovano i luoghi

Un luogo è un **posto in cui si sta**, e tutte le scene ambientate lì
confluiscono in lui. Non è un'inquadratura e non è un momento.

Il criterio è: *il giocatore può trovarsi qui e decidere cosa fare?* Se sì è un
luogo. Se il posto è solo attraversato, di solito non è un luogo — è una
**cutscene di transizione** su un'uscita.

Casi che si sbagliano spesso:

- **Tre scene nel magazzino sono un luogo, non tre.** È l'inversione principale
  rispetto a una lettura ingenua del sorgente.
- **Un flashback, un sogno, una scena altrove** che il giocatore non attraversa
  camminando: è un luogo con una fase sola, di tipo `cutscene`, e una sola
  uscita che riporta dove si era.
- **Il viaggio in auto** che apre molte storie: se dentro ci si parla e ci si
  guarda intorno è un luogo; se è solo il modo di arrivare, è una transizione.
- **Un posto visitato una volta sola** resta comunque un luogo, se lì si agisce.
  Non serve che ci si torni.

Per ogni luogo, decidi anche:

- **`aliases`**: come il giocatore lo chiamerà scrivendo. Il nome, i sinonimi, e
  i modi in cui lo si indica dalla porta accanto («di sotto», «fuori», «dentro»).
- **le uscite previste** e quando sono percorribili. Ti servono per verificare
  che il grafo dell'atto sia connesso e che l'atto arrivi a chiudersi. La forma
  definitiva la scrive lo Stadio B.
- **`visual_prompt`**: com'è fatto il posto — non come lo si sta guardando, che è
  l'inquadratura di una fase. Serve al modulo assets come ancora: due fasi dello
  stesso luogo devono somigliarsi.

## Come si assegnano le scene alle fasi

Ogni segmento del sorgente porta `place` e un `id` che diventerà l'id della
fase. La regola:

> **Il luogo lo determina l'ambientazione, la fase lo determina lo stato.**

Si apre una fase nuova quando cambia **cosa si può fare o cosa si vede**. Se
cambia solo ciò che il giocatore *sa*, non serve una fase: bastano delle
`look_variants`.

Tre casi da tenere presenti:

- **Una scena può diventare due fasi**, se a metà succede qualcosa che cambia
  cosa si può fare lì. Il confine sta dentro la scena.
- **Una scena può diventare due luoghi**, se l'autore taglia sull'ambientazione:
  l'intestazione mente, l'ambientazione no.
- **Una fase può non avere nessuna scena sorgente.** È il caso più facile da
  dimenticare: l'autore descrive il magazzino una volta e dà per scontato che
  tornandoci sia diverso. Quella fase la componi tu — dichiarala nei
  `scene_segments` **senza `source_excerpt_hint`**, e il segmentatore la salta.
  Ogni luogo in cui si può tornare ne ha almeno una: quella **esaurita**.

L'`source_excerpt_hint` è la prima riga **letterale** del blocco nel sorgente,
copiata e non parafrasata: è così che il segmentatore lo ritrova.

## L'anagrafica

Una sola lista per identità, sempre. Due elenchi paralleli degli stessi id sono
una fabbrica di derive.

### Personaggi

Ci va **chiunque parli**, anche una voce fuori campo con una battuta sola: la
roster è l'elenco dei parlanti, non dei personaggi importanti, e il modulo assets
assegna il timbro una volta per parlante.

Per ognuno: `id`, `name`, `aliases`, `description` (cosa si legge guardandolo),
`visual_prompt` + `visual_prompt_en`, `voice.style_prompt`.

**`protagonist`**: il personaggio che il giocatore è. Sta nella roster come tutti
— ha un aspetto e una voce — ma a «chi c'è qui» non va mai elencato.

### Oggetti d'inventario

`id`, `name` (come lo chiama il giocatore: a «cosa ho nello zaino» un id non è
una risposta), `aliases`, `description`, `visual_prompt`.

**Un oggetto che cambia stato è un altro oggetto**, con un altro id e un'altra
immagine: il walkie scarico e il walkie sotto carica sono due voci di `items`, e
la trasformazione è un effetto che fa `remove_inventory` + `add_inventory`. Le
`description_variants` servono all'altro caso — quello in cui cambia ciò che il
giocatore *sa* dell'oggetto, non l'oggetto.

`initial_inventory` è quello che il protagonista ha già addosso all'inizio: un
dato di partenza, non un evento.

### Gli alias, che sono la parte che fa funzionare tutto

Il verbo lo riconosce il player; il **bersaglio** lo riconoscono i tuoi alias.
Quindi la copertura lessicale della storia sta qui.

**Otto-quindici per entità.** Devono coprire:

- il nome e le sue forme brevi (`walkie talkie`, `walkie`, `radio`);
- i sinonimi che una persona userebbe senza pensarci (`lume`, `lanterna`);
- i modi **perifrastici** con cui si indica una cosa senza nominarla («il tipo
  dietro il bancone», «quella cosa che luccica», «la roba sul tavolo»);
- per i personaggi: nome, cognome, ruolo, e il tratto con cui il giocatore li
  riconosce prima di sapere come si chiamano («il ragazzo», «quello col
  cappello»).

Due entità dello stesso luogo **non devono avere alias sovrapponibili**: se
«cassa» può essere la cassa di legno o la cassa del registratore, il parser non
può fare altro che rifiutare, e il giocatore non capirà perché.

### Gli oggetti d'ambiente

Non li elenchi tutti qui — li scrive lo Stadio B, luogo per luogo — ma in Stadio
A segna quali ti servono per gli enigmi, così non ne perdi uno per strada.

## Lo stile globale, la copertina, la voce del player

**`global_style`**: `image_style_suffix` (+ `_en`), `anchor_framing`,
`narrator_voice`, `default_tone`, `ambient_music_tags`.

`anchor_framing` è **una decisione sull'intero cast**: un cast con ritagli
disomogenei sembra venire da storie diverse. L'override per personaggio esiste ma
è per i soggetti non umani.

**`cover`**: la locandina. È un'inquadratura come le altre, e non è la prima
scena: quella dice *dove si comincia*, la copertina dice *di cosa parla la
storia*. Al massimo **quattro riferimenti in tutto** (il luogo conta): oltre
quella soglia i modelli mediano fra i soggetti invece di tenerli distinti. E
**niente testo dentro l'immagine**: il titolo lo scrive il player, e uno generato
esce storto e in una lingua a caso.

**`player_voice`**: le risposte globali, in tono con la storia — come si annuncia
l'inventario, chi c'è, dove si può andare, e i fallback per ogni intenzione
(`perception`, `manipulation`, `communication`, `movement`, `generic`). Più di
una frase per voce: il player le sceglie a rotazione, ed è da lì che viene la
varietà.

Scrivile **in tono**, ma attento a un rischio reale: un fallback pertinente e
convinto dice «no, non è quella la strada» anche quando il giocatore aveva
ragione e ha solo scelto le parole sbagliate. Un fallback deve suonare come *non
ho capito*, non come *hai sbagliato*.

## Regole di gioco che vincolano la mappa

Non sono suggerimenti: sono i paletti del progetto, e si applicano già qui.

- **Non si perde** (a meno che `failure_mode` sia `alternate_endings`). Nessun
  vicolo cieco, nessuna partita da ricominciare. Qualunque cosa faccia il
  giocatore si arriva allo stesso finale; ciò che cambia è quanto costa.
- **Il costo dell'errore è camminare all'indietro.** L'unica punizione sono i
  passi: si viene rimessi in un luogo già visto. Nessuna barra della minaccia,
  nessun avversario da tracciare.
- **Le risorse non si contano.** Trovare una torcia è un evento, amministrarne le
  batterie non è un gioco.
- **Il tempo non esiste.** Nessun timer, nessuna occasione che scade, nessuna
  transizione automatica. Dove la sceneggiatura ha urgenza, quell'urgenza è
  **recitata**: sta nel testo, nel suono e nelle immagini. Il giocatore deve
  sentire il panico, non subirlo.
- **Si torna nei luoghi.** Un ambiente non si chiude appena esaurito: resta
  aperto finché l'atto non lo chiude.

## Nota sulla lunghezza

La story map di una sceneggiatura lunga è un documento grosso, e va scritto per
intero lo stesso: è l'unico posto dove la struttura esiste tutta insieme. Se devi
scegliere dove essere sintetico, sii sintetico nelle `note` dei luoghi — non
negli id, non negli alias, non nell'assegnazione delle scene.
