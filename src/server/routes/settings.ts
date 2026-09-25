import { Hono } from 'hono'
import { z } from 'zod'
import type { KeyManager } from '../ai/key.ts'

export function settingsRoutes(keys: KeyManager) {
  return (
    new Hono()
      .get('/ai-key', (c) => c.json(keys.status()))

      // PUT (not POST) so browsers always preflight cross-origin attempts.
      .put('/ai-key', async (c) => {
        const { apiKey } = z.object({ apiKey: z.string().max(500) }).parse(await c.req.json())
        await keys.set(apiKey)
        return c.json(keys.status())
      })

      .delete('/ai-key', async (c) => {
        await keys.clear()
        return c.json(keys.status())
      })
  )
}
