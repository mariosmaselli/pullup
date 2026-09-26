import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LinkMeta } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { extractFrame, sipsToJpeg } from '../lib/ffmpeg.ts'
import { fromLibraryPath, library } from '../library.ts'
import type { AssetRow, DerivativeRow } from '../services/assets.ts'
import { AiError, type AiContent } from './provider.ts'

// Builds what the model sees for a set of assets: a text block per asset (clearly separating
// Mario's own words from earlier AI output) plus images — originals, video frames, link previews.

// The API rejects images over 8000 px a side and downscales anything over ~2576 px, so every
// image is fitted inside 1600 × 2576 (a full-page screenshot becomes a tall, narrow strip).
const AI_IMAGE_WIDTH = 1600
const AI_IMAGE_MAX_SIDE = 2576
const MAX_DIRECT_BYTES = 3.5 * 1024 * 1024

type DirectType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

// The format the bytes actually are — the API checks them against media_type, and a file's
// extension (hence its stored mime) can lie, e.g. a CDN WebP saved as .jpg.
function sniffImageType(b: Buffer): DirectType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return 'image/png'
  }
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'image/gif'
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

interface ProjectRow {
  id: string
  name: string
  description: string
  is_client_work: number
  ai_allowed: number
  tags: string
}

// A post may reach the AI (as "already covered" or a voice example) only if nothing it's tied to
// belongs to a project with AI turned off: its own project, its media, or its idea's sources.
const POST_AI_ALLOWED = `
  NOT EXISTS (SELECT 1 FROM projects x WHERE x.id = p.project_id AND x.ai_allowed = 0)
  AND NOT EXISTS (SELECT 1 FROM post_media m JOIN assets a ON a.id = m.asset_id
    JOIN projects x ON x.id = a.project_id WHERE m.post_id = p.id AND x.ai_allowed = 0)
  AND NOT EXISTS (SELECT 1 FROM idea_sources s JOIN assets a ON a.id = s.asset_id
    JOIN projects x ON x.id = a.project_id WHERE s.idea_id = p.idea_id AND x.ai_allowed = 0)`

const IDEA_AI_ALLOWED = `
  NOT EXISTS (SELECT 1 FROM projects x WHERE x.id = i.project_id AND x.ai_allowed = 0)
  AND NOT EXISTS (SELECT 1 FROM idea_sources s JOIN assets a ON a.id = s.asset_id
    JOIN projects x ON x.id = a.project_id WHERE s.idea_id = i.id AND x.ai_allowed = 0)`

