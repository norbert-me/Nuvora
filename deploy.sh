#!/bin/bash
# Nuvora — Deploy des Gesamt-Stacks auf den Server (rsync: nur geänderte Dateien)
# Konfiguration in .deploy.env (siehe .deploy.env.example)
#
# Nutzung: ./deploy.sh                     -> baut alle Services
#          ./deploy.sh cardvote-backend    -> baut nur diesen Service
#          ./deploy.sh lernpfad proxy      -> baut mehrere
#
# Die .env des Servers wird NIE überschrieben: Secrets leben nur dort.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.deploy.env" ]; then
  echo "Fehler: .deploy.env nicht gefunden. Kopiere .deploy.env.example und passe die Werte an."
  exit 1
fi
# shellcheck disable=SC1091
. "$DIR/.deploy.env"

: "${SERVER:?SERVER nicht gesetzt (.deploy.env)}"
: "${REMOTE_DIR:?REMOTE_DIR nicht gesetzt (.deploy.env)}"

BUILD_SERVICES="${*:-}"

echo "=== Nuvora Deploy ==="
echo "Server: $SERVER"
echo "Pfad:   $REMOTE_DIR"
echo "Build:  ${BUILD_SERVICES:-alle Services}"
echo ""

echo "→ Prüfe rsync auf dem Server..."
ssh "$SERVER" "command -v rsync >/dev/null 2>&1 || { echo 'installiere rsync...'; (apt-get update -qq && apt-get install -y -qq rsync) || apk add --no-cache rsync; }"

echo "→ Zielverzeichnis sicherstellen..."
ssh "$SERVER" "mkdir -p '$REMOTE_DIR'"

# --inplace: NAS-sicher (kein Rename über bestehende Datei).
# -c: nur bei echtem Inhaltsunterschied übertragen.
# --delete: entfernt auf dem Server, was hier weg ist — hält den Stand sauber.
# Ausgeschlossen: alles was Secrets, Laufzeitdaten oder Ballast ist. Die .env
# und die Daten des Servers gehören dem Server, nicht diesem Rechner.
echo "→ Nur geänderte Dateien hochladen..."
rsync -rlz -c --inplace --delete \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.deploy.env' \
  --exclude='node_modules/' \
  --exclude='venv/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='dist/' \
  --exclude='data/' \
  --exclude='backups/' \
  --exclude='uploads/' \
  --exclude='*.db' \
  --exclude='.DS_Store' \
  --exclude='.claude/' \
  "$DIR/" "$SERVER:$REMOTE_DIR/"

echo "→ .env auf dem Server vorhanden?"
if ! ssh "$SERVER" "test -f '$REMOTE_DIR/.env'"; then
  echo ""
  echo "  ⚠ Keine .env auf dem Server. Der Stack startet ohne POSTGRES_PASSWORD"
  echo "    und TOKEN_SECRET absichtlich nicht. Einmalig anlegen:"
  echo ""
  echo "      ssh $SERVER"
  echo "      cd $REMOTE_DIR && cp .env.example .env && vi .env"
  echo "      # TOKEN_SECRET erzeugen: openssl rand -hex 32"
  echo ""
  exit 1
fi

echo "→ Container bauen (${BUILD_SERVICES:-alle})..."
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose build $BUILD_SERVICES && docker compose up -d"

echo "→ Status & Logs..."
sleep 6
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose ps; echo '--- cardvote-backend log (letzte 30) ---'; docker compose logs --tail=30 cardvote-backend; echo '--- lernpfad log (letzte 15) ---'; docker compose logs --tail=15 lernpfad"

PORT="${PORT:-8080}"
echo "→ Health-Checks (auf dem Server, Port $PORT)..."
CV=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/health" || echo "000")
LP=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/lernpfad/" || echo "000")
echo "  /api/health  -> $CV   (CardVote)"
echo "  /lernpfad/   -> $LP   (Lernpfad)"

echo ""
echo "========================================"
if [ "$CV" = "200" ] && [ "$LP" = "200" ]; then
  echo "  Nuvora deployed — beide Module gesund."
  echo "  ${SITE_URL:-http://localhost:$PORT}"
  echo "========================================"
else
  [ "$CV" != "200" ] && echo "  ⚠ CardVote nicht gesund (health=$CV)"
  [ "$LP" != "200" ] && echo "  ⚠ Lernpfad nicht gesund (status=$LP)"
  echo "  Logs oben prüfen."
  echo "========================================"
  exit 1
fi
