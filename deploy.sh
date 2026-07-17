#!/bin/bash
# Nuvora — Deploy des Gesamt-Stacks auf den Server (rsync: nur geänderte Dateien)
# Konfiguration in .deploy.env (siehe .deploy.env.example)
#
# Nutzung: ./deploy.sh                          -> baut alle Services
#          ./deploy.sh api                      -> baut nur diesen Service
#          ./deploy.sh lernpfad proxy           -> baut mehrere
#          ./deploy.sh --port 8090              -> anderer Port, wird in .deploy.env gemerkt
#          ./deploy.sh --port 8090 lernpfad     -> beides kombinierbar
#
# Secrets (TOKEN_SECRET, POSTGRES_PASSWORD, SMTP_*) leben nur auf dem Server
# und werden hier nie angefasst. PORT und SITE_URL dagegen gehoeren zum
# Deployment, stehen in .deploy.env und werden bei jedem Lauf auf den Server
# geschrieben — .deploy.env ist dafuer die Wahrheit, nicht der Serverzustand.

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

# ─── Argumente: --port N, Rest sind zu bauende Services ───
CLI_PORT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p)
      CLI_PORT="${2:-}"
      [ -z "$CLI_PORT" ] && { echo "Fehler: --port braucht eine Nummer, z.B. --port 8090"; exit 1; }
      shift 2
      ;;
    --port=*)
      CLI_PORT="${1#*=}"; shift
      ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's|^# \{0,1\}||'
      exit 0
      ;;
    *)
      ARGS+=("$1"); shift
      ;;
  esac
done

if [ -n "$CLI_PORT" ]; then
  case "$CLI_PORT" in
    ''|*[!0-9]*) echo "Fehler: --port '$CLI_PORT' ist keine Zahl."; exit 1 ;;
  esac
  PORT="$CLI_PORT"
  # In .deploy.env merken, damit der naechste Lauf ohne Flag denselben Port nimmt.
  if grep -q '^PORT=' "$DIR/.deploy.env"; then
    awk -v v="$PORT" 'index($0,"PORT=")==1 { print "PORT=" v; next } { print }' \
      "$DIR/.deploy.env" > "$DIR/.deploy.env.tmp" && mv "$DIR/.deploy.env.tmp" "$DIR/.deploy.env"
  else
    printf 'PORT=%s\n' "$PORT" >> "$DIR/.deploy.env"
  fi

  # SITE_URL muss mitziehen, sonst zeigen Mail-Links und CORS auf den alten
  # Port. Nur anfassen, wenn dort ueberhaupt ein Port steht: hinter einem
  # Reverse Proxy ist SITE_URL eine Domain ohne Port und bleibt korrekt.
  if [ -n "${SITE_URL:-}" ] && printf '%s' "$SITE_URL" | grep -qE ':[0-9]+/?$'; then
    NEW_SITE_URL=$(printf '%s' "$SITE_URL" | sed -E "s|:[0-9]+(/?)$|:$PORT\1|")
    if [ "$NEW_SITE_URL" != "$SITE_URL" ]; then
      SITE_URL="$NEW_SITE_URL"
      awk -v v="$SITE_URL" 'index($0,"SITE_URL=")==1 { print "SITE_URL=\"" v "\""; next } { print }' \
        "$DIR/.deploy.env" > "$DIR/.deploy.env.tmp" && mv "$DIR/.deploy.env.tmp" "$DIR/.deploy.env"
      echo "  SITE_URL mitgezogen: $SITE_URL"
    fi
  fi
  echo "  Port $PORT in .deploy.env gemerkt."
fi

PORT="${PORT:-8080}"
# SITE_URL leer -> aus Serveradresse und Port ableiten (Host hinter dem @).
SITE_URL="${SITE_URL:-http://${SERVER#*@}:$PORT}"

BUILD_SERVICES="${ARGS[*]:-}"

echo "=== Nuvora Deploy ==="
echo "Server: $SERVER"
echo "Pfad:   $REMOTE_DIR"
echo "Port:   $PORT"
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
port='$PORT'
site='$SITE_URL'
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

# Der Port-Konflikt zeigt sich sonst erst, wenn alle Images gebaut sind und
# der Proxy als letzter Container startet — also nach mehreren Minuten.
echo "→ Port prüfen..."
WANT_PORT="$PORT"
PORT_USER=$(ssh "$SERVER" "
  # Belegt der Port schon jemand ANDERES als Nuvoras eigener Proxy?
  # Nuvoras Proxy darf ihn halten — der wird beim Deploy ohnehin ersetzt.
  own=\$(cd '$REMOTE_DIR' && docker compose ps -q proxy 2>/dev/null | head -1)
  other=\$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null | grep ':$WANT_PORT->' | grep -v \"^\$(echo \$own | cut -c1-12)\" | head -1)
  if [ -n \"\$other\" ]; then echo \"docker: \$other\"; exit 0; fi
  # Nicht-Docker-Prozess auf dem Port?
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -E \"[:.]$WANT_PORT \" | head -1
  fi
")

if [ -n "$PORT_USER" ]; then
  echo ""
  echo "  ⚠ Port $WANT_PORT ist auf dem Server schon belegt:"
  echo "      $PORT_USER"
  echo ""
  echo "    Anderen Port nehmen — wird in .deploy.env gemerkt:"
  echo ""
  echo "      ./deploy.sh --port 8090"
  echo ""
  exit 1
fi
echo "  ✓ Port $WANT_PORT frei."

echo "→ Container bauen (${BUILD_SERVICES:-alle})..."
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose build $BUILD_SERVICES && docker compose up -d"

echo "→ Status & Logs..."
sleep 6
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose ps; echo '--- api log (letzte 30) ---'; docker compose logs --tail=30 api; echo '--- lernpfad log (letzte 15) ---'; docker compose logs --tail=15 lernpfad"

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
