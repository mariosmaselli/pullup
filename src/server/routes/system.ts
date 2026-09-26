import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { SystemInfo } from '@shared/types.ts'
import type { AiSpend, AiUsage, FontFolder } from '@shared/storage.ts'
import type { DB } from '../db/index.ts'
import type { Ai } from '../ai/index.ts'
import type { KeyManager } from '../ai/key.ts'
import type { Backups } from '../services/backups.ts'
import { library } from '../library.ts'
import { ffmpegVersion } from '../lib/ffmpeg.ts'
import pkg from '../../../package.json' with { type: 'json' }

interface SpendRow {
  month: string
  task: string
  calls: number
  failed: number
  tokensIn: number
  tokensOut: number
  costUsd: number
}

const spend = (rows: AiSpend[]): AiSpend =>
  rows.reduce<AiSpend>(
    (sum, r) => ({
      calls: sum.calls + r.calls,
      failed: sum.failed + r.failed,
      tokensIn: sum.tokensIn + r.tokensIn,
      tokensOut: sum.tokensOut + r.tokensOut,
      costUsd: sum.costUsd + r.costUsd,
    }),
    { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }
  )

const groupBy = <K extends string>(rows: SpendRow[], key: (r: SpendRow) => K) => {
  const groups = new Map<K, SpendRow[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return groups
}

// AI spend from ai_runs, by month (the Mac's local time) and by task. Every call counts, failed
// ones too — whatever cost was logged for them is included.
export function aiUsage(db: DB): AiUsage {
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at, 'localtime') AS month, task,
         count(*) AS calls,
         sum(error IS NOT NULL) AS failed,
         coalesce(sum(tokens_in), 0) AS tokensIn,
         coalesce(sum(tokens_out), 0) AS tokensOut,
         coalesce(sum(cost_usd), 0) AS costUsd
       FROM ai_runs GROUP BY month, task`
    )
    .all() as SpendRow[]
  const byCost = (a: AiSpend, b: AiSpend) => b.costUsd - a.costUsd || b.calls - a.calls
  return {
    total: spend(rows),
    months: [...groupBy(rows, (r) => r.month)]
      .map(([month, group]) => ({ month, ...spend(group) }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    tasks: [...groupBy(rows, (r) => r.task)]
      .map(([task, group]) => ({ task, ...spend(group) }))
      .sort(byCost),
    monthTasks: rows
      .map(({ month, task, ...totals }) => ({ month, task, ...spend([totals]) }))
      .sort((a, b) => b.month.localeCompare(a.month) || byCost(a, b)),
  }
}

export function systemRoutes(db: DB, ai: Ai, keys: KeyManager, backups: Backups) {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n

  return (
    new Hono()
      .get('/', (c) => {
        const info: SystemInfo = {
          version: pkg.version,
          library: { root: library.root, inbox: library.inbox, database: library.database },
          ffmpeg: ffmpegVersion(),
          ai: {
            enabled: ai.enabled,
            key: keys.status(),
            runs: count('SELECT count(*) AS n FROM ai_runs WHERE error IS NULL'),
            costUsd: (
              db.prepare('SELECT coalesce(sum(cost_usd), 0) AS n FROM ai_runs').get() as {
                n: number
              }
            ).n,
          },
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

      .get('/backups', (c) => c.json(backups.status()))

      .get('/ai-usage', (c) => c.json(aiUsage(db)))

      // Font files in <library>/fonts. Settings compares them with what the templates need.
      .get('/fonts', async (c) => {
        const names = await readdir(library.fonts).catch(() => [] as string[])
        const files: FontFolder['files'] = []
        for (const name of names.filter((n) => !n.startsWith('.')).sort()) {
          const file = await stat(join(library.fonts, name)).catch(() => null)
          if (file?.isFile()) files.push({ name, sizeBytes: file.size })
        }
        return c.json({ folder: library.fonts, files } satisfies FontFolder)
      })

      // "Back up now": a snapshot of the database, whatever the daily schedule says.
      .post('/backups', (c) => {
        backups.run()
        return c.json(backups.status(), 201)
      })
  )
}
