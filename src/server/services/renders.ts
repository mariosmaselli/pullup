import { randomUUID } from 'node:crypto'
import { open, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  EXPORT_FORMATS,
  EXPORT_PRESET_IDS,
  exportSize,
  type ExportFormat,
  type ExportPreset,
  type RenderExport,
  type RenderWithExports,
} from '@shared/render-exports.ts'
import type { Aspect, Render, TemplateInputs } from '@shared/template.ts'
import type { DB } from '../db/index.ts'
import { extractFrame, makeAnimatedWebp, makeGif, probeStreams, retagBt709 } from '../lib/ffmpeg.ts'
import { moveFile } from '../lib/files.ts'
import { notify } from '../lib/events.ts'
import { fileUrl, fromLibraryPath, library, toLibraryPath } from '../library.ts'

interface RenderRow {
  id: string
  template_id: string
  template_version: number
  kind: 'video' | 'image'
  aspect: Aspect
  width: number
  height: number
  fps: number | null
  duration_ms: number | null
  inputs: string
  status: Render['status']
  error: string | null
  warnings: string
  file_path: string | null
  poster_path: string | null
  size_bytes: number | null
  encoder: string | null
  elapsed_ms: number | null
  post_id: string | null
  segment_index: number | null
  created_at: string
}

// A render is 'pending' while its page encodes it (seconds, a few minutes for a long clip). One
// whose page was closed or reloaded mid-render never finishes: past this age it reads as failed
// (a late upload still completes it), and is stored as failed at the next start or new render.
export const STALE_RENDER_MS = 10 * 60_000
const STALE_ERROR = 'Interrupted before it finished'

const isStale = (r: RenderRow, now = Date.now()) =>
  r.status === 'pending' && Date.parse(r.created_at) < now - STALE_RENDER_MS

const toRender = (r: RenderRow): Render => ({
  id: r.id,
  templateId: r.template_id,
  templateVersion: r.template_version,
  kind: r.kind,
  aspect: r.aspect,
  width: r.width,
  height: r.height,
  fps: r.fps,
  durationMs: r.duration_ms,
  inputs: JSON.parse(r.inputs),
  status: isStale(r) ? 'failed' : r.status,
  error: isStale(r) ? STALE_ERROR : r.error,
  warnings: JSON.parse(r.warnings),
  url: r.file_path ? fileUrl(r.file_path) : null,
  posterUrl: r.poster_path ? fileUrl(r.poster_path) : null,
  sizeBytes: r.size_bytes,
  elapsedMs: r.elapsed_ms,
  postId: r.post_id,
  segmentIndex: r.segment_index,
  createdAt: r.created_at,
})

export interface NewRender {
  templateId: string
  templateVersion: number
  kind: 'video' | 'image'
  aspect: Aspect
  width: number
  height: number
  fps?: number | null
  inputs: TemplateInputs
  postId?: string | null
  segmentIndex?: number | null
}

// Reads the order of the top-level MP4 boxes: platforms want `moov` before `mdat` (fast start).
async function moovFirst(path: string): Promise<boolean> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    let offset = 0
    const header = Buffer.alloc(16)
    while (offset < size) {
      await file.read(header, 0, 16, offset)
      let boxSize = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8))
      if (boxSize < 8) return false
      offset += boxSize
    }
    return false
  } finally {
    await file.close()
  }
}

