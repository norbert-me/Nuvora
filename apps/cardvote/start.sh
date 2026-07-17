#!/bin/bash
# CardVote — Lokaler Teststart
# Beendet mit Ctrl+C (stoppt beide Server)

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# Node.js Pfad (lokal installiert)
export PATH="$HOME/local/node-v22.17.0-darwin-arm64/bin:$PATH"

# Alte Prozesse killen
lsof -ti:8000 -ti:3000 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

echo "=== Backend starten (Port 8000) ==="
cd "$DIR/backend"
if [ ! -d venv ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt aiosqlite greenlet
else
    source venv/bin/activate
fi
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "=== Frontend starten (Port 3000) ==="
cd "$DIR/frontend"
if [ ! -d node_modules ]; then
    npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo "========================================="
echo "  Ctrl+C zum Beenden"
echo ""

cleanup() {
    echo "Server werden gestoppt..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

wait
