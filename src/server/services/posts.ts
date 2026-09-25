import { randomUUID } from 'node:crypto'
import type { PostStatus } from '@shared/constants.ts'
import type { Post, PostDetail, PostRevision } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { notify } from '../lib/events.ts'
import { now } from './assets.ts'

interface PostRow {
  id: string
  idea_id: string | null
  profile_id: string
  project_id: string | null
  platform: Post['platform']
  format: Post['format']
  angle: Post['angle']
  status: PostStatus
  current_revision_id: string | null
  scheduled_for: string | null
  published_at: string | null
  public_url: string | null
  created_at: string
  updated_at: string
}

interface RevisionRow {
  id: string
  post_id: string
  segments: string
  author: 'ai' | 'me'
  instruction: string | null
  claims: string
  questions: string
  created_at: string
}

const toRevision = (r: RevisionRow): PostRevision => ({
  id: r.id,
  segments: JSON.parse(r.segments),
  author: r.author,
  instruction: r.instruction,
  claims: JSON.parse(r.claims),
  questions: JSON.parse(r.questions),
  createdAt: r.created_at,
})

export function createPostStore(db: DB) {
  const hydrate = (rows: PostRow[]): Post[] => {
    const ids = JSON.stringify(rows.map((r) => r.id))
    const revisions = db
      .prepare(
        `SELECT r.* FROM post_revisions r JOIN posts p ON p.current_revision_id = r.id
         WHERE p.id IN (SELECT value FROM json_each(?))`
      )
      .all(ids) as RevisionRow[]
    const media = db
      .prepare(
        `SELECT post_id, asset_id FROM post_media WHERE post_id IN (SELECT value FROM json_each(?))
         ORDER BY segment_index, position`
      )
      .all(ids) as { post_id: string; asset_id: string }[]

    return rows.map((r) => {
      const current = revisions.find((rev) => rev.post_id === r.id)
      return {
        id: r.id,
        ideaId: r.idea_id,
        profileId: r.profile_id,
        projectId: r.project_id,
        platform: r.platform,
        format: r.format,
        angle: r.angle,
        status: r.status,
        scheduledFor: r.scheduled_for,
        publishedAt: r.published_at,
        publicUrl: r.public_url,
        current: current ? toRevision(current) : null,
        mediaAssetIds: media.filter((m) => m.post_id === r.id).map((m) => m.asset_id),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    })
  }

  const row = (id: string) =>
    db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined

  return {
    list(statuses: PostStatus[]): Post[] {
      const rows = db
        .prepare(
          `SELECT * FROM posts WHERE status IN (SELECT value FROM json_each(?))
           ORDER BY updated_at DESC LIMIT 300`
        )
        .all(JSON.stringify(statuses)) as PostRow[]
      return hydrate(rows)
    },

    detail(id: string): PostDetail | undefined {
      const r = row(id)
      if (!r) return undefined
      const [post] = hydrate([r])
      const revisions = (
        db
          .prepare('SELECT * FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC')
          .all(id) as RevisionRow[]
      ).map(toRevision)
      const sourceAssetIds = r.idea_id
        ? (
            db.prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ?').all(r.idea_id) as {
              asset_id: string
            }[]
          ).map((s) => s.asset_id)
        : post!.mediaAssetIds
      const siblings = r.idea_id
        ? (db
            .prepare(
              `SELECT id, angle, status FROM posts WHERE idea_id = ? AND platform = ? AND status != 'discarded'
               ORDER BY created_at`
            )
            .all(r.idea_id, r.platform) as PostDetail['siblings'])
        : [{ id: r.id, angle: r.angle, status: r.status }]
      return { ...post!, revisions, sourceAssetIds, siblings }
    },

    exists(id: string) {
      return !!row(id)
    },

    // Manual edit: a new revision authored by Mario.
    saveRevision(postId: string, segments: { text: string }[]) {
      const previous = db
        .prepare(
          'SELECT r.claims, r.questions FROM post_revisions r JOIN posts p ON p.current_revision_id = r.id WHERE p.id = ?'
        )
        .get(postId) as { claims: string; questions: string } | undefined
      const id = randomUUID()
      db.transaction(() => {
        db.prepare(
          `INSERT INTO post_revisions (id, post_id, segments, author, claims, questions)
           VALUES (?, ?, ?, 'me', ?, ?)`
        ).run(
          id,
          postId,
          JSON.stringify(segments),
          previous?.claims ?? '[]',
          previous?.questions ?? '[]'
        )
        db.prepare(
          'UPDATE posts SET current_revision_id = ?, format = ?, updated_at = ? WHERE id = ?'
        ).run(id, segments.length > 1 ? 'thread' : 'single', now(), postId)
      })()
      notify('posts')
      return id
    },

    // Point the post back at an earlier revision.
    restoreRevision(postId: string, revisionId: string) {
      const found = db
        .prepare('SELECT segments FROM post_revisions WHERE id = ? AND post_id = ?')
        .get(revisionId, postId) as { segments: string } | undefined
      if (!found) return false
      const format = (JSON.parse(found.segments) as unknown[]).length > 1 ? 'thread' : 'single'
      db.prepare(
        'UPDATE posts SET current_revision_id = ?, format = ?, updated_at = ? WHERE id = ?'
      ).run(revisionId, format, now(), postId)
      notify('posts')
      return true
    },

    update(
      id: string,
      values: {
        status?: PostStatus
        scheduledFor?: string | null
        publishedAt?: string | null
        publicUrl?: string | null
      }
    ) {
      const columns: Record<string, unknown> = {}
      if (values.status !== undefined) columns.status = values.status
      if (values.scheduledFor !== undefined) columns.scheduled_for = values.scheduledFor
      if (values.publishedAt !== undefined) columns.published_at = values.publishedAt
      if (values.publicUrl !== undefined) columns.public_url = values.publicUrl
      const keys = Object.keys(columns)
      if (!keys.length) return
      db.prepare(
        `UPDATE posts SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`
      ).run({ ...columns, id, updated_at: now() })
      notify('posts')
    },
  }
}

export type PostStore = ReturnType<typeof createPostStore>
