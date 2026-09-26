// Housekeeping shapes shared by the server and Settings / Trash (server ↔ client).

// ── Storage (GET /api/storage) ───────────────────────────────────────────────────────────────

export interface FolderUsage {
  bytes: number
  files: number
}

export interface StorageInfo {
  root: string
  // media/ without media/renders — the captured originals.
  originals: FolderUsage
  // Template outputs in media/renders: MP4/JPEG + posters, and their GIF / WebP exports.
  renders: FolderUsage
  exports: FolderUsage
  cache: FolderUsage
  trash: FolderUsage
  backups: FolderUsage
  database: FolderUsage // pullup.db + its -wal / -shm files
  total: number
  // Free space on the disk the library is on (null if the OS won't say).
  diskFreeBytes: number | null
}

// ── Old render cleanup (GET / POST /api/storage/cleanup) ─────────────────────────────────────

export const CLEANUP_MIN_AGE_DAYS = 7

export interface CleanupCandidate {
  id: string
  templateId: string
  createdAt: string
  postId: string | null
  bytes: number // MP4/JPEG + poster + exports
  files: number
}

export interface CleanupPreview {
  olderThanDays: number
  count: number
  bytes: number
  exports: number // GIF / WebP files among them
  candidates: CleanupCandidate[]
}

export interface CleanupResult {
  moved: number
  bytes: number
  // Asked for but no longer eligible (now a frame's current render, published, or gone).
  skipped: string[]
}

// ── Trash (GET /api/storage/trash, POST …/restore, POST …/empty) ─────────────────────────────

export type TrashKind =
  | 'original' // a deleted asset's original file
  | 'duplicate' // a file that arrived in the inbox folder while already in the library
  | 'render' // a render moved here by "Clean up old renders" (record kept alongside)
  | 'render-file' // a render file deleted from the Templates studio (record deleted)
  | 'other'

export interface TrashItem {
  // Path inside trash/ — a top-level name, or "renders/<render id>" for cleaned-up renders.
  name: string
  kind: TrashKind
  label: string
  sizeBytes: number
  files: number
  trashedAt: string
  restorable: boolean
  // What Restore does, or why it can't.
  restoreNote: string
}

export interface TrashListing {
  folder: string
  items: TrashItem[]
  totalBytes: number
}

export type RestoreResult =
  { kind: 'asset'; assetId: string } | { kind: 'render'; renderId: string; postId: string | null }

export interface EmptyTrashResult {
  removed: number
  bytes: number
}

// ── Fonts (GET /api/system/fonts) ────────────────────────────────────────────────────────────

export interface FontFolder {
  folder: string
  files: { name: string; sizeBytes: number }[]
}

// ── AI spend (GET /api/system/ai-usage) ──────────────────────────────────────────────────────

export interface AiSpend {
  calls: number
  failed: number
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export interface AiUsage {
  total: AiSpend
  // Newest first; months in the Mac's local time ("2026-09").
  months: (AiSpend & { month: string })[]
  tasks: (AiSpend & { task: string })[] // all time
  monthTasks: (AiSpend & { month: string; task: string })[]
}