// Checks a rendered file against what Instagram (the strictest target) accepts. Returns
// human-readable warnings; nothing here blocks saving the render.
async function validate(path: string, kind: Render['kind'], sizeBytes: number) {
  const warnings: string[] = []
  const info = await probeStreams(path)
  const video = info.video
  if (!video) return { warnings: ['No video stream found'], info }

  if (kind === 'image') {
    if (sizeBytes > 8 * 1024 * 1024) warnings.push('Image is over 8 MB (Instagram limit)')
    return { warnings, info }
  }

  if (video.codec !== 'h264') warnings.push(`Codec is ${video.codec}, expected H.264`)
  if (video.pixFmt !== 'yuv420p') warnings.push(`Pixel format is ${video.pixFmt}, expected yuv420p`)
  if ((video.width ?? 0) > 1920) warnings.push('Wider than 1920 px')
  if (video.fps && (video.fps < 23 || video.fps > 60))
    warnings.push(`${video.fps} fps is outside 23–60`)
  if (video.hasBFrames) warnings.push('Contains B-frames')
  const seconds = (info.durationMs ?? 0) / 1000
  if (seconds && seconds < 3)
    warnings.push('Shorter than 3 s (Instagram minimum for stories/reels)')
  if (seconds > 60) warnings.push('Longer than 60 s — a story takes one 60 s segment per frame')
  if (info.peakBitrate && info.peakBitrate > 25_000_000) {
    warnings.push(
      `Peak bitrate ${(info.peakBitrate / 1e6).toFixed(1)} Mbps is over Instagram's 25 Mbps`
    )
  }
  if (!(await moovFirst(path))) warnings.push('Index (moov) is not at the start of the file')
  return { warnings, info }
}

// ── GIF / animated WebP exports ──────────────────────────────────────────────────────────────
// Rebuildable derivatives of a video render, stored next to its MP4 and named after what they
// contain ("slow-zoom-1a2b3c4d.480x853-15fps.gif") — a preset that changes size makes a new file.

export class RenderExportError extends Error {
  constructor(
    public status: 404 | 409,
    message: string
  ) {
    super(message)
  }
}

const X_GIF_LIMIT = 15 * 1024 * 1024
const EXPORT_NAME = /^\d+x\d+-\d+fps\.(gif|webp)$/

function exportWarnings(format: ExportFormat, sizeBytes: number): string[] {
  if (format === 'webp') return ['WebP isn’t accepted by X or Instagram — post the MP4 there']
  if (sizeBytes > X_GIF_LIMIT) return ['Over X’s 15 MB GIF limit on the web — try a smaller size']
  return []
}

// Library-relative path of an export, next to the render's MP4.
function exportPath(r: RenderRow, format: ExportFormat, preset: ExportPreset) {
  const { width, height, fps } = exportSize(r, preset)
  return r.file_path!.replace(/\.mp4$/, `.${width}x${height}-${fps}fps.${format}`)
}

