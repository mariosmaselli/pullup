import { rm } from 'node:fs/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import { ASPECT_SIZE, type Aspect } from '@shared/template.ts'
import { BodyTooLargeError, streamBodyToFile } from '../lib/stream-body.ts'
import type { RenderStore } from '../services/renders.ts'

const ASPECTS = Object.keys(ASPECT_SIZE) as [Aspect, ...Aspect[]]
const MAX_RENDER_BYTES = 500 * 1024 * 1024

const createBody = z.object({
  templateId: z.string().regex(/^[a-z0-9-]+$/),
  templateVersion: z.number().int().min(1),
  kind: z.enum(['video', 'image']),
  aspect: z.enum(ASPECTS),
  fps: z.number().int().min(1).max(60).nullable().optional(),
  inputs: z.object({
    aspect: z.enum(ASPECTS),
    duration: z.number().min(0).max(600),
    media: z
      .array(
        z.object({
          assetId: z.string(),
          kind: z.enum(['image', 'video']),
          url: z.string(),
          width: z.number(),
          height: z.number(),
          duration: z.number().optional(),
        })
      )
      .max(20),
    text: z.record(z.string(), z.string().max(4000)),
    params: z.record(z.string(), z.unknown()),
    seed: z.number(),
  }),
  postId: z.string().nullable().optional(),
  segmentIndex: z.number().int().min(0).nullable().optional(),
})

export function renderRoutes(renders: RenderStore) {
  return (
    new Hono()
      .get('/', (c) => c.json(renders.list({ postId: c.req.query('post') || undefined })))

      .get('/:id', (c) => {
        const render = renders.get(c.req.param('id'))
        return render ? c.json(render) : c.json({ error: 'Render not found' }, 404)
      })

      // Step 1: register what is being rendered (so the inputs are kept even if encoding fails).
      .post('/', async (c) => {
        const input = createBody.parse(await c.req.json())
        const { width, height } = ASPECT_SIZE[input.aspect]
        return c.json(renders.create({ ...input, width, height }), 201)
      })

      // Step 2: upload the encoded file (raw body: video/mp4 or image/jpeg).
      .put('/:id/file', async (c) => {
        const id = c.req.param('id')
        const render = renders.get(id)
        if (!render) return c.json({ error: 'Render not found' }, 404)
        if (render.status === 'ready') return c.json({ error: 'Render already has a file' }, 409)
        const expected = render.kind === 'video' ? 'video/mp4' : 'image/jpeg'
        if (c.req.header('content-type') !== expected) {
          return c.json({ error: `Expected ${expected}` }, 415)
        }
        const body = c.req.raw.body
        if (!body) return c.json({ error: 'Empty upload' }, 400)

        const tmp = renders.tmpPathFor(id)
        try {
          const { size } = await streamBodyToFile(body, tmp, MAX_RENDER_BYTES)
          if (!size) return c.json({ error: 'Empty upload' }, 400)
        } catch (err) {
          await rm(tmp, { force: true })
          if (err instanceof BodyTooLargeError) return c.json({ error: 'Render is too large' }, 413)
          throw err
        }
        const elapsed = Number(c.req.header('x-render-elapsed-ms'))
        return c.json(
          await renders.attachFile(id, tmp, {
            encoder: c.req.header('x-render-encoder') ?? undefined,
            elapsedMs: Number.isFinite(elapsed) ? elapsed : undefined,
          })
        )
      })

      .post('/:id/fail', async (c) => {
        const { error } = z.object({ error: z.string().max(2000) }).parse(await c.req.json())
        renders.fail(c.req.param('id'), error)
        return c.json(renders.get(c.req.param('id')))
      })

      .delete('/:id', async (c) => {
        const removed = await renders.remove(c.req.param('id'))
        return removed ? c.body(null, 204) : c.json({ error: 'Render not found' }, 404)
      })
  )
}
