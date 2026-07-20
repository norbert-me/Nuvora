#!/usr/bin/env bash
# Nuvora-Datenbank sichern: pg_dump aus dem laufenden db-Container in eine
# komprimierte Datei. Aufbewahrung: alte Sicherungen aelter als RETENTION_DAYS
# werden geloescht. Fuer einen Cron-Eintrag gedacht (Betrieb, nicht Code):
#
#   0 3 * * *  /pfad/zu/nuvora/scripts/backup.sh >> /var/log/nuvora-backup.log 2>&1
#
# Wiederherstellen:
#   gunzip -c backups/nuvora-YYYY-MM-DD_HHMM.sql.gz \
#     | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
set -euo pipefail

cd "$(dirname "$0")/.."

# .env laden (POSTGRES_USER/DB/PASSWORD), Defaults wie in docker-compose.yml.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PG_USER="${POSTGRES_USER:-nuvora}"
PG_DB="${POSTGRES_DB:-nuvora}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
OUT_DIR="${BACKUP_DIR:-backups}"

mkdir -p "$OUT_DIR"
stamp="$(date +%Y-%m-%d_%H%M)"
out="$OUT_DIR/nuvora-$stamp.sql.gz"

# docker compose (v2) oder docker-compose (v1) — je nachdem was da ist.
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "[$(date '+%F %T')] Sichere $PG_DB → $out"
$DC exec -T db pg_dump -U "$PG_USER" -d "$PG_DB" | gzip > "$out"

# Groesse pruefen: leerer Dump (0 Bytes nach gzip-Header) = Fehler, nicht behalten.
if [ ! -s "$out" ]; then
  echo "FEHLER: Sicherung ist leer, wird geloescht." >&2
  rm -f "$out"
  exit 1
fi

# Alte Sicherungen aufraeumen.
find "$OUT_DIR" -name 'nuvora-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -delete
echo "[$(date '+%F %T')] Fertig ($(du -h "$out" | cut -f1)). Aufbewahrung: $RETENTION_DAYS Tage."
