#!/bin/bash
# Werte in die .env des Servers schreiben, ohne sie irgendwo anzuzeigen.
#
# Nutzung:  ./scripts/set-server-env.sh <datei-mit-KEY=WERT-zeilen>
#           ./scripts/set-server-env.sh --edit          (nano -w auf dem Server)
#
# -w ist wichtig: ohne das bricht nano lange Zeilen um, und eine umgebrochene
# Zeile macht die .env für docker compose unlesbar.
#
# Die Datei bleibt auf diesem Rechner, geht per stdin über SSH und taucht weder
# in der Prozessliste des Servers noch in einer History auf. Vorhandene Werte
# werden ersetzt, alles Übrige bleibt stehen; vor der Änderung entsteht eine
# Sicherung (.env.bak-<zeitstempel>).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$DIR/.deploy.env"
: "${SERVER:?SERVER nicht gesetzt (.deploy.env)}"
: "${REMOTE_DIR:?REMOTE_DIR nicht gesetzt (.deploy.env)}"

if [ "${1:-}" = "--edit" ]; then
  exec ssh -t "$SERVER" "cd '$REMOTE_DIR' && cp -p .env .env.bak-\$(date +%Y%m%d-%H%M%S) && \${EDITOR:-nano -w} .env && chmod 600 .env*"
fi

SRC="${1:-}"
[ -f "$SRC" ] || { echo "Fehler: Datei mit KEY=WERT-Zeilen angeben (oder --edit)."; exit 1; }

# Nur Zeilen der Form KEY=WERT übernehmen, Kommentare und Leerzeilen ignorieren.
KEYS=$(grep -E '^[A-Z_]+=' "$SRC" | cut -d= -f1 | tr '\n' ' ')
[ -n "$KEYS" ] || { echo "Fehler: keine KEY=WERT-Zeilen gefunden."; exit 1; }
echo "→ setze auf $SERVER: $KEYS"

grep -E '^[A-Z_]+=' "$SRC" | ssh "$SERVER" "cd '$REMOTE_DIR' || exit 1
  cp -p .env \".env.bak-\$(date +%Y%m%d-%H%M%S)\" 2>/dev/null || true
  while IFS= read -r zeile; do
    key=\${zeile%%=*}
    [ -n \"\$key\" ] || continue
    if grep -q \"^\$key=\" .env 2>/dev/null; then
      awk -v line=\"\$zeile\" -v k=\"\$key\" 'index(\$0, k \"=\") == 1 { print line; next } { print }' .env > .env.tmp && mv .env.tmp .env
    else
      printf '%s\n' \"\$zeile\" >> .env
    fi
  done
  chmod 600 .env .env.bak-* 2>/dev/null || true
  echo '   ✓ .env aktualisiert'"

echo "→ API neu starten, damit die Werte greifen..."
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose up -d api >/dev/null 2>&1 && echo '   ✓ api neu gestartet'"
