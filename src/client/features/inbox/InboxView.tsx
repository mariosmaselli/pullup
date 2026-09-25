import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { AssetBrowser } from '../../components/AssetBrowser/AssetBrowser.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { useAssets, useSystem } from '../../lib/queries.ts'
import { useCapture } from '../../lib/capture.tsx'

export function InboxView() {
  const { data: system } = useSystem()
  const { data: assets, isLoading } = useAssets('inbox')
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
      <AssetBrowser
        assets={assets}
        isLoading={isLoading}
        empty={
          <EmptyState title="Nothing to review">
            Drop screenshots, recordings or links anywhere in Pullup, paste with ⌘V, or press ⌘K to
            write a note. Files saved to <code>{system?.library.inbox ?? '~/Pullup/inbox'}</code>{' '}
            show up here too.
          </EmptyState>
        }
      />
    </>
  )
}
