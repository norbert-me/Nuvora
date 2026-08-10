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

# ─── Fortschrittsanzeige ───
# Ein Deploy dauert zwischen zwanzig Sekunden und mehreren Minuten, und der
# Docker-Build schweigt dazwischen lange. Ohne Anzeige weiss niemand, ob es
# haengt oder arbeitet.
#
# WARUM KEIN KLEBENDER BALKEN MEHR (DECSTBM). Die vorige Fassung hat die
# unterste Zeile per Scroll-Bereich reserviert und den Cursor per ESC[s/ESC[u
# gesichert. Das ist im echten Deploy schiefgegangen: der Bildschirm blieb leer,
# obwohl rsync und docker compose redeten, und "es flackerte immer was auf".
# Der Grund liegt in der Bauart, nicht in einem Tippfehler:
#
#   * ESC[s/ESC[u ist EIN EINZIGER Speicherplatz pro Terminal. Ihn teilen sich
#     hier die Hauptshell, die Uhr im Hintergrund und JEDES Kind — ssh, rsync,
#     docker compose, selftest.sh, Playwright. Sichert oder bewegt eines davon
#     den Cursor, landet unser ESC[u woanders.
#   * Landet er auf der reservierten Zeile, ist alles verloren: die liegt
#     AUSSERHALB des Scroll-Bereichs, dort bewirkt ein Zeilenvorschub nichts.
#     Jede Ausgabezeile wird an dieselbe Stelle geschrieben und eine Sekunde
#     spaeter von der Uhr weggeputzt — genau das beschriebene Bild.
#
# Mit sauberer Ausgabe liess sich das oertlich nicht nachstellen; es haengt
# daran, was die Kindprozesse senden, und die gehoeren mir nicht (selftest.sh
# darf ich nicht anfassen). Ein Verfahren, dessen Versagen ich nicht einmal
# reproduzieren kann, ist nicht abzusichern — und eine sichtbare Ausgabe ohne
# klebenden Balken ist unendlich viel besser als ein klebender Balken ohne
# Ausgabe. Deshalb: kein Scroll-Bereich, kein ESC[s/ESC[u, keine reservierte
# Zeile. Der Balken ist eine ganz normale Zeile im Ausgabestrom, die bei jedem
# Etappenwechsel und waehrend langer Etappen alle paar Sekunden erscheint.
#
# ZWEI PHASEN. Ausliefern und Pruefen sind zwei verschiedene Dinge. Nach den
# neun Etappen ist der Deploy fertig — was danach laeuft, ist die Pruefung.
# Beide bekommen einen eigenen Balken, sonst steht der eine auf 100 %, waehrend
# der laengste Abschnitt erst anfaengt.
#
# DAUER STATT ETAPPENZAHL. Gewichtet wird mit den gemessenen Zeiten aus
# .deploy-zeiten.json; innerhalb einer Etappe laeuft der Balken anteilig mit.
# Ohne Erfahrungswerte faellt er auf die Etappenzaehlung zurueck und sagt das
# mit einer Tilde vor der Prozentzahl. 100 % gibt es erst, wenn es stimmt.

BALKEN_BREITE=28
BALKEN_TAKT=8            # Sekunden zwischen zwei Balkenzeilen bei langen Etappen

# Ob stdout ein Terminal ist, wird EINMAL hier festgestellt und gemerkt. Nicht
# spaeter per [ -t 1 ] abfragen: die Zeile wird in $(...) gebaut, und dort ist
# stdout eine Pipe — die Abfrage saegt sich selbst ab und antwortet immer "nein".
# Genau daran ist die Breitenbegrenzung schon einmal gescheitert.
if [ -t 1 ]; then BALKEN_TTY=1; else BALKEN_TTY=0; fi

# Farbe nur im Terminal; in einer Logdatei stoeren Steuerzeichen.
if [ "$BALKEN_TTY" = "1" ] && [ -z "${NO_COLOR:-}" ]; then
  B_GRUEN=$'\033[32m'; B_GRAU=$'\033[90m'; B_FETT=$'\033[1m'; B_AUS=$'\033[0m'
else
  B_GRUEN=""; B_GRAU=""; B_FETT=""; B_AUS=""
fi

PHASE_ART=""             # liefern | pruefen
PHASE_ANZAHL=0           # Etappen dieser Phase
PHASE_START=0
SCHRITT=0
ETAPPE_TEXT=""
ETAPPE_START=0
BALKEN_STATUS=""         # Datei, ueber die die Uhr den Stand liest
BALKEN_TICKER=""         # PID der Uhr
BALKEN_LETZTE=""         # zuletzt gedruckte Zeile (nichts doppelt drucken)
SELFTEST_ETAPPEN=""      # Meldedatei von selftest.sh (Teil n/4 + Name)
BALKEN_MESS=""           # Zeitpunkte, zu denen ein Teil begonnen hat
BALKEN_LETZTZEIT=0

