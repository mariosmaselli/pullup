import type { IdeaStatus } from '@shared/constants.ts'
import type { Idea } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { notify } from '../lib/events.ts'
import { now } from './assets.ts'

interface IdeaRow {
  id: string
  title: string
  summary: string
  angle: Idea['angle']
  format: Idea['format']
  platforms: string
  rationale: string
  questions: string
  origin: Idea['origin']
  status: IdeaStatus
  profile_id: string | null
  project_id: string | null
  created_at: string
}

export function createIdeaStore(db: DB) {
  const sourcesFor = (ids: string[]) => {
    const rows = db
      .prepare('SELECT * FROM idea_sources WHERE idea_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(ids)) as { idea_id: string; asset_id: string; note: string }[]
    const map = new Map<string, Idea['sources']>()
    for (const r of rows)
      map.set(r.idea_id, [...(map.get(r.idea_id) ?? []), { assetId: r.asset_id, note: r.note }])
    return map
  }

  const hydrate = (rows: IdeaRow[]): Idea[] => {
    const sources = sourcesFor(rows.map((r) => r.id))
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      angle: r.angle,
      format: r.format,
      platforms: JSON.parse(r.platforms),
      rationale: r.rationale,
      questions: JSON.parse(r.questions),
      origin: r.origin,
      status: r.status,
      profileId: r.profile_id,
      projectId: r.project_id,
      sources: sources.get(r.id) ?? [],
      createdAt: r.created_at,
    }))
  }

  return {
    list(statuses: IdeaStatus[], ids?: string[]): Idea[] {
      const rows = db
        .prepare(
          `SELECT * FROM ideas WHERE status IN (SELECT value FROM json_each(@statuses))
           ${ids ? 'AND id IN (SELECT value FROM json_each(@ids))' : ''}
           ORDER BY created_at DESC LIMIT 300`
        )
        .all({ statuses: JSON.stringify(statuses), ids: JSON.stringify(ids ?? []) }) as IdeaRow[]
      return hydrate(rows)
    },

    exists(id: string) {
      return !!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)
    },

    setStatus(id: string, status: IdeaStatus) {
      db.prepare('UPDATE ideas SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
      notify('ideas')
    },
  }
}

export type IdeaStore = ReturnType<typeof createIdeaStore>
