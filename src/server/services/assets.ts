import { basename } from 'node:path'
import type {
  Asset,
  AssetAnalysis,
  AssetDerivative,
  AssetUsage,
  LinkMeta,
  TagCount,
} from '@shared/types.ts'
import type {
  AssetKind,
  AssetSource,
  IdeaStatus,
  Platform,
  PostStatus,
  ProcessingStatus,
  Visibility,
} from '@shared/constants.ts'
import type { DB } from '../db/index.ts'
import { fileUrl } from '../library.ts'
import { notify } from '../lib/events.ts'

export interface AssetRow {
  id: string
  kind: AssetKind
  title: string
  notes: string
  source: AssetSource
  project_id: string | null
  tags: string
  visibility: 'private' | 'approved'
  processing_status: ProcessingStatus
  processing_error: string | null
  triaged_at: string | null
  captured_at: string
  file_path: string | null
  original_name: string | null
  mime: string | null
  size_bytes: number | null
  checksum: string | null
  width: number | null
  height: number | null
  duration_ms: number | null
  url: string | null
  url_meta: string | null
  body: string | null
  created_at: string
  updated_at: string
}

export interface DerivativeRow {
  id: string
  asset_id: string
  role: AssetDerivative['role']
  file_path: string
  width: number | null
  height: number | null
  time_ms: number | null
  created_at: string
}

export interface AnalysisRow {
  id: string
  asset_id: string
  description: string
  subjects: string
  suggested_tags: string
  suggested_project_id: string | null
  hooks: string
  questions: string
  created_at: string
}

export const toAnalysis = (row: AnalysisRow): AssetAnalysis => ({
  id: row.id,
  description: row.description,
  subjects: JSON.parse(row.subjects),
  suggestedTags: JSON.parse(row.suggested_tags),
  suggestedProjectId: row.suggested_project_id,
  hooks: JSON.parse(row.hooks),
  questions: JSON.parse(row.questions),
  createdAt: row.created_at,
})

export const now = () => new Date().toISOString()

// A PDF becomes one PNG asset per page (capture.ts). The PDF itself stays in media/ as the
// original, and the pages sit next to it — the file names are the link, no extra columns:
//   media/2026/09/award-3f9a1c2b.pdf        the PDF, as captured
//   media/2026/09/award-3f9a1c2b-p001.png   page 1 (checksum "<pdf sha256>:p1")
// Regular media always end in "-<id8>.<ext>", so they never look like a page.
const PDF_PAGE_FILE = /^(.*-[0-9a-f]{8})-p(\d{3,})\.png$/
const PDF_PAGE_NAME = /^(.*) \(page \d+\)\.png$/

export const pdfPageFile = (pdfPath: string, page: number) =>
  pdfPath.replace(/\.pdf$/, `-p${String(page).padStart(3, '0')}.png`)
export const pdfPageName = (pdfName: string, page: number) => `${pdfName} (page ${page}).png`
export const pdfPageChecksum = (pdfChecksum: string, page: number) => `${pdfChecksum}:p${page}`

export function pdfSourceOf(
  row: Pick<AssetRow, 'file_path' | 'checksum' | 'original_name'>
): { pdfPath: string; name: string; page: number } | null {
  if (!row.file_path || !row.checksum?.includes(':p')) return null
  const match = PDF_PAGE_FILE.exec(row.file_path)
  if (!match) return null
  const pdfPath = `${match[1]}.pdf`
  const name = PDF_PAGE_NAME.exec(row.original_name ?? '')?.[1] ?? basename(pdfPath)
  return { pdfPath, name, page: Number(match[2]) }
}