ZEITEN_DATEI="$DIR/.deploy-zeiten.json"   # Erfahrungswerte (gitignored)
ZEITEN_P1=""             # Sekunden je Etappe der Phase "Ausliefern"
ZEITEN_P2=""             # Gesamtdauer der Phase "Pruefen"
ZEITEN_LISTE=""          # laufende Messung der aktuellen Phase

# Ein Zeichen n-mal. Frueher stand hier "printf '█%.0s' $(seq 1 $n)" — und das
# war der Grund fuer einen zerbrochenen Balken: BSD-seq auf macOS zaehlt bei
# "seq 1 0" RUECKWAERTS und gibt "1 0" aus, also zwei Werte statt keinem.
wiederhole() {
  local zeichen="$1" anzahl="$2" i=0 s=""
  while [ "$i" -lt "$anzahl" ]; do s="$s$zeichen"; i=$((i + 1)); done
  printf '%s' "$s"
}

dauer_kurz() {
  local s="$1"
  [ "$s" -lt 0 ] && s=0
  printf '%d:%02d' $((s / 60)) $((s % 60))
}

# Fenstergroesse. Zwei Fallen, beide beim Testen aufgelaufen:
#   1. "tput cols" antwortet aus COLUMNS, wenn die Variable gesetzt ist — also
#      nach dem Aufziehen des Fensters mit dem ALTEN Wert.
#   2. Diese Funktion laeuft immer in $(...), dort ist stdout eine Pipe. tput
#      hat dann gar kein Terminal zum Messen und liefert die terminfo-Vorgabe
#      80 — unabhaengig davon, wie breit das Fenster wirklich ist. Gemessen:
#      echtes Fenster 70 Spalten, "tput cols" in $( ) sagt 80.
# Deshalb wird das echte Terminal auf Dateideskriptor 9 gesichert und "stty
# size" darauf befragt; das ist immer ein frischer ioctl. (2>/dev/null steht
# VOR <&9, damit auch die Meldung eines fehlenden fd 9 verschwindet.)
terminal_breite() {
  local m
  m=$(stty size 2>/dev/null <&9 | awk '{print $2}')
  if [ -n "$m" ] && [ "$m" -gt 0 ] 2>/dev/null; then printf '%s' "$m"; return 0; fi
  tput cols 2>/dev/null || echo 80
}

# ─── Erfahrungswerte (.deploy-zeiten.json) ───
# Je Phase und Lauf eine Zeile mit der Dauer JE ETAPPE. Beide Phasen benutzen
# dasselbe Format und denselben Mittelwert — auch die Pruefung, denn ihre vier
# Teile dauern sehr verschieden lang (der Browser-Rundgang und die
# Modul-Oberflaechen brauchen ein Vielfaches der API-Pruefung). Eine
# Gleichverteilung waere wieder die Sorte Fortschrittsluege, die hier gerade
# ausgebaut wurde. Gemittelt wird ueber die letzten fuenf Laeufe mit derselben
# Etappenzahl — ein Ausreisser soll die Anzeige nicht verbiegen.
zeiten_schnitt() {        # $1 = Phase, $2 = Etappenzahl -> "s1 s2 ... sn"
  [ -r "$ZEITEN_DATEI" ] || return 0
  awk -v ph="\"phase\":\"$1\"" -v g="$2" -v max=5 '
    index($0, ph) > 0 {
      if (!match($0, /"schritte":[0-9]+/)) next
      if (substr($0, RSTART + 11, RLENGTH - 11) + 0 != g) next
      if (match($0, /"dauer":\[[0-9, ]*\]/)) lauf[++c] = substr($0, RSTART + 9, RLENGTH - 10)
    }
    END {
      if (c == 0) exit 0
      von = (c > max ? c - max + 1 : 1)
      for (k = von; k <= c; k++) {
        if (split(lauf[k], a, ",") != g) continue
        for (j = 1; j <= g; j++) sum[j] += a[j] + 0
        anz++
      }
      if (anz == 0) exit 0
      for (j = 1; j <= g; j++) printf "%d ", int(sum[j] / anz + 0.5)
      print ""
    }' "$ZEITEN_DATEI" 2>/dev/null
}

