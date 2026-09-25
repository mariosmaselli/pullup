import type { Asset, AssetDerivative, LinkMeta } from '@shared/types.ts'
import type { AssetKind, AssetSource, ProcessingStatus } from '@shared/constants.ts'
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

export const now = () => new Date().toISOString()

export function toAsset(row: AssetRow, derivatives: DerivativeRow[]): Asset {
  const mapped = derivatives
    .sort((a, b) => (a.time_ms ?? 0) - (b.time_ms ?? 0))
    .map<AssetDerivative>((d) => ({
      role: d.role,
      url: fileUrl(d.file_path, d.created_at),
      width: d.width,
      height: d.height,
      timeMs: d.time_ms,
    }))

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
  }
}

export interface AssetFilter {
  scope?: 'inbox' | 'all'
  projectId?: string
}

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

  const hydrate = (rows: AssetRow[]) => {
    const derivatives = derivativesFor(rows.map((r) => r.id))
    return rows.map((row) => toAsset(row, derivatives.get(row.id) ?? []))
  }

  return {
    list({ scope = 'all', projectId }: AssetFilter = {}): Asset[] {
      const conditions = [
        scope === 'inbox' ? 'triaged_at IS NULL' : null,
        projectId ? 'project_id = @projectId' : null,
      ].filter(Boolean)
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db
        .prepare(
          `SELECT * FROM assets ${where} ORDER BY captured_at DESC, created_at DESC LIMIT 1000`
        )
        .all({ projectId: projectId ?? null }) as AssetRow[]
      return hydrate(rows)
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
        db.prepare('SELECT count(*) AS n FROM post_media WHERE asset_id = ?').get(id) as {
          n: number
        }
      ).n
    },
  }
}

export type AssetStore = ReturnType<typeof createAssetStore>
