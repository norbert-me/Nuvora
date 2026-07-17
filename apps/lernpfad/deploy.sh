#!/bin/bash
set -euo pipefail

# ─── Konfiguration ───
# Zugangsdaten stehen in .deploy.env (gitignored, siehe .deploy.env.example).
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "${LOCAL_DIR}/.deploy.env" ]; then
    # shellcheck disable=SC1091
    . "${LOCAL_DIR}/.deploy.env"
fi

: "${SERVER:?SERVER nicht gesetzt — .deploy.env aus .deploy.env.example anlegen}"
: "${REMOTE_DIR:?REMOTE_DIR nicht gesetzt — .deploy.env aus .deploy.env.example anlegen}"

echo "Deploying Lernleiter to ${SERVER}:${REMOTE_DIR}"

ssh "${SERVER}" "mkdir -p ${REMOTE_DIR}"

# rsync statt scp: es werden nur geaenderte Dateien uebertragen (schnell).
# --delete haelt das Zielverzeichnis sauber. data/ + backups/ NIE anfassen
# (Live-DB + Sicherungen), ebenso node_modules/.git.
# -rltz statt -a: KEIN Owner/Group/Perms uebertragen. Das NAS-Share erlaubt
# root kein chown ("Operation not permitted") -> -a wuerde bei jeder Datei
# scheitern. Fuer Bind-Mounts sind Besitzer/Rechte ohnehin egal.
rsync -rltz --delete --no-owner --no-group --no-perms \
    --exclude 'data/' \
    --exclude 'backups/' \
    --exclude 'node_modules/' \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    "${LOCAL_DIR}/" "${SERVER}:${REMOTE_DIR}/"

# Frontend + server.js sind als Volumes gemountet (siehe docker-compose.yml):
# geaenderte Statik wirkt sofort, geaendertes server.js nach dem Neustart.
# `--build` OHNE --no-cache: bleiben package.json/package-lock gleich, ist der
# npm-install-Layer gecacht -> Build praktisch instant. Nur bei geaenderten
# Dependencies laeuft npm wirklich neu.
ssh "${SERVER}" "cd ${REMOTE_DIR} && docker compose up -d --build"

echo ""
echo "Deploy abgeschlossen."
echo "Lernleiter läuft auf ${SERVER##*@}:8082"