zeiten_laden() {          # $1 = Etappen Phase 1, $2 = Etappen Phase 2
  ZEITEN_P1=$(zeiten_schnitt ausliefern "$1") || ZEITEN_P1=""
  ZEITEN_P2=$(zeiten_schnitt pruefen "$2") || ZEITEN_P2=""
}

zeiten_anhaengen() {
  {
    echo '{"laeufe":['
    grep -h '^{"phase"' "$ZEITEN_DATEI" 2>/dev/null | tail -19 | sed 's/,$//;s/$/,/'
    printf '%s\n' "$1"
    echo ']}'
  } > "$ZEITEN_DATEI.tmp" 2>/dev/null && mv -f "$ZEITEN_DATEI.tmp" "$ZEITEN_DATEI" 2>/dev/null
  return 0
}

# Nur VOLLSTAENDIGE Messreihen merken. Ein Abbruch mittendrin (Strg-C, eine
# gescheiterte Etappe) hat keine brauchbaren Zahlen und darf nichts hinterlassen.
# Ob der Selbsttest inhaltlich etwas zu beanstanden hatte, ist dagegen
# gleichgueltig: wie lange er lief, ist eine Messung und stimmt trotzdem.
zeiten_merken() {
  local anzahl art=ausliefern
  anzahl=$(printf '%s\n' $ZEITEN_LISTE | grep -c .) || anzahl=0
  [ "$anzahl" = "$PHASE_ANZAHL" ] || return 0
  [ "$PHASE_ART" = "pruefen" ] && art=pruefen
  zeiten_anhaengen "$(printf '{"phase":"%s","schritte":%s,"dauer":[%s]}' \
    "$art" "$PHASE_ANZAHL" "$(printf '%s' "$ZEITEN_LISTE" | tr ' ' ',')")"
}

# ─── Phase 2: die vier Teile des Selbsttests ───
# selftest.sh meldet jeden Teil in eine Datei, deren Pfad wir ihm ueber
# SELFTEST_ETAPPEN_DATEI vorgeben (Format: "n/gesamt<TAB>Name", angehaengt).
# Wir lesen sie beim Zeichnen — deshalb braucht es keinen Eingriff in seine
# Ausgabe und keine Textmustersuche in seinem Fliesstext.
datei_zeit() {            # Aenderungszeitpunkt einer Datei (BSD, sonst GNU)
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || date +%s
}

# Setzt die Gewichte der genannten Teile auf 0.
#   $1 = "5 5 14 10"   $2 = "2,3,4"   ->   "5 0 0 0"
# Ein Teil mit Gewicht 0 zaehlt nirgends mit: nicht in der Gesamtsumme, nicht im
# Anteil und nicht in der Restdauer. Er laesst den Balken deshalb auch nicht
# springen, wenn er trotzdem seine Etappenzeile schreibt — er verschiebt die
# Etappennummer weiter, mehr nicht.
gewichte_nullen() {
  local i=0 w aus=""
  for w in $1; do
    i=$((i + 1))
    case ",$2," in *",$i,"*) w=0 ;; esac
    aus="$aus$w "
  done
  printf '%s' "${aus% }"
}

# Haelt fest, WANN ein neuer Teil begonnen hat. Laeuft in der Uhr, weil die
# Hauptshell waehrend des Selbsttests blockiert ist — die Uhr ist der einzige
# Beobachter. Sekundengenau reicht fuer eine Schaetzung im Minutenbereich.
pruefen_beobachten() {
  [ "$PHASE_ART" = "pruefen" ] || return 0
  [ -n "$SELFTEST_ETAPPEN" ] && [ -r "$SELFTEST_ETAPPEN" ] || return 0
  [ -n "$BALKEN_MESS" ] || return 0
  local jetzt gesehen=0 offen
  # Die Plan-Zeile ist keine Etappe — sonst haette die Messreihe einen Wert zu viel.
  offen=$(grep -v '^PLAN' "$SELFTEST_ETAPPEN" 2>/dev/null | grep -c .) || offen=0
  [ -r "$BALKEN_MESS" ] && gesehen=$(grep -c . "$BALKEN_MESS" 2>/dev/null)
  [ -n "$gesehen" ] || gesehen=0
  jetzt=$(date +%s)
  while [ "$gesehen" -lt "$offen" ]; do
    printf '%s\n' "$jetzt" >> "$BALKEN_MESS" 2>/dev/null || return 0
    gesehen=$((gesehen + 1))
  done
  return 0
}

