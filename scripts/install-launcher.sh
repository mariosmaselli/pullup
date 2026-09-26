#!/bin/bash
# Runs Pullup without a terminal: installs a macOS LaunchAgent that starts it in production mode
# at login (http://localhost:4500), rebuilds dist/ when the code changed, and restarts it if it
# crashes. Safe to run again (e.g. after changing PULLUP_LIBRARY or PORT in .env).
# Undo with scripts/uninstall-launcher.sh.
#   scripts/install-launcher.sh --dry-run   check everything and print the plist; install nothing

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$REPO/scripts/lib/pullup-env.sh"
export PATH="$PULLUP_BASE_PATH"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
PLIST="$HOME/Library/LaunchAgents/$PULLUP_LABEL.plist"
[ $DRY_RUN = 1 ] && PLIST="$(mktemp -t pullup-launcher).plist"
DOMAIN="gui/$(id -u)"
fail() {
  echo "✗ $*" >&2
  exit 1
}

[ "$(uname)" = "Darwin" ] || fail "LaunchAgents are macOS only"
[ -d "$REPO/node_modules" ] || fail "Run pnpm install in $REPO first"

MAJOR="$(pullup_node_major)"
NODE="$(find_node)" ||
  fail "No Node $MAJOR found (.node-version asks for it). Install it with \`n $MAJOR\` or \`brew install node@$MAJOR\`."
echo "✓ Node $("$NODE" -v) — $NODE"

if ! out="$(check_sqlite "$NODE")"; then
  echo "$out" | tail -n 3 >&2
  fail "better-sqlite3 doesn't load under this Node. Rebuild it: PATH=\"$(dirname "$NODE"):\$PATH\" pnpm rebuild better-sqlite3"
fi
echo "✓ better-sqlite3 loads"

PNPM="$(PATH="$(dirname "$NODE"):$PATH" command -v pnpm || true)"
[ -n "$PNPM" ] && echo "✓ pnpm — $PNPM" || echo "! pnpm not found — the launcher will build with npm instead"
FFMPEG="$(command -v ffmpeg || true)"
[ -n "$FFMPEG" ] && echo "✓ ffmpeg — $FFMPEG" || echo "! ffmpeg not found — video won't work until: brew install ffmpeg"

read_pullup_env "$NODE" || fail "Couldn't read .env"
LOGS="$PULLUP_LIBRARY_DIR/logs"
[ $DRY_RUN = 1 ] || mkdir -p "$LOGS" # launchd needs the folder to exist for its log
echo "✓ library $PULLUP_LIBRARY_DIR · port $PULLUP_PORT"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# Version managers keep their Node where find_node looks by default; pass on a custom n prefix.
EXTRA_ENV=""
if [ -n "${N_PREFIX:-}" ]; then
  EXTRA_ENV="<key>N_PREFIX</key><string>$(xml "$N_PREFIX")</string>"
fi

mkdir -p "$(dirname "$PLIST")"
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by $(xml "$REPO")/scripts/install-launcher.sh — remove with scripts/uninstall-launcher.sh -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PULLUP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$REPO")/scripts/launch.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PULLUP_BASE_PATH</string>
    $EXTRA_ENV
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart after a crash; a clean stop (launchctl kill TERM, shutdown) stays stopped. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ExitTimeOut</key>
  <integer>20</integer>
  <!-- Only what happens before launch.sh opens pullup.log (e.g. bash can't start). -->
  <key>StandardOutPath</key>
  <string>$(xml "$LOGS")/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOGS")/launchd.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null || fail "The generated plist is invalid: $PLIST"
if [ $DRY_RUN = 1 ]; then
  echo "✓ plist is valid — dry run, nothing installed:"
  echo
  cat "$PLIST"
  rm -f "$PLIST"
  exit 0
fi
echo "✓ wrote $PLIST"

launchctl bootout "$DOMAIN/$PULLUP_LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$PULLUP_LABEL"
echo "✓ loaded — Pullup starts now and at every login"

if port_in_use "$PULLUP_PORT"; then
  echo
  echo "! Port $PULLUP_PORT is in use (pnpm dev?). The launcher waits and takes over once it's free."
fi

cat <<INFO

  Open        http://localhost:$PULLUP_PORT  (the first start builds dist/ — give it a minute)
  Log         $LOGS/pullup.log
  Stop        launchctl kill TERM $DOMAIN/$PULLUP_LABEL
  Start/restart  launchctl kickstart -k $DOMAIN/$PULLUP_LABEL
  Status      launchctl print $DOMAIN/$PULLUP_LABEL | grep -E 'state|pid|last exit'
  Uninstall   $REPO/scripts/uninstall-launcher.sh

  macOS may show "Background Items Added" (listed as bash under Login Items → Allow in the
  Background). Leave it on, or Pullup won't start at login.
INFO
