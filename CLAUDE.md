# Pullup — agent guide

Personal content OS for Mario (Nonlinear Studio). **Local-only**: React SPA + Hono server + SQLite,
running on `localhost:4500`. Full plan and milestones → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Doctrine — do not violate

- **Local-first.** No hosted database, auth, cloud storage or deploys unless Mario asks.
- **Code and content are separate.** Media and `pullup.db` live in the library folder
  (`PULLUP_LIBRARY`, default `~/Pullup`), never in this repo. Store paths relative to the library root.
- **Originals are never modified or hard-deleted.** Deleting moves them to `<library>/trash/`.
  Derivatives go in `cache/<asset id>/` and must be rebuildable.
- **Every asset write goes through the asset store** so change events reach the UI.
- **AI assists, never invents.** AI output is stored separately from user metadata, cites its source
  assets, marks claims as `source` / `framing` / `unconfirmed`, and every call is logged in `ai_runs`.
- **Privacy is enforced in code.** Assets are `private` until approved; a post can't be approved with
  private media; projects with `ai_allowed = 0` never reach the AI provider.
- **Styling:** Tailwind = structural layout only (flex, sizing, breakpoints). Everything visual lives in
  a co-located `.scss` whose root class is the kebab-cased component name. Type via `-t1 -t2 -p -p1 -meta`
  in [styles/utilities/_typography.scss](src/client/styles/utilities/_typography.scss); colors via tokens in
  [styles/variables/_tokens.scss](src/client/styles/variables/_tokens.scss). Global sheet is `@layer base`;
  component SCSS is unlayered and wins.
- **AI calls go through `runAi`** (logs `ai_runs`) and a task in `ai/tasks/`. Change a prompt by adding
  `prompt.vN+1.md`, not editing the old one. Tests use a fake provider — never the real API.
- **The API is local-only and same-origin.** `lib/request-guard.ts` rejects non-localhost Hosts and
  any foreign Origin; Vite runs with `cors: false`. Library files are served with a sandbox CSP. Don't
  add CORS or routes that change state on GET.
- **The Anthropic key never leaves the server.** It lives in `.env` (0600), set via Settings
  (`ai/key.ts`); the API only returns a hint. Tests use a throwaway `.env` (`PULLUP_ENV_FILE`).
- **Templates follow the contract** in `src/shared/template.ts`: time only from `t`, pure `update()`,
  GSAP only via `ctx.timeline()`, opaque sRGB output. Rendering runs in a worker; never on the main thread.
- **Dependencies must earn their place.** Ask before adding one.

## Map

| Concern | Where |
|---|---|
| Server entry (listen, watcher, prod static) | [src/server/index.ts](src/server/index.ts) |
| App factory, routes, file serving, error mapping | [src/server/app.ts](src/server/app.ts) |
| Asset rows ↔ API shape | [src/server/services/assets.ts](src/server/services/assets.ts) |
| Import / link / note / delete | [src/server/services/capture.ts](src/server/services/capture.ts) |
| Thumbnails, frames, link previews | [src/server/services/processing.ts](src/server/services/processing.ts) |
| `inbox/` folder watcher | [src/server/services/inbox-watcher.ts](src/server/services/inbox-watcher.ts) |
| Change events (SSE) | [src/server/lib/events.ts](src/server/lib/events.ts), [src/client/lib/events.ts](src/client/lib/events.ts) |
| Client capture (upload queue, paste, drop) | [src/client/lib/capture.tsx](src/client/lib/capture.tsx), [GlobalCapture](src/client/components/GlobalCapture/GlobalCapture.tsx) |
| AI tasks, prompts, context, provider | [src/server/ai/](src/server/ai) — `index.ts` lists the operations |
| Ideas / posts storage | [src/server/services/ideas.ts](src/server/services/ideas.ts), [posts.ts](src/server/services/posts.ts) |
| Draft editor (shell / X+LinkedIn / Instagram frames) | [src/client/features/draft/](src/client/features/draft) |
| Post status rules (private media, scheduling, published) | `update()` in [src/server/services/posts.ts](src/server/services/posts.ts) |
| Publish panel / calendar | [PublishPanel](src/client/features/draft/PublishPanel.tsx), [src/client/features/calendar/](src/client/features/calendar) |
| Platform rules (AI) + editor rules (UI) — keep in step | [src/server/ai/prompts/platforms.md](src/server/ai/prompts/platforms.md), [src/client/lib/platforms.ts](src/client/lib/platforms.ts) |
| Template contract (types + rules) | [src/shared/template.ts](src/shared/template.ts), authoring guide [templates/README.md](templates/README.md) |
| Templates (one folder each) | [templates/](templates) |
| Render engine (worker, session, media, encoder) | [src/client/render/](src/client/render) |
| Renders (storage, output checks) | [src/server/services/renders.ts](src/server/services/renders.ts) |
| Env config | [src/server/config.ts](src/server/config.ts), `.env` |
| Library paths | [src/server/library.ts](src/server/library.ts) |
| DB + migration runner | [src/server/db/index.ts](src/server/db/index.ts) |
| Schema (add `NNN_name.sql`, never edit applied ones; a table rebuild starts with `-- migrate:foreign-keys-off`; the DB is backed up to `<library>/backups/` before migrating) | [src/server/db/migrations/](src/server/db/migrations) |
| Enums shared by DB/API/UI | [src/shared/constants.ts](src/shared/constants.ts) |
| API types | [src/shared/types.ts](src/shared/types.ts) |
| Routes | [src/client/router.tsx](src/client/router.tsx) |
| Data hooks | [src/client/lib/queries.ts](src/client/lib/queries.ts) |
| Views | `src/client/features/<view>/` |
| Shared UI | `src/client/components/<Name>/<Name>.tsx + .scss` |

## Conventions

- TypeScript strict. Relative imports inside client/server; `@shared/*` for shared code. Import `.ts`
  files with their extension.
- DB rows are snake_case; API JSON is camelCase — map in the route (see `routes/profiles.ts`).
- API errors are `{ error: string }` with a proper status.
- Prettier: no semicolons, single quotes, 100 cols (`pnpm format`).

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Vite on 4500 + API on 4501 (proxied) |
| `pnpm build` | Typecheck + build SPA to `dist/` |
| `pnpm start` | Production: one server on 4500 serving app + API |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest — server tests run against a throwaway library in the OS temp dir |

Preview in Claude: `preview_start` with name `pullup` (defined in `tools/.claude/launch.json`).
