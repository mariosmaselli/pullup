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
import { systemRoutes } from './routes/system.ts'
import { profileRoutes } from './routes/profiles.ts'
import { assetRoutes } from './routes/assets.ts'
import { eventRoutes } from './routes/events.ts'

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

export function createApp(db: DB) {
  const assets = createAssetStore(db)
  const processor = createProcessor(assets)
  const capture = createCapture(assets, processor)

  const api = new Hono()
    .use('/files/media/*', libraryFiles('media'))
    .use('/files/cache/*', libraryFiles('cache'))
    .route('/system', systemRoutes(db))
    .route('/profiles', profileRoutes(db))
    .route('/assets', assetRoutes({ assets, capture, processor }))
    .route('/events', eventRoutes())
    .all('*', (c) => c.json({ error: 'Not found' }, 404))

  const app = new Hono().route('/api', api)

  app.onError((err, c) => {
    if (err instanceof CaptureError) return c.json({ error: err.message }, err.status)
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400)
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: 'Internal error' }, 500)
  })

  return { app, assets, capture, processor }
}
