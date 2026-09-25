import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { BackupStatus } from '@shared/types.ts'
import { ensureLibrary } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'
import { createBackups } from './services/backups.ts'

ensureLibrary()
const db = openDatabase()

describe('backups', () => {
  it('writes a complete, openable copy of the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-backups-'))
    const backup = createBackups(db, dir).run()
    expect(backup.kind).toBe('snapshot')
    const copy = new Database(join(dir, backup.name), { readonly: true })
    const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    expect(tables.map((t) => (t as { name: string }).name)).toEqual(
      expect.arrayContaining(['assets', 'ideas', 'posts', 'post_revisions', 'ai_runs'])
    )
    copy.close()
  })

  it('keeps the latest 14 snapshots and never prunes pre-migration copies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-backups-'))
    writeFileSync(join(dir, 'pullup-2026-01-01T00-00-00-000Z-before-004_renders.db'), '')
    const backups = createBackups(db, dir)
    for (let i = 0; i < 16; i++) backups.run()
    const names = readdirSync(dir)
    expect(names.filter((n) => n.includes('-before-'))).toHaveLength(1)
    expect(names.filter((n) => !n.includes('-before-'))).toHaveLength(14)
    expect(backups.status()).toMatchObject({ snapshots: 14, keep: 14 })
  })

  it('makes a daily snapshot only when the last one is a day old', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-backups-'))
    const backups = createBackups(db, dir)
    backups.ensureDaily()
    backups.ensureDaily()
    expect(backups.status().snapshots).toBe(1)

    const latest = backups.status().latest!
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000)
    utimesSync(join(dir, latest.name), yesterday, yesterday)
    backups.ensureDaily()
    expect(backups.status().snapshots).toBe(2)
  })

  it('"Back up now" through the API (POST only; GET just reports)', async () => {
    const { app } = createApp(db)
    const before = (await (await app.request('/api/system/backups')).json()) as BackupStatus
    const res = await app.request('/api/system/backups', { method: 'POST' })
    expect(res.status).toBe(201)
    const after = (await res.json()) as BackupStatus
    expect(after.snapshots).toBe(Math.min(before.snapshots + 1, 14))
    expect(after.latest?.name).toMatch(/^pullup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)
  })
})
