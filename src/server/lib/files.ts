import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import type { AssetKind } from '@shared/constants.ts'

// Supported capture formats. Anything else is rejected (upload) or left in place (inbox folder).
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

export const MAX_FILE_BYTES = 8 * 1024 ** 3 // 8 GB

export const extOf = (name: string) => extname(name).slice(1).toLowerCase()

export const mimeFromName = (name: string): string | null => MIME_BY_EXT[extOf(name)] ?? null

export function kindFromMime(
  mime: string | null | undefined
): Extract<AssetKind, 'image' | 'video'> | null {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return null
}

// Resolves the MIME type from the extension. The browser-provided type is only used for
// extensionless names; an unsupported extension is always rejected.
export function resolveMime(name: string, provided?: string | null): string | null {
  if (extOf(name)) return mimeFromName(name)
  return kindFromMime(provided) ? (provided ?? null) : null
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

// Readable, collision-free file name: "screen-recording-2026-09-25-3f9a1c2b.mov".
export function mediaFileName(originalName: string, id: string): string {
  const ext = extOf(originalName)
  const stem = originalName
    .slice(0, originalName.length - (ext ? ext.length + 1 : 0))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${stem || 'file'}-${id.slice(0, 8)}${ext ? `.${ext}` : ''}`
}

// Moves a file, falling back to copy + delete across volumes.
export async function moveFile(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await unlink(from)
  }
}
