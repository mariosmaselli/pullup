import { Hono } from 'hono'
import { z } from 'zod'
import { ANGLES, IDEA_STATUS, PLATFORMS } from '@shared/constants.ts'
import type { Ai } from '../ai/index.ts'
import { IdeaInputError, type IdeaStore } from '../services/ideas.ts'

// Every idea source list is capped like the AI's (the model sees at most this many assets).
const MAX_SOURCES = 12

const generateBody = z
  .object({
    assetIds: z.array(z.string()).min(1).max(MAX_SOURCES).optional(),
    // A whole project's material (the task picks up to MAX_SOURCES of its assets).
    projectId: z.string().optional(),
    profileId: z.string().nullable().optional(),
    instruction: z.string().trim().max(2000).optional(),
  })
  .refine((b) => b.assetIds?.length || b.projectId, 'Send assetIds or a projectId')

const draftBody = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length).optional(),
  profileId: z.string().nullable().optional(),
  instruction: z.string().trim().max(2000).optional(),
})

// An idea written by hand. Reels have no platform yet, so they're not offered.
const createBody = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(4000).optional(),
  angle: z.enum(ANGLES).nullable().optional(),
  format: z.enum(['single', 'thread', 'story_seq', 'carousel']).nullable().optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
  assetIds: z.array(z.string()).max(MAX_SOURCES).optional(),
  projectId: z.string().nullable().optional(),
})

const patchBody = z.object({
  status: z.enum(IDEA_STATUS).optional(),
  // Answers to the idea's questions, by position.
  answers: z.array(z.string().max(2000)).max(20).optional(),
})

const statusQuery = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',') : ['suggested', 'saved']))
  .pipe(z.array(z.enum(IDEA_STATUS)))

export function ideaRoutes(ideas: IdeaStore, ai: Ai) {
  // Ideas whose drafts are being written right now (a call takes minutes; a reload or a second
  // tab must not start another package for the same idea).
  const drafting = new Set<string>()

  return new Hono()
    .get('/', (c) => c.json(ideas.list(statusQuery.parse(c.req.query('status')))))

    .post('/', async (c) => {
      const input = createBody.parse(await c.req.json())
      try {
        return c.json(ideas.create(input), 201)
      } catch (err) {
        if (err instanceof IdeaInputError) return c.json({ error: err.message }, err.status)
        throw err
      }
    })

    .post('/generate', async (c) => {
      const input = generateBody.parse(await c.req.json())
      const ids = await ai.generateIdeas(input)
      return c.json(ideas.list([...IDEA_STATUS], ids), 201)
    })

    .patch('/:id', async (c) => {
      const id = c.req.param('id')
      if (!ideas.exists(id)) return c.json({ error: 'Idea not found' }, 404)
      const { status, answers } = patchBody.parse(await c.req.json())
      try {
        if (answers) ideas.setAnswers(id, answers)
      } catch (err) {
        if (err instanceof IdeaInputError) return c.json({ error: err.message }, err.status)
        throw err
      }
      if (status) ideas.setStatus(id, status)
      return c.json(ideas.get(id))
    })

    .post('/:id/draft', async (c) => {
      const id = c.req.param('id')
      if (!ideas.exists(id)) return c.json({ error: 'Idea not found' }, 404)
      const input = draftBody.parse(await c.req.json())
      if (drafting.has(id)) {
        return c.json({ error: 'Drafts for this idea are already being written.' }, 409)
      }
      drafting.add(id)
      try {
        return c.json(await ai.draftPackage({ ideaId: id, ...input }), 201)
      } finally {
        drafting.delete(id)
      }
    })
}
