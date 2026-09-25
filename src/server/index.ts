import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'
import { watchInbox } from './services/inbox-watcher.ts'

ensureLibrary()
const db = openDatabase()
const { app, capture, processor } = createApp(db)

if (config.isProduction) {
  app.use('/*', serveStatic({ root: './dist' }))
  // SPA fallback: any non-API route renders the app.
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

processor.resume()
const watcher = watchInbox(capture)

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`[api] http://localhost:${info.port} · library ${library.root}`)
})

const shutdown = () => {
  watcher.close()
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
