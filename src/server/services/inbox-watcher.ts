import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { InboxIssue } from '@shared/types.ts'
import { library } from '../library.ts'
import { notify } from '../lib/events.ts'
import { moveFile } from '../lib/files.ts'
import { unsupportedReason, type Capture } from './capture.ts'

const SETTLE_MS = 1200
// Partial downloads and editor temp files.
const IGNORED = /^\.|\.(part|crdownload|download|tmp|icloud)$/i

// Files left in the inbox folder because they couldn't be imported, and why. Shown in the Inbox
// so nothing sits there unnoticed. In memory: the startup scan finds them again after a restart.
const issues = new Map<string, InboxIssue>()
let rescan: ((name: string) => void) | null = null

// Only what's still in the folder (a file removed in Finder drops off the list).
export async function inboxIssues(): Promise<InboxIssue[]> {
  const present = await Promise.all(
    [...issues.values()].map(async (issue) =>
      (await stat(join(library.inbox, issue.name)).catch(() => null))?.isFile() ? issue : null
    )
  )
  return present
    .filter((issue): issue is InboxIssue => !!issue)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

const listed = (name: string) => {
  const safe = basename(name)
  return safe === name && issues.has(name) ? name : null
}

// Tries a listed file again (after fixing it, or once ffmpeg is installed).
export function retryInboxFile(name: string): boolean {
  const file = listed(name)
  if (!file || !rescan) return false
  rescan(file)
  return true
}

// Moves a listed file out of the inbox folder into trash/ — it isn't deleted.
export async function trashInboxFile(name: string): Promise<boolean> {
  const file = listed(name)
  if (!file) return false
  await moveFile(join(library.inbox, file), join(library.trash, `${Date.now()}-${file}`))
  issues.delete(file)
  notify('assets')
  return true
}

const setIssue = (issue: InboxIssue) => {
  const previous = issues.get(issue.name)
  issues.set(issue.name, issue)
  if (previous?.reason !== issue.reason) notify('assets')
}

const clearIssue = (name: string) => {
  if (issues.delete(name)) notify('assets')
}

// Imports anything saved into <library>/inbox/ — Shortcuts, screenshots, Finder drags.
// Files are moved into media/ once their size stops changing.
export function watchInbox(capture: Capture): FSWatcher {
  const pending = new Map<string, NodeJS.Timeout>()

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
    if (!info?.isFile()) return clearIssue(name)
    if (info.size !== lastSize) return schedule(name, info.size) // still being written

    const issue = (reason: string) => ({
      name,
      reason,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    })

    const unsupported = unsupportedReason(name)
    if (unsupported) {
      if (!issues.has(name)) console.warn(`[inbox] skipping unsupported file: ${name}`)
      return setIssue(issue(unsupported))
    }

    try {
      const { duplicate, pages, message } = await capture.importFile({
        path,
        originalName: name,
        source: 'inbox_folder',
        // Copies get a fresh birthtime but keep mtime — the earlier one is closer to the truth.
        capturedAt: info.mtime < info.birthtime ? info.mtime : info.birthtime,
      })
      clearIssue(name)
      const what = pages ? `${pages} page${pages === 1 ? '' : 's'}` : 'imported'
      console.log(`[inbox] ${duplicate ? 'duplicate, moved to trash' : what}: ${name}`)
      if (message) console.log(`[inbox] ${name}: ${message}`)
    } catch (err) {
      console.error(`[inbox] failed to import ${name}:`, err)
      setIssue(issue(err instanceof Error ? err.message : String(err)))
    }
  }

  rescan = (name) => schedule(name)

  // Pick up anything that arrived while Pullup wasn't running.
  readdir(library.inbox)
    .then((names) => names.filter((n) => !IGNORED.test(n)).forEach((n) => schedule(n)))
    .catch((err) => console.error('[inbox] initial scan failed:', err))

  const watcher = watch(library.inbox, (_event, name) => {
    if (name && !IGNORED.test(name)) schedule(name)
  })
  const close = watcher.close.bind(watcher)
  watcher.close = () => {
    pending.forEach((timer) => clearTimeout(timer))
    rescan = null
    close()
  }
  return watcher
}
