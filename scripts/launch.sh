#!/bin/bash
# Runs Pullup in production mode: what the LaunchAgent from scripts/install-launcher.sh starts
# at login. Also fine to run by hand.
#
#   1. picks the Node that .node-version asks for (never whatever `node` is first on PATH)
#   2. rebuilds dist/ if it's out of date (scripts/dist-stamp.mjs)
#   3. waits while something else holds the port (e.g. `pnpm dev`), then serves the app
#
# Output goes to <library>/logs/pullup.log (rotated at 10 MB).
#   scripts/launch.sh --check   show what it would use, then exit

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$REPO" || exit 1
. "$REPO/scripts/lib/pullup-env.sh"
export PATH="$PULLUP_BASE_PATH"

log() { echo "[launch $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Exits 0 when there's nothing to retry: launchd only restarts Pullup after a crash (non-zero).
NODE="$(find_node)" || {
  log "No Node $(pullup_node_major) found (.node-version). Install it, e.g. \`n $(pullup_node_major)\` or \`brew install node@$(pullup_node_major)\`."
  exit 0
}
export PATH="$(dirname "$NODE"):$PATH"
read_pullup_env "$NODE" || { log "Couldn't read .env"; exit 0; }

if [ "${1:-}" = "--check" ]; then
  echo "repo     $REPO"
  echo "node     $NODE ($(node -v))"
  echo "pnpm     $(command -v pnpm || echo 'not found')"
  echo "ffmpeg   $(command -v ffmpeg || echo 'not found — brew install ffmpeg')"
  echo "library  $PULLUP_LIBRARY_DIR"
  echo "port     $PULLUP_PORT"
  echo "logs     $PULLUP_LIBRARY_DIR/logs/pullup.log"
  node scripts/dist-stamp.mjs check
  exit 0
fi

LOGS="$PULLUP_LIBRARY_DIR/logs"
mkdir -p "$LOGS"
LOG="$LOGS/pullup.log"
if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 10485760 ]; then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1

log "Node $(node -v) at $NODE · ffmpeg $(command -v ffmpeg || echo 'missing — brew install ffmpeg')"

if ! node scripts/dist-stamp.mjs check; then
  log "Building dist/…"
  if command -v pnpm >/dev/null; then build="pnpm build"; else build="npm run build"; fi
  if ! $build; then
    log "Build failed (see above). Fix it, then: launchctl kickstart -k gui/$(id -u)/$PULLUP_LABEL"
    exit 0
  fi
fi

if port_in_use "$PULLUP_PORT"; then
  log "Port $PULLUP_PORT is in use (pnpm dev?) — waiting for it to be free"
  while port_in_use "$PULLUP_PORT"; do sleep 20; done
fi

log "Starting on http://localhost:$PULLUP_PORT · library $PULLUP_LIBRARY_DIR"
# What `pnpm start` runs, minus pnpm itself: pnpm answers launchd's SIGTERM with exit 143 before
# the server has closed the database, and launchd would take that for a crash. tsx passes the
# signal on, the server shuts down cleanly and exits 0.
node scripts/dist-stamp.mjs check --quiet || { log "dist/ is still out of date"; exit 1; }
export NODE_ENV=production
exec "$REPO/node_modules/.bin/tsx" src/server/index.ts
