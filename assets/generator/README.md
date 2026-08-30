# Generatore immagini

Modulo assets limitato alle **immagini**. Voce, suoni e musica restano fuori.

```
story.ir.json ──▶ extract_manifest.py ──▶ assets_manifest.json
                                                   │
                                  ┌────────────────┴────────────────┐
                                  ▼                                 ▼
                            generate.py                        studio.py
                          (riga di comando)                 (webapp locale)
                                  └────────────────┬────────────────┘
                                                   ▼
                                             Pollinations
                                                   │
                                                   ▼
                                              assets/out/
```

Due passi, che sono i due di `ARCHITECTURE.md`: l'estrazione risolve le
**ancore** e le **inquadrature** che le referenziano, la generazione consuma
solo il manifest. `generate.py` e `studio.py` sono la stessa cosa con due
interfacce — lo studio importa `generate.Runner`, quindi reference, sidecar,
cache, controllo dimensione e scala di preferenza sono identici e le due
strade restano intercambiabili a meta' lavoro.

## 1. Estrazione (locale, nessuna GPU)

```bash
python assets/generator/extract_manifest.py examples/metalhead.ir.json \
    -o assets/out/metalhead/assets_manifest.json
```

Sull'IR di riferimento produce **88 job**: 24 ancore e 64 inquadrature.

| opzione | a cosa serve |
|---|---|
| `--level anchors` | solo le ancore: il primo giro, quello da validare a mano |
| `--level shots` | solo le inquadrature, quando le ancore convincono |
| `--sample 6` | campione misto per le prove |
| `--size 768x768` | immagini piu' piccole |
| `--model-anchors` / `--model-shots` | i modelli dei due tier (sotto) |

Le **ancore** (personaggi, luoghi, oggetti) si generano una volta per entita'
con un'inquadratura neutra; le **inquadrature** sommano il proprio
`image_prompt` all'ancora del luogo e dei personaggi in campo, piu'
l'`image_style_suffix` globale. Un `visual_prompt` sovrascritto dentro una
scena diventa una variante d'ancora, non un'inquadratura: cosi' resta
risolvibile. Le varianti hanno un id con l'hash del testo dell'override
(`anchor.char.mark@1a2b3c4d`), quindi lo stesso override ripetuto in dieci
scene resta una sola immagine.

Il campione e' **chiuso rispetto alle dipendenze**: se `--sample` pesca
un'inquadratura si porta dietro le ancore che le servono, altrimenti il tier
con reference — cioe' proprio quello che si vuole provare a poco prezzo — non
sarebbe generabile.

Ogni job ha un `seed` derivato in modo deterministico dal suo id. Rigenerare
il manifest non cambia le immagini gia' prodotte.

## 2. Generazione

### La chiave

Gli script leggono `POLLINATIONS_API_KEY` dall'ambiente. Se non c'e', la
cercano in **`assets/.profile`**, che il `.gitignore` del repo ignora gia' —
e' quindi il posto in cui una credenziale puo' stare senza rischiare di
finire in un commit:

```sh
echo 'export POLLINATIONS_API_KEY=sk_...' > assets/.profile
chmod 600 assets/.profile
```

