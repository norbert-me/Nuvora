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

echo "→ Pflicht-Secrets auf dem Server prüfen..."
# Nicht nur "gibt es eine .env?", sondern "stehen Werte drin?": eine .env mit
# leerem TOKEN_SECRET laesst compose genauso scheitern wie gar keine (${VAR:?}
# greift auch bei leer). Jeder fehlende Pflichtwert wird hier nachgezogen,
# vorhandene Werte bleiben unangetastet.
#
# Die Werte entstehen lokal und gehen per stdin rueber, nicht als Argument:
# so tauchen sie weder in der Prozessliste des Servers noch in einer History auf.
GEN_TOKEN=$(openssl rand -hex 32)
GEN_PGPW=$(openssl rand -hex 24)

BOOTSTRAP=$(ssh "$SERVER" sh -s <<REMOTE
cd '$REMOTE_DIR' || exit 1
t='$GEN_TOKEN'
p='$GEN_PGPW'
$(cat "$DIR/scripts/ensure-env.sh")
REMOTE
)

unset GEN_TOKEN GEN_PGPW

if [ -n "$BOOTSTRAP" ]; then
  echo "  ✓ .env ergänzt (chmod 600):$BOOTSTRAP"
  echo "    Zufallswerte erzeugt — niemand muss sie lesen oder eintippen."
  echo ""
  echo "    Optional für Mailversand und Admin-Konto (ohne läuft alles,"
  echo "    nur ohne Registrierungs- und Reset-Mails):"
  echo "      ssh $SERVER"
  echo "      cd $REMOTE_DIR && nano .env"
  echo ""
else
  echo "  ✓ .env vollständig, unverändert."
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
