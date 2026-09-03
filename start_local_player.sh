#!/usr/bin/env bash
#
# Costruisce il player web, lo incorpora dentro ogni cartella storia e serve
# `stories/` su http, stampando gli indirizzi con cui aprirlo dal telefono.
#
#   ./start_local_player.sh                      # tutte le storie, porta 8000
#   ./start_local_player.sh 8080                 # porta diversa
#   ./start_local_player.sh 8080 stories/metal-head
#
# Perche' il player finisce *dentro* la cartella della storia e non in
# `dist/`: le immagini pubblicate stanno in `stories/<id>/assets/images/`, e
# l'IR le nomina per id, non per percorso. Il player le cerca accanto a se
# stesso, quindi una pagina che sta nella cartella della storia le trova —
# servita da http, e anche copiata su una chiavetta e aperta da file://.
#
# Perche' passare da un server invece di aprire il file: il backend a vettori
# del resolver ha bisogno di scaricare libreria e modello, e da `file://` il
# browser tratta la pagina come origine opaca e le richieste esterne cadono.
# Servito da http e' una pagina web come un'altra, e funziona.
#
# Nota che evita mezz'ora di perplessita': su http senza TLS il browser non
# considera la pagina un contesto sicuro, quindi niente WebGPU e l'inferenza
# ripiega su WASM. E' piu' lenta, non e' rotta.

set -euo pipefail

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYER="$QUI/player"
STORIES="$QUI/stories"

# Il file della storia si chiama <id>.zaistory.json: il nome porta l'id, quindi
# si cerca a glob. Una cartella e' una storia, e ne contiene esattamente uno.
storia_di() {
  local trovati=("$1"/*.zaistory.json)
  if [ "${#trovati[@]}" -ne 1 ] || [ ! -f "${trovati[0]}" ]; then
    echo "in $1 non c'e' esattamente un file .zaistory.json" >&2
    return 1
  fi
  echo "${trovati[0]}"
}
PORTA="${1:-8000}"
shift || true

if ! command -v node >/dev/null 2>&1; then
  echo "serve node (22 o piu' recente): non l'ho trovato nel PATH" >&2
  exit 2
fi

# Le storie: quelle passate a mano, o tutte quelle in stories/. Si accetta sia
# la cartella (`stories/metal-head`) sia l'IR dentro di lei — chi ha in mano il
# percorso di un file non deve fermarsi a togliere l'ultimo pezzo.
STORIE=()
if [ "$#" -gt 0 ]; then
  for arg in "$@"; do
    if [ -f "$arg" ]; then STORIE+=("$(cd "$(dirname "$arg")" && pwd)")
    elif [ -d "$arg" ]; then STORIE+=("$(cd "$arg" && pwd)")
    else echo "non trovo $arg" >&2; exit 2
    fi
  done
else
  for d in "$STORIES"/*/; do
    [ -n "$(ls "$d"/*.zaistory.json 2>/dev/null)" ] && STORIE+=("${d%/}")
  done
fi

if [ "${#STORIE[@]}" -eq 0 ]; then
  echo "nessuna storia con un file .zaistory.json (ne' passata a mano, ne' in stories/)" >&2
  exit 2
fi

# Si controlla che gli IR ci siano *prima* di costruire: un percorso sbagliato
# non deve costare una build intera per poi fallire alla riga dopo.
mancanti=0
for s in "${STORIE[@]}"; do
  if [ -z "$(ls "$s"/*.zaistory.json 2>/dev/null)" ]; then
    echo "in $s non c'e' nessun file .zaistory.json" >&2
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

for s in "${STORIE[@]}"; do
  nome="$(basename "$s")"
  immagini=$(ls "$s/assets/images"/*.webp 2>/dev/null | wc -l || true)
  echo "==> $nome ($immagini immagini pubblicate)"
  node scripts/embed.mjs "$(storia_di "$s")" "$s/play.html"
done

echo "==> servo su http://0.0.0.0:$PORTA"
# exec: il server prende il posto dello script, cosi' ctrl-c lo ferma davvero
# invece di lasciare in giro un figlio orfano.
exec node scripts/serve.mjs "$PORTA" "$STORIES"
