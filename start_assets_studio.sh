#!/usr/bin/env bash
#
# Apre lo studio degli asset su una storia e lo serve in rete locale,
# stampando gli indirizzi con cui aprirlo dal telefono.
#
#   ./start_assets_studio.sh                          # chiede quale storia
#   ./start_assets_studio.sh stories/metal-head       # va diretto
#   ./start_assets_studio.sh 9000                     # da un'altra porta
#   ./start_assets_studio.sh stories/metal-head 9000  # in qualunque ordine
#   ./start_assets_studio.sh stories/a stories/b      # due studi, due porte
#
# Senza argomenti chiede **sempre**, anche quando di storie ce n'e' una sola:
# uno script che a volte chiede e a volte parte da solo e' uno script di cui
# non ti fidi, e con l'invio la domanda costa un tasto. L'elenco dice anche a
# che punto e' ciascuna — quante generate, quante definitive, quante gia'
# pubblicate — perche' e' quello che serve per scegliere, ed e' l'unica
# ragione per cui un menu batte una lista di nomi da copiare a mano.
#
# Anche le storie a cui manca il manifest si scelgono: estrarlo non costa
# niente e non chiama nessuna API, quindi lo script si offre di farlo invece
# di stampare un comando da copiare.
#
# Perche' in rete e non solo su localhost: un'immagine si giudica sullo
# schermo su cui verra' guardata. Le stesse ancore che sul monitor sembrano a
# posto, su un telefono da sei pollici perdono meta' dei dettagli — ed e' li'
# che la storia si giochera'.
#
# Il prezzo di quella comodita' va detto: la pagina non chiede nessuna
# password, e da quella pagina si generano immagini a pagamento. Su una rete
# di casa e' un rischio ragionevole; su una rete che non e' tua, lancia
# `assets-studio/images/studio.py` a mano, che di suo ascolta solo su localhost.
#
# Il banco di lavoro sta dentro la storia (`<storia>/_work`), quindi lo studio
# sa da solo dove pubblicare: le immagini marcate come definitive finiscono in
# `<storia>/assets/images/` e i loro id nel file della storia.

set -euo pipefail

QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
STUDIO="$QUI/assets-studio/images/studio.py"
PORTA=8765
STORIE=()
SCELTE_A_MANO=0

# Gli argomenti si riconoscono da soli: un numero e' la porta, il resto e' una
# storia. Ricordarsi l'ordine di due parametri e' esattamente il genere di
# cosa che fa riaprire lo script per guardarci dentro.
for arg in "$@"; do
  if [[ "$arg" =~ ^[0-9]+$ ]]; then
    PORTA="$arg"
  elif [ -d "$arg" ]; then
    STORIE+=("$(cd "$arg" && pwd)"); SCELTE_A_MANO=1
  elif [ -f "$arg" ]; then                       # e' stato passato l'IR o il manifest
    d="$(cd "$(dirname "$arg")" && pwd)"
    [ "$(basename "$d")" = "_work" ] && d="$(dirname "$d")"
    STORIE+=("$d"); SCELTE_A_MANO=1
  else
    echo "non trovo $arg" >&2
    exit 2
  fi
done

