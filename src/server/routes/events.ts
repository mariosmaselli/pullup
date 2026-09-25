import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { changes, type ChangeTopic } from '../lib/events.ts'

// Heartbeat interval. The client reconnects when it misses a few (see client/lib/events.ts) —
// a dead upstream behind a proxy can otherwise look like an open, silent connection.
const PING_MS = 10_000

export function eventRoutes() {
  return new Hono().get('/', (c) =>
    streamSSE(c, async (stream) => {
      const send = (topic: ChangeTopic) => void stream.writeSSE({ event: 'change', data: topic })
      changes.on('change', send)
      stream.onAbort(() => {
        changes.off('change', send)
      })
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' })
        await stream.sleep(PING_MS)
      }
    })
  )
}
