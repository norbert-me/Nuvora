#!/bin/bash
# Nuvora — Deploy des Gesamt-Stacks auf den Server (rsync: nur geänderte Dateien)
# Konfiguration in .deploy.env (siehe .deploy.env.example)
#
# Nutzung: ./deploy.sh                          -> baut alle Services
#          ./deploy.sh api                      -> baut nur diesen Service
#          ./deploy.sh web proxy               -> baut mehrere
#          ./deploy.sh --port 8090              -> anderer Port, wird in .deploy.env gemerkt
#          ./deploy.sh --port 8090 web           -> beides kombinierbar
#          ./deploy.sh --schnelltest             -> nur der kurze API-Selbsttest
#          ./deploy.sh --kein-selftest           -> ohne Selbsttest ausliefern
#
# Nach dem Deploy laeuft ./selftest.sh VOLLSTAENDIG: API und Einrichtung, dann
# jedes Modul einzeln (nur dieses aktiv, alle anderen muessen abweisen), dann
# der Rundgang im echten Browser. Das dauert ein paar Minuten und ist Absicht:
# ein gruener Deploy soll heissen "die Seite laeuft", nicht "der Teil, den wir
# angeschaut haben, laeuft". Health allein sagt nur "Container laeuft".
#
# Secrets (TOKEN_SECRET, POSTGRES_PASSWORD, SMTP_*) leben nur auf dem Server
# und werden hier nie angefasst. PORT und SITE_URL dagegen gehoeren zum
# Deployment, stehen in .deploy.env und werden bei jedem Lauf auf den Server
# geschrieben — .deploy.env ist dafuer die Wahrheit, nicht der Serverzustand.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Fortschrittsbalken ───
# Ein Deploy dauert je nach Aenderung zwischen zwanzig Sekunden und ein paar
# Minuten, und der Docker-Build schweigt dazwischen lange. Ohne Anzeige weiss
# niemand, ob es haengt oder arbeitet. Die Schritte sind fest gezaehlt, weil sie
# immer dieselben sind — kein Schaetzen, keine Fortschritts-Luege.
SCHRITTE_GESAMT=9
SCHRITT=0
BALKEN_BREITE=28

# Farbe nur im Terminal; in einer Logdatei stoeren Steuerzeichen.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B_GRUEN=$'\033[32m'; B_GRAU=$'\033[90m'; B_FETT=$'\033[1m'; B_AUS=$'\033[0m'
else
  B_GRUEN=""; B_GRAU=""; B_FETT=""; B_AUS=""
fi

schritt() {
  SCHRITT=$((SCHRITT + 1))
  local text="$1"
  local voll=$((SCHRITT * BALKEN_BREITE / SCHRITTE_GESAMT))
  local leer=$((BALKEN_BREITE - voll))
  local prozent=$((SCHRITT * 100 / SCHRITTE_GESAMT))
  printf '\n%s[%s%s%s%s] %3d%%%s  %s%s/%s%s %s\n' \
    "$B_GRUEN" "$(printf '█%.0s' $(seq 1 $voll 2>/dev/null))" "$B_GRAU" \
    "$(printf '·%.0s' $(seq 1 $leer 2>/dev/null))" "$B_GRUEN" "$prozent" "$B_AUS" \
    "$B_GRAU" "$SCHRITT" "$SCHRITTE_GESAMT" "$B_AUS" "$B_FETT$text$B_AUS"
}

if [ ! -f "$DIR/.deploy.env" ]; then
  echo "Fehler: .deploy.env nicht gefunden. Kopiere .deploy.env.example und passe die Werte an."
  exit 1
fi
# shellcheck disable=SC1091
. "$DIR/.deploy.env"

: "${SERVER:?SERVER nicht gesetzt (.deploy.env)}"
: "${REMOTE_DIR:?REMOTE_DIR nicht gesetzt (.deploy.env)}"

