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
#
# SCHRITTE_GESAMT wird nach dem Auswerten der Argumente endgueltig gesetzt: mit
# Selbsttest ist eine Etappe mehr zu gehen als ohne. Der Vorbelegungswert hier
# gilt nur, falls vor dem Parsen schon etwas gemeldet werden muesste.
SCHRITTE_GESAMT=10
SCHRITT=0
BALKEN_BREITE=28

# Farbe nur im Terminal; in einer Logdatei stoeren Steuerzeichen.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B_GRUEN=$'\033[32m'; B_GRAU=$'\033[90m'; B_FETT=$'\033[1m'; B_AUS=$'\033[0m'
else
  B_GRUEN=""; B_GRAU=""; B_FETT=""; B_AUS=""
fi

# Ein Zeichen n-mal. Frueher stand hier "printf '█%.0s' $(seq 1 $n)" — und das
# war der Grund fuer den zerbrochenen Balken: BSD-seq auf macOS zaehlt bei
# "seq 1 0" RUECKWAERTS und gibt "1 0" aus, also zwei Werte statt keinem. Bei
# leer=0 (letzter Schritt) druckte printf deshalb zwei Punkte zu viel, und die
# Zeile war zwei Zeichen breiter als alle anderen. Eine Schleife kennt diese
# Falle nicht und liefert bei 0 auch wirklich nichts.
wiederhole() {
  local zeichen="$1" anzahl="$2" i=0 s=""
  while [ "$i" -lt "$anzahl" ]; do s="$s$zeichen"; i=$((i + 1)); done
  printf '%s' "$s"
}

# ─── Der Balken klebt unten ───
# Frueher wurde je Etappe eine Balkenzeile in den Ausgabestrom gedruckt. Die
# scrollte sofort weg, und waehrend "docker compose build" minutenlang redete,
# war weit und breit kein Balken zu sehen. Jetzt gibt es EINEN Balken fuer den
# GESAMTEN Deploy, der in der untersten Zeile stehen bleibt; die normale
# Ausgabe laeuft darueber weiter.
#
# Technik: DECSTBM. Der Scroll-Bereich des Terminals wird auf 1..H-1 verkleinert,
# die unterste Zeile gehoert damit allein dem Balken. Geschrieben wird per
# Cursor sichern -> in Zeile H springen -> Zeile loeschen -> zurueck.
#
# Der Cursor wird bewusst NICHT versteckt: ssh darf nach einer Passphrase
# fragen, und ein unsichtbarer Cursor an einer Passwortabfrage ist eine Zumutung.
BALKEN_AKTIV=0          # 1, sobald die unterste Zeile reserviert ist
BALKEN_STATUS=""        # Datei, ueber die der Ticker den Stand liest
BALKEN_TICKER=""        # PID der Uhr, die jede Sekunde neu zeichnet
BALKEN_HOEHE=0          # zuletzt gesehene Terminalhoehe (fuer SIGWINCH)
ETAPPE_TEXT=""          # Beschriftung der laufenden Etappe
ETAPPE_START=$(date +%s)
ZEITEN_DATEI="$DIR/.deploy-zeiten.json"   # Erfahrungswerte je Etappe (gitignored)
ZEITEN_SCHNITT=""       # Mittelwert je Etappe aus frueheren Laeufen, leer = keiner
ZEITEN_LISTE=""         # gemessene Dauer der bisherigen Etappen dieses Laufs