export function toAsset(
  row: AssetRow,
  derivatives: DerivativeRow[],
  analysis?: AnalysisRow
): Asset {
  const mapped = derivatives
    .sort((a, b) => (a.time_ms ?? 0) - (b.time_ms ?? 0))
    .map<AssetDerivative>((d) => ({
      role: d.role,
      url: fileUrl(d.file_path, d.created_at),
      width: d.width,
      height: d.height,
      timeMs: d.time_ms,
    }))

  const pdf = pdfSourceOf(row)

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    notes: row.notes,
    source: row.source,
    projectId: row.project_id,
    tags: JSON.parse(row.tags),
    visibility: row.visibility,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    triagedAt: row.triaged_at,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    file: row.file_path
      ? {
          url: fileUrl(row.file_path),
          path: row.file_path,
          originalName: row.original_name ?? '',
          mime: row.mime ?? '',
          sizeBytes: row.size_bytes ?? 0,
          width: row.width,
          height: row.height,
          durationMs: row.duration_ms,
        }
      : null,
    link: row.url
      ? { url: row.url, meta: row.url_meta ? (JSON.parse(row.url_meta) as LinkMeta) : null }
      : null,
    body: row.body,
    thumbUrl: mapped.find((d) => d.role === 'thumb')?.url ?? null,
    derivatives: mapped,
    analysis: analysis ? toAnalysis(analysis) : null,
    pdf: pdf ? { url: fileUrl(pdf.pdfPath), name: pdf.name, page: pdf.page } : null,
  }
}

export interface AssetFilter {
  scope?: 'inbox' | 'all'
  // A project id, or 'none' for assets without a project.
  projectId?: string
  // Words matched (all of them) against title, notes, note text, file name, link URL and title.
  q?: string
  kind?: AssetKind
  visibility?: Visibility
  tag?: string
  limit?: number
}

export const LIST_LIMIT = 1000

// Tags as Mario typed them, trimmed, without case-insensitive repeats.
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
  }
  return out
}

