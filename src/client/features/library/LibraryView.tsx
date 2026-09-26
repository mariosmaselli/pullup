import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { ASSET_KINDS, VISIBILITY } from '@shared/constants.ts'
import type { AssetFilters } from '@shared/types.ts'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { useAssetSearch } from '../../lib/queries.ts'
import { LibraryFilters } from './LibraryFilters.tsx'

const LIST_LIMIT = 1000
const KEYS = ['q', 'kind', 'project', 'visibility', 'tag'] as const

// Filters live in the URL (/library?q=…&kind=…&project=none…) so a view can be bookmarked,
// shared between tabs and survives a reload. Unknown values are dropped.
function readFilters(searchStr: string): AssetFilters {
  const params = new URLSearchParams(searchStr)
  const value = (key: string) => params.get(key)?.trim() || undefined
  const kind = value('kind')
  const visibility = value('visibility')
  return {
    q: value('q'),
    kind: ASSET_KINDS.find((k) => k === kind),
    project: value('project'),
    visibility: VISIBILITY.find((v) => v === visibility),
    tag: value('tag'),
  }
}

export function LibraryView() {
  const searchStr = useLocation({ select: (l) => l.searchStr })
  const navigate = useNavigate()
  const filters = useMemo(() => readFilters(searchStr), [searchStr])
  const filtered = KEYS.some((key) => filters[key])
  const { data: assets, isLoading } = useAssetSearch('all', filters)

  const setFilters = useCallback(
    (next: AssetFilters) => {
      const params = new URLSearchParams()
      for (const key of KEYS) if (next[key]) params.set(key, next[key]!)
      const query = params.toString()
      void navigate({ href: `/library${query ? `?${query}` : ''}`, replace: true })
    },
    [navigate]
  )

  const count = assets?.length ?? 0
  const description = !assets
    ? "Everything you've captured."
    : filtered
      ? `${count >= LIST_LIMIT ? `First ${LIST_LIMIT}` : count} matching item${count === 1 ? '' : 's'}.`
      : `Everything you've captured — ${count >= LIST_LIMIT ? `the latest ${LIST_LIMIT}` : count} item${count === 1 ? '' : 's'}.`

  return (
    <>
      <ViewHeader title="Library" description={description} />
      <AssetBrowser
        assets={assets}
        isLoading={isLoading}
        tools={<LibraryFilters filters={filters} onChange={setFilters} />}
        empty={
          filtered ? (
            <EmptyState title="Nothing matches">
              Try other words or fewer filters.{' '}
              <Button variant="ghost" size="s" onClick={() => setFilters({})}>
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState title="Your library is empty">
              Everything you capture collects here — search it and filter by kind, project,
              visibility and tag.
            </EmptyState>
          )
        }
      />
    </>
  )
}
