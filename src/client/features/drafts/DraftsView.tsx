import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'

export function DraftsView() {
  return (
    <>
      <ViewHeader title="Drafts" description="Platform-specific posts, from draft to published." />
      <EmptyState title="No drafts yet" milestone="Drafting · M4">
        Drafts for X and Instagram, written from your sources, with revision history and the claims
        each one makes.
      </EmptyState>
    </>
  )
}
