import { Hono } from 'hono'
import { z } from 'zod'
import { POST_STATUS, SEGMENT_KINDS } from '@shared/constants.ts'
import type { Ai } from '../ai/index.ts'
import type { PostStore } from '../services/posts.ts'

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
})

const patchBody = z.object({
  status: z.enum(POST_STATUS).optional(),
  scheduledFor: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  publicUrl: z.url().nullable().optional(),
})

export function postRoutes(posts: PostStore, ai: Ai) {
  return new Hono()
    .get('/', (c) => c.json(posts.list(statusQuery.parse(c.req.query('status')))))

    .get('/:id', (c) => {
      const post = posts.detail(c.req.param('id'))
      return post ? c.json(post) : c.json({ error: 'Post not found' }, 404)
    })

    .post('/:id/revisions', async (c) => {
      const id = c.req.param('id')
      if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
      const { segments, caption } = revisionBody.parse(await c.req.json())
      posts.saveRevision(id, segments, caption)
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
      await ai.revisePost({ postId: id, instruction })
      return c.json(posts.detail(id))
    })

    .patch('/:id', async (c) => {
      const id = c.req.param('id')
      if (!posts.exists(id)) return c.json({ error: 'Post not found' }, 404)
      posts.update(id, patchBody.parse(await c.req.json()))
      return c.json(posts.detail(id))
    })
}
