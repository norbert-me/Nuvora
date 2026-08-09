#!/bin/bash
# Nuvora — Selbsttest der laufenden Installation.
#
# Laeuft am Ende von ./deploy.sh automatisch und lässt sich jederzeit von Hand
# aufrufen. Zwei Teile:
#
#   scripts/selftest.py          API und Einrichtung, echter Schreib-Roundtrip
#                                je Modul (legt Testdaten an und raeumt sie ab)
#   scripts/selftest-browser.mjs Rundgang im echten Browser: Seiten, Konsole,
#                                Verlinkungen (nur mit --browser)
#
# Zugang kommt aus .deploy.env:
#   SELFTEST_EMAIL / SELFTEST_PASSWORD  Konto, mit dem geprueft wird
#   SELFTEST_URL                        Adresse (sonst SITE_URL)
# Ohne Zugangsdaten laufen nur die Checks ohne Login.
#
# Nutzung: ./selftest.sh                 API-Selbsttest
#          ./selftest.sh --browser       zusaetzlich der Browser-Rundgang
#          ./selftest.sh --nur-system    ohne Login, ohne Schreiben
#          ./selftest.sh --url https://… gegen eine andere Instanz

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/.deploy.env" ]; then
  # shellcheck disable=SC1091
  . "$DIR/.deploy.env"
fi

# Adresse: --url schlaegt alles, sonst SELFTEST_URL, sonst SITE_URL, sonst der
# lokale Port. Der Test laeuft von diesem Rechner aus gegen die oeffentliche
# Adresse — genau der Weg, den auch eine Lehrkraft nimmt.
URL="${SELFTEST_URL:-${SITE_URL:-http://localhost:${PORT:-8080}}}"

MIT_BROWSER=0
ARGS=()
# --url gleich hier mitnehmen. Ein nachtraeglicher Durchlauf durch ARGS ist in
# der macOS-Bash (3.2) mit set -u nicht sicher: bei leerem Array liefert die
# Index-Expansion ein leeres Element und ARGS[""] bricht mit "unbound variable".
while [ $# -gt 0 ]; do
  case "$1" in
    --browser) MIT_BROWSER=1; shift ;;
    --url) URL="${2:-}"; [ -z "$URL" ] && { echo "Fehler: --url braucht eine Adresse."; exit 1; }
           ARGS[${#ARGS[@]}]="--url"; ARGS[${#ARGS[@]}]="$URL"; shift 2 ;;
    --url=*) URL="${1#*=}"; ARGS[${#ARGS[@]}]="--url"; ARGS[${#ARGS[@]}]="$URL"; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) ARGS[${#ARGS[@]}]="$1"; shift ;;
  esac
done

export SELFTEST_URL="$URL"
export SELFTEST_EMAIL="${SELFTEST_EMAIL:-}"
export SELFTEST_PASSWORD="${SELFTEST_PASSWORD:-}"

if [ -z "$SELFTEST_EMAIL" ] || [ -z "$SELFTEST_PASSWORD" ]; then
  echo "Hinweis: SELFTEST_EMAIL/SELFTEST_PASSWORD fehlen in .deploy.env —"
  echo "         Module und Einrichtung bleiben ungeprueft."
  echo ""
fi

STATUS=0
python3 "$DIR/scripts/selftest.py" "${ARGS[@]+"${ARGS[@]}"}" || STATUS=1

if [ "$MIT_BROWSER" = "1" ]; then
  echo ""
  echo "→ Browser-Rundgang (Playwright)..."
  if [ ! -d "$DIR/scripts/node_modules/playwright" ]; then
    echo "  Playwright fehlt — wird einmalig nach scripts/node_modules installiert."
    (cd "$DIR/scripts" && npm install --silent && npx --yes playwright install chromium) || {
      echo "  ⚠ Installation fehlgeschlagen — Browser-Rundgang uebersprungen."
      exit "$STATUS"
    }
  fi
  (cd "$DIR/scripts" && node selftest-browser.mjs --url "$URL" \
     --email "$SELFTEST_EMAIL" --passwort "$SELFTEST_PASSWORD") || STATUS=1
fi

exit "$STATUS"
