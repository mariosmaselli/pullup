import { randomUUID } from 'node:crypto'
import { open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Aspect, Render, TemplateInputs } from '@shared/template.ts'
import type { DB } from '../db/index.ts'
import { extractFrame, probeStreams, retagBt709 } from '../lib/ffmpeg.ts'
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
  status: r.status,
  error: r.error,
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

export function createRenderStore(db: DB) {
  const row = (id: string) =>
    db.prepare('SELECT * FROM renders WHERE id = ?').get(id) as RenderRow | undefined

  return {
    create(input: NewRender): Render {
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

    // Renders left 'pending' by a closed tab or a crash never finish — mark them failed.
    failStale(olderThanMinutes = 10) {
      const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
      return db
        .prepare(
          "UPDATE renders SET status = 'failed', error = 'Interrupted before it finished' WHERE status = 'pending' AND created_at < ?"
        )
        .run(cutoff).changes
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
