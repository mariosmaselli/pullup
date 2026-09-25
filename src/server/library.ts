import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'

// The library is the folder that holds your content — kept outside the code repo.
//   inbox/     drop files here (Shortcuts, screenshots…); picked up by the watcher (M1)
//   media/     original files after capture, owned by Pullup
//   cache/     thumbnails and video frames; safe to delete, rebuilt on demand
//   pullup.db  all metadata
export const library = {
  root: config.libraryRoot,
  inbox: join(config.libraryRoot, 'inbox'),
  media: join(config.libraryRoot, 'media'),
  cache: join(config.libraryRoot, 'cache'),
  database: join(config.libraryRoot, 'pullup.db'),
}

export function ensureLibrary() {
  for (const dir of [library.root, library.inbox, library.media, library.cache]) {
    mkdirSync(dir, { recursive: true })
  }
}