if [ "${#STORIE[@]}" -eq 0 ]; then
  for d in "$QUI"/stories/*/; do
    [ -n "$(ls "$d"/*.zaistory.json 2>/dev/null)" ] && STORIE+=("${d%/}")
  done
fi

if [ "${#STORIE[@]}" -eq 0 ]; then
  echo "nessuna storia in stories/ (serve almeno un file .zaistory.json)" >&2
  exit 2
fi

comando_estrazione() {
  echo "  python3 assets-studio/images/extract_manifest.py $(storia_di "$1") \\"
  echo "      -o $1/_work/assets_manifest.json"
}

# Estrae il manifest di una storia che non ce l'ha. Non chiama nessuna API e
# non spende: e' lettura dell'IR e aritmetica, quindi si puo' offrire di farlo
# li' per li' invece di rimandare a un comando da copiare.
estrai() {
  echo ""
  echo "==> estraggo il manifest di $(basename "$1")"
  python3 "$QUI/assets-studio/images/extract_manifest.py" "$(storia_di "$1")" \
      -o "$1/_work/assets_manifest.json"
  echo ""
}

pronta() { [ -f "$1/_work/assets_manifest.json" ]; }

# A che punto e' ciascuna: un giro solo di python per tutte, perche' aprire un
# manifest per volta da bash costerebbe mezzo secondo a storia.
riepiloghi() {
  python3 - "$@" <<'PY'
import json, pathlib, sys
for root in sys.argv[1:]:
    d = pathlib.Path(root); work = d / "_work"
    try:
        man = json.loads((work / "assets_manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print(f"{root}\t(manifest illeggibile)"); continue
    jobs = man.get("jobs", [])
    fatte = sum(1 for j in jobs if (work / j["file"]).is_file())
    def conta(nome, chiave=None):
        try:
            doc = json.loads((work / nome).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return 0
        return len(doc.get(chiave) or {}) if chiave else len(doc)
    definitive = conta("_studio.json", "approved")
    pubblicate = conta("_published.json")
    print(f"{root}\t{len(jobs)} job · {fatte} generate · "
          f"{definitive} definitive · {pubblicate} pubblicate")
PY
}

# Nessuna storia indicata: si chiede, sempre.
if [ "$SCELTE_A_MANO" -eq 0 ]; then
  if [ ! -t 0 ]; then
    # Nessuno a cui chiedere (pipe, cron): si dice cosa c'e' e ci si ferma,
    # invece di scegliere al posto di chi ha lanciato.
    echo "passa la storia come argomento. Disponibili:" >&2
    for s in "${STORIE[@]}"; do
      pronta "$s" && echo "  $s" >&2 || echo "  $s   (manifest da estrarre)" >&2
    done
    exit 2
  fi

  declare -A STATO=()
  PRONTE=()
  for s in "${STORIE[@]}"; do pronta "$s" && PRONTE+=("$s"); done
  if [ "${#PRONTE[@]}" -gt 0 ]; then
    while IFS=$'\t' read -r percorso testo; do STATO["$percorso"]="$testo"; done \
      < <(riepiloghi "${PRONTE[@]}")
  fi

  echo ""
  echo "  Quale storia vuoi aprire?"
  echo ""
  i=1
  for s in "${STORIE[@]}"; do
    printf "  %d) %-24s %s\n" "$i" "$(basename "$s")" \
      "${STATO[$s]:-manifest da estrarre}"
    i=$((i + 1))
  done
  echo ""

  while true; do
    read -rp "  numero o nome [1], q per uscire: " scelta || exit 0
    [ "$scelta" = "q" ] && exit 0
    [ -z "$scelta" ] && scelta=1          # l'invio prende la prima
    UNA=""
    if [[ "$scelta" =~ ^[0-9]+$ ]] && [ "$scelta" -ge 1 ] && [ "$scelta" -le "${#STORIE[@]}" ]; then
      UNA="${STORIE[$((scelta - 1))]}"
    else
      for s in "${STORIE[@]}"; do [ "$(basename "$s")" = "$scelta" ] && UNA="$s"; done
    fi
    if [ -z "$UNA" ]; then
      echo "  non ho capito: scrivi un numero da 1 a ${#STORIE[@]}, il nome della storia, o q."
      continue
    fi
    if ! pronta "$UNA"; then
      # Estrarre non spende, ma scrive nella cartella della storia: si chiede
      # lo stesso, perche' i default (dimensione, modelli) li sceglie il
      # comando e chi li vuole diversi deve poterlo lanciare a mano.
      read -rp "  $(basename "$UNA") non ha ancora il manifest. Lo estraggo? [S/n] " ok || exit 0
      case "${ok,,}" in
        n|no) echo ""; echo "  allora, quando vuoi:"; comando_estrazione "$UNA"; exit 0 ;;
      esac
      estrai "$UNA"
    fi
    PRONTE=("$UNA"); break
  done
  echo ""
else
  # Storie indicate a mano: se a una manca il manifest ci si ferma, senza
  # estrarre di nascosto.
  PRONTE=()
  for s in "${STORIE[@]}"; do
    if pronta "$s"; then
      PRONTE+=("$s")
    else
      echo "$(basename "$s") non ha il manifest degli asset. Per estrarlo:" >&2
      comando_estrazione "$s" >&2
      exit 2
    fi
  done
fi

avvia() {  # <storia> <porta> [altro...]
  python3 "$STUDIO" "$1/_work/assets_manifest.json" \
    -o "$1/_work" --story "$1" --port "$2" --host 0.0.0.0 "${@:3}"
}

# Una sola: nessuna cerimonia, il server prende il posto dello script — cosi'
# ctrl-c lo ferma davvero invece di lasciare in giro un figlio orfano — e apre
# il browser di questo computer.
if [ "${#PRONTE[@]}" -eq 1 ]; then
  UNA="${PRONTE[0]}"
  echo "==> $(basename "$UNA") · porta $PORTA"
  # `exec` non sa eseguire una funzione di shell: qui il comando va per esteso.
  exec python3 "$STUDIO" "$UNA/_work/assets_manifest.json" \
    -o "$UNA/_work" --story "$UNA" --port "$PORTA" --host 0.0.0.0
fi

# Piu' d'una indicata a mano: uno studio per storia, su porte consecutive.
# Niente browser aperto d'ufficio — tre schede all'avvio sono due di troppo —
# e un riepilogo in fondo, dopo i banner, perche' e' l'ultima cosa che resta
# sullo schermo.
PIDS=()
ferma() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap ferma INT TERM EXIT

RIGHE=()
porta="$PORTA"
for s in "${PRONTE[@]}"; do
  echo "==> $(basename "$s") · porta $porta"
  avvia "$s" "$porta" --no-open &
  PIDS+=("$!")
  RIGHE+=("$(printf '  %-26s http://%%s:%s' "$(basename "$s")" "$porta")")
  porta=$((porta + 1))
done

sleep 2                      # il tempo che ogni studio stampi il suo banner

IP="$(python3 - "$QUI" <<'PY'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(sys.argv[1]) / "assets" / "generator"))
import studio
print((studio.indirizzi_di_rete() or ["127.0.0.1"])[0])
PY
)"

echo ""
echo "==> ${#PRONTE[@]} studi aperti"
for r in "${RIGHE[@]}"; do
  # shellcheck disable=SC2059
  printf "$r\n" "$IP"
done
echo ""
echo "  dal telefono: stessa rete wi-fi, apri uno degli indirizzi qui sopra."
echo "  (ctrl-c li ferma tutti)"
echo ""

wait
