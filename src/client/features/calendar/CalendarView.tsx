import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'

export function CalendarView() {
  return (
    <>
      <ViewHeader title="Calendar" description="Planned posts by date, platform and identity." />
      <EmptyState title="Nothing scheduled" milestone="Workflow · M5">
        Approved posts get a date here. Copy the caption, grab the media and mark it published with
        its URL.
      </EmptyState>
    </>
  )
}
