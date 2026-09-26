import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { ASSET_KINDS, ASSET_SOURCES, VISIBILITY } from '@shared/constants.ts'
import type { BulkDeleteResult, LinkMeta } from '@shared/types.ts'
import { fileUrl, fromLibraryPath, library } from '../library.ts'
import { MAX_FILE_BYTES } from '../lib/files.ts'
import { BodyTooLargeError, streamBodyToFile } from '../lib/stream-body.ts'
import { CaptureError, type Capture } from '../services/capture.ts'
import { normalizeTags, now, type AssetRow, type AssetStore } from '../services/assets.ts'
import { inboxIssues, retryInboxFile, trashInboxFile } from '../services/inbox-watcher.ts'
import type { Processor } from '../services/processing.ts'
import type { ProjectStore } from '../services/projects.ts'
import type { Ai } from '../ai/index.ts'

const textSource = z.enum(['url', 'note', 'paste', 'shortcut']).optional()
const captureProject = z.string().max(100).nullable().optional()

const linkBody = z.object({
  url: z.url({ protocol: /^https?$/ }),
  source: textSource,
  title: z.string().max(300).optional(),
  notes: z.string().max(20_000).optional(),
  projectId: captureProject,
})

const noteBody = z.object({
  body: z.string().trim().min(1).max(50_000),
  source: textSource,
  title: z.string().max(300).optional(),
  projectId: captureProject,
})

const tagList = z.array(z.string().max(40)).max(40)

const patchBody = z.object({
  title: z.string().max(300).optional(),
  body: z.string().trim().min(1).max(50_000).optional(),
  notes: z.string().max(20_000).optional(),
  triaged: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  visibility: z.enum(VISIBILITY).optional(),
  tags: tagList.optional(),
})

// Library search and filters. Invalid values are ignored rather than failing the list.
const listQuery = z.object({
  scope: z.enum(['inbox', 'all']).catch('all'),
  project: z.string().max(100).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  kind: z.enum(ASSET_KINDS).optional().catch(undefined),
  visibility: z.enum(VISIBILITY).optional().catch(undefined),
  tag: z.string().max(40).optional().catch(undefined),
})

const idList = z.array(z.string().max(100)).min(1).max(500)

const bulkBody = z.object({
  ids: idList,
  projectId: z.string().nullable().optional(),
  triaged: z.boolean().optional(),
})

const fileName = z.object({ name: z.string().min(1).max(255) })

const uploadSource = z.enum(ASSET_SOURCES).catch('drop')

interface Deps {
  assets: AssetStore
  projects: ProjectStore
  ai: Ai
  capture: Capture
  processor: Processor
}

// A name for lists and messages: what Mario typed, else what the source gives.
function displayTitle(row: AssetRow): string {
  if (row.title) return row.title
  if (row.kind === 'link' && row.url) {
    const meta = row.url_meta ? (JSON.parse(row.url_meta) as LinkMeta) : null
    return meta?.title ?? row.url
  }
  if (row.kind === 'note') return row.body?.split('\n')[0]?.slice(0, 80) ?? 'Note'
  return row.original_name ?? 'Untitled'
}

