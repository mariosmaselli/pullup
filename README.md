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
`pullup.db`. Back it up like any other folder.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and milestones.
