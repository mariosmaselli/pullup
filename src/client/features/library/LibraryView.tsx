import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'

export function LibraryView() {
  return (
    <>
      <ViewHeader title="Library" description="Everything you've captured, as a grid or a list." />
      <EmptyState title="Your library is empty" milestone="Organize · M2">
        Captured images, recordings, links and notes collect here, filterable by project, tag and
        whether they've been used in a post.
      </EmptyState>
    </>
  )
}
