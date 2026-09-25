import { randomUUID } from 'node:crypto'
import type { Platform, PostFormat, PostStatus, SegmentKind } from '@shared/constants.ts'
import type { Claim, Post, PostDetail, PostRevision, Segment } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { notify } from '../lib/events.ts'
import { now } from './assets.ts'

interface PostRow {
  id: string
  idea_id: string | null
  profile_id: string
  project_id: string | null
  platform: Platform
  format: PostFormat
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
  caption: string | null
  author: 'ai' | 'me'
  instruction: string | null
  claims: string
  questions: string
  created_at: string
}

const toRevision = (r: RevisionRow, existing?: Set<string>): PostRevision => ({
  id: r.id,
  segments: (JSON.parse(r.segments) as Segment[]).map((s) =>
    s.assetId && existing && !existing.has(s.assetId) ? { ...s, assetId: null, kind: 'text' } : s
  ),
  caption: r.caption,
  author: r.author,
  instruction: r.instruction,
  claims: JSON.parse(r.claims),
  questions: JSON.parse(r.questions),
  createdAt: r.created_at,
})

// ── Post content rules, shared by manual edits and the AI tasks ─────────────────────────────

// Instagram frames/slides carry their own media; X and LinkedIn media is attached per post.
export const hasFrameMedia = (platform: Platform) =>
  platform === 'ig_story' || platform === 'ig_feed'

export function formatFor(platform: Platform, segmentCount: number): PostFormat {
  if (platform === 'ig_story') return 'story_seq'
  if (platform === 'ig_feed') return 'carousel'
  if (platform === 'x' && segmentCount > 1) return 'thread'
  return 'single'
}

// Keeps only real image/video assets on frames (optionally only those in `allowed`), sets `kind`
// from the asset, and strips frame media from platforms that don't use it.
export function cleanSegments(
  db: DB,
  platform: Platform,
  segments: Segment[],
  allowed?: Set<string>
): Segment[] {
  // LinkedIn is always a single post: merge anything the model split up.
  if (platform === 'linkedin') {
    return [
      {
        text: segments
          .map((s) => s.text.trim())
          .filter(Boolean)
          .join('\n\n'),
      },
    ]
  }
  if (!hasFrameMedia(platform)) return segments.map((s) => ({ text: s.text }))
  const ids = segments.map((s) => s.assetId).filter((id): id is string => !!id)
  const kinds = new Map(
    (
      db
        .prepare(
          `SELECT id, kind FROM assets WHERE id IN (SELECT value FROM json_each(?))
           AND kind IN ('image', 'video')`
        )
        .all(JSON.stringify(ids)) as { id: string; kind: SegmentKind }[]
    ).map((r) => [r.id, r.kind])
  )
  return segments.map((s) => {
    const kind =
      s.assetId && (!allowed || allowed.has(s.assetId)) ? kinds.get(s.assetId) : undefined
    const frame: Segment = kind
      ? { text: s.text, assetId: s.assetId!, kind }
      : { text: s.text, assetId: null, kind: 'text' }
    // Keep the frame's template choice (Instagram frames are rendered by templates).
    if (s.template) frame.template = s.template
    return frame
  })
}

export interface NewRevision {
  postId: string
  platform: Platform
  segments: Segment[]
  caption?: string | null
  author: 'ai' | 'me'
  instruction?: string | null
  claims?: Claim[]
  questions?: string[]
  aiRunId?: string | null
}

// Adds a revision, makes it current, and (for Instagram) rebuilds per-frame media. Call inside
// a transaction when combined with other writes.
export function writeRevision(db: DB, rev: NewRevision): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO post_revisions (id, post_id, segments, caption, author, instruction, claims, questions, ai_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    rev.postId,
    JSON.stringify(rev.segments),
    rev.platform === 'ig_feed' ? (rev.caption ?? '') : null,
    rev.author,
    rev.instruction ?? null,
    JSON.stringify(rev.claims ?? []),
    JSON.stringify(rev.questions ?? []),
    rev.aiRunId ?? null
  )
  db.prepare(
    'UPDATE posts SET current_revision_id = ?, format = ?, updated_at = ? WHERE id = ?'
  ).run(id, formatFor(rev.platform, rev.segments.length), now(), rev.postId)
  if (hasFrameMedia(rev.platform)) syncFrameMedia(db, rev.postId, rev.segments)
  return id
}