export function assetRoutes({ assets, projects, capture, processor, ai }: Deps) {
  // Capture from a project page lands in that project; an unknown id never blocks a capture.
  const knownProject = (id: string | null | undefined) => (id && projects.exists(id) ? id : null)

  return (
    new Hono()
      .get('/', (c) => {
        const query = listQuery.parse(c.req.query())
        return c.json(
          assets.list({
            scope: query.scope,
            projectId: query.project || undefined,
            q: query.q,
            kind: query.kind,
            visibility: query.visibility,
            tag: query.tag || undefined,
          })
        )
      })

      .get('/tags', (c) => c.json(assets.tags()))

      // Files in the inbox folder that couldn't be imported, with the reason.
      .get('/inbox-issues', async (c) => c.json(await inboxIssues()))

      .post('/inbox-issues/retry', async (c) => {
        const { name } = fileName.parse(await c.req.json())
        if (!retryInboxFile(name)) return c.json({ error: 'Not in the inbox folder list' }, 404)
        return c.json({ ok: true })
      })

      .post('/inbox-issues/trash', async (c) => {
        const { name } = fileName.parse(await c.req.json())
        if (!(await trashInboxFile(name))) {
          return c.json({ error: 'Not in the inbox folder list' }, 404)
        }
        return c.json({ ok: true })
      })

      // Several assets at once (Library / Inbox selection): project and reviewed state.
      .post('/bulk', async (c) => {
        const { ids, projectId, triaged } = bulkBody.parse(await c.req.json())
        if (projectId && !projects.exists(projectId)) {
          return c.json({ error: 'Project not found' }, 400)
        }
        const rows = assets.rows(ids)
        const found = rows.map((r) => r.id)
        if (projectId !== undefined) assets.updateMany(found, { project_id: projectId })
        if (triaged === true) {
          // Keep the first review time of anything already reviewed.
          const fresh = rows.filter((r) => !r.triaged_at).map((r) => r.id)
          assets.updateMany(fresh, { triaged_at: now() })
        }
        if (triaged === false) assets.updateMany(found, { triaged_at: null })
        return c.json({ updated: found.length })
      })

      // Deletes what it can; assets used in posts are reported back instead.
      .post('/bulk-delete', async (c) => {
        const { ids } = z.object({ ids: idList }).parse(await c.req.json())
        const result: BulkDeleteResult = { deleted: [], blocked: [] }
        for (const row of assets.rows(ids)) {
          try {
            await capture.remove(row.id)
            result.deleted.push(row.id)
          } catch (err) {
            if (!(err instanceof CaptureError)) throw err
            result.blocked.push({ id: row.id, title: displayTitle(row), reason: err.message })
          }
        }
        return c.json(result)
      })

      // Rebuilds thumbnails and previews whose files were deleted from cache/.
      .post('/repair', (c) => c.json({ queued: processor.repairMissing().length }))

      .get('/:id', (c) => {
        const asset = assets.get(c.req.param('id'))
        return asset ? c.json(asset) : c.json({ error: 'Asset not found' }, 404)
      })

      // Posts that show this asset and ideas that cite it.
      .get('/:id/usage', (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        return c.json(assets.usage(id))
      })

      // Raw streamed upload — the body is the file itself, so large recordings never sit in memory.
      // Headers: X-File-Name (URI-encoded), X-Last-Modified (ms), X-Source, X-Project-Id,
      // Content-Type.
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
            projectId: knownProject(c.req.header('x-project-id')),
          })
          return c.json(result, result.duplicate ? 200 : 201)
        } finally {
          await rm(tmp, { force: true })
        }
      })

      .post('/link', async (c) => {
        const { projectId, ...input } = linkBody.parse(await c.req.json())
        return c.json(capture.createLink({ ...input, projectId: knownProject(projectId) }), 201)
      })

      .post('/note', async (c) => {
        const { projectId, ...input } = noteBody.parse(await c.req.json())
        return c.json(capture.createNote({ ...input, projectId: knownProject(projectId) }), 201)
      })

      .patch('/:id', async (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        const { triaged, body, projectId, tags, ...fields } = patchBody.parse(await c.req.json())
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
          ...(tags === undefined ? {} : { tags: JSON.stringify(normalizeTags(tags)) }),
        })
        return c.json(assets.get(id))
      })

      // What a template reads for this asset: a video's proxy (built on first use) or an image's
      // original (its JPEG preview for HEIC, which browsers can't decode). Cached files deleted
      // from cache/ are rebuilt first.
      .get('/:id/render-source', async (c) => {
        const row = assets.row(c.req.param('id'))
        if (!row || (row.kind !== 'image' && row.kind !== 'video') || !row.file_path) {
          return c.json({ error: 'Not an image or video asset' }, 404)
        }
        if (!existsSync(fromLibraryPath(row.file_path))) {
          return c.json({ error: `The original file is missing (${row.file_path})` }, 404)
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
        if (heif) await processor.ensureDerivatives(row.id)
        const poster = assets.derivativeRows(row.id).find((d) => d.role === 'poster')
        return c.json({
          assetId: row.id,
          kind: 'image',
          url:
            heif && poster ? fileUrl(poster.file_path, poster.created_at) : fileUrl(row.file_path),
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

      // A preview failed to load in the browser: rebuild this asset's cached files if they're gone.
      .post('/:id/repair', (c) => {
        const id = c.req.param('id')
        if (!assets.row(id)) return c.json({ error: 'Asset not found' }, 404)
        return c.json({ queued: processor.repairMissing([id]).length > 0 })
      })

      .delete('/:id', async (c) => {
        try {
          await capture.remove(c.req.param('id'))
        } catch (err) {
          // A blocked delete says why and lists the posts in the way.
          if (err instanceof CaptureError && err.details) {
            return c.json({ error: err.message, ...err.details }, err.status)
          }
          throw err
        }
        return c.body(null, 204)
      })
  )
}
