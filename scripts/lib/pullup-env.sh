# Shared by scripts/launch.sh and scripts/install-launcher.sh (sourced, bash 3.2-compatible).
# Expects REPO to be set to the repo root.

# launchd starts jobs with a bare PATH. Homebrew has pnpm and ffmpeg; /usr/bin has sips.
PULLUP_BASE_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PULLUP_LABEL="local.pullup"

# The major Node version .node-version asks for ("22"). better-sqlite3 is a native module built
# for one Node ABI: Node 20 crashes on it, and so would a newer major.
pullup_node_major() {
  local want
  want="$(tr -d ' \t\r\n' <"$REPO/.node-version" 2>/dev/null)"
  want="${want#v}"
  echo "${want%%.*}"
}

# Prints the newest installed Node of that major version (PULLUP_NODE overrides the search).
# Looks where version managers keep them (n, nvm, fnm, volta, asdf), Homebrew's node@N, and the
# usual `node` binaries — so it works whichever one happens to be first on a shell's PATH.
find_node() {
  if [ -n "${PULLUP_NODE:-}" ]; then
    [ -x "$PULLUP_NODE" ] && echo "$PULLUP_NODE"
    return
  fi
  local major n found c v
  major="$(pullup_node_major)"
  [ -n "$major" ] || major=22
  n="${N_PREFIX:-$HOME/.n}"
  found=""
  for c in \
    "$n"/n/versions/node/"$major".*/bin/node \
    /usr/local/n/versions/node/"$major".*/bin/node \
    "$HOME"/.nvm/versions/node/v"$major".*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/v"$major".*/installation/bin/node \
    "$HOME/Library/Application Support/fnm/node-versions"/v"$major".*/installation/bin/node \
    "$HOME"/.volta/tools/image/node/"$major".*/bin/node \
    "$HOME"/.asdf/installs/nodejs/"$major".*/bin/node \
    /opt/homebrew/opt/node@"$major"/bin/node \
    /usr/local/opt/node@"$major"/bin/node \
    "$n"/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    [ -x "$c" ] || continue
    v="$("$c" -p 'process.versions.node' 2>/dev/null)" || continue
    [ "${v%%.*}" = "$major" ] || continue
    found="$found$v $c
"
  done
  [ -n "$found" ] || return 1
  printf '%s' "$found" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -d' ' -f2-
}

# Sets PULLUP_LIBRARY_DIR and PULLUP_PORT the way src/server/config.ts reads them: the
# environment first, then .env in the repo, then the defaults (~/Pullup, 4500).
read_pullup_env() {
  local node="$1" out
  out="$(cd "$REPO" && "$node" -e '
    try { process.loadEnvFile(process.env.PULLUP_ENV_FILE ?? ".env") } catch {}
    const lib = (process.env.PULLUP_LIBRARY ?? "~/Pullup").replace(/^~/, require("os").homedir())
    console.log(require("path").resolve(lib))
    console.log(Number(process.env.PORT ?? 4500))
  ')" || return 1
  PULLUP_LIBRARY_DIR="$(printf '%s\n' "$out" | sed -n 1p)"
  PULLUP_PORT="$(printf '%s\n' "$out" | sed -n 2p)"
}

# Does better-sqlite3 load under this Node? (It won't under the wrong major version.)
check_sqlite() {
  (cd "$REPO" && "$1" -e 'new (require("better-sqlite3"))(":memory:").close()' 2>&1)
}

port_in_use() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