Il file viene cercato accanto agli script e risalendo dalla directory
corrente, quindi funziona sia lanciando dalla radice del repo sia da dentro
`assets/generator/`. Carica tutte le variabili che trova (comoda per le
credenziali della voce, piu' avanti) ma **non sovrascrive mai** quello che e'
gia' nell'ambiente: un `export` esplicito vince sempre sul file. `--key`
esiste ma finisce nella history della shell, quindi meglio evitarlo.

```bash
python assets/generator/generate.py assets/out/metalhead/assets_manifest.json \
    -o assets/out/metalhead --level anchors      # prima le ancore
python assets/generator/generate.py assets/out/metalhead/assets_manifest.json \
    -o assets/out/metalhead --level shots        # poi le inquadrature
```

### I due tier

|  | ancore | inquadrature |
|---|---|---|
| modello di default | `grok-imagine` (text-only) | `nanobanana-2-lite` (con reference) |
| endpoint | `GET /image/{prompt}` | `POST /v1/images/edits` |
| seed | onorato | onorato, benche' non documentato |
| quante | 24 | 64 |

Sono i due livelli visti dal lato costo. Le ancore sono poche ed e' l'unico
punto in cui vuoi che il modello inventi liberamente. Le inquadrature devono
tenere l'identita' dei personaggi, e **nessun testo puo' portarla**: "donna
sulla quarantina, capelli scuri raccolti male" descrive un tipo, non una
persona. L'identita' va ancorata sul pixel, allegando l'ancora alla richiesta.
E' la ragione per cui i tier sono due; il prezzo, come si vede sotto, non lo
sarebbe stata.

**Quello che la sonda ha stabilito** (agosto 2026, `probe --seed-check`):
il path della GET e' `https://gen.pollinations.ai/image/{prompt}`; l'endpoint
di editing compone davvero una scena nuova a partire da 1 e da 3 reference
invece di modificare la prima immagine; e il `seed` e' onorato **anche su
`/v1/images/edits`**, dove non e' documentato — stesso seed, stessa immagine;
seed diverso, immagine diversa. Quindi anche le inquadrature si rifanno
cambiando il solo seed e tenendo le stesse reference: `--redo shot.x --seed 999`.

Le ancore non partono in PNG: `make_reference` ne fa una copia a lato lungo
768 in WebP q82 (`--ref-format`, `--ref-max-side`, `--ref-quality`). Al
modello serve l'identita', non il lossless, e un'inquadratura con tre
personaggi in campo spedirebbe altrimenti diversi MB. Sull'IR di riferimento
il massimo e' **3 reference per shot**; 5 inquadrature non hanno dipendenze e
ricadono da sole sul tier text-only.

### Il prompt e' diverso nei due tier

`extract_manifest.py` emette due prompt per ogni inquadratura. `prompt` e'
quello text-only, che ridescrive per esteso luogo e personaggi. `prompt_ref`
e' quello usato quando le ancore viaggiano come allegati: li' ridescrivere a
parole l'aspetto e' peggio che inutile, perche' testo e riferimento visivo
entrano in competizione e il modello media fra i due. Restano i soli nomi, una
**mappa numerata degli allegati** che lega ogni reference al soggetto che
rappresenta, e una premessa che dice al modello di comporre una nuova
inquadratura invece di *modificare* la prima immagine — l'endpoint e' di
editing, senza quella riga fa la cosa sbagliata.

### Il registro dei modelli

`model_costs.json` tiene due cose: `calls_per_dollar` (il listino come lo
espone il fornitore) e `preference`, la scala di qualita' decisa a occhio, dal
peggiore al migliore. Serve a `--upgrade`, che rigenera un job col gradino
successivo partendo da quello registrato nel suo sidecar, e allo studio, che
da quella scala costruisce il menu di rigenerazione e il preventivo di spesa.
Un modello assente da `calls_per_dollar` compare senza prezzo, non a prezzo
zero.

### Opzioni

| opzione | a cosa serve |
|---|---|
| `--dry-run` | costruisce le richieste senza spedirle, non serve la chiave |
| `--jobs N` | richieste in parallelo (default 3) |
| `--redo JOB_ID...` | rigenera solo quei job, ignorando i file esistenti |
| `--model X` | forza il modello per questo giro (col `--redo`, e' la riparazione) |
| `--upgrade JOB_ID...` | rigenera col modello successivo nella scala di preferenza |
| `--no-refs` | inquadrature text-only, per confronto |
| `--fix-size` | riporta in squadra le immagini di dimensione sbagliata |
| `--check-stale` | elenca le inquadrature la cui ancora e' cambiata |

Riprendere una sessione interrotta e' automatico: i job con il file gia'
presente vengono saltati. `--force` rigenera tutto.

### Sidecar

Accanto a ogni immagine viene scritto un `<file>.png.json` con job id,
modello, seed, **prompt effettivo**, tempo di risposta, eventuale scarto di
dimensione e le ancore usate come reference con il loro sha256. Senza, non si
puo' sapere perche' un'immagine e' venuta male, e lo studio non avrebbe niente
da mostrare: il prompt composto e le reference non sono ricostruibili a
posteriori.

### Invalidazione

Rigenerare un'ancora invalida ogni inquadratura che la conteneva. `--check-stale`
confronta gli hash registrati nei sidecar con le reference attuali e stampa la
riga di `--redo` da lanciare. Il confronto e' sui byte spediti, non sul
manifest: e' l'unica cosa che dice la verita' dopo aver rifatto un'ancora.

## 3. Studio (`studio.py`)

```bash
python assets/generator/studio.py assets/out/metalhead/assets_manifest.json \
    -o assets/out/metalhead          # poi http://127.0.0.1:8765
```

E' il posto dove si guarda e si rifa'. Le immagini da rifare non le sceglie un
euristica: si vedono. Il server sta in ascolto solo su localhost — la chiave
API e' nel processo — e non ha dipendenze oltre la stdlib, salvo Pillow per
miniature e ritaglio.

- **Una coda sola, un lavoratore solo**, con pausa, ripresa e svuotamento. La
  pausa non interrompe mai una chiamata a meta': un'immagine gia' pagata
  verrebbe buttata senza far risparmiare niente. Chi vuole parallelismo usa la
  CLI con `--jobs`.
- **Ogni rigenerazione chiede conferma**, dicendo quante immagini, con che
  modello (e se e' il default, *quale* default, che e' diverso fra ancore e
  inquadrature) e quanto costa il giro. Il denaro non si spende per un clic
  fuori posto.
- **Le generazioni precedenti non si perdono**: finiscono in `_versions/` e
  restano nel pannello, con modello, costo e data, riattivabili con un clic.
  Rigenerare non e' una scommessa che cancella l'originale.
- **Il modello si cambia per singola immagine**, scegliendolo dalla scala di
  preferenza ordinata dalla migliore alla peggiore, o per tutta la storia dai
  due menu in alto.
- **Il ritaglio si sceglie guardando l'immagine, e non costa niente**: il file
  come e' arrivato dal modello resta in `_raw/`, quindi cambiare fra ritaglio
  centrale, dall'alto, dal basso, intero con bordi riempiti, deformato o
  nessuno e' aritmetica locale su un file gia' pagato.
- **Svuota tutto** con conferma che dice quanto costerebbe rifarle.

Le impostazioni stanno in `_studio.json` dentro la cartella di output: modelli
di default e modo di ritaglio per immagine. Il manifest non viene mai
riscritto — cambiare il default nella pagina non obbliga a rigenerarlo.

## 4. Prototipazione (`prototype.py`)

Prima di lanciare 88 job ci sono tre domande da chiudere, e costano pochi
euro invece di una serata:

```bash
python assets/generator/prototype.py probe --seed-check
python assets/generator/prototype.py compare assets/out/metalhead/assets_manifest.json \
    -o assets/out/metalhead --shots 2 --models nanobanana-2-lite gpt-image-2
python assets/generator/prototype.py sheet -o assets/out/metalhead
```

### `probe` — l'API si comporta come dice la documentazione?

Due cose non sono verificabili sulla carta: il path esatto della GET (il
client ne prova due e ricorda quello che risponde) e il fatto che `seed` non
compaia fra i campi documentati della POST. `probe` genera un'immagine per
modello, prova l'endpoint con reference a 1 e a 3 allegati usando swatch
sintetici — non servono ancore vere — riporta le dimensioni davvero
restituite, e con `--seed-check` verifica la riproducibilita'.

**Il controllo usa tre chiamate, non due, e la ragione conta.** Pollinations
serve una risposta in cache per richieste identiche: due chiamate uguali che
tornano uguali non dimostrano niente, perche' la cache restituisce lo stesso
file anche se il parametro viene scartato. Il tempo di risposta lo tradisce —
millisecondi invece di secondi — ma non e' una prova. Quindi: due chiamate
con lo stesso seed e una con un seed diverso, e il verdetto e' `onorato` solo
se le prime due coincidono **e** la terza differisce.

**La sonda sintetica non basta a promuovere un modello.** Uno dei candidati e'
passato il probe con gli swatch e ha risposto `500` su ogni prompt vero: gli
allegati finti sono piccoli, quadrati e senza contenuto, e non provano il
percorso che conta. Un modello si dichiara utilizzabile solo dopo un
`compare` su inquadrature reali.

### `anchors` — di chi e' la colpa se un'ancora viene male?

Quando un'ancora ignora l'inquadratura neutra chiesta ci sono due sospetti e
un solo cadavere: puo' essere il modello, o puo' essere il prompt. Generando
la stessa ancora con modelli diversi e lo stesso identico prompt, la risposta
si legge a occhio. Non tocca `anchors/`: le varianti finiscono in `_proto/`.

### `compare` — il condizionamento tiene, e quale modello lo tiene meglio?

Sceglie da solo le inquadrature con **piu' personaggi in campo** (e' li' che
il rischio di mescolare i soggetti e' massimo), genera le ancore che
mancano, e produce la stessa inquadratura con ogni modello candidato piu' una
**baseline `text-only`**. La baseline e' la meta' che conta: senza un termine
di paragone non sai se il reference sta aggiungendo qualcosa o stai solo
pagando di piu'.

Il numero di chiamate viene stampato **prima**, e senza `--yes` non parte
niente. Le varianti gia' presenti vengono saltate confrontando il **prompt
registrato nel sidecar**, non l'esistenza del file: dopo una riscrittura dei
prompt, una variante vecchia va rifatta, e controllare solo il nome del file
la lasciava li' a mentire.

### `sheet` — cosa vedo io guardandole?

Contact sheet HTML autoportante: le ancore in una striscia compatta e sotto
tutte le varianti affiancate **in ordine di costo**, ognuna col suo prezzo a
chiamata, con modello, latenza, peso e prompt richiudibile. `reject` toglie
dal foglio le varianti bocciate, cosi' il confronto successivo parte da quelle
ancora in gara invece che da tutto lo storico.

## 5. I modelli provati, con i numeri

Ventuno modelli sulle **stesse due inquadrature** — una scena in auto con tre
personaggi in campo e uno sfondo senza personaggi — con lo stesso prompt e lo
stesso seed, in genere sia con le ancore allegate sia in baseline text-only.
Diciotto sono arrivati a produrre un'immagine confrontabile; gli altri tre non
hanno superato la prima chiamata vera.

### Chi ha prodotto qualcosa

Ordinati dal piu' economico al piu' caro. `$/img` viene dal listino del
fornitore (`model_costs.json`); i **secondi sono la media delle due
inquadrature** e vanno letti come ordine di grandezza, non come misura — il
carico dell'API varia parecchio fra una sessione e l'altra. La colonna
**resa** e' la dimensione davvero restituita a fronte di 1024x1024 richiesti;
dove ce ne sono due, il modello sceglie il formato in base al contenuto.

| modello | ref | $/img | s | resa | esito |
|---|:--:|--:|--:|---|---|
| `zimage` (baseline) | no | 0.004 | 6 | 1024x1024 | scartato — aderenza |
| `klein` | si' | 0.005 | 14 | 1024x1024 | scartato — aderenza |
| `klein` text-only | no | 0.005 | 6 | 1024x1024 | scartato — aderenza |
| `gptimage` | si' | 0.010 | 25 | 1536x1024 / 1024x1536 | scartato — aderenza e prezzo |
| `gptimage` text-only | no | 0.010 | 19 | 1024x1024 | scartato — aderenza |
| `grok-imagine` | si' | 0.020 | 17 | 2048x2048 | scartato — non tiene la scena |
| **`grok-imagine` text-only** | no | 0.020 | 15 | 2048x2048 | **default ancore** |
| `qwen-image` | si' | 0.025 | 14 | 1024x1024 | scartato — aderenza |
| `qwen-image` text-only | no | 0.025 | 7 | 1328x1328 | scartato — aderenza |
| `kontext` | si' | 0.029 | 10 | 1024x1024 | scartato — aderenza |
| `wan-image` | si' | 0.029 | 21 | 2048x2048 | scartato — tratti semplificati |
| `wan-image-pro` | si' | 0.029 | 27 | 2048x2048 | scartato — tratti semplificati |
| **`nanobanana-2-lite`** | si' | 0.033 | 10 | 1024x1024 | **default inquadrature** |
| `gpt-image-2` | si' | 0.033 | 51 | 1536x1024 / 1254x1254 | tenuto — 3o gradino |
| `seedream5` | si' | 0.033 | 64 | 2048x2048 | scartato — tratti semplificati |
| `gptimage-large` | si' | 0.040 | 28 | 1536x1024 / 1024x1536 | tenuto — 4o gradino |
| `nanobanana` | si' | 0.040 | 14 | 1024x1024 | tenuto — il migliore |
| `seedream-pro` | si' | 0.040 | 34 | 2048x2048 | scartato — tratti semplificati |
| `grok-imagine-pro` | si' | 0.050 | 10 | 1024x1024 | scartato — non tiene la scena |
| `qwen-image-3` | si' | 0.050 | 27 | 1024x1024 | scartato — prezzo/qualita' |
| `grok-imagine-image-2.0` | si' | 0.067 | 15 | 1024x1024 | scartato — prezzo/qualita' |
| `nanobanana-2` | si' | 0.067 | 19 | 1024x1024 | scartato — prezzo/qualita' |

### Chi non e' arrivato a un confronto

| modello | cosa e' successo |
|---|---|
| `p-image-edit` | `500` su ogni prompt reale, **pur avendo passato la sonda** con gli allegati sintetici (1 e 3 reference, entrambi ok). E' il motivo per cui il probe da solo non promuove piu' nessuno. |
| `nova-canvas` | `400`: vuole gli allegati in un formato diverso da quello che spediamo. |
| `p-image` | `402 Insufficient balance` alla sonda fatta senza credito, e mai ripreso dopo averlo caricato. Non e' un giudizio: e' un buco. |

### Perche' sono stati scartati

Quattro motivi distinti, che conviene non confondere perche' hanno rimedi
diversi.

- **Aderenza** — la fascia economica (`zimage`, `klein`, `qwen-image`,
  `kontext`, `gptimage`). Compongono un'immagine plausibile ma non quella
  chiesta: numero di personaggi sbagliato, oggetti che il prompt non nomina,
  inquadratura ignorata. E' il punto in cui risparmiare non conviene: ogni
  immagine sbagliata si ripaga rigenerandola, e il risparmio evapora al
  secondo tentativo.
- **Tratti semplificati** — la famiglia `wan` e la famiglia `seedream`.
  Tecnicamente aderenti, ma appiattiscono i volti e perdono i dettagli che
  rendono un personaggio riconoscibile da un'inquadratura all'altra. E' il
  difetto peggiore possibile qui, perche' colpisce esattamente la cosa che il
  tier con reference esiste per proteggere.
- **Non tengono la scena** — le varianti `grok-imagine` con le ancore
  allegate. Curioso: lo stesso modello **senza** reference produce ancore che
  piacciono, ed e' per questo che e' rimasto come default proprio li', dove
  l'identita' non e' ancora in gioco. Un modello puo' essere buono a un
  livello e inutile all'altro.
- **Prezzo/qualita'** — `nanobanana-2`, `qwen-image-3`,
  `grok-imagine-image-2.0`. Costano il doppio dei rimasti e sulle nostre
  inquadrature non davano di piu'. Sono gli unici scartati che non hanno un
  difetto: hanno solo un prezzo.

### Cosa e' rimasto

Dal peggiore al migliore, che e' l'ordine di `preference` nel registro:

```
grok-imagine → nanobanana-2-lite → gpt-image-2 → gptimage-large → nanobanana
```

Default: `grok-imagine` text-only per le ancore, `nanobanana-2-lite` per le
inquadrature. Gli altri tre sono i gradini di riparazione, quelli che lo
studio propone quando un'immagine non convince.

**Il costo non e' il vincolo che sembrava.** L'intera storia di riferimento —
88 immagini con i default — costa **2,61 $**, e salire di un gradino nella
scala vale meno di un centesimo a immagine (da 0.033 a 0.040). Questo ha
chiuso da solo un paio di questioni aperte: niente tier per numero di
personaggi in campo, niente scelta automatica del modello per difficolta'
stimata, nessuna deduplica furba. Qualunque ottimizzazione di costo qui vale
meno della complessita' che aggiunge; conviene invece spendere per rigenerare
quello che non convince.

**Il tempo, invece, si nota.** Fra i tenuti c'e' un fattore cinque
(`nanobanana-2-lite` a ~10 s contro `gpt-image-2` a ~50 s), ed e' la ragione
per cui il default e' il piu' rapido dei due a parita' di prezzo: su 64
inquadrature in coda la differenza e' fra dieci minuti e quasi un'ora.

## 6. Aderenza al prompt: cosa non si risolve scrivendo meglio

E' la parte che ha richiesto piu' tempo, e quasi nessuna delle difficolta' si e'
risolta cambiando modello.

- **L'identita' non e' trasmissibile a parole.** La baseline text-only, a
  parita' di prompt e di seed, restituisce una persona diversa a ogni
  chiamata. Da qui il tier con reference, che non e' un'ottimizzazione ma il
  requisito.
- **Testo e riferimento competono.** Se un personaggio e' allegato *e*
  descritto a parole, il modello media fra le due cose e il risultato somiglia
  a entrambe e a nessuna. Il prompt con reference e' stato quindi ridotto
  all'osso.
- **Senza nomi, i ruoli finiscono a caso.** In un'inquadratura con due
  personaggi allegati e nessun nome nel testo, il modello sceglie da solo chi
  guida e chi sta seduto accanto — e sbaglia meta' delle volte. Da qui la
  mappa numerata degli allegati e i nomi nel prompt inglese.
- **L'italiano perde aderenza, e a volte viene proprio scartato.** Uno style
  suffix in coda a un prompt italiano lungo puo' essere ignorato in blocco. I
  modelli sono addestrati in inglese: e' l'inglese che va spedito.
- **Certe cose sono un problema di inquadratura, non di parole.** Una scena
  con due persone sedute davanti in un'abitacolo, ripresa frontalmente, ha
  prodotto un secondo volante su ogni modello provato e dopo tre riscritture
  del prompt. Regola pratica adottata: **dopo due riscritture fallite si
  cambia inquadratura**, non si riscrive una terza volta.
- **Il contenuto batte il promemoria di taglio.** Un `visual_prompt` che
  nominava le scarpe tirava l'immagine a figura intera qualunque cosa dicesse
  il preset di inquadratura. Le parole vincono sui vincoli: se non deve
  entrare, non va nominato.
- **Le parole del preset spingono sullo stile, non solo sul taglio.** Un
  preset che diceva "ritratto di riferimento, posa frontale, dalla testa ai
  piedi" ha fatto alzare in piedi un soggetto non umano rendendolo
  antropomorfo. I preset ora descrivono il ritaglio e basta.
- **La dimensione richiesta e' un suggerimento.** Diversi modelli restituiscono
  la misura che preferiscono, anche molto piu' grande. Da qui il controllo
  sulle dimensioni, la conservazione dell'originale in `_raw/` e la scelta del
  ritaglio nello studio: si paga una volta e si decide dopo.
- **Il fotorealismo a basso costo non regge.** Era la scelta iniziale
  (fotografia cinematografica in bianco e nero) ed e' quella che ha dato piu'
  problemi: bastano piccoli difetti perche' un'immagine fotorealistica sembri
  sbagliata, e la coerenza fra inquadrature era irraggiungibile. Il passaggio a
  un **cel-shaded piatto a colori** ha risolto piu' cose di qualunque modifica
  ai prompt: piu' coerente fra un'inquadratura e l'altra, meno riconoscibile
  come immagine generata, e piu' vicino a un aspetto giocabile. La pixel art
  resta una passata deterministica in post, non un'istruzione nel prompt.

## 7. Cosa e' cambiato nei prompt e nello schema

Le difficolta' qui sopra non si correggono nel generatore: nascono in
compilazione. Sono quindi rientrate nell'IR e nella skill del compilatore.

**Schema** (`skills/story-ir-compiler/references/engine-ir.schema.json`):

- **sette campi `*_en`** — `image_style_suffix_en`, i `visual_prompt_en` di
  personaggi, luoghi e oggetti, i loro override di scena e
  `background.image_prompt_en`. L'italiano resta il canonico: e' quello che il
  player mostra in modalita' solo testo, ed e' quello su cui il generatore
  ricade se l'inglese manca. L'inglese esiste solo per il modello.
- **`global_style.anchor_framing`** (`bust`, `waist-up`, `full-body`) con
  `Character.anchor_framing` come override, ammesso **solo per i soggetti non
  umani**. Il taglio delle ancore e' una decisione sull'intero cast, non
  personaggio per personaggio: un cast con ritagli diversi sembra venire da
  storie diverse, e questa e' l'unica scelta che rende omogeneo tutto il resto.

**Regole di compilazione** (stage A e B):

- ogni prompt di generazione si scrive due volte, e l'inglese e' una
  **traduzione fedele** — con una sola divergenza ammessa: negli
  `image_prompt_en` i personaggi in campo si chiamano per nome, perche' e' li'
  che il modello lega l'allegato al soggetto. L'italiano resta prosa da
  sceneggiatura, ed e' giusto che lo sia: e' testo per il giocatore.
- il `visual_prompt` descrive **l'aspetto, non l'azione**, e si ferma dove si
  ferma il taglio scelto per il cast.
- il taglio delle ancore si decide una volta, in stage A, guardando l'intero
  cast.

**Attrezzo di appoggio**: `translate_ir.py` (`extract` / `merge` / `status`)
serve a mettere l'inglese in un IR gia' compilato senza ricompilarlo, ed e'
come l'IR di riferimento e' stato portato a 119 campi tradotti.

## 8. Note

- Lo stile lo detta la storia, non la pipeline: `global_style.image_style_suffix`
  finisce in coda a ogni prompt.
- **Pixel art: passata deterministica in post, non nel prompt.** La diffusione
  non produce vera pixel art (griglia sbagliata, bordi antialiasati, palette
  che cambia a ogni immagine) e il condizionamento su reference tende per di
  piu' a ripulire. Si genera nello stile normale e si applica downscale
  nearest-neighbor + riduzione palette come stadio di pipeline: cosi' il look
  e' identico su tutte le inquadrature per costruzione. Non ancora
  implementato.
- `selftest.py` e `selftest_prototype.py` provano le due catene con il
  trasporto HTTP stubbato: nessuna rete, nessuna chiave. Verificano che il
  multipart porti gli allegati giusti, che le reference siano convertite, che
  il sidecar registri gli hash, che `check_stale` se ne accorga quando
  un'ancora cambia, e che `compare` non spenda niente senza `--yes`.

## Archivio: la versione Kaggle

`kaggle_zimage.ipynb` e' il prototipo precedente, che girava Z-Image Turbo in
locale sulla GPU gratuita di Kaggle con scambio manuale di JSON e zip. E'
superato — il modello con reference non e' `zimage`, quindi su Kaggle il tier
che porta il rischio vero non era provabile — ma le note empiriche che seguono
restano valide se un giorno si torna a generare in locale:

- **VRAM sulla T4 (14.6 GB usabili).** Il transformer in 16 bit ne occupa ~12:
  a 1024x1024 il picco dell'attenzione ne chiede altri ~1.9 in un colpo solo e
  va in OOM. Da qui `MAX_SIDE = 768`, attention/VAE slicing, e liberare la VRAM
  dopo **ogni** job — senza quest'ultima cosa il primo OOM lascia la memoria
  sporca e fa cadere a valanga tutti i job successivi.
- **bf16 obbligatorio, verificato.** In float16 il transformer va in NaN: i
  latenti escono non finiti prima ancora della decodifica e le immagini sono
  tutte nere. Su T4 il bf16 e' emulato (nativo solo da Ampere), quindi piu'
  lento, ma non satura.
- **Immagini nere = NaN, non prompt**, e il punto di saturazione va distinto:
  latenti gia' NaN significa transformer e serve un altro dtype; latenti buoni
  e immagine NaN significa che satura solo la decodifica, e basta riportare il
  VAE a fp32 tenendo il resto in fp16.
- **Un solo caricamento del modello per run**: pesa ~12 GB nella RAM di
  sistema, e caricarne due in sequenza fa morire il kernel per esaurimento
  memoria di sistema, non VRAM.
