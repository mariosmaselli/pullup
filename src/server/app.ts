import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { z } from 'zod'
import type { DB } from './db/index.ts'
import { library } from './library.ts'
import { mimeFromName } from './lib/files.ts'
import { createAssetStore } from './services/assets.ts'
import { CaptureError, createCapture } from './services/capture.ts'
import { createProcessor } from './services/processing.ts'
import { createProjectStore } from './services/projects.ts'
import { createIdeaStore } from './services/ideas.ts'
import { createPostStore, PostRuleError } from './services/posts.ts'
import { createRenderStore } from './services/renders.ts'
import { createAi, providerFor, type ProviderFactory } from './ai/index.ts'
import { createKeyManager, verifyWithAnthropic, type KeyVerifier } from './ai/key.ts'
import { config } from './config.ts'
import { localOnly } from './lib/request-guard.ts'
import { AiError, type AiProvider } from './ai/provider.ts'
import { notify } from './lib/events.ts'
import { systemRoutes } from './routes/system.ts'
import { profileRoutes } from './routes/profiles.ts'
import { assetRoutes } from './routes/assets.ts'
import { eventRoutes } from './routes/events.ts'
import { projectRoutes } from './routes/projects.ts'
import { ideaRoutes } from './routes/ideas.ts'
import { postRoutes } from './routes/posts.ts'
import { settingsRoutes } from './routes/settings.ts'
import { renderRoutes } from './routes/renders.ts'

const FONT_MIME: Record<string, string> = {
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

// Serves one library subfolder (media/, cache/ or fonts/). Nothing else in the library is
// reachable — serveStatic also rejects `..` and dot segments.
const libraryFiles = (folder: 'media' | 'cache' | 'fonts'): MiddlewareHandler => {
  const prefix = `/api/files/${folder}`
  const serve = serveStatic({
    root: library[folder],
    rewriteRequestPath: (path) => path.slice(prefix.length),
  })
  return async (c, next) => {
    const res = await serve(c, next)
    if (!res) return
    // Hono's MIME table lacks some capture formats (.mov, .heic…).
    const mime =
      mimeFromName(c.req.path) ?? FONT_MIME[c.req.path.split('.').pop()?.toLowerCase() ?? '']
    if (mime) res.headers.set('Content-Type', mime)
    res.headers.set('Cache-Control', 'private, max-age=31536000, immutable')
    // Library files are content, never code: opened directly (e.g. a captured SVG in its own
    // tab), they can't run script on Pullup's origin.
    res.headers.set('X-Content-Type-Options', 'nosniff')
    res.headers.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
    )
    return res
  }
}

interface AppOptions {
  // Fixed provider (tests). Otherwise one is built from the configured API key.
  provider?: AiProvider
  providerFactory?: ProviderFactory
  verifyKey?: KeyVerifier
}

export function createApp(db: DB, options: AppOptions = {}) {
  const assets = createAssetStore(db)
  const projects = createProjectStore(db)
  const processor = createProcessor(assets)
  const capture = createCapture(assets, processor)
  const ideas = createIdeaStore(db)
  const posts = createPostStore(db)
  const renders = createRenderStore(db)
  renders.failStale()
  const keys = createKeyManager({
    verify: options.verifyKey ?? verifyWithAnthropic,
    onChange: (apiKey) => ai.setProvider(providerFor(apiKey, options.providerFactory)),
  })
  const ai = createAi({
    db,
    assets,
    provider: options.provider ?? providerFor(keys.key, options.providerFactory),
    notify: () => {
      notify('assets')
      notify('ideas')
      notify('posts')
    },
  })

  const api = new Hono()
    .use('*', localOnly([config.publicPort, config.port]))
    .use('/files/media/*', libraryFiles('media'))
    .use('/files/cache/*', libraryFiles('cache'))
    .use('/files/fonts/*', libraryFiles('fonts'))
    .route('/system', systemRoutes(db, ai, keys))
    .route('/settings', settingsRoutes(keys))
    .route('/renders', renderRoutes(renders))
    .route('/profiles', profileRoutes(db))
    .route('/assets', assetRoutes({ assets, projects, capture, processor, ai }))
    .route('/ideas', ideaRoutes(ideas, ai))
    .route('/posts', postRoutes(posts, ai, renders))
    .route('/projects', projectRoutes(projects))
    .route('/events', eventRoutes())
    .all('*', (c) => c.json({ error: 'Not found' }, 404))

  const app = new Hono().route('/api', api)

  app.onError((err, c) => {
    if (err instanceof CaptureError) return c.json({ error: err.message }, err.status)
    if (err instanceof AiError) return c.json({ error: err.message }, err.status)
    if (err instanceof PostRuleError) {
      return c.json({ error: err.message, assetIds: err.assetIds }, err.status)
    }
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400)
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'Internal error' }, 500)
  })

  return { app, assets, projects, capture, processor, ai, keys }
}