# Anhaengen an eine Datei, die nicht mit einem Zeilenumbruch endet, klebt den
# neuen Eintrag an den letzten — aus SELFTEST_PASSWORD="…" wurde so
# SELFTEST_PASSWORD="…"SELFTEST_TOKEN="…" und die Anmeldung schlug fehl.
# Deshalb vor jedem Anhaengen sicherstellen, dass die Datei sauber endet.
zeilenende_sichern() {
  [ -s "$1" ] || return 0
  [ "$(tail -c 1 "$1" | od -An -c | tr -d ' \n')" = "\\n" ] || printf '\n' >> "$1"
}

# ─── Argumente: --port N, Rest sind zu bauende Services ───
CLI_PORT=""
SELFTEST=1        # Selbsttest nach dem Deploy (./selftest.sh)
SELFTEST_VOLL=1   # und zwar vollstaendig: Systemtest + Browser
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --kein-selftest)
      SELFTEST=0; shift
      ;;
    --browser)
      shift            # Altbestand: der Browser-Rundgang laeuft ohnehin
      ;;
    --schnelltest)
      SELFTEST_VOLL=0; shift
      ;;
    --port|-p)
      CLI_PORT="${2:-}"
      [ -z "$CLI_PORT" ] && { echo "Fehler: --port braucht eine Nummer, z.B. --port 8090"; exit 1; }
      shift 2
      ;;
    --port=*)
      CLI_PORT="${1#*=}"; shift
      ;;
    -h|--help)
      sed -n '2,23p' "$0" | sed 's|^# \{0,1\}||'
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
    zeilenende_sichern "$DIR/.deploy.env"
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

schritt "Server erreichbar machen (rsync)"
ssh "$SERVER" "command -v rsync >/dev/null 2>&1 || { echo 'installiere rsync...'; (apt-get update -qq && apt-get install -y -qq rsync) || apk add --no-cache rsync; }"

# (Zielverzeichnis gehoert zum selben Schritt)
ssh "$SERVER" "mkdir -p '$REMOTE_DIR'"

# --inplace: NAS-sicher (kein Rename über bestehende Datei).
# -c: nur bei echtem Inhaltsunterschied übertragen.
# --delete: entfernt auf dem Server, was hier weg ist — hält den Stand sauber.
# Ausgeschlossen: alles was Secrets, Laufzeitdaten oder Ballast ist. Die .env
# und die Daten des Servers gehören dem Server, nicht diesem Rechner.
schritt "Geänderte Dateien hochladen"
rsync -rlz -c --inplace --delete \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.bak-*' \
  --exclude='.env-eingerichtet' \
  --exclude='.deploy.env' \
  --exclude='node_modules/' \
  --exclude='venv/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='dist/' \
  --exclude='/data/' \
  --exclude='apps/*/data/' \
  --exclude='backups/' \
  --exclude='uploads/' \
  --exclude='*.db' \
  --exclude='.DS_Store' \
  --exclude='.claude/' \
  --exclude='.nfs*' \
  "$DIR/" "$SERVER:$REMOTE_DIR/"

schritt "Pflicht-Secrets prüfen"
# Nicht nur "gibt es eine .env?", sondern "stehen Werte drin?": eine .env mit
# leerem TOKEN_SECRET laesst compose genauso scheitern wie gar keine (${VAR:?}
# greift auch bei leer). Jeder fehlende Pflichtwert wird hier nachgezogen,
# vorhandene Werte bleiben unangetastet.
#
# Die Werte entstehen lokal und gehen per stdin rueber, nicht als Argument:
# so tauchen sie weder in der Prozessliste des Servers noch in einer History auf.
GEN_TOKEN=$(openssl rand -hex 32)
GEN_PGPW=$(openssl rand -hex 24)