const likeTerm = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export function createAssetStore(db: DB) {
  const derivativesFor = (ids: string[]) => {
    if (!ids.length) return new Map<string, DerivativeRow[]>()
    const rows = db
      .prepare(`SELECT * FROM asset_derivatives WHERE asset_id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids)) as DerivativeRow[]
    const byAsset = new Map<string, DerivativeRow[]>()
    for (const row of rows) byAsset.set(row.asset_id, [...(byAsset.get(row.asset_id) ?? []), row])
    return byAsset
  }

  // Latest analysis per asset.
  const analysesFor = (ids: string[]) => {
    if (!ids.length) return new Map<string, AnalysisRow>()
    const rows = db
      .prepare(
        `SELECT * FROM asset_analyses WHERE asset_id IN (SELECT value FROM json_each(?))
         ORDER BY created_at`
      )
      .all(JSON.stringify(ids)) as AnalysisRow[]
    return new Map(rows.map((r) => [r.asset_id, r]))
  }

  const hydrate = (rows: AssetRow[]) => {
    const ids = rows.map((r) => r.id)
    const derivatives = derivativesFor(ids)
    const analyses = analysesFor(ids)
    return rows.map((row) => toAsset(row, derivatives.get(row.id) ?? [], analyses.get(row.id)))
  }

  return {
    list({
      scope = 'all',
      projectId,
      q,
      kind,
      visibility,
      tag,
      limit = LIST_LIMIT,
    }: AssetFilter = {}): Asset[] {
      const params: Record<string, string | number> = { limit }
      const conditions: string[] = []
      if (scope === 'inbox') conditions.push('triaged_at IS NULL')
      if (projectId === 'none') conditions.push('project_id IS NULL')
      else if (projectId) {
        conditions.push('project_id = @projectId')
        params.projectId = projectId
      }
      if (kind) {
        conditions.push('kind = @kind')
        params.kind = kind
      }
      if (visibility) {
        conditions.push('visibility = @visibility')
        params.visibility = visibility
      }
      if (tag) {
        conditions.push(
          'EXISTS (SELECT 1 FROM json_each(assets.tags) t WHERE lower(t.value) = lower(@tag))'
        )
        params.tag = tag.trim()
      }
      const terms = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8)
      terms.forEach((term, i) => {
        const p = `@q${i}`
        conditions.push(
          `(${[
            'title',
            'notes',
            'body',
            'original_name',
            'url',
            "json_extract(url_meta, '$.title')",
            'tags',
          ]
            .map((column) => `${column} LIKE ${p} ESCAPE '\\'`)
            .join(' OR ')})`
        )
        params[`q${i}`] = likeTerm(term)
      })
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db
        .prepare(
          `SELECT * FROM assets ${where} ORDER BY captured_at DESC, created_at DESC LIMIT @limit`
        )
        .all(params) as AssetRow[]
      return hydrate(rows)
    },

    // Every tag in use, most used first.
    tags(): TagCount[] {
      const rows = db
        .prepare(
          `SELECT t.value AS tag, count(*) AS count FROM assets, json_each(assets.tags) t
           GROUP BY lower(t.value) ORDER BY count DESC, lower(t.value)`
        )
        .all() as TagCount[]
      return rows
    },

    row(id: string): AssetRow | undefined {
      return db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
    },

    get(id: string): Asset | undefined {
      const row = this.row(id)
      return row ? hydrate([row])[0] : undefined
    },

    findByChecksum(checksum: string): AssetRow | undefined {
      return db.prepare('SELECT * FROM assets WHERE checksum = ?').get(checksum) as
        AssetRow | undefined
    },

    // Page assets made from the PDF with this checksum (any that are still in the library).
    findPdfPages(pdfChecksum: string): AssetRow[] {
      const rows = db
        .prepare('SELECT * FROM assets WHERE checksum > ? AND checksum < ?')
        .all(`${pdfChecksum}:p`, `${pdfChecksum}:q`) as AssetRow[]
      const page = (r: AssetRow) => Number(r.checksum!.slice(pdfChecksum.length + 2))
      return rows.sort((a, b) => page(a) - page(b))
    },

    // How many assets are pages of the PDF at this library path.
    pdfPageCount(pdfPath: string): number {
      const prefix = pdfPath.replace(/\.pdf$/, '-p')
      return (
        db
          .prepare(
            "SELECT count(*) AS n FROM assets WHERE substr(file_path, 1, length(?)) = ? AND checksum LIKE '%:p%'"
          )
          .get(prefix, prefix) as { n: number }
      ).n
    },

    insert(values: Partial<AssetRow> & Pick<AssetRow, 'id' | 'kind' | 'source' | 'captured_at'>) {
      const columns = Object.keys(values)
      db.prepare(
        `INSERT INTO assets (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
      ).run(values)
      notify('assets')
    },

    update(id: string, values: Partial<Omit<AssetRow, 'id' | 'created_at'>>) {
      const columns = Object.keys(values)
      if (!columns.length) return
      db.prepare(
        `UPDATE assets SET ${columns.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @updated_at WHERE id = @id`
      ).run({ ...values, id, updated_at: now() })
      notify('assets')
    },

    // One statement for many assets (bulk actions), one change event.
    updateMany(ids: string[], values: Partial<Omit<AssetRow, 'id' | 'created_at'>>) {
      const columns = Object.keys(values)
      if (!columns.length || !ids.length) return
      db.prepare(
        `UPDATE assets SET ${columns.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @updated_at
         WHERE id IN (SELECT value FROM json_each(@ids))`
      ).run({ ...values, ids: JSON.stringify(ids), updated_at: now() })
      notify('assets')
    },

    rows(ids: string[]): AssetRow[] {
      if (!ids.length) return []
      const found = db
        .prepare('SELECT * FROM assets WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(ids)) as AssetRow[]
      // Keep the caller's order.
      return ids.map((id) => found.find((r) => r.id === id)).filter((r): r is AssetRow => !!r)
    },

    hydrate(rows: AssetRow[]): Asset[] {
      return hydrate(rows)
    },

    remove(id: string) {
      db.prepare('DELETE FROM assets WHERE id = ?').run(id)
      notify('assets')
    },

    derivativeRows(id: string): DerivativeRow[] {
      return db
        .prepare('SELECT * FROM asset_derivatives WHERE asset_id = ?')
        .all(id) as DerivativeRow[]
    },

    replaceDerivatives(assetId: string, rows: Omit<DerivativeRow, 'asset_id' | 'created_at'>[]) {
      db.transaction(() => {
        db.prepare('DELETE FROM asset_derivatives WHERE asset_id = ?').run(assetId)
        const insert = db.prepare(
          `INSERT INTO asset_derivatives (id, asset_id, role, file_path, width, height, time_ms, created_at)
           VALUES (@id, @asset_id, @role, @file_path, @width, @height, @time_ms, @created_at)`
        )
        const created_at = now()
        for (const row of rows) insert.run({ ...row, asset_id: assetId, created_at })
      })()
      notify('assets')
    },

    // Adds one derivative without touching the others (e.g. a lazily built video proxy).
    addDerivative(assetId: string, row: Omit<DerivativeRow, 'asset_id' | 'created_at'>) {
      db.prepare(
        `INSERT INTO asset_derivatives (id, asset_id, role, file_path, width, height, time_ms, created_at)
         VALUES (@id, @asset_id, @role, @file_path, @width, @height, @time_ms, @created_at)`
      ).run({ ...row, asset_id: assetId, created_at: now() })
      notify('assets')
    },

    removeDerivative(id: string) {
      db.prepare('DELETE FROM asset_derivatives WHERE id = ?').run(id)
      notify('assets')
    },

    idsWithStatus(statuses: ProcessingStatus[]): string[] {
      return (
        db
          .prepare(
            `SELECT id FROM assets WHERE processing_status IN (SELECT value FROM json_each(?)) ORDER BY created_at`
          )
          .all(JSON.stringify(statuses)) as { id: string }[]
      ).map((r) => r.id)
    },

    usedInPosts(id: string): number {
      return (
        db
          .prepare('SELECT count(DISTINCT post_id) AS n FROM post_media WHERE asset_id = ?')
          .get(id) as {
          n: number
        }
      ).n
    },

    // Posts that show this asset and ideas that cite it (read-only look into their tables).
    usage(id: string): AssetUsage {
      const posts = db
        .prepare(
          `SELECT p.id, p.platform, p.status, r.segments, r.caption
           FROM posts p LEFT JOIN post_revisions r ON r.id = p.current_revision_id
           WHERE p.id IN (SELECT post_id FROM post_media WHERE asset_id = ?)
           ORDER BY p.updated_at DESC`
        )
        .all(id) as {
        id: string
        platform: Platform
        status: PostStatus
        segments: string | null
        caption: string | null
      }[]
      const ideas = db
        .prepare(
          `SELECT i.id, i.title, i.status FROM ideas i
           WHERE i.id IN (SELECT idea_id FROM idea_sources WHERE asset_id = ?)
           ORDER BY i.created_at DESC`
        )
        .all(id) as { id: string; title: string; status: IdeaStatus }[]

      const excerpt = (segments: string | null, caption: string | null) => {
        const texts = (JSON.parse(segments ?? '[]') as { text?: string }[]).map((s) => s.text ?? '')
        const text = [...texts, caption ?? ''].find((t) => t.trim()) ?? ''
        const line = text.trim().replace(/\s+/g, ' ')
        return line.length > 90 ? `${line.slice(0, 89)}…` : line
      }
      return {
        posts: posts.map((p) => ({
          id: p.id,
          platform: p.platform,
          status: p.status,
          excerpt: excerpt(p.segments, p.caption),
        })),
        ideas,
      }
    },

    // Every derivative row (for finding files deleted from cache/).
    allDerivatives(): Pick<DerivativeRow, 'id' | 'asset_id' | 'role' | 'file_path'>[] {
      return db
        .prepare('SELECT id, asset_id, role, file_path FROM asset_derivatives')
        .all() as Pick<DerivativeRow, 'id' | 'asset_id' | 'role' | 'file_path'>[]
    },
  }
}

export type AssetStore = ReturnType<typeof createAssetStore>
