import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const MAX_RETRY_MS = 10_000
// The server pings every 10 s; silence longer than this means the connection is dead.
const STALE_MS = 25_000

// Listens to server change events and refreshes the affected queries (batched).
// Reconnection is handled here: EventSource gives up after an HTTP error, and a dead server
// behind the dev proxy can leave the connection open but silent. Every (re)connect refreshes
// to catch events missed while disconnected.
export function useServerEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let source: EventSource | undefined
    let batch: ReturnType<typeof setTimeout> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let delay = 1000
    let stopped = false

    const refresh = () => {
      clearTimeout(batch)
      batch = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['assets'] })
        queryClient.invalidateQueries({ queryKey: ['system'] })
      }, 250)
    }

    const reconnect = () => {
      source?.close()
      clearTimeout(watchdog)
      if (stopped) return
      retry = setTimeout(connect, delay)
      delay = Math.min(delay * 2, MAX_RETRY_MS)
    }

    const alive = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(reconnect, STALE_MS)
    }

    function connect() {
      source = new EventSource('/api/events')
      source.onopen = () => {
        delay = 1000
        alive()
        refresh()
      }
      source.addEventListener('ping', alive)
      source.addEventListener('change', () => {
        alive()
        refresh()
      })
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) reconnect()
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(batch)
      clearTimeout(retry)
      clearTimeout(watchdog)
      source?.close()
    }
  }, [queryClient])
}
