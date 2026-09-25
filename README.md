# Pullup

Personal content operating system — capture work material, organize it into projects, turn it into
X and Instagram posts, and keep a record of what's been published. Runs locally.

## Setup

Requires Node 22+, pnpm and ffmpeg (`brew install ffmpeg`).

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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and milestones.