# Fenstergroesse. Zwei Fallen, beide beim Testen aufgelaufen:
#   1. "tput lines" antwortet aus LINES, wenn die Variable gesetzt ist — nach
#      dem Aufziehen des Fensters also mit dem ALTEN Wert.
#   2. Diese Funktionen laufen immer in $(...), dort ist stdout eine Pipe. tput
#      hat dann gar kein Terminal mehr zum Messen und liefert die terminfo-
#      Vorgabe 24 — unabhaengig davon, wie gross das Fenster wirklich ist.
# Deshalb sichert balken_start das echte Terminal auf Dateideskriptor 9 und
# hier wird "stty size" darauf befragt; das ist immer ein frischer ioctl.
# (2>/dev/null steht VOR <&9, damit auch die Meldung eines fehlenden fd 9
# verschwindet — vor balken_start gibt es ihn noch nicht.)
terminal_hoehe() {
  local m
  m=$(stty size 2>/dev/null <&9 | awk '{print $1}')
  if [ -n "$m" ] && [ "$m" -gt 0 ] 2>/dev/null; then printf '%s' "$m"; return 0; fi
  tput lines 2>/dev/null || echo 24
}
terminal_breite() {
  local m
  m=$(stty size 2>/dev/null <&9 | awk '{print $2}')
  if [ -n "$m" ] && [ "$m" -gt 0 ] 2>/dev/null; then printf '%s' "$m"; return 0; fi
  tput cols 2>/dev/null || echo 80
}

# Dauer als m:ss. Eine mitlaufende Uhr ist ehrlich — sie sagt "es arbeitet
# seit 2:14", ohne einen Fortschritt zu behaupten, den niemand kennt. Ein
# innerhalb der Etappe wandernder Balken waere eine Luege und bleibt aussen vor.
dauer_kurz() {
  local s="$1"
  [ "$s" -lt 0 ] && s=0
  printf '%d:%02d' $((s / 60)) $((s % 60))
}

# Den Stand fuer den Ticker hinterlegen (Datei, weil der Ticker ein eigener
# Prozess ist und Variablen der Elternshell nicht mitbekommt). Erst schreiben,
# dann umbenennen — so liest der Ticker nie eine halbe Zeile.
balken_status_schreiben() {
  [ -n "$BALKEN_STATUS" ] || return 0
  printf '%s\t%s\t%s\t%s\n' "$SCHRITT" "$SCHRITTE_GESAMT" "$ETAPPE_START" "$ETAPPE_TEXT" \
    > "$BALKEN_STATUS.neu" 2>/dev/null || return 0
  mv -f "$BALKEN_STATUS.neu" "$BALKEN_STATUS" 2>/dev/null || return 0
}

# Rechte Zeitangabe. MIT Erfahrungswerten die geschaetzte Restdauer, klar als
# Schaetzung gekennzeichnet ("noch ca."); OHNE sie nur die verstrichene Zeit.
# Beim allerersten Lauf gibt es nichts zu schaetzen — dann wird auch nichts
# behauptet. Und wenn die laufende Etappe ihre Erfahrungszeit deutlich reisst,
# faellt die Schaetzung weg statt auf 0:00 stehenzubleiben: eine Restdauer, die
# nicht kleiner wird, ist schlimmer als gar keine.
rest_text() {
  local n="$1" g="$2" verstrichen="$3"
  if [ -z "$ZEITEN_SCHNITT" ]; then dauer_kurz "$verstrichen"; return 0; fi
  local i=0 summe=0 erwartet=0 w
  for w in $ZEITEN_SCHNITT; do
    i=$((i + 1))
    if [ "$i" -lt "$n" ]; then continue
    elif [ "$i" = "$n" ]; then erwartet="$w"
    else summe=$((summe + w)); fi
  done
  if [ "$erwartet" -gt 0 ] && [ "$verstrichen" -gt $((erwartet * 2)) ]; then
    dauer_kurz "$verstrichen"; return 0
  fi
  local offen=$((erwartet - verstrichen))
  [ "$offen" -lt 0 ] && offen=0
  summe=$((summe + offen))
  [ "$summe" -le 0 ] && { dauer_kurz "$verstrichen"; return 0; }
  printf 'noch ca. %s' "$(dauer_kurz "$summe")"
}