# Das Selbsttest-Token muss auf BEIDEN Seiten gleich sein: hier in .deploy.env
# (damit der Test es mitschickt) und in der .env auf dem Server (damit die API
# es kennt). Fehlt es, wird es einmalig erzeugt und hier gemerkt — ohne es
# blieben Schema, Konfiguration und E-Mail-Versand nach jedem Deploy ungeprueft,
# weil der Selbsttest absichtlich nicht mit dem Administrationskonto laeuft.
if [ -z "${SELFTEST_TOKEN:-}" ]; then
  SELFTEST_TOKEN=$(openssl rand -hex 24)
  if grep -q '^SELFTEST_TOKEN=' "$DIR/.deploy.env"; then
    awk -v v="$SELFTEST_TOKEN" 'index($0,"SELFTEST_TOKEN=")==1 { print "SELFTEST_TOKEN=\"" v "\""; next } { print }' \
      "$DIR/.deploy.env" > "$DIR/.deploy.env.tmp" && mv "$DIR/.deploy.env.tmp" "$DIR/.deploy.env"
  else
    zeilenende_sichern "$DIR/.deploy.env"
    printf 'SELFTEST_TOKEN="%s"\n' "$SELFTEST_TOKEN" >> "$DIR/.deploy.env"
  fi
  echo "  Selbsttest-Token erzeugt und in .deploy.env gemerkt."
fi

set +e
BOOTSTRAP=$(ssh "$SERVER" sh -s <<REMOTE
cd '$REMOTE_DIR' || exit 1
t='$GEN_TOKEN'
p='$GEN_PGPW'
port='$PORT'
site='$SITE_URL'
selftest='$SELFTEST_TOKEN'
$(cat "$DIR/scripts/ensure-env.sh")
REMOTE
)
BOOT_RC=$?
set -e
# Exitcode 3: die .env fehlt, obwohl die Installation schon eingerichtet war.
# Weiterbauen wuerde mit frischen Zufallswerten starten — also hier stoppen.
if [ "$BOOT_RC" = "3" ]; then
  echo ""
  echo "$BOOTSTRAP"
  echo ""
  echo "  Deploy abgebrochen. Nichts wurde gebaut oder neu gestartet."
  exit 3
fi

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

