import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { StorageError, type Storage } from '../services/storage.ts'

const run = async (c: Context, work: () => Promise<unknown>) => {
  try {
    return c.json(await work())
  } catch (err) {
    if (err instanceof StorageError) return c.json({ error: err.message }, err.status)
    throw err
  }
}

const trashName = z.string().min(1).max(512)

// Settings → Storage and the Trash page. Reads are GETs; anything that moves or deletes files
// is a POST with the exact items the UI showed.
export function storageRoutes(storage: Storage) {
  return (
    new Hono()
      .get('/', (c) => run(c, () => storage.info()))

      // What "Clean up old renders" would move to trash, and how much it frees.
      .get('/cleanup', (c) => run(c, () => storage.cleanupPreview()))

      .post('/cleanup', async (c) => {
        const { ids } = z
          .object({ ids: z.array(z.string().max(64)).max(10_000) })
          .parse(await c.req.json())
        return run(c, () => storage.cleanup(ids))
      })

      .get('/trash', (c) => run(c, () => storage.trash()))

      .post('/trash/restore', async (c) => {
        const { name } = z.object({ name: trashName }).parse(await c.req.json())
        return run(c, () => storage.restore(name))
      })

      // Deletes for good. Only Mario's own "Empty trash" button calls this, with the items listed.
      .post('/trash/empty', async (c) => {
        const { names } = z
          .object({ names: z.array(trashName).min(1).max(10_000) })
          .parse(await c.req.json())
        return run(c, () => storage.emptyTrash(names))
      })
  )
}