# Baut die Balkenzeile aus dem hinterlegten Stand.
#
# Die Zeile darf NIE breiter werden als das Terminal. Genau daran ist die erste
# Fassung gescheitert: sie rechnete blind mit 80 Spalten (tput antwortet in
# $(...) mit der terminfo-Vorgabe, weil es dort kein Terminal sieht). Auf einem
# schmaleren Fenster brach die Zeile um, und weil die unterste Zeile ausserhalb
# des Scroll-Bereichs liegt, landete der umgebrochene Rest wieder am Anfang
# DERSELBEN Zeile — das sah aus wie ein Balken, der ploetzlich voll ist.
#
# Deshalb wird hier mit einem Budget gerechnet und in dieser Reihenfolge
# geopfert, wenn es eng wird: zuerst der Etappentext (gekuerzt), dann die
# Schrittnummer, dann die Restdauer, zuletzt schrumpft der Balken selbst.
balken_zeile() {
  local n g start text
  IFS=$'\t' read -r n g start text < "$BALKEN_STATUS" 2>/dev/null || return 1
  [ -n "${g:-}" ] && [ "$g" -gt 0 ] 2>/dev/null || return 1

  local verstrichen rest
  verstrichen=$(($(date +%s) - start))
  rest=$(rest_text "$n" "$g" "$verstrichen")

  # Budget: eine Spalte bleibt frei, damit der Cursor nach dem letzten Zeichen
  # nicht in den Umbruch laeuft.
  local budget breite frei
  budget=$(( $(terminal_breite) - 1 ))
  breite=$BALKEN_BREITE
  # Balken (2 + Breite) und Prozent (5) sind gesetzt; passt das nicht, schrumpft
  # der Balken, und unter vier Zeichen wird gar nichts mehr gezeichnet.
  if [ $((2 + breite + 5)) -gt "$budget" ]; then
    breite=$((budget - 7))
    [ "$breite" -lt 4 ] && return 1
  fi
  frei=$((budget - 2 - breite - 5))

  local zeige_rest=0 zeige_nm=0
  if [ "$frei" -ge $((3 + ${#rest})) ]; then zeige_rest=1; frei=$((frei - 3 - ${#rest})); fi
  if [ "$frei" -ge 7 ]; then zeige_nm=1; frei=$((frei - 7)); fi
  local textplatz=$((frei - 1))
  [ "$textplatz" -lt 0 ] && textplatz=0
  [ "${#text}" -gt "$textplatz" ] && text="${text:0:$textplatz}"

  local voll prozent
  voll=$((n * breite / g))
  prozent=$((n * 100 / g))
  [ "$voll" -lt 0 ] && voll=0
  [ "$voll" -gt "$breite" ] && voll=$breite
  [ "$prozent" -gt 100 ] && prozent=100
  # Solange Etappen ausstehen, bleibt mindestens ein Punkt frei. Ein voller
  # Balken heisst damit "fertig" — und sonst nichts.
  [ "$n" -lt "$g" ] && [ "$voll" -ge "$breite" ] && voll=$((breite - 1))
  local leer=$((breite - voll))

  # Stueckweise zusammensetzen, damit die sichtbare Laenge exakt der Rechnung
  # oben entspricht (Farbcodes zaehlen nicht mit).
  # Klammern um jede Variable: bash 3.2 zieht ein direkt folgendes Multibyte-
  # Zeichen (hier das ·) sonst in den Variablennamen und bricht unter set -u ab.
  local aus
  aus="${B_GRUEN}[$(wiederhole '█' "$voll")${B_GRAU}$(wiederhole '·' "$leer")${B_GRUEN}]"
  aus="${aus}$(printf ' %3d%%' "$prozent")${B_AUS}"
  [ "$zeige_nm" = "1" ] && aus="${aus}${B_GRAU}$(printf '  %2d/%-2d' "$n" "$g")${B_AUS}"
  [ -n "$text" ] && aus="${aus} ${B_FETT}${text}${B_AUS}"
  [ "$zeige_rest" = "1" ] && aus="${aus} ${B_GRAU}·${B_AUS} ${rest}"
  printf '%s' "$aus"
}

# Zeichnet die unterste Zeile neu. Laeuft sowohl im Hauptskript als auch im
# Ticker-Prozess; deshalb wird die Hoehe jedes Mal frisch geholt und der
# Scroll-Bereich nachgezogen, wenn das Fenster inzwischen anders gross ist.
balken_zeichnen() {
  [ "$BALKEN_AKTIV" = "1" ] || return 0
  local h zeile
  h=$(terminal_hoehe)
  if [ "$h" != "$BALKEN_HOEHE" ]; then
    BALKEN_HOEHE="$h"
    printf '\033[s\033[1;%dr\033[u' $((h - 1))
  fi
  zeile=$(balken_zeile) || return 0
  # sichern -> Zeile H -> loeschen -> schreiben -> zurueck
  printf '\033[s\033[%d;1H\033[2K%s\033[u' "$h" "$zeile"
}

# Unterste Zeile reservieren und die Uhr starten.
balken_start() {
  [ -t 1 ] || return 0                       # kein TTY: kein Sticky-Balken
  [ -z "${NO_COLOR:-}" ] || return 0
  command -v tput >/dev/null 2>&1 || return 0
  # Das echte Terminal auf fd 9 sichern — nur darueber ist die Fenstergroesse
  # verlaesslich zu erfragen (siehe terminal_hoehe).
  exec 9>&1
  local h
  h=$(terminal_hoehe)
  [ "$h" -ge 5 ] 2>/dev/null || return 0      # zu kleines Fenster: lieber lassen

  BALKEN_STATUS=$(mktemp -t nuvora-balken 2>/dev/null) || return 0
  BALKEN_HOEHE="$h"
  BALKEN_AKTIV=1
  ETAPPE_TEXT="Deploy startet"
  balken_status_schreiben

  # Platz schaffen (scrollt bei Bedarf um eine Zeile hoch), Cursor eine Zeile
  # zurueck, sichern, Scroll-Bereich verkleinern (DECSTBM setzt den Cursor auf
  # 1;1, deshalb danach wiederherstellen).
  printf '\n\033[1A\033[s\033[1;%dr\033[u' $((h - 1))

  # Die Uhr: einmal pro Sekunde neu zeichnen, damit die Dauer waehrend des
  # langen docker-Abschnitts sichtbar weiterlaeuft.
  # trap - EXIT ist hier entscheidend: die Subshell erbt den EXIT-Trap des
  # Hauptskripts und wuerde beim Beendetwerden das Aufraeumen ein zweites Mal
  # ausloesen — mitten im Lauf, mit fremdem Scroll-Bereich.
  ( trap - EXIT INT TERM WINCH
    while :; do sleep 1; balken_zeichnen || true; done ) &
  BALKEN_TICKER=$!
  disown 2>/dev/null || true
  balken_zeichnen
}

# AUFRAEUMEN IST PFLICHT: ein Skript, das den Scroll-Bereich gesetzt laesst,
# hinterlaesst ein Terminal, in dem nichts mehr richtig scrollt. Deshalb haengt
# das hier an EXIT, INT und TERM und ist mehrfach aufrufbar.
balken_ende() {
  [ "$BALKEN_AKTIV" = "1" ] || { [ -n "$BALKEN_STATUS" ] && rm -f "$BALKEN_STATUS" "$BALKEN_STATUS.neu" 2>/dev/null; return 0; }
  BALKEN_AKTIV=0
  if [ -n "$BALKEN_TICKER" ]; then
    kill "$BALKEN_TICKER" 2>/dev/null || true
    wait "$BALKEN_TICKER" 2>/dev/null || true
    BALKEN_TICKER=""
  fi
  local h
  h=$(terminal_hoehe)
  printf '\033[s\033[%d;1H\033[2K\033[u' "$h"   # Balkenzeile leeren
  printf '\033[r'                                # Scroll-Bereich: ganzer Schirm
  printf '\033[u'                                # Cursor zurueck (DECSTBM homed ihn)
  printf '\033[?25h'                             # Cursor sichtbar, komme was wolle
  [ -n "$BALKEN_STATUS" ] && rm -f "$BALKEN_STATUS" "$BALKEN_STATUS.neu" 2>/dev/null
  return 0
}

# ─── Erfahrungswerte (.deploy-zeiten.json) ───
# Nach jedem erfolgreichen Deploy wird die Dauer JE ETAPPE gemerkt. Der naechste
# Lauf schaetzt daraus die Restdauer. Nur Laeufe mit derselben Etappenzahl
# zaehlen (mit und ohne Selbsttest sind zwei verschiedene Wege), und gemittelt
# wird ueber die letzten fuenf — ein einzelner Ausreisser soll die Anzeige nicht
# verbiegen. Die Datei ist rein oertlich und gehoert in .gitignore.
zeiten_laden() {
  [ -r "$ZEITEN_DATEI" ] || return 0
  ZEITEN_SCHNITT=$(awk -v g="$SCHRITTE_GESAMT" -v max=5 '
    match($0, /"schritte":[0-9]+/) {
      if (substr($0, RSTART + 11, RLENGTH - 11) + 0 != g) next
      if (match($0, /"dauer":\[[0-9, ]*\]/))
        lauf[++c] = substr($0, RSTART + 9, RLENGTH - 10)
    }
    END {
      if (c == 0) exit 0
      von = (c > max ? c - max + 1 : 1)
      for (k = von; k <= c; k++) {
        m = split(lauf[k], a, ",")
        if (m != g) continue          # unvollstaendig: nicht verwerten
        for (j = 1; j <= g; j++) sum[j] += a[j] + 0
        anz++
      }
      if (anz == 0) exit 0
      for (j = 1; j <= g; j++) printf "%d ", int(sum[j] / anz + 0.5)
      print ""
    }' "$ZEITEN_DATEI" 2>/dev/null) || ZEITEN_SCHNITT=""
}

zeiten_merken() {
  # Dauer der letzten Etappe noch nachtragen.
  [ "$SCHRITT" -gt 0 ] && ZEITEN_LISTE="$ZEITEN_LISTE $(($(date +%s) - ETAPPE_START))"
  ZEITEN_LISTE="${ZEITEN_LISTE# }"
  # Nur vollstaendige Laeufe merken — eine halbe Messreihe verdirbt den Schnitt.
  local anzahl
  anzahl=$(printf '%s\n' $ZEITEN_LISTE | grep -c .) || anzahl=0
  [ "$anzahl" = "$SCHRITTE_GESAMT" ] || return 0
  {
    echo '{"laeufe":['
    grep -h '^{"schritte"' "$ZEITEN_DATEI" 2>/dev/null | tail -9 | sed 's/,$//;s/$/,/'
    printf '{"schritte":%s,"dauer":[%s]}\n' "$SCHRITTE_GESAMT" "$(printf '%s' "$ZEITEN_LISTE" | tr ' ' ',')"
    echo ']}'
  } > "$ZEITEN_DATEI.tmp" 2>/dev/null && mv -f "$ZEITEN_DATEI.tmp" "$ZEITEN_DATEI" 2>/dev/null
  return 0
}

balken_abbruch() {
  balken_ende
  echo ""
  echo "  Abgebrochen."
  exit 130
}

trap balken_ende EXIT
trap balken_abbruch INT TERM
# Fenstergroesse geaendert: Scroll-Bereich und Balkenzeile nachziehen. (Waehrend
# eines laufenden ssh greift der Trap erst danach — der Ticker holt die Hoehe
# ohnehin jede Sekunde neu und richtet es innerhalb einer Sekunde selbst.)
trap 'BALKEN_HOEHE=0; balken_zeichnen || true' WINCH

schritt() {
  # Dauer der abgeschlossenen Etappe festhalten (fuer .deploy-zeiten.json).
  [ "$SCHRITT" -gt 0 ] && ZEITEN_LISTE="$ZEITEN_LISTE $(($(date +%s) - ETAPPE_START))"
  SCHRITT=$((SCHRITT + 1))
  ETAPPE_TEXT="$1"
  ETAPPE_START=$(date +%s)
  if [ "$BALKEN_AKTIV" = "1" ]; then
    balken_status_schreiben
    balken_zeichnen
    return 0
  fi
  # Ohne TTY (Logdatei, Pipe, CI): schlichte Zeile, keine einzige Steuersequenz.
  local prozent=$((SCHRITT * 100 / SCHRITTE_GESAMT))
  [ "$prozent" -gt 100 ] && prozent=100
  printf '\n[%2d/%-2d %3d%%] %s\n' "$SCHRITT" "$SCHRITTE_GESAMT" "$prozent" "$ETAPPE_TEXT"
}

# Sicherung: eine Anzeige, die bei 88 % endet oder ueber 100 % laeuft, ist
# schlimmer als keine. Am Ende muss die Zahl der gelaufenen Schritte exakt der
# angekuendigten entsprechen — sonst ist SCHRITTE_GESAMT beim Ergaenzen eines
# Schrittes vergessen worden, und genau das soll auffallen.
schritte_bilanz() {
  [ "$SCHRITT" = "$SCHRITTE_GESAMT" ] && return 0
  echo ""
  echo "  ⚠ Fortschrittsanzeige stimmt nicht: $SCHRITT Schritte gelaufen," \
       "$SCHRITTE_GESAMT angekündigt."
  echo "    SCHRITTE_GESAMT in deploy.sh an die Zahl der schritt-Aufrufe anpassen."
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

# Jetzt erst steht fest, wie viele Etappen es wirklich sind: neun feste
# schritt-Aufrufe bis zum Health-Check, plus der Selbsttest, der danach mehrere
# Minuten laeuft. Der war bisher gar nicht gezaehlt — die Anzeige stand auf
# 100 %, waehrend der laengste Teil des Deploys noch vor sich ging.
SCHRITTE_GESAMT=9
[ "$SELFTEST" = "1" ] && SCHRITTE_GESAMT=10

echo "=== Nuvora Deploy ==="
echo "Server: $SERVER"
echo "Pfad:   $REMOTE_DIR"
echo "Port:   $PORT"
echo "Build:  ${BUILD_SERVICES:-alle Services}"
echo ""

# Ab hier klebt der Balken unten; alles Weitere scrollt darueber durch.
zeiten_laden
balken_start

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
    SELFTEST_ARGS=()
    if [ "$SELFTEST_VOLL" = "0" ]; then
      SELFTEST_ARGS+=(--schnell)
      schritt "Selbsttest (Schnelltest)"
    else
      schritt "Selbsttest (alle Module, dann Browser-Rundgang)"
    fi
    schritte_bilanz
    # Kein eigener Schlusssatz: die Zusammenfassung des Selbsttests sagt bereits
    # alles. Der Rueckgabewert traegt das Ergebnis nach aussen.
    "$DIR/selftest.sh" "${SELFTEST_ARGS[@]+"${SELFTEST_ARGS[@]}"}" || exit 1
    zeiten_merken
  else
    schritte_bilanz
    zeiten_merken
  fi
else
  [ "$CV" != "200" ] && echo "  ⚠ Nuvora-Kern nicht gesund (health=$CV)"
  [ "$LP" != "200" ] && echo "  ⚠ Modul Lernpfad nicht gesund (status=$LP)"
  echo "  Logs oben prüfen."
  echo "========================================"
  exit 1
fi
