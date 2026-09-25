import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { library } from '../library.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

// A migration that rebuilds a table (SQLite can't alter CHECK constraints) must run with foreign
// keys off — otherwise dropping the old table cascades into its children. Such files start
// with this line; the runner turns foreign keys off around them and verifies them afterwards.
const FOREIGN_KEYS_OFF = '-- migrate:foreign-keys-off'

export type DB = Database.Database

interface OpenOptions {
  // Apply migrations only up to and including this file (tests of upgrades).
  until?: string
}

export function openDatabase(path = library.database, options: OpenOptions = {}): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db, path, options)
  return db
}

// Applies every src/server/db/migrations/NNN_name.sql not yet recorded, each in its own transaction.
function migrate(db: DB, path: string, { until }: OpenOptions) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`)

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name)
  )

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && !applied.has(file))
    .filter((file) => !until || file <= until)
    .sort()
  if (!pending.length) return

  // An existing database gets a full copy before its schema changes.
  if (applied.size && path !== ':memory:') backup(db, path, pending[0]!)

  for (const file of pending) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    const keysOff = sql.startsWith(FOREIGN_KEYS_OFF)
    if (keysOff) db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(sql)
        if (keysOff) {
          const violations = db.pragma('foreign_key_check') as unknown[]
          if (violations.length)
            throw new Error(`${file} left ${violations.length} foreign key violations`)
        }
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
      })()
    } finally {
      if (keysOff) db.pragma('foreign_keys = ON')
    }
    console.log(`[db] applied ${file}`)
  }
}

function backup(db: DB, path: string, firstPending: string) {
  const dir = join(dirname(path), 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dir, `pullup-${stamp}-before-${firstPending.replace(/\.sql$/, '')}.db`)
  if (existsSync(target)) return
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  console.log(`[db] backup written to ${target}`)
}
