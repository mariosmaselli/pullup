import { Hono } from 'hono'
import { z } from 'zod'
import { IDEA_STATUS, PLATFORMS } from '@shared/constants.ts'
import type { Ai } from '../ai/index.ts'
import type { IdeaStore } from '../services/ideas.ts'

const generateBody = z.object({
  assetIds: z.array(z.string()).min(1).max(12),
  profileId: z.string().nullable().optional(),
  instruction: z.string().max(2000).optional(),
})

const draftBody = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length).optional(),
  profileId: z.string().nullable().optional(),
  instruction: z.string().max(2000).optional(),
})

const statusQuery = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',') : ['suggested', 'saved']))
  .pipe(z.array(z.enum(IDEA_STATUS)))

export function ideaRoutes(ideas: IdeaStore, ai: Ai) {
  return new Hono()
    .get('/', (c) => c.json(ideas.list(statusQuery.parse(c.req.query('status')))))

    .post('/generate', async (c) => {
      const input = generateBody.parse(await c.req.json())
      const ids = await ai.generateIdeas(input)
      return c.json(ideas.list([...IDEA_STATUS], ids), 201)
    })

    .patch('/:id', async (c) => {
      const id = c.req.param('id')
      if (!ideas.exists(id)) return c.json({ error: 'Idea not found' }, 404)
      const { status } = z.object({ status: z.enum(IDEA_STATUS) }).parse(await c.req.json())
      ideas.setStatus(id, status)
      return c.json(ideas.list([...IDEA_STATUS], [id])[0])
    })

    .post('/:id/draft', async (c) => {
      const id = c.req.param('id')
      if (!ideas.exists(id)) return c.json({ error: 'Idea not found' }, 404)
      const input = draftBody.parse(await c.req.json())
      return c.json(await ai.draftPackage({ ideaId: id, ...input }), 201)
    })
}