export function createRenderStore(db: DB) {
  const row = (id: string) =>
    db.prepare('SELECT * FROM renders WHERE id = ?').get(id) as RenderRow | undefined

  // Exports being made, by "<render id>:<format>:<preset>" — progress for GET, and one ffmpeg
  // run per file however many times it is asked for.
  const exporting = new Map<string, { progress: number; done: Promise<RenderExport> }>()

  const describeExport = (
    r: RenderRow,
    format: ExportFormat,
    preset: ExportPreset,
    file: { size: number; mtimeMs: number }
  ): RenderExport => ({
    format,
    preset,
    status: 'ready',
    progress: null,
    ...exportSize(r, preset),
    url: fileUrl(exportPath(r, format, preset), String(Math.round(file.mtimeMs))),
    sizeBytes: file.size,
    warnings: exportWarnings(format, file.size),
  })

  async function listExports(r: RenderRow): Promise<RenderExport[]> {
    if (r.kind !== 'video' || !r.file_path) return []
    const found: RenderExport[] = []
    for (const format of EXPORT_FORMATS) {
      for (const preset of EXPORT_PRESET_IDS) {
        const job = exporting.get(`${r.id}:${format}:${preset}`)
        if (job) {
          found.push({
            format,
            preset,
            status: 'pending',
            progress: job.progress,
            ...exportSize(r, preset),
            url: null,
            sizeBytes: null,
            warnings: [],
          })
          continue
        }
        const file = await stat(fromLibraryPath(exportPath(r, format, preset))).catch(() => null)
        if (file?.size) found.push(describeExport(r, format, preset, file))
      }
    }
    return found
  }

  return {
    create(input: NewRender): Render {
      this.failStale()
      const id = randomUUID()
      db.prepare(
        `INSERT INTO renders (id, template_id, template_version, kind, aspect, width, height, fps,
           duration_ms, inputs, post_id, segment_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        input.templateId,
        input.templateVersion,
        input.kind,
        input.aspect,
        input.width,
        input.height,
        input.fps ?? null,
        input.kind === 'video' ? Math.round(input.inputs.duration * 1000) : null,
        JSON.stringify(input.inputs),
        input.postId ?? null,
        input.segmentIndex ?? null
      )
      return this.get(id)!
    },

    get(id: string): Render | undefined {
      const r = row(id)
      return r ? toRender(r) : undefined
    },

    // A render plus its GIF / WebP exports (made, or being made).
    async detail(id: string): Promise<RenderWithExports | undefined> {
      const r = row(id)
      return r ? { ...toRender(r), exports: await listExports(r) } : undefined
    },

    // Makes (or reuses) a looping GIF / animated WebP of a finished video render.
    async exportAnimation(
      id: string,
      format: ExportFormat,
      preset: ExportPreset
    ): Promise<RenderExport> {
      const r = row(id)
      if (!r) throw new RenderExportError(404, 'Render not found')
      if (r.kind !== 'video') {
        throw new RenderExportError(409, 'Only video renders can be exported as GIF or WebP')
      }
      if (r.status !== 'ready' || !r.file_path) {
        throw new RenderExportError(409, 'Render has no finished file yet')
      }

      const key = `${id}:${format}:${preset}`
      const running = exporting.get(key)
      if (running) return running.done
      const target = fromLibraryPath(exportPath(r, format, preset))
      const existing = await stat(target).catch(() => null)
      if (existing?.size) return describeExport(r, format, preset, existing)
      // Checked again: another request may have started it while this one was looking.
      const started = exporting.get(key)
      if (started) return started.done

      const job = { progress: 0 } as { progress: number; done: Promise<RenderExport> }
      job.done = (async () => {
        const scratch = join(library.tmp, `export-${id.slice(0, 8)}-${randomUUID().slice(0, 8)}`)
        const tmp = `${scratch}.${format}`
        const options = {
          ...exportSize(r, preset),
          durationMs: r.duration_ms,
          onProgress: (fraction: number) => (job.progress = fraction),
        }
        try {
          const source = fromLibraryPath(r.file_path!)
          if (format === 'gif') await makeGif(source, tmp, `${scratch}.palette.png`, options)
          else await makeAnimatedWebp(source, tmp, options)
          await moveFile(tmp, target)
        } finally {
          await rm(tmp, { force: true })
          await rm(`${scratch}.palette.png`, { force: true })
        }
        // Deleted while it was being made: don't leave an orphan behind.
        if (!row(id)) {
          await rm(target, { force: true })
          throw new RenderExportError(404, 'Render not found')
        }
        notify('renders')
        return describeExport(r, format, preset, await stat(target))
      })().finally(() => exporting.delete(key))
      exporting.set(key, job)
      return job.done
    },

    list(filter: { postId?: string; limit?: number } = {}): Render[] {
      const rows = filter.postId
        ? (db
            .prepare('SELECT * FROM renders WHERE post_id = ? ORDER BY created_at DESC')
            .all(filter.postId) as RenderRow[])
        : (db
            .prepare('SELECT * FROM renders ORDER BY created_at DESC LIMIT ?')
            .all(filter.limit ?? 50) as RenderRow[])
      return rows.map(toRender)
    },

    // Takes ownership of an uploaded temp file: retags it, checks it, makes a poster, stores it.
    async attachFile(
      id: string,
      tmpPath: string,
      meta: { encoder?: string; elapsedMs?: number }
    ): Promise<Render> {
      const r = row(id)
      if (!r) throw new Error('Render not found')
      const now = new Date()
      const dir = join(
        library.renders,
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, '0')
      )
      const ext = r.kind === 'video' ? 'mp4' : 'jpg'
      const target = join(dir, `${r.template_id}-${id.slice(0, 8)}.${ext}`)

      try {
        if (r.kind === 'video') {
          // WebCodecs tags the transfer as sRGB; BT.709 is what platforms expect. Lossless.
          const retagged = `${tmpPath}.bt709.mp4`
          await retagBt709(tmpPath, retagged)
          await rm(tmpPath, { force: true })
          await moveFile(retagged, target)
        } else {
          await moveFile(tmpPath, target)
        }
        const { size } = await stat(target)
        const { warnings, info } = await validate(target, r.kind, size)

        let posterPath: string | null = null
        if (r.kind === 'video') {
          posterPath = target.replace(/\.mp4$/, '.poster.jpg')
          const at = Math.min(500, Math.max(0, (info.durationMs ?? 0) - 100))
          await extractFrame(target, posterPath, at, 1080)
        }

        db.prepare(
          `UPDATE renders SET status = 'ready', error = NULL, warnings = ?, file_path = ?, poster_path = ?,
             size_bytes = ?, encoder = ?, elapsed_ms = ?, duration_ms = coalesce(?, duration_ms)
           WHERE id = ?`
        ).run(
          JSON.stringify(warnings),
          toLibraryPath(target),
          posterPath ? toLibraryPath(posterPath) : null,
          size,
          meta.encoder ?? null,
          meta.elapsedMs ?? null,
          r.kind === 'video' ? (info.durationMs ?? null) : null,
          id
        )
      } catch (err) {
        await rm(tmpPath, { force: true })
        const message = err instanceof Error ? err.message : String(err)
        db.prepare("UPDATE renders SET status = 'failed', error = ? WHERE id = ?").run(
          message.slice(0, 500),
          id
        )
      }
      notify('renders')
      return this.get(id)!
    },

    // Stores renders left 'pending' by a closed tab or a crash as failed (they already read as
    // failed, see STALE_RENDER_MS).
    failStale(olderThanMs = STALE_RENDER_MS) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString()
      return db
        .prepare(
          "UPDATE renders SET status = 'failed', error = ? WHERE status = 'pending' AND created_at < ?"
        )
        .run(STALE_ERROR, cutoff).changes
    },

    fail(id: string, error: string) {
      db.prepare("UPDATE renders SET status = 'failed', error = ? WHERE id = ?").run(
        error.slice(0, 500),
        id
      )
      notify('renders')
    },

    // Renders are rebuildable outputs, but files still go to trash rather than being deleted.
    async remove(id: string) {
      const r = row(id)
      if (!r) return false
      for (const path of [r.file_path, r.poster_path]) {
        if (!path) continue
        const absolute = fromLibraryPath(path)
        await moveFile(
          absolute,
          join(library.trash, `render-${id.slice(0, 8)}-${absolute.split('/').pop()}`)
        ).catch((err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
      }
      // GIF / WebP exports are derivatives: rebuildable, so they go (not to trash).
      if (r.file_path) {
        const absolute = fromLibraryPath(r.file_path)
        const prefix = `${basename(absolute, '.mp4')}.`
        const names = await readdir(dirname(absolute)).catch(() => [] as string[])
        for (const name of names) {
          if (name.startsWith(prefix) && EXPORT_NAME.test(name.slice(prefix.length))) {
            await rm(join(dirname(absolute), name), { force: true })
          }
        }
      }
      db.prepare('DELETE FROM renders WHERE id = ?').run(id)
      notify('renders')
      return true
    },

    // Used by the upload route to place a finished file next to the others before attaching.
    tmpPathFor(id: string) {
      return join(library.tmp, `render-${id}.part`)
    },
  }
}

export type RenderStore = ReturnType<typeof createRenderStore>
