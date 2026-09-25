import { mkdirSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { config } from './config.ts'

// The library is the folder that holds your content — kept outside the code repo.
//   inbox/     drop files here (Shortcuts, screenshots…); picked up by the watcher (M1)
//   media/     original files after capture, owned by Pullup
//   cache/     thumbnails and video frames; safe to delete, rebuilt on demand
//   media/renders/  files made by templates (MP4/JPEG) — outputs, not captures
//   fonts/     font files templates may use (licensed fonts stay out of the code repo)
//   trash/     originals of deleted assets, until you empty it yourself
//   .tmp/      in-flight uploads
//   pullup.db  all metadata
export const library = {
  root: config.libraryRoot,
  inbox: join(config.libraryRoot, 'inbox'),
  media: join(config.libraryRoot, 'media'),
  cache: join(config.libraryRoot, 'cache'),
  renders: join(config.libraryRoot, 'media', 'renders'),
  fonts: join(config.libraryRoot, 'fonts'),
  trash: join(config.libraryRoot, 'trash'),
  tmp: join(config.libraryRoot, '.tmp'),
  database: join(config.libraryRoot, 'pullup.db'),
}

export function ensureLibrary() {
  // Leftovers from interrupted uploads.
  rmSync(library.tmp, { recursive: true, force: true })
  for (const dir of [
    library.root,
    library.inbox,
    library.media,
    library.cache,
    library.trash,
    library.tmp,
    library.renders,
    library.fonts,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
}

// Stored paths are relative to the library root so the folder can move.
export const toLibraryPath = (absolute: string) => relative(library.root, absolute)
export const fromLibraryPath = (path: string) => resolve(library.root, path)

// URL the client uses to load a library file (see /api/files in server/index.ts).
export const fileUrl = (path: string, version?: string) =>
  `/api/files/${path.split('/').map(encodeURIComponent).join('/')}${version ? `?v=${encodeURIComponent(version)}` : ''}`
