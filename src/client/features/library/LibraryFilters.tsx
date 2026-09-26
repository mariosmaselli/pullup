import { useEffect, useRef, useState } from 'react'
import type { AssetKind, Visibility } from '@shared/constants.ts'
import type { AssetFilters } from '@shared/types.ts'
import { useAssetTags, useProjects } from '../../lib/queries.ts'
import './LibraryFilters.scss'

const KINDS: { value: AssetKind; label: string }[] = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'link', label: 'Links' },
  { value: 'note', label: 'Notes' },
]

interface Props {
  filters: AssetFilters
  onChange: (filters: AssetFilters) => void
}

// Search box + kind / project / visibility / tag selects. Search waits for a pause in typing.
export function LibraryFilters({ filters, onChange }: Props) {
  const { data: projects = [] } = useProjects()
  const { data: tags = [] } = useAssetTags()
  const [q, setQ] = useState(filters.q ?? '')
  const latest = useRef(filters)
  latest.current = filters

  // Back/forward or "Clear" changes the URL: follow it.
  useEffect(() => setQ(filters.q ?? ''), [filters.q])

  useEffect(() => {
    if (q.trim() === (latest.current.q ?? '')) return
    const timer = setTimeout(() => onChange({ ...latest.current, q: q.trim() || undefined }), 250)
    return () => clearTimeout(timer)
  }, [q, onChange])

  const set = <K extends keyof AssetFilters>(key: K, value: AssetFilters[K] | '') =>
    onChange({ ...filters, [key]: value || undefined })

  const active = Object.values(filters).some(Boolean)

  return (
    <div className="library-filters flex items-center flex-1 min-w-0" role="search">
      <input
        className="library-filters__search -p1"
        type="search"
        value={q}
        placeholder="Search titles, notes, files, links…"
        aria-label="Search the library"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && q) {
            e.stopPropagation()
            setQ('')
          }
        }}
      />
      <select
        className="library-filters__select -p1"
        aria-label="Kind"
        value={filters.kind ?? ''}
        data-active={filters.kind ? true : undefined}
        onChange={(e) => set('kind', e.target.value as AssetKind | '')}
      >
        <option value="">All kinds</option>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <select
        className="library-filters__select -p1"
        aria-label="Project"
        value={filters.project ?? ''}
        data-active={filters.project ? true : undefined}
        onChange={(e) => set('project', e.target.value)}
      >
        <option value="">All projects</option>
        <option value="none">Unassigned</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        className="library-filters__select -p1"
        aria-label="Visibility"
        value={filters.visibility ?? ''}
        data-active={filters.visibility ? true : undefined}
        onChange={(e) => set('visibility', e.target.value as Visibility | '')}
      >
        <option value="">Any visibility</option>
        <option value="private">Private</option>
        <option value="approved">Approved</option>
      </select>
      <select
        className="library-filters__select -p1"
        aria-label="Tag"
        value={filters.tag ?? ''}
        data-active={filters.tag ? true : undefined}
        disabled={!tags.length && !filters.tag}
        onChange={(e) => set('tag', e.target.value)}
      >
        <option value="">{tags.length || filters.tag ? 'Any tag' : 'No tags yet'}</option>
        {filters.tag && !tags.some((t) => t.tag.toLowerCase() === filters.tag!.toLowerCase()) ? (
          <option value={filters.tag}>{filters.tag}</option>
        ) : null}
        {tags.map((t) => (
          <option key={t.tag} value={t.tag}>
            {t.tag} ({t.count})
          </option>
        ))}
      </select>
      <button
        type="button"
        className="library-filters__clear -meta"
        onClick={() => {
          setQ('')
          onChange({})
        }}
        disabled={!active}
        aria-hidden={!active}
      >
        Clear
      </button>
    </div>
  )
}
