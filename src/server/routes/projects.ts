import { Hono } from 'hono'
import { z } from 'zod'
import { PROJECT_STATUS } from '@shared/constants.ts'
import type { ProjectStore } from '../services/projects.ts'

const projectBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
  status: z.enum(PROJECT_STATUS).optional(),
  isClientWork: z.boolean().optional(),
  aiAllowed: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  defaultProfileId: z.string().nullable().optional(),
})

export function projectRoutes(projects: ProjectStore) {
  return new Hono()
    .get('/', (c) => c.json(projects.list()))

    .get('/:idOrSlug', (c) => {
      const project = projects.get(c.req.param('idOrSlug'))
      return project ? c.json(project) : c.json({ error: 'Project not found' }, 404)
    })

    .post('/', async (c) => {
      const input = projectBody.parse(await c.req.json())
      return c.json(projects.create(input), 201)
    })

    .patch('/:id', async (c) => {
      const id = c.req.param('id')
      if (!projects.exists(id)) return c.json({ error: 'Project not found' }, 404)
      const input = projectBody.partial().parse(await c.req.json())
      return c.json(projects.update(id, input))
    })
}
