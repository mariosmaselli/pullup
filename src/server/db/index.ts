import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { library } from '../library.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

export type DB = Database.Database

export function openDatabase(path = library.database): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

// Applies every src/server/db/migrations/NNN_name.sql not yet recorded, each in its own transaction.
function migrate(db: DB) {
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
    .sort()

  for (const file of pending) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
    })()
    console.log(`[db] applied ${file}`)
  }
}
