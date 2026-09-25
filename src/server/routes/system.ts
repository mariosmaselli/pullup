import { Hono } from 'hono'
import type { SystemInfo } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { library } from '../library.ts'
import { ffmpegVersion } from '../lib/ffmpeg.ts'
import pkg from '../../../package.json' with { type: 'json' }

export function systemRoutes(db: DB) {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n

  return new Hono().get('/', (c) => {
    const info: SystemInfo = {
      version: pkg.version,
      library: { root: library.root, inbox: library.inbox, database: library.database },
      ffmpeg: ffmpegVersion(),
      counts: {
        inbox: count('SELECT count(*) AS n FROM assets WHERE triaged_at IS NULL'),
        assets: count('SELECT count(*) AS n FROM assets'),
        projects: count("SELECT count(*) AS n FROM projects WHERE status != 'archived'"),
        ideas: count("SELECT count(*) AS n FROM ideas WHERE status IN ('suggested', 'saved')"),
        posts: count("SELECT count(*) AS n FROM posts WHERE status IN ('draft', 'review')"),
      },
    }
    return c.json(info)
  })
}
