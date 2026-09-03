# Le storie

Una storia è una cartella. Dentro c'è tutto quello che la riguarda, e niente che
riguardi altro:

```
stories/metal-head/
  metal-head.zaistory.json  il file giocabile: il contratto, l'unica cosa che il player legge
  sceneggiatura.md          il markdown libero da cui è stato compilato
  playthrough/              partite di riferimento, rigiocabili dalla CLI
    pulito.txt
    giro-lungo.txt
  assets/
    images/                 le immagini pubblicate, WebP, una per id
      shot.auto_in_viaggio.bg.webp
      anchor.char.laura.webp
  _work/                    il banco di lavoro del generatore — non versionato
    assets_manifest.json
    anchors/ shots/         i PNG come sono arrivati dal modello, con i sidecar
    _raw/ _versions/        originali non ritagliati e generazioni precedenti
    _studio.json            modelli, ritagli e quali immagini sono definitive
    _published.json         cosa è già stato copiato negli asset, e da quale file
  play.html                 il player con la storia dentro — prodotto della build, non versionato
```

> ⚠️ Le due storie presenti nel repository si chiamano ancora `story.ir.json` e
> sono sul modello precedente: vanno **ricompilate** sul formato zaistory 1.0.0.
> Vedi `ARCHITECTURE.md`, «Stato del lavoro».

## Perché così

**Una storia si sposta, si archivia e si manda in blocco.** Prima il file
giocabile stava in `examples/`, la sceneggiatura accanto con un altro nome e le
immagini in `assets/out/<altro-nome>/`: tre posti da tenere allineati a mano, e
nessun modo di dire «questa storia» indicando una cosa sola.

**Il nome del file porta l'id della storia**, e il campo `id` dentro il file
deve combaciare — il linter lo verifica. Sono due posti che dicono la stessa
cosa, ed è il tipo di coppia che diverge al primo `mv`. In una cartella ci sta
**esattamente un** `*.zaistory.json`: gli strumenti lo cercano per glob, e zero
file o due file sono un errore, non un caso da gestire.

**La sceneggiatura e il file giocabile stanno accanto perché devono restare
allineati.** `sceneggiatura.md` è la sorgente, `<id>.zaistory.json` è il
compilato: correggere direttamente il compilato è lecito — a volte è l'unica
cosa sensata — ma quella correzione va riportata anche nella sceneggiatura, o la
prima ricompilazione la butta via. La regola sta in `SPECS.md`, «La sceneggiatura
è la sorgente».

**Il banco di lavoro sta dentro la storia ma fuori da git.** `_work/` contiene
per costruzione anche i tentativi: le versioni precedenti, i grezzi non
ritagliati, le miniature. È materiale di produzione, si rigenera, e pesa dieci
volte quello che va pubblicato — 89 MB contro 7 MB sulla storia di riferimento.
Quello che si versiona è `assets/`, cioè quello che qualcuno ha guardato e
approvato.

**Non si cancella prima di una ricompilazione.** I sidecar in `_work/` portano
il prompt effettivo, il modello, il seed e l'hash di ogni generazione: sono
l'unica cosa che permette di riagganciare alle nuove fasi le immagini già
pagate. `_published.json` da solo dice *cosa* è stato pubblicato, non con che
prompt.

**`assets/images/<id>.webp` è una convenzione, non un indice.** Il file nomina
le immagini per **id** (`"image": "shot.auto_in_viaggio.bg"`), mai per percorso:
è il player a sapere dove cercarle, relativamente alla cartella della storia.
Così il file resta trasportabile e non nomina né percorsi né generatori.

## Come ci si arriva

```bash
# 1. compilare la sceneggiatura (skill del compilatore) -> <id>.zaistory.json

# 2. estrarre il manifest degli asset
python assets-studio/images/extract_manifest.py stories/metal-head/metal-head.zaistory.json \
    -o stories/metal-head/_work/assets_manifest.json

# 3. generare e guardare (lo studio pubblica da solo, dal suo pulsante)
./start_assets_studio.sh stories/metal-head     # senza argomenti: chiede quale storia

# 4. oppure pubblicare da riga di comando quello che si è marcato definitivo
python assets-studio/images/publish.py stories/metal-head

# 5. giocare, immagini comprese
./start_local_player.sh
```
