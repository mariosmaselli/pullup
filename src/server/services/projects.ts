import { randomUUID } from 'node:crypto'
import type { ProjectStatus } from '@shared/constants.ts'
import type { Project } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { notify } from '../lib/events.ts'
import { now } from './assets.ts'

interface ProjectRow {
  id: string
  name: string
  slug: string
  description: string
  status: ProjectStatus
  is_client_work: number
  ai_allowed: number
  tags: string
  default_profile_id: string | null
  created_at: string
  updated_at: string
  asset_count: number
  cover_asset_id: string | null
  last_captured_at: string | null
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  status: row.status,
  isClientWork: !!row.is_client_work,
  aiAllowed: !!row.ai_allowed,
  tags: JSON.parse(row.tags),
  defaultProfileId: row.default_profile_id,
  assetCount: row.asset_count,
  coverAssetId: row.cover_asset_id,
  lastCapturedAt: row.last_captured_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project'

// Asset count, latest capture and a cover (latest image/video with a thumbnail) per project.
const SELECT = `
  SELECT p.*,
    (SELECT count(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
    (SELECT max(a.captured_at) FROM assets a WHERE a.project_id = p.id) AS last_captured_at,
    (SELECT a.id FROM assets a
       JOIN asset_derivatives d ON d.asset_id = a.id AND d.role = 'thumb'
      WHERE a.project_id = p.id ORDER BY a.captured_at DESC LIMIT 1) AS cover_asset_id
  FROM projects p`

export interface ProjectInput {
  name: string
  description?: string
  status?: ProjectStatus
  isClientWork?: boolean
  aiAllowed?: boolean
  tags?: string[]
  defaultProfileId?: string | null
}

export function createProjectStore(db: DB) {
  const uniqueSlug = (name: string, exceptId?: string) => {
    const base = slugify(name)
    let slug = base
    for (let i = 2; ; i++) {
      const taken = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug) as
        { id: string } | undefined
      if (!taken || taken.id === exceptId) return slug
      slug = `${base}-${i}`
    }
  }

  return {
    list(): Project[] {
      const rows = db
        .prepare(
          `${SELECT} ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
           coalesce(last_captured_at, p.created_at) DESC`
        )
        .all() as ProjectRow[]
      return rows.map(toProject)
    },

    get(idOrSlug: string): Project | undefined {
      const row = db.prepare(`${SELECT} WHERE p.id = ? OR p.slug = ?`).get(idOrSlug, idOrSlug) as
        ProjectRow | undefined
      return row ? toProject(row) : undefined
    },

    create(input: ProjectInput): Project {
      const id = randomUUID()
      const isClientWork = input.isClientWork ?? false
      db.prepare(
        `INSERT INTO projects (id, name, slug, description, status, is_client_work, ai_allowed, tags, default_profile_id)
         VALUES (@id, @name, @slug, @description, @status, @is_client_work, @ai_allowed, @tags, @default_profile_id)`
      ).run({
        id,
        name: input.name,
        slug: uniqueSlug(input.name),
        description: input.description ?? '',
        status: input.status ?? 'active',
        is_client_work: isClientWork ? 1 : 0,
        // Client work keeps AI off until explicitly allowed.
        ai_allowed: (input.aiAllowed ?? !isClientWork) ? 1 : 0,
        tags: JSON.stringify(input.tags ?? []),
        default_profile_id: input.defaultProfileId ?? null,
      })
      notify('projects')
      return this.get(id)!
    },

    update(id: string, input: Partial<ProjectInput>): Project | undefined {
      const values: Record<string, unknown> = {}
      if (input.name !== undefined) {
        values.name = input.name
        values.slug = uniqueSlug(input.name, id)
      }
      if (input.description !== undefined) values.description = input.description
      if (input.status !== undefined) values.status = input.status
      if (input.isClientWork !== undefined) values.is_client_work = input.isClientWork ? 1 : 0
      if (input.aiAllowed !== undefined) values.ai_allowed = input.aiAllowed ? 1 : 0
      if (input.tags !== undefined) values.tags = JSON.stringify(input.tags)
      if (input.defaultProfileId !== undefined) values.default_profile_id = input.defaultProfileId

      const columns = Object.keys(values)
      if (columns.length) {
        db.prepare(
          `UPDATE projects SET ${columns.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @updated_at WHERE id = @id`
        ).run({ ...values, id, updated_at: now() })
        notify('projects')
      }
      return this.get(id)
    },

    exists(id: string) {
      return !!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)
    },
  }
}

export type ProjectStore = ReturnType<typeof createProjectStore>
