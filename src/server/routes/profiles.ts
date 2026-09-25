import { Hono } from 'hono'
import { z } from 'zod'
import type { Profile } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { writingProfile, type ProfileRow } from '../services/profiles.ts'

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  voiceGuide: row.voice_guide,
  platformPrefs: JSON.parse(row.platform_prefs),
})

export function profileRoutes(db: DB) {
  return (
    new Hono()
      // The identity drafts are written as (see services/profiles.ts).
      .get('/current', (c) => c.json(toProfile(writingProfile(db))))

      .patch('/current', async (c) => {
        const { voiceGuide } = z
          .object({ voiceGuide: z.string().trim().min(1).max(4000) })
          .parse(await c.req.json())
        const { id } = writingProfile(db)
        db.prepare('UPDATE profiles SET voice_guide = ?, updated_at = ? WHERE id = ?').run(
          voiceGuide,
          new Date().toISOString(),
          id
        )
        return c.json(toProfile(writingProfile(db)))
      })
  )
}
