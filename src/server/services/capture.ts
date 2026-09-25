import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AssetSource } from '@shared/constants.ts'
import type { CaptureResult } from '@shared/types.ts'
import { kindFromMime, mediaFileName, moveFile, resolveMime, sha256File } from '../lib/files.ts'
import { fromLibraryPath, library, toLibraryPath } from '../library.ts'
import type { AssetStore } from './assets.ts'
import type { Processor } from './processing.ts'

export class CaptureError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 | 415 = 400
  ) {
    super(message)
  }
}

interface ImportFileInput {
  // Absolute path of the file to import. It is moved into media/ (or trashed if it's a duplicate).
  path: string
  originalName: string
  mime?: string | null
  source: AssetSource
  capturedAt?: Date
  checksum?: string
  // True for Pullup's own temp copies (uploads): a duplicate is discarded instead of trashed.
  temporary?: boolean
}

// Media originals are organized by capture month: media/2026/09/<name>-<id>.<ext>
const mediaPath = (capturedAt: Date, originalName: string, id: string) =>
  join(
    library.media,
    String(capturedAt.getFullYear()),
    String(capturedAt.getMonth() + 1).padStart(2, '0'),
    mediaFileName(originalName, id)
  )

export function createCapture(assets: AssetStore, processor: Processor) {
  return {
    async importFile(input: ImportFileInput): Promise<CaptureResult> {
      const mime = resolveMime(input.originalName, input.mime)
      const kind = kindFromMime(mime)
      if (!mime || !kind) {
        throw new CaptureError(`Unsupported file type: ${input.originalName}`, 415)
      }

      const checksum = input.checksum ?? (await sha256File(input.path))
      const existing = assets.findByChecksum(checksum)
      if (existing) {
        if (input.temporary) await rm(input.path, { force: true })
        else
          await moveFile(input.path, join(library.trash, `${Date.now()}-${basename(input.path)}`))
        return { asset: assets.get(existing.id)!, duplicate: true }
      }

      const id = randomUUID()
      const capturedAt = input.capturedAt ?? new Date()
      const target = mediaPath(capturedAt, input.originalName, id)
      const { size } = await stat(input.path)
      await moveFile(input.path, target)

      assets.insert({
        id,
        kind,
        source: input.source,
        captured_at: capturedAt.toISOString(),
        file_path: toLibraryPath(target),
        original_name: input.originalName,
        mime,
        size_bytes: size,
        checksum,
      })
      processor.enqueue(id)
      return { asset: assets.get(id)!, duplicate: false }
    },

    createLink(input: { url: string; title?: string; notes?: string; source?: AssetSource }) {
      const id = randomUUID()
      assets.insert({
        id,
        kind: 'link',
        source: input.source ?? 'url',
        captured_at: new Date().toISOString(),
        url: input.url,
        title: input.title ?? '',
        notes: input.notes ?? '',
      })
      processor.enqueue(id)
      return { asset: assets.get(id)!, duplicate: false }
    },

    createNote(input: { body: string; title?: string; source?: AssetSource }) {
      const id = randomUUID()
      assets.insert({
        id,
        kind: 'note',
        source: input.source ?? 'note',
        captured_at: new Date().toISOString(),
        body: input.body,
        title: input.title ?? '',
        processing_status: 'ready',
      })
      return { asset: assets.get(id)!, duplicate: false }
    },

    // Moves the original to trash/ and removes cached derivatives. Never hard-deletes originals.
    async remove(id: string) {
      const row = assets.row(id)
      if (!row) throw new CaptureError('Asset not found', 404)
      if (assets.usedInPosts(id)) throw new CaptureError('Asset is used in a post', 409)

      if (row.file_path) {
        const original = fromLibraryPath(row.file_path)
        await moveFile(original, join(library.trash, basename(original))).catch((err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
      }
      await rm(join(library.cache, id), { recursive: true, force: true })
      assets.remove(id)
    },
  }
}

export type Capture = ReturnType<typeof createCapture>
