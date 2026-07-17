#!/bin/bash
# CardVote — Deploy auf Server (rsync: nur geänderte Dateien)
# Konfiguration in .deploy.env (siehe .deploy.env.example)
# Nutzung: ./deploy.sh            -> baut backend + frontend
#          ./deploy.sh backend    -> baut nur backend
#          ./deploy.sh frontend   -> baut nur frontend

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.deploy.env" ]; then
  echo "Fehler: .deploy.env nicht gefunden. Kopiere .deploy.env.example und passe die Werte an."
  exit 1
fi
source "$DIR/.deploy.env"

BUILD_SERVICES="${1:-backend frontend}"

echo "=== CardVote Deploy ==="
echo "Server: $SERVER"
echo "Pfad:   $REMOTE_DIR"
echo "Build:  $BUILD_SERVICES"
echo ""

# rsync auf dem Server sicherstellen (sonst schlägt die Übertragung fehl)
echo "→ Prüfe rsync auf dem Server..."
ssh "$SERVER" "command -v rsync >/dev/null 2>&1 || { echo 'installiere rsync...'; (apt-get update -qq && apt-get install -y -qq rsync) || apk add --no-cache rsync; }"

# --inplace: NAS-sicher (kein Rename über bestehende Datei). -c: nur bei echtem Inhaltsunterschied übertragen.
RSYNC="rsync -rlz -c --inplace --exclude=__pycache__ --exclude=*.pyc --exclude=.DS_Store"

echo "→ Nur geänderte Dateien hochladen..."
$RSYNC "$DIR/frontend/src/"    "$SERVER:$REMOTE_DIR/frontend/src/"
$RSYNC "$DIR/frontend/public/" "$SERVER:$REMOTE_DIR/frontend/public/"
$RSYNC "$DIR/frontend/index.html" "$DIR/frontend/Dockerfile" "$DIR/frontend/nginx.conf" "$DIR/frontend/package.json" "$DIR/frontend/package-lock.json" "$SERVER:$REMOTE_DIR/frontend/"
$RSYNC "$DIR/backend/app/"     "$SERVER:$REMOTE_DIR/backend/app/"
$RSYNC "$DIR/backend/requirements.txt" "$DIR/backend/VERSION" "$DIR/backend/Dockerfile" "$SERVER:$REMOTE_DIR/backend/"
$RSYNC "$DIR/docker-compose.yml" "$SERVER:$REMOTE_DIR/"

echo "→ Docker Container bauen ($BUILD_SERVICES)..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose build $BUILD_SERVICES && docker compose up -d"

echo "→ Status & Backend-Log (Startup-Check)..."
sleep 6
ssh "$SERVER" "cd $REMOTE_DIR && docker compose ps backend frontend; echo '--- backend log (letzte 30) ---'; docker compose logs --tail=30 backend"

echo "→ Health-Check..."
HEALTH=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health")
echo "  /api/health -> $HEALTH"

echo ""
echo "========================================"
if [ "$HEALTH" = "200" ]; then
  echo "  CardVote deployed! (health OK)"
else
  echo "  ⚠ Backend nicht gesund (health=$HEALTH) — Log oben prüfen!"
fi
echo "  ${SITE_URL:-http://localhost:3001}"
echo "========================================"