# Dauer je Teil aus den beobachteten Zeitpunkten. Liefert NICHTS, wenn ein Teil
# uebersprungen wurde: ein uebersprungener Teil dauert fast 0 Sekunden, und
# dieser Wert wuerde den Mittelwert fuer spaetere vollstaendige Laeufe kaputt
# machen — die Restdauer bräche dann mitten im Lauf zusammen. Dieselbe Regel wie
# in Phase 1: nur vollstaendige Messreihen zaehlen. Ein --schnell-Lauf benutzt
# die Erfahrungswerte also, steuert aber keine bei.
pruefen_dauern() {
  [ -n "$BALKEN_MESS" ] && [ -r "$BALKEN_MESS" ] || return 0
  grep -q '(uebersprungen)' "$SELFTEST_ETAPPEN" 2>/dev/null && return 0
  local n
  n=$(grep -c . "$BALKEN_MESS" 2>/dev/null) || return 0
  [ "$n" = "$PHASE_ANZAHL" ] || return 0
  awk -v ende="$(date +%s)" 'NF { t[++n] = $1 }
    END { for (i = 1; i < n; i++) printf "%d ", t[i+1] - t[i]; printf "%d", ende - t[n] }' \
    "$BALKEN_MESS" 2>/dev/null
}

# ─── Die Balkenzeile ───
balken_status_schreiben() {
  [ -n "$BALKEN_STATUS" ] || return 0
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$PHASE_ART" "$SCHRITT" "$PHASE_ANZAHL" \
    "$PHASE_START" "$ETAPPE_START" "$ETAPPE_TEXT" > "$BALKEN_STATUS.neu" 2>/dev/null || return 0
  mv -f "$BALKEN_STATUS.neu" "$BALKEN_STATUS" 2>/dev/null || return 0
}

