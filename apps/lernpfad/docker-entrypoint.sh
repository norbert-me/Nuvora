#!/bin/sh
set -e

# Start backend in background
node /app/server.js &
BACKEND_PID=$!

# Start nginx in foreground
exec nginx -g "daemon off;"
