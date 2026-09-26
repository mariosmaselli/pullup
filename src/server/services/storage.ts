import { mkdir, readdir, readFile, rm, rmdir, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { renderForFrame } from '@shared/frames.ts'
import {
  CLEANUP_MIN_AGE_DAYS,
  type CleanupCandidate,
  type CleanupPreview,
  type CleanupResult,
  type EmptyTrashResult,
  type FolderUsage,
  type RestoreResult,
  type StorageInfo,
  type TrashItem,
  type TrashListing,
} from '@shared/storage.ts'
import type { DB } from '../db/index.ts'
import { moveFile, sha256File } from '../lib/files.ts'
import { notify } from '../lib/events.ts'
import { fromLibraryPath, library, toLibraryPath } from '../library.ts'
import type { AssetStore } from './assets.ts'
import { unsupportedReason, type Capture } from './capture.ts'
import type { PostStore } from './posts.ts'
import type { RenderStore } from './renders.ts'

// Housekeeping: how much space each part of the library takes, moving old renders to trash,
// and the trash itself (list, restore, empty).
//
// Nothing here deletes an original. "Clean up old renders" moves files into trash/renders/<id>/
// together with the render's record (render.json), so Restore can put the render back exactly
// as it was. Only "Empty trash" — Mario's own button — deletes, and only the items he was shown.

export class StorageError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string
  ) {
    super(message)
  }
}

const DAY = 24 * 60 * 60 * 1000
// GIF / WebP exports sit next to their MP4: "<stem>.<w>x<h>-<fps>fps.<gif|webp>" (renders.ts).
const EXPORT_FILE = /\.\d+x\d+-\d+fps\.(gif|webp)$/
const RENDERS_DIR = 'renders' // trash/renders/<render id>/ — cleaned-up renders
const MANIFEST = 'render.json'
// Trash names written elsewhere: capture.ts (inbox duplicates: "<ms timestamp>-<name>") and
// renders.ts (Studio deletes: "render-<id8>-<file name>").
const DUPLICATE_NAME = /^\d{13}-(.+)$/
const RENDER_FILE_NAME = /^render-([0-9a-f]{8})-(.+)$/
// mediaFileName() adds "-<id8>" before the extension.
const MEDIA_ID_SUFFIX = /-[0-9a-f]{8}$/

interface RenderRow {
  id: string
  template_id: string
  kind: 'video' | 'image'
  width: number
  height: number
  status: string
  file_path: string | null
  poster_path: string | null
  post_id: string | null
  created_at: string
  [column: string]: unknown
}

interface RenderManifest {
  version: 1
  reason: 'cleanup'
  trashedAt: string
  row: RenderRow
  // Library-relative path each file came from, by its name in the trash folder.
  files: { name: string; from: string }[]
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

async function usage(dir: string, skip?: (path: string) => boolean): Promise<FolderUsage> {
  const total = { bytes: 0, files: 0 }
  await walk(
    dir,
    (_path, size) => {
      total.bytes += size
      total.files++
    },
    skip
  )
  return total
}

async function walk(
  dir: string,
  visit: (path: string, size: number) => void,
  skip?: (path: string) => boolean
) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (skip?.(path)) continue
    if (entry.isDirectory()) await walk(path, visit, skip)
    else if (entry.isFile()) {
      const info = await stat(path).catch(() => null)
      if (info) visit(path, info.size)
    }
  }
}

// "screen-recording-2026-09-25-3f9a1c2b.mov" → "screen-recording-2026-09-25.mov"
function originalNameOf(trashName: string) {
  const name = DUPLICATE_NAME.exec(trashName)?.[1] ?? trashName
  const ext = extname(name)
  return `${basename(name, ext).replace(MEDIA_ID_SUFFIX, '')}${ext}`
}

interface Deps {
  db: DB
  assets: AssetStore
  capture: Capture
  posts: PostStore
  renders: RenderStore
  now?: () => number // injectable clock
}

