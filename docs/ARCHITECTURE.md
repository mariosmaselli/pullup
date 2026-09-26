# Pullup — Architecture

Personal content operating system: **Capture → Organize → Discover → Create → Publish → Learn.**
Internal tool for one person, running locally on one Mac. Decisions below were agreed on 2026-09-25.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Runtime | Local only — a web UI on `localhost:4500` served by a local Node server | Material already lives on the Mac; no uploads, no hosting, client files never leave the machine |
| Frontend | React + TypeScript SPA (Vite), TanStack Router + Query | Almost every view is interactive and shares state (drop zone, selection, drafting). Astro's strengths (static, low-JS) don't apply |
| Backend | Hono on Node, same repo, one process in production | Holds secrets (AI key), filesystem and ffmpeg access |
| Data | SQLite (`better-sqlite3`), one file: `<library>/pullup.db` | Zero setup, real relations and queries, backed up with the folder |
| Files | The library folder is the source of truth for media | Originals are preserved untouched; derivatives are rebuildable |
| Video | Local `ffmpeg` for posters, frames, metadata | Handles every codec; frames are what AI analysis reads |
| AI | Thin provider interface, Anthropic first; one module per task | Swappable provider, versioned prompts, structured output, every call logged |
| Styling | Tailwind = layout only; co-located SCSS per component | Same doctrine as the stellar template |
| Backup | Daily + on-demand `VACUUM INTO` snapshots of the DB in `<library>/backups` (14 kept, plus one before every migration); the library folder itself via the user's machine (Time Machine etc.) | Accepted trade-off of local-first |
| Identity | One identity for now: Mario. Profiles table kept; editable "Writing voice" in Settings | Decided 2026-09-25. Profiles return later as connected accounts (X, Instagram, maybe LinkedIn) when direct posting is built |
| API key | Pasted in Settings → verified via the Models API → saved to `pullup/.env` (0600); hot-swapped, never returned to the browser | No restarts, no copying keys around |
| Local security | Host + Origin guard on `/api`, no CORS, sandbox CSP on library files, raster-only link images | Other sites/tabs can't read or change local data |
| Running | `pnpm dev` while working on it; otherwise a LaunchAgent runs production mode at login (`scripts/install-launcher.sh`) with the Node from `.node-version` | No terminal needed; better-sqlite3 only loads on Node 22 |
| Deleting | Nothing is deleted by Pullup: deletes and "Clean up old renders" move files to `trash/`; only Mario's "Empty trash" deletes | Originals are irreplaceable; renders are cheap to keep until he decides |

Not doing: hosted database, auth, cloud storage, deploys, autonomous agents, direct social publishing.

## Library folder

Configured by `PULLUP_LIBRARY` (default `~/Pullup`). Kept outside the code repo.

```
~/Pullup/
  inbox/      drop zone on disk — Shortcuts, screenshots, anything; imported by the watcher
  media/      originals after capture, by month: media/2026/09/<name>-<id>.<ext>
    renders/  template outputs (MP4/JPEG + poster, GIF/WebP exports), by month — never in the Library
  cache/      per-asset thumbnails, posters, frames, video proxies — all rebuildable: missing
              thumbnails/previews are rebuilt on start (or POST /api/assets/repair), a missing
              video proxy the next time a template reads the video
  fonts/      font files templates load (licensed ones, e.g. PP Neue Montreal, never go in the repo)
  trash/      deleted originals, inbox-folder duplicates, Studio-deleted render files, and
    renders/<render id>/  renders moved by "Clean up old renders", with their record (render.json)
              — emptied by you (Trash → Empty trash), never by Pullup
  backups/    database snapshots: daily, "Back up now", and one before every migration
  logs/       pullup.log when started by the LaunchAgent
  .tmp/       in-flight uploads, cleared on start
  pullup.db   all metadata (+ -wal / -shm while running)
```

The library, and above all `pullup.db`, stays on a local disk. SQLite in a synced folder
(iCloud Drive, Dropbox) loses data: sync uploads the database without its `-wal` file, and a
second copy or an evicted file corrupts it. See M10 for phone capture.

## Capture pipeline (M1)

- **Entry points:** drop anywhere (files or dragged links), ⌘V paste anywhere (images, URLs, text),
  ⌘K quick capture (note or link), and the `inbox/` folder watcher.
- **Uploads** stream raw to `POST /api/assets/upload` (no multipart, no memory buffering), hashed on
  the way in. SHA-256 dedupes: a duplicate returns the existing asset.
- **Inbox folder:** a file is imported once its size stops changing; dotfiles and partial downloads
  are ignored; unsupported types are left in place. Capture date = earlier of mtime and birthtime.
- **Processing queue** (in-process, 2 at a time, resumed on restart) writes to `cache/<asset id>/`:
  images → `thumb.jpg` (720 w); videos → 6 evenly spaced `frame-N.jpg` (1280 w, for AI), `poster.jpg`,
  `thumb.jpg`; links → Open Graph metadata + preview image. HEIC/HEIF go through macOS `sips`
  (ffmpeg only decodes one 512 px tile) and get a `poster.jpg` because browsers can't show HEIC.
