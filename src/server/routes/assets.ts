import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { ASSET_SOURCES, VISIBILITY } from '@shared/constants.ts'
import { fileUrl, library } from '../library.ts'
import { MAX_FILE_BYTES } from '../lib/files.ts'
import { BodyTooLargeError, streamBodyToFile } from '../lib/stream-body.ts'
import { CaptureError, type Capture } from '../services/capture.ts'
import { now, type AssetStore } from '../services/assets.ts'
import type { Processor } from '../services/processing.ts'
import type { ProjectStore } from '../services/projects.ts'
import type { Ai } from '../ai/index.ts'

const textSource = z.enum(['url', 'note', 'paste', 'shortcut']).optional()

const linkBody = z.object({
  url: z.url({ protocol: /^https?$/ }),
  source: textSource,
  title: z.string().max(300).optional(),
  notes: z.string().max(20_000).optional(),
})

const noteBody = z.object({
  body: z.string().trim().min(1).max(50_000),
  source: textSource,
  title: z.string().max(300).optional(),
})

const patchBody = z.object({
  title: z.string().max(300).optional(),
  body: z.string().trim().min(1).max(50_000).optional(),
  notes: z.string().max(20_000).optional(),
  triaged: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  visibility: z.enum(VISIBILITY).optional(),
})

const uploadSource = z.enum(ASSET_SOURCES).catch('drop')

interface Deps {
  assets: AssetStore
  projects: ProjectStore
  ai: Ai
  capture: Capture
  processor: Processor
}

export function assetRoutes({ assets, projects, capture, processor, ai }: Deps) {
  return (
    new Hono()
      .get('/', (c) => {
        const scope = c.req.query('scope') === 'inbox' ? 'inbox' : 'all'
        return c.json(assets.list({ scope, projectId: c.req.query('project') || undefined }))
      })

      .get('/:id', (c) => {
        const asset = assets.get(c.req.param('id'))
        return asset ? c.json(asset) : c.json({ error: 'Asset not found' }, 404)
      })

      // Raw streamed upload — the body is the file itself, so large recordings never sit in memory.
      // Headers: X-File-Name (URI-encoded), X-Last-Modified (ms), X-Source, Content-Type.
      .post('/upload', async (c) => {
        const name = decodeURIComponent(c.req.header('x-file-name') ?? '').trim()
        if (!name) throw new CaptureError('Missing X-File-Name header')
        const declared = Number(c.req.header('content-length') ?? 0)
        if (declared > MAX_FILE_BYTES) throw new CaptureError('File is larger than 8 GB', 413)
        const body = c.req.raw.body
        if (!body) throw new CaptureError('Empty upload')

        const tmp = join(library.tmp, `${randomUUID()}.part`)
        try {
          const { size, sha256 } = await streamBodyToFile(body, tmp, MAX_FILE_BYTES).catch(
            (err) => {
              if (err instanceof BodyTooLargeError)
                throw new CaptureError('File is larger than 8 GB', 413)
              throw err
            }
          )
          if (size === 0) throw new CaptureError('Empty upload')

          const lastModified = Number(c.req.header('x-last-modified'))
          const result = await capture.importFile({
            path: tmp,
            originalName: name,
            mime: c.req.header('content-type'),
            source: uploadSource.parse(c.req.header('x-source')),
            capturedAt:
              Number.isFinite(lastModified) && lastModified > 0
                ? new Date(lastModified)
                : undefined,
            checksum: sha256,
            temporary: true,
          })
          return c.json(result, result.duplicate ? 200 : 201)
        } finally {
          await rm(tmp, { force: true })
        }
      })

      .post('/link', async (c) => {
        const input = linkBody.parse(await c.req.json())
        return c.json(capture.createLink(input), 201)
      })

      .post('/note', async (c) => {
        const input = noteBody.parse(await c.req.json())
        return c.json(capture.createNote(input), 201)
      })

      .patch('/:id', async (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        const { triaged, body, projectId, ...fields } = patchBody.parse(await c.req.json())
        if (projectId && !projects.exists(projectId)) {
          return c.json({ error: 'Project not found' }, 400)
        }
        if (body !== undefined && assets.row(id)!.kind !== 'note') {
          return c.json({ error: 'Only notes have a body' }, 400)
        }
        assets.update(id, {
          ...fields,
          ...(body === undefined ? {} : { body }),
          ...(projectId === undefined ? {} : { project_id: projectId }),
          ...(triaged === undefined ? {} : { triaged_at: triaged ? now() : null }),
        })
        return c.json(assets.get(id))
      })

      // What a template reads for this asset: a video's proxy (built on first use) or an image's
      // original (its JPEG preview for HEIC, which browsers can't decode).
      .get('/:id/render-source', async (c) => {
        const row = assets.row(c.req.param('id'))
        if (!row || (row.kind !== 'image' && row.kind !== 'video') || !row.file_path) {
          return c.json({ error: 'Not an image or video asset' }, 404)
        }
        if (row.kind === 'video') {
          const proxy = await processor.ensureProxy(row.id)
          return c.json({
            assetId: row.id,
            kind: 'video',
            url: fileUrl(proxy.file_path, proxy.created_at),
            width: proxy.width ?? row.width,
            height: proxy.height ?? row.height,
            duration: (row.duration_ms ?? 0) / 1000,
          })
        }
        const heif = /image\/hei[cf]/.test(row.mime ?? '')
        const poster = assets.derivativeRows(row.id).find((d) => d.role === 'poster')
        return c.json({
          assetId: row.id,
          kind: 'image',
          url: heif && poster ? fileUrl(poster.file_path) : fileUrl(row.file_path),
          width: row.width,
          height: row.height,
        })
      })

      .post('/:id/analyze', async (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        await ai.analyzeAsset(id)
        return c.json(assets.get(id))
      })

      .post('/:id/reprocess', (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        processor.enqueue(id)
        return c.json(assets.get(id))
      })

      .delete('/:id', async (c) => {
        await capture.remove(c.req.param('id'))
        return c.body(null, 204)
      })
  )
}
