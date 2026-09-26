import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '../../components/Button/Button.tsx'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { relativeTime } from '../../lib/format.ts'
import { ANGLE_LABEL, PLATFORM_LABEL, STATUS_LABEL } from '../../lib/labels.ts'
import { usePosts } from '../../lib/queries.ts'
import { NewDraftPanel } from './NewDraftPanel.tsx'
import { LogPostPanel } from './LogPostPanel.tsx'
import './DraftsView.scss'

// Archived and discarded posts stay out of the way until their filter is picked.
type Filter = 'draft,review,approved,scheduled' | 'review' | 'published' | 'archived' | 'discarded'

const EMPTY: Record<Filter, string> = {
  'draft,review,approved,scheduled':
    'Start one with “New draft”, or pick an idea on the Ideas page and choose “Write drafts”.',
  review: 'Nothing waiting for review. Set a draft’s status to Review when it’s ready for a look.',
  published: 'Nothing published yet. Posted something outside Pullup? Use “Log a post”.',
  archived: 'Archived posts land here — out of the way, never deleted.',
  discarded: 'Discarded drafts land here. Open one to restore it to a draft.',
}

// "Planned 7 Oct" for a pencilled-in day (local YYYY-MM-DD).
const plannedLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `Planned ${new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

export function DraftsView() {
  const [filter, setFilter] = useState<Filter>('draft,review,approved,scheduled')
  const [panel, setPanel] = useState<'new' | 'log' | null>(null)
  const { data: posts, isLoading } = usePosts(filter)
  const visible = posts ?? []

  return (
    <>
      <ViewHeader
        title="Drafts"
        description="Platform-specific posts, from draft to published."
        actions={
          <div className="drafts-view__actions flex items-center">
            <Button size="s" onClick={() => setPanel(panel === 'log' ? null : 'log')}>
              Log a post
            </Button>
            <Button
              variant="primary"
              size="s"
              onClick={() => setPanel(panel === 'new' ? null : 'new')}
            >
              New draft
            </Button>
          </div>
        }
      />
      {panel === 'new' ? <NewDraftPanel onClose={() => setPanel(null)} /> : null}
      {panel === 'log' ? <LogPostPanel onClose={() => setPanel(null)} /> : null}
      <div className="drafts-view__filters flex">
        <Segmented<Filter>
          label="Filter drafts"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'draft,review,approved,scheduled', label: 'In progress' },
            { value: 'review', label: 'Review' },
            { value: 'published', label: 'Published' },
            { value: 'archived', label: 'Archived' },
            { value: 'discarded', label: 'Discarded' },
          ]}
        />
      </div>
      {isLoading ? null : visible.length ? (
        <div className="drafts-view__list flex flex-col">
          {visible.map((post) => (
            <Link
              key={post.id}
              to="/drafts/$id"
              params={{ id: post.id }}
              className="drafts-view__row flex items-center"
            >
              <span className="drafts-view__platform -meta shrink-0">
                {PLATFORM_LABEL[post.platform]}
              </span>
              <span className="drafts-view__text -p flex-1">
                {post.current?.segments[0]?.text ||
                  post.current?.caption ||
                  (post.current?.segments.some((s) => s.assetId) ? '(media only)' : '(empty)')}
                {post.format === 'thread' ? (
                  <span className="drafts-view__muted">
                    {' '}
                    · {post.current?.segments.length} posts
                  </span>
                ) : null}
              </span>
              <span className="drafts-view__meta -meta shrink-0">
                {post.angle ? `${ANGLE_LABEL[post.angle]} · ` : ''}
                {post.plannedFor ? `${plannedLabel(post.plannedFor)} · ` : ''}
                {STATUS_LABEL[post.status]} · {relativeTime(post.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No drafts here">{EMPTY[filter]}</EmptyState>
      )}
    </>
  )
}
