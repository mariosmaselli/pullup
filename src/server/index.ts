import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { systemRoutes } from './routes/system.ts'
import { profileRoutes } from './routes/profiles.ts'

ensureLibrary()
const db = openDatabase()

const api = new Hono()
  .route('/system', systemRoutes(db))
  .route('/profiles', profileRoutes(db))
  .all('*', (c) => c.json({ error: 'Not found' }, 404))

const app = new Hono().route('/api', api)

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal error' }, 500)
})

if (config.isProduction) {
  app.use('/*', serveStatic({ root: './dist' }))
  // SPA fallback: any non-API route renders the app.
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`[api] http://localhost:${info.port} · library ${library.root}`)
})

const shutdown = () => {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
