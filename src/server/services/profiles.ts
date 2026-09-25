import type { DB } from '../db/index.ts'

export interface ProfileRow {
  id: string
  slug: string
  name: string
  voice_guide: string
  platform_prefs: string
}

// Pullup currently writes as one identity (Mario). The profiles table is kept so connected
// accounts (X, Instagram, LinkedIn…) can be added later; until then everything uses this one.
export const DEFAULT_PROFILE_SLUG = 'mario'

export function writingProfile(db: DB, id?: string | null): ProfileRow {
  const requested = id
    ? (db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined)
    : undefined
  return (
    requested ??
    (db.prepare('SELECT * FROM profiles WHERE slug = ?').get(DEFAULT_PROFILE_SLUG) as ProfileRow)
  )
}
