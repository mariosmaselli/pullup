import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Backup, BackupStatus } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { library } from '../library.ts'

// Snapshots of pullup.db in <library>/backups: one a day while Pullup runs, plus "Back up now".
// VACUUM INTO writes a consistent copy even while the database is in use (copying pullup.db
// by hand misses whatever is still in its WAL file). Media files are not copied — they're the
// originals on disk; Time Machine or another drive keeps those.

const KEEP = 14 // daily/manual snapshots kept; the pre-migration ones are never pruned
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const SNAPSHOT = /^pullup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export function createBackups(db: DB, dir = library.backups) {
  function list(): Backup[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => {
        const stats = statSync(join(dir, name))
        return {
          name,
          kind: SNAPSHOT.test(name) ? ('snapshot' as const) : ('migration' as const),
          createdAt: stats.mtime.toISOString(),
          sizeBytes: stats.size,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function run(): Backup {
    mkdirSync(dir, { recursive: true })
    let at = new Date()
    while (existsSync(join(dir, `pullup-${stamp(at)}.db`))) at = new Date(at.getTime() + 1000)
    const target = join(dir, `pullup-${stamp(at)}.db`)
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    const snapshots = list().filter((b) => b.kind === 'snapshot')
    for (const old of snapshots.slice(KEEP)) rmSync(join(dir, old.name), { force: true })
    return list().find((b) => b.name === `pullup-${stamp(at)}.db`)!
  }

  function status(): BackupStatus {
    const all = list()
    return {
      folder: dir,
      latest: all.find((b) => b.kind === 'snapshot') ?? null,
      snapshots: all.filter((b) => b.kind === 'snapshot').length,
      keep: KEEP,
    }
  }

  // A snapshot when the last one is a day old (checked hourly, so a Mac that sleeps overnight
  // still gets one soon after it wakes).
  function ensureDaily() {
    const latest = status().latest
    if (!latest || Date.now() - Date.parse(latest.createdAt) >= DAY) {
      try {
        const backup = run()
        console.log(`[backup] ${backup.name}`)
      } catch (err) {
        console.error('[backup] failed:', err)
      }
    }
  }

  function start() {
    ensureDaily()
    const timer = setInterval(ensureDaily, HOUR)
    timer.unref()
    return () => clearInterval(timer)
  }

  return { list, run, status, ensureDaily, start }
}

export type Backups = ReturnType<typeof createBackups>
