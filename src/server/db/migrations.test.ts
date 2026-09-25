import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './index.ts'

describe('migrations', () => {
  it('upgrades a populated 002 database to 003 without losing posts or revisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-migrate-'))
    const path = join(dir, 'pullup.db')

    const old = openDatabase(path, { until: '002_ai.sql' })
    const profile = (
      old.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
    ).id
    old
      .prepare("INSERT INTO ideas (id, title, origin) VALUES ('idea-1', 'Mycelium hero', 'manual')")
      .run()
    old
      .prepare(
        `INSERT INTO posts (id, idea_id, profile_id, platform, format, status, current_revision_id)
       VALUES ('post-1', 'idea-1', ?, 'x', 'single', 'approved', 'rev-1')`
      )
      .run(profile)
    old
      .prepare(
        `INSERT INTO post_revisions (id, post_id, segments, author) VALUES ('rev-1', 'post-1', '[{"text":"hi"}]', 'ai')`
      )
      .run()
    old.close()

    const db = openDatabase(path)
    expect(db.prepare('SELECT platform, status, current_revision_id FROM posts').all()).toEqual([
      { platform: 'x', status: 'approved', current_revision_id: 'rev-1' },
    ])
    expect(db.prepare('SELECT count(*) AS n FROM post_revisions').get()).toEqual({ n: 1 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    // LinkedIn is now a valid platform; unknown platforms are still rejected.
    const insert = db.prepare(
      `INSERT INTO posts (id, profile_id, platform, format) VALUES (?, ?, ?, 'single')`
    )
    expect(() => insert.run('post-2', profile, 'linkedin')).not.toThrow()
    expect(() => insert.run('post-3', profile, 'myspace')).toThrow()

    // Deleting a post still cascades to its revisions (foreign keys survived the rebuild).
    db.prepare("DELETE FROM posts WHERE id = 'post-1'").run()
    expect(db.prepare('SELECT count(*) AS n FROM post_revisions').get()).toEqual({ n: 0 })

    // An existing database is backed up before migrating.
    const backups = readdirSync(join(dir, 'backups'))
    expect(backups.some((f) => f.includes('before-003_platforms'))).toBe(true)
  })

  it('does not write a backup for a brand-new database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pullup-migrate-'))
    openDatabase(join(dir, 'pullup.db')).close()
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })
})
