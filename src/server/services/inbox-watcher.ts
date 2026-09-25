import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { library } from '../library.ts'
import { mimeFromName } from '../lib/files.ts'
import type { Capture } from './capture.ts'

const SETTLE_MS = 1200
// Partial downloads and editor temp files.
const IGNORED = /^\.|\.(part|crdownload|download|tmp|icloud)$/i

// Imports anything saved into <library>/inbox/ — Shortcuts, screenshots, Finder drags.
// Files are moved into media/ once their size stops changing.
export function watchInbox(capture: Capture): FSWatcher {
  const pending = new Map<string, NodeJS.Timeout>()
  const warned = new Set<string>()

  const schedule = (name: string, lastSize = -1) => {
    clearTimeout(pending.get(name))
    pending.set(
      name,
      setTimeout(() => settle(name, lastSize), SETTLE_MS)
    )
  }

  async function settle(name: string, lastSize: number) {
    pending.delete(name)
    const path = join(library.inbox, name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) return
    if (info.size !== lastSize) return schedule(name, info.size) // still being written

    if (!mimeFromName(name)) {
      if (!warned.has(name)) console.warn(`[inbox] skipping unsupported file: ${name}`)
      warned.add(name)
      return
    }

    try {
      const { duplicate } = await capture.importFile({
        path,
        originalName: name,
        source: 'inbox_folder',
        // Copies get a fresh birthtime but keep mtime — the earlier one is closer to the truth.
        capturedAt: info.mtime < info.birthtime ? info.mtime : info.birthtime,
      })
      console.log(`[inbox] ${duplicate ? 'duplicate, moved to trash' : 'imported'}: ${name}`)
    } catch (err) {
      console.error(`[inbox] failed to import ${name}:`, err)
    }
  }

  // Pick up anything that arrived while Pullup wasn't running.
  readdir(library.inbox)
    .then((names) => names.filter((n) => !IGNORED.test(n)).forEach((n) => schedule(n)))
    .catch((err) => console.error('[inbox] initial scan failed:', err))

  return watch(library.inbox, (_event, name) => {
    if (name && !IGNORED.test(name)) schedule(name)
  })
}
