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
| Backup | The user's machine (Time Machine etc.) | Accepted trade-off of local-first |

Not doing: hosted database, auth, cloud storage, deploys, autonomous agents, direct social publishing.

## Library folder

Configured by `PULLUP_LIBRARY` (default `~/Pullup`). Kept outside the code repo.

```
~/Pullup/
  inbox/      drop zone on disk — Shortcuts, screenshots, anything; imported by the watcher
  media/      originals after capture, by month: media/2026/09/<name>-<id>.<ext>
  cache/      per-asset thumbnails, posters, frames — safe to delete, rebuilt by Reprocess
  trash/      originals of deleted assets and inbox-folder duplicates; emptied by you, never by Pullup
  .tmp/       in-flight uploads, cleared on start
  pullup.db   all metadata
```

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

Moving the folder (e.g. into iCloud Drive for phone capture) = move it and change one env var. All
stored paths are relative to the library root.

## Data model

Schema: [src/server/db/migrations](../src/server/db/migrations). Conventions: uuid TEXT ids, ISO
timestamps, 0/1 booleans, JSON TEXT for lists; enum values mirror
[src/shared/constants.ts](../src/shared/constants.ts).

- **profiles** — identities (Mario, Nonlinear Studio) with voice guide and per-platform preferences.
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

Tasks: `analyze-asset` (fast model), `discover-ideas`, `generate-drafts`, `revise-draft` (strong model).
No agents — each task is one structured call.

## Screens

Sidebar: Inbox · Library · Projects · Ideas · Drafts · Calendar · Settings, with a global identity
switcher (All / Mario / Nonlinear). Global capture: drop anywhere, ⌘V paste, ⌘K quick capture.
Asset detail opens as a side panel. Draft editor: sources | angle options | editor with platform
preview, claims and questions, revisions.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold, SQLite schema + migrations, library folder, app shell | ✅ App runs, all views reachable, Settings reads the library |
| M1 | Capture: drop, paste, notes, links (OG fetch), inbox-folder watcher, ffmpeg posters/frames, Inbox grid | ✅ Recordings get posters + frames; pasted URLs get previews; inbox folder imports live |
| M2 | Organize: projects CRUD, assign, tags, visibility, asset side panel | A recording lives in a project, marked private |
| M3 | AI analysis: provider, `ai_runs`, analyze from frames, accept/edit suggestions | Accurate description + tags; cost logged |
| M4 | Ideas + X drafts: angles, sources, claims/questions, revise with instructions, history | **First end-to-end workflow** |
| M5 | Workflow + calendar: statuses, scheduling, copy/download, mark published + URL | A post goes draft → published |
| M6 | Instagram: story sequences, carousel outlines, vertical-crop flags, per-profile voice | One recording → X post + story sequence |
| M7 | Capture from anywhere: iCloud inbox folder + Apple Shortcut | Share from iPhone lands in the Inbox |
| M8 | Discovery + digests: what can I post, unused material, stale projects, weekly digest | Suggestions cite sources, avoid repeats |

First workflow to validate: **drop a screen recording → assign project → analyze → 3–5 ideas with
sources → X drafts in 2–3 angles → edit → save.**
