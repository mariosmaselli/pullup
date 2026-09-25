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
import { createPostStore } from './services/posts.ts'
import { createAi, defaultProvider } from './ai/index.ts'
import { AiError, type AiProvider } from './ai/provider.ts'
import { notify } from './lib/events.ts'
import { systemRoutes } from './routes/system.ts'
import { profileRoutes } from './routes/profiles.ts'
import { assetRoutes } from './routes/assets.ts'
import { eventRoutes } from './routes/events.ts'
import { projectRoutes } from './routes/projects.ts'
import { ideaRoutes } from './routes/ideas.ts'
import { postRoutes } from './routes/posts.ts'

// Serves one library subfolder (media/ or cache/). Nothing else in the library is reachable —
// serveStatic also rejects `..` and dot segments.
const libraryFiles = (folder: 'media' | 'cache'): MiddlewareHandler => {
  const prefix = `/api/files/${folder}`
  const serve = serveStatic({
    root: library[folder],
    rewriteRequestPath: (path) => path.slice(prefix.length),
  })
  return async (c, next) => {
    const res = await serve(c, next)
    if (!res) return
    // Hono's MIME table lacks some capture formats (.mov, .heic…).
    const mime = mimeFromName(c.req.path)
    if (mime) res.headers.set('Content-Type', mime)
    res.headers.set('Cache-Control', 'private, max-age=31536000, immutable')
    return res
  }
}

export function createApp(db: DB, options: { provider?: AiProvider } = {}) {
  const assets = createAssetStore(db)
  const projects = createProjectStore(db)
  const processor = createProcessor(assets)
  const capture = createCapture(assets, processor)
  const ideas = createIdeaStore(db)
  const posts = createPostStore(db)
  const ai = createAi({
    db,
    assets,
    provider: options.provider ?? defaultProvider(),
    notify: () => {
      notify('assets')
      notify('ideas')
      notify('posts')
    },
  })

  const api = new Hono()
    .use('/files/media/*', libraryFiles('media'))
    .use('/files/cache/*', libraryFiles('cache'))
    .route('/system', systemRoutes(db, ai))
    .route('/profiles', profileRoutes(db))
    .route('/assets', assetRoutes({ assets, projects, capture, processor, ai }))
    .route('/ideas', ideaRoutes(ideas, ai))
    .route('/posts', postRoutes(posts, ai))
    .route('/projects', projectRoutes(projects))
    .route('/events', eventRoutes())
    .all('*', (c) => c.json({ error: 'Not found' }, 404))

  const app = new Hono().route('/api', api)

  app.onError((err, c) => {
    if (err instanceof CaptureError) return c.json({ error: err.message }, err.status)
    if (err instanceof AiError) return c.json({ error: err.message }, err.status)
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400)
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'Internal error' }, 500)
  })

  return { app, assets, projects, capture, processor, ai }
}
