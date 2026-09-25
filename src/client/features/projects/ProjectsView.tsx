import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'

export function ProjectsView() {
  return (
    <>
      <ViewHeader
        title="Projects"
        description="Experiments, client work and tools, with their material and posts."
      />
      <EmptyState title="No projects yet" milestone="Organize · M2">
        Each project keeps its assets, ideas and everything you've published about it. Client
        projects keep AI analysis off unless you allow it.
      </EmptyState>
    </>
  )
}
