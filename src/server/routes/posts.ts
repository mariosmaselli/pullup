import { Hono } from 'hono'
import { z } from 'zod'
import { PLATFORMS, POST_STATUS, SEGMENT_KINDS } from '@shared/constants.ts'
import type { Ai } from '../ai/index.ts'
import type { PostStore } from '../services/posts.ts'
import type { RenderStore } from '../services/renders.ts'
import { zipFiles } from '../lib/zip.ts'
import { MAX_FRAME_MEDIA, renderForFrame } from '@shared/frames.ts'
import { fromLibraryPath } from '../library.ts'

const statusQuery = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',') : ['draft', 'review', 'approved', 'scheduled']))
  .pipe(z.array(z.enum(POST_STATUS)))

const revisionBody = z.object({
  segments: z
    .array(
      z.object({
        text: z.string().max(4000),
        assetId: z.string().nullable().optional(),
        kind: z.enum(SEGMENT_KINDS).nullable().optional(),
        // The frame's media in order (Instagram); cleaned and deduplicated by the post store.
        assetIds: z.array(z.string()).max(MAX_FRAME_MEDIA).nullable().optional(),
        template: z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            params: z.record(z.string(), z.unknown()).optional(),
            duration: z.number().min(0).max(600).optional(),
            // Background image/video (counts as frame media for privacy, see frameMediaIds).
            background: z.object({ assetId: z.string() }).nullable().optional(),
            // The template's other text fields (corner labels), see FrameTemplate.text.
            text: z.record(z.string(), z.string().max(4000)).optional(),
          })
          .nullable()
          .optional(),
      })
    )
    .min(1)
    .max(25),
  // Counted in characters (code points), like the editor's counter.
  caption: z
    .string()
    .refine((v) => [...v].length <= 2200, 'Caption is over 2,200 characters')
    .nullable()
    .optional(),
  // Positions of the 'unconfirmed' claims Mario has checked off (see PostStore.saveRevision).
  confirmedClaims: z.array(z.number().int().min(0)).max(200).optional(),
})

const isoDate = z.iso.datetime({ offset: true })

const patchBody = z.object({
  status: z.enum(POST_STATUS).optional(),
  scheduledFor: isoDate.nullable().optional(),
  publishedAt: isoDate.nullable().optional(),
  publicUrl: z.url().nullable().optional(),
  // A local calendar day (YYYY-MM-DD): pencilled in, not scheduled.
  plannedFor: z.iso.date().nullable().optional(),
  projectId: z.string().nullable().optional(),
})

// ── Made by hand (no AI) ──────────────────────────────────────────────────────────────────────

const createBody = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length),
  projectId: z.string().nullable().optional(),
  ideaId: z.string().nullable().optional(),
})

const logBody = z
  .object({
    platform: z.enum(PLATFORMS),
    text: z.string().max(4000),
    publicUrl: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .optional(),
    publishedAt: isoDate,
    assetIds: z.array(z.string()).max(10).default([]),
    projectId: z.string().nullable().optional(),
    // "It's posted already": make its private media public.
    approveMedia: z.boolean().optional(),
  })
  .refine((b) => b.text.trim() || b.assetIds.length, 'Add the post’s text or media')
  .refine(
    (b) => b.platform !== 'ig_feed' || [...b.text].length <= 2200,
    'Caption is over 2,200 characters'
  )

const mediaBody = z.object({ assetIds: z.array(z.string()).max(20) })

export function postRoutes(posts: PostStore, ai: Ai, renders: RenderStore) {
  return (
    new Hono()
      .get('/', (c) =>
        c.json(
          posts.list(statusQuery.parse(c.req.query('status')), c.req.query('project') || undefined)
        )
      )

      // Blank drafts, one per platform (works with AI off).
      .post('/', async (c) => {
        const postIds = posts.create(createBody.parse(await c.req.json()))
        return c.json({ postIds }, 201)
      })

      // Record a post that went out without Pullup.
      .post('/log', async (c) => {
        const id = posts.logPublished(logBody.parse(await c.req.json()))
        return c.json(posts.detail(id), 201)
      })

      // X / LinkedIn attached media: the full list, in order.
      .put('/:id/media', async (c) => {
        const id = c.req.param('id')
        if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
        posts.setMedia(id, mediaBody.parse(await c.req.json()).assetIds)
        return c.json(posts.detail(id))
      })

      .post('/:id/approve-media', (c) => {
        const id = c.req.param('id')
        if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
        posts.approveMedia(id)
        return c.json(posts.detail(id))
      })

      // Every Instagram frame's current render, in order, zipped — ready to AirDrop and post.
      .get('/:id/frames.zip', async (c) => {
        const post = posts.detail(c.req.param('id'))
        if (!post) return c.json({ error: 'Post not found' }, 404)
        const all = renders.list({ postId: post.id })
        const entries: { path: string; name: string }[] = []
        const missing: number[] = []
        post.current?.segments.forEach((frame, i) => {
          const { render, current } = renderForFrame(all, frame, i)
          if (!render?.url || !current) return void missing.push(i + 1)
          const ext = render.kind === 'video' ? 'mp4' : 'jpg'
          const noun = post.platform === 'ig_feed' ? 'slide' : 'frame'
          entries.push({
            path: fromLibraryPath(render.url.replace('/api/files/', '')),
            name: `${String(i + 1).padStart(2, '0')}-${noun}.${ext}`,
          })
        })
        if (!entries.length) return c.json({ error: 'No rendered frames yet' }, 409)
        const texts: { name: string; content: string }[] = []
        if (post.platform === 'ig_feed' && post.current?.caption) {
          texts.push({ name: 'caption.txt', content: post.current.caption })
        }
        if (missing.length) {
          texts.push({
            name: 'MISSING.txt',
            content: `Not rendered or out of date: ${missing.join(', ')}\n`,
          })
        }
        const zip = await zipFiles(entries, texts)
        const label = post.platform === 'ig_feed' ? 'carousel' : 'story'
        return c.body(zip, 200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="pullup-${label}-${post.id.slice(0, 8)}.zip"`,
        })
      })

      .get('/:id', (c) => {
        const post = posts.detail(c.req.param('id'))
        return post ? c.json(post) : c.json({ error: 'Post not found' }, 404)
      })

      .post('/:id/revisions', async (c) => {
        const id = c.req.param('id')
        if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
        const { segments, caption, confirmedClaims } = revisionBody.parse(await c.req.json())
        posts.saveRevision(id, segments, caption, confirmedClaims)
        return c.json(posts.detail(id), 201)
      })

      .post('/:id/restore/:revisionId', (c) => {
        const id = c.req.param('id')
        if (!posts.restoreRevision(id, c.req.param('revisionId'))) {
          return c.json({ error: 'Revision not found' }, 404)
        }
        return c.json(posts.detail(id))
      })

      .post('/:id/revise', async (c) => {
        const id = c.req.param('id')
        if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
        const { instruction } = z
          .object({ instruction: z.string().trim().min(1).max(2000) })
          .parse(await c.req.json())
        // A client project with AI off never reaches the provider, even with no source assets.
        const blockedBy = posts.aiBlockedBy(id)
        if (blockedBy) {
          return c.json(
            { error: `“${blockedBy}” has AI turned off. Allow it on the project page first.` },
            403
          )
        }
        await ai.revisePost({ postId: id, instruction })
        return c.json(posts.detail(id))
      })

      .patch('/:id', async (c) => {
        const id = c.req.param('id')
        if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
        posts.update(id, patchBody.parse(await c.req.json()))
        return c.json(posts.detail(id))
      })
  )
}
