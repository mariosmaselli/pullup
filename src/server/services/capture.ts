import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AssetSource } from '@shared/constants.ts'
import type { CaptureResult } from '@shared/types.ts'
import {
  extOf,
  kindFromMime,
  mediaFileName,
  moveFile,
  resolveMime,
  sha256File,
} from '../lib/files.ts'
import { PDF_MAX_PAGES, PdfError, renderPdfPages } from '../lib/pdf.ts'
import { fromLibraryPath, library, toLibraryPath } from '../library.ts'
import {
  pdfPageChecksum,
  pdfPageFile,
  pdfPageName,
  pdfSourceOf,
  type AssetRow,
  type AssetStore,
} from './assets.ts'
import type { Processor } from './processing.ts'

export class CaptureError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 | 415 | 422 = 400,
    // Extra fields for the JSON error body (e.g. the posts that block a delete).
    public details?: Record<string, unknown>
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
  // Captured while looking at a project: the new asset starts in that project.
  projectId?: string | null
}

// Files that aren't media but still make an asset: a PDF (one image per page), a text file
// (a note) or a Safari/Finder web location (a link).
const DOCUMENT_TYPES: Record<string, { type: 'pdf' | 'text' | 'webloc'; mime: string }> = {
  pdf: { type: 'pdf', mime: 'application/pdf' },
  txt: { type: 'text', mime: 'text/plain' },
  text: { type: 'text', mime: 'text/plain' },
  md: { type: 'text', mime: 'text/markdown' },
  markdown: { type: 'text', mime: 'text/markdown' },
  webloc: { type: 'webloc', mime: 'application/x-webloc' },
}

const MAX_NOTE_CHARS = 50_000

function documentType(name: string, mime?: string | null) {
  const ext = extOf(name)
  if (ext) return DOCUMENT_TYPES[ext] ?? null
  return mime === 'application/pdf' ? DOCUMENT_TYPES.pdf! : null
}

// Why a file can't be captured, or null if it can.
export function unsupportedReason(name: string, mime?: string | null): string | null {
  if (kindFromMime(resolveMime(name, mime)) || documentType(name, mime)) return null
  const ext = extOf(name)
  return ext
    ? `Pullup can't import .${ext} files — images, videos, PDFs, text files and web links only.`
    : 'Pullup can’t tell what kind of file this is (no extension).'
}

// Media originals are organized by capture month: media/2026/09/<name>-<id>.<ext>
const mediaPath = (capturedAt: Date, originalName: string, id: string) =>
  join(
    library.media,
    String(capturedAt.getFullYear()),
    String(capturedAt.getMonth() + 1).padStart(2, '0'),
    mediaFileName(originalName, id)
  )

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || name

// A web location file is a property list with a URL key (XML or binary — plutil reads both).
function weblocUrl(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'plutil',
      ['-extract', 'URL', 'raw', '-o', '-', '--', path],
      { timeout: 10_000 },
      (err, stdout) => {
        if (!err) return resolve(stdout.trim() || null)
        // Not macOS, or an odd file: try the XML form by hand.
        readFile(path, 'utf8')
          .then((xml) => {
            const url = /<key>URL<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)?.[1]
            resolve(url ? url.trim().replace(/&amp;/g, '&') : null)
          })
          .catch(() => resolve(null))
      }
    )
  })
}

