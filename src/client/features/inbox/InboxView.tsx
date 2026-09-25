import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { useSystem } from '../../lib/queries.ts'

export function InboxView() {
  const { data: system } = useSystem()

  return (
    <>
      <ViewHeader title="Inbox" description="New material that hasn't been reviewed yet." />
      <EmptyState title="Nothing to review" milestone="Capture · M1">
        Drag and drop, paste and quick notes arrive next. Files saved to{' '}
        <code>{system?.library.inbox ?? '~/Pullup/inbox'}</code> will show up here.
      </EmptyState>
    </>
  )
}
