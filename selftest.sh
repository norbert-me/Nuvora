#!/bin/bash
# Nuvora — Selbsttest der laufenden Installation.
#
# Laeuft am Ende von ./deploy.sh automatisch und lässt sich jederzeit von Hand
# aufrufen. Vier Teile, und alle vier laufen standardmaessig:
#
#   scripts/selftest.py          API und Einrichtung, echter Schreib-Roundtrip
#                                je Modul (legt Testdaten an und raeumt sie ab)
#   scripts/systemtest.py        Jedes Modul EINZELN: nur dieses aktiv, alle
#                                anderen muessen 403 liefern. Inhalte schreiben
#                                und wiederfinden, CardVote und Noten
#                                nachgerechnet, jede Modul-Bruecke beidseitig
#   scripts/selftest-browser.mjs Rundgang im echten Browser: Seiten, Konsole,
#                                Verlinkungen — Desktop, Handy, dunkel
#   scripts/systemtest-browser.mjs Jedes Modul einzeln in der Oberflaeche:
#                                rendert es, zeigt die Navigation nur dieses
#                                Modul, bleiben verbotene Verbindungen
#                                unsichtbar und erlaubte sichtbar
#
# Am Ende steht, welche Teile gelaufen sind. Was uebersprungen wurde, steht
# ebenfalls da — ein gruener Lauf ohne vollen Umfang ist keine Aussage ueber
# die Seite, und das soll man sehen, statt es zu ahnen.
#
# Zugang kommt aus .deploy.env:
#   SELFTEST_EMAIL / SELFTEST_PASSWORD  Konto, mit dem geprueft wird
#   SELFTEST_URL                        Adresse (sonst SITE_URL)
# Ohne Zugangsdaten laufen nur die Checks ohne Login.
#
# Nutzung: ./selftest.sh                 ALLES: API, Systemtest, Browser
#          ./selftest.sh --schnell      nur der API-Selbsttest (bewusst weniger)
#          ./selftest.sh --ohne-browser API + Systemtest, ohne Playwright
#          ./selftest.sh --nur-system   ohne Login, ohne Schreiben
#          ./selftest.sh --url https://… gegen eine andere Instanz
#          ./selftest.sh --browser=webkit  Engine der iPads (auch: chromium|beide)
#
# Vollstaendig ist die Voreinstellung, und das ist Absicht: ein gruener Deploy
# muss heissen "die Seite laeuft", nicht "der Teil, den wir angeschaut haben,
# laeuft". Wer weniger prueft, sagt es mit --schnell — und bekommt am Ende
# schwarz auf weiss aufgezaehlt, was ungeprueft blieb.
#
# Der Systemtest schaltet Module um und schreibt viel; er stellt den
# Modul-Zustand des Kontos danach wieder her.

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# .deploy.env liefert die Vorgaben — aber was ausdruecklich in der Umgebung
# steht, gewinnt. Vorher ueberschrieb die Datei jede mitgegebene Variable, und
# ein Lauf gegen eine andere Instanz benutzte stillschweigend das Konto der
# Produktivinstanz. Genau falsch herum: eine ausdrueckliche Angabe ist die
# spezifischere.
_VOR_URL="${SELFTEST_URL:-}"
_VOR_MAIL="${SELFTEST_EMAIL:-}"
_VOR_PW="${SELFTEST_PASSWORD:-}"
_VOR_TOKEN="${SELFTEST_TOKEN:-}"

if [ -f "$DIR/.deploy.env" ]; then
  # shellcheck disable=SC1091
  . "$DIR/.deploy.env"
fi

[ -n "$_VOR_URL" ]   && SELFTEST_URL="$_VOR_URL"
[ -n "$_VOR_MAIL" ]  && SELFTEST_EMAIL="$_VOR_MAIL"
[ -n "$_VOR_PW" ]    && SELFTEST_PASSWORD="$_VOR_PW"
[ -n "$_VOR_TOKEN" ] && SELFTEST_TOKEN="$_VOR_TOKEN"
true   # die Kette oben darf den Rueckgabewert nicht auf 1 setzen

