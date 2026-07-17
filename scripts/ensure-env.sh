# Fuellt fehlende Pflicht-Secrets in .env auf. Erwartet $t und $p (Zufallswerte)
# und ein Arbeitsverzeichnis mit .env.example.
#
# Laeuft auf dem Server, wird von deploy.sh ueber stdin eingespielt — daher
# kein Shebang und keine Argumente: die Werte wuerden sonst in der Prozessliste
# des Servers stehen.
#
# Idempotent: vorhandene Werte bleiben unangetastet, nur Leeres wird gesetzt.
# Gibt aus, was geaendert wurde (leer = nichts zu tun).

changed=''

if [ ! -f .env ]; then
  cp .env.example .env
  changed=' (neu angelegt)'
fi
chmod 600 .env

set_if_empty() {
  key="$1"
  val="$2"
  # Aktuellen Wert lesen: alles nach "KEY=" bis zu einem eventuellen Kommentar.
  cur=$(sed -n "s|^${key}=\([^#]*\).*|\1|p" .env | tr -d ' \t' | head -1)
  [ -n "$cur" ] && return 0

  if grep -q "^${key}=" .env; then
    # Wert direkt in awk setzen: kein sed-Escaping noetig, egal was im Wert steht.
    awk -v k="$key" -v v="$val" \
      'index($0, k "=") == 1 { print k "=" v; next } { print }' \
      .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
  chmod 600 .env
  changed="$changed $key"
}

set_if_empty TOKEN_SECRET "$t"
set_if_empty POSTGRES_PASSWORD "$p"

printf '%s' "$changed"