- **Files** are served from `/api/files/{media,cache}/…` only, with byte ranges so video can seek.
- **Live updates:** the server pushes change events over SSE (`/api/events`, 10 s heartbeat); the
  client refreshes queries, reconnects with backoff, and refetches on reconnect.
- **Delete** moves the original to `trash/` and drops the cache; refused if the asset is used in a post.

All stored paths are relative to the library root, so the whole library can move to another local
disk by moving it and changing `PULLUP_LIBRARY`. It must not move into iCloud Drive (see above).

**Phone capture plan (M10): only the inbox moves to iCloud.** A new `PULLUP_INBOX` setting points
the watcher at a folder in iCloud Drive (e.g. `~/Library/Mobile Documents/com~apple~CloudDocs/Pullup
Inbox`); everything else, including `pullup.db`, stays in the local library. The watcher then has
to handle iCloud placeholders: a `.name.ext.icloud` file means "not downloaded yet" — ask for the
download (`brctl download`) and import once the real file appears, instead of ignoring it as a
dotfile (today's behaviour). Imports move files out of the iCloud folder into `media/` as usual.

## Data model

Schema: [src/server/db/migrations](../src/server/db/migrations). Conventions: uuid TEXT ids, ISO
timestamps, 0/1 booleans, JSON TEXT for lists; enum values mirror
[src/shared/constants.ts](../src/shared/constants.ts).

- **profiles** — the identity drafts are written as. Only `mario` is used (see `services/profiles.ts`);
  the seeded `nonlinear` row is dormant until connected accounts exist.
- **projects** — status, tags, `is_client_work`, `ai_allowed` (off by default for client work).
- **assets** — image / video / link / note. `project_id NULL` = unassigned. `triaged_at NULL` = in
  the Inbox. `visibility` is `private` until explicitly `approved` for public use. Checksum dedupes.
- **asset_derivatives** — thumb / poster / frame / og_image files in `cache/`.
- **asset_analyses** — AI suggestions, stored apart from metadata you entered yourself.
- **collections** + **collection_assets** — many-to-many groupings, optionally within a project.
- **ideas** + **idea_sources** — post concepts with angle, rationale and the assets they cite.
- **posts** — one platform-specific piece of content through its whole life:
  `draft → review → approved → scheduled → published` (+ `archived`, `discarded`). Holds
  `scheduled_for`, `published_at`, `public_url`. Replaces separate drafts/scheduled/published tables.
- **post_revisions** — full text history; `segments` (thread posts, story frames, carousel slides),
  `claims` (each marked `source` / `framing` / `unconfirmed`), `questions` for missing details.
- **post_media** — assets per post segment. Assets are referenced, never copied.
- **ai_runs** — every AI call: task, prompt version, model, input refs, tokens, cost, output.

Rules the app enforces (not just conventions):
- A post cannot move to `approved` while any of its media is `private`.
- Assets of a project with `ai_allowed = 0` are never sent to the AI provider.
- AI never overwrites user-entered metadata; suggestions are accepted explicitly.

## AI layer (from M3)

```
src/server/ai/
  provider.ts                 interface: generate structured output from text + images
  providers/anthropic.ts
  tasks/<task>/prompt.v1.md   versioned prompt
  tasks/<task>/schema.ts      structured output schema
  tasks/<task>/index.ts       builds input, calls provider, logs ai_runs, returns typed result
```

Tasks (all Claude Opus 5, effort per task): `analyze-asset` (low), `generate-ideas` (medium),
`draft-post` (high, 2–3 angles), `revise-post` (high). No agents — each task is one structured
call via `messages.parse` + Zod, with server-side refusal fallback (`fallbacks: "default"`).
Shared voice and ground rules live in `ai/prompts/voice.md`; each task has `prompt.vN.md`.
`ai/context.ts` builds the input: Mario's titles/notes labelled as authoritative, earlier AI output
labelled unverified, and images (originals ≤3.5 MB, else 1600 px JPEG; up to 4–6 video frames).
Idea sources and claim citations are validated against the assets actually sent.

## Screens

Sidebar: Inbox · Library · Projects · Ideas · Drafts · Templates · Calendar, and Trash · Settings
at the bottom (counts: Inbox, open ideas, open drafts, posts due). There is one identity (Mario),
so there's no identity switcher. Global capture: drop anywhere, ⌘V paste, ⌘K quick capture.

- **Inbox / Library / Project** — asset grids; asset detail opens as a side panel (metadata,
  visibility, project, AI analysis, post ideas).
- **Ideas** — suggested and saved ideas with their sources; Write turns one into drafts.
- **Draft editor** — sources | one tab per platform drafted from the idea (X, LinkedIn, IG story,
  IG carousel) with its editor (text posts, or frames/slides with a template each and their
  renders), claims and questions, revise with an instruction, revisions | publish panel (status,
  media approval, schedule, mark published + URL). No "angle options" column: each draft carries
  the angle it was written in.
- **Templates** — the template list and a Studio per template (inputs, live preview, render,
  GIF / WebP export).
- **Calendar** — month view of scheduled and published posts; due posts are flagged.
- **Trash** — what's in `trash/`, with Restore where possible and Empty trash (see Housekeeping).
- **Settings** — AI key and model, AI spend, writing voice, platform styles, backups, storage,
  fonts, library paths.

## Housekeeping

- **Storage** (`services/storage.ts`, `GET /api/storage`) — sizes of originals, renders, GIF/WebP
  exports, cache, trash, backups and the database, plus free disk space.
- **Clean up old renders** — `GET /api/storage/cleanup` previews; `POST` with the previewed ids
  moves them. Eligible: older than 7 days, not the render any frame of any post currently uses
  (`renderForFrame`, the same rule as the editor and "Download all"), not linked to a published
  post. Each goes to `trash/renders/<id>/` with its MP4/JPEG, poster, GIF/WebP exports and its DB
  row as `render.json`; the row is then deleted.
- **Trash** (`GET /api/storage/trash`, `POST …/restore`, `POST …/empty`) —
  - a deleted original comes back through `capture.importFile` as a new asset in the Inbox (its
    title, notes, project and analysis were deleted with the old row); refused if the same file
    is already in the library;
  - a cleaned-up render comes back with its record (unlinked if its post is gone), refused if
    something now occupies its path;
  - a Studio-deleted render file (`render-<id8>-…`) can't come back unless its record still
    exists: its record was deleted;
  - Empty trash deletes exactly the items the page listed, after a confirm.
- **Fonts** — Settings compares every `meta.fonts` file of the installed templates with
  `GET /api/system/fonts` (the files in `<library>/fonts`).
- **AI spend** — `GET /api/system/ai-usage`: calls (and failures), tokens and cost from `ai_runs`
  per month (local time) and per task.
- **Running without a terminal** — `scripts/install-launcher.sh` installs the `local.pullup`
  LaunchAgent: `scripts/launch.sh` picks Node from `.node-version`, sets a PATH with Homebrew,
  rebuilds `dist/` when `scripts/dist-stamp.mjs` says it's stale, waits for the port, and runs the
  server (logs in `<library>/logs`). `pnpm start` refuses a stale `dist/`.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold, SQLite schema + migrations, library folder, app shell | ✅ App runs, all views reachable, Settings reads the library |
| M1 | Capture: drop, paste, notes, links (OG fetch), inbox-folder watcher, ffmpeg posters/frames, Inbox grid | ✅ Recordings get posters + frames; pasted URLs get previews; inbox folder imports live |
| M2 | Organize: projects CRUD, assign, tags, visibility, asset side panel | ◐ Projects, assignment, visibility, client-work AI default done; tags + filters later |
| M3 | AI analysis: provider, `ai_runs`, analyze from frames, accept/edit suggestions | ✅ Built, tested with a fake provider, run live |
| M4 | Ideas + X drafts: angles, sources, claims/questions, revise with instructions, history | ✅ **First end-to-end workflow**, run live |
| M5 | Workflow + calendar: statuses, scheduling, copy/download, mark published + URL | ✅ Folded into M9 |
| M6 | Multi-platform drafts: one idea → X, LinkedIn, IG story frames, IG carousel slides + caption; platform styles in Settings | ✅ Frames/slides carry their own media; editor per platform |
| M7 | Template engine: WebGL/Three.js/GSAP/canvas templates in a worker, frame-stepped MP4 (WebCodecs + Mediabunny) and JPEG export, video proxies, render checks; Templates studio | ✅ 6 s 1080×1920 WebGL video in ~1 s; Text story matches Mario's reference; 9 templates (stills, text, slideshow, shader transitions, 3D planes, device frames) |
| M8 | Story/carousel builder: templates per frame/slide in the draft editor, render into the post | ✅ Pick a template per frame, render one/all, download the frames as a zip |
| M9 | Publishing by hand: calendar, download per platform, mark published + URL | ✅ Approve media → schedule (panel or drag on the calendar) → mark published with the link; posts listed per project |
| M10 | Capture from anywhere: `PULLUP_INBOX` in iCloud Drive (only the inbox — the library and DB stay local) + iCloud placeholder downloads + Apple Shortcut | Share from iPhone lands in the Inbox |
| H1 | Housekeeping: storage view, old-render cleanup, trash page, fonts check, AI spend per month/task, LaunchAgent | ✅ Nothing is deleted without Empty trash; `scripts/install-launcher.sh` (not installed yet) runs it at login |
| M11 | Discovery + digests: what can I post, unused material, stale projects, weekly digest | Suggestions cite sources, avoid repeats |
| Later | Connected accounts + direct posting: LinkedIn → X → Instagram (see docs/research/publishing-apis.md) | |

First workflow to validate: **drop a screen recording → assign project → analyze → 3–5 ideas with
sources → X drafts in 2–3 angles → edit → save.**
