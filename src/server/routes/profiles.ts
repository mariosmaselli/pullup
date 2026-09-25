import { Hono } from 'hono'
import type { Profile } from '@shared/types.ts'
import type { DB } from '../db/index.ts'

interface ProfileRow {
  id: string
  slug: string
  name: string
  voice_guide: string
  platform_prefs: string
}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  voiceGuide: row.voice_guide,
  platformPrefs: JSON.parse(row.platform_prefs),
})

export function profileRoutes(db: DB) {
  return new Hono().get('/', (c) => {
    const rows = db
      .prepare('SELECT * FROM profiles ORDER BY created_at, slug')
      .all() as ProfileRow[]
    return c.json(rows.map(toProfile))
  })
}