# Baut die Zeile. Reihenfolge beim Kuerzen, wenn das Fenster schmal ist:
# zuerst der Etappentext, dann Phase und Schrittnummer, dann die Zeitangabe,
# zuletzt schrumpft der Balken. Die Zeile bleibt IMMER schmaler als das Fenster
# — bricht sie um, zerreisst das Bild.
balken_zeile() {
  local art n g pstart estart text
  IFS=$'\t' read -r art n g pstart estart text < "$BALKEN_STATUS" 2>/dev/null || return 1
  [ -n "${g:-}" ] && [ "$g" -gt 0 ] 2>/dev/null || return 1

  local jetzt ver_phase ver_etappe
  jetzt=$(date +%s); ver_phase=$((jetzt - pstart)); ver_etappe=$((jetzt - estart))

  # In der Pruefphase kommen Etappennummer, Name und Etappenbeginn aus der
  # Meldedatei von selftest.sh statt aus schritt(): dort zaehlt der Selbsttest
  # weiter, waehrend diese Shell auf ihn wartet.
  local label="Ausliefern" gewichte="$ZEITEN_P1"
  if [ "$art" = "pruefen" ]; then
    label="Prüfen"; gewichte="$ZEITEN_P2"
    if [ -n "$SELFTEST_ETAPPEN" ] && [ -r "$SELFTEST_ETAPPEN" ]; then
      # Plan-Zeile "PLAN<TAB>gesamt<TAB>uebersprungene" steht ganz oben und sagt
      # SCHON BEIM START, welche Teile ausfallen. Deren Erfahrungswerte werden
      # auf 0 gesetzt — sonst schleppt ein --schnell-Lauf die Zeiten der
      # vollstaendigen Laeufe mit und schaetzt viel zu lang. Die dritte Spalte
      # darf leer sein: dann faellt nichts aus.
      local plan weg
      plan=$(grep '^PLAN' "$SELFTEST_ETAPPEN" 2>/dev/null | head -1)
      if [ -n "$plan" ]; then
        weg=$(printf '%s' "$plan" | cut -f3)
        [ -n "$weg" ] && gewichte=$(gewichte_nullen "$gewichte" "$weg")
      fi
      # Die Plan-Zeile ist KEINE Etappe und darf nicht mitgezaehlt werden.
      local zeilen
      zeilen=$(grep -v '^PLAN' "$SELFTEST_ETAPPEN" 2>/dev/null | grep -c .) || zeilen=0
      if [ -n "$zeilen" ] && [ "$zeilen" -gt 0 ] 2>/dev/null; then
        n="$zeilen"
        [ "$n" -gt "$g" ] && n="$g"
        text=$(grep -v '^PLAN' "$SELFTEST_ETAPPEN" 2>/dev/null | tail -1 | cut -f2-)
        estart=$(datei_zeit "$SELFTEST_ETAPPEN")
        ver_etappe=$((jetzt - estart))
      fi
    fi
  fi

  # Fortschritt und Restzeit — nach DAUER, wo Erfahrungswerte da sind.
  local prozent=-1 rest=-1 marke=' '
  if [ -n "$gewichte" ] && [ "$n" -gt 0 ]; then
    local i=0 w ges=0 fertig=0 erw=0
    for w in $gewichte; do
      i=$((i + 1)); ges=$((ges + w))
      if [ "$i" -lt "$n" ]; then fertig=$((fertig + w))
      elif [ "$i" = "$n" ]; then erw="$w"; fi
    done
    if [ "$ges" -gt 0 ]; then
      # Anteilig innerhalb der Etappe — aber gedeckelt auf ihren Anteil,
      # damit der Balken nicht in die naechste Etappe hineinlaeuft.
      local lauf="$ver_etappe"
      [ "$lauf" -gt "$erw" ] && lauf="$erw"
      prozent=$(((fertig + lauf) * 100 / ges))
      rest=$((ges - fertig - lauf))
      # Reisst die laufende Etappe ihre Erfahrungszeit deutlich, ist die
      # Schaetzung nichts mehr wert — dann lieber die verstrichene Zeit.
      [ "$erw" -gt 0 ] && [ "$ver_etappe" -gt $((erw * 2)) ] && rest=-1
    fi
  fi
  if [ "$prozent" -lt 0 ] && [ "$n" -gt 0 ]; then
    prozent=$((n * 100 / g)); marke='~'
  fi
  # 100 % gibt es nur von phase_ende, wenn es auch stimmt.
  [ "$prozent" -gt 99 ] && prozent=99

  local zeit
  if [ "$rest" -gt 0 ]; then zeit="noch ca. $(dauer_kurz "$rest")"
  else zeit="seit $(dauer_kurz "$ver_phase")"; fi

  local nm="$label $n/$g"
  [ "$n" -gt 0 ] || nm="$label"

  # Wiederholung derselben Etappe wird KURZ gehalten.
  #
  # Bei "Container bauen und starten" oder dem Systemtest stand sonst alle acht
  # Sekunden dieselbe lange Zeile — dreimal, viermal, fuenfmal hintereinander
  # wortgleich. Beim ersten Mal ist die volle Zeile die Ansage, was gerade
  # laeuft; danach interessiert nur noch, dass es weitergeht. Also ab dem
  # zweiten Mal ohne Phase, Nummer und Text: Balken, Prozent, Uhr.
  # Die Kennung steht in einer DATEI, nicht in einer Variablen: gedruckt wird
  # aus zwei Prozessen (Hauptshell bei jedem Etappenwechsel, Uhr dazwischen),
  # und eine Variable haette in beiden ihren eigenen Stand — die volle Zeile
  # kaeme dann jedes Mal doppelt.
  local kennung="$art/$n/$text" vorher=""
  [ -n "$BALKEN_STATUS" ] && vorher=$(cat "$BALKEN_STATUS.etappe" 2>/dev/null || true)
  if [ "$kennung" = "$vorher" ]; then
    balken_bauen "$prozent" "$marke" "" "" "$zeit"
  else
    [ -n "$BALKEN_STATUS" ] && printf '%s' "$kennung" > "$BALKEN_STATUS.etappe" 2>/dev/null
    balken_bauen "$prozent" "$marke" "$nm" "$text" "$zeit"
  fi
}