interface PostTextRow {
  id: string
  platform: string
  status: string
  author: 'ai' | 'me'
  segments: string
  caption: string | null
  published_at: string | null
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

// A post's current text: its posts/frames/slides, then an Instagram caption.
const postText = (row: PostTextRow, max: number) =>
  clip(
    [
      ...(JSON.parse(row.segments) as { text: string }[]).map((s) => s.text.trim()),
      row.caption?.trim() && `Caption: ${row.caption.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    max
  )

interface AnalysisRow {
  description: string
  subjects: string
  hooks: string
}

export interface SourceBundle {
  assets: AssetRow[]
  text: string
  images: AiContent[]
}

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const attr = (value: string) => value.replace(/"/g, "'")

async function jpegContent(path: string): Promise<AiContent> {
  return { type: 'image', mediaType: 'image/jpeg', data: (await readFile(path)).toString('base64') }
}

// One image for a still: the original when it's small and really a supported format, else a
// cached JPEG fitted inside AI_IMAGE_WIDTH × AI_IMAGE_MAX_SIDE.
async function stillImage(row: AssetRow, derivatives: DerivativeRow[]): Promise<AiContent | null> {
  if (!row.file_path || row.mime === 'image/svg+xml') return null
  const original = fromLibraryPath(row.file_path)

  if ((row.width ?? 0) <= AI_IMAGE_MAX_SIDE && (row.height ?? 0) <= AI_IMAGE_MAX_SIDE) {
    const { size } = await stat(original)
    if (size <= MAX_DIRECT_BYTES) {
      const bytes = await readFile(original)
      const mediaType = sniffImageType(bytes)
      if (mediaType) return { type: 'image', mediaType, data: bytes.toString('base64') }
      // Anything else (HEIC, AVIF, TIFF…) goes through the JPEG below.
    }
  }

  // Named ai-box.jpg: older ai.jpg files were capped by width only and can be too tall.
  const target = join(library.cache, row.id, 'ai-box.jpg')
  if (!existsSync(target)) {
    // ffmpeg decodes only one tile of a HEIC grid: start from the sips-made poster instead.
    let source = original
    if (/image\/hei[cf]/.test(row.mime ?? '')) {
      const poster = derivatives.find((d) => d.role === 'poster')
      source = join(library.cache, row.id, 'ai-source.jpg')
      if (poster) source = fromLibraryPath(poster.file_path)
      else await sipsToJpeg(original, source, AI_IMAGE_WIDTH, row.width)
    }
    await extractFrame(source, target, null, AI_IMAGE_WIDTH, AI_IMAGE_MAX_SIDE)
  }
  return jpegContent(target)
}

async function imagesFor(
  row: AssetRow,
  derivatives: DerivativeRow[],
  maxFrames: number
): Promise<AiContent[]> {
  if (row.kind === 'image') {
    const image = await stillImage(row, derivatives)
    return image ? [image] : []
  }
  if (row.kind === 'video') {
    const frames = derivatives
      .filter((d) => d.role === 'frame')
      .sort((a, b) => (a.time_ms ?? 0) - (b.time_ms ?? 0))
    // Spread the picks across the recording.
    const step = Math.max(1, frames.length / maxFrames)
    const picked = Array.from(
      { length: Math.min(maxFrames, frames.length) },
      (_, i) => frames[Math.floor(i * step)]!
    )
    return Promise.all(picked.map((f) => jpegContent(fromLibraryPath(f.file_path))))
  }
  if (row.kind === 'link') {
    const thumb = derivatives.find((d) => d.role === 'thumb')
    return thumb ? [await jpegContent(fromLibraryPath(thumb.file_path))] : []
  }
  return []
}

export function createContextBuilder(db: DB) {
  const project = (id: string | null) =>
    id
      ? (db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined)
      : undefined

  const latestAnalysis = (assetId: string) =>
    db
      .prepare('SELECT * FROM asset_analyses WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(assetId) as AnalysisRow | undefined

  const derivatives = (assetId: string) =>
    db.prepare('SELECT * FROM asset_derivatives WHERE asset_id = ?').all(assetId) as DerivativeRow[]

  return {
    // Throws if the project has AI analysis turned off.
    assertProjectAllowed(id: string | null) {
      const p = project(id)
      if (p && !p.ai_allowed) {
        throw new AiError(
          `“${p.name}” has AI analysis turned off. Allow it on the project page first.`,
          403
        )
      }
    },

    // Throws if any asset belongs to a project with AI analysis turned off.
    assertAllowed(rows: AssetRow[]) {
      for (const row of rows) this.assertProjectAllowed(row.project_id)
    },

    // Mario's description and tags of a project.
    describeProject(id: string | null): string {
      const p = project(id)
      if (!p) return ''
      const tags = JSON.parse(p.tags) as string[]
      return [
        `<project id="${p.id}" name="${attr(p.name)}"${p.is_client_work ? ' client_work="true"' : ''}>`,
        p.description.trim()
          ? `Description (by Mario): ${p.description.trim()}`
          : '(no description)',
        tags.length && `Tags (by Mario): ${tags.join(', ')}`,
        '</project>',
      ]
        .filter(Boolean)
        .join('\n')
    },

    // Up to `limit` ready assets of a project for "Get ideas" on the whole project: material no
    // idea or post uses yet first, then the newest; returned oldest first so the model sees how
    // the work progressed.
    projectMaterial(projectId: string, limit: number): string[] {
      return (
        db
          .prepare(
            `SELECT id FROM (
               SELECT a.id, a.captured_at FROM assets a
               WHERE a.project_id = ? AND a.processing_status = 'ready'
               ORDER BY EXISTS (SELECT 1 FROM idea_sources s WHERE s.asset_id = a.id)
                   OR EXISTS (SELECT 1 FROM post_media m WHERE m.asset_id = a.id),
                 a.captured_at DESC
               LIMIT ?
             ) ORDER BY captured_at`
          )
          .all(projectId, limit) as { id: string }[]
      ).map((r) => r.id)
    },

    // What already exists for this material or these projects, so the model stops repeating
    // itself: open and drafted ideas, ideas Mario dismissed, and the text of approved, scheduled
    // or published posts.
    covered(scope: { assetIds: string[]; projectIds: string[] }) {
      const params = {
        assets: JSON.stringify(scope.assetIds),
        projects: JSON.stringify(scope.projectIds),
      }
      const ideas = (dismissed: boolean, limit: number) =>
        db
          .prepare(
            `SELECT i.title, i.summary FROM ideas i
             WHERE (i.project_id IN (SELECT value FROM json_each(@projects))
                 OR i.id IN (SELECT idea_id FROM idea_sources
                             WHERE asset_id IN (SELECT value FROM json_each(@assets))))
               AND i.status ${dismissed ? "= 'dismissed'" : "!= 'dismissed'"}
               AND ${IDEA_AI_ALLOWED}
             ORDER BY i.created_at DESC LIMIT ${limit}`
          )
          .all(params) as { title: string; summary: string }[]
      const open = ideas(false, 20)
      const dismissed = ideas(true, 15)
      const posts = db
        .prepare(
          `SELECT p.id, p.platform, p.status, p.published_at, r.author, r.segments, r.caption
           FROM posts p JOIN post_revisions r ON r.id = p.current_revision_id
           WHERE p.status IN ('approved', 'scheduled', 'published')
             AND (p.project_id IN (SELECT value FROM json_each(@projects))
               OR p.idea_id IN (SELECT idea_id FROM idea_sources
                                WHERE asset_id IN (SELECT value FROM json_each(@assets)))
               OR p.id IN (SELECT post_id FROM post_media
                           WHERE asset_id IN (SELECT value FROM json_each(@assets))))
             AND ${POST_AI_ALLOWED}
           ORDER BY p.status = 'published' DESC, coalesce(p.published_at, p.scheduled_for, p.updated_at) DESC
           LIMIT 10`
        )
        .all(params) as PostTextRow[]

      const idea = (i: { title: string; summary: string }) =>
        `- ${i.title}${i.summary ? ` — ${clip(i.summary, 200)}` : ''}`
      const sections = [
        open.length && `Ideas already suggested or drafted:\n${open.map(idea).join('\n')}`,
        dismissed.length &&
          `Ideas Mario dismissed (he didn't want these):\n${dismissed.map(idea).join('\n')}`,
        posts.length &&
          `Posts already approved or published:\n${posts
            .map(
              (p) =>
                `<post platform="${p.platform}" status="${p.status}"${p.published_at ? ` published="${p.published_at.slice(0, 10)}"` : ''}>\n${postText(p, 500)}\n</post>`
            )
            .join('\n')}`,
      ].filter(Boolean)
      return {
        text: sections.length
          ? `<already_covered>\n${sections.join('\n\n')}\n</already_covered>`
          : '',
        counts: { ideas: open.length, dismissed: dismissed.length, posts: posts.length },
      }
    },

    // Up to `perPlatform` posts per platform in Mario's own voice: ones he edited by hand
    // (published first), then published ones. Never from the idea being drafted.
    voiceExamples(platforms: string[], excludeIdeaId: string | null, perPlatform = 3) {
      const pick = db.prepare(
        `SELECT p.id, p.platform, p.status, p.published_at, r.author, r.segments, r.caption
         FROM posts p JOIN post_revisions r ON r.id = p.current_revision_id
         WHERE p.platform = @platform
           AND (p.status = 'published'
             OR (r.author = 'me' AND p.status NOT IN ('discarded', 'archived')))
           AND p.idea_id IS NOT @idea
           AND ${POST_AI_ALLOWED}
         ORDER BY r.author = 'me' DESC, p.status = 'published' DESC,
           coalesce(p.published_at, p.updated_at) DESC
         LIMIT @limit`
      )
      // Over-fetch: blank drafts started by hand have no text to show.
      const examples = platforms.flatMap((platform) =>
        (pick.all({ platform, idea: excludeIdeaId, limit: perPlatform * 4 }) as PostTextRow[])
          .map((row) => ({ row, text: postText(row, 600) }))
          .filter((e) => e.text.trim())
          .slice(0, perPlatform)
      )
      return {
        text: examples.length
          ? [
              '<voice_examples>',
              'Posts Mario published or edited himself — for his voice only. Never reuse their topics, facts, clients or wording.',
              ...examples.map(
                ({ row, text }) =>
                  `<example platform="${row.platform}" status="${row.status}"${row.author === 'me' ? ' by="mario"' : ''}>\n${text}\n</example>`
              ),
              '</voice_examples>',
            ].join('\n')
          : '',
        postIds: examples.map((e) => e.row.id),
      }
    },

    async sources(
      rows: AssetRow[],
      { maxFramesPerVideo = 4, maxImages = 12, includeAnalysis = true } = {}
    ): Promise<SourceBundle> {
      this.assertAllowed(rows)
      const blocks: string[] = []
      const images: AiContent[] = []

      for (const row of rows) {
        const p = project(row.project_id)
        const analysis = includeAnalysis ? latestAnalysis(row.id) : undefined
        const lines = [
          `<asset id="${row.id}" kind="${row.kind}" captured="${row.captured_at.slice(0, 10)}" visibility="${row.visibility}">`,
          row.title && `Title (by Mario): ${row.title}`,
          row.notes && `Notes (by Mario): ${row.notes}`,
          row.kind === 'note' && row.body && `Note text (by Mario): ${row.body}`,
          p && `Project: ${p.name}${p.is_client_work ? ' (client work)' : ''}`,
          row.original_name && `File: ${row.original_name}`,
          row.width && row.height && `Size: ${row.width}×${row.height}`,
          row.duration_ms && `Duration: ${fmtDuration(row.duration_ms)}`,
        ]
        if (row.kind === 'link' && row.url) {
          const meta = row.url_meta ? (JSON.parse(row.url_meta) as LinkMeta) : null
          lines.push(`URL: ${row.url}`)
          if (meta?.title) lines.push(`Page title: ${meta.title}`)
          if (meta?.description) lines.push(`Page description: ${meta.description}`)
          // The page couldn't be fetched: nothing is known about it beyond the URL and Mario's words.
          if (meta?.error) lines.push('Page content: not available (the page could not be fetched)')
        }
        if (analysis?.description) {
          lines.push(`Earlier AI description (unverified): ${analysis.description}`)
        }

        const assetImages =
          images.length < maxImages
            ? (await imagesFor(row, derivatives(row.id), maxFramesPerVideo)).slice(
                0,
                maxImages - images.length
              )
            : []
        if (assetImages.length) {
          lines.push(
            row.kind === 'video'
              ? `Images: ${assetImages.length} frames from this recording follow, in order.`
              : 'Image: follows.'
          )
        }
        lines.push('</asset>')

        blocks.push(lines.filter(Boolean).join('\n'))
        // Images directly follow a label so the model can tell which asset they belong to.
        if (assetImages.length) {
          images.push({ type: 'text', text: `Images for asset ${row.id}:` }, ...assetImages)
        }
      }

      return { assets: rows, text: blocks.join('\n\n'), images }
    },
  }
}

export type ContextBuilder = ReturnType<typeof createContextBuilder>