// Media rows only for assets that still exist: an old revision may point at a deleted asset.
function syncFrameMedia(db: DB, postId: string, segments: Segment[]) {
  db.prepare('DELETE FROM post_media WHERE post_id = ?').run(postId)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO post_media (post_id, asset_id, segment_index, position)
     SELECT ?, id, ?, 0 FROM assets WHERE id = ?`
  )
  segments.forEach((s, i) => s.assetId && insert.run(postId, i, s.assetId))
}

export function setAttachedMedia(db: DB, postId: string, assetIds: string[]) {
  db.prepare('DELETE FROM post_media WHERE post_id = ?').run(postId)
  const insert = db.prepare(
    `INSERT INTO post_media (post_id, asset_id, segment_index, position)
     SELECT ?, id, 0, ? FROM assets WHERE id = ?`
  )
  assetIds.forEach((assetId, position) => insert.run(postId, position, assetId))
}

// ── Store ───────────────────────────────────────────────────────────────────────────────────

export function createPostStore(db: DB) {
  // Asset ids (from frames) that still exist, so revisions never point at deleted assets.
  const existingAssets = (revisions: RevisionRow[]) => {
    const ids = revisions.flatMap((r) =>
      (JSON.parse(r.segments) as Segment[]).map((s) => s.assetId).filter(Boolean)
    )
    return new Set(
      (
        db
          .prepare('SELECT id FROM assets WHERE id IN (SELECT value FROM json_each(?))')
          .all(JSON.stringify(ids)) as { id: string }[]
      ).map((r) => r.id)
    )
  }

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

    const existing = existingAssets(revisions)
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
        current: current ? toRevision(current, existing) : null,
        mediaAssetIds: [...new Set(media.filter((m) => m.post_id === r.id).map((m) => m.asset_id))],
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
      const revisionRows = db
        .prepare('SELECT * FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC')
        .all(id) as RevisionRow[]
      const existing = existingAssets(revisionRows)
      const revisions = revisionRows.map((rev) => toRevision(rev, existing))
      const sourceAssetIds = r.idea_id
        ? (
            db.prepare('SELECT asset_id FROM idea_sources WHERE idea_id = ?').all(r.idea_id) as {
              asset_id: string
            }[]
          ).map((s) => s.asset_id)
        : post!.mediaAssetIds
      // Every draft from the same idea, across platforms — the tabs in the editor.
      const siblings = r.idea_id
        ? (db
            .prepare(
              `SELECT id, platform, angle, status FROM posts WHERE idea_id = ? AND status != 'discarded'
               ORDER BY CASE platform WHEN 'x' THEN 0 WHEN 'linkedin' THEN 1 WHEN 'ig_story' THEN 2 ELSE 3 END, created_at`
            )
            .all(r.idea_id) as PostDetail['siblings'])
        : [{ id: r.id, platform: r.platform, angle: r.angle, status: r.status }]
      return { ...post!, revisions, sourceAssetIds, siblings }
    },

    exists(id: string) {
      return !!row(id)
    },

    // Manual edit: a new revision authored by Mario, keeping the previous claims/questions.
    saveRevision(postId: string, segments: Segment[], caption?: string | null) {
      const post = row(postId)!
      const previous = db
        .prepare('SELECT claims, questions FROM post_revisions WHERE id = ?')
        .get(post.current_revision_id) as { claims: string; questions: string } | undefined
      const id = db.transaction(() =>
        writeRevision(db, {
          postId,
          platform: post.platform,
          segments: cleanSegments(db, post.platform, segments),
          caption,
          author: 'me',
          claims: previous ? JSON.parse(previous.claims) : [],
          questions: previous ? JSON.parse(previous.questions) : [],
        })
      )()
      notify('posts')
      return id
    },

    // Point the post back at an earlier revision.
    restoreRevision(postId: string, revisionId: string) {
      const post = row(postId)
      const found = db
        .prepare('SELECT segments FROM post_revisions WHERE id = ? AND post_id = ?')
        .get(revisionId, postId) as { segments: string } | undefined
      if (!post || !found) return false
      const segments = JSON.parse(found.segments) as Segment[]
      db.transaction(() => {
        db.prepare(
          'UPDATE posts SET current_revision_id = ?, format = ?, updated_at = ? WHERE id = ?'
        ).run(revisionId, formatFor(post.platform, segments.length), now(), postId)
        if (hasFrameMedia(post.platform)) syncFrameMedia(db, postId, segments)
      })()
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
