# Pullup

Personal content operating system — capture work material, organize it into projects, turn it into
X and Instagram posts, and keep a record of what's been published. Runs locally.

## Setup

Requires Node 22 (see `.node-version` — better-sqlite3 crashes on Node 20), pnpm and ffmpeg
(`brew install ffmpeg`).

```bash
pnpm install
cp .env.example .env   # set PULLUP_LIBRARY if not ~/Pullup
pnpm dev               # http://localhost:4500
```

The library folder (`~/Pullup` by default) is created on first run and holds your media and
`pullup.db`. Pullup snapshots the database into `~/Pullup/backups/` once a day while it runs (and
on demand in Settings); back the whole library folder up with Time Machine or another drive. To
restore, quit Pullup and replace `pullup.db` with a snapshot — don't copy the live `pullup.db` by
hand, recent changes may still be in its `-wal` file.

Keep the library on a local disk. Don't move it (or `pullup.db`) into iCloud Drive, Dropbox or any
synced folder: syncing a live SQLite database loses data. Only the `inbox/` folder is meant to be
able to live in iCloud later, for phone capture (M10).

## Fonts

The templates set type in **PP Neue Montreal** (Pangram Pangram). It's a licensed font, so it's
never in this repo: templates load it from `<library>/fonts/` (`~/Pullup/fonts/`). Put these files
there, named exactly like this:

- `PPNeueMontreal-Regular.ttf`
- `PPNeueMontreal-Medium.otf`

**Settings → Fonts** lists every file the installed templates ask for (`fonts` in each template's
`meta.ts`) and whether it's in the folder. A template whose font is missing can't render ("Font
file not found in the library").

## Running without a terminal

`pnpm dev` needs a terminal open. To have Pullup running whenever you're logged in, install the
LaunchAgent once:

```bash
scripts/install-launcher.sh --dry-run   # check Node, pnpm, ffmpeg, library; print the plist
scripts/install-launcher.sh             # install and start it
scripts/uninstall-launcher.sh           # stop it and remove it
```

It runs `scripts/launch.sh` at login, from this folder, in production mode on
http://localhost:4500 (one server, no Vite):

- **Node** — the one `.node-version` asks for (22), found among `n`, nvm, fnm, volta, asdf and
  Homebrew `node@22` installs, never whatever `node` comes first on a PATH. The installer checks
  that better-sqlite3 loads with it.
- **PATH** — Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) for pnpm and ffmpeg, plus the
  system folders (`sips` for HEIC).
- **Build** — if the code changed since `dist/` was built, it runs `pnpm build` first. If the build
  fails it logs why and stays stopped (fix it, then `launchctl kickstart -k gui/$(id -u)/local.pullup`).
- **Port** — if something already listens on 4500 (e.g. `pnpm dev`), it waits until it's free.
- **Logs** — `<library>/logs/pullup.log` (rotated at 10 MB); `launchd.log` next to it only catches
  failures before the script starts logging.
- **Crashes** restart it (after 30 s); a clean stop stays stopped:
  `launchctl kill TERM gui/$(id -u)/local.pullup` to stop,
  `launchctl kickstart -k gui/$(id -u)/local.pullup` to (re)start.

Stop the launcher before working with `pnpm dev` — both want port 4500 (or run the dev server on
another `PORT`). macOS may show "Background Items Added" for `bash`: leave it allowed under Login
Items, or it won't start at login. After changing `PULLUP_LIBRARY` or `PORT` in `.env`, run the
installer again.

`pnpm start` refuses to serve an out-of-date `dist/`: `pnpm build` records what it was built from
(`dist/.build-stamp.json`) and `pnpm start` checks it. `pnpm start:fresh` builds when needed, then
starts.

## Housekeeping

- **Settings → Storage** — how much space originals, renders, GIF / WebP exports, cache, trash,
  backups and the database take. **Clean up old renders** shows what it would move first: renders
  older than 7 days that no frame currently uses and no published post links to, with their
  exports. They go to the trash with their record, so they can be restored.
- **Trash** (sidebar) — deleted originals and cleaned-up renders. Restore brings an original back
  as a new asset in the Inbox (its title, notes and project were deleted with it) and puts a render
  back exactly as it was. **Empty trash** is the only thing in Pullup that deletes files for good,
  and only after you confirm.
- **Settings → AI spend** — calls, tokens and cost per month and per task, from the `ai_runs` log.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and milestones.
