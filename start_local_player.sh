#!/usr/bin/env bash
#
# Costruisce il player web, ci incorpora le storie di examples/ e lo serve su
# http, stampando gli indirizzi con cui aprirlo dal telefono.
#
#   ./start_local_player.sh              # tutte le storie, porta 8000
#   ./start_local_player.sh 8080         # porta diversa
#   ./start_local_player.sh 8080 examples/metalhead.ir.json
#
# Perche' passare da un server invece di aprire il file: il player e' un unico
# HTML e per *giocare* basta aprirlo, anche dal telefono. Ma il backend a
# vettori del resolver ha bisogno di scaricare libreria e modello, e da
# `file://` il browser tratta la pagina come origine opaca e le richieste
# esterne cadono. Servito da http e' una pagina web come un'altra, e funziona.
#
# Nota che evita mezz'ora di perplessita': su http senza TLS il browser non
# considera la pagina un contesto sicuro, quindi niente WebGPU e l'inferenza
# ripiega su WASM. E' piu' lenta, non e' rotta.

set -euo pipefail

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYER="$QUI/player"
PORTA="${1:-8000}"
shift || true

if ! command -v node >/dev/null 2>&1; then
  echo "serve node (22 o piu' recente): non l'ho trovato nel PATH" >&2
  exit 2
fi

# Le storie da incorporare: quelle passate a mano, o tutte quelle in examples/.
if [ "$#" -gt 0 ]; then
  STORIE=("$@")
else
  STORIE=()
  for f in "$QUI"/examples/*.ir.json; do
    [ -e "$f" ] || continue
    STORIE+=("$f")
  done
fi

if [ "${#STORIE[@]}" -eq 0 ]; then
  echo "nessun .ir.json da incorporare (ne' passato a mano, ne' in examples/)" >&2
  exit 2
fi

# Si controlla che i file ci siano *prima* di costruire: un percorso sbagliato
# non deve costare una build intera per poi fallire alla riga dopo.
mancanti=0
for ir in "${STORIE[@]}"; do
  if [ ! -f "$ir" ]; then
    echo "non trovo $ir" >&2
    mancanti=1
  fi
done
[ "$mancanti" -eq 0 ] || exit 2

cd "$PLAYER"

if [ ! -d node_modules ]; then
  echo "==> npm install (solo la prima volta)"
  npm install
fi

echo "==> costruisco il player"
npm run build:web --silent

for ir in "${STORIE[@]}"; do
  # nel-paese-dei-ciechi.ir.json -> dist/nel-paese-dei-ciechi.html
  nome="$(basename "$ir")"
  nome="${nome%.ir.json}"
  echo "==> incorporo $nome"
  node scripts/embed.mjs "$ir" "dist/$nome.html"
done

echo "==> servo su http://0.0.0.0:$PORTA"
# exec: il server prende il posto dello script, cosi' ctrl-c lo ferma davvero
# invece di lasciare in giro un figlio orfano.
exec node scripts/serve.mjs "$PORTA" dist
