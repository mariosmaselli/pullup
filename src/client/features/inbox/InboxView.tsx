import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { useAssets, useInboxIssues, useSystem } from '../../lib/queries.ts'
import { useCapture } from '../../lib/capture.tsx'
import { InboxIssues } from './InboxIssues.tsx'

export function InboxView() {
  const { data: system } = useSystem()
  const { data: assets, isLoading } = useAssets('inbox')
  const { data: issues, isLoading: issuesLoading } = useInboxIssues()
  const { setQuickCaptureOpen } = useCapture()

  return (
    <>
      <ViewHeader
        title="Inbox"
        description="New material that hasn't been reviewed yet."
        actions={
          <Button onClick={() => setQuickCaptureOpen(true)}>
            Capture <span className="button__kbd">⌘K</span>
          </Button>
        }
      />
      {/* Both lists load before either shows, so the grid never jumps down. */}
      {!isLoading && !issuesLoading && issues?.length ? (
        <InboxIssues issues={issues} folder={system?.library.inbox ?? '~/Pullup/inbox'} />
      ) : null}
      <AssetBrowser
        assets={assets}
        isLoading={isLoading || issuesLoading}
        advanceOnReview
        summary={`${assets?.length ?? 0} to review · “Mark reviewed” opens the next one`}
        empty={
          <EmptyState title="Nothing to review">
            Drop screenshots, recordings, PDFs or links anywhere in Pullup, paste with ⌘V, or press
            ⌘K to write a note. Files saved to{' '}
            <code>{system?.library.inbox ?? '~/Pullup/inbox'}</code> show up here too.
          </EmptyState>
        }
      />
    </>
  )
}
