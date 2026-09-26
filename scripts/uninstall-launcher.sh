#!/bin/bash
# Removes the LaunchAgent installed by scripts/install-launcher.sh: stops Pullup (cleanly — the
# server gets SIGTERM and closes the database) and it no longer starts at login.
# Logs in <library>/logs are kept.

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$REPO/scripts/lib/pullup-env.sh"

PLIST="$HOME/Library/LaunchAgents/$PULLUP_LABEL.plist"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$PULLUP_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$PULLUP_LABEL"
  echo "✓ stopped $PULLUP_LABEL"
else
  echo "· $PULLUP_LABEL wasn't running"
fi

if [ -f "$PLIST" ]; then
  rm "$PLIST"
  echo "✓ removed $PLIST"
else
  echo "· no $PLIST"
fi
echo "Pullup won't start at login any more. Run it by hand with pnpm dev or pnpm start:fresh."
