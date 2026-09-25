import { Hono } from 'hono'
import { z } from 'zod'
import { PLATFORMS } from '@shared/constants.ts'
import type { PlatformStyles, Profile } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { writingProfile, type ProfileRow } from '../services/profiles.ts'

const stylesOf = (row: ProfileRow): PlatformStyles => JSON.parse(row.platform_prefs).styles ?? {}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  voiceGuide: row.voice_guide,
  platformStyles: stylesOf(row),
})

const patchBody = z.object({
  voiceGuide: z.string().trim().min(1).max(4000).optional(),
  // Per-platform notes; an empty string clears one.
  platformStyles: z.partialRecord(z.enum(PLATFORMS), z.string().trim().max(2000)).optional(),
})

export function profileRoutes(db: DB) {
  return (
    new Hono()
      // The identity drafts are written as (see services/profiles.ts).
      .get('/current', (c) => c.json(toProfile(writingProfile(db))))

      .patch('/current', async (c) => {
        const { voiceGuide, platformStyles } = patchBody.parse(await c.req.json())
        const row = writingProfile(db)
        const prefs = JSON.parse(row.platform_prefs)
        if (platformStyles) {
          const styles: PlatformStyles = { ...stylesOf(row), ...platformStyles }
          for (const key of Object.keys(styles) as (keyof PlatformStyles)[]) {
            if (!styles[key]) delete styles[key]
          }
          prefs.styles = styles
        }
        db.prepare(
          'UPDATE profiles SET voice_guide = ?, platform_prefs = ?, updated_at = ? WHERE id = ?'
        ).run(
          voiceGuide ?? row.voice_guide,
          JSON.stringify(prefs),
          new Date().toISOString(),
          row.id
        )
        return c.json(toProfile(writingProfile(db)))
      })
  )
}