# Setzt die Zeile aus Bausteinen zusammen und haelt dabei das Breitenbudget ein.
balken_bauen() {
  local prozent="$1" marke="$2" nm="$3" text="$4" zeit="$5"
  local spalten budget breite frei
  if [ "$BALKEN_TTY" = "1" ]; then spalten=$(terminal_breite); else spalten=120; fi
  budget=$((spalten - 1))
  breite=$BALKEN_BREITE
  local pbreite=5
  [ "$prozent" -lt 0 ] && pbreite=0
  if [ $((2 + breite + pbreite)) -gt "$budget" ]; then
    breite=$((budget - 2 - pbreite))
    [ "$breite" -lt 4 ] && return 1
  fi
  frei=$((budget - 2 - breite - pbreite))

  local zeige_zeit=0 zeige_nm=0
  if [ "$frei" -ge $((3 + ${#zeit})) ]; then zeige_zeit=1; frei=$((frei - 3 - ${#zeit})); fi
  if [ "$frei" -ge $((2 + ${#nm})) ]; then zeige_nm=1; frei=$((frei - 2 - ${#nm})); fi
  local textplatz=$((frei - 3))
  [ "$textplatz" -lt 0 ] && textplatz=0
  [ "${#text}" -gt "$textplatz" ] && text="${text:0:$textplatz}"

  local voll=0
  [ "$prozent" -gt 0 ] && voll=$((prozent * breite / 100))
  [ "$voll" -lt 0 ] && voll=0
  [ "$voll" -gt "$breite" ] && voll=$breite
  local leer=$((breite - voll))

  # Klammern um jede Variable: bash 3.2 zieht ein direkt folgendes Multibyte-
  # Zeichen (hier das ·) sonst in den Variablennamen und bricht unter set -u ab.
  local aus
  aus="${B_GRUEN}[$(wiederhole '█' "$voll")${B_GRAU}$(wiederhole '·' "$leer")${B_GRUEN}]"
  [ "$prozent" -ge 0 ] && aus="${aus}$(printf '%s%3d%%' "$marke" "$prozent")"
  aus="${aus}${B_AUS}"
  # Trenner nur zwischen Teilen, die es wirklich gibt. In der Kurzform
  # (Wiederholung derselben Etappe) sind Name und Text leer — sonst staende da
  # ein Punkt ohne etwas davor und ein doppeltes Leerzeichen.
  [ "$zeige_nm" = "1" ] && [ -n "$nm" ] && aus="${aus}  ${B_GRAU}${nm}${B_AUS}"
  if [ -n "$text" ]; then
    if [ "$zeige_nm" = "1" ] && [ -n "$nm" ]; then
      aus="${aus} ${B_GRAU}·${B_AUS} ${B_FETT}${text}${B_AUS}"
    else
      aus="${aus}  ${B_FETT}${text}${B_AUS}"
    fi
  fi
  if [ "$zeige_zeit" = "1" ]; then
    if [ -n "$text" ] || { [ "$zeige_nm" = "1" ] && [ -n "$nm" ]; }; then
      aus="${aus} ${B_GRAU}·${B_AUS} ${zeit}"
    else
      aus="${aus}  ${zeit}"
    fi
  fi
  printf '%s' "$aus"
}

# Druckt die Zeile — gedrosselt, und nie zweimal dasselbe. Das ist die Antwort
# auf das Flackern: es wird nichts geloescht und nichts neu gemalt, es kommt nur
# dann eine Zeile dazu, wenn sie etwas Neues sagt.
balken_drucken() {
  local erzwingen="${1:-0}" zeile jetzt
  zeile=$(balken_zeile) || return 0
  [ -n "$zeile" ] || return 0
  jetzt=$(date +%s)
  if [ "$erzwingen" != "1" ]; then
    [ $((jetzt - BALKEN_LETZTZEIT)) -ge "$BALKEN_TAKT" ] || return 0
    [ "$zeile" != "$BALKEN_LETZTE" ] || return 0
  fi
  BALKEN_LETZTZEIT="$jetzt"
  BALKEN_LETZTE="$zeile"
  printf '%s\n' "$zeile"
}

ticker_stop() {
  [ -n "$BALKEN_TICKER" ] || return 0
  kill "$BALKEN_TICKER" 2>/dev/null || true
  wait "$BALKEN_TICKER" 2>/dev/null || true
  BALKEN_TICKER=""
}

# $1 = "still": beobachten, aber nichts drucken.
ticker_start() {
  ticker_stop
  local still="${1:-}"
  # trap - EXIT ist wichtig: die Subshell erbt den EXIT-Trap des Hauptskripts
  # und wuerde beim Beendetwerden das Aufraeumen ein zweites Mal ausloesen.
  ( trap - EXIT INT TERM
    local_gesehen=0; gesehen_teile=0
    while :; do
      sleep 1
      # Die Uhr ist waehrend des Selbsttests der einzige Beobachter: die
      # Hauptshell wartet dann auf ihn und sieht die neuen Teile nicht.
      pruefen_beobachten || true
      if [ "$still" = "still" ]; then
        # Still heisst nicht stumm: bei jedem NEUEN Teil eine Zeile, sonst
        # nichts. Vier Zeilen fuer die ganze Pruefung statt einer alle acht
        # Sekunden zwischen den Befunden der Tests.
        jetzt_teile=0
        [ -n "$SELFTEST_ETAPPEN" ] && [ -r "$SELFTEST_ETAPPEN" ] && \
          jetzt_teile=$(grep -v '^PLAN' "$SELFTEST_ETAPPEN" 2>/dev/null | grep -c .)
        if [ "$jetzt_teile" != "$gesehen_teile" ]; then
          gesehen_teile="$jetzt_teile"
          balken_drucken 1 || true
        fi
      else
        balken_drucken || true
      fi
    done ) &
  BALKEN_TICKER=$!
  disown 2>/dev/null || true
}

# ─── Phasen ───
phase_start() {           # $1 = liefern|pruefen, $2 = Anzahl Etappen
  PHASE_ART="$1"; PHASE_ANZAHL="$2"
  SCHRITT=0
  PHASE_START=$(date +%s); ETAPPE_START="$PHASE_START"
  ETAPPE_TEXT=""; ZEITEN_LISTE=""
  BALKEN_LETZTE=""; BALKEN_LETZTZEIT="$PHASE_START"
  [ "$BALKEN_TTY" = "1" ] && exec 9>&1   # echtes Terminal sichern (fuer stty size)
  if [ -z "$BALKEN_STATUS" ]; then
    BALKEN_STATUS=$(mktemp -t nuvora-balken 2>/dev/null) || BALKEN_STATUS=""
  fi
  balken_status_schreiben
  # Die Uhr laeuft nur beim Ausliefern. Dort ist es minutenlang still ("docker
  # compose build"), und ohne sie waere gar nicht zu sehen, dass es weitergeht.
  #
  # In der Pruefphase drucken die Tests SELBST jede Zeile mit Sekundenzahl —
  # dort ist eine zweite Fortschrittsquelle keine Hilfe, sondern Laerm zwischen
  # den Befunden. Die Phase meldet sich am Anfang, bei jedem der vier Teile und
  # am Ende; das genuegt.
  #
  # Beobachtet werden muss trotzdem: die Etappen der Pruefung kommen aus der
  # Meldedatei, und die liest sonst niemand (die Hauptshell wartet auf
  # selftest.sh). Darum laeuft die Uhr dort still weiter.
  if [ "$1" = "pruefen" ]; then ticker_start still; else ticker_start; fi
}

phase_ende() {            # schliesst die Phase ab: Zeiten merken, 100 % zeigen
  [ -n "$PHASE_ART" ] || { ticker_stop; return 0; }
  if [ "$PHASE_ART" = "pruefen" ]; then
    pruefen_beobachten || true      # letzten Teil noch mitnehmen
    ticker_stop
    ZEITEN_LISTE=$(pruefen_dauern) || ZEITEN_LISTE=""
  else
    ticker_stop
    [ "$SCHRITT" -gt 0 ] && ZEITEN_LISTE="$ZEITEN_LISTE $(($(date +%s) - ETAPPE_START))"
    ZEITEN_LISTE="${ZEITEN_LISTE# }"
  fi
  zeiten_merken
  local label="Ausliefern"
  [ "$PHASE_ART" = "pruefen" ] && label="Prüfen"
  printf '%s\n' "$(balken_bauen 100 ' ' "$label $PHASE_ANZAHL/$PHASE_ANZAHL" \
    "fertig" "in $(dauer_kurz $(($(date +%s) - PHASE_START)))")"
  PHASE_ART=""
}

schritt() {
  # Dauer der abgeschlossenen Etappe festhalten (fuer .deploy-zeiten.json).
  [ "$SCHRITT" -gt 0 ] && ZEITEN_LISTE="$ZEITEN_LISTE $(($(date +%s) - ETAPPE_START))"
  SCHRITT=$((SCHRITT + 1))
  ETAPPE_TEXT="$1"
  ETAPPE_START=$(date +%s)
  balken_status_schreiben
  balken_drucken 1
}

# Sicherung: eine Anzeige, die bei 88 % endet oder ueber 100 % laeuft, ist
# schlimmer als keine. Am Ende einer Phase muss die Zahl der gelaufenen Etappen
# exakt der angekuendigten entsprechen — sonst ist die Zahl beim Ergaenzen eines
# Schrittes vergessen worden, und genau das soll auffallen.
schritte_bilanz() {
  [ "$SCHRITT" = "$PHASE_ANZAHL" ] && return 0
  echo ""
  echo "  ⚠ Fortschrittsanzeige stimmt nicht: $SCHRITT Etappen gelaufen," \
       "$PHASE_ANZAHL angekündigt."
  echo "    Die Etappenzahl in deploy.sh an die Zahl der schritt-Aufrufe anpassen."
}

balken_aufraeumen() {
  ticker_stop
  [ -n "$BALKEN_STATUS" ] && rm -f "$BALKEN_STATUS" "$BALKEN_STATUS.neu" "$BALKEN_STATUS.etappe" 2>/dev/null
  [ -n "$SELFTEST_ETAPPEN" ] && rm -f "$SELFTEST_ETAPPEN" 2>/dev/null
  [ -n "$BALKEN_MESS" ] && rm -f "$BALKEN_MESS" 2>/dev/null
  return 0
}
trap balken_aufraeumen EXIT
trap 'balken_aufraeumen; echo ""; echo "  Abgebrochen."; exit 130' INT TERM

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

# Phase 1 hat neun Etappen — die neun schritt-Aufrufe bis zu den Health-Checks.
# Der Selbsttest gehoert NICHT dazu: er prueft, er liefert nicht aus, und er ist
# der laengste Teil. Er bekommt in Phase 2 einen eigenen Balken.
PHASE1_ETAPPEN=9
# Phase 2 hat vier Teile. Die meldet selftest.sh selbst — uebersprungene zaehlen
# mit, damit die Summe immer 4 ergibt.
PHASE2_ETAPPEN=4

echo "=== Nuvora Deploy ==="
echo "Server: $SERVER"
echo "Pfad:   $REMOTE_DIR"
echo "Port:   $PORT"
echo "Build:  ${BUILD_SERVICES:-alle Services}"
echo ""

zeiten_laden "$PHASE1_ETAPPEN" "$PHASE2_ETAPPEN"
if [ -z "$ZEITEN_P1" ]; then
  echo "  (Erster Lauf ohne Erfahrungswerte — der Balken zählt Etappen statt Dauer;"
  echo "   erkennbar an der Tilde vor der Prozentzahl. Ab dem nächsten Lauf nach Zeit.)"
  echo ""
fi
phase_start liefern "$PHASE1_ETAPPEN"

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

# Phase 1 ist hier zu Ende — ausgeliefert ist ausgeliefert. Der Balken darf
# jetzt auf 100 % stehen, weil er es auch ist.
schritte_bilanz
phase_ende

echo ""
echo "========================================"
if [ "$CV" = "200" ] && [ "$LP" = "200" ]; then
  echo "  Nuvora ausgeliefert — beide Module gesund."
  echo "  ${SITE_URL:-http://localhost:$PORT}"
  echo "========================================"
  # Health sagt nur "Container laeuft". Der Selbsttest sagt, ob jedes Modul,
  # die Einrichtung und die Seiten wirklich funktionieren. Das ist Phase 2:
  # eine eigene Sache mit eigenem Balken, denn hier wartet man am laengsten.
  if [ "$SELFTEST" = "1" ]; then
    SELFTEST_ARGS=()
    [ "$SELFTEST_VOLL" = "0" ] && SELFTEST_ARGS+=(--schnell)
    echo ""
    if [ -z "$ZEITEN_P2" ]; then
      echo "  (Noch keine Erfahrungswerte für die Prüfung — Dauer wird erst"
      echo "   ab dem nächsten Lauf geschätzt.)"
    fi
    # Frische, leere Meldedatei — selftest.sh haengt seine vier Teile an.
    SELFTEST_ETAPPEN=$(mktemp -t nuvora-etappen 2>/dev/null) || SELFTEST_ETAPPEN=""
    BALKEN_MESS=$(mktemp -t nuvora-mess 2>/dev/null) || BALKEN_MESS=""
    [ -n "$SELFTEST_ETAPPEN" ] && : > "$SELFTEST_ETAPPEN"
    [ -n "$BALKEN_MESS" ] && : > "$BALKEN_MESS"
    export SELFTEST_ETAPPEN_DATEI="$SELFTEST_ETAPPEN"
    phase_start pruefen "$PHASE2_ETAPPEN"
    ETAPPE_TEXT="Selbsttest startet"
    balken_status_schreiben
    balken_drucken 1
    # Kein eigener Schlusssatz: die Zusammenfassung des Selbsttests sagt bereits
    # alles. Der Rueckgabewert traegt das Ergebnis nach aussen.
    set +e
    "$DIR/selftest.sh" "${SELFTEST_ARGS[@]+"${SELFTEST_ARGS[@]}"}"
    SELFTEST_RC=$?
    set -e
    # WICHTIG: die Messung wird festgehalten, BEVOR ueber den Rueckgabewert
    # entschieden wird. Wie lange die Pruefung lief, ist eine Messung — die
    # stimmt auch dann, wenn die Pruefung inhaltlich etwas zu beanstanden hat.
    # Vorher stand hier "|| exit 1" vor dem Merken; weil der Selbsttest des
    # Nutzers rot war (SPF-Eintrag der Domain), entstand nie eine Zeitendatei,
    # und deshalb fehlte in jedem Lauf die Restdauer.
    phase_ende
    [ "$SELFTEST_RC" = "0" ] || exit 1
  fi
else
  [ "$CV" != "200" ] && echo "  ⚠ Nuvora-Kern nicht gesund (health=$CV)"
  [ "$LP" != "200" ] && echo "  ⚠ Modul Lernpfad nicht gesund (status=$LP)"
  echo "  Logs oben prüfen."
  echo "========================================"
  exit 1
fi
