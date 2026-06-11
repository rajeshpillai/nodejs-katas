#!/usr/bin/env bash
#
# dev.sh — start the Node.js Katas dev environment.
#
# Launches the backend API/execution server (port 6001) and the SolidJS
# frontend dev server (Vite, port 3000). Vite proxies /api to the backend.
#
# Usage:
#   ./dev.sh            Start both servers
#   ./dev.sh backend    Start only the backend
#   ./dev.sh frontend   Start only the frontend
#
# Press Ctrl-C to stop everything.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT="${PORT:-6001}"
FRONTEND_PORT="3000"

# Track child PIDs so we can tear them down cleanly.
PIDS=()

color()  { printf '\033[%sm%s\033[0m' "$1" "$2"; }
info()   { echo "$(color '1;34' '»') $*"; }
ok()     { echo "$(color '1;32' '✓') $*"; }
warn()   { echo "$(color '1;33' '!') $*"; }

cleanup() {
  echo
  info "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  ok "All servers stopped."
}
trap cleanup INT TERM EXIT

# Install dependencies only if node_modules is missing.
ensure_deps() {
  local dir="$1" name="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    warn "$name dependencies not installed — running npm install…"
    (cd "$dir" && npm install)
  fi
}

start_backend() {
  ensure_deps "$BACKEND_DIR" "backend"
  info "Starting backend on http://localhost:$BACKEND_PORT"
  (cd "$BACKEND_DIR" && PORT="$BACKEND_PORT" npm run dev) &
  PIDS+=("$!")
}

start_frontend() {
  ensure_deps "$FRONTEND_DIR" "frontend"
  info "Starting frontend on http://localhost:$FRONTEND_PORT"
  (cd "$FRONTEND_DIR" && npm run dev) &
  PIDS+=("$!")
}

command -v node >/dev/null 2>&1 || { warn "node is not installed or not on PATH."; exit 1; }
command -v npm  >/dev/null 2>&1 || { warn "npm is not installed or not on PATH."; exit 1; }

case "${1:-all}" in
  backend)  start_backend ;;
  frontend) start_frontend ;;
  all)      start_backend; start_frontend ;;
  *)        warn "Unknown target '$1' (use: backend | frontend | all)"; exit 1 ;;
esac

echo
ok "Dev environment running. Press Ctrl-C to stop."
echo "   Frontend → http://localhost:$FRONTEND_PORT"
echo "   Backend  → http://localhost:$BACKEND_PORT"
echo

# Wait on all background jobs; cleanup runs on exit.
wait