# Adresse: --url schlaegt alles, sonst SELFTEST_URL, sonst SITE_URL, sonst der
# lokale Port. Der Test laeuft von diesem Rechner aus gegen die oeffentliche
# Adresse — genau der Weg, den auch eine Lehrkraft nimmt.
URL="${SELFTEST_URL:-${SITE_URL:-http://localhost:${PORT:-8080}}}"

# Voreinstellung: alles. Abschalten geht nur ausdruecklich.
MIT_BROWSER=1
MIT_SYSTEM=1
ARGS=()
# --url gleich hier mitnehmen. Ein nachtraeglicher Durchlauf durch ARGS ist in
# der macOS-Bash (3.2) mit set -u nicht sicher: bei leerem Array liefert die
# Index-Expansion ein leeres Element und ARGS[""] bricht mit "unbound variable".
while [ $# -gt 0 ]; do
  case "$1" in
    --browser) MIT_BROWSER=1; shift ;;          # Altbestand: schon Vorgabe
    # Engine waehlen (chromium|webkit|beide). Geht per Umgebung an beide
    # Browser-Laeufe; ohne das landete --browser=webkit im Argumentbeutel der
    # Python-Skripte, die damit nichts anfangen koennen.
    --browser=*) MIT_BROWSER=1; export SELFTEST_BROWSERS="${1#*=}"; shift ;;
    --system) MIT_SYSTEM=1; shift ;;            # Altbestand: schon Vorgabe
    --schnell) MIT_BROWSER=0; MIT_SYSTEM=0; shift ;;
    --ohne-browser) MIT_BROWSER=0; shift ;;
    --ohne-system) MIT_SYSTEM=0; shift ;;
    --url) URL="${2:-}"; [ -z "$URL" ] && { echo "Fehler: --url braucht eine Adresse."; exit 1; }
           ARGS[${#ARGS[@]}]="--url"; ARGS[${#ARGS[@]}]="$URL"; shift 2 ;;
    --url=*) URL="${1#*=}"; ARGS[${#ARGS[@]}]="--url"; ARGS[${#ARGS[@]}]="$URL"; shift ;;
    -h|--help) sed -n '2,34p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) ARGS[${#ARGS[@]}]="$1"; shift ;;
  esac
done

export SELFTEST_URL="$URL"
export SELFTEST_EMAIL="${SELFTEST_EMAIL:-}"
export SELFTEST_PASSWORD="${SELFTEST_PASSWORD:-}"
# Ohne das Token bleiben Schema, Konfiguration und E-Mail ungeprueft
# (siehe .deploy.env). ./deploy.sh erzeugt es beim ersten Lauf selbst.
export SELFTEST_TOKEN="${SELFTEST_TOKEN:-}"

if [ -z "$SELFTEST_EMAIL" ] || [ -z "$SELFTEST_PASSWORD" ]; then
  echo "Hinweis: SELFTEST_EMAIL/SELFTEST_PASSWORD fehlen in .deploy.env —"
  echo "         Module und Einrichtung bleiben ungeprueft."
  echo ""
  echo "         Das Testkonto muss einmalig von Hand angelegt werden:"
  echo "         unter $URL/login registrieren, E-Mail bestaetigen,"
  echo "         dann beide Werte in .deploy.env eintragen. (Der Selbsttest"
  echo "         legt es nicht selbst an — die Bestaetigung kann kein Skript"
  echo "         ersetzen.)"
  echo ""
fi

STATUS=0
# Was lief, was nicht — wird am Ende aufgezaehlt. Ein uebersprungener Teil ist
# kein Schweigen wert: sonst liest sich "gruen" wie "alles geprueft".
BERICHT=()
def_ok() { BERICHT[${#BERICHT[@]}]="  ✓ $1"; }
def_aus() { BERICHT[${#BERICHT[@]}]="  ○ $1 — UNGEPRUEFT: $2"; }
def_rot() { BERICHT[${#BERICHT[@]}]="  ✗ $1"; }

python3 "$DIR/scripts/selftest.py" "${ARGS[@]+"${ARGS[@]}"}" && def_ok "API, Einrichtung, Seiten, Modul-Roundtrips" || { STATUS=1; def_rot "API, Einrichtung, Seiten, Modul-Roundtrips"; }

if [ "$MIT_SYSTEM" = "1" ]; then
  echo ""
  if [ -z "$SELFTEST_EMAIL" ] || [ -z "$SELFTEST_PASSWORD" ]; then
    echo "⚠ Systemtest uebersprungen — er schreibt Daten und braucht ein Konto"
    echo "  (SELFTEST_EMAIL/SELFTEST_PASSWORD in .deploy.env)."
    STATUS=1
    def_aus "Systemtest (jedes Modul einzeln)" "kein Testkonto in .deploy.env"
  else
    echo "→ Systemtest: jedes Modul einzeln..."
    # Adresse und Zugang kommen aus der Umgebung (SELFTEST_*), darum ohne ARGS:
    # der Systemtest kennt die Schalter des Selbsttests nicht.
    python3 "$DIR/scripts/systemtest.py" && def_ok "Systemtest: jedes Modul einzeln, Regel 3, CardVote und Noten nachgerechnet" \
      || { STATUS=1; def_rot "Systemtest: jedes Modul einzeln"; }
  fi
else
  def_aus "Systemtest (jedes Modul einzeln, Regel 3, Noten nachgerechnet)" "mit --schnell/--ohne-system abgeschaltet"
fi

if [ "$MIT_BROWSER" = "1" ]; then
  echo ""
  echo "→ Browser-Rundgang (Playwright)..."
  BROWSER_BEREIT=1
  if [ ! -d "$DIR/scripts/node_modules/playwright" ]; then
    echo "  Playwright fehlt — wird einmalig nach scripts/node_modules installiert."
    (cd "$DIR/scripts" && npm install --silent && npx --yes playwright install chromium) || {
      echo "  ⚠ Installation fehlgeschlagen."
      BROWSER_BEREIT=0
      STATUS=1
      def_aus "Browser-Rundgang" "Playwright liess sich nicht installieren"
      def_aus "Modul-Oberflaechen einzeln" "Playwright liess sich nicht installieren"
    }
  fi
  if [ "$BROWSER_BEREIT" = "1" ]; then
    (cd "$DIR/scripts" && node selftest-browser.mjs --url "$URL" \
       --email "$SELFTEST_EMAIL" --passwort "$SELFTEST_PASSWORD") \
      && def_ok "Browser-Rundgang: Seiten, Konsole, Verlinkungen, Handy, dunkel" \
      || { STATUS=1; def_rot "Browser-Rundgang"; }
    if [ -f "$DIR/scripts/systemtest-browser.mjs" ] && [ -n "$SELFTEST_EMAIL" ]; then
      echo ""
      echo "→ Modul-Oberflaechen einzeln (Playwright)..."
      (cd "$DIR/scripts" && node systemtest-browser.mjs --url "$URL" \
         --email "$SELFTEST_EMAIL" --passwort "$SELFTEST_PASSWORD") \
        && def_ok "Modul-Oberflaechen: je Modul allein, verbotene Verbindungen unsichtbar" \
        || { STATUS=1; def_rot "Modul-Oberflaechen einzeln"; }
    else
      def_aus "Modul-Oberflaechen einzeln" "kein Testkonto in .deploy.env"
      STATUS=1
    fi
  fi
else
  def_aus "Browser-Rundgang" "mit --schnell/--ohne-browser abgeschaltet"
  def_aus "Modul-Oberflaechen einzeln" "mit --schnell/--ohne-browser abgeschaltet"
fi

echo ""
echo "════════════════════════════════════════"
echo "  Umfang dieses Laufs"
for zeile in "${BERICHT[@]+"${BERICHT[@]}"}"; do echo "$zeile"; done
if printf '%s\n' "${BERICHT[@]+"${BERICHT[@]}"}" | grep -q "UNGEPRUEFT"; then
  echo ""
  echo "  Achtung: nicht alles wurde geprueft. Ein gruener Lauf sagt hier"
  echo "  ausdruecklich NICHT, dass die Seite in Ordnung ist."
fi
echo "════════════════════════════════════════"

exit "$STATUS"
