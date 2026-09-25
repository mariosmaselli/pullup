import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { useAssets } from '../../lib/queries.ts'

export function LibraryView() {
  const { data: assets, isLoading } = useAssets('all')

  return (
    <>
      <ViewHeader
        title="Library"
        description={
          assets?.length
            ? `Everything you've captured — ${assets.length} item${assets.length === 1 ? '' : 's'}.`
            : "Everything you've captured."
        }
      />
      <AssetBrowser
        assets={assets}
        isLoading={isLoading}
        empty={
          <EmptyState title="Your library is empty">
            Everything you capture collects here. Filters by project, tag and usage arrive with
            projects.
          </EmptyState>
        }
      />
    </>
  )
}
