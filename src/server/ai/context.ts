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

const AI_IMAGE_WIDTH = 1600
const MAX_DIRECT_BYTES = 3.5 * 1024 * 1024
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

interface ProjectRow {
  id: string
  name: string
  description: string
  is_client_work: number
  ai_allowed: number
}

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

// One image for a still: the original when it's small and in a supported format, else a
// cached 1600 px JPEG.
async function stillImage(row: AssetRow, derivatives: DerivativeRow[]): Promise<AiContent | null> {
  if (!row.file_path || row.mime === 'image/svg+xml') return null
  const original = fromLibraryPath(row.file_path)

  if (
    row.mime &&
    DIRECT_TYPES.has(row.mime) &&
    (row.width ?? 0) <= 2576 &&
    (row.height ?? 0) <= 2576
  ) {
    const { size } = await stat(original)
    if (size <= MAX_DIRECT_BYTES) {
      return {
        type: 'image',
        mediaType: row.mime as 'image/jpeg',
        data: (await readFile(original)).toString('base64'),
      }
    }
  }

  const poster = derivatives.find((d) => d.role === 'poster')
  if (poster) return jpegContent(fromLibraryPath(poster.file_path))

  const target = join(library.cache, row.id, 'ai.jpg')
  if (!existsSync(target)) {
    if (/image\/hei[cf]/.test(row.mime ?? ''))
      await sipsToJpeg(original, target, AI_IMAGE_WIDTH, row.width)
    else await extractFrame(original, target, null, AI_IMAGE_WIDTH)
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
    // Throws if any asset belongs to a project with AI analysis turned off.
    assertAllowed(rows: AssetRow[]) {
      for (const row of rows) {
        const p = project(row.project_id)
        if (p && !p.ai_allowed) {
          throw new AiError(
            `“${p.name}” has AI analysis turned off. Allow it on the project page first.`,
            403
          )
        }
      }
    },

    describeProject(id: string | null): string {
      const p = project(id)
      if (!p) return ''
      return [
        `<project id="${p.id}" name="${attr(p.name)}"${p.is_client_work ? ' client_work="true"' : ''}>`,
        p.description || '(no description)',
        '</project>',
      ].join('\n')
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
