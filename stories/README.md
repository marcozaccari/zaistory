# Le storie

Una storia è una cartella. Dentro c'è tutto quello che la riguarda, e niente
che riguardi altro:

```
stories/metal-head/
  story.ir.json          il formato intermedio: il contratto, l'unica cosa che i player leggono
  sceneggiatura.md       il markdown libero da cui è stata compilata
  playthrough/           partite di riferimento, rigiocabili dalla CLI
    pulito.txt
    giro-lungo.txt
  assets/
    images/              le immagini pubblicate, WebP, una per id
      shot.auto_in_viaggio.bg.webp
      anchor.char.laura.webp
  _work/                 il banco di lavoro del generatore — non versionato
    assets_manifest.json
    anchors/ shots/      i PNG come sono arrivati dal modello, con i sidecar
    _raw/ _versions/     originali non ritagliati e generazioni precedenti
    _studio.json         modelli, ritagli e quali immagini sono definitive
    _published.json      cosa è già stato copiato negli asset, e da quale file
  play.html             il player con l'IR dentro — prodotto della build, non versionato
```

## Perché così

**Una storia si sposta, si archivia e si manda in blocco.** Prima
l'IR stava in `examples/`, la sceneggiatura accanto con un altro nome, e le
immagini in `assets/out/<altro-nome>/`: tre posti da tenere allineati a mano,
e nessun modo di dire "questa storia" indicando una cosa sola.

**Il banco di lavoro sta dentro la storia ma fuori da git.** `_work/` contiene
per costruzione anche i tentativi: le versioni precedenti, i grezzi non
ritagliati, le miniature. È materiale di produzione, si rigenera, e pesa dieci
volte quello che va pubblicato — 78 MB contro 6,7 MB sulla storia di
riferimento. Quello che si versiona è `assets/`, cioè quello che qualcuno ha
guardato e approvato.

**`assets/images/<id>.webp` è una convenzione, non un indice.** L'IR nomina le
immagini per **id** (`"image": "shot.auto_in_viaggio.bg"`), mai per percorso: è
il player a sapere dove cercarle, relativamente alla cartella della storia. Così
l'IR resta trasportabile e non nomina né file né generatori.

## Come ci si arriva

```bash
# 1. compilare la sceneggiatura (skill story-ir-compiler) -> story.ir.json

# 2. estrarre il manifest degli asset
python assets-studio/images/extract_manifest.py stories/metal-head/story.ir.json \
    -o stories/metal-head/_work/assets_manifest.json

# 3. generare e guardare (lo studio pubblica da solo, dal suo pulsante)
./start_assets_studio.sh stories/metal-head     # senza argomenti: chiede quale storia

# 4. oppure pubblicare da riga di comando quello che si è marcato definitivo
python assets-studio/images/publish.py stories/metal-head

# 5. giocare, immagini comprese
./start_local_player.sh
```