# Mailversand und Kontaktadresse sind kein Pflichtwert (der Stack laeuft ohne),
# aber ihr Fehlen faellt im Betrieb erst auf, wenn eine Registrierung haengt
# oder eine Kontaktanfrage ins Leere geht. Darum hier laut sagen.
MAIL_WARN=$(ssh "$SERVER" "cd '$REMOTE_DIR' 2>/dev/null || exit 0
  host=\$(sed -n 's|^SMTP_HOST=\([^#]*\).*|\1|p' .env | tr -d ' \t' | head -1)
  from=\$(sed -n 's|^SMTP_FROM=\([^#]*\).*|\1|p' .env | tr -d ' \t' | head -1)
  mail=\$(sed -n 's|^ADMIN_EMAIL=\([^#]*\).*|\1|p' .env | tr -d ' \t' | head -1)
  [ -z \"\$host\" ] && echo 'SMTP_HOST fehlt'
  [ -z \"\$from\" ] && echo 'SMTP_FROM fehlt'
  case \"\$mail\" in
    ''|*example.com|admin) echo 'ADMIN_EMAIL ist keine echte Adresse' ;;
  esac
")
if [ -n "$MAIL_WARN" ]; then
  echo ""
  echo "  ⚠ Mailversand unvollständig:"
  printf '      %s\n' $MAIL_WARN
  echo "      Ohne diese Werte gehen Bestätigungs-, Reset- und Kontaktmails nicht raus."
  echo "      ssh $SERVER"
  echo "      cd $REMOTE_DIR && nano .env   # danach: ./deploy.sh api"
  echo ""
fi

# Eine einzige umgebrochene Zeile (nano ohne -w) macht die .env fuer docker
# compose unlesbar — und dann scheitert jeder compose-Aufruf mit einer Meldung,
# die nach etwas ganz anderem aussieht (z.B. "Port belegt", weil der eigene
# Container nicht mehr erkannt wird). Darum hier zuerst pruefen.
schritt ".env-Syntax prüfen"
ENV_BAD=$(ssh "$SERVER" "cd '$REMOTE_DIR' 2>/dev/null || exit 0
  awk '!/^[A-Z_]+=/ && !/^#/ && NF { print \"    Zeile \" NR \": kein SCHLUESSEL= am Anfang (umgebrochener Wert?)\" }' .env
")
if [ -n "$ENV_BAD" ]; then
  echo ""
  echo "  ⚠ Die .env auf dem Server ist beschädigt:"
  echo "$ENV_BAD"
  echo ""
  echo "    Das passiert, wenn ein langer Wert beim Bearbeiten umgebrochen wurde."
  echo "    Reparieren (klebt Fortsetzungszeilen zurück, sichert vorher):"
  echo "      ssh $SERVER"
  echo "      cd $REMOTE_DIR && cp -p .env .env.bak-manuell && \\"
  echo "        awk '/^[A-Z_]+=/ || /^#/ || /^\$/ { if (NR>1) print p; p=\$0; next } { p = p \$0 } END { print p }' .env > .env.fix && mv .env.fix .env && chmod 600 .env"
  echo ""
  echo "    Beim Bearbeiten 'nano -w .env' nehmen — ohne -w bricht nano wieder um."
  echo "  Deploy abgebrochen."
  exit 4
fi

# Der Port-Konflikt zeigt sich sonst erst, wenn alle Images gebaut sind und
# der Proxy als letzter Container startet — also nach mehreren Minuten.
schritt "Port prüfen"
WANT_PORT="$PORT"
PORT_USER=$(ssh "$SERVER" "
  # Nuvoras eigener Proxy darf den Port halten — der wird beim Deploy ersetzt.
  own=\$(cd '$REMOTE_DIR' && docker compose ps -q proxy 2>/dev/null | head -1 | cut -c1-12)
  holder=\$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null | grep ':$WANT_PORT->' | head -1)

  if [ -n \"\$holder\" ]; then
    # Haelt ein Container den Port: nur melden, wenn es NICHT unser Proxy ist.
    id=\$(echo \"\$holder\" | cut -d' ' -f1)
    if [ -n \"\$own\" ] && [ \"\$id\" = \"\$own\" ]; then exit 0; fi
    echo \"docker: \$holder\"
    exit 0
  fi

  # Kein Container: dann kann nur noch ein Nicht-Docker-Prozess drauf sitzen.
  # (Sitzt ein Container drauf, taucht dessen docker-proxy hier ebenfalls auf —
  # deshalb wird ss nur geprueft, wenn oben nichts gefunden wurde.)
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

# Postgres initialisiert sein Volume nur EINMAL. Wer POSTGRES_PASSWORD spaeter
# aendert, aendert damit nicht die Rolle in der bestehenden DB — die api
# scheitert dann an "password authentication failed", was wie ein Codefehler
# aussieht, aber Datenstand ist. Hier frueh und eindeutig melden.
schritt "Datenbank-Zugang prüfen"
DB_CHECK=$(ssh "$SERVER" "
  cd '$REMOTE_DIR' || exit 0
  # Laeuft die DB ueberhaupt schon? Beim allerersten Deploy gibt es nichts zu pruefen.
  docker compose ps -q db 2>/dev/null | grep -q . || exit 0
  user=\$(grep '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '\"' | tr -d ' ')
  pass=\$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d '\"' | tr -d ' ')
  db=\$(grep '^POSTGRES_DB=' .env | cut -d= -f2- | tr -d '\"' | tr -d ' ')
  [ -z \"\$user\" ] && user=nuvora
  [ -z \"\$db\" ] && db=nuvora
  out=\$(docker compose exec -T -e PGPASSWORD=\"\$pass\" db psql -U \"\$user\" -d \"\$db\" -c 'SELECT 1' 2>&1) || echo \"\$out\"
")

if printf '%s' "$DB_CHECK" | grep -qi 'password authentication failed\|role .* does not exist\|database .* does not exist'; then
  echo ""
  echo "  ⚠ Die Datenbank akzeptiert die Zugangsdaten aus der .env nicht:"
  echo "      $(printf '%s' "$DB_CHECK" | head -1)"
  echo ""
  echo "    Postgres legt Rolle und Datenbank nur beim ERSTEN Start an. Ein"
  echo "    spaeter geaendertes POSTGRES_PASSWORD erreicht die bestehende DB nicht."
  echo ""
  echo "    Passwort der Rolle nachziehen (Daten bleiben erhalten):"
  echo "      ssh $SERVER"
  echo "      cd $REMOTE_DIR"
  echo "      PW=\$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
  echo "      docker compose exec -T db psql -U postgres -c \"ALTER ROLE <user> WITH PASSWORD '\$PW';\""
  echo ""
  echo "    Oder — LOESCHT ALLE DATEN — das Volume neu aufsetzen:"
  echo "      docker compose down --remove-orphans && docker volume rm nuvora_pgdata"
  echo ""
  exit 1
fi
echo "  ✓ Datenbank-Zugang in Ordnung."

schritt "Container bauen und starten (${BUILD_SERVICES:-alle Dienste})"
# nginx loest die Upstream-Namen (api, web) EINMAL beim Start auf und
# merkt sich die IPs. Werden die Container neu erstellt, bekommen sie neue IPs —
# der unveraenderte Proxy zeigt dann auf tote Adressen und liefert 502, obwohl
# alles laeuft. Deshalb am Ende immer neu starten: das kostet einen Wimpernschlag
# und erspart die Suche nach einem Fehler, der keiner ist.
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose build $BUILD_SERVICES && docker compose up -d --remove-orphans && docker compose restart proxy"

schritt "Status und Logs"
sleep 6
# shellcheck disable=SC2029
ssh "$SERVER" "cd '$REMOTE_DIR' && docker compose ps; echo '--- api log (letzte 30) ---'; docker compose logs --tail=30 api"

PORT="${PORT:-8080}"
schritt "Health-Checks (Port $PORT)"
CV=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/api/health" || echo "000")
# Lernpfad ist ins Web eingebaut: seine Statik kommt vom web-Container (/lp/).
LP=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/lp/index.html" || echo "000")
echo "  /api/health  -> $CV   (Nuvora-Kern)"
echo "  /lp/         -> $LP   (Lernpfad-Statik im web)"

echo ""
echo "========================================"
if [ "$CV" = "200" ] && [ "$LP" = "200" ]; then
  echo "  Nuvora deployed — beide Module gesund."
  echo "  ${SITE_URL:-http://localhost:$PORT}"
  echo "========================================"
  # Health sagt nur "Container laeuft". Der Selbsttest sagt, ob jedes Modul,
  # die Einrichtung und die Seiten wirklich funktionieren.
  if [ "$SELFTEST" = "1" ]; then
    echo ""
    echo "→ Selbsttest..."
    SELFTEST_ARGS=()
    [ "$SELFTEST_VOLL" = "0" ] && SELFTEST_ARGS+=(--schnell)
    # Kein eigener Schlusssatz: die Zusammenfassung des Selbsttests sagt bereits
    # alles. Der Rueckgabewert traegt das Ergebnis nach aussen.
    "$DIR/selftest.sh" "${SELFTEST_ARGS[@]+"${SELFTEST_ARGS[@]}"}" || exit 1
  fi
else
  [ "$CV" != "200" ] && echo "  ⚠ Nuvora-Kern nicht gesund (health=$CV)"
  [ "$LP" != "200" ] && echo "  ⚠ Modul Lernpfad nicht gesund (status=$LP)"
  echo "  Logs oben prüfen."
  echo "========================================"
  exit 1
fi