export function createStorage({ db, assets, capture, posts, renders, now = Date.now }: Deps) {
  const trashRoot = library.trash

  // Cleanup, restore and empty never run at the same time (each re-checks what it acts on).
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => undefined)
    return run
  }

  const renderRow = (id: string) =>
    db.prepare('SELECT * FROM renders WHERE id = ?').get(id) as RenderRow | undefined

  // ── Sizes ────────────────────────────────────────────────────────────────────────────────

  async function info(): Promise<StorageInfo> {
    const originals = await usage(library.media, (path) => path === library.renders)
    const rendersUsage = { bytes: 0, files: 0 }
    const exportsUsage = { bytes: 0, files: 0 }
    await walk(library.renders, (path, size) => {
      const bucket = EXPORT_FILE.test(path) ? exportsUsage : rendersUsage
      bucket.bytes += size
      bucket.files++
    })
    const database = { bytes: 0, files: 0 }
    for (const suffix of ['', '-wal', '-shm']) {
      const file = await stat(library.database + suffix).catch(() => null)
      if (file) {
        database.bytes += file.size
        database.files++
      }
    }
    const [cache, trash, backups] = await Promise.all([
      usage(library.cache),
      usage(library.trash),
      usage(library.backups),
    ])
    const parts = [originals, rendersUsage, exportsUsage, cache, trash, backups, database]
    const disk = await statfs(library.root).catch(() => null)
    return {
      root: library.root,
      originals,
      renders: rendersUsage,
      exports: exportsUsage,
      cache,
      trash,
      backups,
      database,
      total: parts.reduce((sum, p) => sum + p.bytes, 0),
      diskFreeBytes: disk ? disk.bavail * disk.bsize : null,
    }
  }

  // ── Old renders ──────────────────────────────────────────────────────────────────────────

  // Renders to keep whatever their age: the render each frame of a post currently uses (the
  // same one the editor shows and "Download all" zips), and every render of a published post.
  function keptRenderIds(): Set<string> {
    const keep = new Set<string>()
    const postIds = db
      .prepare('SELECT DISTINCT post_id FROM renders WHERE post_id IS NOT NULL')
      .all() as { post_id: string }[]
    for (const { post_id } of postIds) {
      const post = posts.detail(post_id)
      if (!post) continue
      const list = renders.list({ postId: post_id })
      if (post.status === 'published' || post.publishedAt) {
        for (const r of list) keep.add(r.id)
        continue
      }
      post.current?.segments.forEach((frame, i) => {
        const { render } = renderForFrame(list, frame, i)
        if (render) keep.add(render.id)
      })
    }
    return keep
  }

  // The render's files on disk: MP4/JPEG, poster, and GIF / WebP exports.
  async function renderFiles(
    row: RenderRow,
    listings = new Map<string, Promise<string[]>>()
  ): Promise<{ path: string; size: number }[]> {
    const paths = [row.file_path, row.poster_path]
      .filter((p): p is string => !!p)
      .map(fromLibraryPath)
    if (row.file_path) {
      const file = fromLibraryPath(row.file_path)
      const prefix = `${basename(file, extname(file))}.`
      const dir = dirname(file)
      if (!listings.has(dir))
        listings.set(
          dir,
          readdir(dir).catch(() => [] as string[])
        )
      for (const name of await listings.get(dir)!) {
        if (name.startsWith(prefix) && EXPORT_FILE.test(name)) paths.push(join(dirname(file), name))
      }
    }
    const found: { path: string; size: number }[] = []
    for (const path of paths) {
      const file = await stat(path).catch(() => null)
      if (file?.isFile()) found.push({ path, size: file.size })
    }
    return found
  }

  async function candidates() {
    const cutoff = new Date(now() - CLEANUP_MIN_AGE_DAYS * DAY).toISOString()
    const rows = db
      .prepare(
        `SELECT * FROM renders WHERE created_at < ? AND status != 'pending'
           AND (file_path IS NOT NULL OR poster_path IS NOT NULL)
         ORDER BY created_at`
      )
      .all(cutoff) as RenderRow[]
    if (!rows.length) return []
    const keep = keptRenderIds()
    const listings = new Map<string, Promise<string[]>>() // one readdir per month folder
    const found: { row: RenderRow; files: { path: string; size: number }[] }[] = []
    for (const row of rows) {
      if (keep.has(row.id)) continue
      const files = await renderFiles(row, listings)
      if (files.length) found.push({ row, files })
    }
    return found
  }

  async function cleanupPreview(): Promise<CleanupPreview> {
    const found = await candidates()
    const list: CleanupCandidate[] = found.map(({ row, files }) => ({
      id: row.id,
      templateId: row.template_id,
      createdAt: row.created_at,
      postId: row.post_id,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      files: files.length,
    }))
    return {
      olderThanDays: CLEANUP_MIN_AGE_DAYS,
      count: list.length,
      bytes: list.reduce((sum, c) => sum + c.bytes, 0),
      exports: found.reduce(
        (n, c) => n + c.files.filter((f) => EXPORT_FILE.test(f.path)).length,
        0
      ),
      candidates: list,
    }
  }

  // A folder in trash/renders that isn't taken (a render cleaned up, restored and cleaned again).
  async function freeRenderDir(id: string) {
    let dir = join(trashRoot, RENDERS_DIR, id)
    for (let n = 2; await exists(dir); n++) dir = join(trashRoot, RENDERS_DIR, `${id}-${n}`)
    return dir
  }

  // Moves the renders the preview listed — only those still eligible now.
  function cleanup(ids: string[]): Promise<CleanupResult> {
    return exclusive(async () => {
      const eligible = new Map((await candidates()).map((c) => [c.row.id, c]))
      const result: CleanupResult = { moved: 0, bytes: 0, skipped: [] }
      for (const id of new Set(ids)) {
        const candidate = eligible.get(id)
        if (!candidate) {
          result.skipped.push(id)
          continue
        }
        const { row, files } = candidate
        const dir = await freeRenderDir(row.id)
        const manifest: RenderManifest = {
          version: 1,
          reason: 'cleanup',
          trashedAt: new Date(now()).toISOString(),
          row,
          files: files.map((f) => ({ name: basename(f.path), from: toLibraryPath(f.path) })),
        }
        // Record first: if Pullup stops half-way, Restore still knows where every file belongs.
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
        for (const file of files) {
          await moveFile(file.path, join(dir, basename(file.path))).catch((err) => {
            if (!isMissing(err)) throw err
          })
        }
        db.prepare('DELETE FROM renders WHERE id = ?').run(row.id)
        result.moved++
        result.bytes += files.reduce((sum, f) => sum + f.size, 0)
      }
      if (result.moved) notify('renders')
      return result
    })
  }

  // ── Trash ────────────────────────────────────────────────────────────────────────────────

  // Trash item names come from the client: a top-level entry, or renders/<entry>. Nothing else.
  function trashPath(name: string): string {
    const parts = name.split('/')
    const valid =
      ((parts.length === 1 && parts[0] !== RENDERS_DIR) ||
        (parts.length === 2 && parts[0] === RENDERS_DIR)) &&
      parts.every((p) => p && !p.startsWith('.') && !p.includes('\\') && !p.includes('\0'))
    const path = resolve(trashRoot, name)
    if (!valid || relative(trashRoot, path) !== parts.join(sep)) {
      throw new StorageError(400, `Not a trash item: ${name}`)
    }
    return path
  }

  async function readManifest(dir: string): Promise<RenderManifest | null> {
    try {
      const manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as RenderManifest
      return manifest.version === 1 && manifest.row?.id && Array.isArray(manifest.files)
        ? manifest
        : null
    } catch {
      return null
    }
  }

  // The render record a Studio-deleted file ("render-<id8>-<name>") belongs to, if it still
  // exists and is missing that file.
  async function renderRowForFile(name: string) {
    const match = RENDER_FILE_NAME.exec(name)
    if (!match) return null
    const [, prefix, file] = match
    const rows = db
      .prepare('SELECT * FROM renders WHERE substr(id, 1, 8) = ?')
      .all(prefix) as RenderRow[]
    for (const row of rows) {
      const path = [row.file_path, row.poster_path].find((p) => p && basename(p) === file)
      if (path && !(await exists(fromLibraryPath(path)))) return { row, target: path }
    }
    return null
  }

  async function describe(name: string): Promise<TrashItem | null> {
    const path = trashPath(name)
    const entry = await stat(path).catch(() => null)
    if (!entry) return null
    const base = basename(name)

    if (entry.isDirectory()) {
      const size = await usage(path)
      const manifest = name.startsWith(`${RENDERS_DIR}/`) ? await readManifest(path) : null
      if (manifest) {
        const { row } = manifest
        const post = row.post_id
          ? (db.prepare('SELECT id FROM posts WHERE id = ?').get(row.post_id) as
              { id: string } | undefined)
          : undefined
        const taken = renderRow(row.id)
        return {
          name,
          kind: 'render',
          label: `${row.template_id} · ${row.kind} ${row.width}×${row.height}`,
          sizeBytes: size.bytes - (await stat(join(path, MANIFEST))).size,
          files: size.files - 1,
          trashedAt: manifest.trashedAt,
          restorable: true,
          restoreNote: taken
            ? 'Its record is back already — Restore puts the files back where they were.'
            : post
              ? 'Goes back to media/renders with its record, as an older render of its post.'
              : row.post_id
                ? 'Goes back to media/renders with its record; its post is gone, so it returns unlinked.'
                : 'Goes back to media/renders with its record, as a Templates studio render.',
        }
      }
      return {
        name,
        kind: 'other',
        label: base,
        sizeBytes: size.bytes,
        files: size.files,
        trashedAt: entry.mtime.toISOString(),
        restorable: false,
        restoreNote: 'A folder Pullup doesn’t know — open the trash folder in Finder.',
      }
    }

    // A moved file keeps its mtime; ctime is when it was moved into the trash.
    const file = { sizeBytes: entry.size, files: 1, trashedAt: entry.ctime.toISOString() }
    if (name.includes('/')) {
      return {
        name,
        kind: 'other',
        label: base,
        ...file,
        restorable: false,
        restoreNote: 'Not something Pullup can restore — open the trash folder in Finder.',
      }
    }
    if (RENDER_FILE_NAME.test(name)) {
      const owner = await renderRowForFile(name)
      return {
        name,
        kind: 'render-file',
        label: RENDER_FILE_NAME.exec(name)![2]!,
        ...file,
        restorable: !!owner,
        restoreNote: owner
          ? 'Its render record still exists — the file goes back where it was.'
          : 'Deleted in the Templates studio: the file is here, but its render record was deleted, so Pullup can’t use it again.',
      }
    }
    // Anything capture imports: media, and PDFs / text files / web locations.
    if (!unsupportedReason(name)) {
      const duplicate = DUPLICATE_NAME.test(name)
      return {
        name,
        kind: duplicate ? 'duplicate' : 'original',
        label: originalNameOf(name),
        ...file,
        restorable: true,
        restoreNote: duplicate
          ? 'Arrived in the inbox folder while the same file was already in the library. Restore imports it only if that copy is gone.'
          : 'Comes back as a new asset in the Inbox. Its title, notes, project and AI analysis were deleted with it.',
      }
    }
    return {
      name,
      kind: 'other',
      label: base,
      ...file,
      restorable: false,
      restoreNote: 'Not a file type Pullup imports — open the trash folder in Finder.',
    }
  }

  async function trash(): Promise<TrashListing> {
    const names: string[] = []
    const top = await readdir(trashRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of top) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === RENDERS_DIR && entry.isDirectory()) {
        const inner = await readdir(join(trashRoot, RENDERS_DIR)).catch(() => [] as string[])
        names.push(...inner.filter((n) => !n.startsWith('.')).map((n) => `${RENDERS_DIR}/${n}`))
      } else names.push(entry.name)
    }
    const items = (await Promise.all(names.map(describe))).filter((i): i is TrashItem => !!i)
    items.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt))
    return {
      folder: trashRoot,
      items,
      totalBytes: (await usage(trashRoot)).bytes,
    }
  }

  async function restoreRender(dir: string, manifest: RenderManifest): Promise<RestoreResult> {
    const { row } = manifest
    const moves: { from: string; to: string }[] = []
    for (const file of manifest.files) {
      const to = fromLibraryPath(file.from)
      if (relative(library.root, to).startsWith('..')) {
        throw new StorageError(400, 'The render record points outside the library')
      }
      const from = join(dir, file.name)
      if (!(await exists(from))) continue
      if (await exists(to)) {
        throw new StorageError(409, `Something already exists at ${file.from} — move it first`)
      }
      moves.push({ from, to })
    }

    let postId = row.post_id
    if (!renderRow(row.id)) {
      // Only the columns the table has now (a later migration may have added or dropped some).
      const columns = (db.prepare('PRAGMA table_info(renders)').all() as { name: string }[])
        .map((c) => c.name)
        .filter((c) => c in row)
      if (postId && !db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) postId = null
      const values: Record<string, unknown> = { ...row, post_id: postId }
      db.prepare(
        `INSERT INTO renders (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
      ).run(Object.fromEntries(columns.map((c) => [c, values[c] ?? null])))
    }
    for (const { from, to } of moves) await moveFile(from, to)
    await rm(join(dir, MANIFEST), { force: true })
    await rmdir(dir).catch(() => undefined) // left in place if anything unexpected is inside
    notify('renders')
    return { kind: 'render', renderId: row.id, postId }
  }

  function restore(name: string): Promise<RestoreResult> {
    return exclusive(async () => {
      const item = await describe(name)
      if (!item) throw new StorageError(404, 'Not in the trash any more')
      if (!item.restorable) throw new StorageError(409, item.restoreNote)
      const path = trashPath(name)

      if (item.kind === 'render') {
        const manifest = await readManifest(path)
        if (!manifest) throw new StorageError(409, 'The render record is missing')
        return restoreRender(path, manifest)
      }

      if (item.kind === 'render-file') {
        const owner = await renderRowForFile(name)
        if (!owner) throw new StorageError(409, item.restoreNote)
        await moveFile(path, fromLibraryPath(owner.target))
        notify('renders')
        return { kind: 'render', renderId: owner.row.id, postId: owner.row.post_id }
      }

      // An original (or an inbox duplicate): a new asset, through capture like any import.
      const checksum = await sha256File(path)
      // (A PDF's pages carry `<pdf checksum>:p<n>`, so they're looked up separately.)
      const existing = assets.findByChecksum(checksum) ?? assets.findPdfPages(checksum)[0]
      if (existing) {
        throw new StorageError(409, 'This file is already in the library — nothing to restore')
      }
      const info = await stat(path)
      const { asset } = await capture.importFile({
        path,
        originalName: item.label,
        source: 'inbox_folder',
        // Moving a file keeps its mtime — the closest thing to the original capture date.
        capturedAt: info.mtime < info.birthtime ? info.mtime : info.birthtime,
        checksum,
      })
      return { kind: 'asset', assetId: asset.id }
    })
  }

  // Deletes for good — only the items named (what Mario was shown when he confirmed).
  function emptyTrash(names: string[]): Promise<EmptyTrashResult> {
    return exclusive(async () => {
      const paths = [...new Set(names)].map(trashPath)
      const result: EmptyTrashResult = { removed: 0, bytes: 0 }
      for (const path of paths) {
        const entry = await stat(path).catch(() => null)
        if (!entry) continue
        const size = entry.isDirectory() ? (await usage(path)).bytes : entry.size
        await rm(path, { recursive: true, force: true })
        result.removed++
        result.bytes += size
      }
      return result
    })
  }

  return { info, cleanupPreview, cleanup, trash, restore, emptyTrash }
}

export type Storage = ReturnType<typeof createStorage>
