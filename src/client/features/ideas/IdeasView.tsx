import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'

export function IdeasView() {
  return (
    <>
      <ViewHeader
        title="Ideas"
        description="Post concepts, each tied to the material it's based on."
      />
      <EmptyState title="No ideas yet" milestone="Ideas · M4">
        Select assets or a project and Pullup suggests technical, personal, opinion, business and
        educational angles — always citing its sources.
      </EmptyState>
    </>
  )
}