const isWebUrl = (value: string) => {
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

export function createCapture(assets: AssetStore, processor: Processor) {
  // The file isn't needed (a duplicate): an upload's temp copy goes away, anything else moves to
  // trash/ — originals are never deleted.
  async function discard(input: ImportFileInput) {
    if (input.temporary) await rm(input.path, { force: true })
    else await moveFile(input.path, join(library.trash, `${Date.now()}-${basename(input.path)}`))
  }

  // One PNG asset per page, rendered with PDFKit; the PDF moves into media/ next to its pages.
  async function importPdf(input: ImportFileInput, checksum: string): Promise<CaptureResult> {
    const existing = assets.findPdfPages(checksum)
    if (existing.length) {
      await discard(input)
      return { asset: assets.get(existing[0]!.id)!, duplicate: true, pages: existing.length }
    }

    const pdfId = randomUUID()
    const work = join(library.tmp, `pdf-${pdfId}`)
    await mkdir(work, { recursive: true })
    try {
      const { pageCount, pages } = await renderPdfPages(input.path, work, {
        name: input.originalName,
      }).catch((err) => {
        if (err instanceof PdfError) throw new CaptureError(err.message, 422)
        throw err
      })

      const capturedAt = input.capturedAt ?? new Date()
      const pdfName = /\.pdf$/i.test(input.originalName)
        ? input.originalName
        : `${input.originalName}.pdf`
      const pdfTarget = mediaPath(capturedAt, pdfName, pdfId)
      await moveFile(input.path, pdfTarget)
      const pdfPath = toLibraryPath(pdfTarget)

      // Newest first in lists: page 1 gets the latest created_at so pages read in order.
      const createdBase = Date.now()
      const ids: string[] = []
      for (const page of pages) {
        const target = fromLibraryPath(pdfPageFile(pdfPath, page.page))
        await moveFile(page.path, target)
        const { size } = await stat(target)
        const id = randomUUID()
        assets.insert({
          id,
          kind: 'image',
          source: input.source,
          project_id: input.projectId ?? null,
          captured_at: capturedAt.toISOString(),
          created_at: new Date(createdBase - page.page).toISOString(),
          title: `${pdfName} — page ${page.page}`,
          file_path: toLibraryPath(target),
          original_name: pdfPageName(pdfName, page.page),
          mime: 'image/png',
          size_bytes: size,
          checksum: pdfPageChecksum(checksum, page.page),
          width: page.width,
          height: page.height,
        })
        ids.push(id)
      }
      for (const id of ids) processor.enqueue(id)

      return {
        asset: assets.get(ids[0]!)!,
        duplicate: false,
        pages: ids.length,
        ...(pageCount > PDF_MAX_PAGES
          ? {
              message: `Imported the first ${PDF_MAX_PAGES} of ${pageCount} pages — ${PDF_MAX_PAGES} is the limit per PDF.`,
            }
          : {}),
      }
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  // A text file becomes a note; the file itself is kept in media/ as the note's original.
  async function importText(input: ImportFileInput, checksum: string, mime: string) {
    const text = (await readFile(input.path, 'utf8')).replace(/^﻿/, '').trim()
    if (!text) throw new CaptureError(`“${input.originalName}” is empty.`, 422)
    if (text.length > MAX_NOTE_CHARS) {
      throw new CaptureError(
        `“${input.originalName}” is too long for a note (${text.length.toLocaleString('en')} characters, the limit is ${MAX_NOTE_CHARS.toLocaleString('en')}).`,
        413
      )
    }
    return keepAs(input, checksum, mime, {
      kind: 'note',
      body: text,
      title: stem(input.originalName),
      processing_status: 'ready',
    })
  }

  // A .webloc (a link dragged out of Safari to the Desktop or inbox folder) becomes a link.
  async function importWebloc(input: ImportFileInput, checksum: string, mime: string) {
    const url = await weblocUrl(input.path)
    if (!url || !isWebUrl(url)) {
      throw new CaptureError(`“${input.originalName}” doesn't contain a web address.`, 422)
    }
    const id = await keepAs(input, checksum, mime, {
      kind: 'link',
      url,
      title: stem(input.originalName),
    })
    processor.enqueue(id)
    return id
  }

  async function keepAs(
    input: ImportFileInput,
    checksum: string,
    mime: string,
    values: Partial<AssetRow> & Pick<AssetRow, 'kind'>
  ): Promise<string> {
    const id = randomUUID()
    const capturedAt = input.capturedAt ?? new Date()
    const target = mediaPath(capturedAt, input.originalName, id)
    const { size } = await stat(input.path)
    await moveFile(input.path, target)
    assets.insert({
      id,
      source: input.source,
      project_id: input.projectId ?? null,
      captured_at: capturedAt.toISOString(),
      file_path: toLibraryPath(target),
      original_name: input.originalName,
      mime,
      size_bytes: size,
      checksum,
      ...values,
    })
    return id
  }

  return {
    async importFile(input: ImportFileInput): Promise<CaptureResult> {
      const mime = resolveMime(input.originalName, input.mime)
      const kind = kindFromMime(mime)
      const document = kind ? null : documentType(input.originalName, input.mime)
      if (!document && (!mime || !kind)) {
        throw new CaptureError(`Unsupported file type: ${input.originalName}`, 415)
      }

      const checksum = input.checksum ?? (await sha256File(input.path))
      if (document?.type === 'pdf') return importPdf(input, checksum)

      const existing = assets.findByChecksum(checksum)
      if (existing) {
        await discard(input)
        return { asset: assets.get(existing.id)!, duplicate: true }
      }

      if (document) {
        const id =
          document.type === 'text'
            ? await importText(input, checksum, document.mime)
            : await importWebloc(input, checksum, document.mime)
        return { asset: assets.get(id)!, duplicate: false }
      }

      const id = randomUUID()
      const capturedAt = input.capturedAt ?? new Date()
      const target = mediaPath(capturedAt, input.originalName, id)
      const { size } = await stat(input.path)
      await moveFile(input.path, target)

      assets.insert({
        id,
        kind: kind!,
        source: input.source,
        project_id: input.projectId ?? null,
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

    createLink(input: {
      url: string
      title?: string
      notes?: string
      source?: AssetSource
      projectId?: string | null
    }) {
      const id = randomUUID()
      assets.insert({
        id,
        kind: 'link',
        source: input.source ?? 'url',
        project_id: input.projectId ?? null,
        captured_at: new Date().toISOString(),
        url: input.url,
        title: input.title ?? '',
        notes: input.notes ?? '',
      })
      processor.enqueue(id)
      return { asset: assets.get(id)!, duplicate: false }
    },

    createNote(input: {
      body: string
      title?: string
      source?: AssetSource
      projectId?: string | null
    }) {
      const id = randomUUID()
      assets.insert({
        id,
        kind: 'note',
        source: input.source ?? 'note',
        project_id: input.projectId ?? null,
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
      const usage = assets.usage(id)
      if (usage.posts.length) {
        const n = usage.posts.length
        const statuses = [...new Set(usage.posts.map((p) => p.status))].join(', ')
        throw new CaptureError(
          `Used in ${n} post${n === 1 ? '' : 's'} (${statuses}). Remove it from ${n === 1 ? 'that post' : 'those posts'} first.`,
          409,
          { posts: usage.posts }
        )
      }

      if (row.file_path) {
        const original = fromLibraryPath(row.file_path)
        await moveFile(original, join(library.trash, basename(original))).catch((err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
      }
      await rm(join(library.cache, id), { recursive: true, force: true })
      assets.remove(id)

      // The last page of a PDF is gone: the PDF follows it into the trash.
      const pdf = pdfSourceOf(row)
      if (pdf && !assets.pdfPageCount(pdf.pdfPath)) {
        const file = fromLibraryPath(pdf.pdfPath)
        await moveFile(file, join(library.trash, basename(file))).catch((err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
      }
    },
  }
}

export type Capture = ReturnType<typeof createCapture>
